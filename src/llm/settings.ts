import {
  DEFAULT_MODELS,
  LLM_PROVIDERS,
  PROVIDER_META,
  SEARCH_KEY_ENV,
  emptyProviderMap,
  isLlmProvider,
  type AppSettings,
  type LlmProvider,
  type ProviderConfig,
} from "./types";

export function clampVolume(n: unknown, fallback: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

export function defaultAppSettings(): AppSettings {
  return {
    provider: "rfab",
    providers: emptyProviderMap(),
    masterVolume: 1,
    musicVolume: 0.55,
    searchApiKey: "",
    playLogEnabled: true,
  };
}

function readProviderEntry(raw: unknown, id: LlmProvider): ProviderConfig {
  const fallback: ProviderConfig = { apiKey: "", model: DEFAULT_MODELS[id] };
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as Record<string, unknown>;
  return {
    apiKey: typeof o.apiKey === "string" ? o.apiKey : "",
    model: typeof o.model === "string" && o.model ? o.model : DEFAULT_MODELS[id],
  };
}

function envValue(name: string): string {
  const v = typeof process !== "undefined" ? process.env[name] : undefined;
  return typeof v === "string" ? v : "";
}

export function applyEnvFallbacks(settings: AppSettings): AppSettings {
  const providers = emptyProviderMap();
  for (const id of LLM_PROVIDERS) {
    const current = settings.providers[id];
    const fromEnv = envValue(PROVIDER_META[id].envVar);
    providers[id] = {
      apiKey: current.apiKey || fromEnv,
      model: current.model || DEFAULT_MODELS[id],
    };
  }
  return { ...settings, providers, searchApiKey: settings.searchApiKey || envValue(SEARCH_KEY_ENV) };
}

/** Accept both the new provider map and legacy `{ apiKey, model }` files. */
export function normalizeSettings(raw: unknown): AppSettings {
  const base = defaultAppSettings();
  if (!raw || typeof raw !== "object") return applyEnvFallbacks(base);

  const o = raw as Record<string, unknown>;
  const providers = emptyProviderMap();

  if (o.providers && typeof o.providers === "object") {
    const map = o.providers as Record<string, unknown>;
    for (const id of LLM_PROVIDERS) {
      providers[id] = readProviderEntry(map[id], id);
    }
  } else {
    providers.rfab = {
      apiKey: typeof o.apiKey === "string" ? o.apiKey : "",
      model: typeof o.model === "string" && o.model ? o.model : DEFAULT_MODELS.rfab,
    };
  }

  return applyEnvFallbacks({
    provider: isLlmProvider(o.provider) ? o.provider : "rfab",
    providers,
    masterVolume: clampVolume(o.masterVolume, 1),
    musicVolume: clampVolume(o.musicVolume, 0.55),
    searchApiKey: typeof o.searchApiKey === "string" ? o.searchApiKey : "",
    playLogEnabled: o.playLogEnabled !== false,
  });
}

export type SettingsPatch = Partial<AppSettings> & {
  providers?: Partial<Record<LlmProvider, Partial<ProviderConfig>>>;
};

export function mergeSettings(current: AppSettings, patch: SettingsPatch): AppSettings {
  const providers = emptyProviderMap();
  for (const id of LLM_PROVIDERS) {
    const next = patch.providers?.[id];
    providers[id] = {
      apiKey: next?.apiKey ?? current.providers[id].apiKey,
      model: next?.model ?? current.providers[id].model,
    };
  }
  return {
    provider: isLlmProvider(patch.provider) ? patch.provider : current.provider,
    providers,
    masterVolume: patch.masterVolume ?? current.masterVolume,
    musicVolume: patch.musicVolume ?? current.musicVolume,
    searchApiKey: patch.searchApiKey ?? current.searchApiKey ?? "",
    playLogEnabled: patch.playLogEnabled ?? current.playLogEnabled,
  };
}
