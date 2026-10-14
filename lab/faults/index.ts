import { FaultScenario, FaultScenarioId } from "./types";
import { PoolExhaustionScenario } from "./fault-2-pool-exhaustion";
import { TimeoutMismatchScenario } from "./fault-4-timeout-mismatch";
import { OversellRaceScenario } from "./fault-5-oversell-race";
import { PoisonQueueScenario } from "./fault-6-poison-queue";

export * from "./types";
export * from "./fault-2-pool-exhaustion";
export * from "./fault-4-timeout-mismatch";
export * from "./fault-5-oversell-race";
export * from "./fault-6-poison-queue";

/** Fresh instances prevent one experiment's activation from leaking into another. */
export function createFaultScenarios(): FaultScenario[] {
  return [
    new PoolExhaustionScenario(),
    new TimeoutMismatchScenario(),
    new OversellRaceScenario(),
    new PoisonQueueScenario(),
  ];
}

export function getFaultScenario(id: FaultScenarioId): FaultScenario {
  const scenario = createFaultScenarios().find((candidate) => candidate.metadata.id === id);
  if (!scenario) {
    throw new Error(`Unknown fault scenario: ${id}`);
  }
  return scenario;
}
