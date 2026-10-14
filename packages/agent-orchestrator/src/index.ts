import { createHash } from "node:crypto";
import { z } from "zod";
import {
  AgentRunSchema,
  EvidenceItemSchema,
  ExperimentResultSchema,
  ExperimentPlanSchema,
  HypothesisSchema,
  IncidentSchema,
  type AgentRun,
  type EvidenceItem,
  type ExperimentPlan,
  type Hypothesis,
  type Incident,
} from "@faultline/contracts";

const id = z.string().min(1).max(200);
const text = z.string().min(1).max(10_000);
const refList = z.array(id).max(1_000);
const measurements = z.record(z.union([z.number().finite(), z.string().max(1_000), z.boolean()]));

const strictIncident = IncidentSchema.strict();
const strictEvidence = EvidenceItemSchema.strict();
const strictPlan = ExperimentPlanSchema.strict();
const strictHypothesis = HypothesisSchema.extend({
  expectedSymptomChange: text,
  riskLevel: z.enum(["low", "medium", "high"]),
}).strict();

export const AgentRunReceiptSchema = AgentRunSchema.extend({
  latencyMs: z.number().int().min(0).max(86_400_000),
  error: z.string().max(10_000).optional(),
}).strict();
export type AgentRunReceipt = z.infer<typeof AgentRunReceiptSchema>;

export const ProposeHypothesesInputSchema = z.object({
  incident: strictIncident,
  evidence: z.array(strictEvidence).max(1_000),
  dependencySummary: z.string().max(20_000).optional(),
  sourceSummary: z.string().max(20_000).optional(),
  maxHypotheses: z.number().int().min(3).max(20).default(5),
}).strict();
export type ProposeHypothesesInput = z.input<typeof ProposeHypothesesInputSchema>;
export type ProposeHypothesesRequest = z.output<typeof ProposeHypothesesInputSchema>;

export const HypothesesOutputSchema = z.object({
  hypotheses: z.array(strictHypothesis).min(3).max(20),
}).strict();
export type HypothesesOutput = z.infer<typeof HypothesesOutputSchema>;

export const DesignExperimentInputSchema = z.object({
  incident: strictIncident,
  evidence: z.array(strictEvidence).max(1_000),
  hypothesis: strictHypothesis,
}).strict();
export type DesignExperimentInput = z.infer<typeof DesignExperimentInputSchema>;

export const ProposePatchInputSchema = z.object({
  incident: strictIncident,
  hypothesis: strictHypothesis,
  evidenceSummary: text,
  reproductionRecipe: text,
  relevantSourceFiles: z.array(id).max(100),
  existingTests: z.array(id).max(100),
  allowedPaths: z.array(id).max(100),
}).strict();
export type ProposePatchInput = z.infer<typeof ProposePatchInputSchema>;

export const PatchProposalSchema = z.object({
  diff: z.string().max(200_000),
  explanation: text,
  files: z.array(id).max(100),
  testsToRun: z.array(id).max(100),
}).strict();
export type PatchProposal = z.infer<typeof PatchProposalSchema>;

export const WriteReportInputSchema = z.object({
  incident: strictIncident,
  evidence: z.array(strictEvidence).max(1_000),
  hypotheses: z.array(strictHypothesis).min(1).max(20),
  experimentResults: z.array(ExperimentResultSchema.strict()).max(100),
  patch: PatchProposalSchema.optional(),
}).strict();
export type WriteReportInput = z.infer<typeof WriteReportInputSchema>;

export const ReportOutputSchema = z.object({
  markdown: text,
  citedEvidenceIds: refList,
  remainingUncertainty: text,
  rollbackPlan: text,
}).strict();
export type ReportOutput = z.infer<typeof ReportOutputSchema>;

export interface AgentAdapter {
  proposeHypotheses(input: ProposeHypothesesRequest): Promise<unknown>;
  designExperiment(input: DesignExperimentInput): Promise<unknown>;
  proposePatch(input: ProposePatchInput): Promise<unknown>;
  writeReport(input: WriteReportInput): Promise<unknown>;
}

export interface OrchestrationLimits {
  maxHypotheses?: number;
  maxRetries?: number;
  timeBudgetMs?: number;
}

const DEFAULT_LIMITS: Required<OrchestrationLimits> = {
  maxHypotheses: 5,
  maxRetries: 2,
  timeBudgetMs: 30_000,
};

