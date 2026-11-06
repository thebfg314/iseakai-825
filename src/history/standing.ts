import type { WorldState } from "../engine/schema";
import { clamp } from "../engine/util";
import type { FlagValue } from "./schema";

/**
 * Relationships that drift, as distinct from sticky facts.
 *
 * Tier 1 is one number from 0 to 100. 50 is neither warm nor cold, the same
 * resting point as the tenants' happiness. A written "+1" is one point on that
 * scale, not a rescaling. Church, crown, and the immediate lord each have one
 * number. count_opinion and count_trust are the lord's number. charles_favor
 * and charles_disfavor move the crown's number up and down.
 *
 * The bishop of Autun is not a second church. Before the player holds a county
 * his regard is the church's. From Count on, he is tracked on his own.
 *
 * Tier 2 is how a house receives an approach: enemy, cold, neutral, warm, ally.
 * A "+1" steps one place and stops at the ends. Houses the lord has patronised
 * (Tournus, Cluny, his own chapel) do not have tracks of their own; they warm
 * a local asking of the church.
 *
 * Sticky facts (excommunicated, an oath, a patronage, outlawry) stay Booleans.
 */

export const STANDING_NEUTRAL = 50;
export const STANDING_MIN = 0;
export const STANDING_MAX = 100;

/** enemy −2, cold −1, neutral 0, warm +1, ally +2. */
export const BAND_MIN = -2;
export const BAND_MAX = 2;

/** A house he has actually patronised, asked of the church in that house's business. */
export const HOUSE_MODIFIER = 10;

export type HundredKey = "church" | "crown" | "lord" | "bishop";
export type BandKey = "septimania" | "bosonids" | "robertians";
export type HouseId = "tournus" | "cluny" | "oratory";

const HUNDRED_ALIAS: Record<string, { key: HundredKey; sign: 1 | -1 }> = {
  favor_church: { key: "church", sign: 1 },
  crown: { key: "crown", sign: 1 },
  charles_favor: { key: "crown", sign: 1 },
  charles_disfavor: { key: "crown", sign: -1 },
  lord_standing: { key: "lord", sign: 1 },
  count_opinion: { key: "lord", sign: 1 },
  count_trust: { key: "lord", sign: 1 },
  bishop_trust: { key: "bishop", sign: 1 },
};

const BAND_ALIAS: Record<string, BandKey> = {
  favor_septimania: "septimania",
  richard_respect: "bosonids",
  favor_robertians: "robertians",
};

const HUNDRED_FIELDS: Record<HundredKey, string[]> = {
  church: ["favor_church"],
  crown: ["crown", "charles_favor", "charles_disfavor"],
  lord: ["lord_standing", "count_opinion", "count_trust"],
  bishop: ["bishop_trust"],
};

const BAND_FIELDS: Record<BandKey, string[]> = {
  septimania: ["favor_septimania"],
  bosonids: ["richard_respect"],
  robertians: ["favor_robertians"],
};

export function isHundredFlag(id: string): boolean {
  return id in HUNDRED_ALIAS;
}

export function isBandFlag(id: string): boolean {
  return id in BAND_ALIAS;
}

/** Count of Autun, or any county: the bishop is then a man at the gate. */
export function bishopIsSeparate(state: WorldState): boolean {
  return (state.player.rankLevel ?? 1) >= 3 || state.history.flags.holds_autun === true;
}

function storedNumber(flags: Record<string, FlagValue>, ids: string[]): number | undefined {
  for (const id of ids) {
    const v = flags[id];
    if (typeof v === "number") return v;
  }
  return undefined;
}

export function hundredValue(state: WorldState, key: HundredKey): number {
  const v = storedNumber(state.history.flags, HUNDRED_FIELDS[key]);
  return v === undefined ? STANDING_NEUTRAL : clamp(Math.round(v), STANDING_MIN, STANDING_MAX);
}

export function bandValue(state: WorldState, key: BandKey): number {
  const v = storedNumber(state.history.flags, BAND_FIELDS[key]);
  return v === undefined ? 0 : clamp(Math.round(v), BAND_MIN, BAND_MAX);
}

