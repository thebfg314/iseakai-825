import type { WorldState } from "../engine/schema";
import { markDeath } from "./age";
import type { HistoryBeat } from "./deliver";
import { flagTruthy } from "./flags";
import { currentRank, demoteBy } from "./promotion";
import type { SeasonAt } from "./scheduler";

/**
 * Execution as a traitor.
 *
 * A failed rising does not end in death. Great men who rebelled were usually pardoned,
 * humiliated or confined: Bernard of Septimania rebelled three times before he was killed,
 * Pippin II was shut in a monastery, Boso died in his bed, Charles the Fat was deposed.
 * Mercy made a king look strong. A first failure ends in submission: public humiliation,
 * loss of offices, possibly the memory of custody.
 *
 * Execution needs an aggravating factor:
 *   - he was pardoned once already and rose again;
 *   - he allied with the kingdom's enemies;
 *   - he killed an anointed king;
 *   - he refuses the terms when they are offered.
 * He arrived in this world with no kin. That is always true, and it is why nobody comes
 * to make a martyr's bargain for him; it is not, by itself, a reason to kill him.
 */

export type ExecutionTick = { lines: string[]; beats: HistoryBeat[]; died: boolean; pardoned: boolean };

function kingName(state: WorldState): string {
  return state.history.realm.king ?? "the king";
}

/** Why the king would have his head, or null when mercy still holds. */
export function executionCause(state: WorldState, refusedTerms: boolean, roseAgain: boolean): string | null {
  if (flagTruthy(state, "killed_anointed_king")) return "he killed an anointed king";
  if (flagTruthy(state, "allied_with_enemies")) return "he allied himself with the kingdom's enemies";
  if (state.history.mercy.pardons >= 1 && roseAgain) return "he was pardoned once and rose again";
  if (refusedTerms) return "he refused the terms that were offered";
  return null;
}

function pardon(state: WorldState, at: SeasonAt, turn: number, why: string, takeOffices: boolean, out: ExecutionTick): void {
  state.history.mercy.pardons += 1;
  out.pardoned = true;
  if (takeOffices && currentRank(state) > 1) {
    const r = demoteBy(state, 1, { by: `${kingName(state)}, the king`, turn, at, eventId: "mercy" });
    out.lines.push(...r.lines);
  }
  state.history.record.push({ year: at.year, season: at.season, text: `Spared after a failed rising: ${why}.`, thread: "ending" });
  out.lines.push(`Spared: ${why}.`);
  const offices = takeOffices ? " The offices go." : "";
  out.beats.push({
    npcId: "steward",
    eventId: "mercy:spared",
    text: `My lord, ${kingName(state)} has let you live, and he will be praised for it. ${why.charAt(0).toUpperCase()}${why.slice(1)}.${offices} You keep your head. There is no kin of yours to make a martyr's bargain for you, which is why the mercy costs him nothing. A second time, it would not be offered.`,
  });
}

function execute(state: WorldState, at: SeasonAt, cause: string, out: ExecutionTick): void {
  state.player.dead = true;
  markDeath(state, "execution", at.year);
  out.died = true;
  out.lines.push(`Put to death as a traitor: ${cause}.`);
  out.beats.push({
    npcId: "steward",
    eventId: "mercy:executed",
    text: `My lord — there is no gentler way to say it, and no one else will. ${kingName(state)} has had you taken. ${cause.charAt(0).toUpperCase()}${cause.slice(1)}, and there is no kin to avenge you or to make him think twice. Mercy would have made him look strong. He has chosen not to need that.`,
  });
}

/**
 * Judge a failed rising once. Submission is the ordinary end; the aggravating factors
 * are the only road to the block.
 */
export function tickExecution(state: WorldState, at: SeasonAt, turn: number): ExecutionTick {
  const out: ExecutionTick = { lines: [], beats: [], died: false, pardoned: false };
  if (state.history.dead || state.player.dead) return out;
  const mercy = state.history.mercy;
  const judge = (key: string, refusedTerms: boolean, roseAgain: boolean, pardonWhy: string, takeOffices: boolean) => {
    if (mercy.judged.includes(key)) return;
    mercy.judged.push(key);
    const cause = executionCause(state, refusedTerms, roseAgain);
    if (cause) execute(state, at, cause, out);
    else pardon(state, at, turn, pardonWhy, takeOffices, out);
  };

  // Refused the summons to answer charges: the terms were offered and he would not take them.
  if (state.history.chosen["L-002"] === "refuse" || flagTruthy(state, "rebel_king")) {
    judge("rebel", true, true, "", false);
    return out;
  }
  // Went and submitted. The ladder has already taken the office. A second pardon is not given.
  if (state.history.chosen["L-002"] === "go") {
    judge("L-002:go", false, mercy.pardons >= 1, "he went to the assembly and submitted", false);
    return out;
  }
  // Lost the field he had raised against the king. The magnates' bargain is not a failed rising.
  if (state.history.quest.phase === "failed" && state.history.chosen["Q-003"] !== "counter_offer") {
    judge(`quest:${state.history.quest.attempt}`, false, true, "the field was lost, and he was given his life on submission", true);
  }
  return out;
}
