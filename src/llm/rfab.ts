import type { ChatMessageParam, ChatOpts, LlmCompletion, LlmModel, ProviderConfig } from "./types";
import { combineReasoning } from "./reasoning";
import { rememberChatResponse } from "./usage";
import { requestWithTimeout } from "./transport";

const RFAB_BASE = "https://api.rfab.ai";
const DEFAULT_MAX_TOKENS = 4000;

export async function listRfabModels(apiKey: string): Promise<LlmModel[]> {
  const res = await fetch(`${RFAB_BASE}/api/chat/completions/models`, {
    headers: { "X-API-Key": apiKey },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RFAB models ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as unknown;
  if (Array.isArray(data)) {
    return data.map(normalizeModel).filter((m): m is LlmModel => Boolean(m.id));
  }
  const obj = data as { models?: unknown; data?: unknown };
  const list = Array.isArray(obj.models) ? obj.models : Array.isArray(obj.data) ? obj.data : [];
  return list.map(normalizeModel).filter((m): m is LlmModel => Boolean(m.id));
}

function normalizeModel(raw: unknown): LlmModel {
  if (typeof raw === "string") return { id: raw };
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? o.model ?? o.name ?? "");
  return { id, name: typeof o.name === "string" ? o.name : undefined, rate: typeof o.rate === "number" ? o.rate : undefined };
}

export async function rfabChat(
  config: ProviderConfig,
  messages: ChatMessageParam[],
  opts?: ChatOpts,
): Promise<LlmCompletion> {
  if (!config.apiKey) throw new Error("No Reality Fabricator API key. Open Settings and paste a key from rfab.ai.");
  if (!config.model) throw new Error("No model selected.");
  const system = messages.find((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  const body = {
    model: config.model,
    messages: rest.length ? rest : [{ role: "user" as const, content: "..." }],
    systemPrompt: system?.content,
    maxTokens: opts?.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: opts?.temperature ?? 0.7,
  };
  // RFAB's chat completions endpoint is one-shot JSON; it offers no stream flag.
  // The transport still gives it the total/idle budget so a hung call fails on time.
  const res = await requestWithTimeout(
    `${RFAB_BASE}/api/chat/completions`,
    {
      method: "POST",
      headers: {
        "X-API-Key": config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    { providerLabel: "RFAB" },
  );
  const text = res.text;
  if (!res.ok) throw new Error(`RFAB chat ${res.status}: ${text.slice(0, 400)}`);
  let data: { content?: string; success?: boolean; usage?: { inputTokens?: unknown; outputTokens?: unknown }; finishReason?: unknown };
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    throw new Error("RFAB returned non-JSON.");
  }
  rememberChatResponse(data, res.headers);
  if (!data.content) throw new Error("RFAB response had no content.");
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  return {
    content: data.content,
    reasoning: combineReasoning(data, data.content),
    finishReason: typeof data.finishReason === "string" ? data.finishReason : undefined,
    usage: { promptTokens: num(data.usage?.inputTokens), completionTokens: num(data.usage?.outputTokens) },
    elapsedMs: res.elapsedMs,
  };
}
