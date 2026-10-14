import test from 'node:test';
import assert from 'node:assert/strict';
import { LabRuntime } from '../lab/dist/runtime/index.js';
import { createFaultScenarios } from '../lab/dist/faults/index.js';

test('shared lab runtime proves baseline, timeout fault, and reset', () => {
  const lab = new LabRuntime();
  const baseline = lab.start();
  assert.equal(baseline.health.status, 'healthy');
  const healthyRun = lab.runWorkload({ count: 20 }).run;
  assert.equal(healthyRun.metrics.successes, 20);
  assert.equal(healthyRun.metrics.errorRate, 0);
  assert.equal(healthyRun.metrics.inventory.invariantHolds, true);

  lab.activateFault('fault-4-timeout-mismatch');
  const faultedRun = lab.runWorkload({ count: 20 }).run;
  assert.equal(faultedRun.metrics.failures, 20);
  assert.equal(faultedRun.metrics.byService.payments.latencyP95Ms, 220);
  assert.equal(faultedRun.metrics.byService.payments.successes, 20);
  assert.equal(faultedRun.telemetry.spans.filter((span) => span.service === 'payments').length, 20);

  lab.reset();
  const recoveredRun = lab.runWorkload({ count: 20 }).run;
  assert.equal(recoveredRun.metrics.successes, 20);
  assert.equal(recoveredRun.metrics.errorRate, 0);
  assert.equal(recoveredRun.metrics.inventory.invariantHolds, true);
});

test('shared lab runtime exposes deterministic symptoms for the other catalog faults', () => {
  const cases = [
    ['fault-2-pool-exhaustion', (run) => run.metrics.connectionPool.timeouts > 0],
    ['fault-5-oversell-race', (run) => run.metrics.inventory.negativeStock === true],
    ['fault-6-poison-queue', (run) => run.metrics.queue.depth > 0 && run.metrics.queue.retryAttempts > 0],
  ];

  for (const [faultId, symptom] of cases) {
    const lab = new LabRuntime();
    lab.start();
    lab.activateFault(faultId);
    const run = lab.runWorkload({ count: 20 }).run;
    assert.equal(symptom(run), true, `${faultId} did not produce its measurable symptom`);
    lab.reset();
    const recovered = lab.runWorkload({ count: 20 }).run;
    assert.equal(recovered.healthy, true, `${faultId} did not reset cleanly`);
  }
});

test('each standalone fault scenario has a passing control, treatment, and reset lifecycle', () => {
  for (const scenario of createFaultScenarios()) {
    const control = scenario.run();
    assert.equal(control.activated, false);
    assert.equal(scenario.verify(control).passed, true, `${scenario.metadata.id} control failed`);

    scenario.activate();
    const treatment = scenario.run();
    assert.equal(treatment.activated, true);
    assert.equal(treatment.symptomDetected, true);
    assert.equal(scenario.verify(treatment).passed, true, `${scenario.metadata.id} treatment failed`);

    scenario.reset();
    assert.equal(scenario.isActive(), false);
    assert.equal(scenario.run().mode, 'control');
  }
});
