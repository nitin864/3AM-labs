# Faultline Lab local API

This is the local-only Fastify integration service for Faultline Lab. It uses
the deterministic `LabRuntime`, incident brief and graph builders, mock agent
orchestration, replica experiment engine, and data-only patch verifier. It does
not execute shell commands, call external services, or persist data outside the
process.

## Setup and commands

From the repository root (after the lab and workspace packages have been
built), run:

```sh
cd apps/api
npm ci
npm run build
npm test
npm start                 # listens on 127.0.0.1:3001
PORT=3100 npm start       # optional local port
```

`npm ci` uses the package-local lockfile. The API imports the built deterministic
packages from `lab/dist` and `packages/*/dist`, so build the repository first
when starting from a clean checkout.

## Endpoints

The API implements the Section 14 sketch:

- `GET /api/health`, `GET /api/scenarios`
- `POST /api/lab/start`, `POST /api/lab/workload`,
  `POST /api/lab/faults/:faultId/activate`, `POST /api/lab/reset`
- `POST /api/incidents`, `POST /api/incidents/:incidentId/investigate`
- `GET /api/incidents/:incidentId`,
  `GET /api/incidents/:incidentId/hypotheses`
- `GET /api/incidents/:incidentId/events` (SSE)
- `GET /api/experiments/:experimentId`
- `POST /api/incidents/:incidentId/verify-patch`
- `GET /api/benchmarks/:runId`, `GET /api/runs`

Workloads accept an optional bounded `{ "count": 0..500, "seed": 0..4294967295 }`.
The incident creation body accepts `{ "runId": "run-..." }`; if omitted it
uses the latest run. Investigation emits `hypothesis`, `experiment`, and
`completion` events. Patch verification accepts a data-only verifier candidate
with `operations` limited to `apps/api/**`; it never runs a command. SSE events
are replayed from the in-memory bounded event buffer and subscribers are
removed when the connection closes.

Only localhost/127.0.0.1 browser origins receive CORS headers.
