import { applyRenown } from "../combat/renown";
import { createRng, seedFromString } from "../combat/rng";
import { applyPeopleHappinessDelta } from "../engine/peopleHappiness";
import type { Holding, WorldState } from "../engine/schema";
import type { HistoryBeat } from "./deliver";
import { rollRenownBand } from "./effects";
import { applyFlagOp, flagTruthy } from "./flags";
import { marketMid } from "./land";
import { historyContent } from "./load";
import { ensureNeighbours } from "./neighbours";
import { currentRank, grantVillas } from "./promotion";
import { rankStep, ranksTable } from "./ranks";
import type { SeasonAt } from "./scheduler";
import type { HistoryState, VillaTemplate } from "./schema";
import { hundredValue } from "./standing";
import { moveVassalMood } from "./vassals";

/**
 * Marriage. Four matches the lord may pursue through Aldric at any time, each
 * a different bargain, and each a woman who then sits in the hall as a standing
 * advisor with her own voice and her own quality of counsel.
 *
 *   hildegard   the neighbour's daughter: allods next to his own, her kin his kin,
 *               safer borders; a normal bride-price. The expected match. The same
 *               archetype recurs at each rank as a different woman: a villa lord's
 *               daughter, a viscount's, a count's daughter or sister.
 *   theoderada  the great family's daughter: little land, enormous connection; her
 *               brothers are his allies and her family's enemies are his. Expensive.
 *   gisla       the widow: dower land held outright, estate experience, perhaps
 *               stepchildren with claims. She chooses for herself; she is persuaded
 *               in person, not negotiated for.
 *   linda       for herself alone: nothing. The sworn men think less of it for
 *               years, his heir stands weaker, and the hall talks. Ermenald quietly
 *               approves: consent and affection are what the Church taught.
 *
 * Clergy bless every match and check the degrees of 829; that is the ordinary
 * process and not a match of its own.
 *
 * Where it pays out: the 830 land crisis (a wife with kin answers the count's claim;
 * land.ts, hooks.ts), the king quest (quest.ts: Theoderada's kin are the marriage
 * supporter, near-certain, and any other wife shuts that door), the sworn men's
 * resting mood (vassals.ts), the neighbours (neighbours.ts: kin do not press), and
 * the closing page (ending.ts).
 */

export const WIFE_NPC_ID = "wife";
export const WIFE_ARCHETYPES = ["hildegard", "theoderada", "gisla", "linda"] as const;
export type WifeArchetype = (typeof WIFE_ARCHETYPES)[number];
export type Marriage = HistoryState["marriage"];
export type MarriageAction = "marry" | "court";

/** The neighbour's daughter is a different woman at each tier; her name comes from this pool. */
export const LOCAL_BRIDE_NAMES = ["Rotrude", "Berthild", "Adalsind", "Hildegard", "Gerburg"] as const;

/** Rank 1 is a villa lord, 2 a viscount, 3 a count and above: what a local match brings scales with it. */
export type MatchTier = 1 | 2 | 3;

const GREAT_HOUSES = [
  { head: "Count Gerard of Auxerre", house: "the house of Auxerre", enemy: "the counts of Nevers" },
  { head: "Count Ingelger of Anjou", house: "the house of Anjou", enemy: "the lords of Tours" },
] as const;

const BRIDE_PRICE: Record<WifeArchetype, Record<MatchTier, number>> = {
  hildegard: { 1: 60, 2: 300, 3: 1200 },
  theoderada: { 1: 240, 2: 1200, 3: 5000 },
  gisla: { 1: 0, 2: 0, 3: 0 },
  linda: { 1: 0, 2: 0, 3: 0 },
};

/** The sworn men's resting mood sits this far under the middle while the lord is married beneath him. */
export const MARRIED_BENEATH_VASSAL_PENALTY = 6;
/** Years the hall goes on remarking on a match beneath him. */
const REMARK_YEARS = 12;
const REMARK_GAP_SEASONS = 3;
const REMARK_CHANCE = 0.25;
/** Her family's quarrels: how often one lands at his door, and what it costs. */
const QUARREL_GAP_SEASONS = 4;
const QUARREL_CHANCE = 0.08;
const QUARREL_DENARII = 40;
/** A stepson's claim on the dower: how often it is pressed, what it costs to settle, and how many times. */
const CLAIM_CHANCE_PER_YEAR = 0.2;
const CLAIM_SETTLEMENT = 50;
const CLAIM_MAX = 2;

export function matchTier(state: WorldState): MatchTier {
  const rank = currentRank(state);
  return rank >= 3 ? 3 : rank === 2 ? 2 : 1;
}

/** The tier the match was made at (stored as a plain number), or the lord's tier now. */
function tierOf(state: WorldState): MatchTier {
  const t = state.history.marriage?.tier;
  return t === 1 || t === 2 || t === 3 ? t : matchTier(state);
}

export function isMarried(state: WorldState): boolean {
  return Boolean(state.history.marriage?.archetype);
}

export function wifeArchetype(state: WorldState): WifeArchetype | null {
  return state.history.marriage?.archetype ?? null;
}

export function wifeName(state: WorldState): string | null {
  return state.history.marriage?.name ?? null;
}

export function bridePrice(archetype: WifeArchetype, tier: MatchTier): number {
  return BRIDE_PRICE[archetype][tier];
}

const HILDEGARD_KIN_WORD: Record<MatchTier, string> = {
  1: "a neighbouring villa lord's daughter",
  2: "a viscount's daughter",
  3: "a count's daughter",
};

