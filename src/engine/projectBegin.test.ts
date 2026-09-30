import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { applyProposal } from "./applyDelta";
import { labourPool } from "./labour";
import { proposalBlurb } from "../ui/ledgerCopy";
import { WorldStateSchema, type MechanicalProposal, type WorldState } from "./schema";
import { projectStoreBill, stillNeededSentence, withBeginShortfalls } from "./projectBegin";

const JARGON = /customCosts|catalogue|proposal|JSON|start_project|projectKey/i;

function estate(): WorldState {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

function plough(over?: Partial<{ charcoal: number; iron: number; denarii: number; labourDays: number }>): MechanicalProposal {
  return {
    type: "start_project",
    summary: "A heavy plough",
    projectKey: "heavy_plough",
    name: "Heavy plough",
    holdingId: "fontenay",
    tag: "forge",
    customCosts: {
      labourDays: over?.labourDays ?? 40,
      lumber: 2,
      iron: over?.iron ?? 8,
      stone: 0,
      charcoal: over?.charcoal ?? 6,
      denarii: over?.denarii ?? 0,
    },
  };
}

describe("begin costs the books will take", () => {
  it("uses catalogue charcoal and ignores a made-up charcoal figure on a known work", () => {
    const bill = projectStoreBill({
      type: "start_project",
      summary: "Bloomery",
      projectKey: "bloomery",
      customCosts: { labourDays: 10, lumber: 1, iron: 40, stone: 1, charcoal: 20 },
    });
    expect(bill.charcoal).toBe(2);
    expect(bill.iron).toBe(40);
    expect(bill.denarii).toBe(0);
  });

  it("keeps a new design's charcoal and coin, which Confirm then takes", () => {
    const state = estate();
    expect(state.resources.iron).toBe(25);
    expect(state.resources.denarii).toBe(138);
    state.resources.charcoal = 6;
    state.resources.denarii = 200;
    const started = applyProposal(state, plough({ denarii: 40 }), "smith");
    expect(started.ok).toBe(true);
    expect(started.logLine).toMatch(/6 cart-loads of charcoal/);
    expect(started.logLine).toMatch(/40 denarii/);
    expect(started.logLine).not.toMatch(JARGON);
    expect(state.resources.charcoal).toBe(0);
    expect(state.resources.iron).toBe(17);
    expect(state.resources.denarii).toBe(160);
    const refused = applyProposal(estate(), plough({ charcoal: 6 }), "smith");
    expect(refused.ok).toBe(false);
    expect(refused.reason).toMatch(/Need 6 cart-loads of charcoal; have 1/);
  });
});

describe("shortage speech matches the card", () => {
  it("names only the charcoal still wanted, not iron the stores already hold, and not twenty loads", () => {
    const state = estate();
    const proposal = plough();
    const speech = withBeginShortfalls(
      "A good idea, but we would need more charcoal and more iron. Call it twenty loads of charcoal.",
      state,
      [proposal],
    );
    expect(speech).toMatch(/5 cart-loads of charcoal/);
    expect(speech).not.toMatch(/twenty/i);
    expect(speech).not.toMatch(/more iron/i);
    expect(speech).not.toMatch(/\biron\b/i);
    expect(speech).not.toMatch(JARGON);

    const card = proposalBlurb(proposal, state);
    expect(card).toMatch(/6 cart-loads of charcoal/);
    expect(card).toMatch(/8 lb of iron/);
    expect(card).toMatch(/2 cart-loads of timber/);
    expect(card).toMatch(/40 days of work/);
    expect(card).not.toMatch(/5 cart-loads of charcoal/);
    expect(card).not.toMatch(JARGON);
    expect(speech).not.toMatch(/\b6 cart-loads of charcoal\b/);
  });

  it("names every catalogue gap and skips a store the work does not spend", () => {
    const state = estate();
    const proposal: MechanicalProposal = {
      type: "start_project",
      summary: "Flour mill",
      projectKey: "flour_mill",
      name: "Flour mill",
      holdingId: "fontenay",
    };
    const speech = withBeginShortfalls("We cannot begin. More timber, more iron, more stone, and more charcoal.", state, [proposal]);
    expect(speech).toMatch(/8 cart-loads of timber/);
    expect(speech).toMatch(/35 lb of iron/);
    expect(speech).toMatch(/3 cart-loads of stone/);
    expect(speech).not.toMatch(/charcoal/i);
    expect(speech).toMatch(/Before the flour mill can begin/i);
    const card = proposalBlurb(proposal, state);
    expect(card).toMatch(/11 cart-loads of timber/);
    expect(card).toMatch(/60 lb of iron/);
    expect(card).toMatch(/4 cart-loads of stone/);
    expect(card).not.toMatch(/charcoal/i);
  });

  it("does not call iron short once the stores cover the catalogue charge", () => {
    const state = estate();
    state.resources.iron = 80;
    state.resources.softwood = 20;
    state.resources.stone = 10;
    const proposal: MechanicalProposal = {
      type: "start_project",
      summary: "Flour mill",
      projectKey: "flour_mill",
      name: "Flour mill",
      holdingId: "fontenay",
    };
    const speech = withBeginShortfalls("It needs more iron, twenty pounds of iron at least.", state, [proposal]);
    expect(speech).not.toMatch(/more iron/i);
    expect(speech).not.toMatch(/twenty/i);
    expect(speech).toMatch(/60 lb of iron/);
    expect(speech).not.toMatch(/still need/i);
  });

  it("names the coin still wanted, not only the full purse", () => {
    const state = estate();
    state.resources.charcoal = 10;
    const proposal = plough({ denarii: 200, charcoal: 1 });
    const speech = withBeginShortfalls("The chest cannot bear it.", state, [proposal]);
    expect(speech).toMatch(/62 denarii/);
    expect(speech).not.toMatch(/charcoal/i);
    expect(proposalBlurb(proposal, state)).toMatch(/200 denarii leave the chest/);
    expect(stillNeededSentence("Heavy plough", [])).toBe("");
  });

  it("names the days of work still wanted when the hands asked exceed the season", () => {
    const state = estate();
    const pool = labourPool(state);
    expect(pool.men).toBe(180);
    const speech = withBeginShortfalls("There are not enough hands.", state, [
      {
        type: "assign_labour",
        summary: "Hands",
        projectId: "heavy_plough",
        men: 200,
        women: 0,
        youths: 0,
      },
    ]);
    expect(speech).toMatch(/20 days of the men's work/);
    expect(speech).not.toMatch(JARGON);
  });

  it("rewrites a bare twenty loads to the charcoal still wanted", () => {
    const speech = withBeginShortfalls("We would need twenty loads.", estate(), [plough()]);
    expect(speech).toMatch(/5 cart-loads of charcoal/);
    expect(speech).not.toMatch(/twenty/i);
  });

  it("keeps a full cost that is already right and still adds the gap it would hide", () => {
    const state = estate();
    const speech = withBeginShortfalls("The plough takes 6 cart-loads of charcoal.", state, [plough()]);
    expect(speech).toMatch(/6 cart-loads of charcoal/);
    expect(speech).toMatch(/5 cart-loads of charcoal/);
  });
});
