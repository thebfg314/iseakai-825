import type { AldricEmotion } from "./emotion";
import {
  CANONICAL_RESOURCES,
  type CanonicalResource,
  type MechanicalProposal,
  type Npc,
  type StartHuntProposal,
  type WorldState,
} from "./schema";
import { looksLikeHireOrder, specialistsFromHireText } from "./specialists";
import { newId, round1 } from "./util";

export const NEGOTIATOR_ID = "negotiator";
export const GERULF_HUNT_KEY = "gerulf_hunt";
export const GERULF_ROAD_LOCATION = "road";
export const GERULF_HOME_LOCATION = "fontenay";

export const GERULF_NOTES =
  "Highly charismatic; incredibly confident; wry sense of humor. About the work: no deal works if the numbers aren't right, and even then mishaps on the road and false rumours can stop a deal cold. Does not wait for the right cart — takes a purse and a brief and walks the roads. Talks contacts, tolls, rumor, true worth inland. Proud when he brings something hard back; sour if you change the brief mid-hunt. Grain/iron → Aldric/Bernard; odd/scarce/far-off → him.";

const GRAIN_RESOURCES = new Set(["wheat", "rye", "barley", "oats"]);
const BERNARD_RESOURCES = new Set(["iron", "charcoal"]);

const GRAIN_WORDS = /\b(barley|wheat|rye|oats|grain|granary|modii|modius|seed[- ]?corn)\b/i;
const IRON_WORDS = /\b(iron|charcoal|bloom(?:\s*iron)?)\b/i;

const HUNT_VERB =
  /\b(find|fetch|seek|procure|source|hunt|track\s+down|look\s+for|bring(?:\s+me)?|get\s+me|send\s+(?:out\s+)?for)\b/i;

const SCARCE_HINT =
  /\b(pepper|peppers|spice|spices|silk|silks|millstone|millstones|glass|incense|alum|saffron|ivory|dye|dyes|cinnamon|cloves|purple|papyrus|myrrh|frankincense|tin|copper|salt|wine|linen|beeswax|horses?|trade[- ]?goods?|wares?|stone|hides?|honey|wool|cattle|sheep|pigs?|tinware|brass|lead|quicksilver|vermilion|madder|woad)\b/i;

const CUSTOM_PRICES: Record<string, { denarii: number; seasons: number; unit: string }> = {
  pepper: { denarii: 42, seasons: 2, unit: "pound" },
  peppers: { denarii: 42, seasons: 2, unit: "pound" },
  spice: { denarii: 40, seasons: 2, unit: "pound" },
  spices: { denarii: 40, seasons: 2, unit: "pound" },
  silk: { denarii: 55, seasons: 3, unit: "yard" },
  silks: { denarii: 55, seasons: 3, unit: "yard" },
  millstone: { denarii: 48, seasons: 2, unit: "stone" },
  millstones: { denarii: 48, seasons: 2, unit: "stone" },
  glass: { denarii: 36, seasons: 2, unit: "piece" },
  incense: { denarii: 32, seasons: 2, unit: "pound" },
  alum: { denarii: 28, seasons: 2, unit: "pound" },
  saffron: { denarii: 60, seasons: 3, unit: "ounce" },
  ivory: { denarii: 70, seasons: 3, unit: "piece" },
  dye: { denarii: 34, seasons: 2, unit: "pound" },
  dyes: { denarii: 34, seasons: 2, unit: "pound" },
  cinnamon: { denarii: 44, seasons: 3, unit: "pound" },
  cloves: { denarii: 46, seasons: 3, unit: "pound" },
  purple: { denarii: 64, seasons: 3, unit: "yard" },
  papyrus: { denarii: 30, seasons: 2, unit: "sheet" },
  myrrh: { denarii: 38, seasons: 2, unit: "pound" },
  frankincense: { denarii: 38, seasons: 2, unit: "pound" },
};

function isCanonical(id: string): id is CanonicalResource {
  return (CANONICAL_RESOURCES as readonly string[]).includes(id);
}

