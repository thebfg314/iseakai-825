import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { applyProposal } from "./applyDelta";
import { autoFillLeftoverLabour } from "./labour";
import { lookupProject } from "./projectCatalog";
import { WorldStateSchema, type MechanicalProposal, type WorldState } from "./schema";
import { resolveAgricultureAndProjects } from "./season";
import {
  oneSmithSeasonDays,
  seasonsOfOneSmith,
  smithSpeechForOrder,
  smithStillAtSpeech,
} from "./smithing";
import { playerFacingReason } from "../ui/ledgerCopy";

const JARGON = /labour days|customCosts|catalogue|proposal|JSON|assign_labour|start_project/i;

function boot(): WorldState {
  const state = WorldStateSchema.parse(structuredClone(startingEstate));
  state.resources.softwood = 40;
  state.resources.hardwood = 20;
  state.resources.iron = 400;
  state.resources.stone = 40;
  state.resources.charcoal = 20;
  state.resources.denarii = 400;
  return state;
}

function tool(
  key: string,
  name: string,
  costs: { labourDays: number; lumber?: number; iron?: number; stone?: number; charcoal?: number },
): MechanicalProposal {
  return {
    type: "start_project",
    summary: name,
    projectKey: key,
    name,
    holdingId: "fontenay",
    tag: "forge",
    customCosts: {
      labourDays: costs.labourDays,
      lumber: costs.lumber ?? 0,
      iron: costs.iron ?? 0,
      stone: costs.stone ?? 0,
      charcoal: costs.charcoal ?? 0,
    },
  };
}

