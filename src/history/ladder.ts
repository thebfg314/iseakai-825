import type { WorldState } from "../engine/schema";
import { applyPeopleHappinessDelta } from "../engine/peopleHappiness";
import questTable from "../../data/history/tables/king-quest.json";
import { deliverEvent, type DeliveryResult, type HistoryBeat } from "./deliver";
import { flagInt, flagTruthy, totalManses } from "./flags";
import { historyContent } from "./load";
import { demoteBy } from "./promotion";
import type { SeasonAt } from "./scheduler";
import { ANGRY_BELOW, averageVassalMood, CONTENT_AT } from "./vassals";

/**
 * The king's escalation ladder (03_HISTORY §11.9; scripts "The king's
 * escalation ladder"). When the lord grows dangerous the king works down the
 * rungs: a warning (L-001), then strip the offices (L-002) if his people would
 * not rise for him, else excommunication (L-003) if his bishops can be found or
 * bought, else the road (L-004), which starts the quest. Gated by
 * `features.ladder`; the threshold needs renown and holdings only the later
 * passes provide. Submission at the warning returns the stage to none.
 */

type Table = {
  trigger: { renown: number; rank: number; manses: number; seasonsAtWarning: number };
  strip: { happinessBelow: number; ranksLost: number };
  excommunication: { favorChurchBelow: number; moodPerSeason: number };
};
const TABLE = questTable as unknown as Table;

export function ladderThresholdMet(state: WorldState): boolean {
  const renown = state.player.renown ?? 0;
  const rank = state.player.rankLevel ?? 1;
  return renown >= TABLE.trigger.renown && (rank >= TABLE.trigger.rank || totalManses(state) >= TABLE.trigger.manses);
}

/**
 * Rung 1 is open when a stripping would not be ugly: the lord's own people are unhappy and his sworn
 * men are not content enough to stand by him; or his sworn men are angry, whatever the people think.
 */
export function canStrip(state: WorldState): boolean {
  const sworn = (state.history.vassals ?? []).length > 0;
  const mood = averageVassalMood(state);
  if (sworn && mood < ANGRY_BELOW) return true;
  if (sworn && mood >= CONTENT_AT) return false;
  return state.peopleHappiness < TABLE.strip.happinessBelow;
}

/** Rung 2 is open unless the lord is his bishops' patron. */
export function canExcommunicate(state: WorldState): boolean {
  return flagInt(state, "favor_church") < TABLE.excommunication.favorChurchBelow && !flagTruthy(state, "excommunicated");
}

function setStage(state: WorldState, stage: WorldState["history"]["ladder"]["stage"], turn: number) {
  state.history.ladder.stage = stage;
  state.history.ladder.since = turn;
}

function deliver(state: WorldState, id: string, at: SeasonAt, turn: number, out: DeliveryResult) {
  const event = historyContent().byId.get(id);
  if (!event) return;
  delete state.history.hooksTaken[id];
  delete state.history.chosen[id];
  const r = deliverEvent(state, event, at, turn);
  out.beats.push(...r.beats);
  out.lines.push(...r.lines);
}

