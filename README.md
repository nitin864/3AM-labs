# Faultline Lab

> **Others rank hypotheses. Faultline reproduces them.**

Faultline Lab is an open-source, experimental developer tool for incident
diagnosis through controlled reproduction. It runs a small, deterministic,
in-memory service model, injects documented faults, collects structured
telemetry, and evaluates hypotheses against control/treatment/after runs.

This repository is a local lab prototype, not production incident-response
software. It includes a localhost-only Fastify API and a React/Vite console,
but no hosted dashboard, production connector, or automatic deployment path.
The API/web are optional integration surfaces around the TypeScript packages
and local `LabRuntime`; the agent stage uses a deterministic mock adapter.

## What problem it explores

Logs, traces, metrics, queue activity, and configuration changes often make
several causes look plausible. A ranked guess is not proof. Faultline asks a
narrower research question: can bounded experiments in resettable replicas
reject plausible wrong explanations and support a cause with measured evidence?

The implemented vertical slice is:

1. Generate a synthetic, seeded workload.
2. Run a healthy in-memory service path (`gateway -> orders -> payments /
   inventory`).
3. Activate one documented fault and replay the same workload.
4. Build an incident brief and observed dependency graph.
5. Propose three schema-validated mock hypotheses.
6. Run control, treatment, and after phases in a disposable/resettable
   replica.
7. Classify the result from measurements, then verify candidate patch behavior
   with constrained data-only operations and anti-test-tampering checks.

## Quick start

### Prerequisites

- Linux (or the provided Node container)
- Node.js **22.x**; `.nvmrc` pins `22` and `package.json` requires `>=22.14.0 <23`
- npm bundled with Node.js
- GNU Make for convenience targets

No database, API key, cloud account, Docker daemon, or network is needed for
the verification gate. The committed `package-lock.json` is the dependency
lockfile.

```sh
git clone https://github.com/nitin864/3AM-labs 3AM-labs
cd faultline-lab
nvm use                         # install Node 22 first if required
make setup                      # npm ci --ignore-scripts
make test                       # offline reproducibility gate
make demo                       # one-command human-readable demo
```

`make demo` regenerates the measured benchmark artifact and then runs
`tests/demo.mjs`. It does not start a server, Docker, network connection,
repair, or deployment. Its exact transcript is described in
[docs/demo-script.md](docs/demo-script.md).

### Demo media and deployment links

No demo video, hosted deployment, screenshot, or GIF is included in this
checkout, and there is no honest hosted deployment URL to publish. The shipped
web UI is available locally at `http://localhost:4173` after the documented
Vite command. The reproducible terminal substitute is the command above; do
not interpret it as a hosted product or cached UI.

The optional compiled runtime can be exercised after setup:

```sh
npm run build:lab
node lab/dist/runtime/cli.js demo
node lab/dist/runtime/cli.js scenarios
```

The optional Compose entrypoint runs that compiled runtime in a read-only,
process-local container:

```sh
docker compose run --rm faultline-lab
```

### Optional localhost API and console

`make test` builds and checks both app directories without starting servers. To
run the actual local integration surfaces, first run `make setup`, then build
the root lab/packages and use two terminals:

```sh
npm run build

# terminal 1: local API, 127.0.0.1:3001, in-memory state
cd apps/api
npm ci
npm test
npm start

# terminal 2: Vite console, http://localhost:4173
cd apps/web
npm install
npm run dev
```

Set `VITE_API_BASE_URL=http://127.0.0.1:3001` for the web dev process to use
the API. Without that variable the console visibly uses its deterministic
**Cached demo** data. The API is localhost-bound, process-local, and exposes
the Section 14 routes including SSE incident events; it does not persist data
or run arbitrary commands.

Both app directories have package-local lockfiles and passing package-local
checks. The console can be built/run with the documented Vite commands, but
its cached views contain deterministic fixture presentation and are not a
persisted benchmark report.

## Architecture and workflow

```text
seeded synthetic workload
          |
          v
in-memory LabRuntime + fault marker
          |
          v
logs / traces / metrics / outcomes
          |
          v
incident-brief  --->  observed dependency graph
          |                         |
          +------------+------------+
                       v
             bounded mock hypotheses
                       |
                       v
       replica runner: control / treatment / after
                       |
                       v
     deterministic judge: supported / rejected / inconclusive
                       |
                       v
   constrained verifier: build / tests / replay / integrity
```

The detailed component boundaries and current-versus-planned architecture are
in [docs/architecture.md](docs/architecture.md). The package flow is
`contracts -> incident-brief + graph-builder -> agent-orchestrator ->
replica-runner -> experiment-engine -> verifier`; `lab/` supplies the local
runtime and telemetry.

