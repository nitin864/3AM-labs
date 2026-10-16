# Demo script

## Recommended review command

After installing dependencies with `make setup`, run:

```sh
make demo
```

This is the canonical one-command demo. It first regenerates the measured
Mode A/Mode B artifact with `@faultline/benchmark`, then invokes
`node tests/demo.mjs`, which calls `runVerification({ print: true })` from
`tests/harness.mjs`. It intentionally bypasses the optional API and web
console so it remains an offline check.

## What it does

The baseline/fault/reset harness is deliberately smaller than the full
TypeScript integration and
has no clock, socket, Docker, network, random input, or external agent:

1. Generate `artifacts/benchmark/result.json` from the two measured benchmark
   scenarios.
2. Create the lab with a healthy timeout of 250 ms and downstream latency of
   220 ms.
3. Reset and run 20 requests.
4. Activate exactly `fault-4-timeout-mismatch` and run 20 requests.
5. Reset and run 20 requests again.
6. Print one PASS/FAIL line per check and a summary.

Expected summary:

```text
Verification gate: PASS (11/11)
Mode: local deterministic harness; Docker and network are not used.
```

The individual check names are the contract: healthy baseline health, 100%
success, no errors, completion invariant; explicit activation; 20 false
timeouts; downstream completion evidence; timeout ordering; reset health,
success, and cleared timeouts.

## Optional deeper run

The compiled runtime gives JSON metrics for the same sequence:

```sh
npm run build:lab
node lab/dist/runtime/cli.js demo
```

The Task 5 experiment-confirmed flow is already covered by the benchmark and
is also available as a separate test command:

```sh
node --test tests/task5.integration.test.mjs
```

It builds briefs and observed graphs, generates three mock hypotheses, runs
supported experiments for timeout mismatch and oversell race, and checks patch
verification. Its JSON is printed to stdout; the benchmark artifact is the
persisted JSON scoreboard.

## Demo honesty

This demo is a fresh local deterministic execution, not a cached hosted result
and not a production incident replay. It does not start the optional API or web
UI, contact an OmniRush provider, repair source code, or deploy anything. The
web console's cached demo mode is a separate UI fallback and must not be
confused with this live local harness run.
