import type { WorldState } from "../engine/schema";
import { createRng, seedFromString } from "../combat/rng";
import questTable from "../../data/history/tables/king-quest.json";
import { forcesForEvent, openHistoricalBattle } from "./battles";
import { evalCondition } from "./conditions";
import { deliverEvent, markInterimBattle, type DeliveryResult, type HistoryBeat } from "./deliver";
import { conditionContext } from "./flags";
import { historyContent } from "./load";
import { rollKinWant } from "./marriage";
import { promoteTo } from "./promotion";
import type { SeasonAt } from "./scheduler";
import { ANGRY_BELOW, averageVassalMood, CONTENT_AT } from "./vassals";

/**
 * The king quest (03_HISTORY §11.9; scripts "The king quest"). Started by the
 * ladder's last rung. Gathering: nine nobles, one per motive; the king begins
 * with three and takes everyone the lord fails to win, so six is parity and one
 * of the won turns at the battle. Aldric sends for them one at a time. The lord
 * speaks to each man in the hall; that man's acceptance is the approach hook and
 * resolves the season after. Motive ids stay internal; speech uses his name.
 * The battle (Q-002) is deferred to the battle
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

/**
 * Seat the nine for this attempt: fresh names, one king's man among the buyable motives.
 * The marriage seat (marriage.ts): a lord married into a great house has her brother in it;
 * a lord married to anyone else has nothing left to offer there, and the seat is shut.
 */
export function seatNobles(state: WorldState, turn: number): Noble[] {
  const attempt = state.history.quest.attempt;
  const rng = createRng(seedFromString(`${state.meta.region}:quest:${attempt}:${turn}`));
  const kingsMan = rng.pick(["money", "land", "office"]);
  const wife = state.history.marriage?.archetype ?? null;
  const kinHead = state.history.marriage?.kin?.head ?? null;
  return TABLE.nobles.map((n) => {
    if (n.motive === "marriage" && wife === "theoderada" && kinHead) return { motive: n.motive, name: kinHead, status: "unknown" as const };
    if (n.motive === "marriage" && wife && wife !== "theoderada") return { motive: n.motive, name: n.names[Math.min(attempt, n.names.length - 1)], status: "refused" as const };
    return {
      motive: n.motive,
      name: n.names[Math.min(attempt, n.names.length - 1)],
      status: n.motive === kingsMan ? ("refused" as const) : ("unknown" as const),
    };
  });
}

/** Married into a great house: her brother is the marriage seat, and the quest talks to him on those terms. */
function kinSeat(state: WorldState): boolean {
  return state.history.marriage?.archetype === "theoderada" && Boolean(state.history.marriage.kin?.head);
}

