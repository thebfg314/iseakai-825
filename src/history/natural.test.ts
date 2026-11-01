import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { applyProposal } from "../engine/applyDelta";
import { defaultEventStub, rollSeasonEvents } from "../engine/events";
import { WorldStateSchema, type WorldState } from "../engine/schema";
import { lintHistoryStructure } from "./lint";
import { historyContent } from "./load";
import { calendarSeverity, grainMultiplier, tickHungerDebuffs, tickPrices } from "./prices";
import { runHistorySeasonPass, type HistoryPassResult } from "./season";
import { forcedSeverity, forcedWeatherFor, improvementsPresent } from "./weather";

/** Step C: forced weather, famine prices, the hungry-year reports, ergot. */

function fresh(): WorldState {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

const ORDER = ["spring", "summer", "autumn", "winter"] as const;
type Season = (typeof ORDER)[number];

function clockFor(state: WorldState) {
  const next = (): HistoryPassResult => {
    const i = ORDER.indexOf(state.meta.season);
    const incoming = i === 3 ? { year: state.meta.year + 1, season: ORDER[0] } : { year: state.meta.year, season: ORDER[i + 1] };
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

const hook = (state: WorldState, eventId: string, hookId: string, actor = "steward") =>
  applyProposal(state, { type: "history_hook", summary: "", eventId, hookId }, actor);

describe("natural events, prices and forced weather", () => {
  it("content lints and the famine calendar matches the scripts' table", () => {
    expect(lintHistoryStructure(historyContent())).toEqual([]);
    expect(calendarSeverity(840)).toBe("normal");
    expect(calendarSeverity(841)).toBe("shortage");
    expect(calendarSeverity(842)).toBe("famine");
    expect(calendarSeverity(846)).toBe("normal");
    expect(calendarSeverity(873)).toBe("famine");
    expect(calendarSeverity(896)).toBe("famine");
    expect(grainMultiplier("shortage", "oats")).toBe(2.5);
    expect(grainMultiplier("famine", "oats")).toBeCloseTo(7.8);
    expect(grainMultiplier("famine", "wheat")).toBe(6);
  });

  it("forced weather is read by year and season and doubles an unimproved villa's crop loss", () => {
    expect(forcedWeatherFor({ year: 841, season: "spring" })).toBe("w-flood");
    expect(forcedWeatherFor({ year: 841, season: "summer" })).toBeNull();
    expect(forcedWeatherFor({ year: 845, season: "winter" })).toBe("win-cold");
    expect(forcedWeatherFor({ year: 846, season: "winter" })).toBeNull();
    expect(forcedWeatherFor({ year: 859, season: "winter" })).toBe("win-cold");
    expect(forcedWeatherFor({ year: 873, season: "summer" })).toBe("w-storm");
    expect(forcedWeatherFor({ year: 896, season: "summer" })).toBe("w-storm");
    const state = fresh();
    expect(improvementsPresent(state)).toEqual(["barn"]); // the starting estate has a barn
    expect(forcedSeverity(state)).toBe(1.75);
    state.agriculture.rotation = "three_field";
    expect(forcedSeverity(state)).toBe(1.5);
    state.holdings[0].features = state.holdings[0].features.filter((f) => f !== "barn");
    state.agriculture.rotation = "two_field";
    expect(forcedSeverity(state)).toBe(2);
    for (const g of ["rye", "wheat", "barley", "oats"] as const) state.resources[g] = 100; // the stub is capped by stores
    const roll = rollSeasonEvents(state, { suppressOther: true, forcedWeatherId: "w-flood", forcedSeverity: 2 });
    expect(roll.weather.id).toBe("w-flood");
    expect(roll.other).toBeNull();
    const stub = defaultEventStub(roll.weather, state);
    expect(stub.direction).toBe("consume");
    expect(stub.amount).toBe(8);
    const plain = rollSeasonEvents(state, { suppressOther: true, forcedWeatherId: "w-flood", forcedSeverity: 1 });
    expect(defaultEventStub(plain.weather, state).amount).toBe(4);
  });

  it("prices rise with the calendar, cheap grains most, set regional_famine, and come back when it ends", () => {
    const state = fresh();
    const base = { ...state.market.oats };
    expect(tickPrices(state, { year: 840, season: "winter" }, 63)).toBeNull();
    expect(tickPrices(state, { year: 841, season: "spring" }, 65)).toMatch(/two or three times/);
    expect(state.market.oats.max).toBe(Math.round(base.max * 2.5));
    expect(state.flags.regional_famine).toBe(false);
    expect(tickPrices(state, { year: 842, season: "spring" }, 69)).toMatch(/four to eight/);
    expect(state.market.oats.max).toBe(Math.round(base.max * 7.8));
    expect(state.market.wheat.max).toBe(Math.round(8 * 6));
    expect(state.flags.regional_famine).toBe(true);
    expect(tickPrices(state, { year: 842, season: "summer" }, 70)).toBeNull();
    expect(tickPrices(state, { year: 846, season: "spring" }, 85)).toMatch(/come back/);
    expect(state.market.oats).toEqual(base);
    expect(state.flags.regional_famine).toBe(false);
    expect(state.history.prices.base).toEqual({});
  });

  it("an event may force a shortage for a few seasons outside the calendar", () => {
    const state = fresh();
    const clock = clockFor(state);
    clock.to(859, "autumn");
    const winter = clock.next();
    expect(winter.fired).toContain("N-859");
    expect(state.history.prices.eventSeverity).toBe("shortage");
    expect(state.modifiers.some((m) => m.source.includes("hard winter"))).toBe(true);
    expect(winter.forcedWeatherId).toBe(null); // the closing season was autumn 859
    clock.next(); // spring 860: the closing season was winter 859 → forced cold applied to that roll
    expect(state.history.prices.severity).toBe("shortage");
    clock.to(861, "spring");
    expect(state.history.prices.severity).toBe("normal");
  });

  it("two hungry seasons in a row eat the seed", () => {
    const state = fresh();
    state.flags.hunger = true;
    expect(tickHungerDebuffs(state)).toBeNull();
    expect(tickHungerDebuffs(state)).toMatch(/seed/);
    expect(state.modifiers.some((m) => m.target === "grain_yield" && m.effect.value === 0.9)).toBe(true);
    state.flags.hunger = false;
    tickHungerDebuffs(state);
    expect(state.history.prices.hungrySeasons).toBe(0);
  });

  it("the hungry years post their reports with the alms and profiteering hooks, and 845 closes them", () => {
    const state = fresh();
    const clock = clockFor(state);
    clock.to(830, "autumn");
    hook(state, "830-L1", "church_fixed", "chaplain");
    clock.to(840, "winter");
    const spring841 = clock.next();
    expect(spring841.fired).toEqual(["N-841", "841-01"]); // the famine report comes first (order -1)
    expect(spring841.refereeLines.some((l) => l.includes("famine calendar"))).toBe(false); // closing season winter 840 is not forced
    const summer841 = clock.next();
    expect(summer841.forcedWeatherId).toBe("w-flood"); // closing season spring 841
    expect(summer841.forcedSeverity).toBe(1.75);
    const autumn841 = clock.next();
    expect(autumn841.fired).toContain("N-841-A");
    state.resources.rye = 30;
    expect(hook(state, "N-841-A", "feed_hungry").ok).toBe(true);
    expect(state.history.flags.fed_hungry).toBe(1);
    expect(state.resources.rye).toBe(20);
    expect(hook(state, "N-841-A", "sell_dear").ok).toBe(true);
    expect(state.history.flags.profiteer).toBe(1);
    clock.to(845, "autumn");
    expect(state.history.fired["N-845"]).toBeDefined();
    expect(state.history.prices.severity).toBe("shortage");
    clock.to(846, "spring");
    expect(state.history.prices.severity).toBe("normal");
  });

  it("the burning sickness: the clue stays open for decades; the home outbreak spares an aware villa", () => {
    const aware = fresh();
    const c1 = clockFor(aware);
    c1.to(857, "autumn");
    expect(aware.history.fired["N-857"]).toBeDefined();
    c1.to(862, "spring");
    expect(hook(aware, "N-857", "inspect_rye").ok).toBe(true); // five years later, still open
    expect(aware.history.flags.ergot_aware).toBe(true);
    c1.to(868, "autumn");
    const winter = c1.next();
    expect(winter.fired).toContain("N-868-W");
    expect(winter.beats.some((b) => b.text.includes("You had the rye sorted"))).toBe(true);

    const unaware = fresh();
    const c2 = clockFor(unaware);
    c2.to(868, "autumn");
    const w2 = c2.next();
    expect(w2.beats.some((b) => b.text.includes("in two of our own houses"))).toBe(true);
    expect(unaware.history.openOutcomes.some((o) => o.eventId === "N-868-W")).toBe(true);
    const loyalty = Number(unaware.history.flags.local_loyalty ?? 0);
    expect(applyProposal(unaware, { type: "history_outcome", summary: "", eventId: "N-868-W", outcomeId: "explained_plainly" }, "referee").ok).toBe(true);
    expect(unaware.history.flags.ergot_aware).toBe(true);
    expect(unaware.history.flags.local_loyalty).toBe(loyalty + 3);
  });

  it("873: the locusts cut the yield, the fight against them claws some back; 895 reads the granary", () => {
    const state = fresh();
    const clock = clockFor(state);
    clock.to(873, "spring");
    const summer = clock.next();
    expect(summer.fired).toContain("N-873-S");
    expect(summer.beats[0].text).toBe("My lord, come and see. Come and see the sky.");
    expect(state.modifiers.some((m) => m.source.includes("locusts") && m.effect.value === 0.6)).toBe(true);
    expect(hook(state, "N-873-S", "trenches_and_fire").ok).toBe(true);
    expect(state.modifiers.some((m) => m.source.includes("fight against the locusts"))).toBe(true);
    clock.to(873, "autumn");
    state.resources.rye = 50;
    const vacant = state.holdings[0].manses.vacant;
    const free = state.holdings[0].manses.free;
    clock.next();
    expect(hook(state, "N-873-W", "buy_ruined_land").ok).toBe(true);
    expect(state.holdings[0].manses.free).toBe(free + 2);
    expect(state.holdings[0].manses.vacant).toBe(vacant);
    clock.to(895, "spring");
    const s895 = clock.next();
    expect(s895.beats[0].text).toContain("the granary is full"); // the villa has a barn
    const bare = fresh();
    const c2 = clockFor(bare);
    c2.to(895, "spring");
    for (const h of bare.holdings) h.features = h.features.filter((f) => f !== "barn"); // the villas that came with the rank have barns too
    expect(c2.next().beats[0].text).toContain("I wish I could say the granary was full");
  });
});
