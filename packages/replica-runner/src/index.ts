import {
  LabRuntime,
  type FaultId,
  type LabHealth,
  type MetricsSnapshot,
  type RunResult,
  type WorkloadManifest,
} from "../../../lab/dist/runtime/index.js";

export type ReplicaPhase = "control" | "treatment" | "after";

export interface ReplicaLimits {
  /** Maximum number of replayed requests in one phase. */
  maxOperations: number;
  /** Maximum deterministic (telemetry) milliseconds in one phase. */
  timeoutMs: number;
}

export const DEFAULT_REPLICA_LIMITS: Readonly<ReplicaLimits> = Object.freeze({
  maxOperations: 500,
  timeoutMs: 30_000,
});

export interface ReplicaCondition {
  /** Exactly one condition variable is supported: the LabRuntime fault. */
  faultId?: FaultId;
}

export interface ReplicaRunRequest {
  manifest: WorkloadManifest;
  phase: ReplicaPhase;
  condition?: ReplicaCondition;
  limits?: Partial<ReplicaLimits>;
}

export interface CleanupReceipt {
  attempted: true;
  resetCalled: boolean;
  healthyAfterReset: boolean;
  isolated: true;
  networkAccessed: false;
  hostCommandsRun: false;
  succeeded: boolean;
  error?: string;
}

export interface ReplicaPhaseResult {
  phase: ReplicaPhase;
  replicaId: string;
  condition: ReplicaCondition;
  run?: RunResult;
  metrics?: MetricsSnapshot;
  healthBefore: LabHealth;
  healthAfter: LabHealth;
  operationCount: number;
  logicalDurationMs: number;
  timedOut: boolean;
  workloadMatched: boolean;
  commandExitCode: number;
  error?: string;
  cleanup: CleanupReceipt;
}

export interface ReplicaExperimentResult {
  control: ReplicaPhaseResult;
  treatment: ReplicaPhaseResult;
  after: ReplicaPhaseResult;
}

function limitsFor(value?: Partial<ReplicaLimits>): ReplicaLimits {
  const limits = { ...DEFAULT_REPLICA_LIMITS, ...value };
  if (!Number.isInteger(limits.maxOperations) || limits.maxOperations < 1) {
    throw new Error("maxOperations must be a positive integer");
  }
  if (!Number.isFinite(limits.timeoutMs) || limits.timeoutMs < 1) {
    throw new Error("timeoutMs must be positive");
  }
  return limits;
}

function cloneManifest(manifest: WorkloadManifest): WorkloadManifest {
  return JSON.parse(JSON.stringify(manifest)) as WorkloadManifest;
}

function sameManifest(left: WorkloadManifest, right: WorkloadManifest): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Runs only deterministic, in-memory LabRuntime replicas. There is deliberately
 * no shell, socket, container, filesystem, or wall-clock operation here.
 */
export class ReplicaRunner {
  private sequence = 0;

