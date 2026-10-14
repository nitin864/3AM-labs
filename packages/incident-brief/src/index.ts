/** Deterministic incident summarisation. This package intentionally has no lab
 * or telemetry SDK dependency: callers can pass the equivalent measured data.
 */

export type SpanStatus = "ok" | "error";
export type RequestStatus = "succeeded" | "failed";

export interface BriefLog {
  timestamp: string;
  service: string;
  level: "info" | "warn" | "error";
  event: string;
  traceId?: string;
  requestId?: string;
  fields?: Record<string, string | number | boolean | null>;
}

export interface BriefSpan {
  spanId: string;
  parentSpanId?: string;
  traceId: string;
  service: string;
  operation: string;
  startTime: string;
  durationMs: number;
  status: SpanStatus;
  attributes?: Record<string, string | number | boolean>;
}

export interface BriefFaultMarker {
  id: string;
  faultId: string;
  action: "activated" | "reset";
  timestamp: string;
  service: string;
  cause: string;
}

export interface TelemetryBundleLike {
  logs?: readonly BriefLog[];
  spans?: readonly BriefSpan[];
  faultMarkers?: readonly BriefFaultMarker[];
}

export interface OutcomeLike {
  requestId?: string;
  traceId?: string;
  status: RequestStatus;
  errorType?: string;
  service?: string;
  latencyMs?: number;
}

export interface MetricsLike {
  requests?: number;
  successes?: number;
  failures?: number;
  errorRate?: number;
  latencyP50Ms?: number;
  latencyP95Ms?: number;
  byService?: Record<string, {
    requests?: number;
    successes?: number;
    failures?: number;
    errorRate?: number;
    latencyP50Ms?: number;
    latencyP95Ms?: number;
  }>;
}

export interface RunResultLike {
  runId?: string;
  startedAt: string;
  finishedAt: string;
  outcomes?: readonly OutcomeLike[];
  metrics?: MetricsLike;
  telemetry: TelemetryBundleLike;
  workload?: { id?: string; requestCount?: number };
}

export interface MetricSummary {
  requestCount: number;
  errorCount: number;
  successCount: number;
  errorRate: number;
  p50LatencyMs?: number;
  p95LatencyMs?: number;
}

export interface ErrorTypeSummary {
  type: string;
  count: number;
  evidenceRefs: string[];
}

export interface ServiceImpactSummary extends MetricSummary {
  service: string;
  latencyDeltaMs?: number;
}

export interface CriticalSpanSummary {
  spanId: string;
  traceId: string;
  service: string;
  operation: string;
  durationMs: number;
  status: SpanStatus;
  evidenceRef: string;
}

export interface EvidenceReference {
  id: string;
  kind: "log" | "trace" | "fault-marker" | "metric" | "workload";
  source: string;
  timestamp?: string;
  traceId?: string;
  service?: string;
}

export interface IncidentBrief {
  runId?: string;
  workloadId?: string;
  timeWindow: { start: string; end: string; durationMs: number };
  baseline?: MetricSummary;
  incident: MetricSummary;
  comparison: {
    errorRateDelta?: number;
    p50LatencyDeltaMs?: number;
    p95LatencyDeltaMs?: number;
    errorCountDelta?: number;
  };
  errorTypes: ErrorTypeSummary[];
  affectedServices: ServiceImpactSummary[];
  affectedTraceIds: string[];
  criticalSpans: CriticalSpanSummary[];
  slowSpans: CriticalSpanSummary[];
  faultMarkers: BriefFaultMarker[];
  evidence: EvidenceReference[];
}

const finiteNonNegative = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value >= 0;

const quantile = (values: readonly number[], q: number): number | undefined => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower];
  const high = sorted[upper];
  if (low === undefined || high === undefined) return undefined;
  return low + (high - low) * (position - lower);
};

const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
const uniqueSorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();
const spanRef = (spanId: string): string => `telemetry:span:${spanId}`;

