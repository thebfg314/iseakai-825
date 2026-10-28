import type { WorldState } from "../engine/schema";
import { createRng, seedFromString } from "../combat/rng";
import questTable from "../../data/history/tables/king-quest.json";
import { evalCondition } from "./conditions";
import { deliverEvent, markInterimBattle, type DeliveryResult, type HistoryBeat } from "./deliver";
import { conditionContext } from "./flags";
import { historyContent } from "./load";
import type { SeasonAt } from "./scheduler";

/**
 * The king quest (03_HISTORY §11.9; scripts "The king quest"). Started by the
 * ladder's last rung. Gathering: nine nobles, one per motive; the king begins
 * with three and takes everyone the lord fails to win, so six is parity and one
 * of the won turns at the battle. Each approach is a hook on Q-001 and resolves
 * the season after it is spoken. The battle (Q-002) is deferred to the battle
 * pass; the election (Q-003) to the promotion pass. A second attempt closes
 * marriage, fear and divine favour and thins the debts.
 */

export type NobleDef = {
  motive: string;
  wants: string;
  envoy: "steward" | "chaplain" | "player";
  names: string[];
  secondAttempt: "open" | "closed" | "thin";
  known: boolean;
  requires?: string;
};
type Table = { kingsMen: number; parity: number; nobles: NobleDef[] };
const TABLE = questTable as unknown as Table;

export function questNobles(): NobleDef[] {
  return TABLE.nobles;
}

export const QUEST_PARITY = TABLE.parity;

type Noble = WorldState["history"]["quest"]["nobles"][number];

/** Seat the nine for this attempt: fresh names, one king's man among the buyable motives. */
export function seatNobles(state: WorldState, turn: number): Noble[] {
  const attempt = state.history.quest.attempt;
  const rng = createRng(seedFromString(`${state.meta.region}:quest:${attempt}:${turn}`));
  const kingsMan = rng.pick(["money", "land", "office"]);
  return TABLE.nobles.map((n) => ({
    motive: n.motive,
    name: n.names[Math.min(attempt, n.names.length - 1)],
    status: n.motive === kingsMan ? "refused" : "unknown",
  }));
}

export function startQuest(state: WorldState, at: SeasonAt, turn: number): DeliveryResult {
  const out: DeliveryResult = { beats: [], lines: [] };
  const q = state.history.quest;
  q.active = true;
  q.phase = "gathering";
  q.phaseTurn = turn;
  q.lastApproachTurn = null;
  q.nobles = seatNobles(state, turn);
  delete state.history.hooksTaken["Q-001"];
  const event = historyContent().byId.get("Q-001");
  if (event) {
    const r = deliverEvent(state, event, at, turn);
    out.beats.push(...r.beats);
    out.lines.push(...r.lines);
  }
  state.history.record.push({ year: at.year, season: at.season, text: `The lord began to gather the great men against the king (attempt ${q.attempt + 1}).`, thread: "quest" });
  return out;
}

export function alliesWon(state: WorldState): number {
  return state.history.quest.nobles.filter((n) => n.status === "won" || n.status === "betrayer").length;
}

/** Resolve one approach the lord has spoken (the hook is on Q-001). */
function resolveApproach(state: WorldState, motive: string, at: SeasonAt, turn: number, out: DeliveryResult) {
  const q = state.history.quest;
  const noble = q.nobles.find((n) => n.motive === motive);
  const def = TABLE.nobles.find((n) => n.motive === motive);
  if (!noble || !def || noble.status !== "unknown") return;
  const rng = createRng(seedFromString(`${state.meta.region}:quest:${q.attempt}:${motive}:${turn}`));
  const second = q.attempt >= 1;
  let status: Noble["status"] = "won";
  let why = "";
  if (second && def.secondAttempt === "closed") {
    status = "refused";
    why = motive === "divine" ? "God evidently did not favour the lord the first time." : motive === "marriage" ? "Nobody weds a daughter to a failed contender." : "He is the alternative people fear now.";
  } else if (def.requires && !evalCondition(def.requires, conditionContext(state, at))) {
    status = motive === "protection" ? "hedging" : "refused";
    why = motive === "debt" ? "He owes the lord nothing he can remember." : motive === "protection" ? "He has not seen the lord fight, and will wait for the field." : "He sees no sign of blessing on the lord.";
  } else if (second && def.secondAttempt === "thin" && rng.chance(0.5)) {
    status = "refused";
    why = "Some of that debt was spent last time.";
  } else if (motive === "money" && rng.chance(0.3)) {
    status = "hedging";
    state.history.flags.quest_money_outbid = true;
    why = "The king has outbid the lord; he will come for more silver or go to the king.";
  }
  noble.status = status;
  q.lastApproachTurn = turn;
  const word = status === "won" ? "is won" : status === "hedging" ? "hedges" : "refuses";
  out.lines.push(`Quest: ${noble.name} (${motive}) ${word}.${why ? " " + why : ""}`);
  out.beats.push(stewardBeat("Q-001", `${noble.name} ${word}, my lord.${why ? " " + why : ""} That is ${alliesWon(state)} of the nine, with the king's three against us.`));
}