function writeHundred(state: WorldState, key: HundredKey, value: number): void {
  const n = clamp(Math.round(value), STANDING_MIN, STANDING_MAX);
  for (const id of HUNDRED_FIELDS[key]) state.history.flags[id] = n;
}

function writeBand(state: WorldState, key: BandKey, value: number): void {
  const n = clamp(Math.round(value), BAND_MIN, BAND_MAX);
  for (const id of BAND_FIELDS[key]) state.history.flags[id] = n;
}

/**
 * The first season he holds a county, the bishop starts from the church's
 * standing, because until then he was that standing. After that they diverge.
 */
export function trackBishop(state: WorldState): void {
  if (!bishopIsSeparate(state)) return;
  if (state.history.flags.bishop_tracked === true) return;
  writeHundred(state, "bishop", hundredValue(state, "church"));
  state.history.flags.bishop_tracked = true;
}

function houseTied(state: WorldState, house: HouseId): boolean {
  const f = state.history.flags;
  if (house === "tournus") return Boolean(f.tournus_friend || f.tournus_host || f.tournus_carts || f.tournus_escort);
  if (house === "cluny") return f.cluny_witness === true;
  return state.holdings.some((h) => h.features.includes("chapel"));
}

/** Church standing, plus a local warmth when the question is one house he has patronised. */
export function churchStanding(state: WorldState, house?: HouseId): number {
  const base = hundredValue(state, "church");
  if (!house || !houseTied(state, house)) return base;
  return clamp(base + HOUSE_MODIFIER, STANDING_MIN, STANDING_MAX);
}

export function hundredWord(n: number): string {
  if (n <= 19) return "an enemy";
  if (n <= 39) return "cold";
  if (n <= 59) return "neither warm nor cold";
  if (n <= 79) return "warm";
  return "a fast friend";
}

export function bandWord(n: number): string {
  if (n <= -2) return "an enemy";
  if (n <= -1) return "cold";
  if (n === 0) return "neither warm nor cold";
  if (n === 1) return "warm";
  return "an ally";
}

/**
 * One line for Aldric and Ermenald. Words, not a column of scores. Neutral
 * houses are left out; a moved one is named by how it receives him.
 */
export function relationshipLine(state: WorldState): string | null {
  const parts: string[] = [];
  const church = hundredValue(state, "church");
  const crown = hundredValue(state, "crown");
  const lord = hundredValue(state, "lord");
  const tenants = state.peopleHappiness ?? STANDING_NEUTRAL;
  if (church !== STANDING_NEUTRAL) parts.push(`the church receives him as ${hundredWord(church)}`);
  if (crown !== STANDING_NEUTRAL) parts.push(`the crown receives him as ${hundredWord(crown)}`);
  if (lord !== STANDING_NEUTRAL) parts.push(`his immediate lord receives him as ${hundredWord(lord)}`);
  if (tenants !== STANDING_NEUTRAL) parts.push(`the tenants are ${hundredWord(tenants)}`);
  if (state.history.flags.bishop_tracked === true) {
    parts.push(`the bishop of Autun, a man at his gate, receives him as ${hundredWord(hundredValue(state, "bishop"))}`);
  }
  const bands: [BandKey, string][] = [
    ["septimania", "the Septimanian house"],
    ["bosonids", "the Bosonids"],
    ["robertians", "the Robertians"],
  ];
  for (const [key, name] of bands) {
    const n = bandValue(state, key);
    if (n !== 0) parts.push(`${name} receive him as ${bandWord(n)}`);
  }
  if (houseTied(state, "tournus")) parts.push("Tournus gives him a warmer hearing than the church at large");
  if (houseTied(state, "cluny")) parts.push("Cluny gives him a warmer hearing than the church at large");
  if (!parts.length) return null;
  return `Relationships: ${parts.join("; ")}. Say it as how they receive him, not as a score.`;
}

function parseDelta(op: FlagValue): number | null {
  if (typeof op === "string" && /^[+-]\d+$/.test(op)) return Number(op);
  return null;
}

/**
 * Apply a relationship op. Returns null if this id is not a relationship,
 * otherwise an error string or null for success.
 */
