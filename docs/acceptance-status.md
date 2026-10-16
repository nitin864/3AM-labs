# Acceptance status

This page maps the current checkout to the Definition of Done in SPEC.md §20.
It records what the repository actually verifies; an unchecked item is not a
claim that the feature exists elsewhere.

## Functional

| Criterion | Status | Evidence or honest gap |
| --- | --- | --- |
| Fresh checkout uses documented commands | **Implemented** | `.nvmrc`, lockfile, `make setup`, `make test`, and `make demo` |
| Healthy baseline is measured | **Implemented** | Deterministic harness and `LabRuntime` metrics |
| Fault activates and resets reliably | **Implemented** | Four runtime scenarios; timeout scenario in the gate |
| Fault has repeatable measurable symptom | **Implemented** | 11/11 local gate checks and scenario verifiers |
| Logs and correlated traces/metrics where implemented | **Implemented** | `TelemetryRecorder`, run metrics, spans, logs, markers |
| Deterministic incident brief | **Implemented** | `@faultline/incident-brief` |
| At least two schema-valid hypotheses | **Implemented** | Mock adapter emits three in Task 5 integration |
| Testable predictions | **Implemented** | Hypothesis and experiment-plan contracts |
| Isolated/resettable experiment | **Implemented** | In-memory fresh replicas in `@faultline/replica-runner` |
| Explicit evidence-based judge | **Implemented** | `@faultline/experiment-engine` |
| Rejected/inconclusive outcomes remain possible | **Implemented** | Judge validation and classification semantics |
| Repair can be proposed | **Partial** | Adapter contract exists; shipped mock intentionally proposes no patch |
| Tests and workload replay verify repair | **Implemented in fixture** | Task 5 verifier test uses injected runners and replay metrics |
| Test-integrity checks | **Implemented** | Deleted/disabled/reduced tests are rejected |
| UI displays state/evidence/verification | **Implemented local** | `apps/web` provides all eight views, live/cached badges, API/SSE client wiring, and a passing Vite build/smoke test; it is not hosted |
| Benchmark records real measurements | **Implemented local** | `@faultline/benchmark` writes the tracked `artifacts/benchmark/result.json` and validates deterministic Mode A/Mode B output |

## Reliability and safety

| Criterion | Status | Evidence or honest gap |
| --- | --- | --- |
| Experiment operation/time bounds | **Implemented** | Replica and verifier limits; deterministic logical duration |
| Cleanup after phases | **Implemented** | Cleanup receipt and judge checks |
| No silent cross-experiment contamination | **Implemented in process model** | Fresh replicas and reset; not hardened host isolation |
| No production credentials/targets required | **Implemented** | Offline synthetic defaults |
| No automatic production deployment | **Implemented** | No deployment integration exists |
| Secrets excluded from artifacts | **Implemented by boundary** | `.env.example` has defaults only; the tracked benchmark artifact contains deterministic synthetic values |
| Failure/inconclusive visibility | **Implemented** | Explicit statuses and rationales |

## Submission artifacts

Public repository status, license, demo video, hosted deployment, and actual UI
media are **Not present in this checkout**. The README labels these gaps rather
than linking to invented artifacts. The local reproducible command, localhost
API/console, benchmark artifact, and actual fixture results are available.
