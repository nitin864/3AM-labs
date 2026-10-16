import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { LabRuntime, type FaultId, type RunResult, type WorkloadManifest } from "../../../lab/dist/runtime/index.js";
import { buildIncidentBrief, type IncidentBrief } from "../../../packages/incident-brief/dist/index.js";
import { buildDependencyGraph, type DependencyEvidenceGraph } from "../../../packages/graph-builder/dist/index.js";
import {
  AgentOrchestrator,
  createMockAdapter,
  type HypothesesOutput,
} from "../../../packages/agent-orchestrator/dist/index.js";
import { ExperimentEngine, type ExperimentResult } from "../../../packages/experiment-engine/dist/index.js";
import { verifyPatch, type CandidatePatch, type PatchVerification } from "../../../packages/verifier/dist/index.js";
import type { EvidenceItem, Hypothesis, Incident } from "../../../packages/contracts/dist/index.js";

const MAX_EVENTS = 500;
const MAX_BODY_BYTES = 1_000_000;
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const localOrigins = /^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?$/i;

export interface ApiEvent {
  id: number;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

interface IncidentRecord {
  incident: Incident;
  run: RunResult;
  brief: IncidentBrief;
  graph: DependencyEvidenceGraph;
  evidence: EvidenceItem[];
  hypotheses: Hypothesis[];
  experiments: Map<string, unknown>;
  events: ApiEvent[];
  subscribers: Set<(event: ApiEvent) => void>;
  patch?: PatchVerification;
}

interface ApiState {
  readonly runtime: LabRuntime;
  readonly incidents: Map<string, IncidentRecord>;
  readonly experiments: Map<string, unknown>;
  readonly benchmarks: Map<string, Record<string, unknown>>;
  nextIncident: number;
  nextEvent: number;
}

const state: ApiState = {
  runtime: new LabRuntime(),
  incidents: new Map(),
  experiments: new Map(),
  benchmarks: new Map(),
  nextIncident: 1,
  nextEvent: 1,
};

const jsonObject = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

function sendError(reply: FastifyReply, statusCode: number, code: string, message: string) {
  return reply.code(statusCode).send({ error: { code, message } });
}

function body(request: FastifyRequest): Record<string, unknown> {
  const value = jsonObject(request.body);
  if (JSON.stringify(value).length > MAX_BODY_BYTES) throw new ApiInputError("request body exceeds 1 MB");
  return value;
}

class ApiInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiInputError";
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 500) throw new ApiInputError(`${field} must be a non-empty string of at most 500 characters`);
  return value;
}

function boundedCount(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 500) throw new ApiInputError("count must be an integer between 0 and 500");
  return value;
}

function boundedSeed(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new ApiInputError("seed must be an unsigned 32-bit integer");
  return value;
}

function emit(record: IncidentRecord, type: string, data: Record<string, unknown>): ApiEvent {
  const event: ApiEvent = { id: state.nextEvent++, type, timestamp: new Date().toISOString(), data };
  record.events.push(event);
  if (record.events.length > MAX_EVENTS) record.events.splice(0, record.events.length - MAX_EVENTS);
  for (const subscriber of record.subscribers) subscriber(event);
  return event;
}

function emitAll(type: string, data: Record<string, unknown>): void {
  for (const record of state.incidents.values()) emit(record, type, data);
}

function asEvidence(run: RunResult, brief: IncidentBrief, incidentId: string): EvidenceItem[] {
  return brief.evidence.slice(0, 1000).map((item) => ({
    id: item.id,
    incidentId,
    kind: item.kind === "fault-marker" ? "config" : item.kind,
    source: item.source,
    timestamp: item.timestamp ?? run.startedAt,
    ...(item.traceId === undefined ? {} : { traceId: item.traceId }),
    ...(item.service === undefined ? {} : { serviceId: item.service }),
    summary: `${item.kind}: ${item.source}`,
    structuredData: {},
  }));
}

