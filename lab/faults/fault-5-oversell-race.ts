import {
  DeterministicFaultScenario,
  FaultScenarioMetadata,
  FaultScenarioResult,
  FaultVerification,
} from "./types";

const INITIAL_STOCK = 1;
const CONCURRENT_PURCHASES = 2;

/**
 * Uses a fixed interleaving (check A, check B, decrement A, decrement B) to
 * make a check-then-act race observable without depending on thread timing.
 */
export class OversellRaceScenario extends DeterministicFaultScenario {
  readonly metadata: FaultScenarioMetadata = {
    id: "fault-5-oversell-race",
    version: "1.0.0",
    title: "Non-atomic inventory check-then-act",
    summary: "Two concurrent buyers both observe one available item before either decrement is applied.",
    mechanism: "The treatment separates the stock check from the decrement and interleaves two requests.",
    expectedSymptoms: [
      "more successful purchases than available stock",
      "negative final inventory",
      "inventory invariant violation",
    ],
    groundTruth: {
      cause: "inventory check and decrement are not atomic under concurrent requests",
      control: "an atomic reservation allows exactly one purchase and leaves stock at zero",
      treatment: "both requests pass the stale stock check, succeed, and decrement stock to -1",
      verification: "treatment must violate available_stock >= 0 with 2 successes; control must preserve it with 1 success",
    },
    verification: "Run two fixed concurrent purchase requests from stock 1; require the atomic control invariant and reproduce the treatment oversell.",
    rollback: "reset() removes the non-atomic interleaving and uses an atomic reservation for the next run.",
  };

  run(): FaultScenarioResult {
    const successfulPurchases = this.isActive() ? CONCURRENT_PURCHASES : 1;
    const rejectedPurchases = CONCURRENT_PURCHASES - successfulPurchases;
    const finalStock = INITIAL_STOCK - successfulPurchases;
    const invariantHolds = finalStock >= 0 && successfulPurchases <= INITIAL_STOCK;

    return {
      scenarioId: this.metadata.id,
      mode: this.mode,
      activated: this.isActive(),
      metrics: {
        initialStock: INITIAL_STOCK,
        concurrentPurchases: CONCURRENT_PURCHASES,
        successfulPurchases,
        rejectedPurchases,
        finalStock,
        invariantHolds: invariantHolds ? 1 : 0,
        oversoldUnits: Math.max(0, -finalStock),
      },
      observations: [
        `${successfulPurchases} purchase requests reported success`,
        `final available stock=${finalStock}`,
        invariantHolds
          ? "available_stock >= 0 invariant holds"
          : "available_stock >= 0 invariant violated",
      ],
      symptomDetected: !invariantHolds,
    };
  }

  verify(result: FaultScenarioResult): FaultVerification {
    const expectedSuccesses = result.mode === "treatment" ? 2 : 1;
    const expectedFinalStock = result.mode === "treatment" ? -1 : 0;
    const expectedInvariant = result.mode === "control";
    const passed =
      result.metrics.successfulPurchases === expectedSuccesses &&
      result.metrics.finalStock === expectedFinalStock &&
      Boolean(result.metrics.invariantHolds) === expectedInvariant;
    return this.verification(
      result,
      passed,
      `expected ${expectedSuccesses} successes, final stock ${expectedFinalStock}, ` +
        `invariant=${expectedInvariant}; observed ${result.metrics.successfulPurchases}, ` +
        `${result.metrics.finalStock}, invariant=${Boolean(result.metrics.invariantHolds)}`,
    );
  }
}
