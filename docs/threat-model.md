# Threat model and security boundaries

Faultline is a local experiment lab. Treat experiment inputs, repository files,
logs, telemetry, generated diffs, and agent output as untrusted data.

## Assets and trust boundaries

- **Host/workspace:** must not be treated as disposable merely because a lab
  run is local.
- **Replica/runtime:** synthetic, in-memory, and bounded in the current
  implementation; it is not a security sandbox.
- **Agent adapter:** may propose hypotheses or patches, but has no authority to
  declare truth or deploy a change.
- **Verifier:** deterministic policy boundary for allowed patch operations,
  diff scope, build/tests, replay, and test integrity.
- **Evidence/report:** must contain references to actual measurements and no
  secrets.

## Threats and current controls

| Threat | Current boundary/mitigation | Remaining limitation |
| --- | --- | --- |
| Agent proposes destructive shell command | Current runtime and verifier do not execute arbitrary agent shell commands; patch operations are constrained data-only operations | A future runner must use an allowlist, timeouts, resource limits, and disposable non-privileged workers |
| Fault leaks between experiments | Fresh `ReplicaRunner` phases and `LabRuntime.reset()` clear in-memory state; cleanup is part of the judge | This is process isolation, not a hardened container boundary |
| Prompt injection in logs/source | Repository and telemetry content is data; schema validation and deterministic judging remain authoritative | A future provider integration needs explicit prompt/data separation and output filtering |
| Agent accesses secrets/env | No credentials are needed; default runs are offline and synthetic | Do not run with production credentials or expose environment data to workers |
| Patch weakens tests | Verifier checks deleted/changed test integrity, counts/assertions, allowed paths, and replay | Review is still required for any future broader patch surface |
| Runaway workload exhausts host | Workloads and replica limits are bounded in code | The current in-memory process is not a host-level quota mechanism |
| Unsupported causality is reported | Graph is labeled observed-only; classifications require measured rules; missing evidence is inconclusive | The prototype cannot prove real-world causality beyond its fixture |
| Cached output mistaken for live run | No hosted/cached UI exists; test JSON is ephemeral stdout and docs say so | Future UI must label live, cached, observed, inferred, supported, and verified states |

## Operator rules

Use synthetic data only. Do not point the lab at production, mount broad host
paths, mount a Docker socket into an untrusted worker, add credentials to
artifacts, or treat a passing test as permission to deploy. Any future GitHub,
cloud, or deployment action requires explicit human approval and a separately
reviewed integration.
