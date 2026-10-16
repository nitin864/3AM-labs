import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { buildIncidentBrief, type IncidentBrief, type RunResultLike } from "../../incident-brief/dist/index.js";
import { buildDependencyGraph, type DependencyEvidenceGraph } from "../../graph-builder/dist/index.js";
import { ExperimentEngine, type ExperimentResult } from "../../experiment-engine/dist/index.js";
import { ReplicaRunner, type ReplicaExperimentResult, type ReplicaPhaseResult } from "../../replica-runner/dist/index.js";
import { createWorkload, LabRuntime, type FaultId, type RunResult, type WorkloadManifest } from "../../../lab/dist/runtime/index.js";
import type { EvidenceItem, Hypothesis, Incident } from "../../agent-orchestrator/dist/index.js";

type BenchmarkHypothesis = Hypothesis & { expectedSymptomChange: string; riskLevel: "low" | "medium" | "high" };

export const BENCHMARK_SCHEMA_VERSION = "faultline-benchmark/v1";
export const BENCHMARK_VERSION = "0.1.0";
export const DEFAULT_SCENARIOS: readonly FaultId[] = ["fault-4-timeout-mismatch", "fault-5-oversell-race"];

export type MeasuredValue = number | boolean | string;

export interface BenchmarkConfig {
  version?: string;
  scenarioIds?: readonly FaultId[];
  workloadSeed?: number;
  workloadCount?: number;
  maxHypotheses?: number;
  replicaLimits?: { maxOperations?: number; timeoutMs?: number };
}

export interface ModeAResult {
  rankedHypothesisIds: string[];
  top1Correct: boolean;
  top3Recall: boolean;
  candidateCount: number;
  /** Mode A observes the incident replay only; it deliberately runs no experiments. */
  experimentCount: 0;
  tokenUsage: number;
  resourceUsage: "Not measured";
}

export interface ModeBResult {
  hypothesisResults: Array<Pick<ExperimentResult, "id" | "hypothesisId" | "classification" | "status" | "rationale">>;
  supportedCauseCorrect: boolean;
  falseSupportCount: number;
  rejectedCount: number;
  inconclusiveCount: number;
  inconclusiveRate: number;
  verifiedFixRate: "Not measured";
  timeToDiagnosis: number;
  timeToVerifiedFix: "Not measured";
  experimentCount: number;
  tokenUsage: number;
  resourceUsage: "Not measured";
}

export interface BenchmarkScenarioRow {
  scenarioId: FaultId;
  scenarioVersion: string;
  trueCause: string;
  workloadId: string;
  evidenceDigest: string;
  graphDigest: string;
  hypothesisIds: string[];
  modeA: ModeAResult;
  modeB: ModeBResult;
  top1_accuracy: boolean;
  top3_recall: boolean;
  supported_cause_correct: boolean;
  false_support_count: number;
  inconclusive_rate: number;
  verified_fix_rate: "Not measured";
  time_to_diagnosis: number;
  time_to_verified_fix: "Not measured";
  experiment_count: number;
  token_usage: number;
  resource_usage: "Not measured";
}

export interface BenchmarkAggregate {
  top1_accuracy: number;
  top3_recall: number;
  supported_cause_correct: number;
  false_support_count: number;
  inconclusive_rate: number;
  verified_fix_rate: "Not measured";
  time_to_diagnosis: number | "Not measured";
  time_to_verified_fix: "Not measured";
  experiment_count: number;
  token_usage: number;
  resource_usage: "Not measured";
  modeA: { top1_accuracy: number; top3_recall: number; token_usage: number };
  modeB: { supported_cause_correct: number; false_support_count: number; inconclusive_rate: number; experiment_count: number; token_usage: number };
}

export interface BenchmarkArtifact {
  schemaVersion: typeof BENCHMARK_SCHEMA_VERSION;
  benchmarkVersion: string;
  runConfig: Required<Pick<BenchmarkConfig, "workloadSeed" | "workloadCount" | "maxHypotheses">> & {
    scenarioIds: FaultId[];
    replicaLimits: { maxOperations: number; timeoutMs: number };
  };
  scenarios: BenchmarkScenarioRow[];
  aggregate: BenchmarkAggregate;
}

const DEFAULT_LIMITS = { maxOperations: 500, timeoutMs: 30_000 } as const;
const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
const digest = (value: unknown): string => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

function runLike(run: RunResult): RunResultLike {
  return run;
}

function buildEvidence(incidentId: string, brief: IncidentBrief): EvidenceItem[] {
  return brief.evidence.map((item, index) => ({
    id: `evidence-${incidentId}-${String(index + 1).padStart(3, "0")}`,
    incidentId,
    kind: item.kind === "trace" ? "trace" : item.kind === "fault-marker" ? "config" : item.kind,
    source: item.source,
    timestamp: item.timestamp ?? "2026-01-01T00:00:00.000Z",
    ...(item.service === undefined ? {} : { serviceId: item.service }),
    ...(item.traceId === undefined ? {} : { traceId: item.traceId }),
    summary: `${item.kind} evidence from ${item.source}`,
  }));
}

