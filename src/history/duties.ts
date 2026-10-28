import type { WorldState } from "../engine/schema";
import { createRng, seedFromString } from "../combat/rng";
import { deliverEvent, type DeliveryResult } from "./deliver";
import { applyFlagOp, flagTruthy } from "./flags";
import { historyContent } from "./load";
import type { SeasonAt } from "./scheduler";

/**
 * Royal vassal duties in quiet years (03_HISTORY §11.6; scripts "Royal vassal
 * duties"). Only for a lord commended directly to the king (`royal_vassal`,
 * which the promotion pass sets), in a season with no political event. One
 * roll of 1–10; the result is a rolled event D-001 … D-010 in duties.json, each
 * an Aldric line with its cost. Hosting the court (7) is a choice. Each duty
 * discharged adds to royal favour; the tick also settles the shirked ones.
 */

export const DUTY_IDS = ["D-001", "D-002", "D-003", "D-004", "D-005", "D-006", "D-007", "D-008", "D-009", "D-010"] as const;

/** A duty is skipped when the lord is away, dead, or a dated event of another kind has the season. */
export function dutiesAllowed(state: WorldState, politicalFired: boolean): boolean {
  if (!flagTruthy(state, "royal_vassal")) return false;
  if (state.history.dead || state.history.away) return false;
  if (politicalFired) return false;
  return true;
}

export function rollDuty(state: WorldState, at: SeasonAt, turn: number): number {
  const rng = createRng(seedFromString(`${state.meta.region}:duty:${at.year}:${at.season}:${turn}`));
  return rng.int(1, 10);
}

export function tickDuties(state: WorldState, at: SeasonAt, turn: number, politicalFired: boolean): DeliveryResult & { duty: string | null } {
  const out: DeliveryResult & { duty: string | null } = { beats: [], lines: [], duty: null };
  // Settle last season's hosting: the default was taken by expireDeadlines; a mean host loses favour.
  settleHosting(state, out.lines);
  if (!dutiesAllowed(state, politicalFired)) return out;
  if (state.history.duties.lastRollTurn === turn) return out;
  state.history.duties.lastRollTurn = turn;
  const roll = rollDuty(state, at, turn);
  const id = DUTY_IDS[roll - 1];
  const event = historyContent().byId.get(id);
  if (!event) return out;
  // Duties recur: clear the last visit so hooks and choices open again.
  delete state.history.hooksTaken[id];
  delete state.history.chosen[id];
  const r = deliverEvent(state, event, at, turn);
  out.beats.push(...r.beats);
  out.lines.push(...r.lines);
  out.duty = id;
  if (roll > 1 && roll !== 7) {
    state.history.duties.favour += 1;
    applyFlagOp(state, "duty_performed", "+1");
    out.lines.push(`Royal duty discharged (${event.title}); the king's favour grows a little.`);
  }
  return out;
}

function settleHosting(state: WorldState, lines: string[]) {
  const chosen = state.history.chosen["D-007"];
  const fired = state.history.fired["D-007"];
  if (!chosen || !fired || state.history.duties.hostingSettledTurn === fired.turn) return;
  if (state.history.openChoices.some((c) => c.eventId === "D-007")) return;
  state.history.duties.hostingSettledTurn = fired.turn;
  if (chosen === "meanly") {
    state.history.duties.favour -= 2;
    applyFlagOp(state, "duty_shirked", "+1");
    lines.push("The court was hosted meanly; the king's favour falls.");
  } else {
    state.history.duties.favour += chosen === "lavishly" ? 2 : 1;
    applyFlagOp(state, "duty_performed", "+1");
    lines.push("The court was hosted; the king's favour grows.");
  }
}

/** One line for the prompt. */
export function dutiesLine(state: WorldState): string | null {
  if (!flagTruthy(state, "royal_vassal")) return null;
  const f = state.history.duties.favour;
  const word = f >= 6 ? "high" : f >= 2 ? "good" : f <= -3 ? "poor" : "ordinary";
  return `The lord is the king's own vassal; his standing at court is ${word}. Quiet seasons bring the king's small duties.`;
}
