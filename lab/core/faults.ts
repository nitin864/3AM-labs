import type { FaultDefinition, FaultId } from "./types.js";

export const FAULT_DEFINITIONS: readonly FaultDefinition[] = [
  {
    id: "connection-pool-exhaustion",
    title: "Connection pool leak / exhaustion",
    description: "Orders retains each acquired database connection until the pool stops admitting requests.",
    service: "orders",
    groundTruthCause: "connections are not released after an order attempt",
    expectedSymptoms: ["pool utilization reaches 1", "connection acquisition timeouts", "orders errors"],
    verification: "pool timeouts and request failures return to zero after reset",
  },
  {
    id: "retry-storm",
    title: "Retry storm without backoff",
    description: "A payment failure is retried four times immediately for every order.",
    service: "orders",
    groundTruthCause: "unbounded immediate retries amplify a downstream payment failure",
    expectedSymptoms: ["payment attempts exceed requests", "queue retry count rises", "payment errors"],
    verification: "payment attempts return to one per request and retry amplification is zero",
  },
  {
    id: "timeout-too-short",
    title: "Timeout shorter than downstream latency",
    description: "Orders permits only 3ms while the legitimate payment operation takes 8ms.",
    service: "orders",
    groundTruthCause: "caller timeout is shorter than normal payment latency",
    expectedSymptoms: ["orders timeout errors", "payments complete while caller fails", "elevated p95 latency"],
    verification: "orders no longer reports false timeouts with the healthy timeout",
  },
  {
    id: "oversell-race",
    title: "Oversell race condition",
    description: "Concurrent inventory checks use a stale stock value and all decrement it.",
    service: "inventory",
    groundTruthCause: "inventory check and decrement are not atomic",
    expectedSymptoms: ["available stock becomes negative", "inventory invariant fails", "too many successful orders"],
    verification: "available_stock >= 0 after the concurrent workload",
  },
];

export const isFaultId = (value: string): value is FaultId =>
  FAULT_DEFINITIONS.some((fault) => fault.id === value);
