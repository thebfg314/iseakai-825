import type { ChatMessageParam, ChatOpts, CompletionUsage, LlmCompletion, LlmModel } from "./types";
import { combineReasoning, reasoningFromContent } from "./reasoning";
import { rememberChatResponse } from "./usage";
import { requestWithTimeout, sseJson } from "./transport";

function extractContent(data: unknown): string {
  const d = data as {
    choices?: { message?: { content?: unknown }; text?: string }[];
    content?: unknown;
  };
  const content = d.choices?.[0]?.message?.content ?? d.choices?.[0]?.text ?? d.content;
  if (typeof content === "string" && content) return content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) return String((part as { text?: unknown }).text ?? "");
        return "";
      })
      .join("");
    if (text) return text;
  }
  throw new Error("Response had no content.");
}

function normalizeModel(raw: unknown): LlmModel {
  if (typeof raw === "string") return { id: raw };
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? o.model ?? o.name ?? "").replace(/^models\//, "");
  return {
    id,
    name: typeof o.name === "string" ? o.name : typeof o.display_name === "string" ? o.display_name : undefined,
  };
}

/** Default cap on the visible reply plus any hidden reasoning the model spends first. */
export const DEFAULT_MAX_TOKENS = 4000;

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** OpenAI-style usage block → our shape. Undefined when the body carries none. */
export function usageFromOpenAi(raw: unknown): CompletionUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const u = raw as Record<string, unknown>;
  const details = (u.completion_tokens_details ?? {}) as Record<string, unknown>;
  const usage: CompletionUsage = {
    promptTokens: asNumber(u.prompt_tokens),
    completionTokens: asNumber(u.completion_tokens),
    reasoningTokens: asNumber(details.reasoning_tokens),
  };
  if (usage.promptTokens == null && usage.completionTokens == null) return undefined;
  return usage;
}

/** Text parts of a delta or message `content` field (string or array of parts). */
function textParts(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (!Array.isArray(raw)) return "";
  return raw
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) return String((part as { text?: unknown }).text ?? "");
      return "";
    })
    .join("");
}

/**
 * Gathers a streamed OpenAI-style reply chunk by chunk: visible content, hidden
 * reasoning (OpenRouter `reasoning`, DeepSeek `reasoning_content`), finish reason, usage.
 */
export class OpenAiStreamAccumulator {
  content = "";
  reasoning = "";
  finishReason: string | undefined;
  usage: CompletionUsage | undefined;
  error: string | undefined;
  sawChunk = false;

  push(data: Record<string, unknown>) {
    if (data.error && typeof data.error === "object") {
      const e = data.error as { message?: unknown; code?: unknown };
      this.error = `${e.code != null ? `${String(e.code)}: ` : ""}${String(e.message ?? "provider error")}`;
      return;
    }
    this.sawChunk = true;
    const usage = usageFromOpenAi(data.usage);
    if (usage) this.usage = usage;
    const choices = Array.isArray(data.choices) ? data.choices : [];
    for (const choice of choices) {
      if (!choice || typeof choice !== "object") continue;
      const c = choice as Record<string, unknown>;
      const delta = (c.delta ?? c.message ?? {}) as Record<string, unknown>;
      this.content += textParts(delta.content);
      if (typeof c.text === "string") this.content += c.text;
      const reasoning = textParts(delta.reasoning) || textParts(delta.reasoning_content);
      if (reasoning) this.reasoning += reasoning;
      if (typeof c.finish_reason === "string" && c.finish_reason) this.finishReason = c.finish_reason;
    }
  }
}

