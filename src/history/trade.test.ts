import { afterEach, describe, expect, it, vi } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { generateMerchantStock, merchantChance } from "../engine/merchant";
import { purseForVisit } from "../engine/merchantShop";
import { WorldStateSchema, type WorldState } from "../engine/schema";
import { negotiatorSystemPrompt } from "../llm/prompts";
import { applyEffects } from "./effects";
import { setHistoryContentForTests } from "./load";
import { historyPromptBlock } from "./promptBlocks";
import { seasonRevenue } from "./revenue";
import { promoteTo } from "./promotion";
import { EffectsSchema } from "./schema";
import { runHistorySeasonPass, type HistoryPassResult } from "./season";
import {
  merchantTradeFactor,
  noteRolledEventsForTrade,
  recomputeTradeHealth,
  shiftTrade,
  shockTrade,
  tickTrade,
  tradeGoodsPriceFactor,
  tradeHealth,
  tradeImprovements,
  tradeLine,
  tradeTarget,
  tradeWord,
} from "./trade";

/** Trade health (rank design 'Trade health'; 03_HISTORY §11.9). */

function fresh(): WorldState {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

const ORDER = ["spring", "summer", "autumn", "winter"] as const;
type Season = (typeof ORDER)[number];

function clockFor(state: WorldState) {
  const next = (): HistoryPassResult => {
    const i = ORDER.indexOf(state.meta.season);
    const incoming = i === 3 ? { year: state.meta.year + 1, season: ORDER[0] } : { year: state.meta.year, season: ORDER[i + 1] };
    if (state.battle_call) state.battle_call = null;
    const r = runHistorySeasonPass(state, incoming, state.meta.turn + 1);
    state.meta.year = incoming.year;
    state.meta.season = incoming.season;
    state.meta.turn += 1;
    return r;
  };
  const to = (year: number, season: Season): HistoryPassResult[] => {
    const all: HistoryPassResult[] = [];
    while (state.meta.year < year || (state.meta.year === year && ORDER.indexOf(state.meta.season) < ORDER.indexOf(season))) all.push(next());
    return all;
  };
  return { next, to };
}

const at = (state: WorldState) => ({ year: state.meta.year, season: state.meta.season as Season });

describe("trade health: the number and its layers", () => {
  afterEach(() => {
    setHistoryContentForTests(null);
    vi.restoreAllMocks();
  });

  it("starts at Autun's 55 and old saves get the whole block by default", () => {
    const state = fresh();
    expect(tradeHealth(state)).toBe(55);
    expect(state.history.trade.base).toBe(55);
    expect(state.history.trade.baseline).toBe(55);
    expect(state.history.trade.tollStance).toBe("customary");
    expect(tradeWord(55)).toBe("steady");
    const raw = structuredClone(startingEstate) as { history?: Record<string, unknown> };
    raw.history = { trade: { health: 40 } };
    const old = WorldStateSchema.parse(raw);
    expect(old.history.trade.health).toBe(40);
    expect(old.history.trade.shocks).toEqual([]);
    expect(old.history.trade.marketBase).toEqual({});
  });

  it("the lord's works set where the number rests: road, bridge, watch, mills and workshops, lodging, wine", () => {
    const state = fresh();
    // Fontenay starts with a forge: one draw.
    expect(tradeImprovements(state)).toEqual([{ what: "a mill or forge people come to", bonus: 3 }]);
    expect(tradeTarget(state)).toBe(58);
    state.holdings[0].features.push("improved_road", "bridge", "watch_post", "mill_flour", "tannery", "bakehouse", "pottery_kiln", "bloomery", "stables");
    state.holdings[0].land.vineyard = 12;
    const works = tradeImprovements(state);
    expect(works.find((w) => w.what === "the road kept up")?.bonus).toBe(3);
    expect(works.find((w) => w.what === "the bridge")?.bonus).toBe(5);
    expect(works.find((w) => w.what === "a watch kept on the road")?.bonus).toBe(5);
    expect(works.find((w) => w.what.startsWith("mills"))?.bonus).toBe(12); // six draws, four counted
    expect(works.find((w) => w.what === "lodging for travellers")?.bonus).toBe(2);
    expect(works.find((w) => w.what === "wine worth the journey")?.bonus).toBe(4);
    expect(tradeTarget(state)).toBe(55 + 3 + 5 + 5 + 12 + 2 + 4);
    // Tolls only count once the lord holds a county.
    state.history.trade.tollStance = "greedy";
    expect(tradeImprovements(state).some((w) => w.what === "greedy tolls")).toBe(false);
    state.player.rankLevel = 3;
    expect(tradeImprovements(state).find((w) => w.what === "greedy tolls")?.bonus).toBe(-10);
    state.history.trade.tollStance = "low";
    expect(tradeImprovements(state).find((w) => w.what === "tolls kept low")?.bonus).toBe(5);
  });

  it("a knock recovers at three points a year, five in full peace, and never past the target", () => {
    const state = fresh();
    state.holdings[0].features = ["manor_hall", "barn"]; // no draw: target 55
    shiftTrade(state, -20, "bandits on the road", 1);
    expect(tradeHealth(state)).toBe(35);
    expect(state.history.trade.lastCause).toBe("bandits on the road");
    tickTrade(state, { year: 825, season: "summer" }, 2);
    expect(state.history.trade.base).toBe(36.25); // peace: +5 a year
    shockTrade(state, -8, "the hard winter", 3, 1);
    tickTrade(state, { year: 825, season: "autumn" }, 3);
    expect(state.history.trade.base).toBe(37); // a shock standing: +3 a year
    expect(tradeHealth(state)).toBe(29);
    tickTrade(state, { year: 825, season: "winter" }, 4);
    expect(state.history.trade.shocks).toEqual([]); // the winter has passed
    expect(tradeHealth(state)).toBe(38.25);
    state.history.trade.base = 54.5;
    tickTrade(state, { year: 826, season: "spring" }, 5);
    expect(state.history.trade.base).toBe(55);
    // Above the target (a boost gone) it settles back down.
    state.history.trade.base = 60;
    tickTrade(state, { year: 826, season: "summer" }, 6);
    expect(state.history.trade.base).toBe(59.25);
  });

  it("Viking danger and famine weigh on the roads while they last, and a raid at the gate leaves a mark", () => {
    const state = fresh();
    state.history.vikings.danger = "high";
    expect(recomputeTradeHealth(state, 1)).toBe(25);
    state.history.vikings.danger = "moderate";
    expect(recomputeTradeHealth(state, 1)).toBe(40);
    state.history.vikings.danger = "low";
    expect(recomputeTradeHealth(state, 1)).toBe(50);
    state.history.vikings.danger = "none";
    state.history.prices.severity = "famine";
    expect(recomputeTradeHealth(state, 1)).toBe(40);
    state.history.prices.severity = "shortage";
    expect(recomputeTradeHealth(state, 1)).toBe(48);
    state.history.prices.severity = "normal";
    expect(recomputeTradeHealth(state, 1)).toBe(55);
    const before = state.history.trade.base;
    tickTrade(state, { year: 886, season: "winter" }, 248, { raid: true, armyAtHome: true });
    expect(state.history.trade.base).toBeLessThan(before - 19);
    expect(state.history.trade.lastCause).toBe("an army fed off the country");
  });

  it("the trade goods' bands move with the roads and come back; grain is the famine table's", () => {
    const state = fresh();
    const wine = { ...state.market.wine };
    const wheat = { ...state.market.wheat };
    state.history.trade.base = 25;
    tickTrade(state, { year: 825, season: "summer" }, 2);
    expect(tradeGoodsPriceFactor(tradeHealth(state))).toBeCloseTo(0.8, 1);
    expect(state.market.wine.max).toBeLessThan(wine.max);
    expect(state.market.wheat).toEqual(wheat);
    expect(state.history.trade.marketBase.wine).toEqual(wine);
    state.history.trade.base = 55;
    tickTrade(state, { year: 825, season: "autumn" }, 3);
    expect(state.market.wine).toEqual(wine);
    expect(state.history.trade.marketBase).toEqual({});
  });

  it("Aldric says once when the roads change band, and names the cause when they worsened", () => {
    const state = fresh();
    const first = tickTrade(state, { year: 825, season: "summer" }, 2);
    expect(first.beats).toEqual([]);
    state.history.trade.lastYear = 55;
    shiftTrade(state, -20, "the host on the roads", 3);
    const fall = tickTrade(state, { year: 825, season: "autumn" }, 3);
    expect(fall.beats).toHaveLength(1);
    expect(fall.beats[0].npcId).toBe("steward");
    expect(fall.beats[0].text).toContain("thin");
    expect(fall.beats[0].text).toContain("since the host on the roads");
    expect(fall.lines[0]).toBe("Trade on the roads is thin now.");
    const same = tickTrade(state, { year: 825, season: "winter" }, 4);
    expect(same.beats).toEqual([]);
  });
});

describe("trade health: what it does", () => {
  afterEach(() => vi.restoreAllMocks());

  it("no merchant below 20, the usual at 55, half again as many at 76; thin roads mean a thin pack and a thin purse", () => {
    expect(merchantTradeFactor(10)).toBe(0);
    expect(merchantTradeFactor(55)).toBe(1);
    expect(merchantTradeFactor(76)).toBe(1.6);
    expect(merchantTradeFactor(30)).toBeCloseTo(0.286, 2);
    const state = fresh();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const usual = merchantChance(state, "summer").chance;
    state.history.trade.health = 15;
    const none = merchantChance(state, "summer");
    expect(none.chance).toBe(0);
    expect(none.notes.at(-1)).toContain("no merchant will come");
    state.history.trade.health = 80;
    expect(merchantChance(state, "summer").chance).toBeCloseTo(Math.min(0.9, usual * 1.6), 5);
    vi.restoreAllMocks();
    for (let i = 0; i < 20; i++) {
      const thin = generateMerchantStock(20);
      expect(thin.length).toBeLessThanOrEqual(3);
      for (const line of thin) expect(["wine", "linen", "copper", "tin", "beeswax", "trade_goods", "honey"]).not.toContain(line.resource);
      expect(generateMerchantStock(80).length).toBeGreaterThanOrEqual(4);
    }
    state.history.trade.health = 82.5;
    expect(purseForVisit(state, undefined)).toBe(1500);
    state.history.trade.health = 20;
    expect(purseForVisit(state, undefined)).toBe(500);
    state.history.trade.health = 55;
    expect(purseForVisit(state, undefined)).toBe(1000);
  });

  it("tolls and market dues at Count read the same number", () => {
    const state = fresh();
    promoteTo(state, 3, { patron: "the king", turn: 40 });
    const even = seasonRevenue(state);
    state.history.trade.health = 27.5;
    const thin = seasonRevenue(state);
    expect(thin.tolls).toBe(Math.round(even.tolls / 2));
    expect(thin.market).toBe(Math.round(even.market / 2));
  });

  it("rolled events move the roads before the merchant roll, and a watch keeps bandits from it", () => {
    const state = fresh();
    const lines = noteRolledEventsForTrade(state, ["win-cold", "th-bandits"], 2);
    expect(lines).toContain("Word of bandits keeps the carts away.");
    expect(state.history.trade.base).toBe(45);
    expect(state.history.trade.shocks).toEqual([{ reason: "the hard winter", amount: -8, untilTurn: 2 }]);
    expect(tradeHealth(state)).toBe(37);
    // Counted once a turn.
    expect(noteRolledEventsForTrade(state, ["th-bandits"], 2)).toEqual([]);
    expect(state.history.trade.base).toBe(45);
    const watched = fresh();
    watched.holdings[0].features.push("watch_post");
    expect(noteRolledEventsForTrade(watched, ["th-armed"], 2)[0]).toContain("watch on the road");
    expect(watched.history.trade.base).toBe(55);
    const host = fresh();
    noteRolledEventsForTrade(host, ["pol-muster", "mkt-demand"], 2);
    expect(host.history.trade.base).toBe(48);
  });

  it("Gerulf and Aldric read the roads in words, never a figure", () => {
    const state = fresh();
    const line = tradeLine(state);
    expect(line).toContain("trade is steady");
    expect(line).toContain("a mill or forge people come to");
    expect(line).not.toMatch(/\b55\b/);
    state.history.trade.lastYear = 55;
    shiftTrade(state, -22, "the border drawn at the Saône", 2);
    const worse = tradeLine(state);
    expect(worse).toContain("trade is thin, thinner than last year");
    expect(worse).toContain("poorer since the border drawn at the Saône");
    expect(worse).not.toMatch(/\b33\b/);
    expect(negotiatorSystemPrompt(state)).toContain("trade is thin");
    expect(negotiatorSystemPrompt()).not.toContain("The roads (");
    expect(historyPromptBlock(state, "steward")).toContain("The roads (Gerulf's reading");
    expect(historyPromptBlock(state, "chaplain")).not.toContain("The roads (Gerulf's reading");
  });

  it("the data moves it: a `trade` effect shifts, shocks for a span, or moves the baseline for good", () => {
    const state = fresh();
    const fx = (e: unknown) => EffectsSchema.parse(e);
    const r1 = applyEffects(state, fx({ trade: { shift: -10, reason: "the border drawn at the Saône" } }), "843-02:onFire");
    expect(r1.lines).toEqual(["Trade on the roads suffers: the border drawn at the Saône."]);
    expect(state.history.trade.base).toBe(45);
    applyEffects(state, fx({ trade: { shift: -10, seasons: 4, reason: "the king's levy" } }), "E-866:onFire");
    expect(state.history.trade.shocks).toEqual([{ reason: "the king's levy", amount: -10, untilTurn: state.meta.turn + 4 }]);
    expect(tradeHealth(state)).toBe(35);
    const r3 = applyEffects(state, fx({ trade: { baseline: 10, reason: "the monks at Tournus" } }), "875-V1:onFire");
    expect(r3.lines).toEqual(["Trade on the roads picks up: the monks at Tournus."]);
    expect(state.history.trade.baseline).toBe(65);
    expect(tradeTarget(state)).toBe(68);
  });

  it("the calendar's knocks land: Verdun, the ransoms, Tournus, the Saracens, Cluny", () => {
    const state = fresh();
    const clock = clockFor(state);
    clock.to(843, "winter");
    expect(state.history.trade.lastCause).toBe("the border drawn at the Saône");
    expect(state.history.trade.base).toBeLessThan(55);
    clock.to(866, "winter");
    expect(state.history.trade.shocks.some((s) => s.reason.includes("levy"))).toBe(true);
    clock.to(868, "spring");
    expect(state.history.trade.shocks.some((s) => s.reason.includes("levy"))).toBe(false);
    clock.to(875, "summer");
    expect(state.history.trade.baseline).toBe(55 + 8 + 10); // Chalon's coin (864) and Tournus
    clock.to(887, "autumn");
    expect(state.history.trade.lastCause).toMatch(/Northmen|Saracens|army/);
    expect(tradeHealth(state)).toBeLessThan(45); // the Northmen in Burgundy
    clock.to(910, "winter");
    expect(state.history.trade.baseline).toBe(83);
  });
});

describe("trade health: the season pass", () => {
  it("runs inside the history pass each season and the household lines reach the ledger", () => {
    const state = fresh();
    const clock = clockFor(state);
    const first = clock.next();
    expect(state.history.trade.lastWord).toBe("steady");
    expect(first.effects.some((l) => l.startsWith("Trade on the roads"))).toBe(false);
    state.history.trade.base = 20;
    const r = clock.next();
    expect(r.effects).toContain("Trade on the roads is very thin now.");
    expect(at(state).season).toBe("autumn");
  });
});
