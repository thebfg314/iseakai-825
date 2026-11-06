import type { SettleHouseholdsProposal, WorldState } from "./schema";
import { PEOPLE_JOYFUL_MIN, PEOPLE_WRETCHED_MAX } from "./peopleHappiness";

/**
 * Extreme-happiness population movement.
 *
 * After each Advance season's happiness tick:
 * - Joyful (≥75) increments `peopleHappinessHighStreak` and clears the low streak.
 * - Wretched (≤24) increments `peopleHappinessLowStreak` and clears the high streak.
 * - Anything in between clears both.
 *
 * Arrivals (joyful streak ≥ 2): chance 15% on the second consecutive season, +15%
 * per further season, capped at 45%. Queued as Confirm (`settle_households`) —
 * the player may take them in or turn them away. Unconfirmed, they lapse on the
 * next Advance like other orders.
 *
 * Departures (wretched streak ≥ 2): chance 20% / +20% / cap 55%. Applied at once;
 * no Confirm. Unhappy people may keep leaving until the holding is empty. When no
 * households or working-age people remain, the villa is abandoned (game over).
 *
 * Old saves omit the streak fields and `estateAbandoned`; Zod defaults them.
 */

export const ARRIVAL_STREAK_MIN = 2;
export const ARRIVAL_CHANCE_PER_SEASON = 0.15;
export const ARRIVAL_CHANCE_CAP = 0.45;

export const DEPARTURE_STREAK_MIN = 2;
export const DEPARTURE_CHANCE_PER_SEASON = 0.2;
export const DEPARTURE_CHANCE_CAP = 0.55;

/** One working-age family seeking a place (or slipping away). */
export const FAMILY_HEADS = { households: 1, adult_men: 1, adult_women: 1, youths: 1 } as const;

export const ARRIVAL_SUMMARY = "A family seeks a place among the demesne people.";
export const ARRIVAL_SEASON_NOTE =
  "A family has come seeking a place on the demesne. Confirm if you will have them.";
export const ARRIVAL_CONFIRM_LINE = "A household has taken its place among the demesne people.";
export const ARRIVAL_REFUSE_LINE = "You turned the family away.";
export const DEPARTURE_SEASON_NOTE = "In the night a household slipped away from the demesne.";
export const ABANDONED_GAME_OVER =
  "The demesne people are gone. The villa stands empty. There is no one left to work the land.";

export type PopulationDelta = {
  households: number;
  adult_men: number;
  adult_women: number;
  youths: number;
};

export type PeopleMovementResult = {
  arrival?: SettleHouseholdsProposal;
  arrivalNote?: string;
  departureNote?: string;
  abandoned?: boolean;
  gameOverNote?: string;
  /** The villas stand empty but the play goes on (a lord with rank; the caller decides what that costs). */
  emptied?: boolean;
};

export function arrivalChance(streak: number): number {
  if (streak < ARRIVAL_STREAK_MIN) return 0;
  return Math.min(ARRIVAL_CHANCE_CAP, Math.round(ARRIVAL_CHANCE_PER_SEASON * (streak - ARRIVAL_STREAK_MIN + 1) * 100) / 100);
}

export function departureChance(streak: number): number {
  if (streak < DEPARTURE_STREAK_MIN) return 0;
  return Math.min(DEPARTURE_CHANCE_CAP, Math.round(DEPARTURE_CHANCE_PER_SEASON * (streak - DEPARTURE_STREAK_MIN + 1) * 100) / 100);
}

export function workingAgeHeads(state: WorldState): number {
  return state.population.adult_men + state.population.adult_women + state.population.youths;
}

/** No households, or no working-age people left to work the villa. */
export function estateIsAbandoned(state: WorldState): boolean {
  return state.population.households <= 0 || workingAgeHeads(state) <= 0;
}

/**
 * Whether an empty villa ends the play. For a minor noble it does: there is nothing else.
 * A viscount falls back to minor noble with what remains; a count or above goes on, poorer,
 * and the ending, if it comes, comes politically (history/mishaps.ts).
 */
export function depopulationEnds(state: WorldState): boolean {
  return (state.player.rankLevel ?? 1) < 2;
}