export function tickQuest(state: WorldState, at: SeasonAt, turn: number, questStarts: boolean): DeliveryResult {
  const out: DeliveryResult = { beats: [], lines: [] };
  const content = historyContent();
  const q = state.history.quest;
  if (questStarts && content.features.quest) {
    const r = startQuest(state, at, turn);
    out.beats.push(...r.beats);
    out.lines.push(...r.lines);
    return out;
  }
  if (questStarts && !content.features.quest) {
    out.lines.push("The king quest is closed in this pass; the attempt on the road stands on the record.");
    return out;
  }
  if (!q.active || !content.features.quest) return out;

  switch (q.phase) {
    case "gathering": {
      const taken = state.history.hooksTaken["Q-001"] ?? [];
      // The outbid man comes back when paid again.
      if (taken.includes("pay_again")) {
        const money = q.nobles.find((n) => n.motive === "money");
        if (money && money.status === "hedging") {
          money.status = "won";
          delete state.history.flags.quest_money_outbid;
          out.lines.push(`Quest: ${money.name} is won after all; the king was outbid.`);
        }
      }
      // One approach a season, in the order spoken.
      if (q.lastApproachTurn !== turn) {
        const pending = taken
          .filter((id) => id.startsWith("approach_"))
          .map((id) => id.slice("approach_".length))
          .filter((m) => q.nobles.some((n) => n.motive === m && n.status === "unknown"));
        if (pending.length) resolveApproach(state, pending[0], at, turn, out);
      }
      if (taken.includes("call_the_assembly")) {
        // The betrayer: one of the won, never the man with the grievance.
        const rng = createRng(seedFromString(`${state.meta.region}:quest:${q.attempt}:betrayer`));
        const candidates = q.nobles.filter((n) => n.status === "won" && n.motive !== "grievance");
        if (candidates.length) rng.pick(candidates).status = "betrayer";
        q.phase = "battle";
        q.phaseTurn = turn;
        const battle = content.byId.get("Q-002");
        if (battle) {
          if (content.features.historicalBattles) {
            const r = deliverEvent(state, battle, at, turn);
            out.beats.push(...r.beats);
            out.lines.push(...r.lines);
          } else {
            const r = markInterimBattle(state, battle, at, turn);
            out.beats.push(...r.beats);
            out.lines.push(...r.lines);
          }
        }
        state.history.record.push({ year: at.year, season: at.season, text: `The lord took the field against the king with ${alliesWon(state)} of the great men.`, thread: "quest" });
      }
      return out;
    }
    case "battle": {
      if (q.phaseTurn !== null && turn - q.phaseTurn < 1) return out;
      q.phase = "election";
      q.phaseTurn = turn;
      const election = content.byId.get("Q-003");
      if (election && content.features.promotions) {
        const r = deliverEvent(state, election, at, turn);
        out.beats.push(...r.beats);
        out.lines.push(...r.lines);
      } else if (election) {
        if (!state.history.dropped.includes("Q-003")) state.history.dropped.push("Q-003");
        out.beats.push(stewardBeat("Q-003", "The great men are to assemble, my lord. What they decide, and what the bishops do, is not yet written in this chronicle."));
        out.lines.push("Q-003 (the election) waits on the promotion pass.");
      }
      return out;
    }
    case "election": {
      const chosen = state.history.chosen["Q-003"];
      if (!chosen) return out;
      if (chosen === "earned" || chosen === "bought" || chosen === "coerced") {
        q.phase = "crowned";
        state.player.rankLevel = 5;
        out.lines.push("The lord is king.");
      } else if (chosen === "counter_offer") {
        q.phase = "failed";
        state.player.rankLevel = Math.max(state.player.rankLevel ?? 1, 4);
        out.lines.push("The lord took the duchy and put a Carolingian child on the throne.");
      } else {
        q.phase = "failed";
      }
      q.phaseTurn = turn;
      q.active = false;
      if (q.phase === "failed") q.attempt += 1;
      return out;
    }
    default:
      return out;
  }
}

function stewardBeat(eventId: string, text: string): HistoryBeat {
  return { npcId: "steward", eventId, text };
}

/** Lines for the prompt while the quest runs. */
export function questLines(state: WorldState): string[] {
  const q = state.history.quest;
  if (!q.active) return [];
  const lines: string[] = [];
  if (q.phase === "gathering") {
    const known = q.nobles.filter((n) => TABLE.nobles.find((d) => d.motive === n.motive)?.known || n.status !== "unknown");
    lines.push(`The king quest: gathering the great men. ${alliesWon(state)} won of nine (${QUEST_PARITY} is parity; the king holds ${TABLE.kingsMen}). One approach a season; the hook ids are approach_<motive>.`);
    for (const n of known) {
      const d = TABLE.nobles.find((x) => x.motive === n.motive);
      lines.push(`  ${n.name} (${n.motive}; envoy: ${d?.envoy}): ${n.status === "unknown" ? d?.wants : n.status}.`);
    }
    const unknown = q.nobles.filter((n) => !known.includes(n));
    if (unknown.length) lines.push(`  Aldric does not know the minds of ${unknown.length} more; someone must go and ask.`);
  } else if (q.phase === "battle") {
    lines.push("The king quest: the lord's host is in the field against the king.");
  } else if (q.phase === "election") {
    lines.push(`The king quest: the assembly. ${alliesWon(state)} electors are the lord's.`);
  }
  return lines;
}
