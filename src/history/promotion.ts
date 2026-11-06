import { createRng, seedFromString } from "../combat/rng";
import { rankForRenown, rankTitle } from "../combat/renown";
import type { Rank } from "../combat/schema";
import type { Holding, WorldState } from "../engine/schema";
import type { HistoryBeat } from "./deliver";
import { flagTruthy } from "./flags";
import { historyContent, seasonOrdinal } from "./load";
import { noteOfficeGranted } from "./office";
import { rankStep, ranksTable, thresholdFor } from "./ranks";
import type { SeasonAt } from "./scheduler";
import type { PromoteEffect, VillaTemplate } from "./schema";
import { trackBishop } from "./standing";
import { noteVassalEvent } from "./vassals";

/**
 * Rank progression (03_HISTORY §10; "Isekai 825 Rank Progression — Holdings and Powers").
 *
 * Renown makes the lord *eligible*; a hand must grant the rank. Scripted windows (834-02, 835-02,
 * 845-P1, the king quest's election, the open throne of 888) grant it in their own words; otherwise
 * a generic summons from the patron arrives within two years of crossing the threshold. Generic
 * summons reach Duke at most; the crown only comes through the quest or the open throne.
 *
 * Each step grants what data/history/ranks.json says: villas as real holdings (benefices from the
 * patron), their people and stores, the chest, the men, the vassals, and from Count the office — a
 * county block with its fisc and public revenue (revenue.ts pays it each season). Titles are sticky;
 * a stripping takes the office and the patron's benefices and leaves what the lord owns.
 */

export type PromotionResult = {
  beats: HistoryBeat[];
  lines: string[];
  /** The rank reached, when one was. */
  promoted?: number;
};

export const LEGACY_RANK_LABELS = ["minor_noble", "viscount", "count", "duke", "king"] as const;

/** The highest rank the lord's renown entitles him to through a generic summons (Duke at most). */
export function eligibleRank(state: WorldState): number {
  return Math.min(4, rankForRenown(state.player.renown ?? 1));
}

export function currentRank(state: WorldState): number {
  return Math.max(1, Math.min(5, state.player.rankLevel ?? 1));
}

function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Names not yet a villa of the lord's nor a sworn man's own holding. */
function unusedNames(state: WorldState, pool: readonly string[], used: Set<string>): string[] {
  return pool.filter((n) => !used.has(n) && !state.holdings.some((h) => h.name === n) && !state.history.vassals.some((v) => v.holding === n));
}

function seatOf(state: WorldState): Holding | undefined {
  return state.holdings.find((h) => h.seat) ?? state.holdings[0];
}

function addStock(state: WorldState, id: string, amount: number): void {
  const res = state.resources as Record<string, number>;
  if (typeof res[id] === "number") res[id] = Math.round((res[id] + amount) * 10) / 10;
}

function villaTemplateFor(like: number | undefined, state: WorldState): VillaTemplate | undefined {
  const r = like ?? Math.max(2, Math.min(4, currentRank(state)));
  for (let k = r; k >= 2; k--) {
    const t = rankStep(k)?.villa;
    if (t) return t;
  }
  return rankStep(2)?.villa;
}

/**
 * Add `n` villas to the holdings from a template, with people and stores to match. Names come from
 * the pool, seeded so a save replays the same. Returns the names.
 */