export async function openaiCompatibleChat(
  opts: {
    url: string;
    apiKey: string;
    model: string;
    messages: ChatMessageParam[];
    chatOpts?: ChatOpts;
    extraHeaders?: Record<string, string>;
    /** Extra JSON fields the provider wants (OpenRouter `usage: { include: true }`). */
    extraBody?: Record<string, unknown>;
    /** Send OpenAI `stream_options.include_usage`. Off for providers that reject unknown fields. */
    includeUsageOption?: boolean;
    providerLabel: string;
  },
): Promise<LlmCompletion> {
  const acc = new OpenAiStreamAccumulator();
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    max_tokens: opts.chatOpts?.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: opts.chatOpts?.temperature ?? 0.7,
    stream: true,
    ...(opts.includeUsageOption === false ? {} : { stream_options: { include_usage: true } }),
    ...opts.extraBody,
  };
  const res = await requestWithTimeout(
    opts.url,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream, application/json",
        ...opts.extraHeaders,
      },
      body: JSON.stringify(body),
    },
    {
      providerLabel: opts.providerLabel,
      partial: () => acc.content,
      onEvent: (ev) => {
        const data = sseJson(ev);
        if (data) acc.push(data);
      },
    },
  );
  if (!res.ok) throw new Error(`${opts.providerLabel} chat ${res.status}: ${res.text.slice(0, 400)}`);

  if (!res.streamed) {
    let data: unknown;
    try {
      data = JSON.parse(res.text) as unknown;
    } catch {
      throw new Error(`${opts.providerLabel} returned non-JSON.`);
    }
    rememberChatResponse(data, res.headers);
    try {
      const content = extractContent(data);
      const d = data as { choices?: { finish_reason?: unknown }[]; usage?: unknown };
      const finishReason = typeof d.choices?.[0]?.finish_reason === "string" ? d.choices[0].finish_reason : undefined;
      return {
        content,
        reasoning: combineReasoning(data, content),
        finishReason,
        usage: usageFromOpenAi(d.usage),
        elapsedMs: res.elapsedMs,
        truncated: finishReason === "length",
      };
    } catch (e) {
      throw new Error(`${opts.providerLabel} ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (acc.error) throw new Error(`${opts.providerLabel} chat stream error: ${acc.error.slice(0, 400)}`);
  rememberChatResponse(
    {
      usage: acc.usage
        ? { prompt_tokens: acc.usage.promptTokens ?? 0, completion_tokens: acc.usage.completionTokens ?? 0 }
        : undefined,
    },
    res.headers,
  );
  if (!acc.content) {
    if (acc.finishReason === "length") {
      throw new Error(`${opts.providerLabel} reply ran out of tokens before any visible text (finish_reason length).`);
    }
    throw new Error(`${opts.providerLabel} Response had no content.`);
  }
  const reasoning = [acc.reasoning.trim(), reasoningFromContent(acc.content)].filter(Boolean).join("\n\n");
  return {
    content: acc.content,
    reasoning,
    finishReason: acc.finishReason,
    usage: acc.usage,
    elapsedMs: res.elapsedMs,
    truncated: acc.finishReason === "length",
  };
}

export async function openaiCompatibleListModels(
  opts: {
    url: string;
    apiKey: string;
    extraHeaders?: Record<string, string>;
    providerLabel: string;
    filter?: (id: string) => boolean;
  },
): Promise<LlmModel[]> {
  const res = await fetch(opts.url, {
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      ...opts.extraHeaders,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${opts.providerLabel} models ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as unknown;
  const list = Array.isArray(data)
    ? data
    : Array.isArray((data as { data?: unknown }).data)
      ? (data as { data: unknown[] }).data
      : Array.isArray((data as { models?: unknown }).models)
        ? (data as { models: unknown[] }).models
        : [];
  return list
    .map(normalizeModel)
    .filter((m) => Boolean(m.id) && (!opts.filter || opts.filter(m.id)));
}

export function isOpenAiChatModel(id: string): boolean {
  const n = id.toLowerCase();
  if (
    n.includes("embedding") ||
    n.includes("whisper") ||
    n.includes("tts") ||
    n.includes("dall-e") ||
    n.includes("dall_e") ||
    n.includes("davinci") ||
    n.includes("babbage") ||
    n.includes("audio") ||
    n.includes("realtime") ||
    n.includes("transcribe") ||
    n.includes("moderation") ||
    n.includes("image") ||
    n.includes("sora")
  ) {
    return false;
  }
  return /^(gpt-|o[1-9]|chatgpt)/.test(n) || n.includes("gpt");
}