export function startQuest(state: WorldState, at: SeasonAt, turn: number): DeliveryResult {
  const out: DeliveryResult = { beats: [], lines: [] };
  const q = state.history.quest;
  q.active = true;
  q.phase = "gathering";
  q.phaseTurn = turn;
  q.lastApproachTurn = null;
  q.meeting = null;
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
  const marriage = state.history.marriage;
  if (motive === "marriage" && kinSeat(state)) {
    // Her brothers come, failed contender or not: the match is made. The question is what they bring,
    // and that turns on what they ask (kin_office / kin_guarantee on Q-001) and whether it is given.
    noble.status = "won";
    q.lastApproachTurn = turn;
    marriage.kinWant ??= rollKinWant(state, `${state.meta.region}:quest:${q.attempt}:kinwant`);
    const ask =
      marriage.kinWant === "office"
        ? " He asks one thing more: a son of his house placed in an office after the victory. Until it is promised, he comes with fewer men."
        : marriage.kinWant === "guarantee"
          ? " He asks one thing more: the lord's guarantee of his lands and standing, whatever comes. Until it is given, he comes with fewer men."
          : " He asks nothing more; the match was the price, and it was paid.";
    out.lines.push(`Quest: ${noble.name}, the lady's brother, is won.${ask}`);
    out.beats.push(stewardBeat("Q-001", `${noble.name} is with us, my lord; he could hardly be otherwise, with his sister in your hall.${ask} That is ${alliesWon(state)} of the nine, with the king's three against us.`));
    return;
  }
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
  } else if (motive === "grievance" && kinSeat(state) && rng.chance(0.5)) {
    // A great house's quarrels come with the match: the man with a grievance has one against her people too.
    status = "hedging";
    why = `He has an old quarrel with ${marriage.kin?.house ?? "the lady's house"}, and will not sit at a table with her brother until he sees which way it goes.`;
  }
  // The sworn men's word travels (rank design 'Vassals'): a lord whose men are content is vouched for;
  // one whose men are angry is doubted even by those who would have come.
  const mood = averageVassalMood(state);
  if (status !== "won" && mood >= CONTENT_AT && (state.history.vassals ?? []).length && rng.chance(0.5)) {
    status = "won";
    why = `${why ? why + " " : ""}But the lord's own sworn men speak for him, and that turns it.`;
  } else if (status === "won" && mood < ANGRY_BELOW && (state.history.vassals ?? []).length && rng.chance(0.5)) {
    status = "hedging";
    why = "He has heard how the lord's own sworn men speak of him, and will wait to see.";
  }
  noble.status = status;
  q.lastApproachTurn = turn;
  const word = status === "won" ? "is won" : status === "hedging" ? "hedges" : "refuses";
  out.lines.push(`Quest: ${noble.name} ${word}.${why ? " " + why : ""}`);
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
      // Her brothers' price (marriage.ts): what they asked beyond the match, once given, brings their full strength.
      const m = state.history.marriage;
      if (kinSeat(state) && !m.kinPledged && m.kinWant && m.kinWant !== "none") {
        const pledged = (m.kinWant === "office" && taken.includes("kin_office")) || (m.kinWant === "guarantee" && taken.includes("kin_guarantee"));
        if (pledged) {
          m.kinPledged = true;
          const head = m.kin?.head ?? "her brother";
          out.lines.push(`Quest: ${head} has what he asked; his house comes in full strength.`);
          out.beats.push(stewardBeat("Q-001", `${head} has his answer, my lord, and he is satisfied. His house will come in full, foot and all, not the household horse alone.`));
          state.history.record.push({ year: at.year, season: at.season, text: `The lord gave his wife's brother ${m.kinWant === "office" ? "a son in office after the victory" : "a guarantee of his lands and standing"}.`, thread: "quest" });
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
          if (content.features.historicalBattles && forcesForEvent(state, battle.id, at)) {
            const r = deliverEvent(state, battle, at, turn);
            out.beats.push(...r.beats);
            out.lines.push(...r.lines);
            const opened = openHistoricalBattle(state, battle, at, turn);
            out.beats.push(...opened.beats);
            out.lines.push(...opened.lines);
          } else {
            const r = markInterimBattle(state, battle, at, turn);
            out.beats.push(...r.beats);
            out.lines.push(...r.lines);
          }
        }
        state.history.record.push({ year: at.year, season: at.season, text: `The lord took the field against the king with ${alliesWon(state)} of the great men.`, thread: "quest" });
      }
      const meeting = q.meeting;
      if (meeting?.settled) {
        const waiting = meeting.motive != null && q.nobles.some((n) => n.motive === meeting.motive && n.status === "unknown") && taken.includes(`approach_${meeting.motive}`);
        if (!waiting) q.meeting = null;
      }
      if (q.phase !== "gathering") q.meeting = null;
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
        const r = promoteTo(state, 5, { patron: "the assembly of the great men and the bishops", turn, at, eventId: "Q-003" });
        out.beats.push(...r.beats);
        out.lines.push(...r.lines);
        out.lines.push("The lord is king.");
      } else if (chosen === "counter_offer") {
        q.phase = "failed";
        const r = promoteTo(state, 4, { patron: "the magnates' counter-offer", turn, at, eventId: "Q-003" });
        out.beats.push(...r.beats);
        out.lines.push(...r.lines);
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

/**
 * What would move each man, in words that can be spoken.
 * The key is internal. It is never a name, and it is never the portrait's title.
 */
const AUDIENCE: Record<string, { hint: string; price: string; greet: string }> = {
  grievance: {
    hint: "The king wronged him, and he will not be bought.",
    price: "The king wronged you. You will not be bought. You want him brought down, not paid.",
    greet: "I did not come to be paid. Say why you sent for me.",
  },
  money: {
    hint: "His price is silver, and the king may offer more.",
    price: "Your price is silver. If the king offers more, you will say so.",
    greet: "Your steward was insistent. What are you offering?",
  },
  land: {
    hint: "He wants estates promised for the day the lord is crowned.",
    price: "You want estates promised for the day he is crowned. Nothing sooner will do.",
    greet: "I left my own hall because you asked. Speak.",
  },
  office: {
    hint: "He wants a great place after the victory: chancellor, marshal, or a see.",
    price: "You want a great place after the victory: the chancellor's staff, the marshal's, or a see. It is paid when he has won, not before.",
    greet: "I will hear you. Be plain about what follows a victory.",
  },
  marriage: {
    hint: "He wants a match into the lord's house. Aldric does not discuss it for him.",
    price: "You want a match into his house. You will not bargain it through a steward.",
    greet: "A match is not discussed through a steward. I am here. Say what you mean.",
  },
  debt: {
    hint: "He is paying back an old kindness. He should be reminded of it, not offered a new price.",
    price: "You are paying back an old kindness: hunger fed, a refuge, a son placed at Auxerre. You want to be reminded, not bought.",
    greet: "I remember your house. I am listening.",
  },
  fear: {
    hint: "He does not love the lord. He fears the king, or a crown in dispute, still more, and he wants reassurance.",
    price: "You do not love him. You fear the king, or a crown torn in two, still more. You want to be reassured, not flattered.",
    greet: "I came because I was asked, not because I am easy. Tell me what you intend.",
  },
  protection: {
    hint: "He wants a man who will take the field. Talk of fighting, not of gifts.",
    price: "You want a man who will actually fight. Words about gifts do not move you. Words about the field might.",
    greet: "If you want my men, tell me what you will do when the banners are out.",
  },
  divine: {
    hint: "He is looking for a sign that God favours the lord: the Church's good opinion, a relic, a house spared when others were not.",
    price: "You are looking for a sign that God favours him: the Church's good opinion, a relic, a house spared when others were not. Nothing else is a price.",
    greet: "I came to see what kind of man sends for me. Speak.",
  },
};

function audienceShut(state: WorldState, motive: string): string | null {
  const def = TABLE.nobles.find((n) => n.motive === motive);
  if (!def?.requires || evalCondition(def.requires, conditionContext(state))) return null;
  if (motive === "debt") return "You owe him nothing you can remember. No promise today will move you.";
  if (motive === "protection") return "You have not seen him fight. You will not pledge your men today.";
  return "You see no sign that God favours him. You will not pledge yourself today.";
}

function aldricHint(state: WorldState, motive: string, status: string): string {
  if (motive === "marriage" && kinSeat(state)) return "He is the lady's brother. He will come for her sake. What he asks beyond that is the question.";
  const def = TABLE.nobles.find((n) => n.motive === motive);
  if (status === "unknown" && def && !def.known) return "You have not learned his price. If the lord asks you to send for him, the lord must hear it from the man himself.";
  return AUDIENCE[motive]?.hint ?? "Hear what he asks.";
}

/** Why this gathering hook cannot be taken. Null when it can. */
export function questHookRefusal(state: WorldState, hookId: string): string | null {
  const q = state.history.quest;
  if (hookId.startsWith("arrange_")) {
    if (!q.active || q.phase !== "gathering") return "There is no gathering of the great men now.";
    if (q.meeting?.settled) return `${q.meeting.name} has given his answer. It waits on the season.`;
    if (q.meeting) return `${q.meeting.name} is already in the hall. Hear him before sending for another.`;
    const motive = hookId.slice("arrange_".length);
    const noble = q.nobles.find((n) => n.motive === motive);
    if (!noble) return "There is no such man to send for.";
    if (noble.status !== "unknown") return `${noble.name} will not come. That is already settled.`;
    const taken = state.history.hooksTaken["Q-001"] ?? [];
    if (taken.includes(`approach_${motive}`)) return `${noble.name} has already been heard.`;
    return null;
  }
  if (hookId === "end_audience") {
    if (!q.meeting) return "No one is waiting in the hall.";
    if (q.meeting.settled) return `${q.meeting.name} has given his answer. It waits on the season.`;
    return null;
  }
  return null;
}

/** After a gathering hook is taken: open the hall, settle the bargain, or send him home. */
export function afterQuestHook(state: WorldState, hookId: string): void {
  const q = state.history.quest;
  if (hookId.startsWith("arrange_")) {
    const motive = hookId.slice("arrange_".length);
    const noble = q.nobles.find((n) => n.motive === motive);
    if (!noble) return;
    q.meeting = { motive, name: noble.name, settled: false, wantsTalk: true, greeted: false, openedAt: new Date().toISOString() };
    state.history.record.push({
      year: state.meta.year,
      season: state.meta.season,
      text: `Aldric sent for ${noble.name}.`,
      thread: "quest",
    });
    return;
  }
  if (hookId.startsWith("approach_") && q.meeting?.motive === hookId.slice("approach_".length)) {
    q.meeting.settled = true;
    return;
  }
  if (hookId === "end_audience" && q.meeting) {
    const name = q.meeting.name;
    q.meeting = null;
    const taken = state.history.hooksTaken["Q-001"];
    if (taken) state.history.hooksTaken["Q-001"] = taken.filter((id) => id !== "end_audience");
    state.history.record.push({
      year: state.meta.year,
      season: state.meta.season,
      text: `${name} left the hall with no bargain.`,
      thread: "quest",
    });
  }
}

/** The hook line Aldric sees, with the man's name in it and no portrait title. */
export function hookSpokenTrigger(state: WorldState, hookId: string, fallback: string): string {
  if (hookId === "end_audience") {
    const name = state.history.quest.meeting?.name;
    return name ? `The lord sends ${name} home with no bargain.` : fallback;
  }
  if (!hookId.startsWith("arrange_")) return fallback;
  const motive = hookId.slice("arrange_".length);
  const noble = state.history.quest.nobles.find((n) => n.motive === motive);
  if (!noble) return fallback;
  return `The lord asks Aldric to send for ${noble.name}. ${aldricHint(state, motive, noble.status)}`;
}

export function audienceGreeting(state: WorldState): string | null {
  const meeting = state.history.quest.meeting;
  if (!meeting) return null;
  if (meeting.motive === "marriage" && kinSeat(state)) {
    return `${meeting.name}. My sister keeps your hall. You sent for me, so I came. Say what you want of her house.`;
  }
  const greet = AUDIENCE[meeting.motive]?.greet ?? "You sent for me. I am listening.";
  return `${meeting.name}. ${greet}`;
}

/** What the man in the hall knows about himself. Null when the hall is empty. */
export function audienceBrief(state: WorldState): { name: string; hookId: string; price: string; shut: string | null; settled: boolean } | null {
  const meeting = state.history.quest.meeting;
  if (!meeting) return null;
  let price = AUDIENCE[meeting.motive]?.price ?? "Decide for yourself whether his words are enough.";
  if (meeting.motive === "marriage" && kinSeat(state)) {
    price = "You are his wife's brother. You came for her sake, and you will come. The match is already the price.";
  }
  return { name: meeting.name, hookId: `approach_${meeting.motive}`, price, shut: audienceShut(state, meeting.motive), settled: meeting.settled };
}

function nobleStatusLine(state: WorldState, n: Noble, speaker?: "steward" | "chaplain"): string {
  const m = state.history.marriage;
  if (n.motive === "marriage" && kinSeat(state)) {
    const want =
      m.kinWant === "office"
        ? "He asks a son of his house in a great place after the victory (hook kin_office)."
        : m.kinWant === "guarantee"
          ? "He asks the lord's guarantee of his lands and standing (hook kin_guarantee)."
          : m.kinWant === "none"
            ? "He asks nothing more."
            : "He will come; the question is what he brings. The lord must speak to him.";
    const strength = m.kinPledged ? " Given, and he comes in full strength." : n.status === "won" && m.kinWant && m.kinWant !== "none" ? " Not yet given, so he brings the household horse only." : "";
    return `  ${n.name}, the lady's brother: ${n.status === "unknown" ? "near-certain, since his sister is in the hall" : n.status}. ${want}${strength}`;
  }
  if (n.motive === "marriage" && m.archetype && m.archetype !== "theoderada") {
    return `  ${n.name}: the match is shut. The lord is married already, and not into a house that counts here.`;
  }
  if (n.status === "refused") return `  ${n.name}: will not come. That is already settled.`;
  if (n.status !== "unknown") return `  ${n.name}: ${n.status}.`;
  const def = TABLE.nobles.find((d) => d.motive === n.motive);
  const hint = speaker === "chaplain" && def?.envoy === "chaplain" ? AUDIENCE[n.motive]?.hint : speaker === "steward" ? aldricHint(state, n.motive, n.status) : def?.known ? AUDIENCE[n.motive]?.hint : "His price is not known in the hall.";
  if (state.history.quest.meeting?.motive === n.motive) return `  ${n.name}: in the hall now. ${hint ?? ""}`;
  const send = speaker === "steward" && !state.history.quest.meeting ? ` When the lord asks you to send for him, emit arrange_${n.motive}.` : "";
  return `  ${n.name}: not yet heard. ${hint ?? ""}${send}`;
}

/** Lines for the prompt while the quest runs. Hook ids are private; names are the men's own. */
export function questLines(state: WorldState, speaker?: "steward" | "chaplain"): string[] {
  const q = state.history.quest;
  if (!q.active) return [];
  const lines: string[] = [];
  if (q.phase === "gathering") {
    lines.push(
      `The king quest: gathering the great men. ${alliesWon(state)} won of nine (${QUEST_PARITY} is parity; the king holds ${TABLE.kingsMen}). Aldric sends for them one at a time, and the lord speaks to each man in the hall. One answer comes back each season. Use only the name written here. Never speak a hook id.`,
    );
    if (q.meeting?.settled) lines.push(`  ${q.meeting.name} has heard the lord. The answer comes with the season. Do not send for anyone else yet.`);
    else if (q.meeting) lines.push(`  ${q.meeting.name} is in the hall now. Do not send for anyone else.`);
    for (const n of q.nobles) lines.push(nobleStatusLine(state, n, speaker));
  } else if (q.phase === "battle") {
    lines.push("The king quest: the lord's host is in the field against the king.");
  } else if (q.phase === "election") {
    lines.push(`The king quest: the assembly. ${alliesWon(state)} electors are the lord's.`);
  }
  return lines;
}
