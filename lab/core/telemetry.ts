import type {
  FaultId,
  FaultMarker,
  JsonLog,
  SpanStatus,
  TraceSpan,
  TelemetryBundle,
} from "./types.js";

const EPOCH_MS = Date.parse("2026-01-01T00:00:00.000Z");

/** Deterministic clock and structured telemetry collector for the local lab. */
export class TelemetryRecorder {
  private logicalMs = EPOCH_MS;
  private logSequence = 0;
  private spanSequence = 0;
  private markerSequence = 0;
  readonly logs: JsonLog[] = [];
  readonly spans: TraceSpan[] = [];
  readonly faultMarkers: FaultMarker[] = [];

  reset(): void {
    this.logicalMs = EPOCH_MS;
    this.logSequence = 0;
    this.spanSequence = 0;
    this.markerSequence = 0;
    this.logs.length = 0;
    this.spans.length = 0;
    this.faultMarkers.length = 0;
  }

  nowMs(): number {
    return this.logicalMs;
  }

  now(): string {
    return new Date(this.logicalMs).toISOString();
  }

  advance(durationMs: number): void {
    this.logicalMs += Math.max(0, durationMs);
  }

  log(input: Omit<JsonLog, "timestamp" | "fields"> & { fields?: JsonLog["fields"] }, atMs = this.logicalMs): void {
    const log: JsonLog = {
      timestamp: new Date(atMs).toISOString(),
      service: input.service,
      level: input.level,
      event: input.event,
      fields: { sequence: ++this.logSequence, ...(input.fields ?? {}) },
    };
    if (input.traceId !== undefined) log.traceId = input.traceId;
    if (input.requestId !== undefined) log.requestId = input.requestId;
    this.logs.push(log);
  }

  span(input: {
    traceId: string;
    service: string;
    operation: string;
    startMs: number;
    durationMs: number;
    status: SpanStatus;
    parentSpanId?: string;
    attributes?: Record<string, string | number | boolean>;
  }): string {
    const spanId = `span-${String(++this.spanSequence).padStart(6, "0")}`;
    const span: TraceSpan = {
      spanId,
      traceId: input.traceId,
      service: input.service,
      operation: input.operation,
      startTime: new Date(input.startMs).toISOString(),
      durationMs: input.durationMs,
      status: input.status,
      attributes: input.attributes ?? {},
    };
    if (input.parentSpanId !== undefined) span.parentSpanId = input.parentSpanId;
    this.spans.push(span);
    return spanId;
  }

  marker(faultId: FaultId, action: "activated" | "reset", service: string, cause: string): void {
    this.faultMarkers.push({
      id: `fault-marker-${String(++this.markerSequence).padStart(6, "0")}`,
      faultId,
      action,
      timestamp: this.now(),
      service,
      cause,
    });
  }

  snapshot(): TelemetryBundle {
    return {
      logs: this.logs.map((item) => ({ ...item, fields: { ...item.fields } })),
      spans: this.spans.map((item) => ({ ...item, attributes: { ...item.attributes } })),
      faultMarkers: this.faultMarkers.map((item) => ({ ...item })),
    };
  }
}

export const deterministicTimestamp = (offsetMs = 0): string =>
  new Date(EPOCH_MS + offsetMs).toISOString();
