import { LlmResponseSchema, InnerMechanicalProposalSchema, MechanicalProposalSchema, PROPOSAL_TYPES, type LlmResponse, type MechanicalProposal } from "../engine/schema";
import { PROJECT_CATALOG } from "../engine/projectCatalog";
import { matchHireableSpecialist, specialistNpc } from "../engine/specialists";
import { stripEmotionCommands, normalizeEmotion, type AldricEmotion } from "../engine/emotion";
import { HOLD_AT_ONCE_APOLOGY } from "./providerErrors";
import { hasMalformedToolMarker, stripToolMarkers } from "./toolProtocol";
import { stripBooksTag } from "./hiddenTags";
import { flattenDeferInner } from "../engine/forthcoming";
import { parseHuntDifficulty } from "../engine/hunts";

export type ParseLlmResult = {
  response: LlmResponse;
  proposals: MechanicalProposal[];
  parseErrors: string[];
  emotion?: AldricEmotion;
  /** True when the model blob was chopped / not a complete parseable contract. */
  incomplete?: boolean;
  /** Hidden speech-pass tag: did the model judge that the lord's words should change the ledger? */
  books?: boolean;
};

/** First balanced `{...}` (strings and nested arrays respected). Null if braces never close. */
export function extractJsonObject(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf("{");
  if (start < 0) return null;
  let depthBrace = 0;
  let depthBracket = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depthBrace++;
    else if (ch === "}") depthBrace--;
    else if (ch === "[") depthBracket++;
    else if (ch === "]") depthBracket--;
    if (depthBrace < 0 || depthBracket < 0) return null;
    if (depthBrace === 0 && depthBracket === 0 && i > start) {
      return candidate.slice(start, i + 1);
    }
  }
  return null;
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
  hire: "register_npc",
  retain: "register_npc",
  employ: "register_npc",
  registernpc: "register_npc",
  feast: "sponsor_feast",
  sponsorfeast: "sponsor_feast",
  sponsor_feast: "sponsor_feast",
  holyday: "sponsor_feast",
  hunt: "start_hunt",
  starthunt: "start_hunt",
  defer: "defer_proposal",
  defer_proposal: "defer_proposal",
  deferproposal: "defer_proposal",
  schedule_order: "defer_proposal",
  scheduleorder: "defer_proposal",
  forthcoming: "defer_proposal",
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
  if (obj.npc || (obj.name && obj.role && (obj.isNew != null || obj.type === "register_npc"))) return "register_npc";
  if (obj.quotedDenarii != null && (obj.goods || obj.resource)) return "start_hunt";
  if (obj.tier === "plain" || obj.tier === "grand") return "sponsor_feast";
  if (
    obj.proposal &&
    (obj.beat != null ||
      obj.seasonsRemaining != null ||
      obj.applyAfterSeasons != null ||
      obj.trigger != null ||
      obj.type === "defer_proposal" ||
      obj.type === "schedule_order")
  ) {
    return "defer_proposal";
  }
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

