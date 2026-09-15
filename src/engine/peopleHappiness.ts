import type { WorldState } from "./schema";
import { grainOnHand, HOUSEHOLD_SEASON_GRAIN } from "./grain";
import { labourPool, labourUsed } from "./labour";
import { modifiersFor } from "./modifiers";
import { clamp } from "./util";

/**
 * Estate-wide people's happiness (the hall meter), not per-NPC mood and not the
 * `mood` modifier target (that one only scales yield and callable labour).
 *
 * Durable 0–100 stock. Old saves omit the field; Zod defaults it to 50 (settled).
 *
 * Each Advance season, after agriculture and event effects, the engine adds this
 * signed sum and clamps:
 *
 *   hunger              −12  flags.hunger after the household grain ration
 *   grain stores         +4 / +1 / −6  household-seasons of grain still on hand
 *                        (skipped when already hungry — hunger is the stronger hit)
 *   harvest this season  +6  a "Harvested …" line this tick (summer wheat/rye, autumn barley/oats)
 *   feast custom         +4  an active standing order that holds a feast for the people
 *   harsh custom         −5  Sunday labour, extra/heavy dues, corvée, work on feast days
 *   extra-day labour     −6 / −3  extra heads called vs the season's leftover pool
 *   war / muster         −8  flags.active_threat, or a muster event this tick
 *   mood modifiers       ×3  net `add` on target `mood` (blessings and event unease)
 *
 * Mid-season charity: a confirmed consume tagged as alms/charity nudges +3 at once.
 * Pressures are additive and listed in `peopleHappinessPressures` so tests can see them.
 */
export const PEOPLE_HAPPINESS_MIN = 0;
export const PEOPLE_HAPPINESS_MAX = 100;
export const PEOPLE_HAPPINESS_DEFAULT = 50;

export const HAPPINESS_HUNGER = -12;
export const HAPPINESS_GRAIN_AMPLE = 4;
export const HAPPINESS_GRAIN_ADEQUATE = 1;
export const HAPPINESS_GRAIN_SHORT = -6;
export const HAPPINESS_HARVEST = 6;
export const HAPPINESS_FEAST = 4;
export const HAPPINESS_HARSH = -5;
export const HAPPINESS_LABOUR_HEAVY = -6;
export const HAPPINESS_LABOUR_FIRM = -3;
export const HAPPINESS_WAR = -8;
export const HAPPINESS_MOOD_PER_ADD = 3;
export const HAPPINESS_ALMS = 3;

const GRAIN_AMPLE_SEASONS = 4;
const GRAIN_ADEQUATE_SEASONS = 2;
const LABOUR_HEAVY_RATIO = 0.85;
const LABOUR_FIRM_RATIO = 0.6;

export type HappinessPressureId =
  | "hunger"
  | "grain"
  | "harvest"
  | "feast"
  | "harsh"
  | "labour"
  | "war"
  | "mood";

export type HappinessPressure = { id: HappinessPressureId; delta: number };

export type PeopleHappinessExtras = {
  /** True when this season's agriculture actually brought grain in. */
  harvested?: boolean;
  /** True when a rolled event is a muster / local levy. */
  muster?: boolean;
};

export function peopleHappinessHallWord(value: number): "wretched" | "uneasy" | "settled" | "glad" | "joyful" {
  if (value <= 24) return "wretched";
  if (value <= 44) return "uneasy";
  if (value <= 55) return "settled";
  if (value <= 74) return "glad";
  return "joyful";
}

export function clampPeopleHappiness(n: number): number {
  return clamp(Math.round(n), PEOPLE_HAPPINESS_MIN, PEOPLE_HAPPINESS_MAX);
}

export function applyPeopleHappinessDelta(state: WorldState, delta: number): number {
  const current = state.peopleHappiness ?? PEOPLE_HAPPINESS_DEFAULT;
  state.peopleHappiness = clampPeopleHappiness(current + delta);
  return state.peopleHappiness;
}

/** Chaplain alms / charity from the stores — not tithe to the cell. */
export function looksLikeAlms(text: string): boolean {
  return /\b(alms|almsgiv|charity|the poor|paupers?|beggars?)\b/i.test(text);
}