function createIncident(run: RunResult): IncidentRecord {
  const id = `incident-${String(state.nextIncident++).padStart(6, "0")}`;
  const brief = buildIncidentBrief(run);
  const evidence = asEvidence(run, brief, id);
  const incident: Incident = {
    id,
    title: `Incident from ${run.runId}`,
    startedAt: run.startedAt,
    status: "collecting",
    ...(run.faultId === undefined ? {} : { scenarioId: run.faultId }),
    workloadId: run.workload.id,
    serviceIds: state.runtime.health().serviceNames,
    evidenceIds: evidence.map((item) => item.id),
    summary: `Observed ${brief.incident.errorCount} errors across ${brief.incident.requestCount} synthetic requests.`,
  };
  const record: IncidentRecord = {
    incident,
    run,
    brief,
    graph: buildDependencyGraph(run),
    evidence,
    hypotheses: [],
    experiments: new Map(),
    events: [],
    subscribers: new Set(),
  };
  state.incidents.set(id, record);
  emit(record, "incident.created", { incidentId: id, runId: run.runId, brief, graph: record.graph });
  const markers = run.telemetry.faultMarkers;
  if (markers.length > 0) {
    for (const marker of markers) emit(record, "fault.activation", { faultId: marker.faultId, action: marker.action, timestamp: marker.timestamp, service: marker.service });
  } else if (run.faultId !== undefined) {
    emit(record, "fault.activation", { faultId: run.faultId, action: "activated", source: "lab.health" });
  }
  emit(record, "telemetry.workload", { runId: run.runId, metrics: run.metrics, healthy: run.healthy });
  return record;
}

function incidentResponse(record: IncidentRecord): Record<string, unknown> {
  return {
    ...record.incident,
    brief: record.brief,
    graph: record.graph,
    hypotheses: record.hypotheses,
    experiments: [...record.experiments.values()],
    patch: record.patch,
    eventCount: record.events.length,
  };
}

function getIncident(id: string): IncidentRecord | undefined {
  return state.incidents.get(id);
}

function makeInconclusive(hypothesis: Hypothesis, reason: string): Record<string, unknown> {
  return {
    id: hypothesis.experimentPlan.id,
    hypothesisId: hypothesis.id,
    status: "inconclusive",
    classification: "inconclusive",
    controlMeasurements: {},
    treatmentMeasurements: {},
    afterMeasurements: {},
    commandExitCodes: [],
    evaluatorRule: "No deterministic LabRuntime evaluator is available for this fault.",
    rationale: reason,
    cleanupSucceeded: true,
    evidenceIds: [],
  };
}

async function investigate(record: IncidentRecord): Promise<void> {
  record.incident = { ...record.incident, status: "investigating" };
  emit(record, "investigation.started", { incidentId: record.incident.id });
  try {
    const orchestration = new AgentOrchestrator(createMockAdapter(), { maxHypotheses: 3, maxRetries: 0 });
    const proposed = await orchestration.proposeHypotheses({ incident: record.incident, evidence: record.evidence, maxHypotheses: 3 });
    record.hypotheses = proposed.output.hypotheses;
    emit(record, "hypothesis", { hypotheses: record.hypotheses, agentRun: proposed.receipt });

    const fault = record.incident.scenarioId as FaultId | undefined;
    const supportedExperiment = fault === "fault-4-timeout-mismatch" || fault === "fault-5-oversell-race";
    for (const [index, hypothesis] of record.hypotheses.entries()) {
      const result = supportedExperiment && index === 2
        ? new ExperimentEngine().run({ id: hypothesis.experimentPlan.id, hypothesisId: hypothesis.id, faultId: fault, workload: record.run.workload })
        : makeInconclusive(hypothesis, supportedExperiment ? "Telemetry candidate was not selected for the causal treatment; the competing explanation remains unproven." : "This scenario is outside the deterministic experiment engine's supported fault set.");
      record.experiments.set(hypothesis.experimentPlan.id, result);
      state.experiments.set(hypothesis.experimentPlan.id, result);
      const classification = (result as { classification?: string }).classification;
      const status = classification === "supported" ? "supported" : classification === "rejected" ? "rejected" : "inconclusive";
      record.hypotheses = record.hypotheses.map((item) => item.id === hypothesis.id
        ? { ...item, status, resultEvidenceIds: (result as { evidenceIds?: string[] }).evidenceIds ?? [] }
        : item);
      emit(record, "experiment", { experimentId: hypothesis.experimentPlan.id, hypothesisId: hypothesis.id, result });
    }
    record.incident = { ...record.incident, status: "completed", endedAt: new Date().toISOString() };
    const benchmark = { runId: record.incident.id, mode: "experiment-confirmed", status: "measured", hypotheses: record.hypotheses.length, supported: record.hypotheses.filter((item) => item.status === "supported").length };
    state.benchmarks.set(record.incident.id, benchmark);
    emit(record, "completion", { incidentId: record.incident.id, status: record.incident.status, benchmark });
  } catch (error) {
    record.incident = { ...record.incident, status: "failed", endedAt: new Date().toISOString(), summary: errorMessage(error) };
    emit(record, "completion", { incidentId: record.incident.id, status: "failed", error: errorMessage(error) });
  }
}

