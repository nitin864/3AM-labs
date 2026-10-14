import { FAULT_DEFINITIONS, isFaultId } from "../core/faults.js";
import { buildMetrics } from "../core/metrics.js";
import { InMemoryPersistenceAdapter, type PersistenceAdapter } from "../core/persistence.js";
import { TelemetryRecorder } from "../core/telemetry.js";
import type {
  FaultId,
  LabHealth,
  MetricsSnapshot,
  QueueMetrics,
  RequestOutcome,
  RunResult,
  WorkloadManifest,
  WorkloadOptions,
} from "../core/types.js";
import { GatewayService } from "../services/gateway/service.js";
import { InventoryService } from "../services/inventory/service.js";
import { OrdersService } from "../services/orders/service.js";
import { PaymentsService } from "../services/payments/service.js";
import { createWorkload } from "../workload-generator/generator.js";
import { DeterministicConnectionPool } from "./pool.js";

export interface LabRuntimeOptions {
  persistence?: PersistenceAdapter;
  poolSize?: number;
}

export interface StartResult {
  status: "started";
  health: LabHealth;
}

export interface WorkloadResult {
  run: RunResult;
}

/**
 * The process harness. It is intentionally synchronous: a bounded workload
 * can be reproduced without timers, sockets, or native database packages.
 */
export class LabRuntime {
  readonly telemetry = new TelemetryRecorder();
  readonly pool: DeterministicConnectionPool;
  readonly inventory: InventoryService;
  readonly payments: PaymentsService;
  readonly orders: OrdersService;
  readonly gateway: GatewayService;
  readonly persistence: PersistenceAdapter;
  private activeFault: FaultId | undefined;
  private started = false;
  private runSequence = 0;
  private lastRunId: string | undefined;

  constructor(options: LabRuntimeOptions = {}) {
    this.persistence = options.persistence ?? new InMemoryPersistenceAdapter();
    this.pool = new DeterministicConnectionPool(options.poolSize ?? 4);
    this.inventory = new InventoryService(this.telemetry);
    this.payments = new PaymentsService(this.telemetry);
    this.orders = new OrdersService(this.telemetry, this.inventory, this.payments, this.pool);
    this.gateway = new GatewayService(this.telemetry, this.orders);
  }

  start(): StartResult {
    this.reset();
    this.started = true;
    return { status: "started", health: this.health() };
  }

  reset(): void {
    const previousFault = this.activeFault;
    this.activeFault = undefined;
    this.telemetry.reset();
    if (previousFault) {
      const definition = FAULT_DEFINITIONS.find((fault) => fault.id === previousFault);
      if (definition) this.telemetry.marker(definition.id, "reset", definition.service, definition.groundTruthCause);
    }
    this.pool.reset();
    this.inventory.reset();
    this.persistence.reset();
    this.lastRunId = undefined;
    this.started = false;
  }

  activateFault(faultId: string): LabHealth {
    if (!isFaultId(faultId)) throw new Error(`Unknown fault: ${faultId}`);
    if (!this.started) this.start();
    this.activeFault = faultId;
    const definition = FAULT_DEFINITIONS.find((fault) => fault.id === faultId);
    if (definition) this.telemetry.marker(faultId, "activated", definition.service, definition.groundTruthCause);
    return this.health();
  }

  runWorkload(options: WorkloadOptions = {}): WorkloadResult {
    if (!this.started) this.start();
    const workload = createWorkload(options);
    // The oversell scenario is intentionally concurrent; make the default
    // stock boundary deterministic and visible without huge workloads.
    if (this.activeFault === "oversell-race" && workload.requestCount < 80) {
      const expanded = createWorkload({ count: 80, seed: workload.seed });
      return this.execute(expanded);
    }
    return this.execute(workload);
  }

  getRun(runId: string): RunResult | undefined {
    return this.persistence.getRun(runId);
  }

  listRuns(): RunResult[] {
    return this.persistence.listRuns();
  }

  health(): LabHealth {
    const result: LabHealth = {
      status: this.activeFault ? "faulted" : "healthy",
      serviceNames: ["gateway", "orders", "payments", "inventory"],
      persistence: this.persistence.kind,
    };
    if (this.activeFault !== undefined) result.activeFault = this.activeFault;
    if (this.lastRunId !== undefined) result.lastRunId = this.lastRunId;
    return result;
  }

  scenarios() {
    return FAULT_DEFINITIONS.map((fault) => ({ ...fault, expectedSymptoms: [...fault.expectedSymptoms] }));
  }

  private execute(workload: WorkloadManifest): WorkloadResult {
    const runId = `run-${String(++this.runSequence).padStart(6, "0")}`;
    const startedAt = this.telemetry.now();
    const outcomes: RequestOutcome[] = [];
    const serviceLatencies: Record<string, number[]> = {
      gateway: [],
      orders: [],
      payments: [],
      inventory: [],
    };
    const serviceFailures: Record<string, number> = {
      gateway: 0,
      orders: 0,
      payments: 0,
      inventory: 0,
    };
    const queue: QueueMetrics = {
      depth: 0,
      maxDepth: 0,
      enqueued: 0,
      processed: 0,
      failed: 0,
      retryAttempts: 0,
    };

    for (const request of workload.requests) {
      const requestStart = this.telemetry.nowMs();
      const traceId = `trace-${String(request.index + 1).padStart(6, "0")}`;
      const outcome = this.gateway.handle(
        request,
        traceId,
        `order-${String(request.index + 1).padStart(6, "0")}`,
        requestStart,
        this.activeFault,
      );
      outcomes.push(outcome);
      serviceLatencies.gateway?.push(outcome.latencyMs);
      serviceLatencies.orders?.push(Math.max(1, outcome.latencyMs - 1));
      serviceLatencies.payments?.push(outcome.downstreamAttempts * (this.activeFault === "timeout-too-short" ? 8 : 3));
      serviceLatencies.inventory?.push(2);
      if (outcome.status === "failed") {
        serviceFailures.gateway = (serviceFailures.gateway ?? 0) + 1;
        serviceFailures.orders = (serviceFailures.orders ?? 0) + 1;
        if (outcome.errorType === "payment_declined" || outcome.errorType === "downstream_timeout") {
          serviceFailures.payments = (serviceFailures.payments ?? 0) + 1;
        }
        if (outcome.errorType === "out_of_stock") {
          serviceFailures.inventory = (serviceFailures.inventory ?? 0) + 1;
        }
      }
      queue.enqueued += outcome.downstreamAttempts;
      queue.processed += outcome.downstreamAttempts;
      queue.retryAttempts += Math.max(0, outcome.downstreamAttempts - 1);
      if (outcome.status === "failed") queue.failed += 1;
      this.telemetry.advance(outcome.latencyMs + 1);
    }
    const metrics = buildMetrics({ outcomes, serviceLatencies, serviceFailures, pool: this.pool.metrics(), queue, inventory: this.inventory.metrics() });
    const finishedAt = this.telemetry.now();
    const run: RunResult = {
      runId,
      workload,
      startedAt,
      finishedAt,
      outcomes,
      metrics,
      telemetry: this.telemetry.snapshot(),
      healthy: metrics.errorRate === 0 && metrics.inventory.invariantHolds,
    };
    if (this.activeFault !== undefined) run.faultId = this.activeFault;
    this.persistence.saveRun(run);
    this.lastRunId = runId;
    return { run };
  }
}

export type { MetricsSnapshot };
