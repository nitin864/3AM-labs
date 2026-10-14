import assert from "node:assert/strict";
import test from "node:test";
import { createWorkload } from "../../../lab/dist/runtime/index.js";
import { ReplicaRunner } from "./index.js";

test("replays the exact manifest and emits cleanup receipts", () => {
  const manifest = createWorkload({ count: 80, seed: 7 });
  const result = new ReplicaRunner().runExperiment(manifest, "fault-5-oversell-race");
  assert.equal(result.control.workloadMatched, true);
  assert.equal(result.treatment.workloadMatched, true);
  assert.equal(result.after.workloadMatched, true);
  assert.equal(result.control.cleanup.succeeded, true);
  assert.equal(result.treatment.cleanup.succeeded, true);
  assert.equal(result.after.cleanup.succeeded, true);
  assert.equal(result.treatment.cleanup.networkAccessed, false);
  assert.equal(result.treatment.cleanup.hostCommandsRun, false);
});

test("enforces the operation budget before replay", () => {
  const phase = new ReplicaRunner().run({
    manifest: createWorkload({ count: 2 }),
    phase: "control",
    limits: { maxOperations: 1 },
  });
  assert.equal(phase.timedOut, true);
  assert.equal(phase.commandExitCode, 124);
  assert.equal(phase.cleanup.succeeded, true);
});
