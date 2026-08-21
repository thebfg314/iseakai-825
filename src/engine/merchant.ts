import type { Season, WorldState } from "./schema";
import { clamp, round1 } from "./util";

export const MERCHANT_BASE_RANGE: Record<Season, { lo: number; hi: number }> = {
  spring: { lo: 0.25, hi: 0.3 },
  summer: { lo: 0.4, hi: 0.45 },
  autumn: { lo: 0.4, hi: 0.5 },
  winter: { lo: 0.1, hi: 0.15 },
};

const PEDDLER_WARES = [
  "salt",
  "iron",
  "wine",
  "honey",
  "linen",
  "wool",
  "charcoal",
  "copper",
  "tin",
  "hides",
  "beeswax",
  "trade_goods",
  "stone",
  "softwood",
] as const;

const NAMES = ["Gero", "Odo", "Liutward", "Isaac", "Boso", "Theudo", "Salamon", "Wichard"];

export type MerchantChanceBreakdown = {
  base: number;
  bonus: number;
  chance: number;
  notes: string[];
};

export function merchantAccessFlags(state: WorldState) {
  const features = state.holdings.flatMap((h) => h.features);
  return {
    major_river: state.trade.major_river,
    major_road: state.trade.major_road,
    landing_or_improved: features.includes("landing_stage") || features.includes("improved_road"),
    known_surplus: state.trade.known_surplus,
    remote: state.trade.remote,
    troubled: state.flags.active_threat,
  };
}

export function merchantChance(state: WorldState, season: Season = state.meta.season): MerchantChanceBreakdown {
  const range = MERCHANT_BASE_RANGE[season];
  const base = range.lo + Math.random() * (range.hi - range.lo);
  const access = merchantAccessFlags(state);
  const notes: string[] = [];
  let bonus = 0;

  if (access.major_river || access.major_road) {
    const add = access.major_river && access.major_road ? 0.15 : 0.12;
    bonus += add;
    notes.push(
      access.major_river && access.major_road
        ? "On a major river and a main road (+15%)"
        : access.major_river
          ? "Near a major river (+12%)"
          : "Near a main road (+12%)",
    );
  }
  if (access.landing_or_improved) {
    bonus += 0.1;
    notes.push("Landing stage or improved paths (+10%)");
  }
  if (access.known_surplus) {
    bonus += 0.08;
    notes.push("Known surplus / good repute (+8%)");
  }
  if (access.remote || access.troubled) {
    const pen = access.remote && access.troubled ? 0.15 : 0.12;
    bonus -= pen;
    notes.push(
      access.remote && access.troubled
        ? "Remote and troubled (−15%)"
        : access.remote
          ? "Remote district (−12%)"
          : "Trouble on the roads (−12%)",
    );
  }

  const chance = clamp(base + bonus, 0.02, 0.9);
  return { base, bonus, chance, notes };
}

export function rollMerchantVisit(
  state: WorldState,
  season: Season = state.meta.season,
): MerchantChanceBreakdown & { arrived: boolean } {
  const rolled = merchantChance(state, season);
  return { ...rolled, arrived: Math.random() < rolled.chance };
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateMerchantStock(): { resource: string; amount: number }[] {
  const count = 4 + Math.floor(Math.random() * 4);
  const pool = [...PEDDLER_WARES];
  const stock: { resource: string; amount: number }[] = [];
  for (let i = 0; i < count && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    const resource = pool.splice(idx, 1)[0];
    const amount = resource === "wine" || resource === "tin" || resource === "copper" ? 1 + Math.floor(Math.random() * 4) : 3 + Math.floor(Math.random() * 10);
    stock.push({ resource, amount });
  }
  return stock;
}

export function applyMerchantRoll(
  state: WorldState,
  result: MerchantChanceBreakdown & { arrived: boolean },
): string {
  state.merchant.last_chance = round1(result.chance * 100) / 100;
  state.npcs = state.npcs.filter((n) => n.id !== "merchant");
  if (!result.arrived) {
    state.flags.merchant_present = false;
    state.merchant.present = false;
    state.merchant.name = undefined;
    state.merchant.stock = [];
    const pct = Math.round(result.chance * 100);
    return `No merchant on the incoming season (chance ${pct}%: base ${Math.round(result.base * 100)}%${result.notes.length ? "; " + result.notes.join("; ") : ""}).`;
  }
  const name = pick(NAMES);
  state.flags.merchant_present = true;
  state.merchant.present = true;
  state.merchant.name = name;
  state.merchant.stock = generateMerchantStock();
  state.npcs.push({
    id: "merchant",
    name,
    role: "merchant",
    location: state.holdings[0]?.id ?? "fontenay",
    notes: "Itinerant trader. Buys estate surplus for coin and sells the wares on his carts. Leaves at the next season unless another visit is rolled.",
  });
  const goods = state.merchant.stock.map((s) => `${s.amount} ${s.resource}`).join(", ");
  const pct = Math.round(result.chance * 100);
  return `Merchant ${name} is in the district (chance ${pct}%). Wares: ${goods}.`;
}

export function syncTradeFromFeatures(state: WorldState): void {
  const features = state.holdings.flatMap((h) => h.features);
  if (features.includes("major_river_wharf")) state.trade.major_river = true;
  if (features.includes("major_road") || features.includes("highway")) state.trade.major_road = true;
}
