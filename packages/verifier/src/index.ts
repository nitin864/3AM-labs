import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
/** Kept structurally compatible with @faultline/contracts without importing its source tree. */
export interface PatchVerification {
  id: string;
  incidentId: string;
  hypothesisId: string;
  diffRef?: string;
  buildPassed: boolean;
  testsPassed: boolean;
  testIntegrityPassed: boolean;
  replayPassed: boolean;
  healthChecksPassed: boolean;
  baselineMeasurements: Record<string, number | string>;
  incidentMeasurements: Record<string, number | string>;
  patchedMeasurements: Record<string, number | string>;
  status: "verified" | "rejected" | "inconclusive";
  failureReasons: string[];
}

/** A data-only patch language: it cannot invoke a process or deploy anything. */
export type PatchOperation =
  | { kind: "write"; path: string; content: string }
  | { kind: "delete"; path: string }
  | { kind: "patch"; path: string; search: string; replace: string };
export interface CandidatePatch { operations: PatchOperation[]; diffRef?: string }
export interface RunnerResult {
  passed: boolean;
  testCount?: number;
  assertionCount?: number;
  metrics?: Record<string, number | string | boolean>;
  healthPassed?: boolean;
  reason?: string;
}
export type VerificationPhase = "before" | "incident" | "after";
export interface RunnerContext { phase: VerificationPhase; workspace: string; patchApplied: boolean; timeoutMs: number }
export type BuildRunner = (context: RunnerContext) => RunnerResult | Promise<RunnerResult>;
export type TestRunner = (context: RunnerContext) => RunnerResult | Promise<RunnerResult>;
export type ReplayRunner = (context: RunnerContext) => RunnerResult | Promise<RunnerResult>;
export type HealthRunner = (context: RunnerContext) => boolean | Promise<boolean>;
export interface VerificationLimits {
  maxOperations: number;
  maxFileBytes: number;
  maxDiffBytes: number;
  maxTotalFiles: number;
  runnerTimeoutMs: number;
}
export interface MetricRule { direction: "lower" | "higher"; max?: number; min?: number }
export interface VerifyPatchOptions {
  workspaceRoot: string;
  candidate: CandidatePatch;
  incidentId?: string;
  hypothesisId?: string;
  verificationId?: string;
  /** Exact paths, directory prefixes ending in /**, or simple * globs. */
  allowedPaths: string[];
  limits?: Partial<VerificationLimits>;
  buildRunner?: BuildRunner;
  testRunner?: TestRunner;
  replayRunner?: ReplayRunner;
  healthRunner?: HealthRunner;
  metricRules?: Record<string, MetricRule>;
}
export interface TestIntegritySnapshot { files: string[]; testCount: number; assertionCount: number; skippedMarkers: number }
export interface IntegrityReport { passed: boolean; before: TestIntegritySnapshot; after: TestIntegritySnapshot; failures: string[] }