/** What each match is called in the hall, at this tier. */
export function matchWord(archetype: WifeArchetype, tier: MatchTier): string {
  switch (archetype) {
    case "hildegard":
      return HILDEGARD_KIN_WORD[tier];
    case "theoderada":
      return "a great family's daughter";
    case "gisla":
      return "a widow with land of her own";
    case "linda":
      return "a woman chosen for herself alone";
  }
}

function hildegardLandWord(tier: MatchTier): string {
  return tier === 1 ? "a few manses and fields marching with ours" : tier === 2 ? "a villa of her own, held outright, next to ours" : "two villas held outright, next to ours";
}

export type MatchOffer = {
  archetype: WifeArchetype;
  /** Her name as the hall would speak it now (the local match's name is drawn when the match is made). */
  name: string;
  who: string;
  brings: string;
  cost: string;
  price: number;
  /** The widow: visits paid and whether she has said yes. */
  suit?: { visits: number; consented: boolean; visitedThisSeason: boolean };
};

/** The four matches as they stand for this lord now. */
export function matchOffers(state: WorldState): MatchOffer[] {
  const tier = matchTier(state);
  const m = state.history.marriage;
  const suit = m.suit ?? { visits: 0, lastTurn: null, consented: false };
  return [
    {
      archetype: "hildegard",
      name: "the neighbour's daughter",
      who: HILDEGARD_KIN_WORD[tier],
      brings: `${hildegardLandWord(tier)}; her kin become our kin, and a count thinks twice before seizing from a man with kin at his back`,
      cost: `a bride-price of ${bridePrice("hildegard", tier)} denarii (cattle and sheep at the market price make up what the chest lacks); the expected match`,
      price: bridePrice("hildegard", tier),
    },
    {
      archetype: "theoderada",
      name: "Theoderada",
      who: "a great family's daughter",
      brings: "little land and a great deal of connection: her brothers become allies, and in any contest for the kingdom her house stands with us; a match talked of across Burgundy",
      cost: `${bridePrice("theoderada", tier)} denarii, and her family's quarrels become ours`,
      price: bridePrice("theoderada", tier),
    },
    {
      archetype: "gisla",
      name: "Gisla",
      who: "a widow with land of her own",
      brings: "her dower villa, held outright, and a woman who has run a household and buried a husband; her first husband's children may have claims on that land",
      cost: "no bride-price; she chooses for herself and must be persuaded in person, one visit a season, not negotiated for",
      price: 0,
      suit: { visits: suit.visits, consented: suit.consented, visitedThisSeason: suit.lastTurn === state.meta.turn },
    },
    {
      archetype: "linda",
      name: "Linda",
      who: "a woman chosen for herself alone",
      brings: "nothing: no land, no kin, no advantage",
      cost: "the sworn men will think less of it for years, his heir will stand weaker for it, and the hall will talk; Father Ermenald will quietly approve",
      price: 0,
    },
  ];
}

// ---------------------------------------------------------------------------
// Making the match
// ---------------------------------------------------------------------------

function seasonAt(state: WorldState): SeasonAt {
  return { year: state.meta.year, season: state.meta.season as SeasonAt["season"] };
}

/** Why a match cannot be made now, or null. */
export function marriageBlocked(state: WorldState, archetype: WifeArchetype, action: MarriageAction = "marry"): string | null {
  if (!(WIFE_ARCHETYPES as readonly string[]).includes(archetype)) return "No such match is on offer.";
  if (isMarried(state)) return `The lord is married already, to ${wifeName(state)}.`;
  if (state.player.dead) return "The lord is dead.";
  if (action === "court") {
    if (archetype !== "gisla") return "Only the widow is courted; the others are matches made with their families.";
    if (state.history.marriage.suit.consented) return "She has said yes already; the match waits only on the lord's word.";
    if (state.history.marriage.suit.lastTurn === state.meta.turn) return "The lord has been to her once this season already; she will not be hurried.";
    if (state.history.away) return "The lord is away; the suit waits on his return.";
    return null;
  }
  if (archetype === "gisla" && !state.history.marriage.suit.consented) return "The widow has not said yes. She is persuaded in person, not bought from her kin.";
  const price = bridePrice(archetype, matchTier(state));
  if (price > 0 && payableInCoinOrKind(state) < price) return `The bride-price is ${price} denarii, and the chest and the byres together cannot meet it.`;
  return null;
}

/** Coin, then cattle and sheep at the market's middle price: a bride-price was paid in kind as often as in silver. */
function payableInCoinOrKind(state: WorldState): number {
  return state.resources.denarii + state.resources.cattle * marketMid(state, "cattle") + state.resources.sheep * marketMid(state, "sheep");
}

function payBridePrice(state: WorldState, amount: number): string {
  if (amount <= 0) return "";
  const coin = Math.min(state.resources.denarii, amount);
  state.resources.denarii = Math.round(state.resources.denarii - coin);
  let left = amount - coin;
  const parts = [coin > 0 ? `${coin} d` : ""];
  for (const kind of ["cattle", "sheep"] as const) {
    if (left <= 0) break;
    const mid = marketMid(state, kind);
    if (mid <= 0) continue;
    const head = Math.min(state.resources[kind], Math.ceil(left / mid));
    if (head <= 0) continue;
    state.resources[kind] -= head;
    left -= head * mid;
    parts.push(`${head} ${kind}`);
  }
  return parts.filter(Boolean).join(" and ");
}