export interface OrchestrationResult<T> {
  output: T;
  receipt: AgentRunReceipt;
}

type Role = "hypothesis" | "experiment-designer" | "patch" | "report";
type AdapterMethod<I, O> = (input: I) => Promise<unknown>;

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function estimateTokens(value: unknown): number {
  return Math.max(1, Math.ceil(JSON.stringify(value).length / 4));
}

function parseLimits(limits: OrchestrationLimits): Required<OrchestrationLimits> {
  const parsed = z.object({
    maxHypotheses: z.number().int().min(3).max(20).default(DEFAULT_LIMITS.maxHypotheses),
    maxRetries: z.number().int().min(0).max(5).default(DEFAULT_LIMITS.maxRetries),
    timeBudgetMs: z.number().int().min(1).max(86_400_000).default(DEFAULT_LIMITS.timeBudgetMs),
  }).parse(limits);
  return parsed;
}

function assertEvidenceReferences(input: { incident: Incident; evidence: EvidenceItem[] }, hypotheses: Hypothesis[]): void {
  const allowed = new Set([...input.incident.evidenceIds, ...input.evidence.map((item) => item.id)]);
  for (const hypothesis of hypotheses) {
    // Expected observations are prose, not IDs; only the explicit ID fields are checked.
    for (const evidenceId of [
      ...hypothesis.supportingEvidenceIds,
      ...hypothesis.contradictingEvidenceIds,
      ...hypothesis.resultEvidenceIds,
    ]) {
      if (!allowed.has(evidenceId)) throw new Error(`hypothesis ${hypothesis.id} references unsupplied evidence ID ${evidenceId}`);
    }
  }
}

function validateHypotheses(input: ProposeHypothesesRequest, value: unknown, maxHypotheses: number): HypothesesOutput {
  const parsed = HypothesesOutputSchema.parse(value);
  if (parsed.hypotheses.length > maxHypotheses) throw new Error(`adapter returned more than ${maxHypotheses} hypotheses`);
  for (const hypothesis of parsed.hypotheses) {
    if (hypothesis.incidentId !== input.incident.id) throw new Error(`hypothesis ${hypothesis.id} has the wrong incident ID`);
    if (hypothesis.experimentPlan.hypothesisId !== hypothesis.id) throw new Error(`experiment plan does not belong to ${hypothesis.id}`);
    if (hypothesis.experimentPlan.workloadId !== input.incident.workloadId) throw new Error(`hypothesis ${hypothesis.id} has the wrong workload ID`);
  }
  assertEvidenceReferences(input, parsed.hypotheses);
  return parsed;
}

const outputSchemas = {
  experiment: strictPlan,
  patch: PatchProposalSchema,
  report: ReportOutputSchema,
} as const;

export class AgentOrchestrator {
  readonly limits: Required<OrchestrationLimits>;

  constructor(private readonly adapter: AgentAdapter, limits: OrchestrationLimits = {}) {
    this.limits = parseLimits(limits);
  }

  async proposeHypotheses(input: ProposeHypothesesInput): Promise<OrchestrationResult<HypothesesOutput>> {
    const parsedInput = ProposeHypothesesInputSchema.parse({ ...input, maxHypotheses: input.maxHypotheses ?? this.limits.maxHypotheses });
    return this.invoke("hypothesis", parsedInput, this.adapter.proposeHypotheses.bind(this.adapter), (value) => validateHypotheses(parsedInput, value, this.limits.maxHypotheses));
  }

  async designExperiment(input: DesignExperimentInput): Promise<OrchestrationResult<ExperimentPlan>> {
    const parsedInput = DesignExperimentInputSchema.parse(input);
    const result = await this.invoke("experiment-designer", parsedInput, this.adapter.designExperiment.bind(this.adapter), (value) => {
      const plan = outputSchemas.experiment.parse(value);
      if (plan.hypothesisId !== parsedInput.hypothesis.id) throw new Error("experiment plan has the wrong hypothesis ID");
      if (plan.workloadId !== parsedInput.incident.workloadId) throw new Error("experiment plan has the wrong workload ID");
      return plan;
    });
    return result;
  }

