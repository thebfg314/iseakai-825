import type { WorldState } from "../engine/schema";
import table from "../../data/history/tables/forced-weather.json";
import type { SeasonAt } from "./scheduler";

/**
 * Forced weather (scripts: 'Forced weather events'; 03_HISTORY §11.4). In a
 * historical famine season the weather is not rolled: the named catalog entry
 * replaces it and its crop effect is doubled. Improvements already on the
 * ground pull the doubled effect back toward normal, a quarter each.
 */

export function forcedWeatherFor(at: SeasonAt): string | null {
  for (const row of table.forced) {
    const [from, to] = row.years;
    if (at.year < from || at.year > to) continue;
    const id = (row.seasons as Record<string, string | undefined>)[at.season];
    if (id) return id;
  }
  return null;
}

/** Which of the four protective improvements the villa has in place. */
export function improvementsPresent(state: WorldState): string[] {
  const out: string[] = [];
  const home = state.holdings[0];
  if (state.projects.some((p) => p.key === "drain_swamp" && p.status === "completed")) out.push("drainage");
  if (state.agriculture?.rotation === "three_field") out.push("three_field");
  if (state.holdings.some((h) => h.features.includes("barn") || h.features.includes("granary"))) out.push("barn");
  const sown = home ? home.sown : { wheat: 0, rye: 0, barley: 0, oats: 0 };
  const total = sown.wheat + sown.rye + sown.barley + sown.oats;
  if (total > 0 && (sown.rye + sown.barley + sown.oats) / total >= 0.6) out.push("hardy_grains");
  return out;
}

/** 2 for an unimproved villa; each improvement removes a quarter of the extra. */
export function forcedSeverity(state: WorldState): number {
  const n = improvementsPresent(state).length;
  return 1 + Math.max(0, 1 - n * 0.25);
}

/** Set the season's forced weather on the history state; the controller passes the id to the roll. */
export function tickWeather(state: WorldState, at: SeasonAt): { forcedWeatherId: string | null; severity: number } {
  const id = forcedWeatherFor(at);
  state.history.weather.forcedThisSeason = id;
  state.history.weather.forcedSeverity = id ? forcedSeverity(state) : 1;
  return { forcedWeatherId: id, severity: state.history.weather.forcedSeverity };
}
