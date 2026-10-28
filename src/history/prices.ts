import type { WorldState } from "../engine/schema";
import table from "../../data/history/tables/forced-weather.json";
import type { SeasonAt } from "./scheduler";

/**
 * Famine prices (scripts: 'Food prices'; 03_HISTORY §11.4). The famine calendar
 * sets a severity by year; an event may override it for a few seasons. Grain
 * bands in `state.market` are the baseline times the multiplier, with the cheap
 * grains rising most, and `flags.regional_famine` follows the severity.
 */

export type Severity = "normal" | "shortage" | "famine" | "severe";
const GRAINS = ["wheat", "rye", "barley", "oats"] as const;
const RANK: Record<Severity, number> = { normal: 0, shortage: 1, famine: 2, severe: 3 };

export function calendarSeverity(year: number): Severity {
  const byYear = table.famineYears as Record<string, Severity>;
  return byYear[String(year)] ?? "normal";
}

export function severityAt(state: WorldState, at: SeasonAt, turn: number): Severity {
  const p = state.history.prices;
  if (p.eventSeverity && (p.untilTurn === null || p.untilTurn >= turn)) {
    const cal = calendarSeverity(at.year);
    return RANK[p.eventSeverity] >= RANK[cal] ? p.eventSeverity : cal;
  }
  if (p.eventSeverity && p.untilTurn !== null && p.untilTurn < turn) p.eventSeverity = null;
  return calendarSeverity(at.year);
}

export function grainMultiplier(severity: Severity, grain: string): number {
  const base = (table.multipliers as Record<string, number>)[severity] ?? 1;
  if (severity === "normal" || severity === "shortage") return base;
  const skew = (table.grainSkew as Record<string, number>)[grain] ?? 1;
  return base * skew;
}

/** Bring the grain bands to the season's severity. Returns a ledger line when something changed. */
export function tickPrices(state: WorldState, at: SeasonAt, turn: number): string | null {
  const p = state.history.prices;
  const severity = severityAt(state, at, turn);
  const was = p.severity;
  if (severity === "normal") {
    if (was === "normal") return null;
    for (const g of GRAINS) if (p.base[g]) state.market[g] = { ...p.base[g] };
    p.base = {};
    p.severity = "normal";
    p.grainMultiplier = 1;
    state.flags.regional_famine = false;
    return "Grain prices in Autun have come back to their old level.";
  }
  if (!Object.keys(p.base).length) {
    for (const g of GRAINS) if (state.market[g]) p.base[g] = { ...state.market[g] };
  }
  for (const g of GRAINS) {
    const b = p.base[g];
    if (!b) continue;
    const m = grainMultiplier(severity, g);
    state.market[g] = { min: Math.round(b.min * m), max: Math.round(b.max * m) };
  }
  p.severity = severity;
  p.grainMultiplier = (table.multipliers as Record<string, number>)[severity] ?? 1;
  state.flags.regional_famine = severity === "famine" || severity === "severe";
  if (was === severity) return null;
  const word = severity === "shortage" ? "two or three times" : severity === "famine" ? "four to eight times" : "ten to thirty times";
  return `Grain in Autun sells at ${word} the old price (${severity}).`;
}

/** Seed eaten: two hungry seasons running cut next year's sowing by a tenth (03_HISTORY §11.4 debuffs). */
export function tickHungerDebuffs(state: WorldState): string | null {
  const p = state.history.prices;
  if (state.flags.hunger) p.hungrySeasons += 1;
  else p.hungrySeasons = 0;
  if (p.hungrySeasons === 2) {
    state.modifiers.push({
      id: `hist_seed_${state.meta.turn}`,
      target: "grain_yield",
      kind: "temporary",
      seasons_remaining: 4,
      effect: { op: "multiply", value: 0.9 },
      source: "seed eaten in a hungry winter",
    });
    return "The households have eaten into next year's seed; the coming harvest will be a tenth short.";
  }
  return null;
}

/** One line for the household about the market. */
export function pricesLine(state: WorldState): string | null {
  const p = state.history.prices;
  if (p.severity === "normal") return null;
  const wheat = state.market.wheat;
  return `Famine prices (${p.severity}): wheat ${wheat ? `${wheat.min}–${wheat.max}` : "dear"} d a modius in Autun; the cheap grains have risen most.`;
}