export function grantVillas(
  state: WorldState,
  n: number,
  opts: { patron: string; tenure?: "owned" | "benefice"; like?: number; turn: number; template?: VillaTemplate },
): string[] {
  if (n <= 0) return [];
  const template = opts.template ?? villaTemplateFor(opts.like, state);
  if (!template) return [];
  const rng = createRng(seedFromString(`villas:${opts.turn}:${state.holdings.length}:${opts.patron}`));
  const used = new Set<string>();
  const names: string[] = [];
  for (let i = 0; i < n; i++) {
    const free = unusedNames(state, ranksTable().villaNames, used);
    const name = free.length ? rng.pick(free) : `New villa ${state.holdings.length + 1}`;
    used.add(name);
    names.push(name);
    const wobble = () => 0.85 + rng.float() * 0.3;
    const land = Object.fromEntries(Object.entries(template.land).map(([k, v]) => [k, Math.max(0, Math.round(v * wobble()))])) as Holding["land"];
    const manses = { ...template.manses };
    const sownCap = land.fertile_arable / 2;
    const holding: Holding = {
      id: `villa_${slugify(name)}_${state.holdings.length + 1}`,
      name,
      land,
      sown: { wheat: Math.round(sownCap * 0.45 * 10) / 10, rye: Math.round(sownCap * 0.55 * 10) / 10, barley: 0, oats: 0 },
      households: manses.free + manses.servile,
      features: [...template.features],
      manses,
      tenure: opts.tenure ?? "benefice",
      grantedBy: opts.patron,
      grantedTurn: opts.turn,
    };
    state.holdings.push(holding);
    state.population.households += holding.households;
    state.population.adult_men += template.people.men;
    state.population.adult_women += template.people.women;
    state.population.youths += template.people.youths;
    for (const [id, amount] of Object.entries(template.stores)) addStock(state, id, amount);
  }
  return names;
}

/** Benefices held from `patron` go back; owned land stays. Returns the names lost. */
export function forfeitFrom(state: WorldState, patron: string): string[] {
  const lost = state.holdings.filter((h, i) => i > 0 && h.tenure === "benefice" && h.grantedBy === patron);
  if (!lost.length) return [];
  for (const h of lost) {
    const t = villaTemplateFor(undefined, state);
    const i = state.holdings.indexOf(h);
    if (i > 0) state.holdings.splice(i, 1);
    state.population.households = Math.max(0, state.population.households - h.households);
    if (t) {
      state.population.adult_men = Math.max(0, state.population.adult_men - t.people.men);
      state.population.adult_women = Math.max(0, state.population.adult_women - t.people.women);
      state.population.youths = Math.max(0, state.population.youths - t.people.youths);
    }
  }
  const before = state.history.vassals.length;
  state.history.vassals = state.history.vassals.filter((v) => !lost.some((h) => h.name === v.holding));
  // The men who held of the lord on those villas go with them; the rest see holdings taken back.
  if (state.history.vassals.length < before) noteVassalEvent(state, "holding_taken", state.meta.turn);
  return lost.map((h) => h.name);
}

function countyTemplate(rank: number) {
  for (let k = rank; k >= 3; k--) {
    const c = rankStep(k)?.county;
    if (c) return c;
  }
  return rankStep(3)?.county;
}

/** A county by name joins the office (Autun brings its own terms). */
export function grantCounty(state: WorldState, name: string, turn: number, rank = currentRank(state)): string | null {
  if (state.history.rank.counties.some((c) => c.name === name)) return null;
  const t = countyTemplate(Math.max(3, rank));
  if (!t) return null;
  state.history.rank.counties.push({ name, since: turn, fiscManses: t.fiscManses, fiscVillas: t.fiscVillas, levy: t.levy, yearly: { ...t.yearly } });
  if (name === "Autun") {
    state.history.flags.holds_autun = true;
    trackBishop(state);
    const seat = seatOf(state);
    const stone = ranksTable().autun.seatFeature;
    if (seat && !seat.features.includes(stone)) seat.features.push(stone);
  }
  return name;
}

