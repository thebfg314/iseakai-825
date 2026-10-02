import type { ChatMessageParam, ChatOpts, LlmCompletion, LlmModel } from "./types";
import { combineReasoning } from "./reasoning";
import { rememberChatResponse } from "./usage";

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

export async function openaiCompatibleChat(
  opts: {
    url: string;
    apiKey: string;
    model: string;
    messages: ChatMessageParam[];
    chatOpts?: ChatOpts;
    extraHeaders?: Record<string, string>;
    providerLabel: string;
  },
): Promise<LlmCompletion> {
  const res = await fetch(opts.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
      ...opts.extraHeaders,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      max_tokens: opts.chatOpts?.maxTokens ?? 1800,
      temperature: opts.chatOpts?.temperature ?? 0.7,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${opts.providerLabel} chat ${res.status}: ${text.slice(0, 400)}`);
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${opts.providerLabel} returned non-JSON.`);
  }
  rememberChatResponse(data, res.headers);
  try {
    const content = extractContent(data);
    return { content, reasoning: combineReasoning(data, content) };
  } catch (e) {
    throw new Error(`${opts.providerLabel} ${e instanceof Error ? e.message : String(e)}`);
  }
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