  async proposePatch(input: ProposePatchInput): Promise<OrchestrationResult<PatchProposal>> {
    const parsedInput = ProposePatchInputSchema.parse(input);
    return this.invoke("patch", parsedInput, this.adapter.proposePatch.bind(this.adapter), (value) => {
      const patch = outputSchemas.patch.parse(value);
      const allowed = new Set(parsedInput.allowedPaths);
      if (patch.files.some((file) => !allowed.has(file))) throw new Error("patch includes a file outside allowed paths");
      return patch;
    });
  }

  async writeReport(input: WriteReportInput): Promise<OrchestrationResult<ReportOutput>> {
    const parsedInput = WriteReportInputSchema.parse(input);
    const result = await this.invoke("report", parsedInput, this.adapter.writeReport.bind(this.adapter), (value) => {
      const report = outputSchemas.report.parse(value);
      const allowed = new Set([...parsedInput.incident.evidenceIds, ...parsedInput.evidence.map((item) => item.id)]);
      if (report.citedEvidenceIds.some((evidenceId) => !allowed.has(evidenceId))) throw new Error("report cites unsupplied evidence ID");
      return report;
    });
    return result;
  }

  private async invoke<I, O>(role: Role, input: I, method: AdapterMethod<I, O>, validate: (value: unknown) => O): Promise<OrchestrationResult<O>> {
    const startedAt = new Date();
    const start = Date.now();
    const inputRef = digest(input);
    let retryCount = 0;
    let tokenUsage = estimateTokens(input);
    let lastError: unknown;
    while (retryCount <= this.limits.maxRetries) {
      const elapsed = Date.now() - start;
      if (elapsed >= this.limits.timeBudgetMs) break;
      try {
        const remaining = this.limits.timeBudgetMs - elapsed;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          const raw = await Promise.race([
            method(input),
            new Promise<never>((_, reject) => {
              timeout = setTimeout(() => reject(new Error("agent call timed out")), remaining);
            }),
          ]);
          const output = validate(raw);
          tokenUsage += estimateTokens(raw);
          const finishedAt = new Date();
          const receipt: AgentRunReceipt = AgentRunReceiptSchema.parse({
            id: `${role}-${inputRef.slice(7, 23)}`,
            incidentId: (input as { incident?: Incident }).incident?.id ?? "unknown",
            role,
            status: "completed",
            inputRef,
            outputRef: digest(output),
            startedAt: startedAt.toISOString(),
            finishedAt: finishedAt.toISOString(),
            tokenUsage,
            retryCount,
            latencyMs: Date.now() - start,
          });
          return { output, receipt };
        } finally {
          if (timeout !== undefined) clearTimeout(timeout);
        }
      } catch (error) {
        lastError = error;
        if (error instanceof Error && error.message === "agent call timed out") break;
        retryCount += 1;
      }
    }
    const timedOut = Date.now() - start >= this.limits.timeBudgetMs;
    const finishedAt = new Date();
    const receipt: AgentRunReceipt = AgentRunReceiptSchema.parse({
      id: `${role}-${inputRef.slice(7, 23)}`,
      incidentId: (input as { incident?: Incident }).incident?.id ?? "unknown",
      role,
      status: timedOut ? "timed_out" : "failed",
      inputRef,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      tokenUsage,
      retryCount: Math.min(retryCount, this.limits.maxRetries),
      latencyMs: Date.now() - start,
      error: lastError instanceof Error ? lastError.message : "agent call failed",
    });
    throw new AgentOrchestrationError(receipt);
  }
}

export class AgentOrchestrationError extends Error {
  constructor(readonly receipt: AgentRunReceipt) {
    super(`${receipt.role} agent ${receipt.status}: ${receipt.error ?? "unknown error"}`);
    this.name = "AgentOrchestrationError";
  }
}

const knownMechanisms: Record<string, { component: string; mechanism: string; title: string }> = {
  "fault-2-pool-exhaustion": { component: "database connection pool", mechanism: "Leaked connections exhaust a tiny pool and later requests cannot acquire a connection.", title: "Connection pool exhaustion from leaked handles" },
  "fault-4-timeout-mismatch": { component: "gateway to payments timeout", mechanism: "The caller timeout is shorter than the downstream payment operation, producing false timeouts while work completes.", title: "Caller timeout is shorter than payment latency" },
  "fault-5-oversell-race": { component: "inventory reservation", mechanism: "Concurrent check-then-act reservations observe the same stock before either write is committed.", title: "Non-atomic inventory check-then-act race" },
  "fault-6-poison-queue": { component: "work queue retry handling", mechanism: "A poison message consumes retries and keeps queue capacity occupied, blocking valid work.", title: "Poison message blocks queue progress" },
};

