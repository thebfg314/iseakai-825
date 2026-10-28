import arc1 from "../../data/history/events/arc1.json";
import arc2 from "../../data/history/events/arc2.json";
import arc3 from "../../data/history/events/arc3.json";
import arc4 from "../../data/history/events/arc4.json";
import arc5 from "../../data/history/events/arc5.json";
import arc6 from "../../data/history/events/arc6.json";
import arc7 from "../../data/history/events/arc7.json";
import arc8 from "../../data/history/events/arc8.json";
import arc9 from "../../data/history/events/arc9.json";
import church from "../../data/history/events/church.json";
import economy from "../../data/history/events/economy.json";
import natural from "../../data/history/events/natural.json";
import ending from "../../data/history/events/ending.json";
import duties from "../../data/history/events/duties.json";
import quest from "../../data/history/events/quest.json";
import flagsFile from "../../data/history/flags.json";
import realmFile from "../../data/history/calendar/realm.json";
import featuresFile from "../../data/history/features.json";
import {
  EventFileSchema,
  FeaturesSchema,
  FlagRegistrySchema,
  RealmCalendarSchema,
  SEASON_ORDER,
  type FlagDef,
  type HistoryEvent,
  type HistoryFeatures,
  type RealmCalendar,
} from "./schema";

export type HistoryContent = {
  events: HistoryEvent[];
  byId: Map<string, HistoryEvent>;
  flags: Map<string, FlagDef>;
  realm: RealmCalendar;
  features: HistoryFeatures;
};

const EVENT_FILES: unknown[] = [arc1, arc2, arc3, arc4, arc5, arc6, arc7, arc8, arc9, church, economy, natural, ending, duties, quest];

export function seasonIndex(season: string): number {
  const i = (SEASON_ORDER as readonly string[]).indexOf(season);
  return i < 0 ? 0 : i;
}

/** Absolute season ordinal: 825 spring = 0. */
export function seasonOrdinal(year: number, season: string): number {
  return (year - 825) * 4 + seasonIndex(season);
}

export function compareFires(a: HistoryEvent, b: HistoryEvent): number {
  const d = seasonOrdinal(a.fires.year, a.fires.season) - seasonOrdinal(b.fires.year, b.fires.season);
  if (d !== 0) return d;
  return a.order - b.order;
}

function build(files: unknown[]): HistoryContent {
  const events: HistoryEvent[] = [];
  for (const raw of files) {
    const parsed = EventFileSchema.parse(raw);
    events.push(...parsed.events);
  }
  events.sort(compareFires);
  const byId = new Map<string, HistoryEvent>();
  for (const e of events) {
    if (byId.has(e.id)) throw new Error(`Duplicate history event id ${e.id}`);
    byId.set(e.id, e);
  }
  const flags = new Map<string, FlagDef>();
  for (const f of FlagRegistrySchema.parse(flagsFile).flags) flags.set(f.id, f);
  return {
    events,
    byId,
    flags,
    realm: RealmCalendarSchema.parse(realmFile),
    features: FeaturesSchema.parse(featuresFile),
  };
}

let cached: HistoryContent | null = null;
let override: HistoryContent | null = null;

/** Content from data/history, validated once. */
export function historyContent(): HistoryContent {
  if (override) return override;
  if (!cached) cached = build(EVENT_FILES);
  return cached;
}

/** Tests: swap in a small calendar. Pass null to restore the shipped content. */
export function setHistoryContentForTests(content: { events?: unknown[]; features?: Partial<HistoryFeatures> } | null): void {
  if (!content) {
    override = null;
    return;
  }
  const base = build(content.events ? [{ arc: "test", events: content.events }] : EVENT_FILES);
  override = { ...base, features: { ...base.features, ...(content.features ?? {}) } };
}