## The one-command demo

`make demo` is the reproducible review path. It performs:

- reset and healthy baseline: 20 requests, 20 successes, 0 errors, 20
  downstream completions;
- explicit `fault-4-timeout-mismatch`: caller timeout 150 ms versus downstream
  latency 220 ms, 20 false timeouts, and 20 downstream completions;
- reset/recovery: timeout 250 ms, 20 successes, and 0 false timeouts.

These values are assertions in `tests/harness.mjs`, not labels supplied by an
agent. The compiled `lab` CLI provides the same baseline/fault/reset sequence
as JSON metrics, but is not what `make demo` invokes.

## Fault catalog

The runtime exposes four resettable scenario IDs:

| ID | Current deterministic treatment | Current verification evidence |
| --- | --- | --- |
| `fault-2-pool-exhaustion` | Two connections for eight concurrent requests; acquisition timeouts and leaked leases | 6 acquisition timeouts, 2 leaked connections; control has 0/0 |
| `fault-4-timeout-mismatch` | 150 ms caller timeout against a fixed 220 ms downstream p95 | 20 caller timeouts and 20 downstream completions; reset removes timeouts |
| `fault-5-oversell-race` | Fixed check-then-act interleaving from stock 1 | Treatment reaches stock -1 with 2 successes; atomic control has 1 success and stock 0 |
| `fault-6-poison-queue` | Poison message is retried at queue head | 4 poison attempts, 0 valid messages, depth 3; control dead-letters poison and drains 2 valid messages |

The full ground truth, activation/reset behavior, and evidence rules are in
[docs/fault-catalog.md](docs/fault-catalog.md). The experiment engine currently
accepts only `fault-4-timeout-mismatch` and `fault-5-oversell-race` for its
control/treatment/after experiment API; the other two are runtime scenarios,
not claimed end-to-end experiment results.

## Outcome semantics

Faultline separates execution state from causal classification:

- **supported**: healthy control, valid treatment reproduces the predicted
  symptom, and reset/after removes it;
- **rejected**: a valid controlled experiment contradicts the prediction, or
  the symptom remains after reset;
- **inconclusive**: the control or phase was unhealthy/incomplete, metrics were
  missing, cleanup failed, workload comparability failed, or measurements did
  not distinguish the hypothesis.

Experiment execution statuses (`queued`, `running`, `passed`, `failed`,
`inconclusive`, `cancelled`, `error`) must not be conflated with a hypothesis
classification. See [docs/experiment-protocol.md](docs/experiment-protocol.md).

## Measured benchmark and artifact status

The benchmark package can generate an artifact with
`npm run benchmark --workspace @faultline/benchmark`; its default destination
is `artifacts/benchmark/result.json` (the directory is created on demand and
is not committed in this checkout). The Task 5 integration test separately
prints JSON to stdout and asserts measured values. The available benchmark
artifact fields are:

- incident brief: baseline/incident request and error counts, error rate,
  p50/p95 latency when present, deltas, error types and evidence references;
- dependency graph: nodes, observed edges, weights/annotations, and
  `causalInterpretation: "observed_dependencies_only"`;
- hypotheses: three mock, schema-validated hypotheses with evidence refs and
  predictions;
- experiments: control/treatment/after measurements, classification,
  rationale, exit codes, cleanup, and evidence IDs;
- patch verification: status, build/test/replay/integrity booleans and failure
  reasons.

The current Task 5 integration assertions measured `supported` for timeout
mismatch and oversell race. It observed timeout treatment values of 20 with 20
completed downstream operations, and oversell treatment with negative stock and
a broken inventory invariant. It also verifies a repair from `150` to `250`
and rejects deletion of a test file. The test prints scenario-specific latency
examples (timeout incident p95 224 ms; oversell incident p95 44 ms) from this
synthetic fixture.

The benchmark artifact itself is measured and deterministic. With its default
configuration (`fault-4-timeout-mismatch`, `fault-5-oversell-race`, workload
seed `10`, workload count `80`, three hypotheses, 500 operations and 30,000
logical milliseconds per replica), a run produced:

| Metric | Aggregate result |
| --- | ---: |
| `top1_accuracy` | 1 |
| `top3_recall` | 1 |
| `supported_cause_correct` | 1 |
| `false_support_count` | 0 |
| `inconclusive_rate` | 0.333333 |
| `experiment_count` | 6 |
| `token_usage` | 67047 (estimated from serialized inputs/outputs) |
| `time_to_diagnosis` | 23082 logical milliseconds |
| `verified_fix_rate` | Not measured |
| `time_to_verified_fix` | Not measured |
| `resource_usage` | Not measured |

