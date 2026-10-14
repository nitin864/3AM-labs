import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { verifyPatch } from "./index.js";

async function fixture(): Promise<string> {
  const root = await mkdtemp(join("/tmp", "faultline-verifier-test-"));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "tests"), { recursive: true });
  await writeFile(join(root, "src", "service.ts"), "export const healthy = true;\n");
  await writeFile(join(root, "tests", "service.test.ts"), "test('service', () => { expect(true).toBe(true); });\n");
  return root;
}

const runners = {
  buildRunner: () => ({ passed: true }),
  testRunner: () => ({ passed: true }),
  replayRunner: ({ phase }: { phase: "before" | "incident" | "after" }) => ({
    passed: true,
    metrics: { latency: phase === "incident" ? 20 : 5 },
    healthPassed: true,
  }),
};

async function run(): Promise<void> {
  const root = await fixture();
  try {
    const valid = await verifyPatch({
      workspaceRoot: root,
      allowedPaths: ["src/**"],
      candidate: { operations: [{ kind: "write", path: "src/service.ts", content: "export const healthy = false;\n" }] },
      metricRules: { latency: { direction: "lower" } },
      ...runners,
    });
    assert.equal(valid.status, "verified");
    assert.equal(valid.testIntegrityPassed, true);

    const deleted = await verifyPatch({
      workspaceRoot: root,
      allowedPaths: ["tests/**"],
      candidate: { operations: [{ kind: "delete", path: "tests/service.test.ts" }] },
      ...runners,
    });
    assert.equal(deleted.status, "rejected");
    assert.match(deleted.failureReasons.join("\n"), /TEST_FILE_DELETED/);

    const skipped = await verifyPatch({
      workspaceRoot: root,
      allowedPaths: ["tests/**"],
      candidate: { operations: [{ kind: "write", path: "tests/service.test.ts", content: "test.skip('service', () => { expect(true).toBe(true); });\n" }] },
      ...runners,
    });
    assert.match(skipped.failureReasons.join("\n"), /TEST_DISABLED/);

    const unrelated = await verifyPatch({
      workspaceRoot: root,
      allowedPaths: ["src/**"],
      candidate: { operations: [{ kind: "write", path: "README.md", content: "changed\n" }] },
      ...runners,
    });
    assert.match(unrelated.failureReasons.join("\n"), /PATH_NOT_ALLOWED/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await run();
