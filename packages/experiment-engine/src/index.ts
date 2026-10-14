import {
  ReplicaRunner,
  type ReplicaExperimentResult,
  type ReplicaLimits,
  type WorkloadManifest,
  type FaultId,
} from "../../replica-runner/dist/index.js";

export type Classification = "supported" | "rejected" | "inconclusive";

export interface ExperimentInput {
  id: string;
  hypothesisId: string;
  faultId: FaultId;
  workload: WorkloadManifest;
  /** The only mutable treatment variable. Control must be empty or omitted. */
  controlCondition?: Record<string, unknown>;
  treatmentCondition?: { faultId: FaultId };
  limits?: Partial<ReplicaLimits>;
}

export interface ExperimentMeasurements extends Record<string, number | string | boolean> {
  requests: number;
  successes: number;
  failures: number;
  errorRate: number;
  healthy: boolean;
  timedOut: boolean;
  workloadMatched: boolean;
  cleanupSucceeded: boolean;
  [key: string]: number | string | boolean;
}

export interface ExperimentResult {
  id: string;
  hypothesisId: string;
  status: "passed" | "failed" | "inconclusive";
  controlMeasurements: ExperimentMeasurements;
  treatmentMeasurements: ExperimentMeasurements;
  afterMeasurements: ExperimentMeasurements;
  commandExitCodes: number[];
  evaluatorRule: string;
  classification: Classification;
  rationale: string;
  cleanupSucceeded: boolean;
  evidenceIds: string[];
  phases: ReplicaExperimentResult;
}

const SUPPORTED_FAULTS = new Set<FaultId>([
  "fault-4-timeout-mismatch",
  "fault-5-oversell-race",
]);

const RULE = "healthy control; valid treatment reproduces the fault prediction; valid reset/after removes it";

export function validateExperimentInput(input: ExperimentInput): void {
  if (!input.id || !input.hypothesisId) throw new Error("experiment id and hypothesisId are required");
  if (!SUPPORTED_FAULTS.has(input.faultId)) throw new Error(`unsupported experiment fault: ${input.faultId}`);
  if (input.workload.requestCount !== input.workload.requests.length) {
    throw new Error("workload manifest requestCount does not match requests");
  }
  if ((input.controlCondition && Object.keys(input.controlCondition).length > 0)) {
    throw new Error("controlCondition must be empty: only one treatment variable is allowed");
  }
  if (input.treatmentCondition !== undefined && input.treatmentCondition.faultId !== input.faultId) {
    throw new Error("treatmentCondition must contain exactly the requested faultId");
  }
}

/** Execute a bounded experiment and classify it using only measured values. */
export class ExperimentEngine {
  constructor(private readonly runner = new ReplicaRunner()) {}

  run(input: ExperimentInput): ExperimentResult {
    validateExperimentInput(input);
    const phases = this.runner.runExperiment(input.workload, input.faultId, input.limits);
    return this.judge(input, phases);
  }

  /** Pure judge entry point; it performs no replay and has no clock or I/O. */
  judge(input: ExperimentInput, phases: ReplicaExperimentResult): ExperimentResult {
    validateExperimentInput(input);
    const control = measurements(phases.control);
    const treatment = measurements(phases.treatment);
    const after = measurements(phases.after);
    const allCleanupSucceeded = phases.control.cleanup.succeeded && phases.treatment.cleanup.succeeded && phases.after.cleanup.succeeded;
    const allExitCodes = [phases.control.commandExitCode, phases.treatment.commandExitCode, phases.after.commandExitCode];
    const base = {
      id: input.id,
      hypothesisId: input.hypothesisId,
      controlMeasurements: control,
      treatmentMeasurements: treatment,
      afterMeasurements: after,
      commandExitCodes: allExitCodes,
      evaluatorRule: RULE,
      cleanupSucceeded: allCleanupSucceeded,
      evidenceIds: [] as string[],
      phases,
    };

    if (!validControl(phases, input.faultId)) return { ...base, status: "inconclusive", classification: "inconclusive", rationale: "control replica was unhealthy, timed out, incomplete, or cleanup failed" };
    if (!allCleanupSucceeded || !validPhase(phases.treatment) || !validPhase(phases.after)) {
      return { ...base, status: "inconclusive", classification: "inconclusive", rationale: "treatment/after timed out, lacked metrics, or cleanup failed" };
    }
    if (!discriminates(control, treatment)) {
      return { ...base, status: "inconclusive", classification: "inconclusive", rationale: "control and treatment measurements did not discriminate the hypothesis" };
    }

    const symptom = predictedSymptom(input.faultId, treatment);
    const removed = symptom && resetRemoved(input.faultId, after);
    if (symptom && removed) return { ...base, status: "passed", classification: "supported", rationale: "treatment reproduced the predicted measured symptom and reset removed it" };
    if (!symptom) return { ...base, status: "failed", classification: "rejected", rationale: "valid controlled treatment contradicted the predicted symptom" };
    return { ...base, status: "failed", classification: "rejected", rationale: "treatment symptom remained after the condition was removed" };
  }
}

