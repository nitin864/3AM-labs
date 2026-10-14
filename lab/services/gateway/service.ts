import type { FaultId, RequestOutcome, WorkloadRequest } from "../../core/types.js";
import { TelemetryRecorder } from "../../core/telemetry.js";
import { OrdersService } from "../orders/service.js";

export class GatewayService {
  constructor(private readonly telemetry: TelemetryRecorder, private readonly orders: OrdersService) {}

  handle(request: WorkloadRequest, traceId: string, orderId: string, startedAtMs: number, fault?: FaultId): RequestOutcome {
    const order = this.orders.createOrder({
      traceId,
      requestId: request.requestId,
      orderId,
      sku: request.sku,
      quantity: request.quantity,
      startedAtMs: startedAtMs + 1,
    }, fault);
    const latencyMs = order.durationMs + 1;
    const status = order.ok ? "succeeded" : "failed";
    this.telemetry.span({
      traceId,
      service: "gateway",
      operation: "gateway.create_order",
      startMs: startedAtMs,
      durationMs: latencyMs,
      status: order.ok ? "ok" : "error",
      attributes: { requestId: request.requestId, orderId, errorType: order.errorType ?? "none" },
    });
    this.telemetry.log({
      service: "gateway",
      level: order.ok ? "info" : "error",
      event: order.ok ? "request_completed" : "request_failed",
      traceId,
      requestId: request.requestId,
      fields: { orderId, status, latencyMs, errorType: order.errorType ?? null },
    }, startedAtMs + latencyMs);
    const outcome: RequestOutcome = {
      requestId: request.requestId,
      traceId,
      orderId,
      status,
      service: "gateway",
      latencyMs,
      downstreamAttempts: order.attempts,
      inventoryReserved: order.inventoryReserved,
    };
    if (order.errorType !== undefined) outcome.errorType = order.errorType;
    return outcome;
  }
}
