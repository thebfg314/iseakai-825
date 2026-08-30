import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { consumeGrain, grainOnHand, HOUSEHOLD_SEASON_GRAIN } from "./grain";
import { WorldStateSchema } from "./schema";

describe("household grain ration", () => {
  it("takes rye first and leaves the other grains", () => {
    const state = WorldStateSchema.parse(structuredClone(startingEstate));
    expect(grainOnHand(state)).toBe(20);
    const note = consumeGrain(state, HOUSEHOLD_SEASON_GRAIN, "Otto's house");
    expect(note).toMatch(/0\.5 rye/);
    expect(state.resources.rye).toBe(7.5);
    expect(state.resources.wheat).toBe(5);
    expect(state.flags.hunger).toBe(false);
  });
});
