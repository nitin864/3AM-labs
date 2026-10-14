/** Shared contracts for the deterministic Faultline Lab runtime.
 *
 * These types intentionally do not depend on a web framework, database driver,
 * or telemetry SDK.  The local harness and the Compose entrypoint therefore
 * exercise the same service code.
 */

export type FaultId =
  | "fault-2-pool-exhaustion"
  | "fault-4-timeout-mismatch"
  | "fault-5-oversell-race"
  | "fault-6-poison-queue";

export type RequestStatus = "succeeded" | "failed";
export type SpanStatus = "ok" | "error";

export interface WorkloadRequest {
  requestId: string;
  customerId: string;
  sku: string;
  quantity: number;
  index: number;
}

export interface WorkloadManifest {
  id: string;
  seed: number;
  requestCount: number;
  generatedAt: string;
  requests: WorkloadRequest[];
}

export interface WorkloadOptions {
  count?: number;
  seed?: number;
  manifest?: WorkloadManifest;
}

export interface RequestOutcome {
  requestId: string;
  traceId: string;
  orderId: string;
  status: RequestStatus;
  errorType?: string;
  service: string;
  latencyMs: number;
  downstreamAttempts: number;
  inventoryReserved: boolean;
}

export interface JsonLog {
  timestamp: string;
  service: string;
  level: "info" | "warn" | "error";
  event: string;
  traceId?: string;
  requestId?: string;
  fields: Record<string, string | number | boolean | null>;
}

export interface TraceSpan {
  spanId: string;
  parentSpanId?: string;
  traceId: string;
  service: string;
  operation: string;
  startTime: string;
  durationMs: number;
  status: SpanStatus;
  attributes: Record<string, string | number | boolean>;
}

export interface ConnectionPoolMetrics {
  max: number;
  active: number;
  acquired: number;
  released: number;
  waits: number;
  timeouts: number;
  leaked: number;
  utilization: number;
}

export interface QueueMetrics {
  depth: number;
  maxDepth: number;
  enqueued: number;
  processed: number;
  failed: number;
  retryAttempts: number;
  deadLettered?: number;
}

export interface InventoryMetrics {
  initialStock: number;
  availableStock: number;
  reserved: number;
  sold: number;
  rejected: number;
  negativeStock: boolean;
  invariantHolds: boolean;
}

export interface ServiceMetrics {
  requests: number;
  successes: number;
  failures: number;
  errorRate: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
}

export interface MetricsSnapshot {
  requests: number;
  successes: number;
  failures: number;
  errorRate: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  byService: Record<string, ServiceMetrics>;
  connectionPool: ConnectionPoolMetrics;
  queue: QueueMetrics;
  inventory: InventoryMetrics;
}

export interface TelemetryBundle {
  logs: JsonLog[];
  spans: TraceSpan[];
  faultMarkers: FaultMarker[];
}

export interface FaultMarker {
  id: string;
  faultId: FaultId;
  action: "activated" | "reset";
  timestamp: string;
  service: string;
  cause: string;
}

export interface RunResult {
  runId: string;
  workload: WorkloadManifest;
  faultId?: FaultId;
  startedAt: string;
  finishedAt: string;
  outcomes: RequestOutcome[];
  metrics: MetricsSnapshot;
  telemetry: TelemetryBundle;
  healthy: boolean;
}

export interface LabHealth {
  status: "healthy" | "faulted";
  activeFault?: FaultId;
  serviceNames: string[];
  persistence: "memory" | "sql-compatible";
  lastRunId?: string;
}

export interface FaultDefinition {
  id: FaultId;
  title: string;
  description: string;
  service: string;
  groundTruthCause: string;
  expectedSymptoms: string[];
  verification: string;
}