function metricSummary(run: RunResultLike): MetricSummary {
  const outcomes = [...(run.outcomes ?? [])];
  const measuredLatencies = outcomes.map((outcome) => outcome.latencyMs).filter(finiteNonNegative);
  const requests = outcomes.length > 0
    ? outcomes.length
    : (finiteNonNegative(run.metrics?.requests) ? run.metrics?.requests ?? 0 : 0);
  const errorCount = outcomes.length > 0
    ? outcomes.filter((outcome) => outcome.status === "failed").length
    : (finiteNonNegative(run.metrics?.failures) ? run.metrics?.failures ?? 0 : 0);
  const successCount = outcomes.length > 0
    ? outcomes.filter((outcome) => outcome.status === "succeeded").length
    : (finiteNonNegative(run.metrics?.successes) ? run.metrics?.successes ?? 0 : Math.max(0, requests - errorCount));
  const errorRate = requests > 0 ? errorCount / requests : (finiteNonNegative(run.metrics?.errorRate) ? run.metrics?.errorRate ?? 0 : 0);
  const p50 = quantile(measuredLatencies, 0.5) ?? run.metrics?.latencyP50Ms;
  const p95 = quantile(measuredLatencies, 0.95) ?? run.metrics?.latencyP95Ms;
  return {
    requestCount: requests,
    errorCount,
    successCount,
    errorRate: round(errorRate),
    ...(p50 === undefined ? {} : { p50LatencyMs: round(p50) }),
    ...(p95 === undefined ? {} : { p95LatencyMs: round(p95) }),
  };
}

function serviceSummaries(run: RunResultLike, baseline?: RunResultLike): ServiceImpactSummary[] {
  const spans = [...(run.telemetry.spans ?? [])];
  const outcomes = [...(run.outcomes ?? [])];
  const names = new Set<string>([
    ...spans.map((span) => span.service),
    ...outcomes.flatMap((outcome) => outcome.service ? [outcome.service] : []),
    ...Object.keys(run.metrics?.byService ?? {}),
  ]);
  const baseByService = baseline === undefined
    ? new Map<string, ServiceImpactSummary>()
    : new Map(serviceSummaries(baseline).map((item) => [item.service, item]));
  return [...names].sort().map((service) => {
    const serviceSpans = spans.filter((span) => span.service === service);
    const serviceOutcomes = outcomes.filter((outcome) => outcome.service === service);
    const configured = run.metrics?.byService?.[service];
    const requests = serviceOutcomes.length || configured?.requests || serviceSpans.length;
    const errors = serviceOutcomes.length
      ? serviceOutcomes.filter((outcome) => outcome.status === "failed").length
      : (configured?.failures ?? serviceSpans.filter((span) => span.status === "error").length);
    const latencies = serviceOutcomes.map((item) => item.latencyMs).filter(finiteNonNegative);
    const spanLatencies = serviceSpans.map((item) => item.durationMs).filter(finiteNonNegative);
    const p50 = quantile(latencies.length ? latencies : spanLatencies, 0.5) ?? configured?.latencyP50Ms;
    const p95 = quantile(latencies.length ? latencies : spanLatencies, 0.95) ?? configured?.latencyP95Ms;
    const base = baseByService.get(service);
    const latencyDelta = p95 !== undefined && base?.p95LatencyMs !== undefined ? round(p95 - base.p95LatencyMs) : undefined;
    return {
      service,
      requestCount: requests,
      errorCount: errors,
      successCount: Math.max(0, requests - errors),
      errorRate: requests > 0 ? round(errors / requests) : (configured?.errorRate ?? 0),
      ...(p50 === undefined ? {} : { p50LatencyMs: round(p50) }),
      ...(p95 === undefined ? {} : { p95LatencyMs: round(p95) }),
      ...(latencyDelta === undefined ? {} : { latencyDeltaMs: latencyDelta }),
    };
  }).sort((a, b) => b.errorCount - a.errorCount
    || (b.p95LatencyMs ?? 0) - (a.p95LatencyMs ?? 0)
    || a.service.localeCompare(b.service));
}

function evidenceForRun(run: RunResultLike): EvidenceReference[] {
  const logs = run.telemetry.logs ?? [];
  const spans = run.telemetry.spans ?? [];
  const markers = run.telemetry.faultMarkers ?? [];
  const refs: EvidenceReference[] = [
    ...spans.map((span) => ({ id: spanRef(span.spanId), kind: "trace" as const, source: span.operation, timestamp: span.startTime, traceId: span.traceId, service: span.service })),
    ...logs.map((log, index) => ({ id: `telemetry:log:${index}`, kind: "log" as const, source: log.event, timestamp: log.timestamp, ...(log.traceId === undefined ? {} : { traceId: log.traceId }), service: log.service })),
    ...markers.map((marker) => ({ id: `telemetry:fault-marker:${marker.id}`, kind: "fault-marker" as const, source: marker.faultId, timestamp: marker.timestamp, service: marker.service })),
  ];
  if (run.metrics !== undefined) refs.push({ id: "telemetry:metrics", kind: "metric", source: "run.metrics" });
  if (run.workload?.id !== undefined) refs.push({ id: `telemetry:workload:${run.workload.id}`, kind: "workload", source: run.workload.id });
  return refs;
}

