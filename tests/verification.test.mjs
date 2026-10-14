import test from 'node:test';
import assert from 'node:assert/strict';
import { FAULT_4, createLab, runVerification } from './harness.mjs';

test('verification gate passes the complete baseline/fault/reset slice', () => {
  const result = runVerification();
  assert.equal(result.ok, true, result.checks.filter((check) => !check.ok).map((check) => check.name).join(', '));
});

test('healthy baseline is 100% successful and preserves request invariants', () => {
  const lab = createLab();
  assert.equal(lab.reset().healthy, true);
  const run = lab.workload({ requests: 20 });
  assert.equal(run.successes, 20);
  assert.equal(run.errors, 0);
  assert.equal(run.downstreamCompletions, 20);
});

test('fault-4-timeout-mismatch reproduces the false-timeout symptom', () => {
  const lab = createLab();
  lab.reset();
  assert.deepEqual(lab.activate(FAULT_4), { faultId: FAULT_4, active: true, timeoutMs: 150 });
  const run = lab.workload({ requests: 20 });
  assert.equal(run.falseTimeouts, 20);
  assert.equal(run.errors, 20);
  assert.equal(run.downstreamCompletions, 20);
  assert.ok(run.timeoutMs < run.downstreamMs);
});

test('reset restores a healthy run after fault-4', () => {
  const lab = createLab();
  lab.activate(FAULT_4);
  assert.equal(lab.reset().healthy, true);
  const run = lab.workload({ requests: 20 });
  assert.equal(run.successes, 20);
  assert.equal(run.falseTimeouts, 0);
});
