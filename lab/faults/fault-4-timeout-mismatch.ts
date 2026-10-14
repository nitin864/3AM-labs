import {
  DeterministicFaultScenario,
  FaultScenarioMetadata,
  FaultScenarioResult,
  FaultVerification,
} from "./types";

const DOWNSTREAM_LATENCIES_MS = [
  180, 190, 200, 205, 210, 215, 218, 219, 220, 220,
  220, 220, 220, 220, 220, 220, 220, 220, 220, 220,
] as const;

/**
 * Caller timeout is shorter than the known-good downstream p95 (220 ms).
 * Latency is a fixed trace sample, so no wall-clock sleep is required.
 */
export class TimeoutMismatchScenario extends DeterministicFaultScenario {
  readonly metadata: FaultScenarioMetadata = {
    id: "fault-4-timeout-mismatch",
    version: "1.0.0",
    title: "Payment caller timeout shorter than legitimate downstream latency",
    summary: "A 150 ms payment caller timeout rejects a downstream payment operation whose p95 is 220 ms.",
    mechanism: "The payment caller deadline is below the downstream operation's measured latency distribution.",
    expectedSymptoms: [
      "caller timeout failures",
      "downstream operations complete after the caller has failed",
      "latency/error mismatch across the service boundary",
    ],
    groundTruth: {
      cause: "payment caller timeout is 150 ms while legitimate downstream payment p95 is 220 ms",
      control: "with the fault reset, a 250 ms timeout completes every replayed operation",
      treatment: "with the fault active, every operation exceeding 150 ms is a false caller timeout",
      verification: "treatment has 20 caller timeouts and downstream completions; control has zero timeouts",
    },
    verification: "Compare timeout count against the fixed 20-request latency trace; require 20 treatment timeouts and 0 control timeouts.",
    rollback: "reset() restores a 250 ms caller timeout without changing the downstream latency trace.",
  };

  run(): FaultScenarioResult {
    const callerTimeoutMs = this.isActive() ? 150 : 250;
    const downstreamP95Ms = percentile95(DOWNSTREAM_LATENCIES_MS);
    const timedOutRequests = DOWNSTREAM_LATENCIES_MS.filter(
      (latency) => latency > callerTimeoutMs,
    ).length;
    const completedDownstreamRequests = DOWNSTREAM_LATENCIES_MS.length;

    return {
      scenarioId: this.metadata.id,
      mode: this.mode,
      activated: this.isActive(),
      metrics: {
        callerTimeoutMs,
        downstreamP95Ms,
        replayedRequests: DOWNSTREAM_LATENCIES_MS.length,
        timedOutRequests,
        completedDownstreamRequests,
        falseTimeoutRate: timedOutRequests / DOWNSTREAM_LATENCIES_MS.length,
      },
      observations: [
        `downstream p95=${downstreamP95Ms}ms`,
        `caller timeout=${callerTimeoutMs}ms`,
        `${timedOutRequests}/${DOWNSTREAM_LATENCIES_MS.length} caller operations timed out`,
        `${completedDownstreamRequests}/${DOWNSTREAM_LATENCIES_MS.length} downstream operations completed`,
      ],
      symptomDetected: timedOutRequests > 0,
    };
  }

  verify(result: FaultScenarioResult): FaultVerification {
    const expectedTimeouts = result.mode === "treatment" ? 20 : 0;
    const passed =
      result.metrics.downstreamP95Ms === 220 &&
      result.metrics.completedDownstreamRequests === 20 &&
      result.metrics.timedOutRequests === expectedTimeouts;
    return this.verification(
      result,
      passed,
      `expected ${expectedTimeouts} caller timeouts, observed ${result.metrics.timedOutRequests}; ` +
        `downstream p95=${result.metrics.downstreamP95Ms}ms`,
    );
  }
}

function percentile95(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[index] ?? 0;
}
