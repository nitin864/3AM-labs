import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildIncidentBrief } from '../packages/incident-brief/dist/index.js';
import { buildDependencyGraph } from '../packages/graph-builder/dist/index.js';
import {
  AgentOrchestrator,
  createMockAdapter,
} from '../packages/agent-orchestrator/dist/index.js';
import { ExperimentEngine } from '../packages/experiment-engine/dist/index.js';
import { verifyPatch } from '../packages/verifier/dist/index.js';
import { IncidentSchema, EvidenceItemSchema } from '../packages/contracts/dist/index.js';
import { LabRuntime, createWorkload } from '../lab/dist/runtime/index.js';

function runScenario(faultId, count) {
  const generated = createWorkload({ count, seed: 20261016 });
  // Keep the oversell experiment focused on the race while ensuring demand
  // crosses the stock boundary: every request buys two units from an initial
  // stock of 100. The healthy control rejects only legitimate excess demand;
  // the faulted treatment incorrectly accepts it and drives stock negative.
  const workload = faultId === 'fault-5-oversell-race'
    ? { ...generated, requests: generated.requests.map((request) => ({ ...request, quantity: 2 })) }
    : generated;
  const baselineLab = new LabRuntime();
  baselineLab.start();
  const baseline = baselineLab.runWorkload({ manifest: workload }).run;
  const incidentLab = new LabRuntime();
  incidentLab.start();
  incidentLab.activateFault(faultId);
  const incident = incidentLab.runWorkload({ manifest: workload }).run;
  return { workload, baseline, incident };
}

function makeIncident(faultId, baseline, incident, brief) {
  const evidence = brief.evidence.map((item) => EvidenceItemSchema.parse({
    id: item.id,
    incidentId: `incident-${faultId}`,
    kind: item.kind === 'fault-marker' ? 'deployment' : item.kind === 'trace' ? 'trace' : item.kind === 'metric' ? 'metric' : item.kind === 'workload' ? 'workload' : 'log',
    source: item.source,
    timestamp: item.timestamp ?? incident.startedAt,
    ...(item.service === undefined ? {} : { serviceId: item.service }),
    ...(item.traceId === undefined ? {} : { traceId: item.traceId }),
    summary: `Measured ${item.kind} evidence from ${item.source}`,
  }));
  const contract = IncidentSchema.parse({
    id: `incident-${faultId}`,
    title: `Synthetic ${faultId} incident`,
    startedAt: incident.startedAt,
    endedAt: incident.finishedAt,
    status: 'investigating',
    scenarioId: faultId,
    workloadId: incident.workload.id,
    serviceIds: ['gateway', 'orders', 'payments', 'inventory'],
    evidenceIds: evidence.map((item) => item.id),
    summary: `Measured error rate ${brief.incident.errorRate}; baseline ${brief.baseline?.errorRate ?? 'not measured'}.`,
  });
  return { contract, evidence };
}

async function investigate(faultId, count) {
  const { workload, baseline, incident } = runScenario(faultId, count);
  const brief = buildIncidentBrief(incident, baseline);
  const graph = buildDependencyGraph(incident, baseline);
  const { contract, evidence } = makeIncident(faultId, baseline, incident, brief);
  const orchestrator = new AgentOrchestrator(createMockAdapter(), { maxHypotheses: 3 });
  const hypotheses = await orchestrator.proposeHypotheses({ incident: contract, evidence, maxHypotheses: 3 });
  const trueHypothesis = hypotheses.output.hypotheses[2];
  assert.ok(trueHypothesis);
  const experiment = new ExperimentEngine().run({
    id: `experiment-${faultId}`,
    hypothesisId: trueHypothesis.id,
    faultId,
    workload,
  });
  return { baseline, incident, brief, graph, hypotheses, experiment };
}