Each scenario had `top1_accuracy: true`, `top3_recall: true`,
`supported_cause_correct: true`, `false_support_count: 0`, three experiments,
one rejected and one inconclusive negative-control hypothesis
(`inconclusive_rate: 0.333333`). The timeout row measured 14,382 logical
milliseconds to diagnosis; the oversell row measured 31,782. These are tiny
deterministic fixture measurements, not production accuracy or performance
claims. The benchmark test validates the current one-rejected,
one-inconclusive negative-control outcome per scenario.

Metrics not measured by the current benchmark are `verified_fix_rate`,
`time_to_verified_fix`, and `resource_usage` (per scenario and aggregate).
No production accuracy or performance claim should be inferred from the
fixture.

Method definitions and the reproducible run protocol are in
[docs/benchmark-methodology.md](docs/benchmark-methodology.md).

## Live versus cached behavior

Everything included here is local and live at invocation time in the sense that
the harness or compiled runtime executes a fresh in-memory deterministic run.
There is no hosted UI. The web console does include bundled cached demo data;
JSON logged by the integration test is ephemeral stdout, not a stored artifact.
The localhost API/SSE and console are live local surfaces when started as
above. The console falls back to deterministic cached demo data when no API is
configured or reachable and shows the source badge. There is no hosted result
or deployment URL in this checkout. Any future hosted deployment must retain
the same explicit live/cached labeling and local gate.

## Security boundaries and limitations

The lab uses synthetic data, in-memory persistence, bounded deterministic
workloads, and no production credentials. The verifier restricts patch paths,
diff operations, test integrity, and replay checks. Repository text, logs, and
agent output are untrusted data; they are not authority to run commands.

This prototype does not provide production container isolation, arbitrary
repository support, real traffic replay, durable persistence, a cloud provider
adapter, autonomous repair, deployment, or protection from every host-level
resource risk. The API and console are local-only and are not a production
control plane. Do not mount a host filesystem or Docker socket into an
untrusted worker, add credentials to the lab, or point it at production.
The threat model and mitigations are in [docs/threat-model.md](docs/threat-model.md).

Other limitations are deliberate: only a small synthetic fault catalog is
exercised, experiment environments are in-memory rather than production-
faithful, agent output can be wrong, and a candidate patch remains untrusted
until deterministic verification passes.

## Reproducibility and container check

```sh
docker build --network=none -t faultline-lab:local .
docker run --rm --network=none faultline-lab:local
```

The image's default command is `npm test`; Docker is a build/runtime check and
is not required for `make test`. `.env.example` contains only local defaults;
no `.env` file is required.

## Project layout

```text
README.md, SPEC.md             project guide and canonical specification
Makefile, Dockerfile           setup/test/demo and reproducible image
lab/                           deterministic runtime, telemetry, faults, CLI
apps/api                       localhost-only Fastify API and SSE seam
apps/web                       React/Vite console with live/cached badge
packages/contracts             Zod contracts for incident/evidence/agent data
packages/incident-brief        measured incident summary builder
packages/graph-builder         observed dependency graph builder
packages/agent-orchestrator    bounded mock-agent adapter and validation
packages/replica-runner        resettable experiment replicas
packages/experiment-engine     measurement-only experiment judge
packages/verifier              constrained patch/replay/test-integrity checks
packages/benchmark             measured Mode A/Mode B scoreboard generator
tests/                         offline gate, runtime tests, demo, Task 5 E2E
docs/                          architecture, protocol, benchmark, safety, demo
artifacts/benchmark             tracked deterministic benchmark JSON artifact
```

## Roadmap

1. Add a hosted deployment only with explicit live/cached labeling and an SSE seam.
2. Expand benchmark coverage with scenario/configuration/version metadata and held-out cases.
3. Implement a measured evidence-only baseline and repeatable ablation runs.
4. Add provider adapters behind the existing mock boundary after confirming the
   official OmniRush API; keep local development offline.
5. Improve isolation/resource controls before considering broader repositories
   or any external GitHub operation.

These are plans, not current capabilities.

For an item-by-item mapping to SPEC.md §20, see
[docs/acceptance-status.md](docs/acceptance-status.md).

## Contributing and license

Contributions should preserve deterministic fixtures, explicit reset, honest
`Not measured` reporting, and the offline `make test` gate. Keep new scenario
ground truth and verification rules alongside the implementation; do not add
production connectors or credential handling without a reviewed boundary.
Run `make test` before submitting changes and describe any measured output.

No `LICENSE` file is currently present in this checkout, so the project has no
declared license yet. Do not assume the repository grants reuse rights; add a
license and contribution policy as a maintainer decision before publishing a
formal open-source release.