function encodeSse(event: ApiEvent): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try { return localOrigins.test(new URL(origin).host); } catch { return false; }
}

export function createApp(): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: MAX_BODY_BYTES });
  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (isLocalOrigin(origin)) {
      reply.header("access-control-allow-origin", origin as string);
      reply.header("vary", "Origin");
      reply.header("access-control-allow-headers", "content-type");
      reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
    }
    if (request.method === "OPTIONS") return reply.code(204).send();
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiInputError) return sendError(reply, 400, "invalid_request", error.message);
    if ((error as { validation?: unknown }).validation) return sendError(reply, 400, "invalid_request", error.message);
    request.log.error(error);
    return sendError(reply, 500, "internal_error", "local API operation failed");
  });

  app.get("/api/health", async () => ({ status: "ok", lab: state.runtime.health(), localOnly: true, incidents: state.incidents.size }));
  app.get("/api/scenarios", async () => ({ scenarios: state.runtime.scenarios() }));
  app.post("/api/lab/start", async (_request, reply) => reply.send({ ...state.runtime.start(), lab: state.runtime.health() }));
  app.post("/api/lab/reset", async (_request, reply) => {
    state.runtime.reset();
    emitAll("fault.activation", { action: "reset", lab: state.runtime.health() });
    return reply.send({ status: "reset", lab: state.runtime.health() });
  });
  app.post("/api/lab/workload", async (request, reply) => {
    const input = body(request);
    const count = boundedCount(input.count);
    const seed = boundedSeed(input.seed);
    const options = {
      ...(count === undefined ? {} : { count }),
      ...(seed === undefined ? {} : { seed }),
      ...(input.manifest === undefined ? {} : { manifest: input.manifest as WorkloadManifest }),
    };
    const run = state.runtime.runWorkload(options);
    emitAll("telemetry.workload", { runId: run.run.runId, workload: run.run.workload, metrics: run.run.metrics, healthy: run.run.healthy });
    return reply.send(run.run);
  });
  app.post("/api/lab/faults/:faultId/activate", async (request, reply) => {
    const faultId = requiredString((request.params as { faultId?: unknown }).faultId, "faultId");
    try {
      const lab = state.runtime.activateFault(faultId);
      emitAll("fault.activation", { faultId, action: "activated", lab });
      return reply.send({ faultId, lab });
    } catch (error) { return sendError(reply, 404, "unknown_fault", errorMessage(error)); }
  });
  app.post("/api/incidents", async (request, reply) => {
    const input = body(request);
    const runId = input.runId === undefined ? state.runtime.health().lastRunId : requiredString(input.runId, "runId");
    if (!runId) return sendError(reply, 400, "run_required", "run a workload or provide runId first");
    const run = state.runtime.getRun(runId);
    if (!run) return sendError(reply, 404, "run_not_found", `run ${runId} was not found`);
    return reply.code(201).send(incidentResponse(createIncident(run)));
  });
  app.post("/api/incidents/:incidentId/investigate", async (request, reply) => {
    const id = requiredString((request.params as { incidentId?: unknown }).incidentId, "incidentId");
    const incident = getIncident(id);
    if (!incident) return sendError(reply, 404, "incident_not_found", `incident ${id} was not found`);
    await investigate(incident);
    return reply.send(incidentResponse(incident));
  });
  app.get("/api/incidents/:incidentId", async (request, reply) => {
    const incident = getIncident(requiredString((request.params as { incidentId?: unknown }).incidentId, "incidentId"));
    return incident ? reply.send(incidentResponse(incident)) : sendError(reply, 404, "incident_not_found", "incident was not found");
  });
  app.get("/api/incidents/:incidentId/hypotheses", async (request, reply) => {
    const incident = getIncident(requiredString((request.params as { incidentId?: unknown }).incidentId, "incidentId"));
    return incident ? reply.send({ hypotheses: incident.hypotheses }) : sendError(reply, 404, "incident_not_found", "incident was not found");
  });
  app.get("/api/incidents/:incidentId/events", async (request, reply) => {
    const incident = getIncident(requiredString((request.params as { incidentId?: unknown }).incidentId, "incidentId"));
    if (!incident) return sendError(reply, 404, "incident_not_found", "incident was not found");
    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no" });
    for (const event of incident.events) response.write(encodeSse(event));
    const subscriber = (event: ApiEvent) => response.write(encodeSse(event));
    incident.subscribers.add(subscriber);
    const heartbeat = setInterval(() => response.write(": keep-alive\n\n"), 15_000);
    request.raw.on("close", () => { clearInterval(heartbeat); incident.subscribers.delete(subscriber); });
  });
  app.get("/api/experiments/:experimentId", async (request, reply) => {
    const id = requiredString((request.params as { experimentId?: unknown }).experimentId, "experimentId");
    const result = state.experiments.get(id);
    return result ? reply.send(result) : sendError(reply, 404, "experiment_not_found", "experiment was not found");
  });
  app.post("/api/incidents/:incidentId/verify-patch", async (request, reply) => {
    const id = requiredString((request.params as { incidentId?: unknown }).incidentId, "incidentId");
    const incident = getIncident(id);
    if (!incident) return sendError(reply, 404, "incident_not_found", "incident was not found");
    const input = body(request);
    const candidate = (input.candidate ?? input) as CandidatePatch;
    if (!Array.isArray(candidate.operations) || candidate.operations.length > 100) throw new ApiInputError("candidate.operations must be an array of at most 100 data-only operations");
    const supportedHypothesis = incident.hypotheses.find((item) => item.status === "supported")?.id;
    const result = await verifyPatch({
      workspaceRoot: rootDir,
      candidate,
      incidentId: id,
      ...(supportedHypothesis === undefined ? {} : { hypothesisId: supportedHypothesis }),
      allowedPaths: ["apps/api/**"],
      metricRules: {},
    });
    incident.patch = result;
    incident.incident = { ...incident.incident, status: result.status === "verified" ? "completed" : "inconclusive" };
    emit(incident, "patch.verification", { incidentId: id, result });
    emit(incident, "completion", { incidentId: id, status: incident.incident.status });
    return reply.send(result);
  });
  app.get("/api/benchmarks/:runId", async (request, reply) => {
    const id = requiredString((request.params as { runId?: unknown }).runId, "runId");
    const result = state.benchmarks.get(id);
    return result ? reply.send(result) : sendError(reply, 404, "benchmark_not_found", "benchmark was not found");
  });
  app.get("/api/runs", async () => ({ runs: state.runtime.listRuns(), incidents: [...state.incidents.values()].map(incidentResponse) }));
  return app;
}

export const app = createApp();
