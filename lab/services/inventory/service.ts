import type { FaultId, InventoryMetrics } from "../../core/types.js";
import { TelemetryRecorder } from "../../core/telemetry.js";

export interface InventoryRequest {
  traceId: string;
  requestId: string;
  sku: string;
  quantity: number;
  startedAtMs: number;
  parentSpanId?: string;
}

export interface InventoryResult {
  ok: boolean;
  durationMs: number;
  reserved: boolean;
  errorType?: "out_of_stock";
  spanId: string;
}

/** In-memory inventory implementation used by both local and Compose modes. */
export class InventoryService {
  private initialStock = 100;
  private availableStock = 100;
  private reserved = 0;
  private sold = 0;
  private rejected = 0;

  constructor(private readonly telemetry: TelemetryRecorder) {}

  reset(stock = 100): void {
    this.initialStock = stock;
    this.availableStock = stock;
    this.reserved = 0;
    this.sold = 0;
    this.rejected = 0;
  }

  reserve(request: InventoryRequest, fault?: FaultId): InventoryResult {
    const durationMs = 2;
    const canReserve = fault === "oversell-race" || this.availableStock >= request.quantity;
    if (canReserve) {
      // The race deliberately models multiple concurrent checks observing the
      // same value. It is deterministic and is never used by healthy mode.
      this.availableStock -= request.quantity;
      this.reserved += request.quantity;
      const spanId = this.telemetry.span({
        traceId: request.traceId,
        service: "inventory",
        operation: "inventory.reserve",
        startMs: request.startedAtMs,
        durationMs,
        status: "ok",
        ...(request.parentSpanId === undefined ? {} : { parentSpanId: request.parentSpanId }),
        attributes: { sku: request.sku, quantity: request.quantity, availableStock: this.availableStock },
      });
      this.telemetry.log({
        service: "inventory",
        level: "info",
        event: "inventory_reserved",
        traceId: request.traceId,
        requestId: request.requestId,
        fields: { sku: request.sku, quantity: request.quantity, availableStock: this.availableStock },
      }, request.startedAtMs + durationMs);
      return { ok: true, durationMs, reserved: true, spanId };
    }
    this.rejected += 1;
    const spanId = this.telemetry.span({
      traceId: request.traceId,
      service: "inventory",
      operation: "inventory.reserve",
      startMs: request.startedAtMs,
      durationMs,
      status: "error",
      ...(request.parentSpanId === undefined ? {} : { parentSpanId: request.parentSpanId }),
      attributes: { sku: request.sku, quantity: request.quantity, availableStock: this.availableStock },
    });
    this.telemetry.log({
      service: "inventory",
      level: "warn",
      event: "inventory_out_of_stock",
      traceId: request.traceId,
      requestId: request.requestId,
      fields: { sku: request.sku, quantity: request.quantity, availableStock: this.availableStock },
    }, request.startedAtMs + durationMs);
    return { ok: false, durationMs, reserved: false, errorType: "out_of_stock", spanId };
  }

  sell(quantity: number): void {
    this.reserved = Math.max(0, this.reserved - quantity);
    this.sold += quantity;
  }

  metrics(): InventoryMetrics {
    return {
      initialStock: this.initialStock,
      availableStock: this.availableStock,
      reserved: this.reserved,
      sold: this.sold,
      rejected: this.rejected,
      negativeStock: this.availableStock < 0,
      invariantHolds: this.availableStock >= 0,
    };
  }
}
