import assert from "node:assert/strict";
import test from "node:test";
import { createWorkload } from "../../../lab/dist/runtime/index.js";
import { ExperimentEngine, type ExperimentInput } from "./index.js";

const input = (faultId: ExperimentInput["faultId"]): ExperimentInput => {
  const workload = createWorkload({ count: faultId === "fault-5-oversell-race" ? 80 : 20, seed: 10 });
  return { id: `experiment-${faultId}`, hypothesisId: "hypothesis-1", faultId, workload };
};

test("supports timeout mismatch from measured replay metrics", () => {
  const result = new ExperimentEngine().run(input("fault-4-timeout-mismatch"));
  assert.equal(result.classification, "supported");
  assert.equal(result.treatmentMeasurements.timedOutRequests, 20);
  assert.equal(result.afterMeasurements.timedOutRequests, 0);
});

test("supports oversell race and verifies invariant recovery", () => {
  const result = new ExperimentEngine().run(input("fault-5-oversell-race"));
  assert.equal(result.classification, "supported");
  assert.equal(result.treatmentMeasurements.inventoryNegativeStock, true);
  assert.equal(result.afterMeasurements.inventoryInvariantHolds, true);
});

test("rejects a valid treatment whose symptom is contradicted", () => {
  const engine = new ExperimentEngine();
  const phases = engine.run(input("fault-4-timeout-mismatch")).phases;
  // A healthy, discriminating treatment with a changed downstream metric but no
  // caller timeouts is a valid contradiction, rather than support.
  const treatment = phases.treatment.run;
  assert.ok(treatment);
  const altered = { ...phases.treatment, metrics: { ...phases.treatment.metrics!, byService: { ...phases.treatment.metrics!.byService, payments: { ...phases.treatment.metrics!.byService.payments!, latencyP95Ms: 221 } } }, run: { ...treatment, healthy: true, outcomes: treatment.outcomes.map(({ errorType: _errorType, ...outcome }) => outcome) } };
  const result = engine.judge(input("fault-4-timeout-mismatch"), { ...phases, treatment: altered });
  assert.equal(result.classification, "rejected");
});

test("marks non-discriminating results inconclusive", () => {
  const engine = new ExperimentEngine();
  const phases = engine.run(input("fault-4-timeout-mismatch")).phases;
  const result = engine.judge(input("fault-4-timeout-mismatch"), { ...phases, treatment: phases.control });
  assert.equal(result.classification, "inconclusive");
});

test("marks cleanup failure inconclusive", () => {
  const engine = new ExperimentEngine();
  const phases = engine.run(input("fault-4-timeout-mismatch")).phases;
  const result = engine.judge(input("fault-4-timeout-mismatch"), { ...phases, treatment: { ...phases.treatment, cleanup: { ...phases.treatment.cleanup, succeeded: false } } });
  assert.equal(result.classification, "inconclusive");
});
