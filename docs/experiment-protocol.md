# Experiment protocol

## Goal

Test one hypothesis with one mutable treatment condition against the same
synthetic workload. The experiment engine's rule is:

> healthy control; valid treatment reproduces the fault prediction; valid reset
> / after removes it.

## Phases

1. Create or load a workload manifest and confirm its request count matches the
   request list.
2. Start a fresh replica and run the control with no active fault.
3. Validate control health, workload matching, metrics, exit code, and cleanup.
4. Activate exactly the requested fault ID and replay the same manifest as the
   treatment.
5. Reset the replica, replay the manifest as the after phase, and collect the
   same measurements.
6. Judge measurements. Do not use agent confidence or the injected label as
   proof.

The current `ReplicaRunner` also records health-before/after, timeout state,
cleanup receipts, phase run data, and command exit codes. The experiment result
contains control/treatment/after measurements, classification, rationale,
evidence IDs, and phases.

## Classification

- **supported**: valid healthy control; treatment discriminates and reproduces
  the scenario prediction; after removes the symptom; all phases clean up.
- **rejected**: the valid treatment contradicts the prediction, or the symptom
  remains after reset.
- **inconclusive**: control or another phase is unhealthy, times out, lacks
  metrics, has a mismatched workload, fails cleanup, or does not discriminate.

The corresponding execution status (`passed`, `failed`, or `inconclusive`) is
reported separately. Infrastructure failure is not automatically evidence that
the hypothesis is false.

## Current accepted scenarios

`ExperimentEngine` currently accepts `fault-4-timeout-mismatch` and
`fault-5-oversell-race`. It rejects unsupported IDs before replay. Runtime
scenarios `fault-2-pool-exhaustion` and `fault-6-poison-queue` have deterministic
scenario classes and verification methods, but are not claimed as accepted
end-to-end `ExperimentEngine` scenarios.

## Evidence and limits

The engine measures requests, successes/failures, error rate, health, timeout
state, workload matching, cleanup, pool timeouts, queue depth, inventory state,
downstream p95, timed-out requests, downstream completions, and false-timeout
rate where available. Measurements are finite data; missing measurements cause
an inconclusive result rather than an estimate.

The workload is synthetic and bounded. The runtime is not a production replica,
does not use wall-clock sleeps or external services, and does not establish
causality outside the defined fixture.