function mockPlan(input: ProposeHypothesesRequest, hypothesisId: string, question: string, variable: string): ExperimentPlan {
  return {
    id: `${hypothesisId}-experiment`, hypothesisId, question,
    controlCondition: { [variable]: "baseline" }, treatmentCondition: { [variable]: "isolated change" },
    workloadId: input.incident.workloadId, metrics: ["error_rate", "p95_latency"],
    expectedIfTrue: ["The incident symptom changes materially under the treatment."],
    expectedIfFalse: ["The incident symptom remains at the control level."], timeoutSeconds: 30,
    resourceLimits: { cpu: "1", memory: "256Mi" }, cleanupRequired: true,
  };
}

export function createMockAdapter(): AgentAdapter {
  return {
    async proposeHypotheses(input) {
      const known = input.incident.scenarioId ? knownMechanisms[input.incident.scenarioId] : undefined;
      const evidenceId = input.incident.evidenceIds[0] ?? input.evidence[0]?.id;
      const refs = evidenceId ? [evidenceId] : [];
      const candidates = [
        { title: "Upstream workload burst", component: "gateway", mechanism: "A burst of requests may exceed normal admission capacity.", variable: "request_rate", risk: "low" as const },
        { title: "Telemetry or retry amplification", component: "observability and retry layer", mechanism: "Retries or duplicate instrumentation may make the symptom appear larger than the underlying fault.", variable: "retry_policy", risk: "medium" as const },
        { title: known?.title ?? "Unknown mechanism requiring controlled experiment", component: known?.component ?? "undetermined component", mechanism: known?.mechanism ?? "The supplied evidence does not identify a known scenario; isolate one causal variable and measure the result.", variable: "scenario_condition", risk: "medium" as const },
      ];
      return { hypotheses: candidates.slice(0, input.maxHypotheses).map((candidate, index) => {
        const hypothesisId = `${input.incident.id}-h${index + 1}`;
        return {
          id: hypothesisId, incidentId: input.incident.id, title: candidate.title,
          suspectedComponent: candidate.component, mechanism: candidate.mechanism,
          supportingEvidenceIds: refs, contradictingEvidenceIds: [],
          predictions: ["The measured incident symptom changes when the candidate condition is isolated."],
          experimentPlan: mockPlan(input, hypothesisId, `Does ${candidate.title.toLowerCase()} explain the incident?`, candidate.variable),
          expectedSymptomChange: "Incident error rate or p95 latency should materially decrease when the condition is removed if true.",
          riskLevel: candidate.risk, confidence: known && index === 2 ? 0.7 : 0.25,
          status: "proposed" as const, resultEvidenceIds: [],
        };
      }) };
    },
    async designExperiment(input) { return mockPlan({ incident: input.incident, evidence: input.evidence, maxHypotheses: 3 }, input.hypothesis.id, `Test ${input.hypothesis.title}`, "candidate_condition"); },
    async proposePatch() { return { diff: "", explanation: "No patch is proposed until deterministic verification supports a cause.", files: [], testsToRun: [] }; },
    async writeReport(input) {
      return { markdown: `# ${input.incident.title}\n\n${input.hypotheses.length} competing hypotheses were considered.`, citedEvidenceIds: input.incident.evidenceIds.slice(0, 3), remainingUncertainty: "Agent confidence is advisory; deterministic experiments are required.", rollbackPlan: "Do not deploy an unverified patch; revert the candidate diff if verification fails." };
    },
  };
}

export type ProviderCall = (request: { role: Role; input: unknown; attempt: number }) => Promise<unknown>;

export function createLiveAdapter(call: ProviderCall): AgentAdapter {
  const invoke = (role: Role, input: unknown) => call({ role, input, attempt: 1 });
  return {
    proposeHypotheses: (input) => invoke("hypothesis", input),
    designExperiment: (input) => invoke("experiment-designer", input),
    proposePatch: (input) => invoke("patch", input),
    writeReport: (input) => invoke("report", input),
  };
}

export type { AgentRun, EvidenceItem, ExperimentPlan, Hypothesis, Incident };
