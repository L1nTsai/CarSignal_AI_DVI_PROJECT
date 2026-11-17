/**
 * Throw a JobError from a handler to control retries and the message shown to
 * the tech. Any other thrown error is retried (up to MAX_ATTEMPTS) and, on
 * final failure, shown as a generic message.
 */
export class JobError extends Error {
  readonly retryable: boolean;
  /** Shown to the tech as inspections.failure_reason (process_inspection only). */
  readonly userMessage?: string;

  constructor(message: string, opts: { retryable?: boolean; userMessage?: string } = {}) {
    super(message);
    this.name = "JobError";
    this.retryable = opts.retryable ?? true;
    this.userMessage = opts.userMessage;
  }
}

export const NO_COMPONENTS_MESSAGE = "The AI didn't find any inspected components in this recording.";
