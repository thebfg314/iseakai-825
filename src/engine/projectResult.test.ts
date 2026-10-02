import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { applyProposal } from "./applyDelta";
import { PROJECT_CATALOG, lookupProject } from "./projectCatalog";
import { proposalBlurb } from "../ui/ledgerCopy";
import { withBeginShortfalls } from "./projectBegin";
import { resolveAgricultureAndProjects } from "./season";
import { WorldStateSchema, type MechanicalProposal, type WorldState } from "./schema";

const JARGON = /customCosts|\breward\b|\bresult\b|catalogue|proposal|JSON|start_project|projectKey/i;

function estate(): WorldState {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

function wood(state: WorldState): number {
  return state.resources.softwood + state.resources.hardwood;
}

function charcoalWork(amount: number): MechanicalProposal {
  return {
    type: "start_project",
    summary: "Burn charcoal",
    projectKey: "charcoal_burning",
    name: "Organized charcoal burning",
    holdingId: "fontenay",
    result: [{ resource: "charcoal", amount }],
  };
}

function finish(state: WorldState, projectId: string, men: number) {
  state.labour.assigned.push({ projectId, men, women: 0, youths: 0 });
  return resolveAgricultureAndProjects(state);
}

describe("a finished work pays the result that was named", () => {
  it("adds named charcoal only when the mound is finished, and takes the timber at the start", () => {
    const state = estate();
    const beforeCoal = state.resources.charcoal;
    const beforeWood = wood(state);
    const started = applyProposal(state, charcoalWork(1), "steward");
    expect(started.ok).toBe(true);
    expect(started.logLine).toMatch(/1 cart-load of charcoal/);
    expect(started.logLine).toMatch(/timber/i);
    expect(started.logLine).not.toMatch(JARGON);
    expect(state.resources.charcoal).toBe(beforeCoal);
    expect(wood(state)).toBe(beforeWood - 2);
    const mound = state.projects.find((p) => p.key === "charcoal_burning")!;
    expect(mound.result).toEqual([{ resource: "charcoal", amount: 1 }]);
    expect(mound.status).toBe("active");

    const lines = finish(state, mound.id, mound.labourDaysRequired);
    expect(mound.status).toBe("completed");
    expect(state.resources.charcoal).toBe(beforeCoal + 1);
    expect(lines.some((line) => /stores gain 1 cart-load of charcoal/.test(line.text))).toBe(true);
  });

  it("pays nothing if the work is cancelled, and nothing if no result was named", () => {
    const cancelled = estate();
    const coal = cancelled.resources.charcoal;
    const started = applyProposal(cancelled, charcoalWork(1), "steward");
    expect(started.ok).toBe(true);
    const mound = cancelled.projects.find((p) => p.key === "charcoal_burning")!;
    const stopped = applyProposal(
      cancelled,
      { type: "adjust_project", summary: "Stop the mound", projectId: mound.id, cancel: true },
      "steward",
    );
    expect(stopped.ok).toBe(true);
    expect(mound.status).toBe("cancelled");
    expect(cancelled.resources.charcoal).toBe(coal);
    expect(stopped.logLine).not.toMatch(/stores gain/i);

    const empty = estate();
    const before = empty.resources.charcoal;
    const plain = applyProposal(
      empty,
      {
        type: "start_project",
        summary: "Burn charcoal",
        projectKey: "charcoal_burning",
        holdingId: "fontenay",
      },
      "steward",
    );
    expect(plain.ok).toBe(true);
    const work = empty.projects.find((p) => p.key === "charcoal_burning")!;
    expect(work.result).toBeUndefined();
    finish(empty, work.id, work.labourDaysRequired);
    expect(work.status).toBe("completed");
    expect(empty.resources.charcoal).toBe(before);
    expect(empty.custom_resources).toEqual([]);
  });

  it("still clears an acre and still raises a building, and does not invent a timber yield", () => {
    const state = estate();
    state.resources.softwood = 20;
    state.resources.stone = 10;
    state.resources.charcoal = 6;
    const scrub = state.holdings[0].land.scrub;
    const arable = state.holdings[0].land.fertile_arable;
    const woodBefore = wood(state);
    const clearing = applyProposal(
      state,
      { type: "start_project", summary: "Clear an acre", projectKey: "clear_scrub", holdingId: "fontenay" },
      "steward",
    );
    expect(clearing.ok).toBe(true);
    const acre = state.projects.find((p) => p.key === "clear_scrub")!;
    finish(state, acre.id, acre.labourDaysRequired);
    expect(acre.status).toBe("completed");
    expect(state.holdings[0].land.scrub).toBe(scrub - 1);
    expect(state.holdings[0].land.fertile_arable).toBe(arable + 1);
    expect(wood(state)).toBe(woodBefore);

    const bloomery = applyProposal(
      state,
      { type: "start_project", summary: "A bloomery", projectKey: "bloomery", holdingId: "fontenay" },
      "smith",
    );
    expect(bloomery.ok).toBe(true);
    const shaft = state.projects.find((p) => p.key === "bloomery")!;
    const coalAfterCost = state.resources.charcoal;
    finish(state, shaft.id, shaft.labourDaysRequired);
    expect(shaft.status).toBe("completed");
    expect(state.holdings[0].features).toContain("bloomery");
    expect(state.resources.charcoal).toBe(coalAfterCost);
    expect(state.custom_resources.some((c) => c.id === "steel" || c.id === "charcoal")).toBe(false);
  });

  it("pays a timber yield on cleared scrub only when one was named", () => {
    const state = estate();
    const before = state.resources.softwood;
    const started = applyProposal(
      state,
      {
        type: "start_project",
        summary: "Clear an acre and keep the brushwood",
        projectKey: "clear_scrub",
        holdingId: "fontenay",
        result: [{ resource: "timber", amount: 1 }],
      },
      "steward",
    );
    expect(started.ok).toBe(true);
    expect(state.resources.softwood).toBe(before);
    const acre = state.projects.find((p) => p.key === "clear_scrub")!;
    finish(state, acre.id, acre.labourDaysRequired);
    expect(state.holdings[0].land.fertile_arable).toBe(33);
    expect(state.resources.softwood).toBe(before + 1);
  });

  it("does not spend timber on coppicing unless timber was named as a cost", () => {
    const state = estate();
    const before = wood(state);
    const started = applyProposal(
      state,
      {
        type: "start_project",
        summary: "Coppice the oak stools",
        projectKey: "coppice",
        name: "Coppice the oak stools",
        holdingId: "fontenay",
        customCosts: { labourDays: 8, lumber: 0, iron: 0, stone: 0 },
        result: [{ resource: "timber", amount: 2 }],
      },
      "steward",
    );
    expect(started.ok).toBe(true);
    expect(wood(state)).toBe(before);
    const work = state.projects.find((p) => p.key === "coppice")!;
    expect(work.materials.lumber).toBe(0);
    finish(state, work.id, work.labourDaysRequired);
    expect(work.status).toBe("completed");
    expect(state.resources.softwood).toBe(estate().resources.softwood + 2);

    const spending = estate();
    const woodBefore = wood(spending);
    const cut = applyProposal(
      spending,
      {
        type: "start_project",
        summary: "Coppice, using a cart of props",
        projectKey: "coppice_props",
        holdingId: "fontenay",
        customCosts: { labourDays: 8, lumber: 1, iron: 0, stone: 0 },
        result: [{ resource: "softwood", amount: 2 }],
      },
      "steward",
    );
    expect(cut.ok).toBe(true);
    expect(wood(spending)).toBe(woodBefore - 1);
  });

  it("pays steel or gunpowder the same way, with no table for either", () => {
    expect(PROJECT_CATALOG.some((p) => /steel|gunpowder/.test(p.key))).toBe(false);
    expect(lookupProject("charcoal_burning")).toMatchObject({ lumber: 2, iron: 0, stone: 0 });
    expect(lookupProject("charcoal_burning")).not.toHaveProperty("yield");

    const smith = estate();
    const iron = smith.resources.iron;
    const coal = smith.resources.charcoal;
    const started = applyProposal(
      smith,
      {
        type: "start_project",
        summary: "Make steel",
        projectKey: "steel",
        name: "Steel",
        holdingId: "fontenay",
        tag: "forge",
        customCosts: { labourDays: 12, lumber: 0, iron: 4, stone: 0, charcoal: 1 },
        result: [{ resource: "steel", amount: 3, unit: "pounds", name: "steel" }],
      },
      "smith",
    );
    expect(started.ok).toBe(true);
    expect(smith.resources.iron).toBe(iron - 4);
    expect(smith.resources.charcoal).toBe(coal - 1);
    expect(smith.custom_resources.find((c) => c.id === "steel")).toBeUndefined();
    resolveAgricultureAndProjects(smith);
    const made = smith.projects.find((p) => p.key === "steel")!;
    expect(made.status).toBe("completed");
    expect(smith.custom_resources.find((c) => c.id === "steel")).toMatchObject({ amount: 3, unit: "pounds" });

    const powder = estate();
    const begun = applyProposal(
      powder,
      {
        type: "start_project",
        summary: "Burn for powder",
        projectKey: "gunpowder",
        name: "Gunpowder",
        holdingId: "fontenay",
        customCosts: { labourDays: 8, lumber: 0, iron: 0, stone: 0 },
        result: [{ resource: "gunpowder", amount: 2, unit: "pounds", name: "gunpowder" }],
      },
      "steward",
    );
    expect(begun.ok).toBe(true);
    expect(powder.custom_resources).toEqual([]);
    const work = powder.projects.find((p) => p.key === "gunpowder")!;
    finish(powder, work.id, 8);
    expect(work.status).toBe("completed");
    expect(powder.custom_resources.find((c) => c.id === "gunpowder")).toMatchObject({ amount: 2, unit: "pounds" });
  });

  it("does not credit a result in time to begin another work in the same sitting", () => {
    const state = estate();
    state.resources.softwood = 20;
    state.resources.stone = 10;
    state.resources.charcoal = 1;
    const started = applyProposal(state, charcoalWork(5), "steward");
    expect(started.ok).toBe(true);
    expect(state.resources.charcoal).toBe(1);
    const bloomery = applyProposal(
      state,
      { type: "start_project", summary: "A bloomery", projectKey: "bloomery", holdingId: "fontenay" },
      "smith",
    );
    expect(bloomery.ok).toBe(false);
    expect(bloomery.reason).toMatch(/charcoal/i);
    expect(state.resources.charcoal).toBe(1);
    expect(state.projects.some((p) => p.key === "bloomery")).toBe(false);
  });
});

describe("speech uses the figure the books will pay", () => {
  it("brings a different spoken yield into line with the named result", () => {
    const state = estate();
    const proposal = charcoalWork(1);
    const speech = withBeginShortfalls(
      "We pile two cart-loads of wood and, when the mound is opened, two cart-loads of charcoal.",
      state,
      [proposal],
    );
    expect(speech).toMatch(/1 cart-load of charcoal/);
    expect(speech).not.toMatch(/two cart-loads of charcoal/i);
    expect(speech).toMatch(/two cart-loads of wood/i);
    expect(speech).not.toMatch(JARGON);

    const card = proposalBlurb(proposal, state);
    expect(card).toMatch(/2 cart-loads of timber/);
    expect(card).toMatch(/When the work is finished, the stores gain 1 cart-load of charcoal/);
    expect(card).not.toMatch(JARGON);

    const steel: MechanicalProposal = {
      type: "start_project",
      summary: "Make steel",
      projectKey: "steel",
      name: "Steel",
      holdingId: "fontenay",
      customCosts: { labourDays: 12, lumber: 0, iron: 4, stone: 0, charcoal: 1 },
      result: [{ resource: "steel", amount: 3, unit: "pounds", name: "steel" }],
    };
    const said = withBeginShortfalls("When it is done you will have ten pounds of steel.", state, [steel]);
    expect(said).toMatch(/3 pounds of steel/);
    expect(said).not.toMatch(/ten pounds/i);
    expect(proposalBlurb(steel, state)).toMatch(/3 pounds of steel/);
    expect(proposalBlurb(steel, state)).toMatch(/4 lb of iron/);
  });
});
