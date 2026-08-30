/** Engine-authored; never ask the model to write this. */
export const HOLD_AT_ONCE_APOLOGY =
  "Forgive me, my lord — that was more than I could hold at once. Say it again, one matter at a time.";

const TIMEOUT_CLASS =
  /\b502\b|provider_error|no response received|timed?\s*out|never answered|\bnetwork\b|\babort(?:ed|ion)?\b|econnreset|econnrefused|fetch failed|socket hang up|ecanceled/i;

/** RFAB/Grok 502, PROVIDER_ERROR, empty reply, network, abort — one class. No retry. */
export function isProviderTimeoutError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return TIMEOUT_CLASS.test(msg);
}

export function booksHearFailureLine(npcName: string): string {
  return `${npcName} cannot be heard. The books are unchanged.`;
}
