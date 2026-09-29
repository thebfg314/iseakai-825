import type { WorldState } from "./schema";
import { grainOnHand, HOUSEHOLD_SEASON_GRAIN } from "./grain";
import { labourPool, labourUsed } from "./labour";
import { modifiersFor } from "./modifiers";
import { clamp } from "./util";

/**
 * Estate-wide people's happiness (the hall meter). This is the one morale stock.
 *
 * Durable 0–100. Old saves omit the field; Zod defaults it to 50 (settled).
 *
 * Modifier target `mood` does **not** multiply yield or callable labour. Confirming
 * `add_modifier` on mood nudges this meter at once. Active mood modifiers (including
 * old saves and event `moodDelta`) also feed the season tick below, so a lasting
 * blessing keeps hearts up until `seasons_remaining` runs out. Event mood swings
 * are not applied twice: they only write the modifier, and this tick reads it.
 *
 * Hidden effort (not shown on the books, not named in season lines):
 *   0 wretched → 0.90,  50 settled → 1.00,  100 joyful → 1.10  (linear).
 * Same assigned heads/hours; harvest, herds, and project progress simply come out
 * better or worse. Callable labour pool is unchanged.
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
 *   TODO: a requiem or funeral mass could soften this after dead levies. Not built.
 *   mood modifiers       mapped add/multiply/set on target `mood` (blessings, unease)
 *
 * Mid-season charity: a confirmed consume tagged as alms/charity nudges +3 at once.
 * Pressures are additive and listed in `peopleHappinessPressures` so tests can see them.
 */
export const PEOPLE_HAPPINESS_MIN = 0;
export const PEOPLE_HAPPINESS_MAX = 100;
export const PEOPLE_HAPPINESS_DEFAULT = 50;
/** Hall word “joyful” — arrivals roll after a streak at or above this. */
export const PEOPLE_JOYFUL_MIN = 75;
/** Hall word “wretched” — departures roll after a streak at or below this. */
export const PEOPLE_WRETCHED_MAX = 24;

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

/** Quiet yield / project-progress multiplier at happiness 0 (wretched). */
export const PEOPLE_EFFORT_AT_ZERO = 0.9;
/** Quiet multiplier at happiness 100 (joyful). Settled (50) is exactly 1. */
export const PEOPLE_EFFORT_AT_HUNDRED = 1.1;

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
  if (value <= PEOPLE_WRETCHED_MAX) return "wretched";
  if (value <= 44) return "uneasy";
  if (value <= 55) return "settled";
  if (value < PEOPLE_JOYFUL_MIN) return "glad";
  return "joyful";
}

export function clampPeopleHappiness(n: number): number {
  return clamp(Math.round(n), PEOPLE_HAPPINESS_MIN, PEOPLE_HAPPINESS_MAX);
}

/**
 * Hidden effort from the people's heart. Does not change callable heads or the
 * labour assignment ledger. Modest: wretched work a little slack, joyful a little
 * harder — not a second yield dial beside mood modifiers.
 */
export function peopleEffortFactor(state: WorldState): number {
  const h = clamp(state.peopleHappiness ?? PEOPLE_HAPPINESS_DEFAULT, PEOPLE_HAPPINESS_MIN, PEOPLE_HAPPINESS_MAX);
  return PEOPLE_EFFORT_AT_ZERO + (h / PEOPLE_HAPPINESS_MAX) * (PEOPLE_EFFORT_AT_HUNDRED - PEOPLE_EFFORT_AT_ZERO);
}

/** Map a mood-targeted effect onto a happiness delta. +1 add → +3 (one modest blessing). */
export function moodEffectToHappinessDelta(effect: { op: "add" | "multiply" | "set"; value: number }): number {
  if (effect.op === "add") return Math.round(effect.value * HAPPINESS_MOOD_PER_ADD);
  return Math.round((effect.value - 1) * 100);
}

/** Confirming a mood custom: the meter moves now. Seasonal tick still reads the modifier later. */
export function applyMoodModifierToHappiness(state: WorldState, effect: { op: "add" | "multiply" | "set"; value: number }): number {
  return applyPeopleHappinessDelta(state, moodEffectToHappinessDelta(effect));
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

function moodModifiersHappinessDelta(state: WorldState): number {
  let delta = 0;
  for (const m of modifiersFor(state, "mood")) {
    delta += moodEffectToHappinessDelta(m.effect);
  }
  return delta;
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

  const mood = moodModifiersHappinessDelta(state);
  if (mood) push("mood", mood);

  return out;
}

export function peopleHappinessSeasonDelta(state: WorldState, extras: PeopleHappinessExtras = {}): number {
  return peopleHappinessPressures(state, extras).reduce((sum, p) => sum + p.delta, 0);
}

/**
 * On the Advance after a sponsored feast, half the joy that was given cools.
 * The other half has already stayed in the meter. Does nothing when no feast is cooling.
 */
export function fadeSponsoredFeastJoy(state: WorldState): number {
  const fade = state.church?.feastFade ?? 0;
  if (fade <= 0) return 0;
  state.church.feastFade = 0;
  applyPeopleHappinessDelta(state, -fade);
  return fade;
}

export function tickPeopleHappiness(state: WorldState, extras: PeopleHappinessExtras = {}): number {
  fadeSponsoredFeastJoy(state);
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