function coerceRegisterNpc(obj: Record<string, unknown>): void {
  const nested = asRecord(obj.npc) ?? obj;
  const spec = matchHireableSpecialist({
    id: typeof nested.id === "string" ? nested.id : typeof obj.id === "string" ? obj.id : undefined,
    name: typeof nested.name === "string" ? nested.name : typeof obj.name === "string" ? obj.name : undefined,
    role: typeof nested.role === "string" ? nested.role : typeof obj.role === "string" ? obj.role : undefined,
  });
  if (spec) {
    const location =
      (typeof nested.location === "string" && nested.location) ||
      (typeof obj.location === "string" && obj.location) ||
      "fontenay";
    obj.npc = specialistNpc(spec, location);
    return;
  }
  if (!asRecord(obj.npc) && typeof nested.name === "string" && typeof nested.role === "string") {
    obj.npc = {
      id: typeof nested.id === "string" ? nested.id : String(nested.role).toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      name: nested.name,
      role: nested.role,
      location: typeof nested.location === "string" ? nested.location : "fontenay",
      notes: typeof nested.notes === "string" ? nested.notes : undefined,
      memories: [],
    };
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
    if (next.result == null) {
      next.result = next.yields ?? next.yield ?? next.output ?? next.produces ?? next.reward;
    }
    // Models write tags: ["church"] as often as tag: "church". The card keeps one tag; the first string wins.
    if (typeof next.tag !== "string" || !next.tag.trim()) {
      const tags = Array.isArray(next.tags) ? next.tags : typeof next.tags === "string" ? [next.tags] : [];
      const first = tags.find((t): t is string => typeof t === "string" && t.trim().length > 0);
      if (first) next.tag = first.trim().toLowerCase();
      else delete next.tag;
    }
  }
  if (next.type === "assign_labour") {
    if (next.projectId == null && typeof next.project === "string") next.projectId = next.project;
  }
  if (next.type === "adjust_sowing") {
    if (next.springBarleyShare == null && next.barleyShare != null) next.springBarleyShare = next.barleyShare;
    if (typeof next.rotation === "string") {
      const rot = next.rotation.toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
      if (rot === "three_field" || rot === "threefield" || rot === "three_phase" || rot === "3_field") {
        next.rotation = "three_field";
      } else if (rot === "two_field" || rot === "twofield") {
        next.rotation = "two_field";
      }
    }
  }
  if (next.type === "defer_proposal" || next.type === "schedule_order") {
    next.type = "defer_proposal";
    let innerRaw = flattenDeferInner(next.proposal ?? next.inner ?? next.order);
    if (!asRecord(innerRaw) && (next.rotation != null || next.springBarleyShare != null || next.autumnWheatShare != null)) {
      innerRaw = {
        type: "adjust_sowing",
        summary: next.summary,
        holdingId: next.holdingId,
        rotation: next.rotation,
        springBarleyShare: next.springBarleyShare,
        autumnWheatShare: next.autumnWheatShare,
      };
    }
    const innerCoerced = coerceProposalInput(innerRaw);
    const innerParsed = InnerMechanicalProposalSchema.safeParse(innerCoerced);
    next.proposal = innerParsed.success ? innerParsed.data : innerCoerced;
  }
  if (next.type === "register_resource" || next.type === "register_feature" || next.type === "register_npc") {
    coerceIsNew(next);
  }
  if (next.type === "register_npc") {
    coerceRegisterNpc(next);
  }
  if (next.type === "start_hunt") {
    if (next.quotedDenarii == null && next.denarii != null) next.quotedDenarii = next.denarii;
    if (next.quotedDenarii == null && next.cost != null) next.quotedDenarii = next.cost;
    if (next.durationSeasons == null && next.seasons != null) next.durationSeasons = next.seasons;
    if (next.durationSeasons == null && next.duration != null) next.durationSeasons = next.duration;
    if (next.goods == null && typeof next.item === "string") next.goods = next.item;
    if (typeof next.goods === "string" && next.resource == null) {
      next.resource = next.goods.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "scarce_goods";
    }
    if (next.amount == null) next.amount = 1;
    if (next.quotedDenarii == null) next.quotedDenarii = 1;
    const difficulty = parseHuntDifficulty(next.difficulty);
    if (difficulty) next.difficulty = difficulty;
    else delete next.difficulty;
  }
  if (next.type === "sponsor_feast") {
    const tier = typeof next.tier === "string" ? next.tier.toLowerCase() : "";
    if (tier === "great" || tier === "splendid") next.tier = "grand";
    else if (tier === "modest" || tier === "small") next.tier = "plain";
    if (next.feastName == null && typeof next.feast === "string") next.feastName = next.feast;
    if (next.feastName == null && typeof next.name === "string") next.feastName = next.name;
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

/** True when the player would see a contract dump instead of spoken words. */
export function looksLikeJsonDump(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.startsWith("{") && /"(speech|proposals|chronicle|emotion)"\s*:/.test(t)) return true;
  if (/"proposals"\s*:/.test(t) && t.includes("{")) return true;
  return false;
}

function looksLikeStartedJson(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.startsWith("{")) return true;
  if (t.startsWith("```") && t.includes("{")) return true;
  return looksLikeJsonDump(t);
}

