export type LlmProvider = "rfab" | "openrouter" | "openai" | "anthropic" | "google" | "xai";

export const LLM_PROVIDERS: LlmProvider[] = ["rfab", "openrouter", "openai", "anthropic", "google", "xai"];

export type ProviderConfig = {
  apiKey: string;
  model: string;
};

export type ChatMessageParam = { role: "system" | "user" | "assistant"; content: string };

export type ChatOpts = { maxTokens?: number; temperature?: number };

/** Reply text the game parses, plus any hidden reasoning the provider sent beside it. */
export type LlmCompletion = {
  content: string;
  reasoning: string;
};

export type LlmModel = {
  id: string;
  name?: string;
  rate?: number;
};

export type AppSettings = {
  provider: LlmProvider;
  providers: Record<LlmProvider, ProviderConfig>;
  masterVolume: number;
  musicVolume: number;
};

/** @deprecated Use AppSettings. Kept so older imports still type-check during the swap. */
export type RfabSettings = AppSettings;

export const DEFAULT_MODELS: Record<LlmProvider, string> = {
  rfab: "grok:grok-4.5",
  openrouter: "x-ai/grok-4.5",
  openai: "gpt-4.1",
  anthropic: "claude-sonnet-4-5",
  google: "gemini-2.5-flash",
  xai: "grok-4",
};

export const DEFAULT_MODEL = DEFAULT_MODELS.rfab;

export const PROVIDER_META: Record<
  LlmProvider,
  { label: string; help: string; keyPlaceholder: string; envVar: string }
> = {
  rfab: {
    label: "Reality Fabricator",
    help: "Models are called through Reality Fabricator (api.rfab.ai). Create a key at rfab.ai → Settings → Developer API.",
    keyPlaceholder: "rfab_…",
    envVar: "RFAB_API_KEY",
  },
  openrouter: {
    label: "OpenRouter",
    help: "OpenRouter routes many labs through one key. Create a key at openrouter.ai → Keys. Model ids look like x-ai/grok-4.5 or anthropic/claude-sonnet-4.5.",
    keyPlaceholder: "sk-or-…",
    envVar: "OPENROUTER_API_KEY",
  },
  openai: {
    label: "OpenAI",
    help: "Direct OpenAI Chat Completions. Create a key at platform.openai.com → API keys.",
    keyPlaceholder: "sk-…",
    envVar: "OPENAI_API_KEY",
  },
  anthropic: {
    label: "Anthropic",
    help: "Direct Anthropic Messages API. Create a key at console.anthropic.com → API keys.",
    keyPlaceholder: "sk-ant-…",
    envVar: "ANTHROPIC_API_KEY",
  },
  google: {
    label: "Google Gemini",
    help: "Direct Gemini API (Google AI Studio). Create a key at aistudio.google.com → Get API key.",
    keyPlaceholder: "AIza…",
    envVar: "GOOGLE_API_KEY",
  },
  xai: {
    label: "xAI Grok",
    help: "Direct xAI Chat Completions. Create a key at console.x.ai → API keys.",
    keyPlaceholder: "xai-…",
    envVar: "XAI_API_KEY",
  },
};

export function isLlmProvider(v: unknown): v is LlmProvider {
  return typeof v === "string" && (LLM_PROVIDERS as string[]).includes(v);
}

export function emptyProviderMap(): Record<LlmProvider, ProviderConfig> {
  return {
    rfab: { apiKey: "", model: DEFAULT_MODELS.rfab },
    openrouter: { apiKey: "", model: DEFAULT_MODELS.openrouter },
    openai: { apiKey: "", model: DEFAULT_MODELS.openai },
    anthropic: { apiKey: "", model: DEFAULT_MODELS.anthropic },
    google: { apiKey: "", model: DEFAULT_MODELS.google },
    xai: { apiKey: "", model: DEFAULT_MODELS.xai },
  };
}

export function activeConfig(settings: AppSettings): ProviderConfig {
  return settings.providers[settings.provider];
}
