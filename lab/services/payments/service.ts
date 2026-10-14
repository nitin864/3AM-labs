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
    // The payment operation is intentionally slower than the faulted caller
    // deadline, but still completes. This creates the observable boundary
    // mismatch that the timeout experiment is meant to reproduce.
    const durationMs = fault === "fault-4-timeout-mismatch" ? 220 : 40;
    const ok = true;
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
