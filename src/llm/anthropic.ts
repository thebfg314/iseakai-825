import type { ChatMessageParam, ChatOpts, LlmCompletion, LlmModel, ProviderConfig } from "./types";
import { combineReasoning } from "./reasoning";
import { rememberChatResponse } from "./usage";

const ANTHROPIC_BASE = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";

function extractText(data: unknown): string {
  const blocks = (data as { content?: unknown }).content;
  if (typeof blocks === "string" && blocks) return blocks;
  if (!Array.isArray(blocks)) throw new Error("Anthropic response had no content.");
  const text = blocks
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const b = block as { type?: string; text?: unknown };
      if (b.type === "text" || typeof b.text === "string") return String(b.text ?? "");
      return "";
    })
    .join("");
  if (!text) throw new Error("Anthropic response had no content.");
  return text;
}

export async function anthropicChat(
  config: ProviderConfig,
  messages: ChatMessageParam[],
  opts?: ChatOpts,
): Promise<LlmCompletion> {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");
  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: opts?.maxTokens ?? 1800,
    temperature: opts?.temperature ?? 0.7,
    messages: rest.map((m) => ({ role: m.role, content: m.content })),
  };
  if (system) body.system = system;

  const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
    method: "POST",
    headers: {
      "x-api-key": config.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Anthropic chat ${res.status}: ${text.slice(0, 400)}`);
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Anthropic returned non-JSON.");
  }
  rememberChatResponse(data, res.headers);
  const content = extractText(data);
  return { content, reasoning: combineReasoning(data, content) };
}

export async function listAnthropicModels(apiKey: string): Promise<LlmModel[]> {
  const res = await fetch(`${ANTHROPIC_BASE}/models`, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic models ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { data?: unknown };
  const list = Array.isArray(data.data) ? data.data : [];
  return list
    .map((raw) => {
      if (typeof raw === "string") return { id: raw };
      const o = raw as Record<string, unknown>;
      const id = String(o.id ?? o.model ?? "");
      return { id, name: typeof o.display_name === "string" ? o.display_name : undefined };
    })
    .filter((m): m is LlmModel => Boolean(m.id));
}
