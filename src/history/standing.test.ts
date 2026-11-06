import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { WorldStateSchema, type WorldState } from "../engine/schema";
import { evalCondition } from "./conditions";
import { applyFlagOp, conditionContext, flagInt } from "./flags";
import { churchStanding, hundredWord, migrateStanding, relationshipLine, trackBishop } from "./standing";
import type { FlagValue } from "./schema";

function fresh(): WorldState {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

describe("relationship scales", () => {
  it("keeps a point of church favour as one point above neutral, and the old gate of 3 as 53", () => {
    const state = fresh();
    expect(flagInt(state, "favor_church")).toBe(50);
    expect(evalCondition("favor_church >= 53", conditionContext(state))).toBe(false);
    expect(evalCondition("favor_church < 53", conditionContext(state))).toBe(true);
    expect(applyFlagOp(state, "favor_church", "+2")).toBeNull();
    expect(state.history.flags.favor_church).toBe(52);
    expect(hundredWord(52)).toBe("neither warm nor cold");
  });

  it("writes the immediate lord once, whether the script names opinion or trust", () => {
    const state = fresh();
    applyFlagOp(state, "count_opinion", "+1");
    applyFlagOp(state, "count_trust", "+1");
    expect(state.history.flags.lord_standing).toBe(52);
    expect(state.history.flags.count_opinion).toBe(52);
    expect(state.history.flags.count_trust).toBe(52);
  });

  it("moves the crown up for favour and down for displeasure, including a bare true", () => {
    const state = fresh();
    applyFlagOp(state, "charles_favor", "+2");
    applyFlagOp(state, "charles_disfavor", "+1");
    expect(state.history.flags.crown).toBe(51);
    expect(state.history.flags.charles_favor).toBe(51);
    applyFlagOp(state, "charles_disfavor", true);
    expect(state.history.flags.crown).toBe(50);
  });

  it("stops a house at ally, and a named rupture drops them to enemy", () => {
    const state = fresh();
    applyFlagOp(state, "favor_septimania", "+3");
    expect(state.history.flags.favor_septimania).toBe(2);
    expect(evalCondition("favor_septimania >= 2", conditionContext(state))).toBe(true);
    applyFlagOp(state, "enemy_septimania", true);
    expect(state.history.flags.enemy_septimania).toBe(true);
    expect(state.history.flags.favor_septimania).toBe(-2);
    applyFlagOp(state, "richard_respect", "+1");
    expect(state.history.flags.richard_respect).toBe(1);
  });

  it("folds the bishop into the church until the lord holds a county", () => {
    const state = fresh();
    applyFlagOp(state, "bishop_trust", "+2");
    expect(state.history.flags.favor_church).toBe(52);
    expect(state.history.flags.bishop_trust).toBeUndefined();
    state.player.rankLevel = 3;
    trackBishop(state);
    expect(state.history.flags.bishop_trust).toBe(52);
    applyFlagOp(state, "bishop_trust", "+1");
    expect(state.history.flags.bishop_trust).toBe(53);
    expect(state.history.flags.favor_church).toBe(52);
  });

  it("warms a patronised house without a second church track", () => {
    const state = fresh();
    applyFlagOp(state, "favor_church", "+1");
    state.history.flags.tournus_host = true;
    expect(churchStanding(state)).toBe(51);
    expect(churchStanding(state, "tournus")).toBe(61);
    expect(churchStanding(state, "oratory")).toBe(61);
    const line = relationshipLine(state);
    expect(line).toContain("Tournus");
    expect(line).not.toContain("51");
  });

  it("lifts an old save's small counters onto the scale once", () => {
    const history: { flags: Record<string, FlagValue>; standingV?: number } = {
      flags: { favor_church: 3, charles_favor: 2, charles_disfavor: 1, count_opinion: -2, favor_septimania: 4 },
    };
    migrateStanding(history);
    expect(history.flags.favor_church).toBe(53);
    expect(history.flags.crown).toBe(51);
    expect(history.flags.count_opinion).toBe(48);
    expect(history.flags.favor_septimania).toBe(2);
    migrateStanding(history);
    expect(history.flags.favor_church).toBe(53);
  });
});
