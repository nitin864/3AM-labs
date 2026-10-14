/**
 * Shared contract for deterministic Faultline fault scenarios.
 *
 * Scenarios intentionally model the scheduling/resource decisions that make a
 * fault reproducible. They do not use wall-clock time or external services;
 * the lab runtime can therefore run the same experiment locally and in a
 * disposable replica adapter.
 */

export type FaultScenarioId =
  | "fault-2-pool-exhaustion"
  | "fault-4-timeout-mismatch"
  | "fault-5-oversell-race"
  | "fault-6-poison-queue";

export interface FaultGroundTruth {
  /** The deliberately injected condition, not an inference from telemetry. */
  cause: string;
  /** What the reset/healthy run is expected to demonstrate. */
  control: string;
  /** What the active run is expected to demonstrate. */
  treatment: string;
  /** Deterministic rule used by the evaluator. */
  verification: string;
}

export interface FaultScenarioMetadata {
  id: FaultScenarioId;
  version: string;
  title: string;
  summary: string;
  mechanism: string;
  expectedSymptoms: readonly string[];
  groundTruth: FaultGroundTruth;
  /** Explicit description suitable for the incident/evidence report. */
  verification: string;
  /** How the scenario returns to its healthy control condition. */
  rollback: string;
}

export type FaultRunMode = "control" | "treatment";

export interface FaultScenarioResult {
  scenarioId: FaultScenarioId;
  mode: FaultRunMode;
  activated: boolean;
  /** Values collected by the deterministic workload, never fabricated. */
  metrics: Readonly<Record<string, number>>;
  observations: readonly string[];
  symptomDetected: boolean;
}

export interface FaultVerification {
  passed: boolean;
  rule: string;
  details: string;
}

export interface FaultScenario {
  readonly metadata: FaultScenarioMetadata;
  activate(): void;
  /** Restore the scenario's healthy control condition and clear its state. */
  reset(): void;
  /** Alias used by runtimes that call restoration a rollback. */
  rollback(): void;
  isActive(): boolean;
  run(): FaultScenarioResult;
  verify(result: FaultScenarioResult): FaultVerification;
}

export abstract class DeterministicFaultScenario implements FaultScenario {
  abstract readonly metadata: FaultScenarioMetadata;

  private active = false;

  activate(): void {
    this.active = true;
  }

  reset(): void {
    this.active = false;
  }

  rollback(): void {
    this.reset();
  }

  isActive(): boolean {
    return this.active;
  }

  protected get mode(): FaultRunMode {
    return this.active ? "treatment" : "control";
  }

  abstract run(): FaultScenarioResult;

  abstract verify(result: FaultScenarioResult): FaultVerification;

  protected verification(
    result: FaultScenarioResult,
    passed: boolean,
    details: string,
  ): FaultVerification {
    return {
      passed,
      rule: result.mode === "treatment"
        ? this.metadata.groundTruth.treatment
        : this.metadata.groundTruth.control,
      details,
    };
  }
}
