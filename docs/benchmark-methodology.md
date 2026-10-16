# Benchmark methodology and current results

## Intended comparison

SPEC.md defines two modes:

- **Evidence-only ranking (Mode A):** build the brief and observed graph and
  rank causes without causal experiments.
- **Experiment-confirmed (Mode B):** start from comparable evidence and run
  bounded control/treatment/after experiments.

This repository implements a deterministic Mode A/Mode B benchmark package.
`@faultline/benchmark` writes the tracked `artifacts/benchmark/result.json`;
rerunning the command regenerates it from the current source. The benchmark is
still a tiny fixture, not a production evaluation.

## Available test artifact fields

The benchmark artifact (`schemaVersion: "faultline-benchmark/v1"`,
`benchmarkVersion: "0.1.0"`) has `runConfig`, `scenarios`, and `aggregate`.
Each scenario row includes `scenarioId`, `scenarioVersion`, `trueCause`,
`workloadId`, `evidenceDigest`, `graphDigest`, `hypothesisIds`, `modeA`,
`modeB`, and the snake-case scoreboard fields. `modeA` includes ranked
hypothesis IDs, top-1/top-3 booleans, candidate count, token usage, and
resource usage. `modeB` includes each hypothesis result, correctness,
false-support and inconclusive counts/rate, fix status, timing, experiment
count, token usage, and resource usage. The aggregate contains the corresponding
rates/counts plus nested Mode A/Mode B totals.

The separate `tests/task5.integration.test.mjs` prints ephemeral JSON for two
scenarios. Its fields include:

- `fault`;
- `baseline`: error rate and scenario-specific measured values;
- `incident`: error rate, p95 latency, error types/counts/evidence-reference
  counts;
- `hypotheses`: the three mock hypothesis titles;
- `graph`: node/edge counts and causal interpretation where emitted;
- `experiment`: classification and measured treatment/after values.

The test also asserts patch verification status and anti-cheat failure reasons.
Its stdout is not the benchmark artifact and is not a cache or hosted result.

Generate the benchmark artifact with:

```sh
npm run benchmark --workspace @faultline/benchmark
```

The default output is `artifacts/benchmark/result.json`; the directory is
created on demand. Use `--out <path>` with the compiled CLI to choose another
destination.

## Results present in the current fixture

The default benchmark run supports both tested scenarios:

| Scenario | Measured evidence asserted |
| --- | --- |
| `fault-4-timeout-mismatch` | Mode A top-1/top-3 true; Mode B supported cause correct; 0 false supports; 1/3 rejected and 1/3 inconclusive; 3 experiments; 14,407 estimated tokens; 14,382 logical ms to diagnosis |
| `fault-5-oversell-race` | Mode A top-1/top-3 true; Mode B supported cause correct; 0 false supports; 1/3 rejected and 1/3 inconclusive; 3 experiments; 52,640 estimated tokens; 31,782 logical ms to diagnosis |

The Task 5 integration additionally asserts baseline/incident p95 examples of
224 ms and 44 ms respectively, timeout treatment of 20/20 with downstream
completion, and oversell invariant recovery. Those stdout assertions are
described in the README and are separate from the benchmark artifact.

These are deterministic synthetic fixture values, not a sample of production
incidents and not an accuracy estimate.

## Not measured

The following fields are explicitly **Not measured** by the current benchmark:
`verified_fix_rate`, `time_to_verified_fix`, and `resource_usage` (scenario and
aggregate). Token usage is an estimate based on serialized input/output length,
not provider-billed tokens. Logical diagnosis time is derived from deterministic
phase durations, not wall-clock latency. `top1_accuracy` and `top3_recall` are
currently trivially perfect because the deterministic fixture ranks the known
mechanism first; this is not evidence of general diagnostic accuracy.

Do not fill these with the two fixture classifications. To add a benchmark,
record scenario version, workload manifest/seed, prompt and adapter version,
configuration, run count, all failures, classifications, timestamps, and actual
token/resource measurements (or `Not measured`). Keep tuning and held-out
scenarios distinct.

## Re-run

```sh
npm run build:lab
npm run test --workspace @faultline/experiment-engine
node --test tests/task5.integration.test.mjs
```

For the review-friendly baseline/fault/reset gate use `make demo`; it is a
separate harness and is not the Mode A/Mode B benchmark.