function pickLocalName(state: WorldState, seed: string): string {
  const used = new Set(state.history.marriage.usedNames);
  for (const n of state.npcs) used.add(n.name);
  const free = LOCAL_BRIDE_NAMES.filter((n) => !used.has(n));
  const pool = free.length ? free : [...LOCAL_BRIDE_NAMES];
  return createRng(seedFromString(seed)).pick(pool);
}

/** The father of the neighbour's daughter at this tier: a neighbour at rank 1, a viscount, a count. */
function localKin(state: WorldState, tier: MatchTier, seed: string): NonNullable<Marriage["kin"]> {
  const rng = createRng(seedFromString(seed));
  if (tier === 1) {
    const all = ensureNeighbours(state);
    const free = all.filter((n) => !n.kin);
    const n = (free.length ? free : all)[rng.int(0, (free.length ? free : all).length - 1)];
    n.kin = true;
    return { house: `${n.name}'s house at ${n.seat}`, head: `${n.name} of ${n.seat}`, neighbourId: n.id, enemy: null };
  }
  const names = ranksTable().vassalNames.filter((v) => !state.history.vassals.some((x) => x.name === v));
  const name = rng.pick(names.length ? names : [...ranksTable().vassalNames]);
  const counties = ranksTable().counties.filter((c) => !state.history.rank.counties.some((x) => x.name === c));
  const county = rng.pick(counties.length ? counties : [...ranksTable().counties]);
  const title = tier === 2 ? "Viscount" : "Count";
  return { house: `the house of ${county}`, head: `${title} ${name} of ${county}`, neighbourId: null, enemy: null };
}

function scaledTemplate(t: VillaTemplate, k: number): VillaTemplate {
  const sc = (n: number) => Math.max(0, Math.round(n * k));
  return {
    manses: { free: Math.max(1, sc(t.manses.free)), servile: sc(t.manses.servile), vacant: sc(t.manses.vacant) },
    land: Object.fromEntries(Object.entries(t.land).map(([key, v]) => [key, sc(v)])) as VillaTemplate["land"],
    people: { men: sc(t.people.men), women: sc(t.people.women), youths: sc(t.people.youths) },
    stores: Object.fromEntries(Object.entries(t.stores).map(([key, v]) => [key, Math.round(v * k * 10) / 10])),
    features: [...t.features],
  };
}

/** The allods that come with the neighbour's daughter: fields next to ours at rank 1, villas held outright above. */
function bringLocalLand(state: WorldState, tier: MatchTier, head: string, turn: number): string {
  if (tier === 1) {
    const home: Holding | undefined = state.holdings[0];
    if (!home) return "";
    home.manses.free += 2;
    home.households += 2;
    home.land.fertile_arable += 6;
    home.land.meadow += 3;
    home.land.woodland += 10;
    state.population.households += 2;
    state.population.adult_men += 2;
    state.population.adult_women += 2;
    state.population.youths += 2;
    return "Two manses with their tenants, six acres of arable, three of meadow and ten of wood, marching with Fontenay, come to the hall as her portion.";
  }
  const n = tier === 2 ? 1 : 2;
  const names = grantVillas(state, n, { patron: head, tenure: "owned", like: tier === 2 ? 2 : 3, turn });
  return names.length ? `${names.length === 1 ? "The villa" : "The villas"} of ${names.join(" and ")} come to the hall as her portion, held outright.` : "";
}

/** The widow's dower: a small villa at rank 1, a villa of the rank above; held outright, and hers. */
function bringDower(state: WorldState, tier: MatchTier, turn: number, seed: string): { line: string; dower: Marriage["dower"] } {
  const base = rankStep(tier >= 3 ? 3 : 2)?.villa;
  const template = base && tier === 1 ? scaledTemplate(base, 0.5) : base;
  const names = grantVillas(state, 1, { patron: "her dower", tenure: "owned", like: tier >= 3 ? 3 : 2, turn, template });
  const holding = names.length ? state.holdings[state.holdings.length - 1] : undefined;
  const stepchildren = createRng(seedFromString(`${seed}:stepchildren`)).chance(0.5);
  if (!holding) return { line: "", dower: null };
  return {
    line: `${holding.name}, her dower from her first marriage, comes with her, held outright${stepchildren ? "; her first husband's sons are grown, and they have not forgotten whose it was" : ""}.`,
    dower: { holdingId: holding.id, stepchildren, claims: 0 },
  };
}

/** Any land-out hook for a local match still open on a fired event is spent by the wedding. */
function spendMarryHooks(state: WorldState): void {
  for (const e of historyContent().events) {
    if (!state.history.fired[e.id]) continue;
    if (!e.hooks.some((h) => h.id === "marry_local")) continue;
    const taken = state.history.hooksTaken[e.id] ?? [];
    if (!taken.includes("marry_local")) state.history.hooksTaken[e.id] = [...taken, "marry_local"];
  }
}

export type MarriageResult = { ok: true; line: string; beats: HistoryBeat[] } | { ok: false; line: string };

