import type { LlmProvider } from "./types";

export type TokenTally = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  billedTokens: number;
  calls: number;
};

export type RemainingKind = "tokens" | "credits" | "usd";

export type RemainingBalance = {
  value: number;
  kind: RemainingKind;
};

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  billedTokens?: number;
};

export type LlmCallReport = {
  usage?: TokenUsage;
  remainingHint?: RemainingBalance;
};

/** What the HUD and settings can show without exposing keys. */
export type LlmMeter = {
  provider: LlmProvider;
  usedThisSave: TokenTally;
  usedThisSession: TokenTally;
  remaining?: RemainingBalance;
  remainingKnown: boolean;
};

export function emptyTally(): TokenTally {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, billedTokens: 0, calls: 0 };
}

export function emptyMeter(provider: LlmProvider): LlmMeter {
  return {
    provider,
    usedThisSave: emptyTally(),
    usedThisSession: emptyTally(),
    remainingKnown: false,
  };
}

function asFiniteNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function headerGet(headers: Headers | Record<string, string | undefined>, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? headers.get(name.toLowerCase()) ?? undefined;
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (direct != null) return direct;
  const found = Object.entries(headers).find(([k]) => k.toLowerCase() === name.toLowerCase());
  return found?.[1];
}

/** Chat-body token counts. Accepts OpenAI, Anthropic, RFAB, and Gemini-shaped usage. */
export function parseUsageFromChatBody(data: unknown): TokenUsage | undefined {
  if (!data || typeof data !== "object") return undefined;
  const o = data as Record<string, unknown>;
  const usageRaw = o.usage;
  const usage = usageRaw && typeof usageRaw === "object" ? (usageRaw as Record<string, unknown>) : o;

  const prompt = asFiniteNumber(
    usage.prompt_tokens ?? usage.input_tokens ?? usage.inputTokens ?? usage.promptTokens ?? usage.prompt_token_count,
  );
  const completion = asFiniteNumber(
    usage.completion_tokens ??
      usage.output_tokens ??
      usage.outputTokens ??
      usage.completionTokens ??
      usage.candidatesTokenCount ??
      usage.candidates_token_count,
  );
  const total = asFiniteNumber(usage.total_tokens ?? usage.totalTokens ?? usage.totalTokenCount);
  const billed = asFiniteNumber(o.tokensBilled ?? usage.tokensBilled ?? usage.tokens_billed);

  if (prompt == null && completion == null && total == null && billed == null) return undefined;
  const promptTokens = prompt ?? 0;
  const completionTokens = completion ?? 0;
  const totalTokens = total ?? promptTokens + completionTokens;
  const result: TokenUsage = {
    promptTokens,
    completionTokens,
    totalTokens: totalTokens || billed || 0,
  };
  if (billed != null) result.billedTokens = billed;
  return result;
}

/**
 * Remaining *credits/balance* only — never rate-limit remaining
 * (`x-ratelimit-*` is a throttle, not money left).
 */
export function parseRemainingFromHeaders(headers: Headers | Record<string, string | undefined>): RemainingBalance | undefined {
  const creditKeys = [
    "x-credits-remaining",
    "x-credit-remaining",
    "x-remaining-credits",
    "x-credit-balance",
    "x-tokens-remaining",
    "x-token-balance",
  ];
  for (const key of creditKeys) {
    const raw = headerGet(headers, key);
    const n = asFiniteNumber(raw);
    if (n == null) continue;
    const lower = key.toLowerCase();
    const kind: RemainingKind = lower.includes("token") ? "tokens" : "credits";
    return { value: n, kind };
  }
  return undefined;
}

export function parseRfabBalance(data: unknown): RemainingBalance | undefined {
  if (!data || typeof data !== "object") return undefined;
  const o = data as Record<string, unknown>;
  const n = asFiniteNumber(o.tokenBalance ?? o.balance ?? o.tokens);
  if (n == null) return undefined;
  return { value: n, kind: "tokens" };
}

