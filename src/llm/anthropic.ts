import type { ChatMessageParam, ChatOpts, CompletionUsage, LlmCompletion, LlmModel, ProviderConfig } from "./types";
import { combineReasoning, reasoningFromContent } from "./reasoning";
import { rememberChatResponse } from "./usage";
import { requestWithTimeout, sseJson } from "./transport";

const ANTHROPIC_BASE = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 4000;

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Gathers a streamed Messages reply: text deltas, thinking deltas, the stop
 * reason from message_delta, and usage from message_start + message_delta.
 */
export class AnthropicStreamAccumulator {
  content = "";
  reasoning = "";
  stopReason: string | undefined;
  usage: CompletionUsage | undefined;
  error: string | undefined;

  push(data: Record<string, unknown>) {
    const type = typeof data.type === "string" ? data.type : "";
    if (type === "error") {
      const e = (data.error ?? {}) as { type?: unknown; message?: unknown };
      this.error = `${e.type != null ? `${String(e.type)}: ` : ""}${String(e.message ?? "provider error")}`;
      return;
    }
    if (type === "message_start") {
      const message = (data.message ?? {}) as Record<string, unknown>;
      const u = (message.usage ?? {}) as Record<string, unknown>;
      this.usage = { ...this.usage, promptTokens: asNumber(u.input_tokens) };
      return;
    }
    if (type === "content_block_delta") {
      const delta = (data.delta ?? {}) as Record<string, unknown>;
      if (delta.type === "text_delta" && typeof delta.text === "string") this.content += delta.text;
      else if (delta.type === "thinking_delta" && typeof delta.thinking === "string") this.reasoning += delta.thinking;
      return;
    }
    if (type === "message_delta") {
      const delta = (data.delta ?? {}) as Record<string, unknown>;
      if (typeof delta.stop_reason === "string" && delta.stop_reason) this.stopReason = delta.stop_reason;
      const u = (data.usage ?? {}) as Record<string, unknown>;
      const out = asNumber(u.output_tokens);
      if (out != null) this.usage = { ...this.usage, completionTokens: out };
    }
  }
}

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
    max_tokens: opts?.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: opts?.temperature ?? 0.7,
    messages: rest.map((m) => ({ role: m.role, content: m.content })),
    stream: true,
  };
  if (system) body.system = system;

  const acc = new AnthropicStreamAccumulator();
  const res = await requestWithTimeout(
    `${ANTHROPIC_BASE}/messages`,
    {
      method: "POST",
      headers: {
        "x-api-key": config.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
        accept: "text/event-stream, application/json",
      },
      body: JSON.stringify(body),
    },
    {
      providerLabel: "Anthropic",
      partial: () => acc.content,
      onEvent: (ev) => {
        const data = sseJson(ev);
        if (data) acc.push(data);
      },
    },
  );
  if (!res.ok) throw new Error(`Anthropic chat ${res.status}: ${res.text.slice(0, 400)}`);

  if (!res.streamed) {
    let data: unknown;
    try {
      data = JSON.parse(res.text) as unknown;
    } catch {
      throw new Error("Anthropic returned non-JSON.");
    }
    rememberChatResponse(data, res.headers);
    const content = extractText(data);
    const d = data as { stop_reason?: unknown; usage?: { input_tokens?: unknown; output_tokens?: unknown } };
    const stopReason = typeof d.stop_reason === "string" ? d.stop_reason : undefined;
    return {
      content,
      reasoning: combineReasoning(data, content),
      finishReason: stopReason,
      usage: { promptTokens: asNumber(d.usage?.input_tokens), completionTokens: asNumber(d.usage?.output_tokens) },
      elapsedMs: res.elapsedMs,
      truncated: stopReason === "max_tokens",
    };
  }

  if (acc.error) throw new Error(`Anthropic chat stream error: ${acc.error.slice(0, 400)}`);
  rememberChatResponse(
    { usage: { input_tokens: acc.usage?.promptTokens ?? 0, output_tokens: acc.usage?.completionTokens ?? 0 } },
    res.headers,
  );
  if (!acc.content) {
    if (acc.stopReason === "max_tokens") {
      throw new Error("Anthropic reply ran out of tokens before any visible text (stop_reason max_tokens).");
    }
    throw new Error("Anthropic response had no content.");
  }
  const reasoning = [acc.reasoning.trim(), reasoningFromContent(acc.content)].filter(Boolean).join("\n\n");
  return {
    content: acc.content,
    reasoning,
    finishReason: acc.stopReason,
    usage: acc.usage,
    elapsedMs: res.elapsedMs,
    truncated: acc.stopReason === "max_tokens",
  };
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