/**
 * Complete plain speech (no `{`), or a fully closed JSON object that parses
 * and has a real `speech` string. Truncated slices (first nested `}`) are not complete.
 */
export function isCompleteLlmPayload(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (!looksLikeStartedJson(trimmed)) return true;
  const balanced = extractJsonObject(trimmed);
  if (!balanced) return false;
  const data = tryParseJson(balanced);
  const rec = asRecord(data);
  return typeof rec?.speech === "string" && Boolean(rec.speech.trim());
}

/** Speech from a complete payload only. Incomplete JSON → null (never salvage a chopped blob). */
export function salvageSpeechFromLlmText(raw: string): string | null {
  if (!isCompleteLlmPayload(raw)) return null;
  const trimmed = raw.trim();
  if (!looksLikeStartedJson(trimmed)) return trimmed;
  const data = tryParseJson(extractJsonObject(trimmed) ?? "");
  const rec = asRecord(data);
  if (typeof rec?.speech === "string" && rec.speech.trim()) return rec.speech.trim();
  return null;
}

/** Spoken words only. Incomplete JSON or a chopped tool marker → apology, no salvaged paragraph. */
export function playerFacingNpcSpeech(raw: string, parsedSpeech?: string): string {
  if (!isCompleteLlmPayload(raw) || hasMalformedToolMarker(raw)) return HOLD_AT_ONCE_APOLOGY;
  const fromParse = parsedSpeech?.trim() ?? "";
  if (fromParse && !looksLikeJsonDump(fromParse)) return stripBooksTag(stripToolMarkers(fromParse)).text;
  const salvaged = salvageSpeechFromLlmText(raw);
  if (salvaged && !looksLikeJsonDump(salvaged)) return stripBooksTag(stripToolMarkers(salvaged)).text;
  return HOLD_AT_ONCE_APOLOGY;
}

function incompleteParseResult(): ParseLlmResult {
  return {
    response: { speech: HOLD_AT_ONCE_APOLOGY, proposals: [] },
    proposals: [],
    parseErrors: ["Incomplete or unparseable model JSON."],
    incomplete: true,
  };
}

export function parseLlmResponse(raw: string): ParseLlmResult {
  if (!raw.trim() || (looksLikeStartedJson(raw) && !isCompleteLlmPayload(raw)) || hasMalformedToolMarker(raw)) {
    return incompleteParseResult();
  }
  const jsonText = extractJsonObject(raw);
  const parseErrors: string[] = [];
  if (!jsonText) {
    const tagged = stripBooksTag(raw);
    const facing = playerFacingNpcSpeech(tagged.text, tagged.text.trim());
    const stripped = stripEmotionCommands(facing);
    return {
      response: { speech: stripped.speech, proposals: [] },
      proposals: [],
      parseErrors: ["No JSON object in model output."],
      emotion: stripped.emotion,
      books: tagged.books,
    };
  }
  const data = tryParseJson(jsonText);
  if (data === undefined) {
    return incompleteParseResult();
  }
  const obj = asRecord(data) ?? {};
  const wrapped = LlmResponseSchema.safeParse(data);
  const extractedSpeech =
    wrapped.success && wrapped.data.speech
      ? wrapped.data.speech
      : typeof obj.speech === "string"
        ? obj.speech
        : "";
  const speech = playerFacingNpcSpeech(raw, extractedSpeech);
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
  const stripped = stripEmotionCommands(stripBooksTag(stripToolMarkers(speech)).text);
  // The tag may sit inside the speech string or after the closing brace.
  const books = stripBooksTag(raw).books;
  return {
    response: { speech: stripped.speech, chronicle, proposals: rawProposals },
    proposals,
    parseErrors,
    emotion: stripped.emotion ?? normalizeEmotion(emotionRaw),
    books,
  };
}
