import { applyRenown, rankTitle } from "../combat/renown";
import type { Rank } from "../combat/schema";
import { grainOnHand, HOUSEHOLD_SEASON_GRAIN } from "../engine/grain";
import type { BattleRecord, WorldState } from "../engine/schema";
import type { HistoryBeat } from "./deliver";
import { totalManses } from "./flags";
import { clearDepopulation } from "./neighbours";
import { currentRank } from "./promotion";
import type { SeasonAt } from "./scheduler";
import { moveVassalMood } from "./vassals";

/**
 * Renown decay from estate failure.
 *
 * A name is kept by keeping one's obligations and one's people. A lord who cannot
 * pay his household, keep his roofs, pay his men or render what is owed upward loses
 * renown each season it goes on; so does a lord whose people go hungry. The higher
 * the rank, the faster it goes: a count's failure is talked of in more halls than a
 * villa lord's. The floor stays at 1 (renown.ts).
 *
 * Losing battles costs nothing here: the field's own formula (heart dealt against
 * heart taken) already says what the day was worth. What the hall judges is the
 * cause. Over his last few commanded battles the records show one of two things:
 *   - he cannot lead: adequate men, poor exchange of heart; the remedy is a captain;
 *   - he did not equip them: too few men of his own for his manses; the remedy is
 *     silver on arms, horses and drill.
 * Aldric says which of the two is being said, because the remedies differ.
 */

/** Renown lost per season of unmet obligation, by rank 1–5. */
export const OBLIGATION_DECAY = [2, 5, 15, 30, 50] as const;
/** Renown lost per season of hunger, by rank 1–5, for mild shortage / real hunger / starvation and flight. */
export const HUNGER_DECAY: readonly (readonly [number, number, number])[] = [
  [1, 3, 6],
  [2, 6, 12],
  [5, 15, 35],
  [10, 30, 70],
  [15, 50, 120],
];

export type HungerRow = "none" | "mild" | "real" | "starvation";
/** Vassal mood lost each season a Count's own villas stand empty. */
export const EMPTIED_VASSAL_MOOD = 3;

export type DecayTick = { lines: string[]; beats: HistoryBeat[]; obligations: string[]; hunger: HungerRow; lost: number };

/** Which obligations went unmet this season, named for the ledger. */
export function unmetObligations(state: WorldState, turn: number): string[] {
  const out: string[] = [];
  const last = state.history.upkeep.last;
  if (last && last.turn === turn) {
    if (last.householdDue !== undefined && last.householdPaid < last.householdDue) out.push("the household went unpaid");
    if (last.maintenanceDue !== undefined && last.maintenancePaid < last.maintenanceDue) out.push("the works went unkept");
  }
  const d = state.history.decay;
  // The men were paid (or not) by the engine tick just before this pass, at the closing season's turn.
  if (d.armsUnpaidTurn !== null && d.armsUnpaidTurn >= turn - 1) out.push("the men under arms went unpaid");
  const closing = turn - 1;
  if ((state.church?.neglect ?? []).some((s) => s.kind === "tithe" && s.turn >= closing)) out.push("the tithe was not rendered");
  return out;
}

/** How badly the lord's own people are going hungry at the turn of the season. */
export function hungerRow(state: WorldState, turn: number): HungerRow {
  const hungry = Boolean(state.flags.hunger);
  const d = state.history.decay;
  const flight = d.flightTurn !== null && d.flightTurn >= turn - 1;
  const emptied = d.emptiedTurn !== null;
  if (emptied) return "starvation";
  if (hungry && ((state.history.prices.hungrySeasons ?? 0) >= 2 || flight)) return "starvation";
  if (hungry) return "real";
  const need = Math.max(1, state.population.households) * HOUSEHOLD_SEASON_GRAIN;
  if (grainOnHand(state) / need < 1) return "mild";
  return "none";
}

const HUNGER_WORD: Record<Exclude<HungerRow, "none">, string> = {
  mild: "the stores run short",
  real: "the people go hungry",
  starvation: "the people starve and slip away",
};

