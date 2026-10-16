import assert from "node:assert/strict";
import { test } from "node:test";
import { app } from "./index.js";

test("local lab API runs an investigation and streams structured SSE events", async () => {
  await app.ready();
  const health = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().localOnly, true);

  const started = await app.inject({ method: "POST", url: "/api/lab/start", payload: {} });
  assert.equal(started.statusCode, 200);
  const activated = await app.inject({ method: "POST", url: "/api/lab/faults/fault-4-timeout-mismatch/activate", payload: {} });
  assert.equal(activated.statusCode, 200);
  const workload = await app.inject({ method: "POST", url: "/api/lab/workload", payload: { count: 4, seed: 7 } });
  assert.equal(workload.statusCode, 200);
  const runId = workload.json().runId as string;
  const created = await app.inject({ method: "POST", url: "/api/incidents", payload: { runId } });
  assert.equal(created.statusCode, 201);
  const incidentId = created.json().id as string;

  const server = await app.listen({ host: "127.0.0.1", port: 0 });
  const controller = new AbortController();
  const response = await fetch(`${server}/api/incidents/${incidentId}/events`, { signal: controller.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
  const reader = response.body?.getReader();
  assert.ok(reader);
  const initial = new TextDecoder().decode((await reader.read()).value);
  assert.match(initial, /incident\.created/);
  assert.match(initial, /fault\.activation/);
  assert.match(initial, /telemetry\.workload/);

  const investigation = await app.inject({ method: "POST", url: `/api/incidents/${incidentId}/investigate`, payload: {} });
  assert.equal(investigation.statusCode, 200);
  assert.equal(investigation.json().status, "completed");

  let stream = "";
  const deadline = Date.now() + 2000;
  while (!stream.includes("event: completion") && Date.now() < deadline) {
    const next = await reader.read();
    if (next.done) break;
    stream += new TextDecoder().decode(next.value);
  }
  controller.abort();
  await app.close();
  assert.match(stream, /event: hypothesis/);
  assert.match(stream, /event: experiment/);
  assert.match(stream, /event: completion/);

  const hypotheses = investigation.json().hypotheses as Array<{ status: string }>;
  assert.equal(hypotheses.some((hypothesis) => hypothesis.status === "supported"), true);
});
