import { z } from "zod";

const id = z.string().min(1).max(200);
const shortText = z.string().min(1).max(5000);
const timestamp = z.string().datetime({ offset: true });
const boundedStringArray = z.array(shortText).max(1000);
const referenceArray = z.array(id).max(1000);

const measurement = z.union([
  z.number().finite(),
  z.string().max(1000),
  z.boolean(),
]);

const numericMeasurement = z.union([z.number().finite(), z.string().max(1000)]);

const incidentStatuses = [
  "collecting",
  "investigating",
  "verifying",
  "completed",
  "inconclusive",
  "failed",
] as const;

const evidenceKinds = [
  "log",
  "trace",
  "metric",
  "deployment",
  "test",
  "experiment",
  "config",
  "workload",
] as const;

const hypothesisStatuses = [
  "proposed",
  "queued",
  "testing",
  "supported",
  "rejected",
  "inconclusive",
] as const;

const experimentStatuses = [
  "queued",
  "running",
  "passed",
  "failed",
  "inconclusive",
  "cancelled",
  "error",
] as const;

const classifications = ["supported", "rejected", "inconclusive"] as const;
const patchStatuses = ["verified", "rejected", "inconclusive"] as const;
const agentStatuses = ["queued", "running", "completed", "failed", "timed_out"] as const;

export const IncidentSchema = z.object({
  id,
  title: z.string().min(1).max(500),
  startedAt: timestamp,
  endedAt: timestamp.optional(),
  status: z.enum(incidentStatuses),
  scenarioId: id.optional(),
  workloadId: id,
  serviceIds: referenceArray,
  evidenceIds: referenceArray,
  summary: z.string().max(10000).optional(),
});

export type Incident = z.infer<typeof IncidentSchema>;
export const incidentSchema = IncidentSchema;

export const EvidenceItemSchema = z.object({
  id,
  incidentId: id,
  kind: z.enum(evidenceKinds),
  source: z.string().min(1).max(1000),
  timestamp,
  serviceId: id.optional(),
  traceId: z.string().min(1).max(500).optional(),
  summary: z.string().min(1).max(10000),
  structuredData: z.record(z.unknown()).optional(),
  artifactRef: z.string().min(1).max(2000).optional(),
});

export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;
export const evidenceItemSchema = EvidenceItemSchema;

export const ExperimentPlanSchema = z.object({
  id,
  hypothesisId: id,
  question: shortText,
  controlCondition: z.record(z.unknown()),
  treatmentCondition: z.record(z.unknown()),
  workloadId: id,
  metrics: z.array(id).min(1).max(100),
  expectedIfTrue: boundedStringArray,
  expectedIfFalse: boundedStringArray,
  timeoutSeconds: z.number().int().min(1).max(86400),
  resourceLimits: z.object({
    cpu: z.string().min(1).max(100).optional(),
    memory: z.string().min(1).max(100).optional(),
  }),
  cleanupRequired: z.literal(true),
});

export type ExperimentPlan = z.infer<typeof ExperimentPlanSchema>;
export const experimentPlanSchema = ExperimentPlanSchema;

export const HypothesisSchema = z.object({
  id,
  incidentId: id,
  title: z.string().min(1).max(500),
  suspectedComponent: z.string().min(1).max(500),
  mechanism: shortText,
  supportingEvidenceIds: referenceArray,
  contradictingEvidenceIds: referenceArray,
  predictions: boundedStringArray,
  experimentPlan: ExperimentPlanSchema,
  confidence: z.number().finite().min(0).max(1).optional(),
  status: z.enum(hypothesisStatuses),
  resultEvidenceIds: referenceArray,
});

export type Hypothesis = z.infer<typeof HypothesisSchema>;
export const hypothesisSchema = HypothesisSchema;

export const ExperimentResultSchema = z.object({
  id,
  hypothesisId: id,
  status: z.enum(experimentStatuses),
  startedAt: timestamp.optional(),
  finishedAt: timestamp.optional(),
  controlMeasurements: z.record(measurement),
  treatmentMeasurements: z.record(measurement),
  commandExitCodes: z.array(z.number().int().min(-255).max(255)).max(100),
  evidenceIds: referenceArray,
  evaluatorRule: shortText,
  classification: z.enum(classifications),
  rationale: shortText,
  cleanupSucceeded: z.boolean(),
});

export type ExperimentResult = z.infer<typeof ExperimentResultSchema>;
export const experimentResultSchema = ExperimentResultSchema;

export const PatchVerificationSchema = z.object({
  id,
  incidentId: id,
  hypothesisId: id,
  diffRef: z.string().min(1).max(2000).optional(),
  buildPassed: z.boolean(),
  testsPassed: z.boolean(),
  testIntegrityPassed: z.boolean(),
  replayPassed: z.boolean(),
  healthChecksPassed: z.boolean(),
  baselineMeasurements: z.record(numericMeasurement),
  incidentMeasurements: z.record(numericMeasurement),
  patchedMeasurements: z.record(numericMeasurement),
  status: z.enum(patchStatuses),
  failureReasons: boundedStringArray,
});

export type PatchVerification = z.infer<typeof PatchVerificationSchema>;
export const patchVerificationSchema = PatchVerificationSchema;

export const AgentRunSchema = z.object({
  id,
  incidentId: id,
  role: z.string().min(1).max(200),
  status: z.enum(agentStatuses),
  inputRef: z.string().min(1).max(2000),
  outputRef: z.string().min(1).max(2000).optional(),
  startedAt: timestamp.optional(),
  finishedAt: timestamp.optional(),
  tokenUsage: z.number().int().min(0).max(100000000).optional(),
  retryCount: z.number().int().min(0).max(100),
  error: z.string().max(10000).optional(),
});

export type AgentRun = z.infer<typeof AgentRunSchema>;
export const agentRunSchema = AgentRunSchema;

export const parseIncident = (value: unknown): Incident => IncidentSchema.parse(value);
export const safeParseIncident = (value: unknown) => IncidentSchema.safeParse(value);
export const parseEvidenceItem = (value: unknown): EvidenceItem => EvidenceItemSchema.parse(value);
export const safeParseEvidenceItem = (value: unknown) => EvidenceItemSchema.safeParse(value);
export const parseHypothesis = (value: unknown): Hypothesis => HypothesisSchema.parse(value);
export const safeParseHypothesis = (value: unknown) => HypothesisSchema.safeParse(value);
export const parseExperimentPlan = (value: unknown): ExperimentPlan => ExperimentPlanSchema.parse(value);
export const safeParseExperimentPlan = (value: unknown) => ExperimentPlanSchema.safeParse(value);
export const parseExperimentResult = (value: unknown): ExperimentResult => ExperimentResultSchema.parse(value);
export const safeParseExperimentResult = (value: unknown) => ExperimentResultSchema.safeParse(value);
export const parsePatchVerification = (value: unknown): PatchVerification => PatchVerificationSchema.parse(value);
export const safeParsePatchVerification = (value: unknown) => PatchVerificationSchema.safeParse(value);
export const parseAgentRun = (value: unknown): AgentRun => AgentRunSchema.parse(value);
export const safeParseAgentRun = (value: unknown) => AgentRunSchema.safeParse(value);
