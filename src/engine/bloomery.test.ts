import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { applyProposal } from "./applyDelta";
import {
  BERNARD_BOG_ORE_SPEECH,
  BLOOMERY_DECENT_CHARCOAL,
  BLOOMERY_DECENT_PURSE,
  BLOOMERY_SMELT_CHARCOAL,
  BLOOMERY_SMELT_DAYS,
  BLOOMERY_SMELT_IRON,
  bloomeryNotReadyReason,
  bloomeryStartProposal,
  bloomerySuggestReady,
  charcoalSupplyReady,
  estateHasBloomery,
  inferSmithProposals,
  looksLikeBloomeryOrder,
  smeltBloomeries,
} from "./bloomery";
import { lookupProject } from "./projectCatalog";
import { WorldStateSchema, type WorldState } from "./schema";
import { resolveAgricultureAndProjects } from "./season";

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

  it("waits on charcoal and a purse, and does not demand both a hoard and a fortune", () => {
    const state = boot();
    expect(state.resources.charcoal).toBeLessThan(BLOOMERY_DECENT_CHARCOAL);
    expect(state.resources.denarii).toBeLessThan(BLOOMERY_DECENT_PURSE);
    expect(charcoalSupplyReady(state)).toBe(false);
    expect(bloomeryNotReadyReason(state)).toMatch(/charcoal/i);
    expect(inferSmithProposals(state, "Build a bloomery.")).toEqual([]);

    state.resources.charcoal = BLOOMERY_DECENT_CHARCOAL;
    expect(bloomerySuggestReady(state)).toBe(false);
    expect(bloomeryNotReadyReason(state)).toMatch(/chest/i);

    state.resources.charcoal = 1;
    state.resources.denarii = BLOOMERY_DECENT_PURSE;
    expect(bloomerySuggestReady(state)).toBe(false);
    expect(bloomeryNotReadyReason(state)).toMatch(/charcoal/i);

    state.projects.push({
      id: "char-1",
      key: "charcoal_burning",
      name: "Organized charcoal burning",
      holdingId: "fontenay",
      labourDaysRequired: 60,
      labourDaysDone: 10,
      materials: { lumber: 2, iron: 10, stone: 0 },
      materialsReserved: true,
      status: "active",
    });
    expect(bloomerySuggestReady(state)).toBe(true);
    expect(bloomeryNotReadyReason(state)).toBeNull();

    state.projects = [];
    state.resources.charcoal = BLOOMERY_DECENT_CHARCOAL;
    expect(bloomerySuggestReady(state)).toBe(true);
    const proposed = inferSmithProposals(state, "I want a bloomery.");
    expect(proposed).toHaveLength(1);
    expect(proposed[0]).toMatchObject({ type: "start_project", projectKey: "bloomery", name: "Bloomery" });
    expect(proposed[0].summary).toMatch(/bloomery/i);
    expect(proposed[0].summary).toMatch(/clay/i);

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
