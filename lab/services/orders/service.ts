import type { FaultId } from "../../core/types.js";
import { TelemetryRecorder } from "../../core/telemetry.js";
import { InventoryService } from "../inventory/service.js";
import { PaymentsService } from "../payments/service.js";

export interface ConnectionPoolController {
  acquire(): { ok: true } | { ok: false; errorType: "connection_timeout" };
  release(): void;
  markLeak?(): void;
}

export interface OrderRequest {
  traceId: string;
  requestId: string;
  orderId: string;
  sku: string;
  quantity: number;
  startedAtMs: number;
}

export interface OrderResult {
  ok: boolean;
  durationMs: number;
  errorType?: string;
  attempts: number;
  inventoryReserved: boolean;
  spanId: string;
}

export class OrdersService {
  constructor(
    private readonly telemetry: TelemetryRecorder,
    private readonly inventory: InventoryService,
    private readonly payments: PaymentsService,
    private readonly pool: ConnectionPoolController,
  ) {}

  createOrder(request: OrderRequest, fault?: FaultId): OrderResult {
    const acquired = this.pool.acquire();
    if (!acquired.ok) {
      const durationMs = 1;
      const spanId = this.telemetry.span({
        traceId: request.traceId,
        service: "orders",
        operation: "orders.create",
        startMs: request.startedAtMs,
        durationMs,
        status: "error",
        attributes: { orderId: request.orderId, errorType: acquired.errorType },
      });
      this.telemetry.log({
        service: "orders",
        level: "error",
        event: "connection_acquisition_timeout",
        traceId: request.traceId,
        requestId: request.requestId,
        fields: { orderId: request.orderId },
      }, request.startedAtMs + durationMs);
      return { ok: false, durationMs, errorType: acquired.errorType, attempts: 0, inventoryReserved: false, spanId };
    }

    const inventoryStart = request.startedAtMs + 1;
    const inventoryResult = this.inventory.reserve({
      traceId: request.traceId,
      requestId: request.requestId,
      sku: request.sku,
      quantity: request.quantity,
      startedAtMs: inventoryStart,
    }, fault);
    if (!inventoryResult.ok) {
      this.pool.release();
      const durationMs = 1 + inventoryResult.durationMs;
      const spanId = this.telemetry.span({
        traceId: request.traceId,
        service: "orders",
        operation: "orders.create",
        startMs: request.startedAtMs,
        durationMs,
        status: "error",
        attributes: { orderId: request.orderId, errorType: inventoryResult.errorType ?? "unknown" },
      });
      return { ok: false, durationMs, ...(inventoryResult.errorType === undefined ? {} : { errorType: inventoryResult.errorType }), attempts: 0, inventoryReserved: false, spanId };
    }

    const maxAttempts = fault === "retry-storm" ? 4 : 1;
    const timeoutMs = fault === "timeout-too-short" ? 3 : 20;
    let attempts = 0;
    let elapsed = 1 + inventoryResult.durationMs;
    let paymentResult: ReturnType<PaymentsService["charge"]> | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attempts = attempt;
      paymentResult = this.payments.charge({
        traceId: request.traceId,
        requestId: request.requestId,
        orderId: request.orderId,
        attempt,
        startedAtMs: request.startedAtMs + elapsed,
        parentSpanId: inventoryResult.spanId,
      }, fault);
      elapsed += paymentResult.durationMs;
      if (paymentResult.ok || (fault === "timeout-too-short" && paymentResult.durationMs > timeoutMs)) break;
    }

    const timedOut = fault === "timeout-too-short" && (paymentResult?.durationMs ?? 0) > timeoutMs;
    const succeeded = Boolean(paymentResult?.ok) && !timedOut;
    const errorType = succeeded ? undefined : timedOut ? "downstream_timeout" : paymentResult?.errorType;
    if (succeeded) this.inventory.sell(request.quantity);
    if (fault !== "connection-pool-exhaustion") this.pool.release();
    else this.pool.markLeak?.();
    const spanId = this.telemetry.span({
      traceId: request.traceId,
      service: "orders",
      operation: "orders.create",
      startMs: request.startedAtMs,
      durationMs: elapsed,
      status: succeeded ? "ok" : "error",
      attributes: { orderId: request.orderId, attempts, errorType: errorType ?? "none" },
    });
    this.telemetry.log({
      service: "orders",
      level: succeeded ? "info" : "error",
      event: succeeded ? "order_created" : "order_failed",
      traceId: request.traceId,
      requestId: request.requestId,
      fields: { orderId: request.orderId, attempts, errorType: errorType ?? null },
    }, request.startedAtMs + elapsed);
    return { ok: succeeded, durationMs: elapsed, ...(errorType === undefined ? {} : { errorType }), attempts, inventoryReserved: true, spanId };
  }
}
