import type { WorldState } from "../engine/schema";
import type { HistoryBeat } from "./deliver";
import { historyContent, seasonOrdinal } from "./load";
import type { SeasonAt } from "./scheduler";
import type { RealmCalendar } from "./schema";

export type RealmNow = {
  emperor: string | null;
  king: string | null;
  kingdom: string;
  countOfAutun: string;
  countSince: number;
};

/** The chain emperor → our king → count of Autun as the game line has it at `at`. */
export function realmAt(at: SeasonAt, calendar: RealmCalendar = historyContent().realm): RealmNow {
  const now = seasonOrdinal(at.year, at.season);
  let emperor: string | null = null;
  for (const e of calendar.emperors) if (seasonOrdinal(e.from, e.season) <= now) emperor = e.name;
  let king: string | null = null;
  let kingdom = "Aquitaine";
  for (const k of calendar.kings) {
    if (seasonOrdinal(k.from, k.season) <= now) {
      king = k.name;
      kingdom = k.kingdom;
    }
  }
  let count = calendar.counts[0];
  for (const c of calendar.counts) {
    if (seasonOrdinal(c.from, c.season) <= now) count = c;
  }
  return { emperor, king, kingdom, countOfAutun: count.name, countSince: count.from };
}

export type RealmTick = { beats: HistoryBeat[]; countChanged: boolean; kingChanged: boolean };

/**
 * Bring history.realm up to `at`. A change of count fires an oath beat unless a
 * calendar event announces it (03_HISTORY §11.1); the player is sworn to the
 * new count by default unless his bond runs elsewhere.
 */
export function tickRealm(state: WorldState, at: SeasonAt): RealmTick {
  const calendar = historyContent().realm;
  const now = realmAt(at, calendar);
  const realm = state.history.realm;
  const beats: HistoryBeat[] = [];
  const countChanged = realm.countOfAutun !== now.countOfAutun;
  const kingChanged = realm.king !== now.king;
  const emperorChanged = realm.emperor !== now.emperor;
  if (countChanged) {
    const entry = calendar.counts.find((c) => c.name === now.countOfAutun && c.from === now.countSince);
    const announced = entry?.announcedBy && historyContent().byId.has(entry.announcedBy);
    const previous = realm.countOfAutun;
    realm.countOfAutun = now.countOfAutun;
    realm.countSince = now.countSince;
    if (realm.swornTo === "count" || realm.swornTo === "none") realm.swornTo = "count";
    if (!announced) {
      beats.push({
        npcId: "steward",
        eventId: `realm:count:${now.countSince}`,
        text: `Word from Autun, my lord. Count ${previous} holds the county no longer; it is ${now.countOfAutun} now. You will be asked to swear to him as you swore to the last, and the dues go to his officers from this season.`,
      });
    }
  }
  if (kingChanged && realm.king !== null) {
    const previous = realm.king;
    const entry = [...calendar.kings].reverse().find((k) => seasonOrdinal(k.from, k.season) <= seasonOrdinal(at.year, at.season));
    const announced = entry?.announcedBy && historyContent().byId.has(entry.announcedBy);
    const text = now.king
      ? `My lord, the household should know how to speak of it: our king is ${now.king} now, not ${previous}. The kingdom is called ${now.kingdom}.`
      : `My lord, there is no king over us that anyone in Autun will name. ${previous} is gone and the great men have not agreed on another.`;
    if (!announced) beats.push({ npcId: "steward", eventId: `realm:king:${at.year}`, text });
  }
  realm.emperor = now.emperor;
  realm.king = now.king;
  realm.kingdom = now.kingdom;
  if (emperorChanged && !countChanged && !kingChanged) {
    // Emperors change with events the calendar already tells; no separate beat.
  }
  return { beats, countChanged, kingChanged };
}

/** One line for the prompt: "Emperor Louis; our king Pippin of Aquitaine; Count Adalard of Autun (since 830). Sworn to the count." */
export function realmLine(state: WorldState): string {
  const r = state.history.realm;
  const parts = [
    r.emperor ? `Emperor ${r.emperor}` : "no emperor",
    r.king ? `our king ${r.king}` : "no king agreed",
    `Count ${r.countOfAutun} of Autun (since ${r.countSince})`,
  ];
  const sworn =
    r.swornTo === "count"
      ? "The lord is sworn to the count."
      : r.swornTo === "king"
        ? "The lord is the king's own vassal."
        : r.swornTo === "church"
          ? "The lord holds under the church."
          : "The lord is sworn to no one.";
  return `${parts.join("; ")}. ${sworn}`;
}
