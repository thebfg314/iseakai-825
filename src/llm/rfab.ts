const RFAB_BASE = "https://api.rfab.ai";

export type RfabSettings = {
  apiKey: string;
  model: string;
  masterVolume: number;
  musicVolume: number;
};

export type ChatMessageParam = { role: "system" | "user" | "assistant"; content: string };

export type RfabModel = {
  id: string;
  rate?: number;
  name?: string;
};

export async function listRfabModels(apiKey: string): Promise<RfabModel[]> {
  const res = await fetch(`${RFAB_BASE}/api/chat/completions/models`, {
    headers: { "X-API-Key": apiKey },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RFAB models ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as unknown;
  if (Array.isArray(data)) {
    return data.map(normalizeModel).filter((m): m is RfabModel => Boolean(m.id));
  }
  const obj = data as { models?: unknown; data?: unknown };
  const list = Array.isArray(obj.models) ? obj.models : Array.isArray(obj.data) ? obj.data : [];
  return list.map(normalizeModel).filter((m): m is RfabModel => Boolean(m.id));
}

function normalizeModel(raw: unknown): RfabModel {
  if (typeof raw === "string") return { id: raw };
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? o.model ?? o.name ?? "");
  return { id, name: typeof o.name === "string" ? o.name : undefined, rate: typeof o.rate === "number" ? o.rate : undefined };
}

export async function rfabChat(settings: RfabSettings, messages: ChatMessageParam[], opts?: { maxTokens?: number; temperature?: number }): Promise<string> {
  if (!settings.apiKey) throw new Error("No Reality Fabricator API key. Open Settings and paste a key from rfab.ai.");
  if (!settings.model) throw new Error("No model selected.");
  const system = messages.find((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  const body = {
    model: settings.model,
    messages: rest.length ? rest : [{ role: "user" as const, content: "..." }],
    systemPrompt: system?.content,
    maxTokens: opts?.maxTokens ?? 1800,
    temperature: opts?.temperature ?? 0.7,
  };
  const res = await fetch(`${RFAB_BASE}/api/chat/completions`, {
    method: "POST",
    headers: {
      "X-API-Key": settings.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`RFAB chat ${res.status}: ${text.slice(0, 400)}`);
  let data: { content?: string; success?: boolean };
  try {
    data = JSON.parse(text) as { content?: string; success?: boolean };
  } catch {
    throw new Error("RFAB returned non-JSON.");
  }
  if (!data.content) throw new Error("RFAB response had no content.");
  return data.content;
}

export const DEFAULT_MODEL = "grok:grok-4.5";
