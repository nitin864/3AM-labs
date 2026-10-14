/** Build an observed dependency/evidence graph from measured traces.
 *
 * Edges describe calls visible in parentSpanId relationships or in the
 * measured ordering of services within a trace. They intentionally carry an
 * explicit non-causal label: an observed dependency is not causal proof.
 */

export interface GraphSpan {
  spanId: string;
  parentSpanId?: string;
  traceId: string;
  service: string;
  operation: string;
  startTime: string;
  durationMs: number;
  status: "ok" | "error";
}

export interface GraphTelemetry {
  spans?: readonly GraphSpan[];
}

export interface GraphRun {
  telemetry: GraphTelemetry;
}

export interface GraphNode {
  id: string;
  kind: "service";
  evidenceType: "observed";
  inferredCausality: false;
  spanCount: number;
  errorCount: number;
  errorRate: number;
  totalLatencyMs: number;
  p95LatencyMs?: number;
  affectedTraceIds: string[];
  evidenceRefs: string[];
}

export interface EdgeWeightComponents {
  calls: number;
  errors: number;
  totalLatencyMs: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relationship: "observed_dependency";
  evidenceType: "observed";
  inferredCausality: false;
  observedBy: Array<"parentSpanId" | "service_interaction">;
  calls: number;
  errorCount: number;
  errorRate: number;
  totalLatencyMs: number;
  averageLatencyMs: number;
  latencyDeltaMs?: number;
  affectedTraceIds: string[];
  weight: number;
  weightComponents: EdgeWeightComponents;
  evidenceRefs: string[];
}

export interface DependencyEvidenceGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  causalInterpretation: "observed_dependencies_only";
}

interface EdgeObservation {
  source: string;
  target: string;
  span: GraphSpan;
  via: "parentSpanId" | "service_interaction";
}

const ref = (spanId: string): string => `telemetry:span:${spanId}`;
const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
const quantile = (values: readonly number[], q: number): number | undefined => {
  const sorted = values.slice().sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower];
  const high = sorted[upper];
  return low === undefined || high === undefined ? undefined : round(low + (high - low) * (position - lower));
};

const spanOrder = (a: GraphSpan, b: GraphSpan): number =>
  Date.parse(a.startTime) - Date.parse(b.startTime) || a.spanId.localeCompare(b.spanId);

function observations(run: GraphRun): EdgeObservation[] {
  const spans = [...(run.telemetry.spans ?? [])];
  const byId = new Map(spans.map((span) => [span.spanId, span]));
  const output: EdgeObservation[] = [];
  const seen = new Set<string>();
  for (const span of spans) {
    const parent = span.parentSpanId === undefined ? undefined : byId.get(span.parentSpanId);
    if (parent === undefined || parent.service === span.service) continue;
    output.push({ source: parent.service, target: span.service, span, via: "parentSpanId" });
    seen.add(`${span.traceId}|${parent.service}|${span.service}|${span.spanId}`);
  }
  const byTrace = new Map<string, GraphSpan[]>();
  for (const span of spans) {
    const trace = byTrace.get(span.traceId) ?? [];
    trace.push(span);
    byTrace.set(span.traceId, trace);
  }
  for (const trace of byTrace.values()) {
    const ordered = trace.sort(spanOrder);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (previous === undefined || current === undefined || previous.service === current.service) continue;
      const key = `${current.traceId}|${previous.service}|${current.service}|${current.spanId}`;
      if (seen.has(key)) continue;
      output.push({ source: previous.service, target: current.service, span: current, via: "service_interaction" });
      seen.add(key);
    }
  }
  return output;
}

function serviceNodes(spans: readonly GraphSpan[]): GraphNode[] {
  const byService = new Map<string, GraphSpan[]>();
  for (const span of spans) {
    const list = byService.get(span.service) ?? [];
    list.push(span);
    byService.set(span.service, list);
  }
  return [...byService.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([service, serviceSpans]) => {
    const errors = serviceSpans.filter((span) => span.status === "error").length;
    const totalLatency = serviceSpans.reduce((sum, span) => sum + span.durationMs, 0);
    const p95 = quantile(serviceSpans.map((span) => span.durationMs), 0.95);
    return {
      id: service,
      kind: "service" as const,
      evidenceType: "observed" as const,
      inferredCausality: false as const,
      spanCount: serviceSpans.length,
      errorCount: errors,
      errorRate: round(errors / serviceSpans.length),
      totalLatencyMs: totalLatency,
      ...(p95 === undefined ? {} : { p95LatencyMs: p95 }),
      affectedTraceIds: [...new Set(serviceSpans.map((span) => span.traceId))].sort(),
      evidenceRefs: serviceSpans.map((span) => ref(span.spanId)).sort(),
    };
  });
}

/** Construct only measured edges; no edge is marked as causal. */
export function buildDependencyGraph(run: GraphRun, baseline?: GraphRun): DependencyEvidenceGraph {
  const spans = [...(run.telemetry.spans ?? [])];
  const baselineEdges = baseline === undefined ? new Map<string, number>() : aggregateEdges(observations(baseline)).averages;
  const aggregate = aggregateEdges(observations(run));
  const edges: GraphEdge[] = [...aggregate.groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, items]) => {
    const calls = items.length;
    const errors = items.filter((item) => item.span.status === "error").length;
    const totalLatencyMs = items.reduce((sum, item) => sum + item.span.durationMs, 0);
    const averageLatencyMs = round(totalLatencyMs / calls);
    const previous = baselineEdges.get(id);
    const weight = round(calls + errors * 2 + totalLatencyMs / 1000);
    return {
      id,
      source: items[0]?.source ?? "",
      target: items[0]?.target ?? "",
      relationship: "observed_dependency" as const,
      evidenceType: "observed" as const,
      inferredCausality: false as const,
      observedBy: [...new Set(items.map((item) => item.via))].sort() as Array<"parentSpanId" | "service_interaction">,
      calls,
      errorCount: errors,
      errorRate: round(errors / calls),
      totalLatencyMs,
      averageLatencyMs,
      ...(previous === undefined ? {} : { latencyDeltaMs: round(averageLatencyMs - previous) }),
      affectedTraceIds: [...new Set(items.map((item) => item.span.traceId))].sort(),
      weight,
      weightComponents: { calls, errors, totalLatencyMs },
      evidenceRefs: [...new Set(items.map((item) => ref(item.span.spanId)))].sort(),
    };
  });
  return { nodes: serviceNodes(spans), edges, causalInterpretation: "observed_dependencies_only" };
}

function aggregateEdges(items: readonly EdgeObservation[]): {
  groups: Map<string, EdgeObservation[]>;
  averages: Map<string, number>;
} {
  const groups = new Map<string, EdgeObservation[]>();
  for (const item of items) {
    const id = `${item.source}->${item.target}`;
    const group = groups.get(id) ?? [];
    group.push(item);
    groups.set(id, group);
  }
  const averages = new Map<string, number>();
  for (const [id, group] of groups) averages.set(id, round(group.reduce((sum, item) => sum + item.span.durationMs, 0) / group.length));
  return { groups, averages };
}

export const buildEvidenceGraph = buildDependencyGraph;
