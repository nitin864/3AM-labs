# Faultline Lab

> Others rank hypotheses. Faultline reproduces them.

Faultline Lab is a controlled incident-investigation prototype. This
repository currently provides the reproducibility gate for the first vertical
slice: a healthy synthetic workload, the deterministic
`fault-4-timeout-mismatch` symptom, and reset/recovery. It is a lab fixture,
not production incident-response software.

## Quick start

Requirements:

- Linux (the commands below are also suitable for the project Docker image)
- Node.js **22.x**, pinned by `.nvmrc` and `package.json`
- npm bundled with Node.js
- GNU Make for the convenience targets

No database, Docker daemon, network access, API key, or OmniRush account is
needed for the offline verification gate.

```sh
git clone <repository-url> faultline-lab
cd faultline-lab
nvm use                         # reads .nvmrc; install Node 22 first if needed
make setup                      # npm ci --offline, then a local-only check
make test                       # the single reproducibility/verification gate
make demo                       # human-readable baseline/fault/reset output
```

`make setup` uses the committed lockfile and installs dependencies into the
project only. `.env.example` documents the optional local parameters; the gate
does not load secrets or require an `.env` file. Once setup is complete, the
test and demo commands are offline.

## What the gate proves

`make test` first runs the existing locked workspace contract tests, then runs
`node --test tests/verification.test.mjs` against the local deterministic
harness in `tests/harness.mjs`. It never starts Docker and never opens a
network connection.

The gate asserts all of the following with measured values, not labels from an
agent:

1. A healthy baseline is healthy, has 20/20 successful requests, zero errors,
   and one downstream completion per request.
2. Activating the explicit stable fault ID
   `fault-4-timeout-mismatch` sets a 150 ms caller timeout against a 220 ms
   downstream operation and deterministically records 20 false timeouts while
   all 20 downstream operations complete.
3. Resetting the lab returns the timeout to 250 ms and restores 20/20 success,
   zero false timeouts, and a healthy check.

There are four test cases and eleven gate checks. A failing check exits nonzero
and prints its name. `make demo` prints the same evidence as a short, reviewable
transcript and performs no repair or deployment action.

## Commands and container check

| Command | Purpose | External effects |
| --- | --- | --- |
| `make setup` | Validate Node 22 and install the lockfile | Project-local npm metadata only |
| `make test` | Run the offline verification gate | No network, Docker, or production actions |
| `make demo` | Print a baseline/fault/reset transcript | No network, Docker, or production actions |
| `npm test` | Direct equivalent of `make test` | Same |

The Dockerfile is a reproducibility/build check, not a required test
dependency. To build and run it:

```sh
docker build --network=none -t faultline-lab:local .
docker run --rm --network=none faultline-lab:local
```

The image runs `npm test`. Docker itself is not used by the tests and is not
required on a developer machine.

## Deploy / release boundary

This slice has no server, HTTP listener, hosted dashboard, or deployment
workflow. There is therefore no honest production deployment command. A
reviewer can produce the immutable local image with the `docker build` command
above and run its test-only default command. Do not point it at production,
mount a host filesystem, add credentials, or treat a passing gate as a live
service deployment.

If a future UI or API is added, its deployment instructions must separately
identify live versus cached results and must retain this offline gate.

## Runtime and dependency reproducibility

- `.nvmrc` pins Node.js to the 22 major line; `package.json` enforces 22.x.
- `package-lock.json` is committed and `make setup` uses `npm ci`.
- Dependencies are installed only in the project; there are no global install
  requirements.
- All generated inputs are synthetic and deterministic; the default request
  count is 20 and the documented seed is `20261016`.
- Do not install project dependencies globally or use `sudo`. Keep additions
  in `package.json` and regenerate the lockfile with the pinned Node/npm.

## Limitations and safety

This gate verifies a deterministic vertical-slice contract; it does not claim
that a distributed production system has been diagnosed. It does not measure
real latency distributions, persistence, traces, container isolation, agent
quality, benchmark accuracy, or a verified code patch. The timeout scenario is
synthetic and intentionally has a known ground truth. No result should be
reported as a production repair or as evidence about incidents outside this
fixture.

The project follows the specification's boundaries: synthetic data only,
explicit reset, bounded local workload, deterministic pass/fail checks, and no
automatic production actions. Unsupported or future scenarios must remain
visible as unsupported/inconclusive rather than being turned into fabricated
success metrics.

## Layout

```text
Makefile                 Offline setup/test/demo entrypoints
Dockerfile               Reproducible test-only image
tests/harness.mjs        Deterministic local fault/reset harness
tests/verification.test.mjs  Node test gate
tests/demo.mjs            Human-readable local transcript
SPEC.md                  Canonical project specification
```