function compact(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function slugGoods(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return slug || "scarce_goods";
}

function midpointPrice(state: WorldState, resource: string): number {
  const range = state.market[resource];
  if (range) return (range.min + range.max) / 2;
  const custom = state.custom_resources.find((c) => c.id === resource);
  if (custom) return (custom.priceMin + custom.priceMax) / 2;
  return 0;
}

function clampAmount(n: number): number {
  const v = Number.isFinite(n) ? Math.round(n) : 1;
  return Math.min(12, Math.max(1, v || 1));
}

export function gerulfNpc(location = GERULF_HOME_LOCATION): Npc {
  return {
    id: NEGOTIATOR_ID,
    name: "Gerulf",
    role: "negotiator",
    location,
    notes: GERULF_NOTES,
    memories: [],
  };
}

export function isNegotiatorId(id: string): boolean {
  return id === NEGOTIATOR_ID;
}

/** Inject Gerulf on old saves that predate the starter household. Safe if he is already present. */
export function ensureGerulfInHousehold(state: WorldState): boolean {
  if (
    state.npcs.some(
      (n) =>
        n.id === NEGOTIATOR_ID ||
        n.role === "negotiator" ||
        n.name.toLowerCase() === "gerulf",
    )
  ) {
    return false;
  }
  state.npcs.push(gerulfNpc(state.holdings[0]?.id ?? GERULF_HOME_LOCATION));
  return true;
}

export function activeHunt(state: WorldState) {
  return state.projects.find((p) => p.status === "active" && (p.tag === "hunt" || Boolean(p.hunt)));
}

export function gerulfOnTheRoad(state: WorldState): boolean {
  const npc = state.npcs.find((n) => n.id === NEGOTIATOR_ID);
  if (activeHunt(state)) return true;
  return npc?.location === GERULF_ROAD_LOCATION;
}

export type HuntBrief = {
  goods: string;
  resource: string;
  amount: number;
  quotedDenarii: number;
  durationSeasons: number;
  riskNote: string;
  unit: string;
  customName?: string;
  customUnit?: string;
  priceMin?: number;
  priceMax?: number;
  tags?: string[];
  customNotes?: string;
};

export type HuntRequest = {
  goods: string;
  resource: string;
  amount: number;
};

function canonicalFromText(text: string): CanonicalResource | undefined {
  const compactText = compact(text);
  for (const id of CANONICAL_RESOURCES) {
    if (id === "denarii") continue;
    const name = id.replaceAll("_", " ");
    const re = new RegExp(`\\b${name.replace(" ", "[- ]?")}\\b`, "i");
    if (re.test(text) || compactText.includes(compact(id))) return id;
  }
  return undefined;
}

function parseAmount(text: string): number | undefined {
  const m = text.match(/\b(\d+(?:\.\d+)?)\b/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

function customHintFromText(text: string): string | undefined {
  const match = text.match(SCARCE_HINT);
  return match?.[1]?.toLowerCase();
}

function goodsAfterVerb(text: string): string | undefined {
  const m = text.match(
    /(?:find|fetch|seek|procure|source|hunt|track\s+down|look\s+for|bring(?:\s+me)?|get\s+me|send\s+(?:out\s+)?for)\s+(?:me\s+)?(?:some\s+|a\s+|an\s+|the\s+)?(.+)$/i,
  );
  if (!m) return undefined;
  const raw = m[1].replace(/[.!?].*$/, "").replace(/\b(please|for the (?:villa|house|hall))\b/gi, "").trim();
  if (!raw || raw.length > 48) return undefined;
  return raw.replace(/^(?:some|a|an|the)\s+/i, "").trim();
}

export function extractHuntRequest(text: string): HuntRequest | null {
  const t = text.trim();
  if (!t) return null;
  const amount = clampAmount(parseAmount(t) ?? 1);
  const canonical = canonicalFromText(t);
  if (canonical && canonical !== "denarii") {
    return { goods: canonical.replaceAll("_", " "), resource: canonical, amount };
  }
  const hint = customHintFromText(t);
  if (hint) {
    return { goods: hint, resource: slugGoods(hint), amount };
  }
  if (!HUNT_VERB.test(t)) return null;
  const after = goodsAfterVerb(t);
  if (!after) return null;
  const afterCanonical = canonicalFromText(after);
  if (afterCanonical && afterCanonical !== "denarii") {
    return { goods: afterCanonical.replaceAll("_", " "), resource: afterCanonical, amount };
  }
  return { goods: after, resource: slugGoods(after), amount };
}

export function looksLikeHuntOrder(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (GRAIN_WORDS.test(t) && HUNT_VERB.test(t)) return true;
  if (IRON_WORDS.test(t) && HUNT_VERB.test(t)) return true;
  if (extractHuntRequest(t) && (HUNT_VERB.test(t) || SCARCE_HINT.test(t))) return true;
  return false;
}

export function huntRedirectReason(text: string): string | null {
  if (specialistsFromHireText(text).length > 0 || (looksLikeHireOrder(text) && /\b(carpenter|mason|potter|quarry|reeve|seamstress|vinedresser|captain|craftsman)\b/i.test(text))) {
    return "Aldric the steward keeps the household books and seeks craftsmen. I walk the roads for goods.";
  }
  const req = extractHuntRequest(text);
  if (req && GRAIN_RESOURCES.has(req.resource)) {
    return "Do not send me for barley; that is Aldric's world. Grain and the granary are his.";
  }
  if (GRAIN_WORDS.test(text) && (HUNT_VERB.test(text) || /\b(barley|wheat|rye|oats|grain)\b/i.test(text))) {
    if (!req || GRAIN_RESOURCES.has(req.resource) || GRAIN_WORDS.test(req.goods)) {
      return "Do not send me for barley; that is Aldric's world. Grain and the granary are his.";
    }
  }
  if (req && BERNARD_RESOURCES.has(req.resource)) {
    return "Iron and charcoal belong to Bernard's hearth. Send me for what the carts will not carry.";
  }
  if (IRON_WORDS.test(text) && HUNT_VERB.test(text) && (!req || BERNARD_RESOURCES.has(req.resource))) {
    return "Iron and charcoal belong to Bernard's hearth. Send me for what the carts will not carry.";
  }
  return null;
}

export function quoteHunt(state: WorldState, req: HuntRequest): HuntBrief {
  const amount = clampAmount(req.amount);
  const resource = req.resource;
  const goods = req.goods.trim() || resource.replaceAll("_", " ");
  const riskNote =
    "No deal works if the numbers are not right — and even then a mishap on the road or a false rumour can stop it cold.";

  if (isCanonical(resource)) {
    const mid = midpointPrice(state, resource) || 8;
    const inland = resource === "horses" ? 1.35 : resource === "salt" || resource === "wine" ? 2.2 : 2.0;
    const per = Math.max(6, Math.round(mid * inland + 4));
    const quotedDenarii = Math.max(8, per * amount);
    const durationSeasons = quotedDenarii >= 80 ? 3 : quotedDenarii >= 36 ? 2 : 1;
    return {
      goods,
      resource,
      amount,
      quotedDenarii,
      durationSeasons,
      riskNote,
      unit: resource === "denarii" ? "denarii" : "",
    };
  }

  const hint = CUSTOM_PRICES[compact(goods)] ?? CUSTOM_PRICES[compact(resource)];
  const per = hint?.denarii ?? 36;
  const seasons = hint?.seasons ?? 2;
  const unit = hint?.unit ?? "lot";
  const quotedDenarii = Math.max(12, per * amount);
  const priceMin = Math.max(4, Math.round(per * 0.7));
  const priceMax = Math.round(per * 1.3);
  return {
    goods,
    resource,
    amount,
    quotedDenarii,
    durationSeasons: Math.min(8, seasons),
    riskNote,
    unit,
    customName: goods,
    customUnit: unit,
    priceMin,
    priceMax,
    tags: ["scarce", "hunt"],
    customNotes: "Fetched inland by Gerulf; visiting carts rarely carry it.",
  };
}

export function huntSummary(brief: HuntBrief): string {
  const seasons = brief.durationSeasons === 1 ? "1 season" : `${brief.durationSeasons} seasons`;
  return `Gerulf seeks ${brief.amount} ${brief.goods} — ${brief.quotedDenarii} denarii from the chest, ${seasons} on the road.`;
}

export function huntProposal(brief: HuntBrief): StartHuntProposal {
  return {
    type: "start_hunt",
    summary: huntSummary(brief),
    goods: brief.goods,
    resource: brief.resource,
    amount: brief.amount,
    quotedDenarii: brief.quotedDenarii,
    durationSeasons: brief.durationSeasons,
    riskNote: brief.riskNote,
    unit: brief.unit || undefined,
    customName: brief.customName,
    customUnit: brief.customUnit,
    priceMin: brief.priceMin,
    priceMax: brief.priceMax,
    tags: brief.tags,
    customNotes: brief.customNotes,
  };
}

export function normalizeHuntProposal(state: WorldState, p: StartHuntProposal): StartHuntProposal {
  const req: HuntRequest = {
    goods: p.goods,
    resource: p.resource || slugGoods(p.goods),
    amount: p.amount,
  };
  const brief = quoteHunt(state, req);
  return huntProposal(brief);
}

export function inferHuntProposals(state: WorldState, playerText: string): MechanicalProposal[] {
  if (huntFulfillReason(state, playerText)) return [];
  const req = extractHuntRequest(playerText);
  if (!req) return [];
  if (GRAIN_RESOURCES.has(req.resource) || BERNARD_RESOURCES.has(req.resource)) return [];
  return [huntProposal(quoteHunt(state, req))];
}

export function huntFulfillReason(state: WorldState, playerText: string): string | null {
  if (!looksLikeHuntOrder(playerText) && !extractHuntRequest(playerText)) return null;
  const redirect = huntRedirectReason(playerText);
  if (redirect) return redirect;
  if (activeHunt(state)) {
    return "I am already on the road with a brief. Do not change it mid-hunt — the numbers will not hold.";
  }
  const req = extractHuntRequest(playerText);
  if (!req) {
    return "Name the thing you want. I will say what it costs and how long I need — then I go looking.";
  }
  if (state.merchant.present && state.flags.merchant_present) {
    const stall = state.merchant.stock.find((s) => s.resource === req.resource);
    if (stall && stall.amount > 0) {
      return "The carts already carry that. Speak to the merchant while he is here; I walk for what they will not bring.";
    }
  }
  const brief = quoteHunt(state, req);
  if (state.resources.denarii < brief.quotedDenarii) {
    return `The chest cannot spare ${brief.quotedDenarii} denarii for that hunt. Fontenay is thin.`;
  }
  return null;
}

export function negotiatorAllowed(state: WorldState, p: MechanicalProposal): string | null {
  if (p.type === "start_hunt") return null;
  if (p.type === "adjust_project") {
    const proj = state.projects.find((x) => x.id === p.projectId);
    if (proj?.hunt || proj?.tag === "hunt") return null;
    return "npc_not_authorized";
  }
  return "npc_not_authorized";
}

export function startHunt(state: WorldState, p: StartHuntProposal): { ok: true; logLine: string } | { ok: false; reason: string; logLine: string } {
  const brief = quoteHunt(state, { goods: p.goods, resource: p.resource, amount: p.amount });
  if (activeHunt(state)) {
    return {
      ok: false,
      reason: "Gerulf is already on the road with a brief.",
      logLine: p.summary,
    };
  }
  if (GRAIN_RESOURCES.has(brief.resource)) {
    return { ok: false, reason: "Do not send Gerulf for grain; that is Aldric's world.", logLine: p.summary };
  }
  if (BERNARD_RESOURCES.has(brief.resource)) {
    return { ok: false, reason: "Iron and charcoal belong to Bernard's hearth.", logLine: p.summary };
  }
  if (state.resources.denarii < brief.quotedDenarii) {
    return {
      ok: false,
      reason: `Need ${brief.quotedDenarii} denarii for the purse; have ${state.resources.denarii}.`,
      logLine: p.summary,
    };
  }

  state.resources.denarii = round1(state.resources.denarii - brief.quotedDenarii);
  const holdingId = state.holdings[0]?.id ?? GERULF_HOME_LOCATION;
  const id = newId("proj");
  state.projects.push({
    id,
    key: GERULF_HUNT_KEY,
    name: `Hunt: ${brief.goods}`,
    holdingId,
    labourDaysRequired: 0,
    labourDaysDone: 0,
    materials: { lumber: 0, iron: 0, stone: 0 },
    materialsReserved: false,
    status: "active",
    tag: "hunt",
    notes: brief.riskNote,
    hunt: {
      goods: brief.goods,
      resource: brief.resource,
      amount: brief.amount,
      quotedDenarii: brief.quotedDenarii,
      escrowedDenarii: brief.quotedDenarii,
      durationSeasons: brief.durationSeasons,
      seasonsElapsed: 0,
      riskNote: brief.riskNote,
      unit: brief.unit || undefined,
      customName: brief.customName,
      customUnit: brief.customUnit,
      priceMin: brief.priceMin,
      priceMax: brief.priceMax,
      tags: brief.tags,
      customNotes: brief.customNotes,
      reported: false,
    },
  });
  const npc = state.npcs.find((n) => n.id === NEGOTIATOR_ID);
  if (npc) npc.location = GERULF_ROAD_LOCATION;
  return {
    ok: true,
    logLine: `Gerulf took ${brief.quotedDenarii} denarii and left looking for ${brief.amount} ${brief.goods} (${brief.durationSeasons} season${brief.durationSeasons === 1 ? "" : "s"}).`,
  };
}

function creditGoods(state: WorldState, hunt: NonNullable<WorldState["projects"][0]["hunt"]>, amount: number) {
  const add = round1(Math.max(0, amount));
  if (add <= 0) return;
  if (isCanonical(hunt.resource)) {
    state.resources[hunt.resource] = round1(state.resources[hunt.resource] + add);
    return;
  }
  let custom = state.custom_resources.find((c) => c.id === hunt.resource);
  if (!custom) {
    const priceMin = hunt.priceMin ?? 8;
    const priceMax = hunt.priceMax ?? 16;
    custom = {
      id: hunt.resource,
      name: hunt.customName ?? hunt.goods,
      unit: hunt.customUnit ?? hunt.unit ?? "lot",
      amount: 0,
      priceMin,
      priceMax,
      notes: hunt.customNotes,
      tags: hunt.tags ?? ["scarce", "hunt"],
    };
    state.custom_resources.push(custom);
    state.market[hunt.resource] = { min: priceMin, max: priceMax };
  }
  custom.amount = round1(custom.amount + add);
}

function refund(state: WorldState, denarii: number) {
  const v = round1(Math.max(0, denarii));
  if (v > 0) state.resources.denarii = round1(state.resources.denarii + v);
  return v;
}

function bringGerulfHome(state: WorldState) {
  const npc = state.npcs.find((n) => n.id === NEGOTIATOR_ID);
  if (npc) npc.location = state.holdings[0]?.id ?? GERULF_HOME_LOCATION;
}

type HuntOutcome = "success" | "partial" | "over_budget" | "rumor" | "mishap";

function rollOutcome(): HuntOutcome {
  const r = Math.random();
  if (r < 0.5) return "success";
  if (r < 0.7) return "partial";
  if (r < 0.85) return "over_budget";
  if (r < 0.95) return "rumor";
  return "mishap";
}

function outcomeSpeech(outcome: HuntOutcome, hunt: NonNullable<WorldState["projects"][0]["hunt"]>, extra?: string): {
  text: string;
  emotion: AldricEmotion;
} {
  switch (outcome) {
    case "success":
      return {
        emotion: "pleased",
        text: `I have it, my lord — ${hunt.amount} ${hunt.goods}. The numbers held, and I am proud to set it in your stores. ${hunt.quotedDenarii} denarii walked the roads with me; they are spent.`,
      };
    case "partial":
      return {
        emotion: "concerned",
        text: `Part of what you asked, not the whole. I brought some ${hunt.goods}, and what is left of the purse. Tolls, or a rumour that was only half true.${extra ?? ""}`,
      };
    case "over_budget":
      return {
        emotion: "thoughtful",
        text: `I have the ${hunt.goods} — but inland it cost more than I quoted. ${extra ?? "The chest made up the difference."} No deal works if the numbers are not right.`,
      };
    case "rumor":
      return {
        emotion: "disappointed",
        text: `False rumour. No such goods at that fair. I am back with empty hands and what is left of the purse.${extra ?? ""}`,
      };
    case "mishap":
      return {
        emotion: "concerned",
        text: `The road took the purse. A mishap — not a cheat, only the roads. I am back with empty hands.`,
      };
  }
}

/** Advance Gerulf hunts one season. Completes with engine-owned success, partial, extra cost, or failure. */
export function resolveHunts(state: WorldState): string[] {
  const lines: string[] = [];
  for (const proj of state.projects.filter((p) => p.status === "active" && p.hunt)) {
    const hunt = proj.hunt!;
    hunt.seasonsElapsed += 1;
    const left = hunt.durationSeasons - hunt.seasonsElapsed;
    if (left > 0) {
      lines.push(
        `Gerulf still on the road for ${hunt.goods}: ${left} season${left === 1 ? "" : "s"} yet.`,
      );
      continue;
    }

    let outcome = rollOutcome();
    if (outcome === "over_budget") {
      const extra = Math.max(4, Math.ceil(hunt.quotedDenarii * 0.25));
      if (state.resources.denarii >= extra) {
        state.resources.denarii = round1(state.resources.denarii - extra);
        creditGoods(state, hunt, hunt.amount);
        const speech = outcomeSpeech("over_budget", hunt, `Another ${extra} denarii left the chest.`);
        hunt.reportSpeech = speech.text;
        hunt.reportEmotion = speech.emotion;
        hunt.reported = false;
        proj.status = "completed";
        bringGerulfHome(state);
        lines.push(
          `Gerulf returned with ${hunt.amount} ${hunt.goods}, but the inland price ran ${extra} denarii over the quote.`,
        );
        continue;
      }
      outcome = "partial";
    }

    if (outcome === "success") {
      creditGoods(state, hunt, hunt.amount);
      const speech = outcomeSpeech("success", hunt);
      hunt.reportSpeech = speech.text;
      hunt.reportEmotion = speech.emotion;
      hunt.reported = false;
      proj.status = "completed";
      bringGerulfHome(state);
      lines.push(`Gerulf returned with ${hunt.amount} ${hunt.goods}. The purse is spent.`);
      continue;
    }

    if (outcome === "partial") {
      const got = Math.max(1, Math.floor(hunt.amount / 2)) || 1;
      const back = refund(state, hunt.escrowedDenarii * 0.35);
      creditGoods(state, hunt, Math.min(got, hunt.amount));
      const speech = outcomeSpeech("partial", hunt, back ? ` ${back} denarii came home.` : "");
      hunt.reportSpeech = speech.text;
      hunt.reportEmotion = speech.emotion;
      hunt.reported = false;
      proj.status = "completed";
      bringGerulfHome(state);
      lines.push(`Gerulf returned with a partial find of ${hunt.goods}. ${back} denarii recovered.`);
      continue;
    }

    if (outcome === "rumor") {
      const back = refund(state, hunt.escrowedDenarii * 0.55);
      const speech = outcomeSpeech("rumor", hunt, back ? ` ${back} denarii came home.` : "");
      hunt.reportSpeech = speech.text;
      hunt.reportEmotion = speech.emotion;
      hunt.reported = false;
      proj.status = "completed";
      bringGerulfHome(state);
      lines.push(`Gerulf's hunt for ${hunt.goods} failed: false rumour. ${back} denarii recovered.`);
      continue;
    }

    const back = refund(state, hunt.escrowedDenarii * 0.1);
    const speech = outcomeSpeech("mishap", hunt);
    hunt.reportSpeech = speech.text;
    hunt.reportEmotion = speech.emotion;
    hunt.reported = false;
    proj.status = "completed";
    bringGerulfHome(state);
    lines.push(
      `Gerulf's hunt for ${hunt.goods} failed: a mishap on the road.${back ? ` ${back} denarii recovered.` : " The purse is gone."}`,
    );
  }
  return lines;
}

export function pendingHuntReports(state: WorldState): { text: string; emotion: AldricEmotion }[] {
  const out: { text: string; emotion: AldricEmotion }[] = [];
  for (const proj of state.projects) {
    if (proj.status !== "completed" || !proj.hunt?.reportSpeech || proj.hunt.reported) continue;
    proj.hunt.reported = true;
    out.push({
      text: proj.hunt.reportSpeech,
      emotion: (proj.hunt.reportEmotion as AldricEmotion) || "neutral",
    });
  }
  return out;
}

export function huntProgressLine(elapsed: number, duration: number): string {
  const left = Math.max(0, duration - elapsed);
  if (left <= 0) return "due back";
  if (elapsed <= 0) return left === 1 ? "leaves this season" : `${left} seasons on the road`;
  if (left === 1) return "due back next season";
  return `${left} seasons yet on the road`;
}