/** Build a compact, measured-only brief. Missing measurements remain absent. */
export function buildIncidentBrief(run: RunResultLike, baseline?: RunResultLike): IncidentBrief {
  const spans = [...(run.telemetry.spans ?? [])];
  const outcomes = [...(run.outcomes ?? [])];
  const errorMap = new Map<string, { count: number; refs: Set<string> }>();
  outcomes.forEach((outcome) => {
    if (outcome.status !== "failed") return;
    const type = outcome.errorType ?? "unknown";
    const current = errorMap.get(type) ?? { count: 0, refs: new Set<string>() };
    current.count += 1;
    if (outcome.traceId !== undefined) current.refs.add(`trace:${outcome.traceId}`);
    errorMap.set(type, current);
  });
  spans.filter((span) => span.status === "error").forEach((span) => {
    const raw = span.attributes?.errorType;
    const type = typeof raw === "string" && raw !== "none" ? raw : "span_error";
    const current = errorMap.get(type) ?? { count: 0, refs: new Set<string>() };
    if (outcomes.length === 0 || !outcomes.some((outcome) => outcome.traceId === span.traceId && outcome.status === "failed")) current.count += 1;
    current.refs.add(spanRef(span.spanId));
    errorMap.set(type, current);
  });
  if (outcomes.length === 0 && spans.every((span) => span.status !== "error")) {
    (run.telemetry.logs ?? []).forEach((log, index) => {
      if (log.level !== "error") return;
      const raw = log.fields?.errorType;
      const type = typeof raw === "string" && raw.length > 0 ? raw : log.event;
      const current = errorMap.get(type) ?? { count: 0, refs: new Set<string>() };
      current.count += 1;
      current.refs.add(`telemetry:log:${index}`);
      errorMap.set(type, current);
    });
  }
  const traces = new Set<string>([
    ...spans.filter((span) => span.status === "error").map((span) => span.traceId),
    ...outcomes.filter((outcome) => outcome.status === "failed" && outcome.traceId !== undefined).map((outcome) => outcome.traceId as string),
    ...(outcomes.length === 0 ? (run.telemetry.logs ?? []).filter((log) => log.level === "error" && log.traceId !== undefined).map((log) => log.traceId as string) : []),
  ]);
  const critical = [...spans].sort((a, b) => b.durationMs - a.durationMs || a.spanId.localeCompare(b.spanId));
  const criticalSpans = critical.filter((span, index, all) => index === all.findIndex((candidate) => candidate.traceId === span.traceId));
  const toCritical = (span: BriefSpan): CriticalSpanSummary => ({ spanId: span.spanId, traceId: span.traceId, service: span.service, operation: span.operation, durationMs: span.durationMs, status: span.status, evidenceRef: spanRef(span.spanId) });
  const incident = metricSummary(run);
  const base = baseline === undefined ? undefined : metricSummary(baseline);
  const incidentP95 = incident.p95LatencyMs;
  return {
    ...(run.runId === undefined ? {} : { runId: run.runId }),
    ...(run.workload?.id === undefined ? {} : { workloadId: run.workload.id }),
    timeWindow: { start: run.startedAt, end: run.finishedAt, durationMs: Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt)) },
    ...(base === undefined ? {} : { baseline: base }),
    incident,
    comparison: {
      ...(base === undefined ? {} : { errorRateDelta: round(incident.errorRate - base.errorRate), errorCountDelta: incident.errorCount - base.errorCount }),
      ...(base?.p50LatencyMs === undefined || incident.p50LatencyMs === undefined ? {} : { p50LatencyDeltaMs: round(incident.p50LatencyMs - base.p50LatencyMs) }),
      ...(base?.p95LatencyMs === undefined || incident.p95LatencyMs === undefined ? {} : { p95LatencyDeltaMs: round(incident.p95LatencyMs - base.p95LatencyMs) }),
    },
    errorTypes: [...errorMap.entries()].map(([type, value]) => ({ type, count: value.count, evidenceRefs: uniqueSorted(value.refs) })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    affectedServices: serviceSummaries(run, baseline),
    affectedTraceIds: uniqueSorted(traces),
    criticalSpans: criticalSpans.map(toCritical),
    slowSpans: incidentP95 === undefined ? [] : critical.filter((span) => span.durationMs >= incidentP95).map(toCritical),
    faultMarkers: [...(run.telemetry.faultMarkers ?? [])],
    evidence: evidenceForRun(run),
  };
}

export const summarizeIncident = buildIncidentBrief;
export const buildIncidentSummary = buildIncidentBrief;