export function tickLadder(state: WorldState, at: SeasonAt, turn: number): DeliveryResult & { questStarts: boolean } {
  const out: DeliveryResult & { questStarts: boolean } = { beats: [], lines: [], questStarts: false };
  const content = historyContent();
  const ladder = state.history.ladder;

  // The ban costs the people's trust every season it stands, whatever the feature switches say about new rungs.
  if (flagTruthy(state, "excommunicated")) {
    applyPeopleHappinessDelta(state, TABLE.excommunication.moodPerSeason);
    out.lines.push("The ban stands; the people grow uneasy under a lord outside the Church.");
  } else if (ladder.stage === "excommunicated") {
    // Absolved by one of L-003's hooks.
    setStage(state, "none", turn);
    out.lines.push("The ban is lifted; the king's lawful tools are spent.");
    state.history.flags.absolved_once = true;
  }

  if (!content.features.ladder) return out;
  if (state.history.dead || state.history.away) return out;
  if (state.history.quest.phase !== "none" && state.history.quest.phase !== "failed" && state.history.quest.phase !== "submitted") return out;

  switch (ladder.stage) {
    case "none": {
      if (!ladderThresholdMet(state)) return out;
      // A cooldown after a submission or a stripping: the king does not start again at once.
      if (ladder.since !== null && turn - ladder.since < 8) return out;
      setStage(state, "warning", turn);
      deliver(state, "L-001", at, turn, out);
      return out;
    }
    case "warning": {
      const submitted = (state.history.hooksTaken["L-001"] ?? []).length > 0;
      if (submitted) {
        setStage(state, "none", turn);
        state.history.quest.phase = "submitted";
        state.history.quest.phaseTurn = turn;
        out.lines.push("The lord submitted at the warning; the king stops escalating.");
        return out;
      }
      if (ladder.since !== null && turn - ladder.since < TABLE.trigger.seasonsAtWarning) return out;
      if (!ladderThresholdMet(state)) {
        setStage(state, "none", turn);
        return out;
      }
      if (canStrip(state)) {
        setStage(state, "stripped", turn);
        deliver(state, "L-002", at, turn, out);
      } else if (canExcommunicate(state)) {
        setStage(state, "excommunicated", turn);
        deliver(state, "L-003", at, turn, out);
      } else {
        setStage(state, "attempt", turn);
        deliver(state, "L-004", at, turn, out);
      }
      return out;
    }
    case "stripped": {
      const chosen = state.history.chosen["L-002"];
      if (!chosen) return out; // the summons is still open
      if (chosen === "go") {
        const before = state.player.rankLevel ?? 1;
        const stripped = demoteBy(state, TABLE.strip.ranksLost, { by: `${state.history.realm.king ?? "the king"}, the king`, turn, at, eventId: "L-002" });
        out.lines.push(`The king took honours from the lord: rank ${before} → ${state.player.rankLevel}.`, ...stripped.lines);
        out.beats.push(stewardBeat("L-002", "It is done, my lord. He took the county and left you the land and your household, which is what a king does when he wants a man humbled and not desperate. Bernard of Septimania lost everything twice and held three counties again by 835. We climb back the ordinary way."));
        setStage(state, "none", turn);
      } else {
        // Refused: a rebel by his own choice. The king goes to the road.
        setStage(state, "attempt", turn);
        deliver(state, "L-004", at, turn, out);
      }
      return out;
    }
    case "excommunicated":
      return out; // waits on an absolution hook (handled above next season)
    case "attempt": {
      const chosen = state.history.chosen["L-004"];
      if (!chosen) return out;
      if (chosen === "submit") {
        setStage(state, "none", turn);
        state.history.quest.phase = "submitted";
        state.history.quest.phaseTurn = turn;
        state.history.quest.attempt += 1;
        out.lines.push("The lord submitted after the attempt on his life; the quest is closed for now.");
        return out;
      }
      setStage(state, "quest", turn);
      out.questStarts = true;
      return out;
    }
    case "quest":
      return out;
  }
  return out;
}

function stewardBeat(eventId: string, text: string): HistoryBeat {
  return { npcId: "steward", eventId, text };
}

/** One line for the prompt while the ladder is in play. */
export function ladderLine(state: WorldState): string | null {
  const s = state.history.ladder.stage;
  if (flagTruthy(state, "excommunicated")) return "The lord is under the bishops' ban: vassals drift, levies do not answer, no bishop hears his cases, and he cannot be crowned until it is lifted.";
  switch (s) {
    case "warning":
      return "The court has begun to talk about the lord; the king is watching. Gifts, a visit, or useful service would still the talk.";
    case "stripped":
      return "The lord is summoned to court to answer charges.";
    case "attempt":
      return "The king tried to have the lord killed on the road, and failed. Everyone suspects; nobody can prove it.";
    default:
      return null;
  }
}