function addVassals(state: WorldState, upTo: number, patron: string, turn: number): string[] {
  const individuals = state.history.vassals.filter((v) => !v.group);
  const need = upTo - individuals.length;
  if (need <= 0) return [];
  const rng = createRng(seedFromString(`vassals:${turn}:${individuals.length}`));
  const usedNames = new Set(state.history.vassals.map((v) => v.name));
  const usedHoldings = new Set(state.history.vassals.map((v) => v.holding));
  const names: string[] = [];
  for (let i = 0; i < need; i++) {
    const freeNames = ranksTable().vassalNames.filter((n) => !usedNames.has(n));
    const name = freeNames.length ? rng.pick(freeNames) : `Vassal ${state.history.vassals.length + 1}`;
    usedNames.add(name);
    const freeVillas = ranksTable().villaNames.filter((n) => !usedHoldings.has(n) && !state.holdings.some((h) => h.name === n));
    const holding = freeVillas.length ? rng.pick(freeVillas) : `a manse near ${seatOf(state)?.name ?? "the hall"}`;
    usedHoldings.add(holding);
    const bents = ["fighter", "devout", "hunter", "court"] as const;
    state.history.vassals.push({
      id: `vassal_${slugify(name)}_${turn}_${i}`,
      name,
      holding,
      men: rng.int(2, 5),
      mood: 50,
      since: turn,
      group: false,
      grantedBy: patron,
      angrySince: null,
      lastReason: null,
      bent: bents[rng.int(0, bents.length - 1)],
      gifts: [],
      grievances: [],
      snubbed: false,
    });
    names.push(name);
  }
  return names;
}

function addVassalGroups(state: WorldState, turn: number): void {
  for (const c of state.history.rank.counties) {
    const id = `county_${slugify(c.name)}`;
    if (state.history.vassals.some((v) => v.id === id)) continue;
    state.history.vassals.push({
      id,
      name: `The lords of ${c.name}`,
      holding: c.name,
      men: c.levy,
      mood: 50,
      since: turn,
      group: true,
      angrySince: null,
      lastReason: null,
      bent: "court",
      gifts: [],
      grievances: [],
      snubbed: false,
    });
  }
}

function speakRanks(lines: string[]): string {
  return lines.filter(Boolean).join(" ");
}

/**
 * Raise the lord to `target`, applying every step between. The patron's name is kept on the
 * benefices so a fallen patron can take them back. Posts Aldric's account of what came with it.
 */
