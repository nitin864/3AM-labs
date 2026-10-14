import type { FaultId } from "../../core/types.js";
import { TelemetryRecorder } from "../../core/telemetry.js";

export interface PaymentRequest {
  traceId: string;
  requestId: string;
  orderId: string;
  attempt: number;
  startedAtMs: number;
  parentSpanId?: string;
}

export interface PaymentResult {
  ok: boolean;
  durationMs: number;
  errorType?: "payment_declined";
  spanId: string;
}

export class PaymentsService {
  constructor(private readonly telemetry: TelemetryRecorder) {}

  charge(request: PaymentRequest, fault?: FaultId): PaymentResult {
    const durationMs = fault === "timeout-too-short" ? 8 : 3;
    const ok = fault !== "retry-storm";
    const spanId = this.telemetry.span({
      traceId: request.traceId,
      service: "payments",
      operation: "payments.charge",
      startMs: request.startedAtMs,
      durationMs,
      status: ok ? "ok" : "error",
      ...(request.parentSpanId === undefined ? {} : { parentSpanId: request.parentSpanId }),
      attributes: { orderId: request.orderId, attempt: request.attempt },
    });
    this.telemetry.log({
      service: "payments",
      level: ok ? "info" : "error",
      event: ok ? "payment_charged" : "payment_declined",
      traceId: request.traceId,
      requestId: request.requestId,
      fields: { orderId: request.orderId, attempt: request.attempt, durationMs },
    }, request.startedAtMs + durationMs);
    return ok ? { ok: true, durationMs, spanId } : { ok: false, durationMs, errorType: "payment_declined", spanId };
  }
}
