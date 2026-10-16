# Architecture

## Current implementation

Faultline is a Node.js 22/npm workspace. The deterministic vertical slice is
process-local. Optional `apps/api` and `apps/web` provide the current local
integration surfaces; the root gate does not start them.

```text
createWorkload(seed, count)
        |
        v
LabRuntime (in-memory persistence, deterministic clock/pool)
        |
        +--> gateway --> orders --> payments
        |                    |
        |                    +----> inventory
        |
        +--> JSON logs, trace spans, metrics, fault markers
                              |
             +----------------+----------------+
             v                                 v
      incident-brief                     graph-builder
             |                                 |
             +----------------+----------------+
                              v
                 agent-orchestrator (mock adapter)
                              |
                              v
                  replica-runner / experiment-engine
                          |
                          v
                         verifier

        optional local integration boundary
                 +-------------------+
                 | Fastify API + SSE |
                 +---------+---------+
                           |
                 +---------v---------+
                 | React/Vite console|
                 | live or cached    |
                 +-------------------+
```

`packages/contracts` defines Zod-validated records for incidents, evidence,
hypotheses, plans, results, patch verification, and agent runs. The incident
brief derives rates, quantiles, errors, affected services/traces, critical and
slow spans, fault markers, and evidence references from measured run data. The
graph builder reports observed interactions; its graph is explicitly not
causal proof.

The mock orchestrator is the only adapter shipped here. It returns three
bounded hypotheses for the Task 5 fixture, including decoys and the known
scenario mechanism when a known fault is present. A future provider must remain
behind that adapter and preserve schema validation, retry bounds, and evidence
references.

`ReplicaRunner` runs fresh in-memory phases. `ExperimentEngine` accepts only
the two scenarios currently wired to its end-to-end interface and judges
measurements only. `verifier` applies constrained data-only patch operations in
a disposable workspace and checks build/test/replay and test integrity.

## Runtime and deployment boundaries

The compiled CLI (`lab/runtime/cli.ts`) supports `start`, `reset`, `fault`,
`scenarios`, `run [count]`, and `demo`. `docker-compose.yml` runs the same
compiled runtime in a read-only container with `/tmp` as tmpfs. The default
Dockerfile command is the offline test gate.

`apps/api` is a Fastify server bound to `127.0.0.1` (default port 3001). Its
routes cover health/scenarios, lab controls, incidents, hypotheses, experiments,
patch verification, runs/benchmarks, and `/api/incidents/:id/events` SSE. It
keeps state in memory, uses bounded event replay, permits localhost CORS only,
and never executes shell commands or calls external services.

`apps/web` is a React/Vite single-page console with overview, timeline, graph,
hypothesis, experiment, patch, benchmark, and agent-trace views. It requests
the API when `VITE_API_BASE_URL` is set and reachable; otherwise it shows the
bundled deterministic cached demo and a visible `Cached demo` badge. There is
no hosted deployment or durable database in the current tree.

## Data flow and evidence boundary

Telemetry is recorded per run and scoped into the run result while the recorder
can retain a cumulative timeline. Metrics include request outcomes, service
latencies, pool, queue, and inventory state. Fault markers identify explicit
activation/reset events. An agent may suggest predictions, but only the
experiment engine can assign a causal classification.

The verifier is a candidate-repair check, not a deployment mechanism. A passing
test without replay recovery is not a verified repair.

## Planned, not current

The live API, SSE, and console now exist only as local integration surfaces.
There is still no live OmniRush provider adapter, durable run history, or hosted
deployment. Documentation must keep those boundaries explicit.