export function standingOrderIsFeast(text: string): boolean {
  return (
    /\b(hold|keep|give|grant)s?\s+(a\s+)?(great\s+)?(religious\s+)?feast\b/i.test(text) ||
    /\bfeast for the (people|village|poor|hall)\b/i.test(text) ||
    /\bale[- ]giving\b/i.test(text)
  );
}

export function standingOrderIsHarsh(text: string): boolean {
  return /\b(corv[eé]e|extra dues|heavy dues|sunday (?:labour|labor|work)|work on (?:the )?(?:sabbath|sunday)|work on feast days|unpaid (?:labour|labor)|flog)\b/i.test(
    text,
  );
}

function grainCoverSeasons(state: WorldState): number {
  const need = Math.max(1, state.population.households) * HOUSEHOLD_SEASON_GRAIN;
  return grainOnHand(state) / need;
}

function labourCallRatio(state: WorldState): number {
  const pool = labourPool(state);
  const used = labourUsed(state);
  const poolHeads = pool.men + pool.women + pool.youths;
  if (poolHeads <= 0) return 0;
  const usedHeads = used.men + used.women + used.youths;
  return usedHeads / poolHeads;
}

function moodAddTotal(state: WorldState): number {
  let add = 0;
  for (const m of modifiersFor(state, "mood")) {
    if (m.effect.op === "add") add += m.effect.value;
  }
  return add;
}

export function peopleHappinessPressures(state: WorldState, extras: PeopleHappinessExtras = {}): HappinessPressure[] {
  const out: HappinessPressure[] = [];
  const push = (id: HappinessPressureId, delta: number) => {
    if (delta) out.push({ id, delta });
  };

  if (state.flags.hunger) push("hunger", HAPPINESS_HUNGER);
  else {
    const cover = grainCoverSeasons(state);
    if (cover >= GRAIN_AMPLE_SEASONS) push("grain", HAPPINESS_GRAIN_AMPLE);
    else if (cover >= GRAIN_ADEQUATE_SEASONS) push("grain", HAPPINESS_GRAIN_ADEQUATE);
    else if (cover < 1) push("grain", HAPPINESS_GRAIN_SHORT);
  }

  if (extras.harvested) push("harvest", HAPPINESS_HARVEST);

  const orders = state.standing_orders.filter((o) => o.active);
  if (orders.some((o) => standingOrderIsFeast(o.text))) push("feast", HAPPINESS_FEAST);
  if (orders.some((o) => standingOrderIsHarsh(o.text))) push("harsh", HAPPINESS_HARSH);

  const ratio = labourCallRatio(state);
  if (ratio >= LABOUR_HEAVY_RATIO) push("labour", HAPPINESS_LABOUR_HEAVY);
  else if (ratio >= LABOUR_FIRM_RATIO) push("labour", HAPPINESS_LABOUR_FIRM);

  if (state.flags.active_threat || extras.muster) push("war", HAPPINESS_WAR);

  const mood = moodAddTotal(state);
  if (mood) push("mood", Math.round(mood * HAPPINESS_MOOD_PER_ADD));

  return out;
}

export function peopleHappinessSeasonDelta(state: WorldState, extras: PeopleHappinessExtras = {}): number {
  return peopleHappinessPressures(state, extras).reduce((sum, p) => sum + p.delta, 0);
}

export function tickPeopleHappiness(state: WorldState, extras: PeopleHappinessExtras = {}): number {
  const delta = peopleHappinessSeasonDelta(state, extras);
  applyPeopleHappinessDelta(state, delta);
  return delta;
}

export function tickPeopleHappinessFromSeason(
  state: WorldState,
  seasonTexts: string[],
  events: { id: string; resolvedText?: string; text?: string }[],
): number {
  return tickPeopleHappiness(state, {
    harvested: seasonTexts.some((t) => /^Harvested /.test(t)),
    muster: events.some((ev) => /muster/i.test(ev.id) || /muster/i.test(ev.resolvedText ?? ev.text ?? "")),
  });
}