export function promoteTo(state: WorldState, target: number, opts: { patron: string; turn: number; at?: SeasonAt; eventId?: string; silent?: boolean }): PromotionResult {
  const out: PromotionResult = { beats: [], lines: [] };
  const from = currentRank(state);
  const to = Math.max(1, Math.min(5, Math.round(target)));
  if (to <= from) return out;
  const at = opts.at ?? { year: state.meta.year, season: state.meta.season as SeasonAt["season"] };
  // The men already sworn are glad of a lord raised up; the new ones come in at the middle.
  noteVassalEvent(state, "promotion", opts.turn);
  for (let r = from + 1; r <= to; r++) {
    const step = rankStep(r);
    if (!step) continue;
    const said: string[] = [];
    state.player.rankLevel = r;
    state.player.rank = LEGACY_RANK_LABELS[r - 1];
    // Villas: up to the step's count, and never fewer than one when the step brings land.
    if (step.villa) {
      const n = Math.max(1, step.targetVillas - state.holdings.length);
      const names = grantVillas(state, n, { patron: opts.patron, tenure: "benefice", turn: opts.turn, template: step.villa });
      if (names.length) said.push(`${names.length === 1 ? "The villa" : "The villas"} of ${names.join(", ")} ${names.length === 1 ? "is" : "are"} ours to hold from ${opts.patron}, with the people and the stores on them.`);
    }
    if (step.chest > 0) {
      state.resources.denarii = Math.round(state.resources.denarii + step.chest);
      said.push(`${step.chest} denarii went into the chest with the grant.`);
    }
    for (const u of step.units) {
      state.military.units.push({ id: `unit_rank${r}_${slugify(u.name)}_${opts.turn}`, sheetId: u.sheet, name: u.name, veteran: false, strength: u.men, raisedTurn: opts.turn });
    }
    if (step.units.length) said.push(`${step.units.reduce((n, u) => n + u.men, 0)} armed men came with the rank: ${step.units.map((u) => `${u.men} ${u.sheet.replaceAll("_", " ")}`).join(", ")}.`);
    if (step.seatFeature) {
      const seat = seatOf(state);
      if (seat) {
        seat.seat = true;
        if (!seat.features.some((f) => f === "palisade" || f === "stone_wall")) {
          seat.features.push(step.seatFeature);
          said.push(`A ${step.seatFeature.replaceAll("_", " ")} now stands at ${seat.name}, the seat.`);
        }
      }
    }
    if (step.counties > 0) {
      const have = state.history.rank.counties.length;
      const want = step.counties - have;
      const pool = ranksTable().counties.filter((c) => !state.history.rank.counties.some((k) => k.name === c));
      const granted: string[] = [];
      for (let i = 0; i < want && i < pool.length; i++) {
        const name = grantCounty(state, pool[i], opts.turn, r);
        if (name) granted.push(name);
      }
      if (granted.length) said.push(`The ${granted.length === 1 ? "county" : "counties"} of ${granted.join(", ")} ${granted.length === 1 ? "is" : "are"} held by office: the fisc, the tolls, the market and the pleas run through our hands now, and the levy answers in the king's name.`);
    }
    if (step.mint && state.meta.year >= ranksTable().autun.mintFromYear && state.history.rank.counties.some((c) => c.name === "Chalon")) {
      state.history.rank.mint = step.mint;
      said.push("The mint at Chalon pays its share to us.");
    }
    if (step.royalFisc) {
      state.history.rank.royalFisc = { yearly: step.royalFisc.yearly, host: { ...step.royalFisc.host } };
      said.push("The royal fisc — the palaces, the forests, several hundred villas — is the crown's and not ours, but it answers to us while we wear it.");
    }
    if (step.vassals > 0) {
      const names = addVassals(state, step.vassals, opts.patron, opts.turn);
      if (names.length) said.push(`${names.length} men have sworn to us for their holdings: ${names.join(", ")}.`);
    }
    if (r >= 4) addVassalGroups(state, opts.turn);
    if (r === 2) noteOfficeGranted(state);
    const title = rankTitle(r as Rank);
    state.history.rank.patron = opts.patron;
    state.history.rank.promotedTurn = opts.turn;
    state.history.rank.eligibleSince = null;
    state.history.rank.dueTurn = null;
    state.history.record.push({ year: at.year, season: at.season, text: `Raised to ${title} by ${opts.patron}.`, thread: opts.eventId ?? "rank" });
    out.lines.push(`Raised to ${title} by ${opts.patron}.`);
    if (!opts.silent) {
      out.beats.push({
        npcId: "steward",
        eventId: opts.eventId ?? "rank:promoted",
        text: speakRanks([`My lord, I have written it in the books: ${title} of this land, by the hand of ${opts.patron}.`, ...said, "I will need more hands for the accounts before long."]),
      });
    }
    out.promoted = r;
  }
  return out;
}

/**
 * The king (or a count) takes honours. The office goes — counties, fisc, revenue, the crown —
 * and the benefices held from the stripping hand; owned villas, the men and the title's memory stay.
 */
export function demoteBy(state: WorldState, ranksLost: number, opts: { by: string; turn: number; at?: SeasonAt; eventId?: string }): PromotionResult {
  const out: PromotionResult = { beats: [], lines: [] };
  const from = currentRank(state);
  const to = Math.max(1, from - Math.max(0, ranksLost));
  if (to >= from) return out;
  const at = opts.at ?? { year: state.meta.year, season: state.meta.season as SeasonAt["season"] };
  state.player.rankLevel = to;
  state.player.rank = LEGACY_RANK_LABELS[to - 1];
  const rank = state.history.rank;
  if (to < 5) rank.royalFisc = null;
  if (to < 4) {
    rank.counties = rank.counties.slice(0, to >= 3 ? 1 : 0);
    rank.mint = 0;
    state.history.vassals = state.history.vassals.filter((v) => !v.group || rank.counties.some((c) => c.name === v.holding));
    if (!rank.counties.some((c) => c.name === "Autun")) delete state.history.flags.holds_autun;
  }
  if (to < 3) rank.counties = [];
  const lost = forfeitFrom(state, opts.by);
  if (lost.length) out.lines.push(`Benefices lost: ${lost.join(", ")}.`);
  const keep = rankStep(to)?.vassals ?? 0;
  const individuals = state.history.vassals.filter((v) => !v.group);
  if (individuals.length > keep) {
    const dropped = individuals.slice(keep);
    state.history.vassals = state.history.vassals.filter((v) => !dropped.includes(v));
  }
  // The men who stay have seen their lord stripped.
  noteVassalEvent(state, "demotion", opts.turn);
  rank.cooldownUntil = opts.turn + ranksTable().summons.cooldownSeasons;
  rank.eligibleSince = null;
  rank.dueTurn = null;
  const text = `Stripped to ${rankTitle(to as Rank)} by ${opts.by}.`;
  state.history.record.push({ year: at.year, season: at.season, text, thread: opts.eventId ?? "rank" });
  out.lines.push(text);
  return out;
}

