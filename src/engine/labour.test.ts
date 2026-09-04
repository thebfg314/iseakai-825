import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { applyProposal } from "./applyDelta";
import { labourPool, labourRemaining } from "./labour";
import { maxRisk, yieldMultiplier } from "./modifiers";
import { WorldStateSchema, type WorldState } from "./schema";

function boot(): WorldState {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

function withActiveProject(state: WorldState, id = "proj-scrub"): WorldState {
  state.projects.push({
    id,
    key: "clear_scrub",
    name: "Clear scrub",
    holdingId: state.holdings[0].id,
    labourDaysRequired: 35,
    labourDaysDone: 0,
    materials: { lumber: 0.5, iron: 4, stone: 0 },
    materialsReserved: true,
    status: "active",
  });
  return state;
}

describe("extra labour days and harvest risk", () => {
  it("does not set harvest_risk or cut yield when most extra male days are assigned", () => {
    const state = withActiveProject(boot());
    expect(state.meta.season).toBe("spring");
    expect(labourPool(state).men).toBe(180);

    const beforeYield = yieldMultiplier(state, "rye");
    const assigned = applyProposal(
      state,
      {
        type: "assign_labour",
        summary: "Put men on the scrub",
        projectId: "proj-scrub",
        men: 150,
        women: 0,
        youths: 0,
      },
      "steward",
    );

    expect(assigned.ok).toBe(true);
    expect(state.labour.assigned).toEqual([{ projectId: "proj-scrub", men: 150, women: 0, youths: 0 }]);
    expect(labourRemaining(state).men).toBe(30);
    expect(state.labour.harvest_risk).toBe(false);
    expect(yieldMultiplier(state, "rye")).toBe(beforeYield);
    expect(maxRisk(state, "harvest_risk")).toBe(0);
  });

  it("still rejects assignments past the extra-day pool", () => {
    const state = withActiveProject(boot());
    const result = applyProposal(
      state,
      {
        type: "assign_labour",
        summary: "Too many men",
        projectId: "proj-scrub",
        men: 181,
        women: 0,
        youths: 0,
      },
      "steward",
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Not enough callable labour/);
    expect(state.labour.assigned).toEqual([]);
    expect(state.labour.harvest_risk).toBe(false);
  });

  it("still applies an explicit harvest_risk modifier", () => {
    const state = boot();
    const before = yieldMultiplier(state, "rye");
    const added = applyProposal(
      state,
      {
        type: "add_modifier",
        summary: "Late weather",
        target: "harvest_risk",
        kind: "temporary",
        seasonsRemaining: 1,
        effect: { op: "add", value: 0.2 },
        source: "w-timing",
      },
      "referee",
    );
    expect(added.ok).toBe(true);
    expect(state.labour.harvest_risk).toBe(false);
    expect(maxRisk(state, "harvest_risk")).toBe(0.2);
    expect(yieldMultiplier(state, "rye")).toBeCloseTo(before * 0.8, 8);
  });
});
