import assert from "node:assert/strict";
import test from "node:test";
import { AgentOrchestrationError, AgentOrchestrator, createLiveAdapter, createMockAdapter, HypothesesOutputSchema } from "./index.js";

const incident = {
  id: "incident-1", title: "Payment timeouts", startedAt: "2026-01-01T00:00:00Z", status: "investigating" as const,
  scenarioId: "fault-4-timeout-mismatch", workloadId: "workload-1", serviceIds: ["gateway", "payments"], evidenceIds: ["e-1"],
};
const evidence = [{ id: "e-1", incidentId: "incident-1", kind: "metric" as const, source: "metrics", timestamp: "2026-01-01T00:00:01Z", summary: "p95 increased" }];

test("mock returns three competing hypotheses, including decoys and known mechanism", async () => {
  const result = await new AgentOrchestrator(createMockAdapter()).proposeHypotheses({ incident, evidence });
  assert.ok(result.output.hypotheses.length >= 3);
  assert.ok(result.output.hypotheses.some((hypothesis) => hypothesis.title.includes("Caller timeout")));
  assert.ok(result.output.hypotheses.some((hypothesis) => hypothesis.title.includes("Upstream")));
  assert.ok(result.output.hypotheses.every((hypothesis) => hypothesis.experimentPlan.hypothesisId === hypothesis.id));
  assert.equal(result.receipt.status, "completed");
  assert.equal(result.receipt.retryCount, 0);
  assert.ok(result.receipt.latencyMs >= 0);
  assert.ok((result.receipt.tokenUsage ?? 0) > 0);
});

test("malformed provider output is rejected and tracked after bounded retries", async () => {
  const adapter = createLiveAdapter(async () => ({ hypotheses: [{ malformed: true }] }));
  await assert.rejects(
    () => new AgentOrchestrator(adapter, { maxRetries: 1 }).proposeHypotheses({ incident, evidence }),
    (error: unknown) => error instanceof AgentOrchestrationError && error.receipt.status === "failed" && error.receipt.retryCount === 1 && /invalid/i.test(error.receipt.error ?? ""),
  );
});

test("strict output schema rejects unknown fields", () => {
  assert.throws(() => HypothesesOutputSchema.parse({ hypotheses: [], extra: true }));
});

test("references to evidence not supplied by the incident are rejected", async () => {
  const adapter = createLiveAdapter(async () => ({ hypotheses: Array.from({ length: 3 }, (_, index) => ({
    ...createMockAdapterHypothesis(index), supportingEvidenceIds: ["invented-evidence"],
  })) }));
  await assert.rejects(() => new AgentOrchestrator(adapter).proposeHypotheses({ incident, evidence }), /unsupplied evidence ID/);
});

function createMockAdapterHypothesis(index: number) {
  const id = `incident-1-h${index + 1}`;
  return {
    id, incidentId: "incident-1", title: `candidate ${index}`, suspectedComponent: "gateway", mechanism: "a mechanism",
    supportingEvidenceIds: ["e-1"], contradictingEvidenceIds: [], predictions: ["a prediction"],
    experimentPlan: { id: `${id}-experiment`, hypothesisId: id, question: "question", controlCondition: {}, treatmentCondition: {}, workloadId: "workload-1", metrics: ["p95"], expectedIfTrue: ["lower"], expectedIfFalse: ["same"], timeoutSeconds: 10, resourceLimits: {}, cleanupRequired: true },
    expectedSymptomChange: "lower", riskLevel: "low", status: "proposed", resultEvidenceIds: [],
  };
}
