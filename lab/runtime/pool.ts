import type { ConnectionPoolController } from "../services/orders/service.js";
import type { ConnectionPoolMetrics } from "../core/types.js";

export class DeterministicConnectionPool implements ConnectionPoolController {
  private active = 0;
  private acquired = 0;
  private released = 0;
  private waits = 0;
  private timeouts = 0;
  private leaked = 0;

  constructor(private readonly max = 4) {}

  acquire(): { ok: true } | { ok: false; errorType: "connection_timeout" } {
    if (this.active >= this.max) {
      this.waits += 1;
      this.timeouts += 1;
      return { ok: false, errorType: "connection_timeout" };
    }
    this.active += 1;
    this.acquired += 1;
    return { ok: true };
  }

  release(): void {
    if (this.active > 0) {
      this.active -= 1;
      this.released += 1;
    }
  }

  markLeak(): void {
    this.leaked += 1;
  }

  reset(): void {
    this.active = 0;
    this.acquired = 0;
    this.released = 0;
    this.waits = 0;
    this.timeouts = 0;
    this.leaked = 0;
  }

  metrics(): ConnectionPoolMetrics {
    return {
      max: this.max,
      active: this.active,
      acquired: this.acquired,
      released: this.released,
      waits: this.waits,
      timeouts: this.timeouts,
      leaked: this.leaked,
      utilization: this.max === 0 ? 0 : this.active / this.max,
    };
  }
}