/** The play is over for want of people: marked already, or empty with no rank to fall back on. */
export function estateEnded(state: WorldState): boolean {
  return Boolean(state.estateAbandoned) || (estateIsAbandoned(state) && depopulationEnds(state));
}

export function markEstateAbandoned(state: WorldState): boolean {
  if (!estateIsAbandoned(state)) return false;
  state.estateAbandoned = true;
  return true;
}

export function tickHappinessStreaks(state: WorldState): { high: number; low: number } {
  const h = state.peopleHappiness ?? 50;
  if (h >= PEOPLE_JOYFUL_MIN) {
    state.peopleHappinessHighStreak = (state.peopleHappinessHighStreak ?? 0) + 1;
    state.peopleHappinessLowStreak = 0;
  } else if (h <= PEOPLE_WRETCHED_MAX) {
    state.peopleHappinessLowStreak = (state.peopleHappinessLowStreak ?? 0) + 1;
    state.peopleHappinessHighStreak = 0;
  } else {
    state.peopleHappinessHighStreak = 0;
    state.peopleHappinessLowStreak = 0;
  }
  return { high: state.peopleHappinessHighStreak, low: state.peopleHappinessLowStreak };
}

export function applyPopulationDelta(state: WorldState, delta: PopulationDelta): void {
  state.population.households = Math.max(0, state.population.households + delta.households);
  state.population.adult_men = Math.max(0, state.population.adult_men + delta.adult_men);
  state.population.adult_women = Math.max(0, state.population.adult_women + delta.adult_women);
  state.population.youths = Math.max(0, state.population.youths + delta.youths);
  const home = state.holdings[0];
  if (home) home.households = Math.max(0, home.households + delta.households);
}

export function canDepartHousehold(state: WorldState): boolean {
  return state.population.households > 0 || workingAgeHeads(state) > 0;
}

export function departureDelta(state: WorldState): PopulationDelta | null {
  if (!canDepartHousehold(state)) return null;
  return {
    households: state.population.households > 0 ? -1 : 0,
    adult_men: state.population.adult_men > 0 ? -1 : 0,
    adult_women: state.population.adult_women > 0 ? -1 : 0,
    youths: state.population.youths > 0 ? -1 : 0,
  };
}

export function makeArrivalProposal(): SettleHouseholdsProposal {
  return {
    type: "settle_households",
    summary: ARRIVAL_SUMMARY,
    ...FAMILY_HEADS,
  };
}

export function applySettleHouseholds(state: WorldState, p: SettleHouseholdsProposal): string {
  applyPopulationDelta(state, {
    households: p.households,
    adult_men: p.adult_men,
    adult_women: p.adult_women,
    youths: p.youths,
  });
  return ARRIVAL_CONFIRM_LINE;
}

function abandonedResult(extra: PeopleMovementResult = {}): PeopleMovementResult {
  return { ...extra, abandoned: true, gameOverNote: ABANDONED_GAME_OVER };
}

/**
 * Update streaks from current happiness, then maybe apply a departure or offer an arrival.
 * Does not queue Confirm itself — the session layer does that.
 */
export function resolvePeopleMovement(state: WorldState, rng: () => number = Math.random): PeopleMovementResult {
  const ends = depopulationEnds(state);
  if (state.estateAbandoned) return abandonedResult();
  if (estateIsAbandoned(state)) {
    if (!ends) return { emptied: true };
    markEstateAbandoned(state);
    return abandonedResult();
  }
  tickHappinessStreaks(state);
  const leaveAt = departureChance(state.peopleHappinessLowStreak ?? 0);
  if (leaveAt > 0 && rng() < leaveAt) {
    const delta = departureDelta(state);
    if (delta) {
      applyPopulationDelta(state, delta);
      if (estateIsAbandoned(state)) {
        if (!ends) return { departureNote: DEPARTURE_SEASON_NOTE, emptied: true };
        markEstateAbandoned(state);
        return abandonedResult({ departureNote: DEPARTURE_SEASON_NOTE });
      }
      return { departureNote: DEPARTURE_SEASON_NOTE };
    }
  }
  const joinAt = arrivalChance(state.peopleHappinessHighStreak ?? 0);
  if (joinAt > 0 && rng() < joinAt) {
    return { arrival: makeArrivalProposal(), arrivalNote: ARRIVAL_SEASON_NOTE };
  }
  return {};
}