describe("Bernard's own smithing", () => {
  it("judges one season of the smith from the labour tables, not from one tool", () => {
    const season = oneSmithSeasonDays();
    expect(season).toBeGreaterThanOrEqual(20);
    expect(seasonsOfOneSmith(20)).toBe(1);
    expect(seasonsOfOneSmith(season)).toBe(1);
    expect(seasonsOfOneSmith(season + 1)).toBe(2);
  });

  it("gives a metal-only custom tool no village assignment", () => {
    const state = boot();
    const started = applyProposal(state, tool("iron_hinge", "Iron hinge", { labourDays: 20, iron: 4, charcoal: 1 }), "smith");
    expect(started.ok).toBe(true);
    expect(started.logLine).not.toMatch(/men's work|women's work|youths' work/);
    expect(started.logLine).not.toMatch(JARGON);
    const made = state.projects.find((p) => p.key === "iron_hinge");
    expect(made?.smithing?.durationSeasons).toBe(1);
    expect(state.labour.assigned.some((a) => a.projectId === made?.id)).toBe(false);
    expect(autoFillLeftoverLabour(state)).toEqual([]);
    expect(state.labour.assigned).toEqual([]);

    const hands = applyProposal(
      state,
      { type: "assign_labour", summary: "Spare days", projectId: made!.id, men: 20, women: 6, youths: 4 },
      "steward",
    );
    expect(hands.ok).toBe(false);
    const said = playerFacingReason(hands.reason ?? "");
    expect(said).toMatch(/village is not called/i);
    expect(said).not.toMatch(JARGON);
    expect(state.labour.assigned).toEqual([]);
  });

  it("frees him after one season of a modest tool, including one with a wooden board", () => {
    const state = boot();
    const days = oneSmithSeasonDays();
    const started = applyProposal(
      state,
      tool("socketed_share", "Socketed share", { labourDays: days, lumber: 2, iron: 8, charcoal: 1 }),
      "smith",
    );
    expect(started.ok).toBe(true);
    const made = state.projects.find((p) => p.key === "socketed_share")!;
    expect(made.smithing?.durationSeasons).toBe(1);
    expect(state.labour.assigned.some((a) => a.projectId === made.id)).toBe(false);

    const second = applyProposal(state, tool("iron_hinge", "Iron hinge", { labourDays: days, iron: 2 }), "smith");
    expect(second.ok).toBe(false);
    const building = applyProposal(
      state,
      { type: "start_project", summary: "Bloomery", projectKey: "bloomery", holdingId: "fontenay" },
      "smith",
    );
    expect(building.ok).toBe(true);
    const bloom = state.projects.find((p) => p.key === "bloomery");
    expect(state.labour.assigned.find((a) => a.projectId === bloom?.id)?.men ?? 0).toBeGreaterThan(0);
    expect(state.labour.assigned.some((a) => a.projectId === made.id)).toBe(false);
    expect(playerFacingReason(second.reason ?? "")).toMatch(/still at/i);
    expect(playerFacingReason(second.reason ?? "")).toMatch(/waits/i);
    expect(smithSpeechForOrder(state, "Forge me another hinge.")).toBe(smithStillAtSpeech(made.name));
    expect(smithStillAtSpeech(made.name)).not.toMatch(JARGON);

    const lines = resolveAgricultureAndProjects(state);
    expect(made.status).toBe("completed");
    expect(lines.some((l) => /socketed share is finished/i.test(l.text))).toBe(true);
    expect(smithSpeechForOrder(state, "Forge me another hinge.")).toBeNull();

    const after = applyProposal(state, tool("iron_hinge", "Iron hinge", { labourDays: days, iron: 2 }), "smith");
    expect(after.ok).toBe(true);
    expect(state.projects.find((p) => p.key === "iron_hinge")?.status).toBe("active");
  });

  it("refuses a second tool or a building until a long piece is finished", () => {
    const state = boot();
    const days = oneSmithSeasonDays() + 1;
    const started = applyProposal(state, tool("great_anvil", "Great anvil", { labourDays: days, iron: 30 }), "smith");
    expect(started.ok).toBe(true);
    const made = state.projects.find((p) => p.key === "great_anvil")!;
    expect(made.smithing?.durationSeasons).toBeGreaterThan(1);
    expect(started.logLine).toMatch(/until it is finished/i);
    expect(started.logLine).toMatch(/waits/i);

    const another = applyProposal(state, tool("iron_hinge", "Iron hinge", { labourDays: 10, iron: 2 }), "smith");
    expect(another.ok).toBe(false);
    const toolSaid = playerFacingReason(another.reason ?? "");
    expect(toolSaid).toMatch(/still at the great anvil/i);
    expect(toolSaid).toMatch(/next thing waits/i);
    expect(toolSaid).not.toMatch(JARGON);
    expect(smithSpeechForOrder(state, "Make me an iron hinge.")).toMatch(/I am still at the great anvil/i);

    const bay = applyProposal(
      state,
      tool("hearth_bay", "Hearth bay", { labourDays: 80, lumber: 6, iron: 10, stone: 2 }),
      "smith",
    );
    expect(bay.ok).toBe(false);
    expect(playerFacingReason(bay.reason ?? "")).toMatch(/still at the great anvil/i);

    const bloom = applyProposal(
      state,
      { type: "start_project", summary: "Bloomery", projectKey: "bloomery", holdingId: "fontenay" },
      "smith",
    );
    expect(bloom.ok).toBe(false);
    expect(state.projects.some((p) => p.key === "bloomery")).toBe(false);

    state.npcs = state.npcs.filter((n) => n.id !== "smith" && n.role !== "smith");
    const unnamed = applyProposal(state, tool("iron_hinge", "Iron hinge", { labourDays: 10, iron: 2 }), "smith");
    expect(playerFacingReason(unnamed.reason ?? "")).toMatch(/The smith is still at/i);
    expect(playerFacingReason(unnamed.reason ?? "")).not.toMatch(/Bernard/);

    state.npcs.push({
      id: "smith",
      name: "Bernard",
      role: "smith",
      location: "fontenay",
      memories: [],
      wantsTalk: false,
    });
    const seasons = made.smithing!.durationSeasons;
    for (let i = 0; i < seasons; i++) resolveAgricultureAndProjects(state);
    expect(made.status).toBe("completed");

    const freed = applyProposal(
      state,
      { type: "start_project", summary: "Bloomery", projectKey: "bloomery", holdingId: "fontenay" },
      "smith",
    );
    expect(freed.ok).toBe(true);
    const bloomery = state.projects.find((p) => p.key === "bloomery");
    expect(bloomery?.smithing).toBeUndefined();
    expect(state.labour.assigned.find((a) => a.projectId === bloomery?.id)?.men ?? 0).toBeGreaterThan(0);
  });

  it("still gives village days to a bloomery and to other woodworking forge buildings", () => {
    const bloomery = boot();
    const raised = applyProposal(
      bloomery,
      { type: "start_project", summary: "Bloomery", projectKey: "bloomery", holdingId: "fontenay" },
      "smith",
    );
    expect(raised.ok).toBe(true);
    const bloom = bloomery.projects.find((p) => p.key === "bloomery")!;
    expect(bloom.smithing).toBeUndefined();
    expect(bloomery.labour.assigned.find((a) => a.projectId === bloom.id)?.men ?? 0).toBeGreaterThan(0);
    expect(raised.logLine).toMatch(/days of the men's work/i);

    const forge = boot();
    const forgeResult = applyProposal(
      forge,
      { type: "start_project", summary: "Forge", projectKey: "forge", holdingId: "fontenay" },
      "smith",
    );
    expect(forgeResult.ok).toBe(true);
    const forgeProj = forge.projects.find((p) => p.key === "forge")!;
    expect(forge.labour.assigned.find((a) => a.projectId === forgeProj.id)?.men ?? 0).toBeGreaterThan(0);

    const mill = boot();
    const millResult = applyProposal(
      mill,
      { type: "start_project", summary: "Trip-hammer", projectKey: "forge_mill", holdingId: "fontenay" },
      "smith",
    );
    expect(millResult.ok).toBe(true);
    const millProj = mill.projects.find((p) => p.key === "forge_mill")!;
    expect(lookupProject("forge_mill")?.labourDays).toBe(millProj.labourDaysRequired);
    expect(mill.labour.assigned.find((a) => a.projectId === millProj.id)?.men ?? 0).toBeGreaterThan(0);

    const bayState = boot();
    const bay = applyProposal(
      bayState,
      tool("hearth_bay", "Hearth bay", { labourDays: 80, lumber: 6, iron: 10, stone: 2 }),
      "smith",
    );
    expect(bay.ok).toBe(true);
    const bayProj = bayState.projects.find((p) => p.key === "hearth_bay")!;
    expect(bayProj.smithing).toBeUndefined();
    expect(bayState.labour.assigned.find((a) => a.projectId === bayProj.id)?.men ?? 0).toBeGreaterThan(0);
  });
});