  run(request: ReplicaRunRequest): ReplicaPhaseResult {
    const limits = limitsFor(request.limits);
    const manifest = cloneManifest(request.manifest);
    const conditionKeys = request.condition === undefined ? [] : Object.keys(request.condition);
    if (conditionKeys.some((key) => key !== "faultId")) {
      throw new Error("only the faultId condition variable may be changed");
    }
    if (manifest.requestCount !== manifest.requests.length) {
      throw new Error("workload manifest requestCount does not match requests");
    }
    if (manifest.requestCount > limits.maxOperations) {
      return this.budgetResult(request.phase, request.condition ?? {}, manifest, limits,
        "operation budget exceeded before replay");
    }

    const replicaId = `replica-${String(++this.sequence).padStart(6, "0")}`;
    const runtime = new LabRuntime();
    let healthBefore = runtime.health();
    let run: RunResult | undefined;
    let error: string | undefined;
    let commandExitCode = 0;
    let timedOut = false;
    try {
      runtime.start();
      healthBefore = runtime.health();
      if (healthBefore.status !== "healthy") throw new Error("fresh replica is unhealthy");
      if (request.condition?.faultId !== undefined) runtime.activateFault(request.condition.faultId);
      const result = runtime.runWorkload({ manifest });
      run = result.run;
      const logicalDurationMs = durationMs(run);
      const operationCount = run.outcomes.length;
      timedOut = logicalDurationMs > limits.timeoutMs || operationCount > limits.maxOperations;
      if (timedOut) commandExitCode = 124;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      commandExitCode = 1;
    }

    const operationCount = run?.outcomes.length ?? 0;
    const logicalDurationMs = run === undefined ? 0 : durationMs(run);
    const metrics = run?.metrics;
    const cleanup = this.cleanup(runtime);
    const healthAfter = runtime.health();
    if (!cleanup.succeeded && commandExitCode === 0) commandExitCode = 1;
    if (cleanup.succeeded === false && error === undefined) error = cleanup.error;
    return {
      phase: request.phase,
      replicaId,
      condition: { ...(request.condition?.faultId === undefined ? {} : { faultId: request.condition.faultId }) },
      ...(run === undefined ? {} : { run }),
      ...(metrics === undefined ? {} : { metrics }),
      healthBefore,
      healthAfter,
      operationCount,
      logicalDurationMs,
      timedOut,
      workloadMatched: run === undefined ? false : sameManifest(run.workload, manifest),
      commandExitCode,
      ...(error === undefined ? {} : { error }),
      cleanup,
    };
  }

  runExperiment(manifest: WorkloadManifest, treatment: FaultId, limits?: Partial<ReplicaLimits>): ReplicaExperimentResult {
    // Every phase gets a disposable runtime. The after phase is an independent
    // reset check, which prevents a failed cleanup from contaminating evidence.
    const optionalLimits = limits === undefined ? {} : { limits };
    return {
      control: this.run({ manifest, phase: "control", ...optionalLimits }),
      treatment: this.run({ manifest, phase: "treatment", condition: { faultId: treatment }, ...optionalLimits }),
      after: this.run({ manifest, phase: "after", ...optionalLimits }),
    };
  }

  private budgetResult(phase: ReplicaPhase, condition: ReplicaCondition, manifest: WorkloadManifest,
    limits: ReplicaLimits, error: string): ReplicaPhaseResult {
    const runtime = new LabRuntime();
    const healthBefore = runtime.health();
    const cleanup = this.cleanup(runtime);
    return {
      phase,
      replicaId: `replica-${String(++this.sequence).padStart(6, "0")}`,
      condition,
      healthBefore,
      healthAfter: runtime.health(),
      operationCount: 0,
      logicalDurationMs: 0,
      timedOut: true,
      workloadMatched: false,
      commandExitCode: 124,
      error,
      cleanup,
    };
  }

  private cleanup(runtime: LabRuntime): CleanupReceipt {
    try {
      runtime.reset();
      const healthyAfterReset = runtime.health().status === "healthy" && runtime.health().activeFault === undefined;
      return {
        attempted: true,
        resetCalled: true,
        healthyAfterReset,
        isolated: true,
        networkAccessed: false,
        hostCommandsRun: false,
        succeeded: healthyAfterReset,
        ...(healthyAfterReset ? {} : { error: "replica did not return to a clean state" }),
      };
    } catch (caught) {
      return {
        attempted: true,
        resetCalled: true,
        healthyAfterReset: false,
        isolated: true,
        networkAccessed: false,
        hostCommandsRun: false,
        succeeded: false,
        error: caught instanceof Error ? caught.message : String(caught),
      };
    }
  }
}

function durationMs(run: RunResult): number {
  const starts = run.telemetry.spans.map((span) => span.startTime);
  if (starts.length === 0) return 0;
  const first = Date.parse(starts[0] ?? run.startedAt);
  const last = Date.parse(run.finishedAt);
  return Number.isFinite(first) && Number.isFinite(last) ? Math.max(0, last - first) : 0;
}

export type { FaultId, LabHealth, MetricsSnapshot, RunResult, WorkloadManifest };
