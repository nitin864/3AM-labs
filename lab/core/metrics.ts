import type {
  ConnectionPoolMetrics,
  InventoryMetrics,
  MetricsSnapshot,
  QueueMetrics,
  RequestOutcome,
  ServiceMetrics,
} from "./types.js";

const percentile = (values: number[], quantile: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index] ?? 0;
};

export function buildMetrics(input: {
  outcomes: RequestOutcome[];
  serviceLatencies: Record<string, number[]>;
  serviceFailures: Record<string, number>;
  pool: ConnectionPoolMetrics;
  queue: QueueMetrics;
  inventory: InventoryMetrics;
}): MetricsSnapshot {
  const requests = input.outcomes.length;
  const successes = input.outcomes.filter((outcome) => outcome.status === "succeeded").length;
  const failures = requests - successes;
  const latencies = input.outcomes.map((outcome) => outcome.latencyMs);
  const byService: Record<string, ServiceMetrics> = {};
  for (const [service, serviceValues] of Object.entries(input.serviceLatencies)) {
    const serviceRequests = serviceValues.length;
    const serviceFailureCount = input.serviceFailures[service] ?? 0;
    byService[service] = {
      requests: serviceRequests,
      successes: serviceRequests - serviceFailureCount,
      failures: serviceFailureCount,
      errorRate: serviceRequests === 0 ? 0 : serviceFailureCount / serviceRequests,
      latencyP50Ms: percentile(serviceValues, 0.5),
      latencyP95Ms: percentile(serviceValues, 0.95),
    };
  }
  return {
    requests,
    successes,
    failures,
    errorRate: requests === 0 ? 0 : failures / requests,
    latencyP50Ms: percentile(latencies, 0.5),
    latencyP95Ms: percentile(latencies, 0.95),
    byService,
    connectionPool: { ...input.pool },
    queue: { ...input.queue },
    inventory: { ...input.inventory },
  };
}
