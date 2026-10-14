import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentRunSchema,
  EvidenceItemSchema,
  ExperimentPlanSchema,
  ExperimentResultSchema,
  HypothesisSchema,
  IncidentSchema,
  PatchVerificationSchema,
} from "./index.js";

const timestamp = "2026-10-15T12:00:00.000Z";

test("accepts a complete incident contract", () => {
  const incident = IncidentSchema.parse({
    id: "incident-1",
    title: "Checkout errors",
    startedAt: timestamp,
    status: "collecting",
    workloadId: "workload-1",
    serviceIds: ["gateway", "orders"],
    evidenceIds: [],
  });

  assert.equal(incident.status, "collecting");
});

test("rejects invalid literals and unsafe bounds", () => {
  assert.equal(IncidentSchema.safeParse({
    id: "incident-1",
    title: "Checkout errors",
    startedAt: timestamp,
    status: "unknown",
    workloadId: "workload-1",
    serviceIds: [],
    evidenceIds: [],
  }).success, false);

  assert.equal(ExperimentPlanSchema.safeParse({
    id: "plan-1",
    hypothesisId: "hypothesis-1",
    question: "Does the pool exhaustion reproduce the error?",
    controlCondition: {},
    treatmentCondition: {},
    workloadId: "workload-1",
    metrics: ["error_rate"],
    expectedIfTrue: ["errors increase"],
    expectedIfFalse: ["errors remain unchanged"],
    timeoutSeconds: 0,
    resourceLimits: {},
    cleanupRequired: true,
  }).success, false);
});

test("validates every Section 13 contract parser", () => {
  const plan = {
    id: "plan-1",
    hypothesisId: "hypothesis-1",
    question: "Does the pool exhaustion reproduce the error?",
    controlCondition: { poolSize: 20 },
    treatmentCondition: { poolSize: 1 },
    workloadId: "workload-1",
    metrics: ["error_rate", "latency_ms"],
    expectedIfTrue: ["errors increase"],
    expectedIfFalse: ["errors remain unchanged"],
    timeoutSeconds: 60,
    resourceLimits: { cpu: "1", memory: "512m" },
    cleanupRequired: true,
  };
  const hypothesis = {
    id: "hypothesis-1",
    incidentId: "incident-1",
    title: "Pool exhaustion",
    suspectedComponent: "orders",
    mechanism: "The connection pool is exhausted under concurrent checkout traffic.",
    supportingEvidenceIds: ["evidence-1"],
    contradictingEvidenceIds: [],
    predictions: ["Pool wait time rises"],
    experimentPlan: plan,
    confidence: 0.7,
    status: "proposed",
    resultEvidenceIds: [],
  } as const;
  assert.equal(EvidenceItemSchema.parse({
    id: "evidence-1", incidentId: "incident-1", kind: "metric", source: "metrics",
    timestamp, summary: "Error rate increased", structuredData: { errorRate: 0.5 },
  }).kind, "metric");
  assert.equal(HypothesisSchema.parse(hypothesis).experimentPlan.id, "plan-1");
  assert.equal(ExperimentResultSchema.parse({
    id: "result-1", hypothesisId: "hypothesis-1", status: "passed",
    controlMeasurements: { errorRate: 0.01 }, treatmentMeasurements: { errorRate: 0.8 },
    commandExitCodes: [0], evidenceIds: ["evidence-2"], evaluatorRule: "error rate threshold",
    classification: "supported", rationale: "Treatment reproduced the symptom.", cleanupSucceeded: true,
  }).classification, "supported");
  assert.equal(PatchVerificationSchema.parse({
    id: "verification-1", incidentId: "incident-1", hypothesisId: "hypothesis-1",
    buildPassed: true, testsPassed: true, testIntegrityPassed: true, replayPassed: true,
    healthChecksPassed: true, baselineMeasurements: { errorRate: 0.01 },
    incidentMeasurements: { errorRate: 0.8 }, patchedMeasurements: { errorRate: 0.01 },
    status: "verified", failureReasons: [],
  }).status, "verified");
  assert.equal(AgentRunSchema.parse({
    id: "run-1", incidentId: "incident-1", role: "hypothesis-generator", status: "completed",
    inputRef: "artifact://input", outputRef: "artifact://output", retryCount: 0, tokenUsage: 120,
  }).status, "completed");
});