/** Season tick, run after the household and the works have been paid. */
export function tickRenownDecay(state: WorldState, _at: SeasonAt, turn: number): DecayTick {
  const out: DecayTick = { lines: [], beats: [], obligations: [], hunger: "none", lost: 0 };
  if (state.history.dead) return out;
  const rank = currentRank(state);
  clearDepopulation(state);
  if (state.history.decay.emptiedTurn !== null && (state.history.vassals ?? []).length) {
    // The sworn men see the lord's own villas empty.
    moveVassalMood(state, -EMPTIED_VASSAL_MOOD, "their lord's villas standing empty", turn);
    out.lines.push("The sworn men see the lord's villas empty; they think less of him each season it goes on.");
  }
  const obligations = unmetObligations(state, turn);
  const hunger = hungerRow(state, turn);
  out.obligations = obligations;
  out.hunger = hunger;
  let loss = 0;
  const parts: string[] = [];
  if (obligations.length) {
    loss += OBLIGATION_DECAY[rank - 1];
    parts.push(obligations.join(", "));
  }
  if (hunger !== "none") {
    loss += HUNGER_DECAY[rank - 1][hunger === "mild" ? 0 : hunger === "real" ? 1 : 2];
    parts.push(HUNGER_WORD[hunger]);
  }
  const d = state.history.decay;
  if (loss <= 0) {
    d.sinceTurn = null;
    return out;
  }
  const before = state.player.renown;
  state.player.renown = applyRenown(before, -loss);
  const lost = before - state.player.renown;
  out.lost = lost;
  d.lost += lost;
  const first = d.sinceTurn === null;
  if (first) d.sinceTurn = turn;
  out.lines.push(`Renown −${lost} (${rankTitle(rank as Rank).toLowerCase()}; ${parts.join("; ")}).`);
  if (first) {
    const why = parts.join(" and ");
    out.beats.push({
      npcId: "steward",
      eventId: "decay:begins",
      text: `My lord, it is being said in other halls that ${why}. A ${rankTitle(rank as Rank).toLowerCase()}'s name is kept by keeping his obligations and his people; every season this goes on, it is kept less. ${rank >= 3 ? "At your rank it goes faster than you would think: a count's want is talked of in more halls than a villa lord's." : ""}`.trim(),
    });
  } else if (state.player.renown <= 1 && before > 1) {
    out.beats.push({ npcId: "steward", eventId: "decay:floor", text: "My lord, there is no name left to lose. What men say of you now is only what they see." });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The field: judging the cause, not the loss
// ---------------------------------------------------------------------------

/** Battles read for the verdict, newest first. */
export const VERDICT_WINDOW = 4;
/** Fewer commanded battles than this and the hall has nothing to say. */
export const VERDICT_MIN = 3;
/** Heart dealt against heart taken below this, over the window, reads as a captain who cannot lead. */
export const CANNOT_LEAD_RATIO = 0.6;
/** Own men brought below this share of what his manses should field reads as a lord who did not equip them. */
export const ILL_EQUIPPED_SHARE = 0.5;

/** Files a lord of so many manses is expected to bring: one man in five manses, and never fewer than five. */
export function expectedMen(manses: number): number {
  return Math.max(5, Math.round(manses / 5));
}

/** Battles he commanded in person: the rank-and-file tier is a man in another's file. */
export function commandedBattles(state: WorldState): BattleRecord[] {
  return state.battle_history.filter((b) => b.tier !== "rank_and_file" && !b.captain && b.moraleDealt !== undefined && b.moraleTaken !== undefined && b.ownMen !== undefined);
}

export type FieldVerdict = "none" | "cannot_lead" | "ill_equipped";

/** What the hall would say of the lord's last few commanded battles. */
export function judgeField(state: WorldState): { verdict: FieldVerdict; ratio: number; share: number; battles: number } {
  const recent = commandedBattles(state).slice(-VERDICT_WINDOW);
  if (recent.length < VERDICT_MIN) return { verdict: "none", ratio: 1, share: 1, battles: recent.length };
  const dealt = recent.reduce((n, b) => n + (b.moraleDealt ?? 0), 0);
  const taken = recent.reduce((n, b) => n + (b.moraleTaken ?? 0), 0);
  const ratio = taken <= 0 ? (dealt > 0 ? 2 : 1) : dealt / taken;
  const share = recent.reduce((n, b) => n + Math.min(1.5, (b.ownMen ?? 0) / expectedMen(b.manses ?? 0)), 0) / recent.length;
  const poorField = recent.filter((b) => b.outcome !== "victory").length >= Math.ceil(recent.length / 2);
  if (!poorField) return { verdict: "none", ratio, share, battles: recent.length };
  if (share < ILL_EQUIPPED_SHARE) return { verdict: "ill_equipped", ratio, share, battles: recent.length };
  if (ratio < CANNOT_LEAD_RATIO) return { verdict: "cannot_lead", ratio, share, battles: recent.length };
  return { verdict: "none", ratio, share, battles: recent.length };
}

/** After a battle is written to the ledger: the verdict is formed or lifted, and Aldric says so once. */
export function updateFieldVerdict(state: WorldState, turn: number): HistoryBeat[] {
  const d = state.history.decay;
  const j = judgeField(state);
  if (j.verdict === d.verdict) return [];
  const was = d.verdict;
  d.verdict = j.verdict;
  d.verdictTurn = turn;
  if (j.verdict === "cannot_lead") {
    return [
      {
        npcId: "steward",
        eventId: "verdict:cannot_lead",
        text: "My lord, I will say what is being said, since you would rather hear it from me. The men you take to the field are men enough; it is the handling that fails them. The word is that you cannot lead. Nobody loses his name for a lost day; men lose it for the same lost day four times. The remedy is not a secret: send a captain in your place and let him have the files, and ride at the rear of them.",
      },
    ];
  }
  if (j.verdict === "ill_equipped") {
    return [
      {
        npcId: "steward",
        eventId: "verdict:ill_equipped",
        text: "My lord, I will say what is being said. For the manses you hold you bring too few men, and the ones you bring are thin. Some read it as poverty, some as meanness; neither is a thing a lord wants said. The remedy is silver: arms, horses, drill, so that the files you take match what the land should field.",
      },
    ];
  }
  return [
    {
      npcId: "steward",
      eventId: "verdict:lifted",
      text: was === "cannot_lead" ? "My lord, the talk of your handling in the field has stopped; the last days have answered it." : "My lord, the talk that you send your men out ill-found has stopped; the files you brought last were what they should be.",
    },
  ];
}

/** One line for Aldric's prompt while a verdict stands. */
export function fieldVerdictLine(state: WorldState): string | null {
  const d = state.history.decay;
  if (d.verdict === "cannot_lead") return "The field: the hall says the lord cannot lead (men enough, poor exchange of heart over his last battles). Remedy: a captain commands in his place. Say so if the lord asks why the word is against him; do not invent a renown penalty for lost battles.";
  if (d.verdict === "ill_equipped") return `The field: the hall says the lord did not equip his men (too few of his own for ${totalManses(state)} manses). Remedy: spend on arms, horses, training. Say so if asked; lost battles themselves carry no further penalty.`;
  return null;
}

/** One line for Aldric's prompt while renown is bleeding. */
export function decayLine(state: WorldState, turn: number): string | null {
  const d = state.history.decay;
  const obligations = unmetObligations(state, turn);
  const hunger = hungerRow(state, turn);
  if (!obligations.length && hunger === "none" && d.sinceTurn === null) return null;
  const bits: string[] = [];
  if (obligations.length) bits.push(obligations.join(", "));
  if (hunger !== "none") bits.push(HUNGER_WORD[hunger]);
  const since = d.sinceTurn === null ? "" : ` (since turn ${d.sinceTurn}; ${d.lost} renown lost in all)`;
  return `Renown decay: ${bits.length ? bits.join("; ") : "the last failure has stopped"}${since}. A ${rankTitle(currentRank(state) as Rank).toLowerCase()} loses ${OBLIGATION_DECAY[currentRank(state) - 1]} a season for unmet obligations and ${HUNGER_DECAY[currentRank(state) - 1].join("/")} for shortage/hunger/starvation.`;
}
