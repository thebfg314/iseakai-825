import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { applyProposal } from "./applyDelta";
import type { MechanicalProposal } from "./schema";
import {
  BERNARD_BLOOMERY_MENTION,
  BERNARD_BOG_ORE_SPEECH,
  BLOOMERY_SMELT_CHARCOAL,
  BLOOMERY_SMELT_DAYS,
  BLOOMERY_SMELT_IRON,
  bernardBloomeryPitch,
  bloomeryNotReadyReason,
  bloomeryStartProposal,
  bloomerySuggestReady,
  estateHasBloomery,
  inferSmithProposals,
  looksLikeBloomeryOrder,
  playerAskedBloomery,
  smeltBloomeries,
} from "./bloomery";
import { lookupProject } from "./projectCatalog";
import { WorldStateSchema, type WorldState } from "./schema";
import { resolveAgricultureAndProjects } from "./season";
import { playerFacingReason } from "../ui/ledgerCopy";

function boot(): WorldState {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

function stockForBloomery(state: WorldState) {
  state.resources.softwood = 6;
  state.resources.hardwood = 2;
  state.resources.stone = 4;
  state.resources.charcoal = 6;
  state.resources.denarii = 200;
}

describe("bloomery", () => {
  it("is not among the works Fontenay starts with", () => {
    const state = boot();
    expect(state.holdings[0].features).toEqual(["manor_hall", "barn", "forge", "chapel", "monastery"]);
    expect(estateHasBloomery(state)).toBe(false);
    expect(state.projects.some((p) => p.key === "bloomery")).toBe(false);
    expect(bloomerySuggestReady(state)).toBe(false);
  });

  it("waits until the stores can bear the same charge Confirm will take", () => {
    const state = boot();
    expect(state.resources.denarii).toBe(138);
    expect(bloomerySuggestReady(state)).toBe(false);
    expect(bloomeryNotReadyReason(state)).toMatch(/not yet/i);
    expect(bloomeryNotReadyReason(state)).toMatch(/timber/i);
    expect(bloomeryNotReadyReason(state)).toMatch(/stone/i);
    expect(bloomeryNotReadyReason(state)).toMatch(/charcoal/i);
    expect(inferSmithProposals(state, "Build a bloomery.")).toEqual([]);
    expect(inferSmithProposals(state, "Good day, Bernard.")).toEqual([]);

    state.resources.softwood = 6;
    state.resources.hardwood = 0;
    state.resources.stone = 4;
    state.resources.charcoal = 1;
    state.resources.denarii = 200;
    expect(bloomerySuggestReady(state)).toBe(false);
    expect(bloomeryNotReadyReason(state)).toMatch(/1 cart-load of charcoal/);
    expect(bloomeryNotReadyReason(state)).not.toMatch(/timber/i);

    state.projects.push({
      id: "char-1",
      key: "charcoal_burning",
      name: "Organized charcoal burning",
      holdingId: "fontenay",
      labourDaysRequired: 60,
      labourDaysDone: 10,
      materials: { lumber: 2, iron: 0, stone: 0 },
      materialsReserved: true,
      status: "active",
    });
    expect(bloomerySuggestReady(state)).toBe(false);

    state.resources.charcoal = 2;
    state.resources.denarii = 40;
    expect(bloomerySuggestReady(state)).toBe(true);
    expect(bloomeryNotReadyReason(state)).toBeNull();
    expect(inferSmithProposals(state, "Good day, Bernard.")).toEqual([]);
    expect(playerAskedBloomery("Tell me more about the bloomery.")).toBe(true);
    const proposed = inferSmithProposals(state, "I want a bloomery.");
    expect(proposed).toHaveLength(1);
    expect(proposed[0]).toMatchObject({ type: "start_project", projectKey: "bloomery", name: "Bloomery" });
    expect(proposed[0].summary).toMatch(/bloomery/i);
    expect(proposed[0].summary).toMatch(/clay/i);
    const pitch = bernardBloomeryPitch();
    expect(pitch).toMatch(/4 cart-loads of timber/);
    expect(pitch).toMatch(/2 cart-loads of stone/);
    expect(pitch).toMatch(/2 cart-loads of charcoal/);
    expect(pitch).toMatch(/clay/i);
    expect(pitch).toMatch(/bog ore/i);
    expect(pitch).toMatch(/bought iron still goes further/i);
    expect(BERNARD_BLOOMERY_MENTION).toMatch(/steady supply of iron/i);
    expect(BERNARD_BLOOMERY_MENTION).toMatch(/ask me/i);
    expect(BERNARD_BLOOMERY_MENTION).not.toMatch(/confirm/i);

    state.holdings[0].features.push("bloomery");
    expect(bloomerySuggestReady(state)).toBe(false);
    expect(bloomeryNotReadyReason(state)).toMatch(/already stands/i);
    expect(looksLikeBloomeryOrder("What is bog ore?")).toBe(false);
    expect(BERNARD_BOG_ORE_SPEECH).toMatch(/rusty mud/i);
    expect(BERNARD_BOG_ORE_SPEECH).toMatch(/bloomery/i);
  });

  it("sets aside a season of work plus clay, stone, timber, and charcoal", () => {
    const cat = lookupProject("bloomery");
    expect(cat?.name).toBe("Bloomery");
    expect(cat?.labourDays).toBeGreaterThanOrEqual(100);
    expect(cat?.labourDays).toBeLessThanOrEqual(180);
    expect(cat?.lumber).toBeGreaterThan(0);
    expect(cat?.stone).toBeGreaterThan(0);
    expect(cat?.charcoal).toBeGreaterThan(0);
    expect(cat?.clay).toBeGreaterThan(0);
    expect(cat?.iron ?? 0).toBe(0);
    expect(cat?.completesToFeature).toBe("bloomery");

    const state = boot();
    stockForBloomery(state);
    const wood = state.resources.softwood + state.resources.hardwood;
    const stone = state.resources.stone;
    const charcoal = state.resources.charcoal;
    const iron = state.resources.iron;
    const result = applyProposal(state, bloomeryStartProposal(state), "smith");
    expect(result.ok).toBe(true);
    expect(result.logLine).toMatch(/bloomery/i);
    expect(result.logLine).toMatch(/clay/i);
    const proj = state.projects.find((p) => p.key === "bloomery");
    expect(proj?.name).toBe("Bloomery");
    expect(proj?.status).toBe("active");
    expect(proj?.labourDaysRequired).toBe(cat?.labourDays);
    expect(proj?.materials.lumber).toBe(cat?.lumber);
    expect(proj?.materials.stone).toBe(cat?.stone);
    expect(proj?.materials.charcoal).toBe(cat?.charcoal);
    expect(proj?.materials.clay).toBe(cat?.clay);
    expect(state.resources.softwood + state.resources.hardwood).toBe(wood - (cat?.lumber ?? 0));
    expect(state.resources.stone).toBe(stone - (cat?.stone ?? 0));
    expect(state.resources.charcoal).toBe(charcoal - (cat?.charcoal ?? 0));
    expect(state.resources.iron).toBe(iron);
    expect(state.holdings[0].features).not.toContain("bloomery");
  });

  it("smelts a few pounds of bloom iron a season, and stays quiet without charcoal or hands", () => {
    expect(BLOOMERY_SMELT_IRON).toBeGreaterThanOrEqual(3);
    expect(BLOOMERY_SMELT_IRON).toBeLessThanOrEqual(6);

    const cold = boot();
    const ironCold = cold.resources.iron;
    expect(smeltBloomeries(cold)).toEqual([]);
    expect(cold.resources.iron).toBe(ironCold);

    const state = boot();
    state.holdings[0].features.push("bloomery");
    state.resources.charcoal = 3;
    const beforeIron = state.resources.iron;
    const beforeCharcoal = state.resources.charcoal;
    const lines = resolveAgricultureAndProjects(state);
    expect(state.resources.iron).toBe(beforeIron + BLOOMERY_SMELT_IRON);
    expect(state.resources.charcoal).toBe(beforeCharcoal - BLOOMERY_SMELT_CHARCOAL);
    expect(lines.some((l) => /bloomery/i.test(l.text) && /bloom iron/i.test(l.text) && /days of work/i.test(l.text))).toBe(
      true,
    );
    expect(state.labour.assigned.some((a) => a.projectId === "bloomery-hearth")).toBe(false);

    const dry = boot();
    dry.holdings[0].features.push("bloomery");
    dry.resources.charcoal = 0;
    const dryIron = dry.resources.iron;
    const dryLines = smeltBloomeries(dry);
    expect(dry.resources.iron).toBe(dryIron);
    expect(dryLines.join(" ")).toMatch(/not charcoal enough/i);

    const busy = boot();
    busy.holdings[0].features.push("bloomery");
    busy.resources.charcoal = 3;
    busy.labour.assigned.push({ projectId: "other-work", men: 10_000, women: 0, youths: 0 });
    const busyIron = busy.resources.iron;
    const busyCharcoal = busy.resources.charcoal;
    const busyLines = smeltBloomeries(busy);
    expect(busy.resources.iron).toBe(busyIron);
    expect(busy.resources.charcoal).toBe(busyCharcoal);
    expect(busyLines.join(" ")).toMatch(/already at other work/i);
    expect(BLOOMERY_SMELT_DAYS).toBeGreaterThan(0);
  });
});

function plough(over?: Partial<{ lumber: number; iron: number; charcoal: number; tag?: string }>): MechanicalProposal {
  return {
    type: "start_project",
    summary: "One plough of a new design: a long heavy coulter, a wider one-sided share, an iron-shod wooden board, and a socketed replaceable share.",
    projectKey: "heavy_coulter_plough",
    name: "Heavy coulter plough",
    holdingId: "fontenay",
    ...(over?.tag ? { tag: over.tag } : {}),
    customCosts: {
      labourDays: 40,
      lumber: over?.lumber ?? 2,
      iron: over?.iron ?? 8,
      stone: 0,
      charcoal: over?.charcoal ?? 1,
    },
  };
}

describe("Bernard's own forge designs", () => {
  it("writes a free-key plough he priced, and names each short store instead of refusing the order", () => {
    const state = boot();
    const started = applyProposal(state, plough(), "smith");
    expect(started.ok).toBe(true);
    expect(started.reason).toBeUndefined();
    const made = state.projects.find((p) => p.key === "heavy_coulter_plough");
    expect(made?.status).toBe("active");
    expect(made?.tag).toBe("forge");
    expect(made?.materials).toMatchObject({ lumber: 2, iron: 8, charcoal: 1 });
    expect(state.resources.iron).toBe(17);

    const short = boot();
    const refused = applyProposal(short, plough({ lumber: 8, iron: 40, charcoal: 6 }), "smith");
    expect(refused.ok).toBe(false);
    expect(refused.reason).not.toBe("npc_not_authorized");
    expect(refused.reason).toMatch(/Need 8 cart-loads of timber; have 3/);
    expect(refused.reason).toMatch(/Need 40 lb iron; have 25/);
    expect(refused.reason).toMatch(/Need 6 cart-loads of charcoal; have 1/);
    expect(playerFacingReason(refused.reason ?? "")).not.toMatch(/not theirs to order/i);
    expect(short.projects).toHaveLength(0);
  });

  it("keeps catalogue forge buildings and does not give an iron plough to the carpenter or a clearing to Bernard", () => {
    const forge = boot();
    forge.resources.softwood = 20;
    forge.resources.hardwood = 5;
    forge.resources.iron = 200;
    forge.resources.stone = 20;
    forge.resources.charcoal = 10;
    expect(applyProposal(forge, { type: "start_project", summary: "Forge", projectKey: "forge", holdingId: "fontenay" }, "smith").ok).toBe(true);

    const mill = boot();
    mill.resources.softwood = 20;
    mill.resources.hardwood = 5;
    mill.resources.iron = 200;
    mill.resources.stone = 20;
    expect(applyProposal(mill, { type: "start_project", summary: "Mill", projectKey: "forge_mill", holdingId: "fontenay" }, "smith").ok).toBe(true);

    const clearing = applyProposal(
      boot(),
      { type: "start_project", summary: "Clear the north scrub", projectKey: "clear_scrub", holdingId: "fontenay", tag: "forge" },
      "smith",
    );
    expect(clearing.ok).toBe(false);
    expect(clearing.reason).toBe("npc_not_authorized");

    const carpenter = applyProposal(boot(), plough({ tag: "timber" }), "carpenter");
    expect(carpenter.ok).toBe(false);
    expect(carpenter.reason).toBe("npc_not_authorized");
    expect(playerFacingReason(carpenter.reason ?? "")).toMatch(/not theirs to order/i);
  });
});