export function runExperiment(input: ExperimentInput): ExperimentResult {
  return new ExperimentEngine().run(input);
}

function validControl(phases: ReplicaExperimentResult, fault: FaultId): boolean {
  if (!validPhase(phases.control)) return false;
  // Oversell uses an over-demand workload by design. Rejected excess orders
  // are expected in its healthy atomic control; infrastructure and inventory
  // invariants must still remain healthy.
  if (fault === "fault-5-oversell-race") {
    const metrics = phases.control.metrics;
    return metrics?.inventory.invariantHolds === true && metrics.connectionPool.timeouts === 0;
  }
  return phases.control.run?.healthy === true;
}

function validPhase(phase: ReplicaExperimentResult["control"]): boolean {
  return phase.commandExitCode === 0 && !phase.timedOut && phase.metrics !== undefined &&
    phase.workloadMatched && phase.cleanup.succeeded && phase.healthBefore.status === "healthy" &&
    phase.healthAfter.status === "healthy";
}

function measurements(phase: ReplicaExperimentResult["control"]): ExperimentMeasurements {
  const metrics = phase.metrics;
  const outcomes = phase.run?.outcomes ?? [];
  const values: ExperimentMeasurements = {
    requests: metrics?.requests ?? 0,
    successes: metrics?.successes ?? 0,
    failures: metrics?.failures ?? 0,
    errorRate: metrics?.errorRate ?? 0,
    healthy: phase.run?.healthy === true,
    timedOut: phase.timedOut,
    workloadMatched: phase.workloadMatched,
    cleanupSucceeded: phase.cleanup.succeeded,
  };
  if (metrics !== undefined) {
    values.poolTimeouts = metrics.connectionPool.timeouts;
    values.queueDepth = metrics.queue.depth;
    values.inventoryAvailableStock = metrics.inventory.availableStock;
    values.inventoryNegativeStock = metrics.inventory.negativeStock;
    values.inventoryInvariantHolds = metrics.inventory.invariantHolds;
    values.downstreamP95Ms = metrics.byService.payments?.latencyP95Ms ?? 0;
  }
  const timedOutRequests = outcomes.filter((outcome) => outcome.errorType === "downstream_timeout").length;
  values.timedOutRequests = timedOutRequests;
  values.completedDownstreamRequests = outcomes.length;
  values.falseTimeoutRate = outcomes.length === 0 ? 0 : timedOutRequests / outcomes.length;
  return values;
}

function predictedSymptom(fault: FaultId, treatment: ExperimentMeasurements): boolean {
  if (fault === "fault-4-timeout-mismatch") return numberValue(treatment.timedOutRequests) > 0 && numberValue(treatment.completedDownstreamRequests) === numberValue(treatment.requests);
  if (fault === "fault-5-oversell-race") return treatment.inventoryNegativeStock === true && treatment.inventoryInvariantHolds === false;
  return false;
}

function resetRemoved(fault: FaultId, after: ExperimentMeasurements): boolean {
  if (fault === "fault-4-timeout-mismatch") return numberValue(after.timedOutRequests) === 0 && after.healthy === true;
  if (fault === "fault-5-oversell-race") return after.inventoryNegativeStock === false && after.inventoryInvariantHolds === true;
  return false;
}

function numberValue(value: number | string | boolean | undefined): number {
  return typeof value === "number" ? value : Number.NaN;
}

function discriminates(control: ExperimentMeasurements, treatment: ExperimentMeasurements): boolean {
  const keys = ["timedOutRequests", "falseTimeoutRate", "inventoryAvailableStock", "inventoryNegativeStock", "inventoryInvariantHolds", "successes", "failures"];
  return keys.some((key) => control[key] !== treatment[key]);
}

export type { FaultId, ReplicaExperimentResult, ReplicaLimits, WorkloadManifest };