/** The lord's visit to the widow. She judges the man and his house; persistence counts. */
export function courtWidow(state: WorldState, roll?: number): MarriageResult {
  const blocked = marriageBlocked(state, "gisla", "court");
  if (blocked) return { ok: false, line: blocked };
  const suit = state.history.marriage.suit;
  const renown = state.player.renown ?? 1;
  const happiness = state.peopleHappiness ?? 50;
  let chance = 0.3 + 0.15 * suit.visits;
  if (renown >= 200) chance += 0.3;
  else if (renown >= 50) chance += 0.15;
  if (happiness >= 60) chance += 0.15;
  if (hundredValue(state, "church") >= 55) chance += 0.1;
  if (state.flags.hunger || happiness < 40) chance -= 0.2;
  if (flagTruthy(state, "simony_alleged") || flagTruthy(state, "excommunicated")) chance -= 0.15;
  const r = roll ?? createRng(seedFromString(`${state.meta.region}:suit:${state.meta.turn}:${suit.visits}`)).float();
  suit.visits += 1;
  suit.lastTurn = state.meta.turn;
  if (r < chance) {
    suit.consented = true;
    return {
      ok: true,
      line: "Gisla has said yes. She asked after the barns and the tenants before she asked after the lord, and what she heard satisfied her. The match waits only on the lord's word.",
      beats: [],
    };
  }
  const why =
    state.flags.hunger || happiness < 40
      ? "She has heard how the people on the lord's land are faring, and she will not put her own under a hand like that yet."
      : renown < 50
        ? "She asked who the lord was, and nobody she trusts could tell her. She has not said no; she has said not yet."
        : "She was civil and gave nothing away. A woman who has buried one husband is in no hurry to take another; she will see how the lord's house stands next season.";
  return { ok: true, line: `Gisla has not said yes. ${why}`, beats: [] };
}

/**
 * Make the match. Pays the bride-price, brings what she brings, seats her in the hall
 * as an advisor, and moves the people who have a view of it. `turn` is the season's turn.
 */
export function marry(state: WorldState, archetype: WifeArchetype, opts?: { turn?: number }): MarriageResult {
  const blocked = marriageBlocked(state, archetype, "marry");
  if (blocked) return { ok: false, line: blocked };
  const turn = opts?.turn ?? state.meta.turn;
  const at = seasonAt(state);
  const tier = matchTier(state);
  const seed = `${state.meta.region}:marriage:${archetype}:${turn}`;
  const m = state.history.marriage;
  const beats: HistoryBeat[] = [];
  const lines: string[] = [];

  const paid = payBridePrice(state, bridePrice(archetype, tier));
  if (paid) lines.push(`Bride-price paid: ${paid}.`);

  let name: string;
  let kin: Marriage["kin"] = null;
  let dower: Marriage["dower"] = null;
  switch (archetype) {
    case "hildegard": {
      name = pickLocalName(state, seed);
      m.usedNames.push(name);
      kin = localKin(state, tier, seed);
      const land = bringLocalLand(state, tier, kin.head, turn);
      if (land) lines.push(land);
      state.history.land.marriedLocal = true;
      applyFlagOp(state, "married_local", true);
      applyPeopleHappinessDelta(state, 1);
      state.player.renown = applyRenown(state.player.renown ?? 1, rollRenownBand("small", seed));
      if (state.history.vassals.length) moveVassalMood(state, 3, "a sensible match, and kin on the border", turn);
      break;
    }
    case "theoderada": {
      name = "Theoderada";
      const house = GREAT_HOUSES[createRng(seedFromString(seed)).int(0, GREAT_HOUSES.length - 1)];
      kin = { house: house.house, head: house.head, neighbourId: null, enemy: house.enemy };
      applyFlagOp(state, "married_great_house", true);
      state.player.renown = applyRenown(state.player.renown ?? 1, rollRenownBand("moderate", seed));
      applyFlagOp(state, "lord_standing", "+3");
      if (state.history.vassals.length) moveVassalMood(state, 4, "their lord married into a great house", turn);
      lines.push(`Her brothers of ${house.house} are the lord's kin now, and ${house.enemy} are his enemies as they are theirs.`);
      break;
    }
    case "gisla": {
      name = "Gisla";
      const d = bringDower(state, tier, turn, seed);
      dower = d.dower;
      if (d.line) lines.push(d.line);
      if (!state.modifiers.some((x) => x.source === "Gisla's keeping of the stores")) {
        state.modifiers.push({ id: `mod-gisla-${turn}`, target: "spoilage", kind: "permanent", seasons_remaining: null, effect: { op: "multiply", value: 0.9 }, source: "Gisla's keeping of the stores" });
      }
      lines.push("She has run a household before; the stores will keep better under her eye.");
      break;
    }
    case "linda": {
      name = "Linda";
      applyFlagOp(state, "married_beneath", true);
      applyFlagOp(state, "favor_church", "+1");
      applyPeopleHappinessDelta(state, 2);
      if (state.history.vassals.length) moveVassalMood(state, -8, "their lord married beneath him, for nothing", turn);
      lines.push("No land, no kin, no advantage. The sworn men will not forget it for years, and the hall will talk. Father Ermenald, alone, approves.");
      break;
    }
  }

  // A count's open claim on the villa is answered by a wife with kin at her back (the 830 crisis's second way out).
  if ((archetype === "hildegard" || archetype === "theoderada") && state.history.land.tenure === "forfeit_claimed") {
    state.history.land.tenure = "benefice";
    state.history.land.claimDeadlineTurn = null;
    lines.push("The count's officers have let the claim on the villa drop; they will not seize from a man with such kin.");
  }
  if (archetype === "hildegard" || archetype === "theoderada") spendMarryHooks(state);

  m.archetype = archetype;
  m.name = name;
  m.since = turn;
  m.year = at.year;
  m.tier = tier;
  m.kin = kin;
  m.dower = dower;
  m.kinWant = null;
  m.kinPledged = false;
  m.lastRemarkTurn = null;
  m.lastQuarrelTurn = null;
  applyFlagOp(state, "married", true);
  applyFlagOp(state, "wife", archetype);

  // She sits in the hall from the wedding on, with her own tab.
  if (!state.npcs.some((n) => n.id === WIFE_NPC_ID)) {
    state.npcs.push({ id: WIFE_NPC_ID, name, role: "wife", location: state.holdings[0]?.id ?? "hall", memories: [], wantsTalk: true, notes: `Married ${at.season} ${at.year}; ${matchWord(archetype, tier)}.` });
  }

  const word = matchWord(archetype, tier);
  state.history.record.push({ year: at.year, season: at.season, text: `The lord married ${name}, ${word}${kin ? ` of ${kin.house}` : ""}.`, thread: "marriage" });
  beats.push({
    npcId: "steward",
    eventId: "marriage:wedding",
    text: stewardWeddingLine(archetype, name, kin?.head ?? null),
  });
  return { ok: true, line: [`The lord married ${name}, ${word}.`, ...lines].join(" "), beats };
}

