import {
  DeterministicFaultScenario,
  FaultScenarioMetadata,
  FaultScenarioResult,
  FaultVerification,
} from "./types";

const CONCURRENT_REQUESTS = 8;
const HEALTHY_POOL_SIZE = 8;
const FAULTED_POOL_SIZE = 2;

/**
 * Models eight simultaneous requests against a two-connection pool. In the
 * treatment, acquired connections leak; in the control, each request releases
 * its connection. Acquisition is represented as a deterministic allocation,
 * rather than a real timer or database socket.
 */
export class PoolExhaustionScenario extends DeterministicFaultScenario {
  readonly metadata: FaultScenarioMetadata = {
    id: "fault-2-pool-exhaustion",
    version: "1.0.0",
    title: "Connection-pool leak under concurrency",
    summary: "A tiny two-connection pool and unreleased leases saturate under eight concurrent requests.",
    mechanism: "The treatment limits the pool to two connections and never releases acquired leases.",
    expectedSymptoms: [
      "connection acquisition timeouts",
      "pool remains saturated after the workload",
      "request failures under concurrency",
    ],
    groundTruth: {
      cause: "pool size is 2 for 8 concurrent requests and acquired connections leak",
      control: "an 8-connection pool releases every lease, so all 8 requests acquire successfully",
      treatment: "only 2 requests acquire a connection and the remaining 6 hit acquisition timeout",
      verification: "treatment has 6 acquisition timeouts and 2 leaked connections; control has 0 timeouts and 0 leaks",
    },
    verification: "Replay 8 concurrent requests; require treatment saturation with 6 acquisition failures and control completion of all 8.",
    rollback: "reset() restores pool size 8 and release-on-completion behavior.",
  };

  run(): FaultScenarioResult {
    const poolSize = this.isActive() ? FAULTED_POOL_SIZE : HEALTHY_POOL_SIZE;
    const acquiredRequests = Math.min(CONCURRENT_REQUESTS, poolSize);
    const acquisitionTimeouts = CONCURRENT_REQUESTS - acquiredRequests;
    const leakedConnections = this.isActive() ? acquiredRequests : 0;
    const releasedConnections = this.isActive() ? 0 : acquiredRequests;

    return {
      scenarioId: this.metadata.id,
      mode: this.mode,
      activated: this.isActive(),
      metrics: {
        poolSize,
        concurrentRequests: CONCURRENT_REQUESTS,
        acquiredRequests,
        acquisitionTimeouts,
        leakedConnections,
        releasedConnections,
        peakUtilization: acquiredRequests / poolSize,
        poolUtilizationAfterWorkload: leakedConnections / poolSize,
      },
      observations: [
        `${acquiredRequests}/${CONCURRENT_REQUESTS} requests acquired a connection`,
        `${acquisitionTimeouts} requests timed out while acquiring a connection`,
        `${leakedConnections} connections remain leased after workload completion`,
      ],
      symptomDetected: acquisitionTimeouts > 0 || leakedConnections > 0,
    };
  }

  verify(result: FaultScenarioResult): FaultVerification {
    const expectedTimeouts = result.mode === "treatment" ? 6 : 0;
    const expectedLeaks = result.mode === "treatment" ? 2 : 0;
    const passed =
      result.metrics.acquisitionTimeouts === expectedTimeouts &&
      result.metrics.leakedConnections === expectedLeaks &&
      result.metrics.acquiredRequests === (result.mode === "treatment" ? 2 : 8);
    return this.verification(
      result,
      passed,
      `expected ${expectedTimeouts} acquisition timeouts and ${expectedLeaks} leaks; ` +
        `observed ${result.metrics.acquisitionTimeouts} and ${result.metrics.leakedConnections}`,
    );
  }
}
