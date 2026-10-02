import { anthropicChat, listAnthropicModels } from "./anthropic";
import { isOpenAiChatModel, openaiCompatibleChat, openaiCompatibleListModels } from "./openaiCompat";
import { listRfabModels, rfabChat } from "./rfab";
import {
  PROVIDER_META,
  activeConfig,
  type AppSettings,
  type ChatMessageParam,
  type ChatOpts,
  type LlmCompletion,
  type LlmModel,
} from "./types";

const OPENROUTER_HEADERS = {
  "HTTP-Referer": "https://isekai.local",
  "X-Title": "Isekai in the year of our lord 825",
};

function requireConfig(settings: AppSettings) {
  const config = activeConfig(settings);
  const meta = PROVIDER_META[settings.provider];
  if (!config.apiKey) {
    throw new Error(`No ${meta.label} API key. Open Settings and paste a key.`);
  }
  if (!config.model) throw new Error("No model selected.");
  return config;
}

/** Content plus any reasoning the provider returned beside it. */
export async function llmComplete(settings: AppSettings, messages: ChatMessageParam[], opts?: ChatOpts): Promise<LlmCompletion> {
  const config = requireConfig(settings);
  switch (settings.provider) {
    case "rfab":
      return rfabChat(config, messages, opts);
    case "anthropic":
      return anthropicChat(config, messages, opts);
    case "openai":
      return openaiCompatibleChat({
        url: "https://api.openai.com/v1/chat/completions",
        apiKey: config.apiKey,
        model: config.model,
        messages,
        chatOpts: opts,
        providerLabel: "OpenAI",
      });
    case "openrouter":
      return openaiCompatibleChat({
        url: "https://openrouter.ai/api/v1/chat/completions",
        apiKey: config.apiKey,
        model: config.model,
        messages,
        chatOpts: opts,
        extraHeaders: OPENROUTER_HEADERS,
        providerLabel: "OpenRouter",
      });
    case "xai":
      return openaiCompatibleChat({
        url: "https://api.x.ai/v1/chat/completions",
        apiKey: config.apiKey,
        model: config.model,
        messages,
        chatOpts: opts,
        providerLabel: "xAI",
      });
    case "google":
      return openaiCompatibleChat({
        url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        apiKey: config.apiKey,
        model: config.model,
        messages,
        chatOpts: opts,
        providerLabel: "Google",
      });
  }
}

let lastReasoning = "";

/** Reasoning from the completion just returned. Empty when that reply had none. */
export function takeLastReasoning(): string {
  const reasoning = lastReasoning;
  lastReasoning = "";
  return reasoning;
}

/** Lets a test attach reasoning to a stubbed reply. */
export function stashReasoning(reasoning: string) {
  lastReasoning = reasoning;
}

export async function llmChat(settings: AppSettings, messages: ChatMessageParam[], opts?: ChatOpts): Promise<string> {
  lastReasoning = "";
  const done = await llmComplete(settings, messages, opts);
  lastReasoning = done.reasoning;
  return done.content;
}

function isGeminiChatModel(id: string): boolean {
  const n = id.replace(/^models\//, "").toLowerCase();
  return n.startsWith("gemini") && !n.includes("embedding") && !n.includes("aqa");
}

async function listGoogleModels(apiKey: string): Promise<LlmModel[]> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google models ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { models?: unknown };
  const list = Array.isArray(data.models) ? data.models : [];
  return list
    .map((raw) => {
      const o = raw as Record<string, unknown>;
      const methods = Array.isArray(o.supportedGenerationMethods) ? o.supportedGenerationMethods.map(String) : [];
      if (methods.length && !methods.includes("generateContent")) return { id: "" };
      const id = String(o.name ?? o.id ?? "").replace(/^models\//, "");
      return {
        id,
        name: typeof o.displayName === "string" ? o.displayName : undefined,
      };
    })
    .filter((m): m is LlmModel => Boolean(m.id) && isGeminiChatModel(m.id));
}

export async function listLlmModels(settings: AppSettings): Promise<LlmModel[]> {
  const config = activeConfig(settings);
  if (!config.apiKey) return [];
  switch (settings.provider) {
    case "rfab":
      return listRfabModels(config.apiKey);
    case "anthropic":
      return listAnthropicModels(config.apiKey);
    case "openai":
      return openaiCompatibleListModels({
        url: "https://api.openai.com/v1/models",
        apiKey: config.apiKey,
        providerLabel: "OpenAI",
        filter: isOpenAiChatModel,
      });
    case "openrouter":
      return openaiCompatibleListModels({
        url: "https://openrouter.ai/api/v1/models",
        apiKey: config.apiKey,
        extraHeaders: OPENROUTER_HEADERS,
        providerLabel: "OpenRouter",
      });
    case "xai":
      return openaiCompatibleListModels({
        url: "https://api.x.ai/v1/models",
        apiKey: config.apiKey,
        providerLabel: "xAI",
      });
    case "google":
      return listGoogleModels(config.apiKey);
  }
}
