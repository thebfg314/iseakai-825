import { afterEach, describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import endingFile from "../../data/history/events/ending.json";
import { WorldStateSchema, type WorldState } from "../engine/schema";
import { deathChance, markDeath, participationBand, tickAge } from "./age";
import { endingFallback, endingFacts, endingSystemPrompt, endingUserPrompt } from "./ending";
import { seasonOrdinal, setHistoryContentForTests } from "./load";
import { runHistorySeasonPass, type HistoryPassResult } from "./season";
/** Step G: age and death, the life record, the closing page. */

function fresh(): WorldState {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

const ORDER = ["spring", "summer", "autumn", "winter"] as const;

function clockFor(state: WorldState) {
  const next = (): HistoryPassResult => {
    const i = ORDER.indexOf(state.meta.season);
    const incoming = i === 3 ? { year: state.meta.year + 1, season: ORDER[0] } : { year: state.meta.year, season: ORDER[i + 1] };
    const r = runHistorySeasonPass(state, incoming, state.meta.turn + 1, { coverUpkeep: true });
    state.meta.year = incoming.year;
    state.meta.season = incoming.season;
    state.meta.turn += 1;
    return r;
  };
  /** Place the state at the start of (year, season) without running the passes between. */
  const jump = (year: number, season: (typeof ORDER)[number]) => {
    state.meta.year = year;
    state.meta.season = season;
    state.meta.turn = seasonOrdinal(year, season) + 1;
  };
  return { next, jump };
}

afterEach(() => setHistoryContentForTests(null));

describe("age and death", () => {
  it("bands participation by age", () => {
    expect(participationBand(17)).toBe("all");
    expect(participationBand(49)).toBe("all");
    expect(participationBand(50)).toBe("subcommand_or_rear");
    expect(participationBand(65)).toBe("command_from_behind");
  });

  it("death cannot come before 910 and is certain by winter 911", () => {
    expect(deathChance({ year: 909, season: "winter" })).toBe(0);
    expect(deathChance({ year: 910, season: "spring" })).toBeGreaterThan(0);
    expect(deathChance({ year: 911, season: "autumn" })).toBeLessThan(1);
    expect(deathChance({ year: 911, season: "winter" })).toBe(1);
    const state = fresh();
    expect(tickAge(state, { year: 909, season: "winter" }, 340).died).toBe(false);
    expect(state.history.dead).toBeNull();
  });

  it("a run that lives to autumn 911 hears 911-F1, then dies by the winter, and the pass refuses to run on", () => {
    setHistoryContentForTests({ events: endingFile.events, features: { ladder: false, quest: false, promotions: false, diffusion: false } });
    const state = fresh();
    const clock = clockFor(state);
    clock.jump(909, "winter");
    const diedAt: string[] = [];
    let sawChartres = false;
    for (let i = 0; i < 12 && !state.history.dead; i++) {
      const r = clock.next();
      if (r.fired.includes("911-F1")) sawChartres = true;
      if (r.died) diedAt.push(`${state.meta.season} ${state.meta.year}`);
    }
    expect(state.history.dead).not.toBeNull();
    expect(state.history.dead?.cause).toBe("old_age");
    expect(state.history.dead?.year).toBeGreaterThanOrEqual(910);
    expect(state.history.dead?.year).toBeLessThanOrEqual(911);
    expect(diedAt).toHaveLength(1);
    // The ending record has the death in it, once.
    expect(state.history.record.filter((r) => r.thread === "ending")).toHaveLength(1);
    // Chartres is heard only if he was alive to hear it (the roll runs before the calendar).
    if (state.history.dead!.year === 911 && ORDER.indexOf(state.meta.season) >= 3) expect(sawChartres).toBe(true);
    // A second pass after death changes nothing: no events, no second death.
    const after = clock.next();
    expect(after.died).toBe(false);
    expect(after.fired).toEqual([]);
    expect(state.history.record.filter((r) => r.thread === "ending")).toHaveLength(1);
  });

  it("the winter 911 roll is certain whatever the seed", () => {
    setHistoryContentForTests({ events: [], features: { ladder: false, quest: false, promotions: false, diffusion: false } });
    for (const region of ["Burgundy", "Autunois", "Fontenay"]) {
      const state = fresh();
      state.meta.region = region;
      const clock = clockFor(state);
      clock.jump(911, "autumn");
      clock.next();
      expect(state.history.dead, region).not.toBeNull();
    }
  });

  it("a death in the field closes the chronicle the same way, once", () => {
    const state = fresh();
    markDeath(state, "battle");
    markDeath(state, "wound");
    expect(state.history.dead).toEqual({ cause: "battle", year: 825 });
    expect(state.history.record.filter((r) => r.thread === "ending")).toHaveLength(1);
    expect(state.history.record.at(-1)?.text).toMatch(/fell in battle, aged 17/);
  });
});

describe("the closing page", () => {
  it("renders a fallback and a prompt from the record", () => {
    const state = fresh();
    state.history.record.push({ year: 830, season: "summer", text: "He rode with the count to Compiègne.", thread: "politics" });
    state.history.dead = { cause: "old_age", year: 911 };
    const fallback = endingFallback(state);
    expect(fallback.death).toMatch(/911/);
    expect(fallback.summary.length).toBeGreaterThan(40);
    const facts = endingFacts(state);
    expect(facts.some((f) => f.startsWith("Station"))).toBe(true);
    const user = endingUserPrompt(state);
    expect(user).toContain("Compiègne");
    expect(endingSystemPrompt()).toContain('"speech"');
  });
});