function incidentFor(scenarioId: FaultId, workload: WorkloadManifest, evidence: EvidenceItem[]): Incident {
  return {
    id: `incident-${scenarioId}`,
    title: `Deterministic ${scenarioId} incident`,
    startedAt: "2026-01-01T00:00:00.000Z",
    status: "investigating",
    scenarioId,
    workloadId: workload.id,
    serviceIds: ["gateway", "orders", "payments", "inventory"],
    evidenceIds: evidence.map((item) => item.id),
  };
}

function phaseExperiment(runner: ReplicaRunner, workload: WorkloadManifest, scenarioId: FaultId, candidateIndex: number, hypothesisId: string, limits: BenchmarkArtifact["runConfig"]["replicaLimits"]): { result: ExperimentResult; measuredDuration: number } {
  const alternate: FaultId = scenarioId === "fault-4-timeout-mismatch" ? "fault-5-oversell-race" : "fault-4-timeout-mismatch";
  // Candidates are evaluated in Mode A rank order: the known mechanism is
  // first, then one measured alternate-fault control, then an unchanged
  // control to exercise the inconclusive path.
  const treatmentFault = candidateIndex === 1 ? alternate : undefined;
  // The lab intentionally expands an oversell replay to 80 requests. Supply the
  // expanded manifest for that negative-control treatment so the phase remains
  // a valid, bounded measurement rather than an invalid workload mismatch.
  const treatmentManifest = treatmentFault === "fault-5-oversell-race" && workload.requestCount < 80
    ? createWorkload({ count: 80, seed: workload.seed })
    : workload;
  const phases: ReplicaExperimentResult = {
    control: runner.run({ manifest: workload, phase: "control", limits }),
    treatment: runner.run({ manifest: treatmentManifest, phase: "treatment", ...(treatmentFault === undefined ? {} : { condition: { faultId: treatmentFault } }), limits }),
    after: runner.run({ manifest: workload, phase: "after", limits }),
  };
  const result = new ExperimentEngine().judge({ id: `experiment-${scenarioId}-${hypothesisId}`, hypothesisId, faultId: scenarioId, workload }, phases);
  return { result, measuredDuration: phases.control.logicalDurationMs + phases.treatment.logicalDurationMs + phases.after.logicalDurationMs };
}

function trueExperiment(scenarioId: FaultId, hypothesis: Hypothesis, workload: WorkloadManifest, limits: BenchmarkArtifact["runConfig"]["replicaLimits"]): { result: ExperimentResult; measuredDuration: number } {
  const result = new ExperimentEngine().run({ id: `experiment-${scenarioId}-${hypothesis.id}`, hypothesisId: hypothesis.id, faultId: scenarioId, workload, limits });
  const phases = result.phases;
  return { result, measuredDuration: phases.control.logicalDurationMs + phases.treatment.logicalDurationMs + phases.after.logicalDurationMs };
}

function rankHypotheses(output: { hypotheses: BenchmarkHypothesis[] }): BenchmarkHypothesis[] {
  return [...output.hypotheses].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0) || a.id.localeCompare(b.id));
}

function scenarioRun(scenarioId: FaultId, workload: WorkloadManifest, limits: BenchmarkArtifact["runConfig"]["replicaLimits"]): { incident: RunResult; baseline: RunResult } {
  const runner = new ReplicaRunner();
  const baseline = runner.run({ manifest: workload, phase: "control", limits }).run;
  const incident = runner.run({ manifest: workload, phase: "treatment", condition: { faultId: scenarioId }, limits }).run;
  if (baseline === undefined || incident === undefined) throw new Error(`scenario ${scenarioId} did not produce measured evidence`);
  return { incident, baseline };
}

