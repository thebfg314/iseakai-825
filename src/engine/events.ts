import type { CanonicalResource, WorldState } from "./schema";
import { EVENT_CATALOG, type CatalogEvent, type EventPolarity } from "./eventCatalog";

export type RolledEvent = CatalogEvent & {
  crop?: string;
  livestock?: string;
  resolvedText: string;
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function polarityRoll(): EventPolarity {
  const r = Math.random();
  if (r < 0.5) return "negative";
  if (r < 0.8) return "positive";
  return "mixed";
}

function fromCategory(category: string, polarity: EventPolarity, extra?: (e: CatalogEvent) => boolean): CatalogEvent | null {
  let pool = EVENT_CATALOG.filter((e) => e.category === category && e.polarity === polarity);
  if (extra) pool = pool.filter(extra);
  if (pool.length === 0) {
    pool = EVENT_CATALOG.filter((e) => e.category === category);
    if (extra) pool = pool.filter(extra);
  }
  if (pool.length === 0) return null;
  return pick(pool);
}

function fillTemplate(state: WorldState, ev: CatalogEvent): RolledEvent {
  const grains = (["wheat", "rye", "barley", "oats"] as const).filter((g) =>
    state.holdings.some((h) => h.sown[g] > 0 || state.resources[g] > 0),
  );
  const livestock = (["cattle", "sheep", "pigs", "horses"] as const).filter((l) => state.resources[l] > 0);
  const crop = grains.length ? pick([...grains]) : "rye";
  const animal = livestock.length ? pick([...livestock]) : "cattle";
  const resolvedText = ev.text.replace("[random crop]", crop).replace("[random livestock type]", animal);
  return { ...ev, crop, livestock: animal, resolvedText };
}

function featureMatch(state: WorldState, feature?: string): boolean {
  if (!feature) return true;
  const features = state.holdings.flatMap((h) => h.features);
  const land = state.holdings[0]?.land;
  if (feature === "mill") return features.some((f) => f.startsWith("mill"));
  if (feature === "vineyard") return (land?.vineyard ?? 0) > 0;
  if (feature === "orchard") return (land?.orchard ?? 0) > 0;
  if (feature === "chapel") return features.includes("chapel") || features.includes("monastery");
  if (feature === "monastery") return features.includes("monastery");
  if (feature === "woodland") return (land?.woodland ?? 0) > 0;
  if (feature === "extract") return features.some((f) => f === "quarry" || f === "clay_pit" || f === "bloomery");
  if (feature === "fish_pond") return features.includes("fish_pond");
  return features.includes(feature);
}

export type SeasonRoll = {
  weather: RolledEvent;
  other: RolledEvent | null;
};

/**
 * `flags.regional_famine` is not rolled yet. A later famine event may set it.
 * While it stays false, hunger is this villa's own.
 */
export function rollSeasonEvents(state: WorldState): SeasonRoll {
  const weatherCat = state.meta.season === "winter" ? "winter_weather" : "weather";
  const weatherRaw = fromCategory(weatherCat, polarityRoll()) ?? EVENT_CATALOG.find((e) => e.category === weatherCat)!;
  const weather = fillTemplate(state, weatherRaw);

  type Weighted = { category: string; weight: number; extra?: (e: CatalogEvent) => boolean };
  const weighted: Weighted[] = [
    { category: "population", weight: 2 },
    {
      category: "religious",
      weight: state.holdings.some((h) => h.features.includes("monastery"))
        ? 3
        : state.flags.monastery_nearby || state.holdings.some((h) => h.features.includes("chapel"))
          ? 2
          : 1,
    },
    { category: "political", weight: 2 },
    { category: "threats", weight: state.flags.active_threat ? 3 : 1 },
    { category: "market", weight: 2 },
  ];
  if (state.projects.some((p) => p.status === "active")) {
    weighted.push({ category: "projects", weight: 3 });
  }
  if (state.holdings.some((h) => featureMatch(state, "mill") || h.land.vineyard > 0 || h.land.orchard > 0 || h.features.includes("chapel") || h.features.includes("monastery") || h.land.woodland > 0)) {
    weighted.push({
      category: "features",
      weight: 2,
      extra: (e) => featureMatch(state, e.feature),
    });
  }

  const total = weighted.reduce((s, w) => s + w.weight, 0);
  let r = Math.random() * total;
  let chosen = weighted[0];
  for (const w of weighted) {
    r -= w.weight;
    if (r <= 0) {
      chosen = w;
      break;
    }
  }
  const otherRaw = fromCategory(chosen.category, polarityRoll(), chosen.extra);
  const other = otherRaw ? fillTemplate(state, otherRaw) : null;

  return { weather, other };
}

export function defaultEventStub(
  ev: RolledEvent,
  state?: WorldState,
): { resource?: string; amount?: number; direction?: "gain" | "consume"; moodDelta?: number } {
  const grain = pickAffordableGrain(state, ev.crop, ev.polarity === "positive" ? 0 : 4);
  if (ev.polarity === "negative") {
    if (ev.crop && (ev.category === "weather" || ev.id.startsWith("w-"))) {
      if (grain) return { resource: grain.resource, amount: grain.amount, direction: "consume", moodDelta: -1 };
      return { moodDelta: -1 };
    }
    if (ev.livestock && ev.text.includes("animal")) {
      const have = state ? Number(state.resources[ev.livestock as CanonicalResource] ?? 0) : 1;
      if (have >= 1) return { resource: ev.livestock, amount: 1, direction: "consume", moodDelta: -1 };
      return { moodDelta: -1 };
    }
    if (grain) return { moodDelta: -1, resource: grain.resource, amount: grain.amount, direction: "consume" };
    return { moodDelta: -1 };
  }
  if (ev.polarity === "positive") {
    if (ev.crop) return { resource: ev.crop, amount: 4, direction: "gain", moodDelta: 1 };
    return { moodDelta: 1, resource: "trade_goods", amount: 1, direction: "gain" };
  }
  if (grain) return { moodDelta: 0, resource: grain.resource, amount: Math.min(1, grain.amount), direction: "consume" };
  return { moodDelta: 0 };
}

function pickAffordableGrain(
  state: WorldState | undefined,
  preferred: string | undefined,
  want: number,
): { resource: string; amount: number } | null {
  if (!state || want <= 0) {
    if (!state && preferred) return { resource: preferred, amount: want || 2 };
    return preferred ? { resource: preferred, amount: want || 2 } : { resource: "rye", amount: want || 2 };
  }
  const order = [preferred, "rye", "wheat", "barley", "oats"].filter(Boolean) as string[];
  for (const g of order) {
    const have = Number(state.resources[g as CanonicalResource] ?? 0);
    if (have >= 0.5) return { resource: g, amount: Math.min(want || 2, have) };
  }
  return null;
}
