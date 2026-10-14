import assert from "node:assert/strict";
import test from "node:test";
import { buildIncidentBrief, type RunResultLike } from "./index.js";

const baseline: RunResultLike = {
  runId: "run-healthy",
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: "2026-01-01T00:00:00.100Z",
  outcomes: [
    { traceId: "t1", status: "succeeded", service: "gateway", latencyMs: 10 },
    { traceId: "t2", status: "succeeded", service: "gateway", latencyMs: 20 },
  ],
  telemetry: { logs: [], spans: [] },
};

const incident: RunResultLike = {
  runId: "run-incident",
  startedAt: "2026-01-01T00:01:00.000Z",
  finishedAt: "2026-01-01T00:01:00.300Z",
  workload: { id: "workload-1", requestCount: 3 },
  outcomes: [
    { traceId: "t3", status: "failed", errorType: "connection_timeout", service: "gateway", latencyMs: 100 },
    { traceId: "t4", status: "succeeded", service: "gateway", latencyMs: 30 },
  ],
  telemetry: {
    logs: [{ timestamp: "2026-01-01T00:01:00.100Z", service: "orders", level: "error", event: "connection_acquisition_timeout", traceId: "t3" }],
    spans: [
      { spanId: "s1", traceId: "t3", service: "orders", operation: "orders.create", startTime: "2026-01-01T00:01:00.001Z", durationMs: 100, status: "error", attributes: { errorType: "connection_timeout" } },
      { spanId: "s2", traceId: "t4", service: "orders", operation: "orders.create", startTime: "2026-01-01T00:01:00.101Z", durationMs: 30, status: "ok" },
    ],
    faultMarkers: [{ id: "fm1", faultId: "fault-2-pool-exhaustion", action: "activated", timestamp: "2026-01-01T00:01:00.000Z", service: "orders", cause: "pool leak" }],
  },
};

test("summarises measured rates, quantiles, errors, impact and evidence", () => {
  const brief = buildIncidentBrief(incident, baseline);
  assert.equal(brief.incident.errorRate, 0.5);
  assert.equal(brief.incident.p50LatencyMs, 65);
  assert.equal(brief.incident.p95LatencyMs, 96.5);
  assert.equal(brief.baseline?.p95LatencyMs, 19.5);
  assert.equal(brief.errorTypes[0]?.type, "connection_timeout");
  assert.deepEqual(brief.affectedTraceIds, ["t3"]);
  assert.equal(brief.criticalSpans[0]?.spanId, "s1");
  assert.equal(brief.evidence.some((item) => item.id === "telemetry:span:s1"), true);
});