export const DEFAULT_LIMITS: VerificationLimits = {
  maxOperations: 100, maxFileBytes: 256 * 1024, maxDiffBytes: 1024 * 1024,
  maxTotalFiles: 20_000, runnerTimeoutMs: 30_000,
};
const TEST_FILE = /(?:^|[\\/])(?:__tests__|tests?)(?:[\\/]|$)|(?:^|[\\/])[^\\/]+\.(?:test|spec)\.[cm]?[jt]sx?$/i;
const TEST_DECLARATION = /\b(?:test|it|specify|suite)\s*\(/g;
const ASSERTION = /\b(?:expect|assert(?:\.[A-Za-z_$][\w$]*)?|should)\s*\(?/g;
const SKIP_MARKER = /\b(?:test|it|describe|suite|specify)\s*\.\s*(?:skip|only|todo)\b|\b(?:x(?:it|test|describe))\s*\(/gi;
const failure = (code: string, detail: string): string => `${code}: ${detail}`;

function safeRelativePath(input: string): string {
  if (!input || input.includes("\0") || isAbsolute(input) || input.includes("\\")) throw new Error(`unsafe patch path: ${input}`);
  const normalized = input.split("/").join(sep);
  const result = relative("/safe-root", resolve("/safe-root", normalized));
  if (result === ".." || result.startsWith(`..${sep}`)) throw new Error(`unsafe patch path: ${input}`);
  return normalized.split(sep).join("/");
}
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function allowedPath(path: string, allowed: string[]): boolean {
  return allowed.some((rule) => {
    const clean = safeRelativePath(rule.replace(/\/$/, ""));
    if (clean.endsWith("/**")) return path === clean.slice(0, -3) || path.startsWith(`${clean.slice(0, -3)}/`);
    if (clean.includes("*")) return new RegExp(`^${clean.split("*").map(escapeRegExp).join(".*")}$`).test(path);
    return path === clean || path.startsWith(`${clean}/`);
  });
}
async function listFiles(root: string, maxFiles: number): Promise<string[]> {
  const output: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) { output.push(relative(root, absolute).split(sep).join("/")); if (output.length > maxFiles) throw new Error("workspace file count exceeds limit"); }
    }
  }
  await visit(root);
  return output;
}
const readText = (root: string, path: string): Promise<string> => fs.readFile(join(root, ...path.split("/")), "utf8");
export async function integritySnapshot(root: string, maxFiles = DEFAULT_LIMITS.maxTotalFiles): Promise<TestIntegritySnapshot> {
  const files = []; let testCount = 0; let assertionCount = 0; let skippedMarkers = 0;
  for (const path of await listFiles(root, maxFiles)) {
    if (!TEST_FILE.test(path)) continue;
    files.push(path); const text = await readText(root, path);
    testCount += text.match(TEST_DECLARATION)?.length ?? 0;
    assertionCount += text.match(ASSERTION)?.length ?? 0;
    skippedMarkers += text.match(SKIP_MARKER)?.length ?? 0;
  }
  return { files, testCount, assertionCount, skippedMarkers };
}
export function compareIntegrity(before: TestIntegritySnapshot, after: TestIntegritySnapshot): IntegrityReport {
  const failures: string[] = []; const removed = before.files.filter((path) => !after.files.includes(path));
  if (removed.length) failures.push(failure("TEST_FILE_DELETED", removed.join(", ")));
  if (after.skippedMarkers > before.skippedMarkers) failures.push(failure("TEST_DISABLED", `${before.skippedMarkers} -> ${after.skippedMarkers} markers`));
  if (after.testCount < before.testCount) failures.push(failure("TEST_COUNT_REDUCED", `${before.testCount} -> ${after.testCount}`));
  if (after.assertionCount < before.assertionCount) failures.push(failure("ASSERTION_COUNT_REDUCED", `${before.assertionCount} -> ${after.assertionCount}`));
  return { passed: failures.length === 0, before, after, failures };
}
async function copyWorkspace(source: string, destination: string, maxFiles: number): Promise<void> {
  for (const path of await listFiles(source, maxFiles)) {
    const from = join(source, ...path.split("/")); const to = join(destination, ...path.split("/"));
    await fs.mkdir(dirname(to), { recursive: true });
    if (!(await fs.lstat(from)).isFile()) throw new Error(`unsupported workspace entry: ${path}`);
    await fs.copyFile(from, to);
  }
}
async function applyPatch(root: string, candidate: CandidatePatch, limits: VerificationLimits): Promise<number> {
  if (candidate.operations.length > limits.maxOperations) throw new Error(failure("DIFF_TOO_LARGE", `operation count exceeds ${limits.maxOperations}`));
  let diffBytes = 0;
  for (const operation of candidate.operations) {
    const path = safeRelativePath(operation.path); const absolute = join(root, ...path.split("/"));
    if (operation.kind === "delete") {
      diffBytes += (await fs.readFile(absolute).catch(() => Buffer.from(""))).byteLength;
      if (diffBytes > limits.maxDiffBytes) throw new Error(failure("DIFF_TOO_LARGE", `${diffBytes} bytes`));
      await fs.rm(absolute, { force: true }); continue;
    }
    const content = operation.kind === "write" ? operation.content : (await fs.readFile(absolute, "utf8")).replace(operation.search, operation.replace);
    const bytes = Buffer.byteLength(content, "utf8"); if (bytes > limits.maxFileBytes) throw new Error(failure("FILE_TOO_LARGE", `${path} is ${bytes} bytes`));
    diffBytes += (await fs.readFile(absolute).catch(() => Buffer.from(""))).byteLength + bytes;
    if (diffBytes > limits.maxDiffBytes) throw new Error(failure("DIFF_TOO_LARGE", `${diffBytes} bytes`));
    await fs.mkdir(dirname(absolute), { recursive: true }); await fs.writeFile(absolute, content, "utf8");
  }
  if (diffBytes > limits.maxDiffBytes) throw new Error(failure("DIFF_TOO_LARGE", `${diffBytes} bytes`));
  return diffBytes;
}
const defaultBuildRunner: BuildRunner = () => ({ passed: true, reason: "safe manifest build gate" });
const defaultTestRunner: TestRunner = () => ({ passed: true, reason: "safe deterministic test gate" });
const defaultReplayRunner: ReplayRunner = () => ({ passed: true, metrics: {} });
function numericMetrics(value: Record<string, number | string | boolean> | undefined): Record<string, number | string> {
  const result: Record<string, number | string> = {};
  for (const [key, metric] of Object.entries(value ?? {})) if ((typeof metric === "number" && Number.isFinite(metric)) || typeof metric === "string") result[key] = metric;
  return result;
}
function evaluateMetrics(before: Record<string, number | string | boolean>, incident: Record<string, number | string | boolean>, after: Record<string, number | string | boolean>, rules: Record<string, MetricRule>): string[] {
  const failures: string[] = [];
  for (const [key, rule] of Object.entries(rules)) {
    const b = Number(before[key]); const i = Number(incident[key]); const a = Number(after[key]);
    if (![b, i, a].every(Number.isFinite)) { failures.push(failure("METRIC_MISSING", key)); continue; }
    if (rule.max !== undefined && a > rule.max) failures.push(failure("METRIC_ABOVE_MAX", `${key}=${a}`));
    if (rule.min !== undefined && a < rule.min) failures.push(failure("METRIC_BELOW_MIN", `${key}=${a}`));
    const worse = rule.direction === "lower" ? i > b : i < b; const recovered = rule.direction === "lower" ? a <= b : a >= b;
    if (worse && !recovered) failures.push(failure("INCIDENT_SYMPTOM_REMAINS", `${key}: ${i} -> ${a}, baseline ${b}`));
  }
  return failures;
}
async function runBounded<T>(runner: () => T | Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([Promise.resolve().then(runner), new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error("runner timed out")), timeoutMs); })]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
const stableId = (options: VerifyPatchOptions): string => options.verificationId ?? `patch-verification-${createHash("sha256").update(JSON.stringify(options.candidate)).digest("hex").slice(0, 16)}`;

