import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import startingEstate from "../../data/starting-estate.json";
import { applyProposal } from "./applyDelta";
import {
  autoAssignLeftoverToProject,
  autoFillLeftoverLabour,
  autoFillRoles,
  labourDaysFromAssignment,
  labourPool,
  labourRemaining,
  leftoverHeadsForNeed,
  MOSTLY_MEN_WOMAN_ASSIST_DAYS,
  pendingAssignLabourForNewProject,
  resolveActiveProject,
} from "./labour";
import { GERULF_HUNT_KEY } from "./hunts";
import { maxRisk, yieldMultiplier } from "./modifiers";
import { labourKindFor } from "./projectCatalog";
import { WorldStateSchema, type Project, type WorldState } from "./schema";
import { finishSeasonClock, resolveAgricultureAndProjects } from "./season";
import { defaultAppSettings } from "../llm/settings";
import { GameController, sortPendingForApply } from "../session/game";

function boot(extra?: (s: WorldState) => void): WorldState {
  const state = WorldStateSchema.parse(structuredClone(startingEstate));
  state.resources.softwood = 40;
  state.resources.hardwood = 40;
  state.resources.iron = 200;
  state.resources.stone = 40;
  extra?.(state);
  return state;
}

function withActiveProject(state: WorldState, id = "proj-scrub"): WorldState {
  state.projects.push({
    id,
    key: "clear_scrub",
    name: "Clear scrub",
    holdingId: state.holdings[0].id,
    labourDaysRequired: 35,
    labourDaysDone: 0,
    materials: { lumber: 0.5, iron: 4, stone: 0 },
    materialsReserved: true,
    status: "active",
  });
  return state;
}

function project(partial: Partial<Project> & Pick<Project, "id" | "key" | "name">): Project {
  return {
    holdingId: "fontenay",
    labourDaysRequired: 40,
    labourDaysDone: 0,
    materials: { lumber: 0, iron: 0, stone: 0 },
    materialsReserved: true,
    status: "active",
    ...partial,
  };
}