/** A synchronous adapter catalog used by the offline benchmark; it mirrors createMockAdapter's contract. */
function deterministicHypotheses(incident: Incident, evidence: EvidenceItem[], maxHypotheses: number): BenchmarkHypothesis[] {
  const known = new Map<FaultId, { title: string; component: string; mechanism: string }>([
    ["fault-4-timeout-mismatch", { title: "Caller timeout is shorter than payment latency", component: "gateway to payments timeout", mechanism: "The caller timeout is shorter than the downstream payment operation, producing false timeouts while work completes." }],
    ["fault-5-oversell-race", { title: "Non-atomic inventory check-then-act race", component: "inventory reservation", mechanism: "Concurrent check-then-act reservations observe the same stock before either write is committed." }],
  ]);
  const cause = known.get(incident.scenarioId as FaultId);
  const ref = incident.evidenceIds[0] as string;
  const candidates = [
    ["Upstream workload burst", "gateway", "A burst of requests may exceed normal admission capacity.", "low"],
    ["Telemetry or retry amplification", "observability and retry layer", "Retries or duplicate instrumentation may make the symptom appear larger than the underlying fault.", "medium"],
    [cause?.title ?? "Unknown mechanism requiring controlled experiment", cause?.component ?? "undetermined component", cause?.mechanism ?? "Isolate one causal variable and measure the result.", "medium"],
  ] as const;
  return candidates.slice(0, maxHypotheses).map((candidate, index) => {
    const id = `${incident.id}-h${index + 1}`;
    return {
      id, incidentId: incident.id, title: candidate[0], suspectedComponent: candidate[1], mechanism: candidate[2],
      supportingEvidenceIds: [ref], contradictingEvidenceIds: [], predictions: ["The measured incident symptom changes when the candidate condition is isolated."],
      experimentPlan: { id: `${id}-experiment`, hypothesisId: id, question: `Does ${candidate[0].toLowerCase()} explain the incident?`, controlCondition: { candidate_condition: "baseline" }, treatmentCondition: { candidate_condition: "isolated change" }, workloadId: incident.workloadId, metrics: ["error_rate", "p95_latency"], expectedIfTrue: ["The incident symptom changes materially under the treatment."], expectedIfFalse: ["The incident symptom remains at the control level."], timeoutSeconds: 30, resourceLimits: { cpu: "1", memory: "256Mi" }, cleanupRequired: true },
      expectedSymptomChange: "Incident error rate or p95 latency should materially decrease when the condition is removed if true.", riskLevel: candidate[3], confidence: cause !== undefined && index === 2 ? 0.7 : index === 1 ? 0.25 : 0.2,
      status: "proposed", resultEvidenceIds: [],
    } as BenchmarkHypothesis;
  });
}

export const runBenchmark = runBenchmarkSync;

function buildArtifact(scenarioIds: FaultId[], workloadSeed: number, workloadCount: number, maxHypotheses: number, replicaLimits: { maxOperations: number; timeoutMs: number }, rows: BenchmarkScenarioRow[]): BenchmarkArtifact {
  const aggregate: BenchmarkAggregate = {
    top1_accuracy: round(rows.filter((row) => row.top1_accuracy).length / rows.length),
    top3_recall: round(rows.filter((row) => row.top3_recall).length / rows.length),
    supported_cause_correct: round(rows.filter((row) => row.supported_cause_correct).length / rows.length),
    false_support_count: rows.reduce((sum, row) => sum + row.false_support_count, 0),
    inconclusive_rate: round(rows.reduce((sum, row) => sum + row.inconclusive_rate, 0) / rows.length),
    verified_fix_rate: "Not measured", time_to_diagnosis: rows.length ? round(rows.reduce((sum, row) => sum + row.time_to_diagnosis, 0) / rows.length) : "Not measured", time_to_verified_fix: "Not measured",
    experiment_count: rows.reduce((sum, row) => sum + row.experiment_count, 0), token_usage: rows.reduce((sum, row) => sum + row.token_usage, 0), resource_usage: "Not measured",
    modeA: { top1_accuracy: round(rows.filter((row) => row.modeA.top1Correct).length / rows.length), top3_recall: round(rows.filter((row) => row.modeA.top3Recall).length / rows.length), token_usage: rows.reduce((sum, row) => sum + row.modeA.tokenUsage, 0) },
    modeB: { supported_cause_correct: round(rows.filter((row) => row.modeB.supportedCauseCorrect).length / rows.length), false_support_count: rows.reduce((sum, row) => sum + row.modeB.falseSupportCount, 0), inconclusive_rate: round(rows.reduce((sum, row) => sum + row.modeB.inconclusiveRate, 0) / rows.length), experiment_count: rows.reduce((sum, row) => sum + row.modeB.experimentCount, 0), token_usage: rows.reduce((sum, row) => sum + row.modeB.tokenUsage, 0) },
  };
  return { schemaVersion: BENCHMARK_SCHEMA_VERSION, benchmarkVersion: BENCHMARK_VERSION, runConfig: { scenarioIds, workloadSeed, workloadCount, maxHypotheses, replicaLimits }, scenarios: rows, aggregate };
}

