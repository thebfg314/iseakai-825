import { describe, expect, it } from "vitest";
import { evalCondition, parseCondition, referencedNames, type ConditionContext } from "./conditions";

function ctx(partial: Partial<ConditionContext> = {}): ConditionContext {
  return {
    flags: { side_830: "bernard", favor_septimania: 2, benefice_charter: true, ...(partial.flags ?? {}) },
    fired: (id) => id === "826-01",
    chose: (e, o) => e === "832-01" && o === "hedge",
    feature: (name) => name === "palisade",
    vars: { rank: 1, renown: 40, age: 24, year: 832, tenure: "benefice", swornTo: "count", units: 0, ...(partial.vars ?? {}) },
  };
}

describe("history condition grammar", () => {
  it("evaluates bare flags, comparisons, and strings", () => {
    const c = ctx();
    expect(evalCondition("benefice_charter", c)).toBe(true);
    expect(evalCondition("outlaw_832", c)).toBe(false);
    expect(evalCondition("side_830 == 'bernard'", c)).toBe(true);
    expect(evalCondition("side_830 = bernard", c)).toBe(true);
    expect(evalCondition("side_830 != 'rebel'", c)).toBe(true);
    expect(evalCondition("favor_septimania >= 2", c)).toBe(true);
    expect(evalCondition("favor_septimania > 2", c)).toBe(false);
    expect(evalCondition("missing_int >= 1", c)).toBe(false);
    expect(evalCondition("missing_int < 1", c)).toBe(true);
  });

  it("handles and/or/not with precedence and parentheses", () => {
    const c = ctx();
    expect(evalCondition("benefice_charter and rank >= 1", c)).toBe(true);
    expect(evalCondition("outlaw_832 or rank >= 1", c)).toBe(true);
    expect(evalCondition("outlaw_832 or rank >= 2 and benefice_charter", c)).toBe(false);
    expect(evalCondition("(outlaw_832 or rank >= 1) and benefice_charter", c)).toBe(true);
    expect(evalCondition("not outlaw_832", c)).toBe(true);
    expect(evalCondition("not (benefice_charter and rank >= 1)", c)).toBe(false);
  });

  it("resolves fired(), chose(), feature() and the named variables", () => {
    const c = ctx();
    expect(evalCondition("fired(826-01)", c)).toBe(true);
    expect(evalCondition("fired(830-02)", c)).toBe(false);
    expect(evalCondition("chose(832-01, hedge)", c)).toBe(true);
    expect(evalCondition("chose(832-01, refuse)", c)).toBe(false);
    expect(evalCondition("feature(palisade)", c)).toBe(true);
    expect(evalCondition("feature(stone_wall)", c)).toBe(false);
    expect(evalCondition("tenure == benefice and swornTo == 'count' and age >= 21 and year >= 830", c)).toBe(true);
    expect(evalCondition("renown >= 100", c)).toBe(false);
  });

  it("treats an empty condition as true and rejects garbage", () => {
    expect(evalCondition("", ctx())).toBe(true);
    expect(evalCondition(undefined, ctx())).toBe(true);
    expect(() => parseCondition("rank >=")).toThrow();
    expect(() => parseCondition("(rank >= 1")).toThrow();
    expect(() => parseCondition("rank >= 1 extra")).toThrow();
    expect(() => evalCondition("tenure > 'benefice'", ctx())).toThrow();
  });

  it("lists referenced names for the lint", () => {
    const refs = referencedNames("side_830 == 'bernard' and fired(826-01) and chose(832-01, hedge) and feature(palisade) and rank >= 2");
    expect(refs.flags).toEqual(["side_830", "rank"]);
    expect(refs.events).toEqual(["826-01", "832-01"]);
    expect(refs.choices).toEqual([["832-01", "hedge"]]);
    expect(refs.features).toEqual(["palisade"]);
  });
});
