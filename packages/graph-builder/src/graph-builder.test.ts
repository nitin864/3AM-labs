import assert from "node:assert/strict";
import test from "node:test";
import { buildDependencyGraph, type GraphRun } from "./index.js";

const run: GraphRun = {
  telemetry: {
    spans: [
      { spanId: "gateway-1", traceId: "trace-1", service: "gateway", operation: "request", startTime: "2026-01-01T00:00:00.000Z", durationMs: 30, status: "error" },
      { spanId: "orders-1", traceId: "trace-1", service: "orders", operation: "create", startTime: "2026-01-01T00:00:00.001Z", durationMs: 20, status: "error" },
      { spanId: "payments-1", parentSpanId: "orders-1", traceId: "trace-1", service: "payments", operation: "charge", startTime: "2026-01-01T00:00:00.002Z", durationMs: 15, status: "ok" },
    ],
  },
};

test("builds observed edges and labels them as non-causal evidence", () => {
  const graph = buildDependencyGraph(run);
  const edge = graph.edges.find((candidate) => candidate.id === "orders->payments");
  assert.ok(edge);
  assert.equal(edge.observedBy.includes("parentSpanId"), true);
  assert.equal(edge.inferredCausality, false);
  assert.equal(edge.relationship, "observed_dependency");
  assert.equal(edge.calls, 1);
  assert.equal(edge.errorCount, 0);
  assert.equal(edge.weight, 1.015);
  assert.deepEqual(graph.nodes.map((node) => node.id), ["gateway", "orders", "payments"]);
});