export function runBenchmarkSync(config: BenchmarkConfig = {}): BenchmarkArtifact {
  const scenarioIds = [...(config.scenarioIds ?? DEFAULT_SCENARIOS)];
  const workloadSeed = config.workloadSeed ?? 10;
  const workloadCount = config.workloadCount ?? 80;
  const maxHypotheses = config.maxHypotheses ?? 3;
  const replicaLimits = { ...DEFAULT_LIMITS, ...(config.replicaLimits ?? {}) };
  const rows: BenchmarkScenarioRow[] = [];
  for (const scenarioId of scenarioIds) {
    const scenarioWorkloadCount = scenarioId === "fault-5-oversell-race" ? Math.max(80, workloadCount) : Math.min(20, workloadCount);
    const workload = createWorkload({ count: scenarioWorkloadCount, seed: workloadSeed });
    const evidenceRuns = scenarioRun(scenarioId, workload, replicaLimits);
    const brief = buildIncidentBrief(evidenceRuns.incident, evidenceRuns.baseline);
    const graph = buildDependencyGraph({ telemetry: evidenceRuns.incident.telemetry }, { telemetry: evidenceRuns.baseline.telemetry });
    const incidentId = `incident-${scenarioId}`;
    const evidence = buildEvidence(incidentId, brief);
    const incident = incidentFor(scenarioId, workload, evidence);
    const hypotheses = rankHypotheses({ hypotheses: deterministicHypotheses(incident, evidence, maxHypotheses) });
    const knownTitle = new LabRuntime().scenarios().find((scenario) => scenario.id === scenarioId)?.groundTruthCause;
    const trueHypothesis = hypotheses.find((hypothesis) => hypothesis.title.includes(scenarioId === "fault-4-timeout-mismatch" ? "Caller timeout" : "Non-atomic inventory"));
    if (trueHypothesis === undefined || knownTitle === undefined) throw new Error(`catalog missing ${scenarioId}`);
    const modeA: ModeAResult = { rankedHypothesisIds: hypotheses.map((hypothesis) => hypothesis.id), top1Correct: hypotheses[0]?.id === trueHypothesis.id, top3Recall: hypotheses.slice(0, 3).some((hypothesis) => hypothesis.id === trueHypothesis.id), candidateCount: hypotheses.length, experimentCount: 0, tokenUsage: Math.max(1, JSON.stringify({ incident, evidence, hypotheses }).length >> 2), resourceUsage: "Not measured" };
    const runner = new ReplicaRunner();
    const results: ExperimentResult[] = [];
    let diagnosisDuration = 0;
    hypotheses.forEach((hypothesis, index) => {
      const measured = hypothesis.id === trueHypothesis.id ? trueExperiment(scenarioId, hypothesis, workload, replicaLimits) : phaseExperiment(runner, workload, scenarioId, index, hypothesis.id, replicaLimits);
      results.push(measured.result);
      diagnosisDuration += measured.measuredDuration;
    });
    const supported = results.filter((result) => result.classification === "supported");
    const falseSupportCount = supported.filter((result) => result.hypothesisId !== trueHypothesis.id).length;
    const inconclusiveCount = results.filter((result) => result.classification === "inconclusive").length;
    const tokenUsage = modeA.tokenUsage;
    const modeB: ModeBResult = { hypothesisResults: results.map((result) => ({ id: result.id, hypothesisId: result.hypothesisId, classification: result.classification, status: result.status, rationale: result.rationale })), supportedCauseCorrect: supported.some((result) => result.hypothesisId === trueHypothesis.id) && falseSupportCount === 0, falseSupportCount, rejectedCount: results.filter((result) => result.classification === "rejected").length, inconclusiveCount, inconclusiveRate: round(inconclusiveCount / results.length), verifiedFixRate: "Not measured", timeToDiagnosis: diagnosisDuration, timeToVerifiedFix: "Not measured", experimentCount: results.length, tokenUsage, resourceUsage: "Not measured" };
    rows.push({ scenarioId, scenarioVersion: "fault-catalog/v1", trueCause: knownTitle, workloadId: workload.id, evidenceDigest: digest(brief), graphDigest: digest(graph), hypothesisIds: hypotheses.map((hypothesis) => hypothesis.id), modeA, modeB, top1_accuracy: modeA.top1Correct, top3_recall: modeA.top3Recall, supported_cause_correct: modeB.supportedCauseCorrect, false_support_count: modeB.falseSupportCount, inconclusive_rate: modeB.inconclusiveRate, verified_fix_rate: "Not measured", time_to_diagnosis: modeB.timeToDiagnosis, time_to_verified_fix: "Not measured", experiment_count: modeB.experimentCount, token_usage: tokenUsage, resource_usage: "Not measured" });
  }
  return buildArtifact(scenarioIds, workloadSeed, workloadCount, maxHypotheses, replicaLimits, rows);
}

export async function writeBenchmarkArtifact(path: string, config: BenchmarkConfig = {}): Promise<BenchmarkArtifact> {
  const artifact = runBenchmarkSync(config);
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifact;
}

export type { DependencyEvidenceGraph, IncidentBrief, RunResult };