test('Task 5 end-to-end supports timeout mismatch with measured evidence', async () => {
  const result = await investigate('fault-4-timeout-mismatch', 20);
  assert.equal(result.brief.baseline?.errorRate, 0);
  assert.equal(result.brief.incident.errorRate, 1);
  assert.equal(result.brief.incident.p95LatencyMs, 224);
  assert.equal(result.graph.causalInterpretation, 'observed_dependencies_only');
  assert.equal(result.hypotheses.output.hypotheses.length, 3);
  assert.equal(result.experiment.classification, 'supported');
  assert.equal(result.experiment.treatmentMeasurements.timedOutRequests, 20);
  assert.equal(result.experiment.treatmentMeasurements.completedDownstreamRequests, 20);
  assert.equal(result.experiment.afterMeasurements.timedOutRequests, 0);
  console.log(JSON.stringify({
    fault: 'fault-4-timeout-mismatch',
    baseline: { errorRate: result.brief.baseline?.errorRate, p95Ms: result.brief.baseline?.p95LatencyMs },
    incident: { errorRate: result.brief.incident.errorRate, p95Ms: result.brief.incident.p95LatencyMs, errors: result.brief.errorTypes.map((item) => ({ type: item.type, count: item.count, evidenceRefCount: item.evidenceRefs.length })) },
    hypotheses: result.hypotheses.output.hypotheses.map((item) => item.title),
    experiment: {
      classification: result.experiment.classification,
      treatmentTimeouts: result.experiment.treatmentMeasurements.timedOutRequests,
      downstreamCompletions: result.experiment.treatmentMeasurements.completedDownstreamRequests,
      afterTimeouts: result.experiment.afterMeasurements.timedOutRequests,
    },
  }));
});

test('Task 5 end-to-end supports oversell race and records graph/brief evidence', async () => {
  const result = await investigate('fault-5-oversell-race', 80);
  assert.equal(result.brief.baseline?.errorRate, result.experiment.controlMeasurements.errorRate);
  assert.equal(result.experiment.controlMeasurements.inventoryInvariantHolds, true);
  assert.equal(result.brief.incident.errorRate, 0);
  assert.equal(result.brief.incident.p95LatencyMs, 44);
  assert.ok(result.graph.nodes.some((node) => node.id === 'inventory'));
  assert.equal(result.experiment.classification, 'supported');
  assert.equal(result.experiment.treatmentMeasurements.inventoryNegativeStock, true);
  assert.equal(result.experiment.treatmentMeasurements.inventoryInvariantHolds, false);
  assert.equal(result.experiment.afterMeasurements.inventoryInvariantHolds, true);
  console.log(JSON.stringify({
    fault: 'fault-5-oversell-race',
    baseline: { errorRate: result.brief.baseline?.errorRate, inventoryInvariant: result.experiment.controlMeasurements.inventoryInvariantHolds, availableStock: result.experiment.controlMeasurements.inventoryAvailableStock },
    incident: { errorRate: result.brief.incident.errorRate, negativeStock: result.experiment.treatmentMeasurements.inventoryNegativeStock, availableStock: result.experiment.treatmentMeasurements.inventoryAvailableStock },
    graph: { nodes: result.graph.nodes.length, edges: result.graph.edges.length, causalInterpretation: result.graph.causalInterpretation },
    experiment: { classification: result.experiment.classification, afterInvariant: result.experiment.afterMeasurements.inventoryInvariantHolds },
  }));
});

test('Task 5 patch verification accepts recovery and rejects test tampering', async () => {
  const root = await mkdtemp(join('/tmp', 'faultline-task5-verifier-'));
  try {
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, 'tests'), { recursive: true });
    await writeFile(join(root, 'src', 'config.ts'), 'export const timeoutMs = 150;\n');
    await writeFile(join(root, 'tests', 'config.test.ts'), "test('timeout', () => { expect(true).toBe(true); });\n");
    const runners = {
      buildRunner: () => ({ passed: true }),
      testRunner: () => ({ passed: true, testCount: 1, assertionCount: 1 }),
      replayRunner: ({ phase }) => ({
        passed: true,
        healthPassed: true,
        metrics: { errorRate: phase === 'incident' ? 1 : 0 },
      }),
    };
    const verified = await verifyPatch({
      workspaceRoot: root,
      allowedPaths: ['src/**'],
      candidate: { operations: [{ kind: 'patch', path: 'src/config.ts', search: '150', replace: '250' }] },
      metricRules: { errorRate: { direction: 'lower', max: 0 } },
      ...runners,
    });
    assert.equal(verified.status, 'verified');
    assert.equal(verified.testIntegrityPassed, true);
    const cheating = await verifyPatch({
      workspaceRoot: root,
      allowedPaths: ['tests/**'],
      candidate: { operations: [{ kind: 'delete', path: 'tests/config.test.ts' }] },
      ...runners,
    });
    assert.equal(cheating.status, 'rejected');
    assert.match(cheating.failureReasons.join('\n'), /TEST_FILE_DELETED/);
    console.log(JSON.stringify({ patchVerification: verified.status, antiCheat: cheating.failureReasons }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