/** Scripted window: the data's `promote` block. Returns whether the step was given (onPromote/onThanks are the caller's). */
export function applyPromoteEffect(state: WorldState, fx: PromoteEffect, opts: { eventId: string; turn: number; at?: SeasonAt; holds: (cond: string | undefined) => boolean }): { promoted: boolean; lines: string[]; beats: HistoryBeat[] } {
  const from = currentRank(state);
  const next = from + 1;
  const scale = fx.scaleWhen && opts.holds(fx.scaleWhen) ? (fx.scale ?? 1) : 1;
  const eligible = next <= (fx.cap ?? 4) && (state.player.renown ?? 1) >= thresholdFor(next) * scale;
  if (!eligible) {
    state.history.rank.windows[opts.eventId] = "thanks";
    return { promoted: false, lines: [], beats: [] };
  }
  const r = promoteTo(state, next, { patron: fx.patron, turn: opts.turn, at: opts.at, eventId: opts.eventId });
  state.history.rank.windows[opts.eventId] = "promoted";
  if (fx.mark) state.history.flags[fx.mark] = true;
  return { promoted: true, lines: r.lines, beats: r.beats };
}

function patronFor(state: WorldState, rank: number): string {
  const realm = state.history.realm;
  const king = realm.king ?? realm.emperor ?? "the king";
  if (rank === 2 && realm.swornTo !== "king" && !flagTruthy(state, "royal_vassal")) return `${realm.countOfAutun}, count of Autun`;
  return `${king}, the king`;
}

function scriptedWindowRecently(state: WorldState, turn: number): boolean {
  const quiet = ranksTable().summons.quietAfterScriptedSeasons;
  const content = historyContent();
  return Object.entries(state.history.fired).some(([id, f]) => content.byId.get(id)?.type === "promotion" && turn - f.turn <= quiet);
}

function pendingScriptedWindow(state: WorldState, at: SeasonAt): boolean {
  // A dated promotion window due this or next season speaks first; the generic summons waits.
  const content = historyContent();
  const now = seasonOrdinal(at.year, at.season);
  return content.events.some((e) => {
    if (e.type !== "promotion" || e.rolled || state.history.fired[e.id] || state.history.dropped.includes(e.id)) return false;
    const when = seasonOrdinal(e.fires.year, e.fires.season);
    return when >= now && when <= now + 1;
  });
}

function genericSummonsText(state: WorldState, rank: number, patron: string): string {
  const title = rankTitle(rank as Rank);
  const seat = seatOf(state)?.name ?? "Fontenay";
  switch (rank) {
    case 2:
      return `My lord, a rider from ${patron}. You are summoned to court, and it is not for a reproach: your name has gone before you, and they mean to make you ${title.toLowerCase()} of these parts — the villas, the men, and a seat at ${seat} worth fortifying. I have told the hall to find your good cloak.`;
    case 3:
      return `My lord, the summons has come from ${patron}. A county is to be given, and they have named you for it. You will hold the fisc by office, sit in judgment on the pleas, take the tolls and the market dues, and call out the levy in the king's name. It is a different life from the villa, my lord, and a great deal more parchment.`;
    default:
      return `My lord, ${patron} has sent for you, and the word that came with the rider is that several counties are to be joined under one hand, and the hand is yours. They will call you ${title.toLowerCase()}, or marquis, as the fashion goes. The counts under you will want to know what kind of man you are.`;
  }
}

