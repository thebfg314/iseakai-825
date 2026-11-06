import type { WorldState } from "../engine/schema";
import type { HistoryBeat } from "./deliver";
import { currentRank, demoteBy } from "./promotion";
import type { SeasonAt } from "./scheduler";
import { hundredValue } from "./standing";

/**
 * The viscount's office is held at the count's pleasure. He loses it for any of:
 *   - a name at the floor (renown 1);
 *   - not performing the office: musters unanswered, courts not held, dues not rendered;
 *   - his own villas emptying.
 * It does not go without warning. The count sends word he has heard complaints; then a
 * sharper word; then the dismissal. A lord in good standing with the count gets a quiet
 * word and a season more; a nuisance gets the minimum.
 *
 * On dismissal he is a minor noble again and keeps everything he owns: villas, manses,
 * mill, hall, tenants, household, improvements. What goes is the office and what came
 * with it: the deputy's share, the court, the authority, and any villa held of the count
 * rather than bought (promotion.ts demoteBy / forfeitFrom).
 *
 * Numbers (retunable): two musters or two courts missed, two tithes unrendered within two
 * years, households down to a third of what they were at the grant. Warnings a season apart;
 * standing with the count at 60 or better holds the sharper word one season longer.
 */

export const OFFICE_REFUSED_MUSTERS = 2;
export const OFFICE_LAPSED_CASES = 2;
export const OFFICE_TITHE_SLIPS = 2;
export const OFFICE_TITHE_WINDOW = 8;
/** Households at or below this share of the number at the grant count as the villas emptying. */
export const OFFICE_DEPOPULATION_SHARE = 1 / 3;
/** Standing with the count from which the sharper word waits a season longer. */
export const OFFICE_GOOD_STANDING = 60;

export type OfficeTick = { lines: string[]; beats: HistoryBeat[]; dismissed: boolean; cause: string | null };

/** The lord's own villas: the seat and what he owns, not what the office lent him. */
function ownHouseholds(state: WorldState): number {
  return state.population.households;
}

/** Why the count would be displeased, or null. */
export function officeCause(state: WorldState, turn: number): string | null {
  const o = state.history.office;
  if ((state.player.renown ?? 1) <= 1) return "a name worth nothing";
  if (o.refusedMusters >= OFFICE_REFUSED_MUSTERS) return "musters not answered";
  if (o.lapsedCases >= OFFICE_LAPSED_CASES) return "courts not held";
  const tithes = (state.church?.neglect ?? []).filter((s) => s.kind === "tithe" && s.turn >= turn - OFFICE_TITHE_WINDOW).length;
  if (tithes >= OFFICE_TITHE_SLIPS) return "dues not rendered";
  const at = o.householdsAtGrant;
  const now = ownHouseholds(state);
  if (now <= 0 || (at !== null && at > 0 && now <= Math.floor(at * OFFICE_DEPOPULATION_SHARE))) return "villas emptying";
  return null;
}

/** Called when the office is given (promotion.ts): the measure the villas are judged against. */
export function noteOfficeGranted(state: WorldState): void {
  const o = state.history.office;
  o.householdsAtGrant = state.population.households;
  o.refusedMusters = 0;
  o.lapsedCases = 0;
  o.stage = "none";
  o.since = null;
  o.cause = null;
}

export function noteMusterRefused(state: WorldState): void {
  state.history.office.refusedMusters += 1;
}

/** A muster answered works off one that was not. */
export function noteMusterAnswered(state: WorldState): void {
  const o = state.history.office;
  o.refusedMusters = Math.max(0, o.refusedMusters - 1);
}

/** A case judged in the hall works off one that lapsed. */
export function noteCourtHeld(state: WorldState): void {
  const o = state.history.office;
  o.lapsedCases = Math.max(0, o.lapsedCases - 1);
}

function countName(state: WorldState): string {
  return state.history.rank.patron ?? `${state.history.realm.countOfAutun}, count of Autun`;
}

const CAUSE_WORD: Record<string, string> = {
  "a name worth nothing": "that there is no name left to the man he set over his villas",
  "musters not answered": "that his musters have gone out and the viscount of this land did not come",
  "courts not held": "that men brought their quarrels to the hall and went home unjudged",
  "dues not rendered": "that what is owed upward has not been rendered",
  "villas emptying": "that the villas he gave are emptying under the man he gave them to",
};