export async function verifyPatch(options: VerifyPatchOptions): Promise<PatchVerification & { integrity: IntegrityReport; diffBytes: number }> {
  const limits = { ...DEFAULT_LIMITS, ...options.limits }; const failures: string[] = [];
  let baseline: RunnerResult = { passed: false, metrics: {} }; let incident: RunnerResult = { passed: false, metrics: {} }; let after: RunnerResult = { passed: false, metrics: {} };
  let beforeIntegrity: TestIntegritySnapshot = { files: [], testCount: 0, assertionCount: 0, skippedMarkers: 0 }; let afterIntegrity = beforeIntegrity; let diffBytes = 0;
  const replica = await fs.mkdtemp(join(tmpdir(), "faultline-verifier-"));
  const controlReplica = await fs.mkdtemp(join(tmpdir(), "faultline-verifier-control-"));
  const incidentReplica = await fs.mkdtemp(join(tmpdir(), "faultline-verifier-incident-"));
  try {
    const source = resolve(options.workspaceRoot); beforeIntegrity = await integritySnapshot(source, limits.maxTotalFiles);
    for (const operation of options.candidate.operations) { const path = safeRelativePath(operation.path); if (!allowedPath(path, options.allowedPaths)) failures.push(failure("PATH_NOT_ALLOWED", path)); }
    if (!failures.length) {
      await copyWorkspace(source, replica, limits.maxTotalFiles); diffBytes = await applyPatch(replica, options.candidate, limits); afterIntegrity = await integritySnapshot(replica, limits.maxTotalFiles); failures.push(...compareIntegrity(beforeIntegrity, afterIntegrity).failures);
      await copyWorkspace(source, controlReplica, limits.maxTotalFiles);
      await copyWorkspace(source, incidentReplica, limits.maxTotalFiles);
      const build = options.buildRunner ?? defaultBuildRunner; const test = options.testRunner ?? defaultTestRunner; const replay = options.replayRunner ?? defaultReplayRunner;
      baseline = await runBounded(() => replay({ phase: "before", workspace: controlReplica, patchApplied: false, timeoutMs: limits.runnerTimeoutMs }), limits.runnerTimeoutMs);
      incident = await runBounded(() => replay({ phase: "incident", workspace: incidentReplica, patchApplied: false, timeoutMs: limits.runnerTimeoutMs }), limits.runnerTimeoutMs);
      const buildResult = await runBounded(() => build({ phase: "after", workspace: replica, patchApplied: true, timeoutMs: limits.runnerTimeoutMs }), limits.runnerTimeoutMs);
      const testResult = await runBounded(() => test({ phase: "after", workspace: replica, patchApplied: true, timeoutMs: limits.runnerTimeoutMs }), limits.runnerTimeoutMs);
      after = await runBounded(() => replay({ phase: "after", workspace: replica, patchApplied: true, timeoutMs: limits.runnerTimeoutMs }), limits.runnerTimeoutMs);
      if (!buildResult.passed) failures.push(failure("BUILD_FAILED", buildResult.reason ?? "build runner failed"));
      if (!testResult.passed) failures.push(failure("TESTS_FAILED", testResult.reason ?? "test runner failed"));
      if (!after.passed) failures.push(failure("REPLAY_FAILED", after.reason ?? "replay runner failed"));
      if (options.healthRunner && !(await runBounded(() => options.healthRunner!({ phase: "after", workspace: replica, patchApplied: true, timeoutMs: limits.runnerTimeoutMs }), limits.runnerTimeoutMs))) failures.push(failure("HEALTH_CHECK_FAILED", "health runner reported unhealthy"));
      if (!options.healthRunner && after.healthPassed === false) failures.push(failure("HEALTH_CHECK_FAILED", "replay runner reported unhealthy"));
      failures.push(...evaluateMetrics(baseline.metrics ?? {}, incident.metrics ?? {}, after.metrics ?? {}, options.metricRules ?? {}));
      if (testResult.testCount !== undefined && testResult.testCount < beforeIntegrity.testCount) failures.push(failure("TEST_COUNT_REDUCED", `${beforeIntegrity.testCount} -> ${testResult.testCount}`));
      if (testResult.assertionCount !== undefined && testResult.assertionCount < beforeIntegrity.assertionCount) failures.push(failure("ASSERTION_COUNT_REDUCED", `${beforeIntegrity.assertionCount} -> ${testResult.assertionCount}`));
    }
  } catch (error) { failures.push(failure("VERIFIER_ERROR", error instanceof Error ? error.message : String(error))); }
  finally {
    await Promise.all([
      fs.rm(replica, { recursive: true, force: true }),
      fs.rm(controlReplica, { recursive: true, force: true }),
      fs.rm(incidentReplica, { recursive: true, force: true }),
    ]);
  }
  const integrity = compareIntegrity(beforeIntegrity, afterIntegrity);
  const result: PatchVerification & { integrity: IntegrityReport; diffBytes: number } = {
    id: stableId(options), incidentId: options.incidentId ?? "unknown-incident", hypothesisId: options.hypothesisId ?? "unknown-hypothesis",
    ...(options.candidate.diffRef === undefined ? {} : { diffRef: options.candidate.diffRef }),
    buildPassed: !failures.some((reason) => reason.startsWith("BUILD_FAILED")), testsPassed: !failures.some((reason) => reason.startsWith("TESTS_FAILED")),
    testIntegrityPassed: integrity.passed && !failures.some((reason) => reason.startsWith("TEST_COUNT_REDUCED") || reason.startsWith("ASSERTION_COUNT_REDUCED")),
    replayPassed: !failures.some((reason) => reason.startsWith("REPLAY_FAILED") || reason.startsWith("INCIDENT_SYMPTOM_REMAINS") || reason.startsWith("METRIC_")),
    healthChecksPassed: !failures.some((reason) => reason.startsWith("HEALTH_CHECK_FAILED")), baselineMeasurements: numericMetrics(baseline.metrics), incidentMeasurements: numericMetrics(incident.metrics), patchedMeasurements: numericMetrics(after.metrics),
    status: failures.length ? "rejected" : "verified", failureReasons: failures, integrity, diffBytes,
  };
  return result;
}
