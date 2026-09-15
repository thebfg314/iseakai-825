import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { applyProposal } from "./applyDelta";
import {
  applyPeopleHappinessDelta,
  HAPPINESS_ALMS,
  HAPPINESS_FEAST,
  HAPPINESS_GRAIN_ADEQUATE,
  HAPPINESS_HARSH,
  HAPPINESS_HARVEST,
  HAPPINESS_HUNGER,
  HAPPINESS_LABOUR_HEAVY,
  HAPPINESS_MOOD_PER_ADD,
  HAPPINESS_WAR,
  looksLikeAlms,
  PEOPLE_HAPPINESS_DEFAULT,
  peopleHappinessPressures,
  peopleHappinessSeasonDelta,
  standingOrderIsFeast,
  standingOrderIsHarsh,
  tickPeopleHappiness,
  tickPeopleHappinessFromSeason,
} from "./peopleHappiness";
import { resolveAgricultureAndProjects } from "./season";
import { WorldStateSchema, type WorldState } from "./schema";

function boot(extra?: (s: WorldState) => void): WorldState {
  const state = WorldStateSchema.parse(structuredClone(startingEstate));
  extra?.(state);
  return state;
}

describe("people happiness schema", () => {
  it("defaults to 50 on old saves that omit the field", () => {
    const raw = structuredClone(startingEstate) as { peopleHappiness?: number };
    delete raw.peopleHappiness;
    const state = WorldStateSchema.parse(raw);
    expect(state.peopleHappiness).toBe(PEOPLE_HAPPINESS_DEFAULT);
  });

  it("keeps the starting villa at settled mid-bar", () => {
    expect(boot().peopleHappiness).toBe(50);
  });
});

describe("standing-order language", () => {
  it("does not treat Keep Sundays or the default Fontenay order as feast or harsh", () => {
    const text = boot().standing_orders[0].text;
    expect(standingOrderIsFeast(text)).toBe(false);
    expect(standingOrderIsHarsh(text)).toBe(false);
    expect(standingOrderIsHarsh("Keep Sundays.")).toBe(false);
    expect(standingOrderIsFeast("Keep Sundays.")).toBe(false);
  });

  it("reads a village feast and Sunday labour as feast and harsh", () => {
    expect(standingOrderIsFeast("Hold a feast for the people each harvest.")).toBe(true);
    expect(standingOrderIsHarsh("Sunday labour on the demesne, and extra dues.")).toBe(true);
  });
});

describe("season pressures", () => {
  it("gives a modest grain bonus on the starting spring stores after the ration", () => {
    const state = boot();
    resolveAgricultureAndProjects(state);
    expect(state.flags.hunger).toBe(false);
    const ids = peopleHappinessPressures(state).map((p) => p.id);
    expect(ids).toContain("grain");
    expect(ids).not.toContain("hunger");
    expect(ids).not.toContain("harvest");
    expect(peopleHappinessSeasonDelta(state)).toBe(HAPPINESS_GRAIN_ADEQUATE);
  });

  it("falls when most extra-day hands are called", () => {
    const state = boot();
    state.labour.assigned = [{ projectId: "proj-heavy", men: 200, women: 200, youths: 50 }];
    expect(peopleHappinessPressures(state).find((p) => p.id === "labour")?.delta).toBe(HAPPINESS_LABOUR_HEAVY);
  });

  it("drops on hunger and skips the short-grain penalty beside it", () => {
    const state = boot();
    state.resources.wheat = 0;
    state.resources.rye = 0;
    state.resources.barley = 0;
    state.resources.oats = 0;
    resolveAgricultureAndProjects(state);
    expect(state.flags.hunger).toBe(true);
    const pressures = peopleHappinessPressures(state);
    expect(pressures).toEqual([{ id: "hunger", delta: HAPPINESS_HUNGER }]);
    const before = state.peopleHappiness;
    tickPeopleHappiness(state);
    expect(state.peopleHappiness).toBe(before + HAPPINESS_HUNGER);
  });

  it("rises when the harvest comes in", () => {
    const state = boot();
    state.meta.season = "summer";
    resolveAgricultureAndProjects(state);
    const delta = peopleHappinessSeasonDelta(state, { harvested: true });
    expect(delta).toBeGreaterThanOrEqual(HAPPINESS_HARVEST);
    expect(peopleHappinessPressures(state, { harvested: true }).some((p) => p.id === "harvest")).toBe(true);
  });

  it("falls on war/muster and on a harsh custom, rises on a feast custom", () => {
    const war = boot((s) => {
      s.flags.active_threat = true;
    });
    expect(peopleHappinessPressures(war).some((p) => p.id === "war" && p.delta === HAPPINESS_WAR)).toBe(true);

    const feast = boot();
    feast.standing_orders.push({ id: "so-feast", text: "Hold a feast for the people at harvest.", active: true });
    expect(peopleHappinessPressures(feast).some((p) => p.id === "feast" && p.delta === HAPPINESS_FEAST)).toBe(true);

    const harsh = boot();
    harsh.standing_orders.push({ id: "so-harsh", text: "Sunday labour on the demesne.", active: true });
    expect(peopleHappinessPressures(harsh).some((p) => p.id === "harsh" && p.delta === HAPPINESS_HARSH)).toBe(true);
  });

  it("counts a mood blessing and a muster event line", () => {
    const state = boot();
    state.modifiers.push({
      id: "mod-bless",
      target: "mood",
      kind: "temporary",
      seasons_remaining: 4,
      effect: { op: "add", value: 1 },
      source: "Ermenald's blessing",
    });
    expect(peopleHappinessPressures(state).some((p) => p.id === "mood" && p.delta === HAPPINESS_MOOD_PER_ADD)).toBe(
      true,
    );
    expect(tickPeopleHappinessFromSeason(boot(), ["Harvested 4 modii of wheat from 6 acres."], [{ id: "pol-muster" }])).toBe(
      peopleHappinessSeasonDelta(boot(), { harvested: true, muster: true }),
    );
  });

  it("clamps at the ends of the bar", () => {
    const low = boot();
    low.peopleHappiness = 2;
    applyPeopleHappinessDelta(low, -40);
    expect(low.peopleHappiness).toBe(0);
    const high = boot();
    high.peopleHappiness = 97;
    applyPeopleHappinessDelta(high, 20);
    expect(high.peopleHappiness).toBe(100);
  });
});

describe("alms from the stores", () => {
  it("reads alms language and ignores tithe and hiring gifts", () => {
    expect(looksLikeAlms("Denarii as alms for the poor")).toBe(true);
    expect(looksLikeAlms("Grain to the cell")).toBe(false);
    expect(looksLikeAlms("Hiring gift")).toBe(false);
  });

  it("nudges happiness when alms are written in the books", () => {
    const state = boot();
    const before = state.peopleHappiness;
    const r = applyProposal(
      state,
      {
        type: "transfer_resources",
        summary: "Alms for the poor",
        resource: "denarii",
        amount: 4,
        direction: "consume",
        reason: "alms",
      },
      "chaplain",
    );
    expect(r.ok).toBe(true);
    expect(state.peopleHappiness).toBe(before + HAPPINESS_ALMS);
  });
});
