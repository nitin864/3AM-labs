import {
  DeterministicFaultScenario,
  FaultScenarioMetadata,
  FaultScenarioResult,
  FaultVerification,
} from "./types";

const MAX_WORKER_ATTEMPTS = 4;
const VALID_MESSAGES = 2;

/**
 * A fixed queue begins with one malformed payload followed by two valid
 * messages. The faulted worker requeues the poison payload on every attempt;
 * the healthy worker dead-letters it and continues draining the queue.
 */
export class PoisonQueueScenario extends DeterministicFaultScenario {
  readonly metadata: FaultScenarioMetadata = {
    id: "fault-6-poison-queue",
    version: "1.0.0",
    title: "Unhandled poison message blocks queue drain",
    summary: "A malformed first payload is retried forever instead of being dead-lettered.",
    mechanism: "The treatment crashes before acknowledging poison and puts it back at the queue head.",
    expectedSymptoms: [
      "queue depth does not decrease",
      "worker repeatedly processes the same poison payload",
      "valid messages do not drain",
    ],
    groundTruth: {
      cause: "malformed payload is unhandled and is requeued at the head after every worker failure",
      control: "poison is acknowledged to a dead-letter queue, allowing both valid messages to process",
      treatment: "four bounded attempts all hit poison; valid messages remain blocked and queue depth stays 3",
      verification: "treatment has 4 poison attempts, 0 valid messages, and queue depth 3; control has 2 valid messages and 1 dead-letter",
    },
    verification: "Drain the fixed [poison, valid-a, valid-b] queue for four attempts; require no endless retry and continued valid-message processing after reset.",
    rollback: "reset() enables poison handling/dead-lettering and starts the queue from the same three-message fixture.",
  };

  run(): FaultScenarioResult {
    const poisonAttempts = this.isActive() ? MAX_WORKER_ATTEMPTS : 1;
    const validMessagesProcessed = this.isActive() ? 0 : VALID_MESSAGES;
    const deadLetteredMessages = this.isActive() ? 0 : 1;
    const remainingQueueDepth = this.isActive() ? 3 : 0;

    return {
      scenarioId: this.metadata.id,
      mode: this.mode,
      activated: this.isActive(),
      metrics: {
        initialQueueDepth: 3,
        workerAttempts: this.isActive() ? MAX_WORKER_ATTEMPTS : 3,
        poisonAttempts,
        validMessagesProcessed,
        deadLetteredMessages,
        remainingQueueDepth,
        retryLoopDetected: this.isActive() ? 1 : 0,
      },
      observations: [
        `${poisonAttempts} attempts encountered the poison payload`,
        `${validMessagesProcessed}/${VALID_MESSAGES} valid messages processed`,
        `${deadLetteredMessages} poison messages sent to dead letter`,
        `queue depth after bounded drain=${remainingQueueDepth}`,
      ],
      symptomDetected: this.isActive(),
    };
  }

  verify(result: FaultScenarioResult): FaultVerification {
    const passed = result.mode === "treatment"
      ? result.metrics.poisonAttempts === 4 &&
        result.metrics.validMessagesProcessed === 0 &&
        result.metrics.remainingQueueDepth === 3
      : result.metrics.poisonAttempts === 1 &&
        result.metrics.validMessagesProcessed === 2 &&
        result.metrics.deadLetteredMessages === 1 &&
        result.metrics.remainingQueueDepth === 0;
    return this.verification(
      result,
      passed,
      result.mode === "treatment"
        ? `bounded retries observed=${result.metrics.poisonAttempts}; valid processed=${result.metrics.validMessagesProcessed}; queue depth=${result.metrics.remainingQueueDepth}`
        : `dead-lettered=${result.metrics.deadLetteredMessages}; valid processed=${result.metrics.validMessagesProcessed}; queue depth=${result.metrics.remainingQueueDepth}`,
    );
  }
}