/** Season tick for the viscount's office. Runs after the renown decay. */
export function tickOffice(state: WorldState, at: SeasonAt, turn: number): OfficeTick {
  const out: OfficeTick = { lines: [], beats: [], dismissed: false, cause: null };
  if (state.history.dead) return out;
  const o = state.history.office;
  if (currentRank(state) !== 2) {
    if (o.stage !== "none") {
      o.stage = "none";
      o.since = null;
      o.cause = null;
    }
    return out;
  }
  if (o.householdsAtGrant === null) o.householdsAtGrant = state.population.households;
  const cause = officeCause(state, turn);
  out.cause = cause;
  if (!cause) {
    if (o.stage !== "none") {
      out.beats.push({ npcId: "steward", eventId: "office:cleared", text: `My lord, word from ${countName(state)}: he has heard better of you, and the matter is let lie.` });
      out.lines.push("The count's complaint is let lie.");
      o.stage = "none";
      o.since = null;
      o.cause = null;
    }
    return out;
  }
  const standing = hundredValue(state, "lord");
  const goodStanding = standing >= OFFICE_GOOD_STANDING;
  const since = o.since ?? turn;
  const elapsed = turn - since;
  const sharpAt = goodStanding ? 2 : 1;
  const dismissAt = sharpAt + 1;
  const why = CAUSE_WORD[cause] ?? cause;
  o.cause = cause;
  if (o.stage === "none") {
    o.stage = "heard";
    o.since = turn;
    out.lines.push(`The count has heard complaints: ${cause}.`);
    out.beats.push({
      npcId: "steward",
      eventId: "office:heard",
      text: goodStanding
        ? `My lord, a quiet word has come from ${countName(state)}, and he meant it kindly: he has heard ${why}. He holds you well enough that he sent it privately and will give you time; but the office is his to give and his to take, and he wants the cause mended.`
        : `My lord, word has come from ${countName(state)}: he has heard ${why}. He does not say more than that, but the office is his to give and his to take. I would mend the cause before he sends again.`,
    });
    return out;
  }
  if (o.stage === "heard" && elapsed >= sharpAt) {
    o.stage = "sharp";
    out.lines.push(`The count's second word: ${cause}.`);
    out.beats.push({
      npcId: "steward",
      eventId: "office:sharp",
      text: `My lord, a second word from ${countName(state)}, and this one is not kind: ${why}, still, and he will not have it said that he keeps such a man in his office. If it is not mended by the next season he will give the office to another.`,
    });
    return out;
  }
  if (o.stage === "sharp" && elapsed >= dismissAt) {
    const by = countName(state);
    const r = demoteBy(state, 1, { by, turn, at, eventId: "office:dismissed" });
    out.lines.push(`Dismissed from the office of viscount by ${by} (${cause}).`, ...r.lines);
    o.stage = "none";
    o.since = null;
    o.cause = null;
    o.dismissals += 1;
    o.refusedMusters = 0;
    o.lapsedCases = 0;
    state.history.record.push({ year: at.year, season: at.season, text: `Dismissed from the office of viscount by ${by}: ${cause}.`, thread: "office" });
    out.dismissed = true;
    const lostVillas = r.lines.find((l) => l.startsWith("Benefices lost"));
    out.beats.push({
      npcId: "steward",
      eventId: "office:dismissed",
      text: `My lord, ${by} has given the office to another. The deputy's share, the court and the authority go with it${lostVillas ? `, and the villas held of him: ${lostVillas.replace("Benefices lost: ", "").replace(/\.$/, "")}` : ""}. What is yours is still yours: the hall, the land you own, the manses, the mill, the people and the household. We are what we were before he raised us, and a man has come back from that before now.`,
    });
  }
  return out;
}

/** One line for Aldric's prompt while the count is displeased. */
export function officeLine(state: WorldState, turn: number): string | null {
  if (currentRank(state) !== 2) return null;
  const o = state.history.office;
  const cause = officeCause(state, turn);
  if (!cause && o.stage === "none") return null;
  const stage = o.stage === "none" ? "no word yet" : o.stage === "heard" ? "first word sent" : "second, sharper word sent; dismissal next season if unmended";
  return `The office: the count holds it at his pleasure. Cause for complaint now: ${cause ?? "none (mended)"}; ${stage}. Musters unanswered ${o.refusedMusters}/${OFFICE_REFUSED_MUSTERS}, courts lapsed ${o.lapsedCases}/${OFFICE_LAPSED_CASES}. Dismissal takes the office, its share and its villas; the lord keeps what he owns.`;
}
