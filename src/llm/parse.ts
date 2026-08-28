import { LlmResponseSchema, MechanicalProposalSchema, PROPOSAL_TYPES, type LlmResponse, type MechanicalProposal } from "../engine/schema";
import { PROJECT_CATALOG } from "../engine/projectCatalog";
import { stripEmotionCommands, normalizeEmotion, type AldricEmotion } from "../engine/emotion";

export type ParseLlmResult = {
  response: LlmResponse;
  proposals: MechanicalProposal[];
  parseErrors: string[];
  emotion?: AldricEmotion;
};

export function extractJsonObject(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

function stripTrailingCommas(json: string): string {
  return json.replace(/,\s*([}\]])/g, "$1");
}

function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(stripTrailingCommas(text));
    } catch {
      return undefined;
    }
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function proposalList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const rec = asRecord(raw);
  if (!rec) return [];
  if (Array.isArray(rec.proposals)) return rec.proposals;
  if (rec.type || rec.proposalType || rec.projectKey) return [rec];
  return Object.values(rec);
}

const TYPE_ALIASES: Record<string, (typeof PROPOSAL_TYPES)[number]> = {
  labour: "assign_labour",
  assignlabour: "assign_labour",
  assign_labor: "assign_labour",
  standing_order: "set_standing_order",
  standingorder: "set_standing_order",
  project: "start_project",
  startproject: "start_project",
  start_work: "start_project",
  adjustproject: "adjust_project",
  sowing: "adjust_sowing",
  sow: "adjust_sowing",
  plant: "adjust_sowing",
  transfer: "transfer_resources",
  resources: "transfer_resources",
  gift: "transfer_resources",
  give: "transfer_resources",
  modifier: "add_modifier",
  addmodifier: "add_modifier",
  buff: "add_modifier",
  blessing: "add_modifier",
  event: "event_effect",
  eventeffect: "event_effect",
};

const DIRECTION_ALIASES: Record<string, "buy" | "sell" | "consume" | "gain"> = {
  buy: "buy",
  purchase: "buy",
  sell: "sell",
  sale: "sell",
  consume: "consume",
  give: "consume",
  gift: "consume",
  tithe: "consume",
  alms: "consume",
  spend: "consume",
  pay: "consume",
  grant: "gain",
  receive: "gain",
  gain: "gain",
  add: "gain",
};

function normKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function guessType(obj: Record<string, unknown>): string | undefined {
  const raw = obj.type ?? obj.proposalType ?? obj.kind;
  if (typeof raw === "string") {
    const compact = normKey(raw);
    if ((PROPOSAL_TYPES as readonly string[]).includes(raw)) return raw;
    const aliased = TYPE_ALIASES[raw] ?? TYPE_ALIASES[compact];
    if (aliased) return aliased;
    const dashed = raw.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`).replace(/^_/, "");
    if ((PROPOSAL_TYPES as readonly string[]).includes(dashed)) return dashed;
  }
  if (obj.eventId) return "event_effect";
  if (obj.projectKey) return "start_project";
  if (obj.projectId && (obj.men != null || obj.women != null || obj.youths != null)) return "assign_labour";
  if (obj.springBarleyShare != null || obj.autumnWheatShare != null || obj.barley != null || obj.wheat != null) {
    return "adjust_sowing";
  }
  if (obj.resource && (obj.amount != null || obj.direction)) return "transfer_resources";
  if (obj.target && (obj.effect || obj.source)) return "add_modifier";
  if (obj.text && obj.active != null) return "set_standing_order";
  return undefined;
}

function coerceDirection(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  return DIRECTION_ALIASES[v.toLowerCase()] ?? (["buy", "sell", "consume", "gain"].includes(v) ? v : undefined);
}

function coerceEffect(raw: unknown): { op: "multiply" | "add" | "set"; value: number } | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw >= 0.4 && raw <= 2.5 && raw !== 0 ? { op: "multiply", value: raw } : { op: "add", value: raw };
  }
  const obj = asRecord(raw);
  if (!obj) return undefined;
  if (obj.op != null && obj.value != null) {
    const opRaw = String(obj.op).toLowerCase();
    const op = opRaw === "mul" || opRaw === "mult" ? "multiply" : opRaw === "plus" ? "add" : opRaw;
    if (op === "multiply" || op === "add" || op === "set") {
      const value = Number(obj.value);
      if (Number.isFinite(value)) return { op, value };
    }
  }
  for (const op of ["multiply", "add", "set"] as const) {
    if (obj[op] != null) {
      const value = Number(obj[op]);
      if (Number.isFinite(value)) return { op, value };
    }
  }
  return undefined;
}

function coerceKind(v: unknown): "temporary" | "permanent" | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.toLowerCase();
  if (s.startsWith("temp") || s === "seasonal") return "temporary";
  if (s.startsWith("perm") || s === "lasting") return "permanent";
  return undefined;
}

function coerceBoolTrue(v: unknown): true | undefined {
  if (v === true || v === "true" || v === 1 || v === "1" || v === "yes") return true;
  if (v == null) return true;
  return undefined;
}

function normalizeProjectKey(key: string): string {
  const compact = key.toLowerCase().trim().replace(/\s+/g, "_");
  const stemmed = compact.replace(/ing_/g, "_");
  const candidates = [compact, stemmed, key.toLowerCase()];
  for (const c of candidates) {
    const exact = PROJECT_CATALOG.find((p) => p.key === c || p.name.toLowerCase() === c.replaceAll("_", " "));
    if (exact) return exact.key;
  }
  const fuzzy = PROJECT_CATALOG.find((p) => {
    const name = p.name.toLowerCase();
    return (
      compact.includes(p.key) ||
      p.key.includes(stemmed) ||
      stemmed.includes(p.key) ||
      name.includes(key.toLowerCase()) ||
      key.toLowerCase().split(/\s+/).filter((w) => w.length > 3).every((w) => name.includes(w.replace(/ing$/, "")))
    );
  });
  return fuzzy?.key ?? compact;
}

function coerceIsNew(obj: Record<string, unknown>): void {
  if ("isNew" in obj) {
    const coerced = coerceBoolTrue(obj.isNew);
    if (coerced) obj.isNew = true;
  } else {
    obj.isNew = true;
  }
}

/** Best-effort shape so Zod is less likely to drop a real order. */
export function coerceProposalInput(raw: unknown): unknown {
  const obj = asRecord(raw);
  if (!obj) return raw;
  const next: Record<string, unknown> = { ...obj };
  const type = guessType(next);
  if (type) next.type = type;
  if (typeof next.summary !== "string" || !next.summary.trim()) {
    next.summary = typeof next.description === "string" ? next.description : type ?? "Proposed change";
  }
  if (next.type === "transfer_resources") {
    const dir = coerceDirection(next.direction) ?? coerceDirection(next.action);
    if (dir) next.direction = dir;
    if (next.resource == null && typeof next.good === "string") next.resource = next.good;
  }
  if (next.type === "add_modifier") {
    const effect = coerceEffect(next.effect) ?? coerceEffect(next);
    if (effect) next.effect = effect;
    const kind = coerceKind(next.kind) ?? "temporary";
    next.kind = kind;
    if (next.source == null) next.source = next.summary;
    if (next.seasonsRemaining == null && next.seasons_remaining != null) next.seasonsRemaining = next.seasons_remaining;
  }
  if (next.type === "start_project") {
    if (typeof next.projectKey === "string") next.projectKey = normalizeProjectKey(next.projectKey);
    else if (typeof next.key === "string") next.projectKey = normalizeProjectKey(next.key);
    if (next.holdingId == null && typeof next.holding === "string") next.holdingId = next.holding;
  }
  if (next.type === "assign_labour") {
    if (next.projectId == null && typeof next.project === "string") next.projectId = next.project;
  }
  if (next.type === "adjust_sowing") {
    if (next.springBarleyShare == null && next.barleyShare != null) next.springBarleyShare = next.barleyShare;
  }
  if (next.type === "register_resource" || next.type === "register_feature" || next.type === "register_npc") {
    coerceIsNew(next);
  }
  if (next.type === "event_effect") {
    const dir = coerceDirection(next.direction);
    if (dir) next.direction = dir;
    if (next.eventId == null && typeof next.event === "string") next.eventId = next.event;
  }
  return next;
}

export function parseProposal(raw: unknown): { proposal?: MechanicalProposal; error?: string } {
  const coerced = coerceProposalInput(raw);
  const parsed = MechanicalProposalSchema.safeParse(coerced);
  if (parsed.success) return { proposal: parsed.data };
  return { error: parsed.error.issues.map((i) => `${i.path.join(".") || "proposal"}: ${i.message}`).join("; ") };
}

export function eventEffectHasMechanics(p: MechanicalProposal): boolean {
  if (p.type !== "event_effect") return true;
  if (p.resource && p.amount && p.direction) return true;
  if (p.moodDelta) return true;
  if (p.nested && p.nested.length > 0) return true;
  return false;
}

export function parseLlmResponse(raw: string): ParseLlmResult {
  const jsonText = extractJsonObject(raw);
  const parseErrors: string[] = [];
  if (!jsonText) {
    const stripped = stripEmotionCommands(raw.trim() || "(The steward is silent.)");
    return {
      response: { speech: stripped.speech, proposals: [] },
      proposals: [],
      parseErrors: ["No JSON object in model output."],
      emotion: stripped.emotion,
    };
  }
  const data = tryParseJson(jsonText);
  if (data === undefined) {
    const stripped = stripEmotionCommands(raw.trim());
    return {
      response: { speech: stripped.speech, proposals: [] },
      proposals: [],
      parseErrors: ["JSON.parse failed after trailing-comma repair."],
      emotion: stripped.emotion,
    };
  }
  const obj = asRecord(data) ?? {};
  const wrapped = LlmResponseSchema.safeParse(data);
  const speech =
    wrapped.success && wrapped.data.speech
      ? wrapped.data.speech
      : typeof obj.speech === "string"
        ? obj.speech
        : raw.trim();
  const chronicle = wrapped.success
    ? wrapped.data.chronicle
    : typeof obj.chronicle === "string"
      ? obj.chronicle
      : undefined;
  const emotionRaw = wrapped.success ? wrapped.data.emotion : typeof obj.emotion === "string" ? obj.emotion : undefined;
  const rawProposals = proposalList(wrapped.success ? wrapped.data.proposals : (obj.proposals ?? obj.proposal));
  if (!wrapped.success) {
    parseErrors.push(...wrapped.error.issues.map((i) => `response ${i.path.join(".")}: ${i.message}`));
  }

  const proposals: MechanicalProposal[] = [];
  for (const item of rawProposals) {
    const result = parseProposal(item);
    if (result.proposal) proposals.push(result.proposal);
    else parseErrors.push(`Dropped proposal: ${result.error}`);
  }
  const stripped = stripEmotionCommands(speech);
  return {
    response: { speech: stripped.speech, chronicle, proposals: rawProposals },
    proposals,
    parseErrors,
    emotion: stripped.emotion ?? normalizeEmotion(emotionRaw),
  };
}
