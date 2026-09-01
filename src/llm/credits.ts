import { PROVIDER_META, activeConfig, type AppSettings, type LlmProvider } from "./types";
import { parseOpenRouterKey, parseRfabBalance, type RemainingBalance } from "./usage";

const RFAB_BASE = "https://api.rfab.ai";
const FETCH_MS = 4000;

export type BalanceFetch = {
  provider: LlmProvider;
  remaining?: RemainingBalance;
  remainingKnown: boolean;
  /** No key configured — do not wipe a previous remaining figure. */
  skipped?: boolean;
  /** Network/API error — keep the last remaining figure. */
  failed?: boolean;
  /** This provider has no remaining-balance API for the game's key. */
  unsupported?: boolean;
};

function abortSignal(): AbortSignal {
  return AbortSignal.timeout(FETCH_MS);
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers, signal: abortSignal() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<unknown>;
}

async function fetchRfabBalance(apiKey: string): Promise<RemainingBalance | undefined> {
  const data = await fetchJson(`${RFAB_BASE}/api/tokens/balance`, { "X-API-Key": apiKey });
  return parseRfabBalance(data);
}

async function fetchOpenRouterBalance(apiKey: string): Promise<RemainingBalance | undefined> {
  const data = await fetchJson("https://openrouter.ai/api/v1/key", {
    Authorization: `Bearer ${apiKey}`,
    "HTTP-Referer": "https://isekai.local",
    "X-Title": "Isekai in the year of our lord 825",
  });
  return parseOpenRouterKey(data);
}

/**
 * Live remaining credits when the configured provider has a balance API
 * that accepts the same key the game already uses. Never logs the key.
 */
export async function fetchProviderBalance(settings: AppSettings): Promise<BalanceFetch> {
  const provider = settings.provider;
  const config = activeConfig(settings);
  if (!config.apiKey) return { provider, remainingKnown: false, skipped: true };

  try {
    switch (provider) {
      case "rfab": {
        const remaining = await fetchRfabBalance(config.apiKey);
        return { provider, remaining, remainingKnown: Boolean(remaining) };
      }
      case "openrouter": {
        const remaining = await fetchOpenRouterBalance(config.apiKey);
        return { provider, remaining, remainingKnown: Boolean(remaining) };
      }
      default:
        return { provider, remainingKnown: false, unsupported: true };
    }
  } catch {
    return { provider, remainingKnown: false, failed: true };
  }
}

export function providerBalanceHelp(provider: LlmProvider): string {
  switch (provider) {
    case "rfab":
      return "Reality Fabricator reports a live token balance for this key.";
    case "openrouter":
      return "OpenRouter reports remaining credits when this key has a spend cap.";
    default:
      return `${PROVIDER_META[provider].label} does not give this game a remaining-balance figure — only tokens used this save.`;
  }
}
