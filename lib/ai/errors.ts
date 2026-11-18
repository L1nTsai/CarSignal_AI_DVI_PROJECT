/**
 * Which Gemini API failures are worth the worker retrying. Pure, so it can be tested.
 * 429 and 5xx are transient; the other 4xx won't fix themselves on retry.
 */
export interface GeminiErrorClass {
  retryable: boolean;
  /** Shown to the tech as failure_reason when not retryable. */
  userMessage?: string;
}

export function classifyGeminiStatus(status: number | undefined): GeminiErrorClass {
  if (status === undefined || status === 429 || status >= 500) return { retryable: true };
  switch (status) {
    case 400:
      return { retryable: false, userMessage: "The AI couldn't process this recording (the request was rejected)." };
    case 401:
    case 403:
      return { retryable: false, userMessage: "The AI isn't configured correctly (the API key was rejected)." };
    case 402:
      return { retryable: false, userMessage: "The AI account is out of credits. Top it up, then retry." };
    case 404:
      return { retryable: false, userMessage: "The configured AI model wasn't found. Check GEMINI_MODEL." };
    default:
      return status >= 400 ? { retryable: false, userMessage: "The AI request failed." } : { retryable: true };
  }
}

/** HTTP status from an @google/genai ApiError (or anything shaped like one). */
export function statusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : undefined;
}