describe("extra labour days and harvest risk", () => {
  it("does not set harvest_risk or cut yield when every man is called", () => {
    const state = withActiveProject(boot());
    expect(state.meta.season).toBe("spring");
    expect(labourPool(state).men).toBe(180);
    expect(state.population.adult_men).toBe(12);

    const beforeYield = yieldMultiplier(state, "rye");
    const assigned = applyProposal(
      state,
      {
        type: "assign_labour",
        summary: "Put men on the scrub",
        projectId: "proj-scrub",
        men: 12,
        women: 0,
        youths: 0,
      },
      "steward",
    );

    expect(assigned.ok).toBe(true);
    expect(state.labour.assigned.find((a) => a.projectId === "proj-scrub")?.men).toBe(12);
    expect(labourRemaining(state).men).toBe(0);
    expect(state.labour.harvest_risk).toBe(false);
    expect(yieldMultiplier(state, "rye")).toBe(beforeYield);
    expect(maxRisk(state, "harvest_risk")).toBe(0);
  });

  it("rejects a call for more men than live on the demesne", () => {
    const state = withActiveProject(boot());
    const result = applyProposal(
      state,
      {
        type: "assign_labour",
        summary: "Too many men",
        projectId: "proj-scrub",
        men: 60,
        women: 0,
        youths: 0,
      },
      "steward",
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Too many people called \(asked men 60 free 12/);
    expect(state.labour.assigned).toEqual([]);
    expect(state.labour.harvest_risk).toBe(false);
  });

  it("still applies an explicit harvest_risk modifier", () => {
    const state = boot();
    const before = yieldMultiplier(state, "rye");
    const added = applyProposal(
      state,
      {
        type: "add_modifier",
        summary: "Late weather",
        target: "harvest_risk",
        kind: "temporary",
        seasonsRemaining: 1,
        effect: { op: "add", value: 0.2 },
        source: "w-timing",
      },
      "referee",
    );
    expect(added.ok).toBe(true);
    expect(state.labour.harvest_risk).toBe(false);
    expect(maxRisk(state, "harvest_risk")).toBe(0.2);
    expect(yieldMultiplier(state, "rye")).toBeCloseTo(before * 0.8, 8);
  });
});

describe("constitution labour fill order", () => {
  it("lists youths first only on mixed work", () => {
    expect(autoFillRoles("mixed", "clear_scrub")).toEqual(["youths", "women", "men"]);
    expect(autoFillRoles("mixed", "expand_orchard")).toEqual(["youths", "women", "men"]);
    expect(autoFillRoles("men_women", "expand_vineyard")).toEqual(["women", "men"]);
    expect(autoFillRoles("men_women", "textile_workshop")).toEqual(["women", "men", "youths"]);
    expect(autoFillRoles("men_women", "pottery_kiln")).toEqual(["women", "men", "youths"]);
    expect(autoFillRoles("mostly_men", "flour_mill")).toEqual(["men", "women"]);
    expect(autoFillRoles("mostly_men", "quarry")).toEqual(["men"]);
    expect(autoFillRoles("mostly_men", "wooden_tower")).toEqual(["men"]);
    expect(autoFillRoles("mostly_men", "drain_swamp")).toEqual(["men"]);
  });

  it("mixed: youths, then women, then men, capped at remaining days", () => {
    const added = leftoverHeadsForNeed("mixed", "clear_scrub", 10, { men: 80, women: 80, youths: 40 });
    expect(added.youths).toBe(25);
    expect(added.women).toBe(0);
    expect(added.men).toBe(0);
    expect(labourDaysFromAssignment("mixed", added.men, added.women, added.youths)).toBeGreaterThanOrEqual(10);
    expect(added.youths + added.women + added.men).toBeLessThan(80);
  });

  it("mixed: after youths are spent, women then men fill the rest", () => {
    const added = leftoverHeadsForNeed("mixed", "fish_pond", 20, { men: 10, women: 8, youths: 5 });
    expect(added.youths).toBe(5);
    expect(added.women).toBe(8);
    expect(added.men).toBe(10);
    expect(labourDaysFromAssignment("mixed", 10, 8, 5)).toBe(10 + 8 + 2);
  });

  it("men_women vineyard: women first, then men; no youths", () => {
    const added = leftoverHeadsForNeed("men_women", "expand_vineyard", 12, { men: 20, women: 20, youths: 20 });
    expect(added.women).toBe(12);
    expect(added.men).toBe(0);
    expect(added.youths).toBe(0);
  });

  it("men_women textile: women then men, youths only as leftover assist", () => {
    const added = leftoverHeadsForNeed("men_women", "textile_workshop", 8, { men: 0, women: 5, youths: 20 });
    expect(added.women).toBe(5);
    expect(added.men).toBe(0);
    expect(added.youths).toBe(8);
    expect(labourDaysFromAssignment("men_women", 0, 5, 8)).toBeGreaterThanOrEqual(8);
  });

  it("mostly_men mill: men first; no youths; leftover men remain when they cover the days", () => {
    const added = leftoverHeadsForNeed("mostly_men", "flour_mill", 10, { men: 80, women: 80, youths: 40 });
    expect(added.men).toBe(10);
    expect(added.women).toBe(0);
    expect(added.youths).toBe(0);
  });

  it("mostly_men mill: does not dump women when leftover after men is still large", () => {
    const added = leftoverHeadsForNeed("mostly_men", "flour_mill", 230, { men: 40, women: 80, youths: 40 });
    expect(added.men).toBe(40);
    expect(added.youths).toBe(0);
    expect(added.women).toBe(0);
    expect(230 - 40).toBeGreaterThan(MOSTLY_MEN_WOMAN_ASSIST_DAYS);
  });

  it("mostly_men: women only as small leftover assist, at 0.6", () => {
    const added = leftoverHeadsForNeed("mostly_men", "flour_mill", 4, { men: 0, women: 20, youths: 20 });
    expect(added.youths).toBe(0);
    expect(added.men).toBe(0);
    expect(added.women).toBe(7);
    expect(labourDaysFromAssignment("mostly_men", 0, 7, 0)).toBeCloseTo(4.2);
  });

  it("mostly_men quarry / tower / swamp: men only", () => {
    for (const key of ["quarry", "wooden_tower", "drain_swamp"] as const) {
      const added = leftoverHeadsForNeed("mostly_men", key, 4, { men: 0, women: 20, youths: 20 });
      expect(added).toEqual({ men: 0, women: 0, youths: 0 });
    }
  });
});

describe("auto-assign leftover onto works", () => {
  it("Confirm mill calls leftover men, not youths, and leaves spare men idle", () => {
    const state = boot((s) => {
      s.population.adult_men = 20;
      s.population.adult_women = 13;
      s.population.youths = 9;
    });
    const result = applyProposal(
      state,
      { type: "start_project", summary: "Begin a flour mill", projectKey: "flour_mill", holdingId: "fontenay" },
      "steward",
    );
    expect(result.ok).toBe(true);
    expect(result.logLine).not.toMatch(/proj-|\{|JSON|assign_labour/i);
    expect(result.logLine).toMatch(/called/i);
    const mill = state.projects.find((p) => p.key === "flour_mill");
    expect(mill).toBeTruthy();
    const assign = state.labour.assigned.find((a) => a.projectId === mill!.id);
    expect(assign?.youths).toBe(0);
    expect(assign?.men).toBeGreaterThan(0);
    expect(labourRemaining(state).men).toBeGreaterThan(0);
    expect(labourDaysFromAssignment("mostly_men", assign!.men, assign!.women, assign!.youths)).toBeLessThanOrEqual(
      mill!.labourDaysRequired + 1e-9,
    );
  });

  it("caps mixed scrub at the days still owed, youths first", () => {
    const state = boot();
    state.projects.push(project({ id: "scrub-1", key: "clear_scrub", name: "Clear scrub", labourDaysRequired: 10 }));
    const fill = autoAssignLeftoverToProject(state, "scrub-1");
    expect(fill?.added.youths).toBeGreaterThan(0);
    expect(fill?.added.youths).toBeLessThanOrEqual(state.population.youths);
    expect(fill?.added.youths).toBe(9);
    expect(fill?.added.women).toBe(0);
    expect(fill?.added.men).toBe(0);
    expect(fill?.sentence).toMatch(/youths/i);
    expect(fill?.sentence).not.toMatch(/proj-|JSON/);
  });

  it("skips Gerulf hunts and merchant deals", () => {
    const state = boot();
    state.projects.push(
      project({
        id: "hunt-1",
        key: GERULF_HUNT_KEY,
        name: "Hunt: pepper",
        tag: "hunt",
        labourDaysRequired: 0,
        hunt: {
          goods: "pepper",
          resource: "pepper",
          amount: 1,
          quotedDenarii: 42,
          escrowedDenarii: 42,
          durationSeasons: 2,
          seasonsElapsed: 0,
        },
      }),
    );
    expect(autoAssignLeftoverToProject(state, "hunt-1")).toBeNull();
    expect(autoFillLeftoverLabour(state)).toEqual([]);
    expect(state.labour.assigned).toEqual([]);
  });

  it("does not overwrite an assignment already set this season; only tops up leftover", () => {
    const state = boot();
    state.projects.push(project({ id: "mill-1", key: "flour_mill", name: "Flour mill", labourDaysRequired: 230 }));
    state.labour.assigned.push({ projectId: "mill-1", men: 6, women: 2, youths: 3 });
    const fill = autoAssignLeftoverToProject(state, "mill-1");
    expect(fill?.total.men).toBeGreaterThanOrEqual(6);
    expect(fill?.total.women).toBe(2);
    expect(fill?.total.youths).toBe(3);
    expect(state.labour.assigned.find((a) => a.projectId === "mill-1")?.youths).toBe(3);
  });

  it("does not steal people already assigned to another project", () => {
    const state = boot((s) => {
      s.population.adult_men = 4;
    });
    state.projects.push(
      project({ id: "a", key: "flour_mill", name: "Flour mill", labourDaysRequired: 230 }),
      project({ id: "b", key: "clear_scrub", name: "Clear scrub", labourDaysRequired: 35 }),
    );
    state.labour.assigned.push({ projectId: "a", men: labourRemaining(state).men, women: 0, youths: 0 });
    const menLeft = labourRemaining(state).men;
    autoAssignLeftoverToProject(state, "b");
    expect(state.labour.assigned.find((x) => x.projectId === "a")?.men).toBeGreaterThan(0);
    expect(state.labour.assigned.find((x) => x.projectId === "b")?.men ?? 0).toBe(0);
    expect(labourRemaining(state).men).toBe(menLeft);
  });

  it("fills oldest active labour work first after leftover remains", () => {
    const state = boot((s) => {
      s.population.adult_men = 2;
      s.population.adult_women = 0;
      s.population.youths = 0;
    });
    state.projects.push(
      project({ id: "older", key: "flour_mill", name: "Flour mill", labourDaysRequired: 8 }),
      project({ id: "newer", key: "palisade", name: "Palisade", labourDaysRequired: 70 }),
    );
    const notes = autoFillLeftoverLabour(state);
    expect(notes.length).toBeGreaterThan(0);
    expect(state.labour.assigned.find((a) => a.projectId === "older")?.men).toBe(1);
    expect(state.labour.assigned.find((a) => a.projectId === "newer")?.men).toBe(1);
    expect((state.labour.assigned.find((a) => a.projectId === "older")?.men ?? 0) +
      (state.labour.assigned.find((a) => a.projectId === "newer")?.men ?? 0)).toBe(state.population.adult_men);
  });

  it("prefers an explicit assign_labour floor, then tops up leftover", () => {
    const state = boot();
    const started = applyProposal(
      state,
      { type: "start_project", summary: "Begin a flour mill", projectKey: "flour_mill", holdingId: "fontenay" },
      "steward",
    );
    expect(started.ok).toBe(true);
    const mill = state.projects.find((p) => p.key === "flour_mill")!;
    const assigned = applyProposal(
      state,
      { type: "assign_labour", summary: "Ten men on the mill", projectId: mill.id, men: 10, women: 0, youths: 0 },
      "steward",
    );
    expect(assigned.ok).toBe(true);
    const row = state.labour.assigned.find((a) => a.projectId === mill.id)!;
    expect(row.men).toBeGreaterThanOrEqual(10);
    expect(row.youths).toBe(0);
    expect(row.men).toBeGreaterThan(10);
    expect(labourDaysFromAssignment("mostly_men", row.men, row.women, row.youths)).toBeLessThanOrEqual(
      mill.labourDaysRequired + 1e-9,
    );
    expect(assigned.logLine).toMatch(/men/i);
    expect(assigned.logLine).not.toMatch(mill.id);
  });

  it("season start tops up leftover onto unfinished works and still skips hunts", () => {
    const state = boot((s) => {
      s.population.adult_men = 3;
      s.population.adult_women = 0;
      s.population.youths = 0;
    });
    state.projects.push(
      project({ id: "mill-1", key: "flour_mill", name: "Flour mill", labourDaysRequired: 200, labourDaysDone: 10 }),
      project({
        id: "hunt-1",
        key: GERULF_HUNT_KEY,
        name: "Hunt: pepper",
        tag: "hunt",
        hunt: {
          goods: "pepper",
          resource: "pepper",
          amount: 1,
          quotedDenarii: 42,
          escrowedDenarii: 42,
          durationSeasons: 2,
          seasonsElapsed: 0,
        },
      }),
    );
    state.labour.assigned.push({ projectId: "mill-1", men: 2, women: 0, youths: 0 });
    resolveAgricultureAndProjects(state);
    const afterWork = state.labour.assigned.find((a) => a.projectId === "mill-1");
    expect(afterWork?.men).toBeGreaterThanOrEqual(2);
    expect(state.labour.assigned.some((a) => a.projectId === "hunt-1")).toBe(false);
    finishSeasonClock(state);
    expect(state.labour.assigned.some((a) => a.projectId === "hunt-1")).toBe(false);
    const mill = state.projects.find((p) => p.id === "mill-1");
    if (mill?.status === "active") {
      expect(state.labour.assigned.find((a) => a.projectId === "mill-1")?.youths ?? 0).toBe(0);
    }
  });

  it("binds pending hands only when the id belongs to the new work", () => {
    const sibling = pendingAssignLabourForNewProject(
      [{ status: "pending", proposal: { type: "assign_labour", projectId: "new-mill", men: 10, women: 0, youths: 0 } }],
      "proj-1",
      ["new-mill"],
    );
    expect(sibling?.men).toBe(10);
    expect(sibling?.projectId).toBe("proj-1");
    expect(
      pendingAssignLabourForNewProject(
        [{ status: "pending", proposal: { type: "assign_labour", projectId: "charcoal_burning", men: 60, women: 0, youths: 0 } }],
        "proj-1",
        ["clear_scrub", "Clear scrub to arable (1 acre)"],
      ),
    ).toBeNull();
  });

  it("keeps labourKind conversion: women 0.6 on mostly_men, 1.0 otherwise; youths 0.4", () => {
    expect(labourKindFor({ key: "flour_mill" } as Project)).toBe("mostly_men");
    expect(labourDaysFromAssignment("mostly_men", 1, 1, 1)).toBeCloseTo(1 + 0.6 + 0.4);
    expect(labourDaysFromAssignment("mixed", 1, 1, 1)).toBeCloseTo(1 + 1 + 0.4);
    expect(labourDaysFromAssignment("men_women", 1, 1, 1)).toBeCloseTo(1 + 1 + 0.4);
  });
});

describe("resolveActiveProject and assign_labour by key/name", () => {
  function startMill(state: WorldState) {
    const result = applyProposal(
      state,
      { type: "start_project", summary: "Begin a flour mill", projectKey: "flour_mill", holdingId: "fontenay" },
      "steward",
    );
    expect(result.ok).toBe(true);
    return state.projects.find((p) => p.key === "flour_mill")!;
  }

  it("matches generated id, catalog key, and display name", () => {
    const state = boot();
    const mill = startMill(state);
    expect(resolveActiveProject(state, mill.id)?.id).toBe(mill.id);
    expect(resolveActiveProject(state, "flour_mill")?.id).toBe(mill.id);
    expect(resolveActiveProject(state, "Flour mill")?.id).toBe(mill.id);
    expect(resolveActiveProject(state, "  FLOUR MILL  ")?.id).toBe(mill.id);
    expect(resolveActiveProject(state, "no_such_work")).toBeUndefined();
  });

  it("does not guess when two labour works are active", () => {
    const state = boot();
    const mill = startMill(state);
    state.projects.push(project({ id: "scrub-1", key: "clear_scrub", name: "Clear scrub", labourDaysRequired: 10 }));
    expect(resolveActiveProject(state, "the work", "Put men on the work")).toBeUndefined();
    expect(resolveActiveProject(state, mill.id)?.id).toBe(mill.id);
  });

  it("does not redirect a different id onto the only open work", () => {
    const state = boot();
    const mill = startMill(state);
    expect(resolveActiveProject(state, "hands", "Put men on the mill")).toBeUndefined();
    expect(resolveActiveProject(state, "charcoal_burning", "Sixty men to the work")).toBeUndefined();
    expect(resolveActiveProject(state, mill.id)?.id).toBe(mill.id);
  });

  it("assign_labour with projectId flour_mill writes onto the created proj id", () => {
    const state = boot();
    const mill = startMill(state);
    const assigned = applyProposal(
      state,
      { type: "assign_labour", summary: "Hands on the mill", projectId: "flour_mill", men: 10, women: 0, youths: 0 },
      "steward",
    );
    expect(assigned.ok).toBe(true);
    expect(assigned.reason).not.toBe("No such active project.");
    const row = state.labour.assigned.find((a) => a.projectId === mill.id);
    expect(row).toBeTruthy();
    expect(row?.men).toBeGreaterThanOrEqual(10);
    expect(state.labour.assigned.some((a) => a.projectId === "flour_mill")).toBe(false);
  });

  it("assign_labour with display name Flour mill succeeds; unknown key still fails", () => {
    const state = boot();
    const mill = startMill(state);
    const byName = applyProposal(
      state,
      { type: "assign_labour", summary: "Hands", projectId: "Flour mill", men: 8, women: 0, youths: 0 },
      "steward",
    );
    expect(byName.ok).toBe(true);
    expect(state.labour.assigned.find((a) => a.projectId === mill.id)?.men).toBeGreaterThanOrEqual(8);

    const miss = applyProposal(
      state,
      { type: "assign_labour", summary: "Hands", projectId: "glassworks", men: 4, women: 0, youths: 0 },
      "steward",
    );
    expect(miss.ok).toBe(false);
    expect(miss.reason).toBe("No such active project.");
  });

  it("adjust_project labourThisSeason resolves the catalog key", () => {
    const state = boot();
    const mill = startMill(state);
    const adjusted = applyProposal(
      state,
      {
        type: "adjust_project",
        summary: "Ten men this season",
        projectId: "flour_mill",
        labourThisSeason: { men: 10, women: 0, youths: 0 },
      },
      "steward",
    );
    expect(adjusted.ok).toBe(true);
    expect(state.labour.assigned.find((a) => a.projectId === mill.id)?.men).toBeGreaterThanOrEqual(10);
  });
});

describe("Confirm batch order: start_project before assign_labour", () => {
  function millGame() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isekai-"));
    const state = WorldStateSchema.parse(structuredClone(startingEstate));
    state.resources.softwood = 40;
    state.resources.hardwood = 40;
    state.resources.iron = 200;
    state.resources.stone = 40;
    return new GameController(state, dir, defaultAppSettings());
  }

  it("sorts start_project ahead of assign_labour even if assign was queued first", () => {
    const ordered = sortPendingForApply([
      { proposal: { type: "assign_labour" } },
      { proposal: { type: "start_project" } },
      { proposal: { type: "register_npc" } },
    ]);
    expect(ordered.map((p) => p.proposal.type)).toEqual(["start_project", "register_npc", "assign_labour"]);
  });

  it("Confirm batch: assign_labour by key succeeds even if listed first in pending", () => {
    const game = millGame();
    game.queueProposal("steward", {
      type: "assign_labour",
      summary: "Put men on the mill",
      projectId: "flour_mill",
      men: 10,
      women: 0,
      youths: 0,
    });
    game.queueProposal("steward", {
      type: "start_project",
      summary: "Begin a flour mill",
      projectKey: "flour_mill",
      holdingId: "fontenay",
    });
    expect(game.pending[0].proposal.type).toBe("assign_labour");
    const result = game.confirmAllProposals();
    expect(result.error).toBeUndefined();
    const mill = game.state.projects.find((p) => p.key === "flour_mill" && p.status === "active");
    expect(mill).toBeTruthy();
    expect(mill!.id).toMatch(/^proj-/);
    const row = game.state.labour.assigned.find((a) => a.projectId === mill!.id);
    expect(row).toBeTruthy();
    expect(row?.men).toBeGreaterThanOrEqual(10);
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
  });

  it("after Confirm start_project, a later assign_labour by key flour_mill hits the created id", () => {
    const game = millGame();
    game.queueProposal("steward", {
      type: "start_project",
      summary: "Begin a flour mill",
      projectKey: "flour_mill",
      holdingId: "fontenay",
    });
    game.confirmProposal(game.pending[0].id);
    const mill = game.state.projects.find((p) => p.key === "flour_mill")!;
    game.queueProposal("steward", {
      type: "assign_labour",
      summary: "Hands on the mill",
      projectId: "flour_mill",
      men: 12,
      women: 0,
      youths: 0,
    });
    const queued = game.pending.find((p) => p.status === "pending" && p.proposal.type === "assign_labour");
    expect(queued?.proposal).toMatchObject({ type: "assign_labour", projectId: mill.id });
    const result = game.confirmProposal(queued!.id);
    expect(result.error).toBeUndefined();
    expect(game.state.labour.assigned.find((a) => a.projectId === mill.id)?.men).toBeGreaterThanOrEqual(12);
  });
});
