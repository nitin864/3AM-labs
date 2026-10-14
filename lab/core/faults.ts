import type { FaultDefinition, FaultId } from "./types.js";

export const FAULT_DEFINITIONS: readonly FaultDefinition[] = [
  {
    id: "fault-2-pool-exhaustion",
    title: "Connection pool leak / exhaustion",
    description: "Orders retains each acquired database connection until the pool stops admitting requests.",
    service: "orders",
    groundTruthCause: "connections are not released after an order attempt",
    expectedSymptoms: ["pool utilization reaches 1", "connection acquisition timeouts", "orders errors"],
    verification: "pool timeouts and request failures return to zero after reset",
  },
  {
    id: "fault-4-timeout-mismatch",
    title: "Timeout shorter than normal downstream latency",
    description: "The caller timeout is shorter than the legitimate payment latency distribution.",
    service: "orders",
    groundTruthCause: "the payment caller timeout is 150ms while downstream p95 is 220ms",
    expectedSymptoms: ["caller timeout errors", "downstream operations complete", "latency/error mismatch"],
    verification: "false timeout failures fall to zero with a 250ms caller timeout",
  },
  {
    id: "fault-5-oversell-race",
    title: "Oversell race condition",
    description: "Concurrent inventory checks use a stale stock value and all decrement it.",
    service: "inventory",
    groundTruthCause: "inventory check and decrement are not atomic",
    expectedSymptoms: ["available stock becomes negative", "inventory invariant fails", "too many successful orders"],
    verification: "available_stock >= 0 after the concurrent workload",
  },
  {
    id: "fault-6-poison-queue",
    title: "Poison queue message",
    description: "An unhandled malformed message blocks the worker from draining valid work.",
    service: "orders",
    groundTruthCause: "the worker retries a poison payload without dead-letter handling",
    expectedSymptoms: ["queue depth remains elevated", "poison retries increase", "valid messages do not drain"],
    verification: "reset drains valid messages and leaves no poison retry loop",
  },
];

export const isFaultId = (value: string): value is FaultId =>
  FAULT_DEFINITIONS.some((fault) => fault.id === value);
