import type { WorkloadManifest, WorkloadOptions, WorkloadRequest } from "../core/types.js";

const DEFAULT_SEED = 1337;
const DEFAULT_COUNT = 20;

// A tiny seeded generator avoids Math.random and makes every run replayable.
const nextRandom = (state: number): number => (Math.imul(state, 1664525) + 1013904223) >>> 0;

export function createWorkload(options: WorkloadOptions = {}): WorkloadManifest {
  if (options.manifest) return cloneManifest(options.manifest);
  const seed = options.seed ?? DEFAULT_SEED;
  const count = Math.max(0, Math.min(options.count ?? DEFAULT_COUNT, 500));
  let state = seed >>> 0;
  const requests: WorkloadRequest[] = [];
  for (let index = 0; index < count; index += 1) {
    state = nextRandom(state);
    const quantity = 1 + (state % 3);
    requests.push({
      requestId: `req-${String(index + 1).padStart(4, "0")}`,
      customerId: `customer-${String((state % 17) + 1).padStart(3, "0")}`,
      sku: "faultline-widget",
      quantity,
      index,
    });
  }
  return {
    id: `workload-${seed}-${count}`,
    seed,
    requestCount: count,
    generatedAt: "2026-01-01T00:00:00.000Z",
    requests,
  };
}

export function cloneManifest(manifest: WorkloadManifest): WorkloadManifest {
  return JSON.parse(JSON.stringify(manifest)) as WorkloadManifest;
}
