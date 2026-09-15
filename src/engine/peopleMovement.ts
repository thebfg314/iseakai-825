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
 * no Confirm. Households and working-age people fall, never below the floor.
 *
 * Old saves omit the streak fields; Zod defaults them to 0.
 */

export const PEOPLE_HOUSEHOLD_FLOOR = 4;
export const PEOPLE_MEN_FLOOR = 4;
export const PEOPLE_WOMEN_FLOOR = 4;
export const PEOPLE_YOUTH_FLOOR = 2;

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
};

export function arrivalChance(streak: number): number {
  if (streak < ARRIVAL_STREAK_MIN) return 0;
  return Math.min(ARRIVAL_CHANCE_CAP, Math.round(ARRIVAL_CHANCE_PER_SEASON * (streak - ARRIVAL_STREAK_MIN + 1) * 100) / 100);
}

export function departureChance(streak: number): number {
  if (streak < DEPARTURE_STREAK_MIN) return 0;
  return Math.min(DEPARTURE_CHANCE_CAP, Math.round(DEPARTURE_CHANCE_PER_SEASON * (streak - DEPARTURE_STREAK_MIN + 1) * 100) / 100);
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
  return (
    state.population.households > PEOPLE_HOUSEHOLD_FLOOR &&
    state.population.adult_men > PEOPLE_MEN_FLOOR &&
    state.population.adult_women > PEOPLE_WOMEN_FLOOR
  );
}

export function departureDelta(state: WorldState): PopulationDelta | null {
  if (!canDepartHousehold(state)) return null;
  const youths = state.population.youths > PEOPLE_YOUTH_FLOOR ? -1 : 0;
  return { households: -1, adult_men: -1, adult_women: -1, youths };
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

/**
 * Update streaks from current happiness, then maybe apply a departure or offer an arrival.
 * Does not queue Confirm itself — the session layer does that.
 */
export function resolvePeopleMovement(state: WorldState, rng: () => number = Math.random): PeopleMovementResult {
  tickHappinessStreaks(state);
  const leaveAt = departureChance(state.peopleHappinessLowStreak ?? 0);
  if (leaveAt > 0 && rng() < leaveAt) {
    const delta = departureDelta(state);
    if (delta) {
      applyPopulationDelta(state, delta);
      return { departureNote: DEPARTURE_SEASON_NOTE };
    }
  }
  const joinAt = arrivalChance(state.peopleHappinessHighStreak ?? 0);
  if (joinAt > 0 && rng() < joinAt) {
    return { arrival: makeArrivalProposal(), arrivalNote: ARRIVAL_SEASON_NOTE };
  }
  return {};
}
