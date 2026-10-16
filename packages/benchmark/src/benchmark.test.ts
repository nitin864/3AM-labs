import assert from "node:assert/strict";
import test from "node:test";
import { BENCHMARK_SCHEMA_VERSION, runBenchmarkSync } from "./index.js";

test("benchmark emits the required measured Mode A/Mode B schema", () => {
  const artifact = runBenchmarkSync();
  assert.equal(artifact.schemaVersion, BENCHMARK_SCHEMA_VERSION);
  assert.deepEqual(artifact.runConfig.scenarioIds, ["fault-4-timeout-mismatch", "fault-5-oversell-race"]);
  assert.equal(artifact.scenarios.length, 2);
  for (const row of artifact.scenarios) {
    for (const key of ["top1_accuracy", "top3_recall", "supported_cause_correct", "false_support_count", "inconclusive_rate", "verified_fix_rate", "time_to_diagnosis", "time_to_verified_fix", "experiment_count", "token_usage", "resource_usage"]) assert.ok(key in row, `${key} missing`);
    assert.equal(row.modeB.supportedCauseCorrect, true);
    assert.equal(row.modeB.falseSupportCount, 0);
    assert.equal(row.modeB.inconclusiveCount, 1);
    assert.equal(row.modeA.experimentCount, 0);
    assert.equal(row.verified_fix_rate, "Not measured");
    assert.equal(row.time_to_verified_fix, "Not measured");
    assert.equal(row.resource_usage, "Not measured");
    assert.equal(row.experiment_count, 3);
  }
  assert.equal(artifact.aggregate.top1_accuracy, 1);
  assert.equal(artifact.aggregate.top3_recall, 1);
  assert.equal(artifact.aggregate.supported_cause_correct, 1);
  assert.equal(artifact.aggregate.false_support_count, 0);
  assert.equal(artifact.aggregate.experiment_count, 6);
});

test("benchmark is reproducible byte-for-byte as a deterministic data product", () => {
  assert.deepEqual(runBenchmarkSync(), runBenchmarkSync());
});