function stewardWeddingLine(archetype: WifeArchetype, name: string, head: string | null): string {
  switch (archetype) {
    case "hildegard":
      return `It is done, my lord. ${name} is in the hall, and ${head ?? "her father"} drank with us and rode home content. Her portion is written into the books; her people are ours now, and ours are theirs. If you want to know the district, ask her; she was raised in it.`;
    case "theoderada":
      return `It is done, my lord, and the whole of Burgundy knows it was done. ${name} is in the hall, and her brothers' men rode with her. She knows the court as I know the barns. Ask her who hates whom and why; she will tell you, and she will tell you what her own house wants of it too.`;
    case "gisla":
      return `It is done, my lord. ${name} came with her own steward's tallies under her arm and has already asked me about the vacant manses. She has run an estate before and buried the man who ran it with her. I do not mind saying I expect to learn something.`;
    case "linda":
      return `It is done, my lord. ${name} is in the hall. I will keep the books as I kept them, and I will not say what the sworn men are saying, because you know it. Father Ermenald says the Church asks only consent and affection, and that you have both. He is the only one who said so aloud.`;
  }
}

/** The `marriage` card: the lord's word on a match, or a visit to the widow. */
export function applyMarriageAction(state: WorldState, archetype: WifeArchetype, action: MarriageAction): MarriageResult {
  return action === "court" ? courtWidow(state) : marry(state, archetype);
}

// ---------------------------------------------------------------------------
// The season
// ---------------------------------------------------------------------------

export type MarriageTick = { beats: HistoryBeat[]; lines: string[] };

const REMARKS = [
  "My lord, I will say it once this year and not again: there was talk at the count's court of the match you made, and it was not kind. I did not answer it. There is no answer that helps.",
  "One of the sworn men asked me, in his cups, whose daughter the lady was. I told him she was yours. He laughed, my lord, and I let him; it was not worth a quarrel.",
  "My lord, the merchant who was here last asked after the lady's people, meaning no harm. I said she had none that signified, and he nodded as if that told him something about the hall. It did.",
  "A word, my lord, and then I am done with it: the viscount's wife would not sit beside the lady at the feast. The lady said nothing and did not need to. I thought you should know how the room went.",
] as const;

const QUARRELS = [
  "My lord, your wife's brothers have a quarrel with {enemy}, and it has come to our door: their men took a cart of ours on the road and said it was for a debt of her house. I have paid it off rather than fight over a cart.",
  "My lord, {enemy} have put it about that we stand with your wife's house in their dispute, which we do, because we must. A tenant of ours was beaten at the market for it. The people feel it.",
  "My lord, a letter from your wife's brother: {enemy} have a suit against her house and he asks that we bear a share of the pleading. I have sent what the chest could spare. It is what kin are for, he says.",
] as const;

/**
 * Each season: the hall remarks on a match beneath him for years; her family's quarrels
 * come to a great-house son-in-law's door; a stepson presses his claim on the dower.
 */
