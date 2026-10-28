import type { WorldState } from "../engine/schema";
import dukeTrackFile from "../../data/history/tables/duke-track.json";
import type { HistoryBeat } from "./deliver";
import { applyFlagOp, flagTruthy } from "./flags";
import { seasonOrdinal } from "./load";
import type { SeasonAt } from "./scheduler";

/**
 * Richard the Justiciar as the lord's standing rival (03_HISTORY §11.10; scripts
 * "The Duke track"). Each opportunity on the menu has a deadline. The season
 * after it passes, if the lord has not taken it (its playerFlag is unset),
 * Richard takes it: `richard_standing` rises by one and Aldric says so. The
 * opportunities themselves are hooks on the dated events, gated to Duke rank
 * for the promotion pass; until then every one of them goes to Richard, which
 * is history.
 */

export type DukeOpportunity = {
  id: string;
  year: number;
  deadline: { year: number; season: SeasonAt["season"] };
  playerFlag: string;
  label: string;
  buys: string;
  ifRichard: string;
  richardLine: string;
};

type DukeTrack = { opportunities: DukeOpportunity[]; scoring: Array<{ min: number; result: string }> };
const TRACK = dukeTrackFile as unknown as DukeTrack;

export function dukeOpportunities(): DukeOpportunity[] {
  return TRACK.opportunities;
}

export function tickRichard(state: WorldState, incoming: SeasonAt): { beats: HistoryBeat[]; lines: string[] } {
  const beats: HistoryBeat[] = [];
  const lines: string[] = [];
  const now = seasonOrdinal(incoming.year, incoming.season);
  for (const opp of TRACK.opportunities) {
    if (seasonOrdinal(opp.deadline.year, opp.deadline.season) + 1 !== now) continue;
    if (state.history.richard.taken.includes(opp.id)) continue;
    if (flagTruthy(state, opp.playerFlag)) continue;
    state.history.richard.taken.push(opp.id);
    applyFlagOp(state, "richard_standing", "+1");
    lines.push(`Richard took what the lord did not: ${opp.label.toLowerCase()} (richard_standing +1).`);
    beats.push({ npcId: "steward", eventId: `richard:${opp.id}`, text: opp.richardLine });
    state.history.record.push({ year: incoming.year, season: incoming.season, text: `Richard: ${opp.ifRichard}.`, thread: "richard" });
  }
  return { beats, lines };
}

/** How many of the menu the lord took himself. */
export function dukeTrackScore(state: WorldState): { taken: number; of: number; result: string } {
  const taken = TRACK.opportunities.filter((o) => flagTruthy(state, o.playerFlag)).length;
  const band = [...TRACK.scoring].sort((a, b) => b.min - a.min).find((s) => taken >= s.min) ?? TRACK.scoring[TRACK.scoring.length - 1];
  return { taken, of: TRACK.opportunities.length, result: band.result };
}

/** One line for the prompt once Richard has begun to build. */
export function richardLine(state: WorldState): string | null {
  const n = state.history.richard.taken.length;
  if (n === 0) return null;
  const mine = dukeTrackScore(state).taken;
  return `Richard of Autun has taken ${n} of the chances that build a principality${mine > 0 ? `; the lord took ${mine}` : ""}: the region looks more to him with each.`;
}