export function applyStandingOp(state: WorldState, id: string, op: FlagValue): string | null | undefined {
  const hundred = HUNDRED_ALIAS[id];
  if (hundred) {
    if (hundred.key === "bishop" && !bishopIsSeparate(state)) {
      return applyStandingOp(state, "favor_church", op);
    }
    if (hundred.key === "bishop") trackBishop(state);
    const delta = parseDelta(op);
    let next: number;
    if (delta !== null) next = hundredValue(state, hundred.key) + hundred.sign * delta;
    else if (typeof op === "boolean") {
      if (hundred.sign < 0 && op) next = hundredValue(state, hundred.key) - 1;
      else return `Flag ${id} is a standing; got '${String(op)}'`;
    } else if (typeof op === "number") next = op;
    else return `Flag ${id} is a standing; got '${String(op)}'`;
    writeHundred(state, hundred.key, next);
    return null;
  }
  const band = BAND_ALIAS[id];
  if (band) {
    const delta = parseDelta(op);
    let next: number;
    if (delta !== null) next = bandValue(state, band) + delta;
    else if (typeof op === "number") next = op;
    else return `Flag ${id} is a reception; got '${String(op)}'`;
    writeBand(state, band, next);
    return null;
  }
  return undefined;
}

/** A rupture with Bernard's house drops their reception to enemy. The fact itself stays a Boolean. */
export function noteSeptimanianEnemy(state: WorldState): void {
  if (state.history.flags.enemy_septimania === true) writeBand(state, "septimania", BAND_MIN);
}

/**
 * Old saves stored these as small counters from zero. A point of favour is still
 * a point; it now sits above a neutral 50. Bands were already the five places.
 */
export function migrateStanding(history: { flags?: Record<string, FlagValue>; standingV?: number }): void {
  if (!history || history.standingV === 1) return;
  const flags = history.flags ?? {};
  const small = (v: FlagValue): number | null => (typeof v === "number" && Math.abs(v) <= 20 ? v : null);
  const churchN = small(flags.favor_church);
  const church = churchN === null ? (typeof flags.favor_church === "number" ? clamp(flags.favor_church, STANDING_MIN, STANDING_MAX) : STANDING_NEUTRAL) : clamp(STANDING_NEUTRAL + churchN, STANDING_MIN, STANDING_MAX);
  const crown = clamp(
    STANDING_NEUTRAL +
      (typeof flags.charles_favor === "number" && Math.abs(flags.charles_favor) <= 20 ? flags.charles_favor : 0) -
      (typeof flags.charles_disfavor === "number" && Math.abs(flags.charles_disfavor) <= 20 ? flags.charles_disfavor : 0),
    STANDING_MIN,
    STANDING_MAX,
  );
  const opinion = typeof flags.count_opinion === "number" && Math.abs(flags.count_opinion) <= 20 ? flags.count_opinion : 0;
  const trust = typeof flags.count_trust === "number" && Math.abs(flags.count_trust) <= 20 ? flags.count_trust : 0;
  const lord = clamp(STANDING_NEUTRAL + opinion + trust, STANDING_MIN, STANDING_MAX);
  if (typeof flags.favor_church === "number") flags.favor_church = church;
  if (typeof flags.charles_favor === "number" || typeof flags.charles_disfavor === "number") {
    flags.crown = crown;
    flags.charles_favor = crown;
    flags.charles_disfavor = crown;
  }
  if (typeof flags.count_opinion === "number" || typeof flags.count_trust === "number") {
    flags.lord_standing = lord;
    flags.count_opinion = lord;
    flags.count_trust = lord;
  }
  if (typeof flags.bishop_trust === "number" && Math.abs(flags.bishop_trust) <= 20) {
    flags.bishop_trust = clamp(STANDING_NEUTRAL + flags.bishop_trust, STANDING_MIN, STANDING_MAX);
  }
  for (const id of Object.keys(BAND_ALIAS)) {
    const v = flags[id];
    if (typeof v === "number") flags[id] = clamp(Math.round(v), BAND_MIN, BAND_MAX);
  }
  history.standingV = 1;
}
