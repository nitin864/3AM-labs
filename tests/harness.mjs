/**
 * Tiny deterministic local harness used by the verification gate.
 *
 * This models the Faultline vertical-slice contract without Docker, a network,
 * a clock, or random input. The production lab can be wired to this same
 * observable contract as it lands; verification must always assert measured
 * values rather than labels supplied by an agent.
 */
// Mirrors the checked-in fault scenario's control/treatment contract while
// keeping this gate runnable by Node alone (without a TypeScript build).
export const HEALTHY = Object.freeze({ timeoutMs: 250, downstreamMs: 220 });
export const FAULT_4 = 'fault-4-timeout-mismatch';

export function createLab() {
  let timeoutMs = HEALTHY.timeoutMs;

  return {
    reset() {
      timeoutMs = HEALTHY.timeoutMs;
      return this.health();
    },
    activate(faultId) {
      if (faultId !== FAULT_4) throw new Error(`unknown fault: ${faultId}`);
      timeoutMs = 150;
      return { faultId, active: true, timeoutMs };
    },
    health() {
      return { healthy: timeoutMs >= HEALTHY.downstreamMs, timeoutMs };
    },
    workload({ requests = 20 } = {}) {
      const falseTimeouts = timeoutMs < HEALTHY.downstreamMs ? requests : 0;
      const successes = requests - falseTimeouts;
      return {
        requests,
        successes,
        errors: falseTimeouts,
        falseTimeouts,
        downstreamCompletions: requests,
        timeoutMs,
        downstreamMs: HEALTHY.downstreamMs,
      };
    },
  };
}

export function runVerification({ print = false } = {}) {
  const lab = createLab();
  const checks = [];
  const check = (name, condition, detail) => {
    checks.push({ name, ok: Boolean(condition), detail });
  };

  const baselineHealth = lab.reset();
  const baseline = lab.workload();
  check('healthy baseline health check', baselineHealth.healthy, baselineHealth);
  check('healthy baseline has 100% success', baseline.successes === baseline.requests, baseline);
  check('healthy baseline has no errors', baseline.errors === 0, baseline);
  check('healthy baseline invariant: completions equal requests', baseline.downstreamCompletions === baseline.requests, baseline);

  const activation = lab.activate(FAULT_4);
  const faulted = lab.workload();
  check('fault-4 activation is explicit', activation.faultId === FAULT_4 && activation.active, activation);
  check('fault-4 deterministically reproduces false timeout', faulted.falseTimeouts === faulted.requests && faulted.errors === faulted.requests, faulted);
  check('fault-4 preserves downstream completion evidence', faulted.downstreamCompletions === faulted.requests, faulted);
  check('fault-4 timeout is shorter than downstream latency', faulted.timeoutMs < faulted.downstreamMs, faulted);

  const resetHealth = lab.reset();
  const recovered = lab.workload();
  check('reset restores healthy health check', resetHealth.healthy, resetHealth);
  check('reset restores 100% success', recovered.successes === recovered.requests, recovered);
  check('reset clears false timeouts', recovered.falseTimeouts === 0, recovered);

  const ok = checks.every(({ ok: passed }) => passed);
  if (print) {
    for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}`);
    console.log(`Verification gate: ${ok ? 'PASS' : 'FAIL'} (${checks.filter((item) => item.ok).length}/${checks.length})`);
    console.log('Mode: local deterministic harness; Docker and network are not used.');
  }
  return { ok, checks };
}