export function tickMarriage(state: WorldState, at: SeasonAt, turn: number): MarriageTick {
  const out: MarriageTick = { beats: [], lines: [] };
  const m = state.history.marriage;
  if (!m.archetype || m.since === null) return out;
  const rng = createRng(seedFromString(`${state.meta.region}:marriage:tick:${turn}`));
  if (m.archetype === "linda") {
    const years = at.year - (m.year ?? at.year);
    const gap = m.lastRemarkTurn === null ? REMARK_GAP_SEASONS : turn - m.lastRemarkTurn;
    if (years <= REMARK_YEARS && turn - m.since >= 2 && gap >= REMARK_GAP_SEASONS && rng.chance(REMARK_CHANCE)) {
      m.lastRemarkTurn = turn;
      out.beats.push({ npcId: "steward", eventId: "marriage:remark", text: REMARKS[(turn + years) % REMARKS.length] });
    }
  }
  if (m.archetype === "theoderada" && m.kin?.enemy) {
    const gap = m.lastQuarrelTurn === null ? turn - m.since : turn - m.lastQuarrelTurn;
    if (gap >= QUARREL_GAP_SEASONS && rng.chance(QUARREL_CHANCE)) {
      m.lastQuarrelTurn = turn;
      const paid = Math.min(QUARREL_DENARII, Math.max(0, state.resources.denarii));
      state.resources.denarii = Math.round(state.resources.denarii - paid);
      if (paid < QUARREL_DENARII) applyPeopleHappinessDelta(state, -2);
      applyFlagOp(state, "kin_quarrel", "+1");
      const text = QUARRELS[(turn + m.since) % QUARRELS.length].replace("{enemy}", m.kin.enemy);
      out.beats.push({ npcId: "steward", eventId: "marriage:quarrel", text });
      out.lines.push(`Her family's quarrel with ${m.kin.enemy} came to the lord's door${paid ? ` (${paid} d)` : " (the people bore it)"}.`);
      state.history.record.push({ year: at.year, season: at.season, text: `${m.kin.enemy}, her family's enemies, pressed the lord over his wife's house.`, thread: "marriage" });
    }
  }
  if (m.archetype === "gisla" && m.dower?.stepchildren && at.season === "spring" && m.dower.claims < CLAIM_MAX && at.year > (m.year ?? at.year)) {
    if (rng.chance(CLAIM_CHANCE_PER_YEAR)) {
      const villa = state.holdings.find((h) => h.id === m.dower?.holdingId);
      m.dower.claims += 1;
      if (state.resources.denarii >= CLAIM_SETTLEMENT) {
        state.resources.denarii = Math.round(state.resources.denarii - CLAIM_SETTLEMENT);
        out.beats.push({
          npcId: "steward",
          eventId: "marriage:claim",
          text: `My lord, the lady's stepson has brought his claim on ${villa?.name ?? "her dower"} before the count's court, as everyone said he would. The lady settled it herself for ${CLAIM_SETTLEMENT} denarii of the chest before it came to a hearing, and told me to write it down and not to argue. I have done both.`,
        });
        out.lines.push(`A stepson's claim on the dower settled for ${CLAIM_SETTLEMENT} d.`);
      } else if (villa) {
        villa.manses.free = Math.max(0, villa.manses.free - 1);
        villa.households = Math.max(0, villa.households - 1);
        state.population.households = Math.max(0, state.population.households - 1);
        out.beats.push({
          npcId: "steward",
          eventId: "marriage:claim",
          text: `My lord, the lady's stepson pressed his claim on ${villa.name}, and the chest could not buy him off. The court gave him a manse of it. The lady took it better than I did.`,
        });
        out.lines.push(`A stepson's claim took a manse of ${villa.name}.`);
      }
      state.history.record.push({ year: at.year, season: at.season, text: "Her first husband's son pressed his claim on the dower land.", thread: "marriage" });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The king quest
// ---------------------------------------------------------------------------

/** Theoderada's kin, when the marriage supporter is approached: what they ask beyond the match already made. */
export function rollKinWant(state: WorldState, seed: string): "none" | "office" | "guarantee" {
  const rng = createRng(seedFromString(seed));
  const want = rng.float();
  return want < 0.4 ? "none" : want < 0.7 ? "office" : "guarantee";
}

// ---------------------------------------------------------------------------
// Prompt lines
// ---------------------------------------------------------------------------

/** Aldric's HISTORY line: the four matches while he is unmarried, the wife and what she is after. */
export function marriageStewardLine(state: WorldState): string {
  const m = state.history.marriage;
  if (!m.archetype) {
    const offers = matchOffers(state);
    const claim = state.history.land.tenure === "forfeit_claimed";
    const parts: string[] = [];
    parts.push(
      `Marriage: the lord is unmarried. If he asks about a match, lay out the four and say plainly what each brings and costs at his rank; do not invent a fifth. ${offers
        .map((o) => `${o.archetype} (${o.name}, ${o.who}): brings ${o.brings}; cost: ${o.cost}${o.suit ? `; suit so far: ${o.suit.visits} ${o.suit.visits === 1 ? "visit" : "visits"}${o.suit.consented ? ", and she has said yes" : o.suit.visitedThisSeason ? ", one already this season" : ""}` : ""}.`)
        .join(" ")}`,
    );
    parts.push(
      "Clergy bless every match and check the 829 degrees of kinship; that is the ordinary process, not a match of its own, and Ermenald brokers no bride. When the lord decides, propose marriage { archetype, action: \"marry\" } for Confirm (the engine takes the bride-price and writes what she brings). For the widow, propose marriage { archetype: \"gisla\", action: \"court\" } each time he goes to her in person, one visit a season, until she consents; then \"marry\". You do not negotiate for her. Say the names as the hall would: the neighbour's daughter's given name is not known until the match is made.",
    );
    if (claim) parts.push("The count's claim on the villa stands: a wife with kin at her back (hildegard above all, theoderada too) answers it the day the match is made; the widow's dower and a match for love do not.");
    return parts.join(" ");
  }
  const tier = tierOf(state);
  const since = m.year ? ` since ${m.year}` : "";
  const parts = [`Marriage: the lord is married to ${m.name}, ${matchWord(m.archetype, tier)}${m.kin ? ` of ${m.kin.house}` : ""}${since}. She sits in the hall and he may ask her counsel directly, on her own tab; you do not speak for her. No second match is on offer.`];
  switch (m.archetype) {
    case "hildegard":
      parts.push(`Her father ${m.kin?.head ?? ""} is kin now: the border on that side is quiet, and his house does not take our people in.`);
      break;
    case "theoderada":
      parts.push(`Her brothers of ${m.kin?.house ?? "her house"} stand with us; ${m.kin?.enemy ?? "her family's enemies"} are our enemies for it, and their quarrels come to our door from time to time.${m.kinWant && m.kinWant !== "none" && !m.kinPledged ? ` In the king's matter her brother asks ${m.kinWant === "office" ? "a son placed in an office after the victory (hook kin_office on Q-001)" : "a guarantee of his lands and standing (hook kin_guarantee on Q-001)"}; until it is given his house comes with less.` : ""}`);
      break;
    case "gisla":
      parts.push(`Her dower${m.dower?.holdingId ? ` (${state.holdings.find((h) => h.id === m.dower?.holdingId)?.name ?? "a villa"})` : ""} is held outright and is hers${m.dower?.stepchildren ? "; her first husband's sons have claims on it and press them now and then" : ""}. She knows stores and tenants better than most stewards; you respect it.`);
      break;
    case "linda":
      parts.push(
        `She brought no land and no kin. The sworn men think less of the hall for it and will for years; his heir will stand weaker for it; people remark on it from time to time, and you report such remarks once and do not dwell on them. Father Ermenald approves of the match and says so.${m.lastRemarkTurn === state.meta.turn ? " Such a remark was made this season; you have already passed it on." : ""}`,
      );
      break;
  }
  return parts.join(" ");
}

/** Ermenald's line: the Church's part in a match, and his own quiet view. */
export function marriageChaplainLine(state: WorldState): string {
  const m = state.history.marriage;
  if (!m.archetype) {
    return "Marriage: the lord is unmarried. You broker no bride and name no family; Aldric lays out the matches. Your part is the ordinary one: the Church blesses the match and checks the degrees of kinship the councils of 829 tightened, and you will say so if asked. You hold, as the Church teaches, that consent and affection matter in a marriage, and you may say that too, quietly.";
  }
  if (m.archetype === "linda") {
    return `Marriage: the lord married ${m.name} for herself alone, with no land and no kin, and you blessed it. You quietly approve: the Church taught that consent and affection make a marriage, not a dowry, and you will say so to the lord if the hall's talk reaches him. You do not preach it at the sworn men.`;
  }
  return `Marriage: the lord is married to ${m.name}, ${matchWord(m.archetype, tierOf(state))}. You blessed the match and satisfied yourself on the degrees of kinship; you have no quarrel with it.`;
}

// ---------------------------------------------------------------------------
// The wife as an advisor
// ---------------------------------------------------------------------------

/** What she knows and how she counsels: the voice for her system prompt. */
export function wifeVoice(state: WorldState): string | undefined {
  const m = state.history.marriage;
  if (!m.archetype || !m.name) return undefined;
  const lord = "the lord, your husband";
  const home = state.holdings[0]?.name ?? "Fontenay";
  switch (m.archetype) {
    case "theoderada":
      return `You are ${m.name}, wife of ${lord}, lord of ${home}, and a daughter of ${m.kin?.house ?? "a great house"}; your brother is ${m.kin?.head ?? "a count"}. You were raised in a great hall and at court: you know the families, who hates whom and why, what a count's word is worth and what a king's is. Your political reads are reliable and you see three moves ahead; you say what will happen if he does a thing, and what the other man will do after. You are frank about your own family's interests, and you say when what you advise would also serve ${m.kin?.house ?? "your house"}; you do not hide it. ${m.kin?.enemy ? `${m.kin.enemy[0].toUpperCase()}${m.kin.enemy.slice(1)} are your family's enemies and now his; you say so plainly when it bears on a matter.` : ""} You speak with the ease of someone who has never had to raise her voice to be heard. You are not warm by habit, but you are loyal, and you are on his side. On stores, tenants and the ploughland you defer to Aldric, and on the soul to Ermenald.`;
    case "gisla":
      return `You are ${m.name}, wife of ${lord}, lord of ${home}. You were married before, ran that household, and buried that husband; your dower came with you and it is yours. You are practical and unsentimental. You are excellent on land, stores, tenants, officers and what a steward is not saying; you ask what is in the barn before you ask what is in the letter. You judge men by how their villas are run. On high politics (kings, counts, the court, the great families) you are weaker, and you say so: you give a householder's guess and tell him to ask Aldric or Ermenald, and you do not pretend. ${m.dower?.stepchildren ? "Your first husband's sons have claims on the dower and you do not speak ill of them for it; it is what sons do." : ""} You are kind in deed and dry in word. You are on his side.`;
    case "hildegard":
      return `You are ${m.name}, wife of ${lord}, lord of ${home}, and a daughter of ${m.kin?.house ?? "a neighbouring house"}; your father is ${m.kin?.head ?? "a lord nearby"}. You know the district: its families, their quarrels, their marriages, their debts, who is honest at the market and who is not, and what people are saying. You are useful on neighbours, vassals and local disputes, and you say what the district will think of a thing before he does it. On the kingdom (kings, the court, the great families far off) you are out of your depth, and you are honest about it: you say what the district believes, which is often wrong, and you send him to Aldric or Ermenald. You are cheerful, direct and a little sharp. You are on his side, and you are also your father's daughter and say so when the two pull apart.`;
    case "linda":
      return `You are ${m.name}, wife of ${lord}, lord of ${home}. You brought no land and no kin; he married you for yourself, and everybody knows it, and some of them make sure you know they know. You had no training for any of this: nobody taught you how a count thinks, what a benefice is, or why a sworn man must be given a horse he does not need. You are intelligent and you learn, but your counsel on power is honest, kind and frequently wrong: you reason from how decent people behave, and lords and kings mostly do not. Never play this as stupidity. You are the one person in the hall who will tell him plainly when he is behaving badly (to the tenants, to his men, to the Church, to you), and you do it without malice and without backing down. When you do not know a thing, say you do not know it and ask what he thinks. You are warm, and you are on his side, and you say so.`;
  }
}

/** The facts she has for her counsel: each wife sees a different slice of the hall. */
export function wifeCounselBlock(state: WorldState, lines: { realm: string; rank: string; land: string; trade: string; vassals: string | null; neighbours: string | null; admin: string | null; upkeep: string; justice: string[]; quest: string[]; ladder: string | null; facts: string; activeTitles: string[] }): string {
  const m = state.history.marriage;
  if (!m.archetype) return "";
  const out: string[] = [`WHAT THE LADY KNOWS (engine truth; speak from it, do not invent beyond it)`];
  out.push(`Today: ${state.meta.season} ${state.meta.year}. The people of the hall are ${state.peopleHappiness !== undefined ? (state.peopleHappiness >= 65 ? "in good heart" : state.peopleHappiness < 40 ? "wretched" : "steady") : "steady"}${state.flags.hunger ? ", and hungry" : ""}.`);
  switch (m.archetype) {
    case "theoderada":
      out.push(lines.realm, lines.rank);
      if (lines.ladder) out.push(lines.ladder);
      out.push(...lines.quest);
      if (lines.vassals) out.push(lines.vassals);
      if (lines.justice.length) out.push(...lines.justice);
      if (lines.activeTitles.length) out.push(`Told in the hall lately: ${lines.activeTitles.join("; ")}. You heard all of it.`);
      if (lines.facts) out.push(`What the household knows of the lord's standing: ${lines.facts}.`);
      out.push("Counsel: read the politics three moves ahead, name the men and houses, and say where your own house's interest lies in it.");
      break;
    case "gisla":
      out.push(lines.land, lines.upkeep, lines.trade);
      if (lines.admin) out.push(lines.admin);
      if (lines.vassals) out.push(lines.vassals);
      if (lines.neighbours) out.push(lines.neighbours);
      out.push(lines.rank);
      out.push("Counsel: estates, stores, tenants, officers. If he asks for exact figures, request the land, labour, chest or stores drawers. On kings and counts give a householder's guess and send him to Aldric or Ermenald.");
      break;
    case "hildegard":
      if (lines.neighbours) out.push(lines.neighbours);
      else out.push(`The neighbours: ${state.history.neighbours.map((n) => `${n.name} of ${n.seat}${n.kin ? " (your father)" : ""}`).join(", ") || "the lords around"}; none has taken anything of ours.`);
      if (lines.vassals) out.push(lines.vassals);
      if (lines.justice.length) out.push(...lines.justice);
      out.push(lines.land, lines.rank);
      if (lines.activeTitles.length) out.push(`Told in the hall lately: ${lines.activeTitles.join("; ")}. You know of it as the district knows of it: in outline, and with the district's opinion attached.`);
      out.push("Counsel: the district, its families, its quarrels and its gossip. On the kingdom say what people hereabouts believe and own that it may be wrong.");
      break;
    case "linda":
      out.push(lines.rank);
      if (lines.justice.length) out.push(...lines.justice);
      if (lines.facts) out.push(`What you have heard said of the lord: ${lines.facts}.`);
      out.push(`The hall: ${state.population.households} households on the land${state.population.mancipia ? `, ${state.population.mancipia} unfree held` : ""}; the sworn men ${state.history.vassals.length ? `are ${state.history.vassals.filter((v) => v.mood < 35).length ? "sour" : "civil"} toward the hall` : "are none yet"}.`);
      out.push("Counsel: speak to the right and wrong of a thing, and to the people it falls on. On power you guess like a decent person guesses, and you are often wrong; do not pretend to a knowledge you were never given, and ask him to explain what you do not follow.");
      break;
  }
  if (m.archetype === "linda" && m.lastRemarkTurn !== null && state.meta.turn - m.lastRemarkTurn <= 1) out.push("The hall has been talking about the match again lately. You know. You do not make him carry it.");
  return out.join("\n");
}

/** One line for the Books: the marriage and what came with it. */
export function marriageBookLines(state: WorldState): string[] {
  const m = state.history.marriage;
  if (!m.archetype || !m.name) return [];
  const tier = tierOf(state);
  const lines = [`${m.name}, ${matchWord(m.archetype, tier)}${m.kin ? ` of ${m.kin.house}` : ""}, married ${m.year ?? ""}.`.replace(/\s+\./, ".")];
  if (m.kin?.head) lines.push(`Her kin: ${m.kin.head}${m.kin.enemy ? `; their enemies, and now the lord's, ${m.kin.enemy}` : ""}.`);
  if (m.dower) lines.push(`Her dower: ${state.holdings.find((h) => h.id === m.dower?.holdingId)?.name ?? "a villa"}, held outright${m.dower.stepchildren ? `; her first husband's sons have claims on it${m.dower.claims ? ` (${m.dower.claims} pressed)` : ""}` : ""}.`);
  if (m.archetype === "linda") lines.push("No land and no kin came with her. The sworn men's resting mood is lower for it, and the heir's standing weaker.");
  return lines;
}

/** The closing page: how the marriage sits in the record. */
export function marriageEndingLine(state: WorldState): string | null {
  const m = state.history.marriage;
  if (!m.archetype || !m.name) return null;
  const heir =
    m.archetype === "linda"
      ? "his heir stands weaker for it, with no kin to speak for him"
      : m.archetype === "theoderada"
        ? "his heir has a great house behind him"
        : m.archetype === "hildegard"
          ? "his heir has kin in the district"
          : "his heir holds the dower only if the stepsons' claims are quiet";
  return `Marriage: ${m.name}, ${matchWord(m.archetype, tierOf(state))}${m.kin ? ` of ${m.kin.house}` : ""}, in ${m.year ?? "an unrecorded year"}; ${heir}.`;
}
