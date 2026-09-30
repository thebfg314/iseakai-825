import type { Season, WorldState } from "./schema";
import { memoriesForMerchantName, persistMerchantVisitorMemories } from "./memory";
import { clamp, round1 } from "./util";
import { resourceName } from "../ui/ledgerCopy";
import { beginMerchantVisitShop, persistMerchantPurseOnLeave } from "./merchantShop";
import { MANCIPIA_ID, MERCHANT_MANCIPIA_CHANCE } from "./mancipia";

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

/** Face index on main: 1 Gero.png, 2 Odo.png, 3 Liutward.png, 4 Theudo.png, 5 Boso.png, 6 Isaac.png, 7 Salamon.png, 8 Wichard.png. */
export const MERCHANT_NAMES = ["Gero", "Odo", "Liutward", "Theudo", "Boso", "Isaac", "Salamon", "Wichard"] as const;

export const MERCHANT_VISITORS = [
  {
    name: "Gero",
    face: 1,
    notes:
      "Loud Frank. Salt and gossip. Acts like he did you a favor by coming inland. Secretly insecure about his age.",
    voice:
      "You are a loud Frank. You talk salt and gossip, and you act as if you did the villa a favor by coming inland. You are secretly insecure about your age.",
  },
  {
    name: "Odo",
    face: 2,
    notes: "Careful. Names every toll and will not be hurried on a price. Stresses about all of the details all the time.",
    voice:
      "You are careful. You name every toll and will not be hurried on a price. You stress about all of the details all the time.",
  },
  {
    name: "Liutward",
    face: 3,
    notes: "Alemannic, proud of cloth. Talks quality until you want to sit down. Slight German accent.",
    voice:
      "You are Alemannic and proud of cloth. You talk quality until a man wants to sit down. Speak with a slight German accent.",
  },
  {
    name: "Theudo",
    face: 4,
    notes:
      "Keen eye for quality and a keener eye for a good deal. Ruthless when it comes to money but treats his good customers well.",
    voice:
      "You have a keen eye for quality and a keener eye for a good deal. You are ruthless when it comes to money, but you treat your good customers well.",
  },
  {
    name: "Boso",
    face: 5,
    notes: "Burgundian, wine on his breath. Bargains like it is sport. Maybe a slight slur to his speech.",
    voice:
      "You are Burgundian, wine on your breath. You bargain as if it is sport. Let a slight slur into your speech.",
  },
  {
    name: "Isaac",
    face: 6,
    notes:
      "Long-road trader, quiet. Keeps his own calendar. Best prices on things that came far. Uses slight Yiddish references.",
    voice:
      "You are a long-road trader, quiet. You keep your own calendar and give the best prices on things that came far. Use slight Yiddish references.",
  },
  {
    name: "Salamon",
    face: 7,
    notes: "Loves a good joke and has a quick tongue. Has a temper when it comes to bad deals.",
    voice:
      "You love a good joke and have a quick tongue, but you have a temper when it comes to bad deals.",
  },
  {
    name: "Wichard",
    face: 8,
    notes: "Blunt. Hides and bloom iron. Talks like a drover. Leaves early if you waste his day. Slight western cowboy drawl.",
    voice:
      "You are blunt. You talk hides and bloom iron like a drover, and you leave early if they waste your day. Speak with a slight western cowboy drawl.",
  },
] as const;

export type MerchantVisitorName = (typeof MERCHANT_NAMES)[number];

export function merchantVisitorByName(name: string | undefined): (typeof MERCHANT_VISITORS)[number] | undefined {
  if (!name) return undefined;
  return MERCHANT_VISITORS.find((v) => v.name === name);
}

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

export function generateMerchantStock(): { resource: string; amount: number }[] {
  const count = 3 + Math.floor(Math.random() * 3);
  const pool = [...PEDDLER_WARES];
  const stock: { resource: string; amount: number }[] = [];
  for (let i = 0; i < count && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    const resource = pool.splice(idx, 1)[0];
    const amount =
      resource === "wine" || resource === "tin" || resource === "copper"
        ? 1 + Math.floor(Math.random() * 3)
        : 2 + Math.floor(Math.random() * 6);
    stock.push({ resource, amount });
  }
  // Peddlers sometimes bring a few of the unfree to sell (design review: slaves were bought and sold).
  // They take the place of one ordinary line so the pack stays thin.
  if (Math.random() < MERCHANT_MANCIPIA_CHANCE) stock[stock.length - 1] = { resource: MANCIPIA_ID, amount: 1 + Math.floor(Math.random() * 3) };
  return stock;
}

export function applyMerchantRoll(
  state: WorldState,
  result: MerchantChanceBreakdown & { arrived: boolean },
): string {
  state.merchant.last_chance = round1(result.chance * 100) / 100;
  const leaving = state.npcs.find((n) => n.id === "merchant");
  if (leaving?.name) {
    persistMerchantVisitorMemories(state, leaving.name, leaving.memories ?? []);
    persistMerchantPurseOnLeave(state, leaving.name);
  }
  if (leaving?.name && leaving.introSpoken) {
    state.merchant_intro_spoken ??= {};
    state.merchant_intro_spoken[leaving.name] = true;
  }
  state.npcs = state.npcs.filter((n) => n.id !== "merchant");
  if (!result.arrived) {
    state.flags.merchant_present = false;
    state.merchant.present = false;
    state.merchant.name = undefined;
    state.merchant.face = undefined;
    state.merchant.stock = [];
    state.merchant.purse = undefined;
    state.merchant.purseStart = undefined;
    state.merchant.demand = undefined;
    state.merchant.buyback = [];
    state.merchant.boughtVolume = {};
    state.merchant.soldVolume = {};
    state.merchant.purseDrained = undefined;
    return "No merchant came with the new season.";
  }
  const idx = Math.floor(Math.random() * MERCHANT_VISITORS.length);
  const visitor = MERCHANT_VISITORS[idx];
  const name = visitor.name;
  const face = visitor.face;
  state.flags.merchant_present = true;
  state.merchant.present = true;
  state.merchant.name = name;
  state.merchant.face = face;
  state.merchant.stock = generateMerchantStock();
  beginMerchantVisitShop(state, name);
  state.npcs.push({
    id: "merchant",
    name,
    role: "merchant",
    location: state.holdings[0]?.id ?? "fontenay",
    notes: visitor.notes,
    memories: [...memoriesForMerchantName(state, name)],
    introSpoken: Boolean(state.merchant_intro_spoken?.[name]),
    wantsTalk: true,
  });
  const goods = state.merchant.stock.map((s) => `${s.amount} ${resourceName(s.resource)}`).join(", ");
  return `${name} the merchant is in the district. On the carts: ${goods || "nothing yet"}.`;
}

export function syncTradeFromFeatures(state: WorldState): void {
  const features = state.holdings.flatMap((h) => h.features);
  if (features.includes("major_river_wharf")) state.trade.major_river = true;
  if (features.includes("major_road") || features.includes("highway")) state.trade.major_road = true;
}
