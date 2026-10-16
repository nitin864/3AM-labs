# Fault catalog

All scenarios are synthetic, deterministic, resettable fixtures. A scenario's
ground truth is the injected condition; telemetry alone does not prove it.

## `fault-2-pool-exhaustion`

- **Component:** connection pool / orders path.
- **Treatment:** pool size 2 for 8 concurrent requests; acquired leases leak.
- **Control:** pool size 8; leases release.
- **Treatment evidence:** 2 requests acquire, 6 acquisition timeouts, 2 leaked
  connections, saturated pool.
- **Control evidence:** 8 acquire, 0 timeouts, 0 leaks.
- **Reset:** restore pool size 8 and release behavior.
- **Experiment API:** runtime scenario only; not currently accepted by
  `ExperimentEngine`.

## `fault-4-timeout-mismatch`

- **Component:** payment caller.
- **Treatment:** caller timeout 150 ms; fixed downstream latency trace has p95
  220 ms.
- **Control:** timeout 250 ms.
- **Treatment evidence:** 20 caller timeouts while all 20 downstream operations
  complete; false-timeout rate 1.
- **Reset/after evidence:** 0 timeouts and healthy replay.
- **Accepted by:** `ExperimentEngine` and the `make demo` harness.

## `fault-5-oversell-race`

- **Component:** inventory reservation.
- **Treatment:** fixed check-then-act interleaving lets two buyers observe stock
  1 before either decrement.
- **Control:** atomic reservation allows one success.
- **Treatment evidence:** 2 successes, final stock -1, invariant false.
- **Control/after evidence:** 1 success, final stock 0, invariant true.
- **Runtime note:** the full Task 5 integration expands its workload to 80
  requests with quantity 2 to cross the stock boundary. The standalone fault
  class uses its fixed two-request stock-1 fixture.
- **Accepted by:** `ExperimentEngine`.

## `fault-6-poison-queue`

- **Component:** queue worker.
- **Treatment:** the first malformed message is requeued at the head for four
  bounded attempts.
- **Control:** poison is dead-lettered and two valid messages drain.
- **Treatment evidence:** 4 poison attempts, 0 valid messages, queue depth 3,
  no dead-letter.
- **Control evidence:** 1 poison attempt, 2 valid messages, 1 dead-letter,
  queue depth 0.
- **Reset:** restore dead-letter handling and the fixed three-message queue.
- **Experiment API:** runtime scenario only; not currently accepted by
  `ExperimentEngine`.

## Selection and interpretation

Scenarios were selected for repeatability and measurable symptoms, not breadth.
Fault markers are explicit runtime telemetry. The observed graph and incident
brief summarize evidence; they do not turn a scenario into causal proof. The
experiment judge requires its predefined control/treatment/after rule.
