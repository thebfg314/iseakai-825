import { createRng, seedFromString } from "../combat/rng";
import { applyPeopleHappinessDelta } from "../engine/peopleHappiness";
import type { WorldState } from "../engine/schema";
import { applyFlagOp } from "./flags";
import { bishopIsSeparate, hundredValue } from "./standing";

/**
 * Church patronage.
 *
 * A gesture that is generous at one rank is merely expected at the next.
 * It keeps warming the tenants. It stops moving the church.
 *
 * Devotion (the feast already in the church year) is cheap and repeatable.
 * An endowment is expensive and, once, large. A purchase buys an outcome
 * and can leave simony alleged, which does not fade.
 *
 * The bishop of Autun is not a man in the hall. Ermenald carries him.
 * From Count on, the bishop's own number is what makes a ban quick or slow.
 */

export type EndowmentKind = "repair" | "chapel" | "monastery" | "major_house" | "immunity";
export type PurchaseAim = "judgment" | "support" | "annulment" | "absolution";

const ENDOWMENT: Record<EndowmentKind, { denarii: number; church: number; flag: string; word: string; movesThroughRank: number }> = {
  repair: { denarii: 40, church: 4, flag: "church_repaired", word: "the church repaired and furnished", movesThroughRank: 2 },
  chapel: { denarii: 120, church: 8, flag: "chapel_endowed", word: "a chapel endowed", movesThroughRank: 3 },
  monastery: { denarii: 400, church: 12, flag: "monastery_founded", word: "a monastery founded", movesThroughRank: 4 },
  major_house: { denarii: 800, church: 16, flag: "major_house", word: "a great house founded and endowed", movesThroughRank: 5 },
  immunity: { denarii: 100, church: 6, flag: "immunity_confirmed", word: "an immunity confirmed", movesThroughRank: 5 },
};

const PURCHASE: Record<PurchaseAim, { denarii: number; word: string; risk: number }> = {
  judgment: { denarii: 40, word: "a judgement bent his way", risk: 0.45 },
  support: { denarii: 80, word: "the bishop's support bought", risk: 0.4 },
  annulment: { denarii: 100, word: "an annulment bought", risk: 0.5 },
  absolution: { denarii: 60, word: "absolution bought", risk: 0.55 },
};

function rankOf(state: WorldState): number {
  return Math.max(1, Math.min(5, state.player.rankLevel ?? 1));
}

/** True when this act is still above what the rank is merely expected to do. */
export function endowmentMovesChurch(rank: number, kind: EndowmentKind): boolean {
  return rank <= ENDOWMENT[kind].movesThroughRank;
}

/**
 * The feast-day ritual. At a minor noble it moves the church.
 * From viscount on it is expected: the tenants still take heart, the church does not.
 */
export function devotionChurchGain(state: WorldState, tier: "plain" | "grand"): number {
  if (rankOf(state) > 1) return 0;
  return tier === "grand" ? 2 : 1;
}

export function applyDevotionChurch(state: WorldState, tier: "plain" | "grand"): string {
  const gain = devotionChurchGain(state, tier);
  if (gain <= 0) return " The church expects the feast now. It warms the people, and not the bishop.";
  applyFlagOp(state, "favor_church", `+${gain}`);
  return "";
}

export function endow(state: WorldState, kind: EndowmentKind): { ok: true; line: string } | { ok: false; line: string } {
  const row = ENDOWMENT[kind];
  if (!row) return { ok: false, line: "That is not an endowment the church is asking." };
  if (state.history.flags[row.flag] === true) return { ok: false, line: `The hall has already given ${row.word}.` };
  if (state.resources.denarii < row.denarii) return { ok: false, line: `The chest has not the ${row.denarii} denarii for ${row.word}.` };
  state.resources.denarii = Math.round(state.resources.denarii - row.denarii);
  state.history.flags[row.flag] = true;
  const moves = endowmentMovesChurch(rankOf(state), kind);
  if (moves) applyFlagOp(state, "favor_church", `+${row.church}`);
  else applyPeopleHappinessDelta(state, 2);
  const heard = moves
    ? `The church will remember ${row.word}.`
    : `At this rank ${row.word} is what is expected. The people notice. The church does not move.`;
  return { ok: true, line: `${row.word[0].toUpperCase()}${row.word.slice(1)} (${row.denarii} d). ${heard}` };
}

export function purchase(state: WorldState, aim: PurchaseAim, roll?: number): { ok: true; line: string } | { ok: false; line: string } {
  const row = PURCHASE[aim];
  if (!row) return { ok: false, line: "The church is not selling that." };
  if (aim === "absolution" && state.history.flags.excommunicated !== true) {
    return { ok: false, line: "He is not under the ban." };
  }
  if (state.resources.denarii < row.denarii) return { ok: false, line: `The chest has not the ${row.denarii} denarii.` };
  state.resources.denarii = Math.round(state.resources.denarii - row.denarii);

  if (aim === "judgment") state.history.flags.purchased_judgment = true;
  if (aim === "support") {
    state.history.flags.bishop_support = true;
    if (bishopIsSeparate(state)) applyFlagOp(state, "bishop_trust", "+8");
    else applyFlagOp(state, "favor_church", "+4");
  }
  if (aim === "annulment") state.history.flags.annulment_bought = true;
  if (aim === "absolution") state.history.flags.excommunicated = false;

  const rng = roll ?? createRng(seedFromString(`${state.meta.region}:simony:${state.meta.turn}:${aim}`)).float();
  let stain = "";
  if (rng < row.risk) {
    state.history.flags.simony_alleged = true;
    stain = " It will be said he bought the church, and his enemies will not let that die.";
  }
  return { ok: true, line: `Paid ${row.denarii} d for ${row.word}.${stain}` };
}

/**
 * Seasons the warning must stand before a ban, once the bishop is his own man.
 * A cold bishop hurries it. A warm one delays it. A fast friend will not arrange it.
 */
export function excommunicationWait(state: WorldState, base: number): number {
  if (!bishopIsSeparate(state) || state.history.flags.bishop_tracked !== true) return base;
  const bishop = hundredValue(state, "bishop");
  if (bishop >= 60) return base + 4;
  if (bishop < 40) return Math.max(1, base - 2);
  return base;
}

export function bishopBlocksBan(state: WorldState): boolean {
  return bishopIsSeparate(state) && state.history.flags.bishop_tracked === true && hundredValue(state, "bishop") >= 80;
}

export function patronageLine(state: WorldState): string {
  const rank = rankOf(state);
  const gesture =
    rank <= 1 ? "a fine feast-day ritual still moves the church" : rank === 2 ? "repairing or furnishing a church moves the church; the feast is now expected" : rank === 3 ? "endowing a chapel moves the church; repairs are now expected" : rank === 4 ? "founding a monastery moves the church; a chapel is now expected" : "founding a great house, or confirming an immunity, moves the church; a monastery is now expected";
  const stain = state.history.flags.simony_alleged === true ? " Simony is alleged of him, and it will not fade." : "";
  return `Patronage: ${gesture}. Devotion is sponsor_feast. An endowment is church_endowment { kind: repair | chapel | monastery | major_house | immunity }. Buying an outcome is church_purchase { aim: judgment | support | annulment | absolution }, and it can leave simony alleged.${stain}`;
}
