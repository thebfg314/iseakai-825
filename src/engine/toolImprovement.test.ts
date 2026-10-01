import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { applyProposal } from "./applyDelta";
import { yieldMultiplier } from "./modifiers";
import { WorldStateSchema, type MechanicalProposal, type ModifierTarget, type WorldState } from "./schema";
import {
  IMPROVEMENT_ALREADY,
  STEWARD_TOOL_IMPROVEMENT,
  WORK_NOT_FINISHED,
  finishedToolReady,
  lordToldStewardToUseTool,
  parseSpokenImprovement,
  prepareStewardToolProposals,
} from "./toolImprovement";

function boot(): WorldState {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

function gain(target: ModifierTarget, value: number, source = "The people use the new tool"): MechanicalProposal {
  return {
    type: "add_modifier",
    summary: "The work yields more",
    target,
    kind: "permanent",
    effect: { op: "multiply", value },
    source,
  };
}

function plough(): MechanicalProposal {
  return {
    type: "start_project",
    summary: "One plough of a new design: a long heavy coulter, a wider one-sided share, an iron-shod wooden board, and a socketed replaceable share.",
    projectKey: "heavy_coulter_plough",
    name: "Heavy coulter plough",
    holdingId: "fontenay",
    customCosts: { labourDays: 12, lumber: 2, iron: 8, stone: 0, charcoal: 1 },
  };
}

describe("a new tool is an ordinary modifier", () => {
  it("instructs Aldric on scale, and does not name a plough multiplier", () => {
    expect(STEWARD_TOOL_IMPROVEMENT).toMatch(/around a quarter more/);
    expect(STEWARD_TOOL_IMPROVEMENT).toMatch(/not a doubling/);
    expect(STEWARD_TOOL_IMPROVEMENT).toMatch(/for each change/);
    expect(STEWARD_TOOL_IMPROVEMENT).toMatch(/not a ceiling on all of them together/);
    expect(STEWARD_TOOL_IMPROVEMENT).toMatch(/Do not grant the same improvement twice/);
    expect(STEWARD_TOOL_IMPROVEMENT).toMatch(/the same plough/);
    expect(STEWARD_TOOL_IMPROVEMENT).toMatch(/the same manuring custom/);
    expect(STEWARD_TOOL_IMPROVEMENT).toMatch(/the same legume change/);
    expect(STEWARD_TOOL_IMPROVEMENT).toMatch(/A different improvement that also raises grain is not a duplicate/);
    expect(STEWARD_TOOL_IMPROVEMENT).toMatch(/three-field rotation is adjust_sowing/);
    expect(STEWARD_TOOL_IMPROVEMENT).not.toMatch(/does not stack a second time/);
    expect(STEWARD_TOOL_IMPROVEMENT).toMatch(/Historians do not have a clean medieval percent/);
    expect(STEWARD_TOOL_IMPROVEMENT).toMatch(/turning plough against a scratch-plough/);
    expect(STEWARD_TOOL_IMPROVEMENT).toMatch(/about a quarter more wheat/);
    expect(STEWARD_TOOL_IMPROVEMENT).toMatch(/new clay land and less cross-ploughing/);
    expect(STEWARD_TOOL_IMPROVEMENT).toMatch(/not getting from one new plough/);
    expect(STEWARD_TOOL_IMPROVEMENT).not.toMatch(/mouldboard|moldboard/i);
    expect(STEWARD_TOOL_IMPROVEMENT).not.toMatch(/\b1\.2\b/);
  });

  it("reads a named figure, and does not invent one", () => {
    expect(parseSpokenImprovement("The fields will give a quarter more.")).toBe(1.25);
    expect(parseSpokenImprovement("One part in four, no more.")).toBe(1.25);
    expect(parseSpokenImprovement("The hands finish a fifth more of the work.")).toBe(1.2);
    expect(parseSpokenImprovement("Twice — no, a quarter more.")).toBe(1.25);
    expect(parseSpokenImprovement("A quarter less is lost in the barn.")).toBe(0.75);
    expect(parseSpokenImprovement("The rye stands well, my lord.")).toBeNull();
  });

  it("treats putting the people on the tool as the ask, and forging as not enough", () => {
    expect(lordToldStewardToUseTool("Put the people onto the new tool.")).toBe(true);
    expect(lordToldStewardToUseTool("Bernard has forged the new tool.")).toBe(false);
    expect(lordToldStewardToUseTool("How will the harvest fare?")).toBe(false);
    expect(lordToldStewardToUseTool("Sow more barley on the remaining acres.")).toBe(false);
  });

  it("forging a tool writes no yield", () => {
    const state = boot();
    const before = yieldMultiplier(state);
    const started = applyProposal(state, plough(), "smith");
    expect(started.ok).toBe(true);
    expect(state.modifiers).toEqual([]);
    expect(yieldMultiplier(state)).toBe(before);
  });

  it("refuses Bernard a field yield, and writes a second grain gain when the reason is new", () => {
    const state = boot();
    const fromSmith = applyProposal(state, gain("grain_yield", 1.25, "The plough that turns the earth"), "smith");
    expect(fromSmith.ok).toBe(false);
    expect(fromSmith.reason).toBe("npc_not_authorized");
    expect(state.modifiers).toEqual([]);

    const first = applyProposal(state, gain("grain_yield", 1.25, "The plough that turns the earth"), "steward");
    expect(first.ok).toBe(true);
    expect(yieldMultiplier(state)).toBeCloseTo(1.25);

    const manure = applyProposal(state, gain("grain_yield", 1.25, "Spring manuring"), "steward");
    expect(manure.ok).toBe(true);
    expect(state.modifiers).toHaveLength(2);
    expect(yieldMultiplier(state)).toBeCloseTo(1.25 * 1.25);

    const again = applyProposal(state, gain("grain_yield", 1.25, "Spring manuring"), "steward");
    expect(again.ok).toBe(false);
    expect(again.reason).toBe(IMPROVEMENT_ALREADY);
    expect(state.modifiers).toHaveLength(2);
    expect(yieldMultiplier(state)).toBeCloseTo(1.25 * 1.25);

    const labour = applyProposal(state, gain("labour_efficiency", 1.2, "The hands finish more of the work"), "steward");
    expect(labour.ok).toBe(true);
    expect(state.modifiers.map((m) => m.target).sort()).toEqual(["grain_yield", "grain_yield", "labour_efficiency"]);
  });

  it("lets a loss on the same target stand beside a different reason", () => {
    const state = boot();
    applyProposal(state, gain("grain_yield", 1.25, "The plough that turns the earth"), "steward");
    const loss = applyProposal(state, gain("grain_yield", 0.8, "A thin year"), "steward");
    expect(loss.ok).toBe(true);
    expect(yieldMultiplier(state)).toBeCloseTo(1);
  });

  it("copies the spoken figure onto the card only after Aldric is asked", () => {
    const state = boot();
    const proposal = gain("grain_yield", 2);
    const early = prepareStewardToolProposals(
      state,
      "Bernard has forged the new tool.",
      [proposal],
      "The fields will give a quarter more.",
    );
    expect(early.proposals).toEqual([]);
    expect(early.note).toBeUndefined();

    const begun = applyProposal(
      state,
      {
        type: "start_project",
        summary: "A tool for the fields",
        projectKey: "field_tool",
        name: "Field tool",
        holdingId: "fontenay",
        customCosts: { labourDays: 1, lumber: 0, iron: 0, stone: 0 },
      },
      "steward",
    );
    expect(begun.ok).toBe(true);
    const unfinished = prepareStewardToolProposals(
      state,
      "Put the people onto the new tool.",
      [gain("grain_yield", 2)],
      "The fields will give a quarter more.",
    );
    expect(unfinished.proposals).toEqual([]);
    expect(unfinished.note).toBe(WORK_NOT_FINISHED);
    expect(finishedToolReady(state, "Put the people onto the new tool.")).toBe(false);

    const made = state.projects.find((p) => p.key === "field_tool");
    if (!made) throw new Error("missing work");
    made.status = "completed";

    const asked = prepareStewardToolProposals(
      state,
      "Put the people onto the new tool.",
      [gain("grain_yield", 2)],
      "The fields will give a quarter more.",
    );
    expect(asked.proposals).toHaveLength(1);
    expect(asked.proposals[0]).toMatchObject({ effect: { op: "multiply", value: 1.25 } });

    const quiet = prepareStewardToolProposals(
      state,
      "Put the people onto the new tool.",
      [gain("labour_efficiency", 1.15, "The hands finish more of the work")],
      "The hands will get through more of the work.",
    );
    expect(quiet.proposals[0]).toMatchObject({ effect: { op: "multiply", value: 1.15 } });
  });

  it("keeps a husbandry custom with no finished tool, and a second grain reason beside the first", () => {
    const state = boot();
    const manure = prepareStewardToolProposals(
      state,
      "Manure the fields in spring.",
      [gain("grain_yield", 2, "Spring manuring")],
      "Spring manuring will give a quarter more.",
    );
    expect(manure.note).toBeUndefined();
    expect(manure.proposals).toHaveLength(1);
    expect(manure.proposals[0]).toMatchObject({ effect: { op: "multiply", value: 1.25 }, source: "Spring manuring" });

    applyProposal(state, manure.proposals[0], "steward");
    const legumes = prepareStewardToolProposals(
      state,
      "Add legumes to the spring planting.",
      [gain("grain_yield", 2, "Legumes in the spring planting")],
      "The spring planting will give a quarter more.",
    );
    expect(legumes.proposals).toHaveLength(1);
    expect(legumes.proposals[0]).toMatchObject({ source: "Legumes in the spring planting" });

    const repeat = prepareStewardToolProposals(
      state,
      "Manure the fields in spring.",
      [gain("grain_yield", 1.25, "Spring manuring")],
      "Spring manuring will give a quarter more.",
    );
    expect(repeat.proposals).toEqual([]);
    expect(repeat.note).toBe(IMPROVEMENT_ALREADY);
  });
});
