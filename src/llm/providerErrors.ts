/** Engine-authored; never ask the model to write this. */
export const HOLD_AT_ONCE_APOLOGY =
  "Forgive me, my lord — that was more than I could hold at once. Say it again, one matter at a time.";

/** Thrown when the model returned chopped/unparseable JSON. Same player-facing treatment as a timeout. */
export const INCOMPLETE_MODEL_JSON = "INCOMPLETE_MODEL_JSON";

/**
 * Engine line under a kept speech bubble when the books pass failed after the
 * speech pass succeeded. The lord keeps the words; the ledger did not move.
 */
export const BOOKS_NOT_TAKEN_LINE =
  "The books could not take that down. Nothing has changed; say the order again and it will be written.";

const TIMEOUT_CLASS =
  /\b502\b|\b524\b|provider_error|no response received|timed?\s*out|never answered|\bnetwork\b|\babort(?:ed|ion)?\b|econnreset|econnrefused|fetch failed|socket hang up|ecanceled|und_err/i;

const TRUNCATION_CLASS = /ran out of tokens|finish_reason length|stop_reason max_tokens/i;

/** The provider stopped the reply at the token cap before any visible text. Worth one retry with a larger budget. */
export function isTruncationError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return TRUNCATION_CLASS.test(msg);
}

/** RFAB/Grok 502, PROVIDER_ERROR, empty reply, network, abort — one class. No retry. */
export function isProviderTimeoutError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return TIMEOUT_CLASS.test(msg);
}

export function isIncompleteModelOutput(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes(INCOMPLETE_MODEL_JSON);
}

/** Timeout or chopped JSON — apology only, no NPC bubble from the blob, no repair. */
export function isHoldAtOnceFailure(err: unknown): boolean {
  return isProviderTimeoutError(err) || isIncompleteModelOutput(err);
}

export function booksHearFailureLine(npcName: string): string {
  return `${npcName} cannot be heard. The books are unchanged.`;
}
