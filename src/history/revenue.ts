import type { WorldState } from "../engine/schema";
import type { HistoryBeat } from "./deliver";
import { currentRank } from "./promotion";
import { rankStep, ranksTable } from "./ranks";
import type { SeasonAt } from "./scheduler";

/**
 * Public revenue (rank progression doc, "Count" and above; the viscount's deputy's share and court
 * fines below that). Paid into the chest each season as a quarter of the yearly figures held on the
 * county blocks. Tolls and market dues move with trade health (step 2); the pleas with the justice
 * stance (step 4); Autun's tolls run +40% for the Saône road.
 */

export type RevenueTick = { lines: string[]; beats: HistoryBeat[] };

export const TRADE_BASELINE = 55;

/** Tolls and market dues scale with trade health against the 825 baseline, within 0.4–1.6. */
export function tradeMultiplier(state: WorldState): number {
  const health = state.history.trade?.health ?? TRADE_BASELINE;
  return Math.max(0.4, Math.min(1.6, health / TRADE_BASELINE));
}

/** Fines and pleas: 1 until the justice stance (step 4) says otherwise. */
export function justiceMultiplier(_state: WorldState): number {
  return 1;
}

export type RevenueBreakdown = { tolls: number; market: number; justice: number; fisc: number; mint: number; deputy: number; fines: number; officers: number; net: number };

/** What the office would pay this season at the current state. */
export function seasonRevenue(state: WorldState): RevenueBreakdown {
  const r = currentRank(state);
  const out: RevenueBreakdown = { tolls: 0, market: 0, justice: 0, fisc: 0, mint: 0, deputy: 0, fines: 0, officers: 0, net: 0 };
  if (r < 2) return out;
  const trade = tradeMultiplier(state);
  const justice = justiceMultiplier(state);
  const autun = ranksTable().autun;
  if (r === 2) {
    const office = rankStep(2)?.office;
    if (office) {
      out.deputy = office.deputyShare / 4;
      out.fines = (office.courtFines * justice) / 4;
    }
  } else {
    // A count judges the pleas himself; the deputy's share folds into the county's justice line.
    for (const c of state.history.rank.counties) {
      const tollsBoost = c.name === "Autun" ? autun.tollsMultiplier : 1;
      out.tolls += (c.yearly.tolls * trade * tollsBoost) / 4;
      out.market += (c.yearly.market * trade) / 4;
      out.justice += (c.yearly.justice * justice) / 4;
      out.fisc += c.yearly.fisc / 4;
      out.officers += c.yearly.officers / 4;
    }
    out.mint = state.history.rank.mint / 4;
    if (state.history.rank.royalFisc) out.fisc += state.history.rank.royalFisc.yearly / 4;
  }
  const gross = out.tolls + out.market + out.justice + out.fisc + out.mint + out.deputy + out.fines;
  out.net = Math.round(gross - out.officers);
  for (const k of Object.keys(out) as (keyof RevenueBreakdown)[]) out[k] = Math.round(out[k]);
  return out;
}

export function tickRevenue(state: WorldState, _at: SeasonAt, turn: number): RevenueTick {
  const out: RevenueTick = { lines: [], beats: [] };
  const rank = state.history.rank;
  if (currentRank(state) < 2) {
    rank.lastRevenue = null;
    return out;
  }
  // The Chalon mint pays from 864 once a duke holds the county.
  const dukeStep = rankStep(4);
  if (dukeStep?.mint && currentRank(state) >= 4 && state.meta.year >= ranksTable().autun.mintFromYear && rank.counties.some((c) => c.name === "Chalon") && rank.mint === 0) {
    rank.mint = dukeStep.mint;
    out.lines.push("The mint at Chalon pays its share to the lord from this year.");
  }
  const rev = seasonRevenue(state);
  if (rev.net === 0 && rev.officers === 0) return out;
  state.resources.denarii = Math.max(0, Math.round(state.resources.denarii + rev.net));
  rank.lastRevenue = { turn, ...rev };
  const parts: string[] = [];
  if (rev.tolls) parts.push(`tolls ${rev.tolls}`);
  if (rev.market) parts.push(`market ${rev.market}`);
  if (rev.justice) parts.push(`pleas ${rev.justice}`);
  if (rev.fisc) parts.push(`fisc ${rev.fisc}`);
  if (rev.mint) parts.push(`mint ${rev.mint}`);
  if (rev.deputy) parts.push(`deputy's share ${rev.deputy}`);
  if (rev.fines) parts.push(`court fines ${rev.fines}`);
  if (rev.officers) parts.push(`officers' pay −${rev.officers}`);
  out.lines.push(`The office paid ${rev.net} d into the chest this season (${parts.join(", ")}).`);
  return out;
}