export function parseOpenRouterKey(data: unknown): RemainingBalance | undefined {
  if (!data || typeof data !== "object") return undefined;
  const root = data as Record<string, unknown>;
  const inner = root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : root;
  if (!("limit_remaining" in inner) && !("limit" in inner) && !("usage" in inner)) return undefined;
  // null limit_remaining with null limit means the key is uncapped — not a remaining figure.
  if (inner.limit_remaining == null) return undefined;
  const n = asFiniteNumber(inner.limit_remaining);
  if (n == null) return undefined;
  return { value: n, kind: "usd" };
}

export function addTally(a: TokenTally, usage: TokenUsage): TokenTally {
  const billed = usage.billedTokens ?? 0;
  return {
    promptTokens: a.promptTokens + usage.promptTokens,
    completionTokens: a.completionTokens + usage.completionTokens,
    totalTokens: a.totalTokens + usage.totalTokens,
    billedTokens: a.billedTokens + billed,
    calls: a.calls + 1,
  };
}

export function tallyDisplayTokens(t: TokenTally): number {
  return t.billedTokens > 0 ? t.billedTokens : t.totalTokens;
}

export function loadTally(raw: unknown): TokenTally {
  if (!raw || typeof raw !== "object") return emptyTally();
  const o = raw as Record<string, unknown>;
  return {
    promptTokens: asFiniteNumber(o.promptTokens) ?? 0,
    completionTokens: asFiniteNumber(o.completionTokens) ?? 0,
    totalTokens: asFiniteNumber(o.totalTokens) ?? 0,
    billedTokens: asFiniteNumber(o.billedTokens) ?? 0,
    calls: asFiniteNumber(o.calls) ?? 0,
  };
}

let lastCall: LlmCallReport | null = null;

export function rememberLlmCall(report: LlmCallReport) {
  lastCall = report;
}

export function consumeLastLlmCall(): LlmCallReport | null {
  const report = lastCall;
  lastCall = null;
  return report;
}

export function rememberChatResponse(data: unknown, headers?: Headers | Record<string, string | undefined>) {
  rememberLlmCall({
    usage: parseUsageFromChatBody(data),
    remainingHint: headers ? parseRemainingFromHeaders(headers) : undefined,
  });
}

export class LlmMeterStore {
  provider: LlmProvider;
  usedThisSave: TokenTally = emptyTally();
  usedThisSession: TokenTally = emptyTally();
  remaining?: RemainingBalance;
  remainingKnown = false;

  constructor(provider: LlmProvider = "rfab") {
    this.provider = provider;
  }

  applyCall(report: LlmCallReport | null | undefined) {
    if (!report) return;
    if (report.usage) {
      this.usedThisSave = addTally(this.usedThisSave, report.usage);
      this.usedThisSession = addTally(this.usedThisSession, report.usage);
    }
    if (report.remainingHint) {
      this.remaining = report.remainingHint;
      this.remainingKnown = true;
    }
  }

  applyBalance(balance: RemainingBalance | undefined, provider: LlmProvider) {
    this.provider = provider;
    if (!balance) {
      this.remainingKnown = false;
      this.remaining = undefined;
      return;
    }
    this.remaining = balance;
    this.remainingKnown = true;
  }

  setProvider(provider: LlmProvider) {
    this.provider = provider;
  }

  reset() {
    this.usedThisSave = emptyTally();
    this.usedThisSession = emptyTally();
    this.remaining = undefined;
    this.remainingKnown = false;
  }

  snapshot(): LlmMeter {
    return {
      provider: this.provider,
      usedThisSave: { ...this.usedThisSave },
      usedThisSession: { ...this.usedThisSession },
      remaining: this.remaining ? { ...this.remaining } : undefined,
      remainingKnown: this.remainingKnown,
    };
  }

  loadSave(raw: unknown) {
    this.usedThisSave = loadTally(raw);
  }
}
