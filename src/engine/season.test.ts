import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { WorldStateSchema } from "./schema";
import { resolveAgricultureAndProjects } from "./season";
import { cloneState } from "./state";

describe("Fontenay season sowing defaults", () => {
  it("spring sowing without adjust_sowing still uses 60/40 barley/oats of remaining", () => {
    const state = WorldStateSchema.parse(structuredClone(startingEstate));
    expect(state.holdings[0].land.fertile_arable).toBe(32);
    expect(state.holdings[0].sown).toEqual({ wheat: 6, rye: 7, barley: 0, oats: 0 });
    resolveAgricultureAndProjects(state);
    // remaining = 16 - 13 = 3; 0.6 → 1.8 barley, 1.2 oats
    expect(state.holdings[0].sown.barley).toBe(1.8);
    expect(state.holdings[0].sown.oats).toBe(1.2);
    expect(state.holdings[0].sown.wheat).toBe(6);
    expect(state.holdings[0].sown.rye).toBe(7);
  });

  it("autumn three-field sowing uses a third of the arable after the rotation is written", () => {
    const state = WorldStateSchema.parse(structuredClone(startingEstate));
    state.agriculture.rotation = "three_field";
    state.meta.season = "autumn";
    state.holdings[0].sown = { wheat: 0, rye: 0, barley: 1.8, oats: 1.2 };
    resolveAgricultureAndProjects(state);
    const sown = state.holdings[0].sown;
    expect(sown.wheat + sown.rye).toBeCloseTo(32 / 3, 1);
    expect(sown.barley).toBe(0);
    expect(sown.oats).toBe(0);
  });

  it("does not clone-mutate the starting JSON module", () => {
    const a = WorldStateSchema.parse(structuredClone(startingEstate));
    const b = cloneState(a);
    b.resources.denarii = 0;
    expect(WorldStateSchema.parse(structuredClone(startingEstate)).resources.denarii).toBe(138);
  });
});
