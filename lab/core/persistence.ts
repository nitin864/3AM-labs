import type { RunResult } from "./types.js";

/** Small persistence boundary. A SQL adapter can implement this contract later. */
export interface PersistenceAdapter {
  readonly kind: "memory" | "sql-compatible";
  saveRun(run: RunResult): void;
  getRun(runId: string): RunResult | undefined;
  listRuns(): RunResult[];
  reset(): void;
}

const clone = (run: RunResult): RunResult => JSON.parse(JSON.stringify(run)) as RunResult;

/** Default adapter: fast, deterministic, and dependency-free for local tests. */
export class InMemoryPersistenceAdapter implements PersistenceAdapter {
  readonly kind = "memory" as const;
  private readonly runs = new Map<string, RunResult>();

  saveRun(run: RunResult): void {
    this.runs.set(run.runId, clone(run));
  }

  getRun(runId: string): RunResult | undefined {
    const run = this.runs.get(runId);
    return run ? clone(run) : undefined;
  }

  listRuns(): RunResult[] {
    return [...this.runs.values()].map(clone);
  }

  reset(): void {
    this.runs.clear();
  }
}

/**
 * Optional SQL-compatible boundary. It deliberately contains no driver import;
 * applications can provide a SQLite/PostgreSQL-like executor when desired.
 */
export interface SqlExecutor {
  run(sql: string, params: readonly unknown[]): void;
  all<T>(sql: string, params: readonly unknown[]): T[];
}

export class SqlCompatiblePersistenceAdapter implements PersistenceAdapter {
  readonly kind = "sql-compatible" as const;
  private readonly fallback = new InMemoryPersistenceAdapter();

  constructor(private readonly executor?: SqlExecutor) {}

  saveRun(run: RunResult): void {
    if (!this.executor) {
      this.fallback.saveRun(run);
      return;
    }
    this.executor.run(
      "INSERT INTO faultline_runs (run_id, payload_json) VALUES (?, ?)",
      [run.runId, JSON.stringify(run)],
    );
  }

  getRun(runId: string): RunResult | undefined {
    if (!this.executor) return this.fallback.getRun(runId);
    const rows = this.executor.all<{ payload_json: string }>(
      "SELECT payload_json FROM faultline_runs WHERE run_id = ?",
      [runId],
    );
    return rows[0] ? (JSON.parse(rows[0].payload_json) as RunResult) : undefined;
  }

  listRuns(): RunResult[] {
    if (!this.executor) return this.fallback.listRuns();
    return this.executor
      .all<{ payload_json: string }>("SELECT payload_json FROM faultline_runs ORDER BY run_id", [])
      .map((row) => JSON.parse(row.payload_json) as RunResult);
  }

  reset(): void {
    if (!this.executor) {
      this.fallback.reset();
      return;
    }
    this.executor.run("DELETE FROM faultline_runs", []);
  }
}