/**
 * Season tick: eligibility, the generic summons clock, and the grant when it falls due. Runs after the
 * calendar so a scripted window the same season speaks first.
 */
export function tickPromotion(state: WorldState, at: SeasonAt, turn: number): PromotionResult {
  const out: PromotionResult = { beats: [], lines: [] };
  if (!historyContent().features.promotions) return out;
  if (state.history.dead || state.player.dead) return out;
  const rank = state.history.rank;
  const have = currentRank(state);
  const eligible = eligibleRank(state);
  if (eligible <= have) {
    rank.eligibleSince = null;
    rank.dueTurn = null;
    return out;
  }
  const s = ranksTable().summons;
  if (rank.eligibleSince === null || rank.dueTurn === null) {
    rank.eligibleSince = turn;
    const rng = createRng(seedFromString(`summons:${turn}:${eligible}:${Math.round(state.player.renown ?? 1)}`));
    rank.dueTurn = turn + rng.int(s.minSeasons, s.maxSeasons);
    out.lines.push(`The lord's renown (${Math.round(state.player.renown ?? 1)}) would bear the rank of ${rankTitle(eligible as Rank)}; word of it is travelling.`);
    return out;
  }
  if (turn < rank.dueTurn) return out;
  if (rank.cooldownUntil !== null && turn < rank.cooldownUntil) return out;
  if (state.history.away) return out;
  if (state.history.ladder.stage !== "none" || state.history.quest.active) return out;
  if (state.battle_call || state.battle) return out;
  if (scriptedWindowRecently(state, turn) || pendingScriptedWindow(state, at)) return out;
  const next = have + 1;
  const patron = patronFor(state, next);
  out.beats.push({ npcId: "steward", eventId: "rank:summons", text: genericSummonsText(state, next, patron) });
  const r = promoteTo(state, next, { patron, turn, at, eventId: "rank:summons" });
  out.beats.push(...r.beats);
  out.lines.push(...r.lines);
  out.promoted = r.promoted;
  return out;
}

/** The battle ledger no longer promotes; it notes that the name would bear a higher rank. */
export function eligibilityNote(state: WorldState): string | null {
  const eligible = eligibleRank(state);
  if (eligible <= currentRank(state)) return null;
  return `The lord's name would now bear the rank of ${rankTitle(eligible as Rank)}; it wants a hand to grant it.`;
}

/** One prompt line for the household on rank, holdings and office. */
export function rankLine(state: WorldState): string {
  const r = currentRank(state);
  const rank = state.history.rank;
  const villas = state.holdings.length;
  const benefices = state.holdings.filter((h, i) => i > 0 && h.tenure === "benefice").length;
  const parts = [`Rank: ${rankTitle(r as Rank)}${rank.patron ? ` (by ${rank.patron})` : ""}; ${villas} villa${villas === 1 ? "" : "s"}${benefices ? `, ${benefices} held as benefice${benefices === 1 ? "" : "s"}` : ""}`];
  if (rank.counties.length) parts.push(`counties by office: ${rank.counties.map((c) => c.name).join(", ")}`);
  if (state.history.vassals.length) parts.push(`${state.history.vassals.filter((v) => !v.group).length} sworn men${state.history.vassals.some((v) => v.group) ? " and the lords of the counties" : ""}`);
  const eligible = eligibleRank(state);
  if (eligible > r) parts.push(`his renown would bear ${rankTitle(eligible as Rank)}; a summons is expected${rank.dueTurn !== null ? ` within ${Math.max(1, rank.dueTurn - state.meta.turn)} season${rank.dueTurn - state.meta.turn === 1 ? "" : "s"}` : ""}`);
  if (rank.lastRevenue) parts.push(`the office brought ${rank.lastRevenue.net} d last season`);
  return `${parts.join("; ")}.`;
}
