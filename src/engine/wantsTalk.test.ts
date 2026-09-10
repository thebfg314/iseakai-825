import { describe, expect, it, vi } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { applyProposal } from "./applyDelta";
import { applyMerchantRoll } from "./merchant";
import { WorldStateSchema, type Project, type WorldState } from "./schema";
import { specialistById, specialistNpc } from "./specialists";
import { resolveAgricultureAndProjects } from "./season";
import { quoteHunt, startHunt, huntProposal, resolveHunts } from "./hunts";
import { markIntroSpoken } from "./intros";
import {
  completedProjectBeats,
  dismissNewsWantsTalk,
  introStillOwed,
  ownerNpcIdForCompletedProject,
  releaseConfirmWantsTalk,
} from "./wantsTalk";

function boot(): WorldState {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

function activeProject(partial: Partial<Project> & Pick<Project, "id" | "key" | "name">): Project {
  return {
    holdingId: "fontenay",
    labourDaysRequired: 4,
    labourDaysDone: 0,
    materials: { lumber: 0, iron: 0, stone: 0 },
    materialsReserved: true,
    status: "active",
    ...partial,
  };
}

function flagOf(state: WorldState, id: string): boolean {
  return state.npcs.find((n) => n.id === id)?.wantsTalk === true;
}

describe("wantsTalk flag", () => {
  it("starts true for smith, chaplain, and negotiator, false for the steward", () => {
    const state = boot();
    expect(flagOf(state, "steward")).toBe(false);
    expect(flagOf(state, "smith")).toBe(true);
    expect(flagOf(state, "chaplain")).toBe(true);
    expect(flagOf(state, "negotiator")).toBe(true);
  });

  it("defaults false on old saves that omit the field", () => {
    const raw = structuredClone(startingEstate) as { npcs: { wantsTalk?: boolean }[] };
    for (const npc of raw.npcs) delete npc.wantsTalk;
    const state = WorldStateSchema.parse(raw);
    expect(state.npcs.every((n) => n.wantsTalk === false)).toBe(true);
  });

  it("clears after introSpoken when the player opens the tab with no Confirm waiting", () => {
    const state = boot();
    expect(introStillOwed(state, "smith")).toBe(true);
    markIntroSpoken(state, "smith");
    expect(introStillOwed(state, "smith")).toBe(false);
    dismissNewsWantsTalk(state, "smith", []);
    expect(flagOf(state, "smith")).toBe(false);
  });

  it("keeps the badge on tab-open while a Confirm from that NPC is still pending", () => {
    const state = boot();
    markIntroSpoken(state, "smith");
    state.npcs.find((n) => n.id === "smith")!.wantsTalk = true;
    dismissNewsWantsTalk(state, "smith", [{ status: "pending", npcId: "smith" }]);
    expect(flagOf(state, "smith")).toBe(true);
  });

  it("clears a Confirm nag when the card is declined, unless an intro is still owed", () => {
    const state = boot();
    markIntroSpoken(state, "steward");
    state.npcs.find((n) => n.id === "steward")!.wantsTalk = true;
    releaseConfirmWantsTalk(state, "steward", []);
    expect(flagOf(state, "steward")).toBe(false);

    expect(flagOf(state, "smith")).toBe(true);
    releaseConfirmWantsTalk(state, "smith", []);
    expect(flagOf(state, "smith")).toBe(true);
  });

  it("sets Gerulf wantsTalk when a hunt resolves", () => {
    const state = boot();
    markIntroSpoken(state, "negotiator");
    dismissNewsWantsTalk(state, "negotiator", []);
    expect(flagOf(state, "negotiator")).toBe(false);
    const brief = quoteHunt(state, { goods: "pepper", resource: "pepper", amount: 1 });
    expect(startHunt(state, huntProposal(brief)).ok).toBe(true);
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    for (let i = 0; i < brief.durationSeasons; i++) resolveHunts(state);
    vi.restoreAllMocks();
    expect(flagOf(state, "negotiator")).toBe(true);
  });

  it("sets Bernard wantsTalk when a forge-tagged project completes", () => {
    const state = boot();
    markIntroSpoken(state, "smith");
    dismissNewsWantsTalk(state, "smith", []);
    state.projects.push(activeProject({ id: "bloom-1", key: "bloomery", name: "Small bloomery", tag: "forge" }));
    const before = WorldStateSchema.parse(structuredClone(state));
    resolveAgricultureAndProjects(state);
    expect(state.projects.find((p) => p.id === "bloom-1")?.status).toBe("completed");
    expect(flagOf(state, "smith")).toBe(true);
    expect(ownerNpcIdForCompletedProject(state, state.projects.find((p) => p.id === "bloom-1")!)).toBe("smith");
    expect(completedProjectBeats(before, state).some((b) => b.npcId === "smith" && /bloomery/i.test(b.text))).toBe(true);
  });

  it("sets Ermenald wantsTalk when a church-tagged project completes", () => {
    const state = boot();
    markIntroSpoken(state, "chaplain");
    dismissNewsWantsTalk(state, "chaplain", []);
    state.projects.push(activeProject({ id: "cell-1", key: "timber_chapel", name: "Simple timber chapel", tag: "church" }));
    resolveAgricultureAndProjects(state);
    expect(flagOf(state, "chaplain")).toBe(true);
  });

  it("sets a hired specialist when their craft project completes, else Aldric for a mill", () => {
    const state = boot();
    const haimo = specialistById("carpenter")!;
    state.npcs.push(specialistNpc(haimo));
    markIntroSpoken(state, "carpenter");
    dismissNewsWantsTalk(state, "carpenter", []);
    state.projects.push(
      activeProject({ id: "shop-1", key: "carpenter_workshop", name: "Carpenter's workshop" }),
    );
    resolveAgricultureAndProjects(state);
    expect(flagOf(state, "carpenter")).toBe(true);

    const mill = boot();
    mill.npcs.find((n) => n.id === "smith")!.wantsTalk = false;
    mill.projects.push(activeProject({ id: "mill-1", key: "flour_mill", name: "Flour mill", tag: "mill" }));
    resolveAgricultureAndProjects(mill);
    expect(flagOf(mill, "steward")).toBe(true);
    expect(flagOf(mill, "smith")).toBe(false);
  });

  it("sets wantsTalk on a named merchant when they arrive", () => {
    const state = boot();
    applyMerchantRoll(state, { base: 0.3, bonus: 0, chance: 0.3, notes: [], arrived: true });
    expect(state.npcs.find((n) => n.id === "merchant")?.wantsTalk).toBe(true);
  });

  it("sets wantsTalk on Confirm hire of a specialist", () => {
    const state = boot();
    state.resources.denarii = 200;
    const spec = specialistById("carpenter")!;
    const result = applyProposal(
      state,
      { type: "register_npc", summary: "Hire Haimo", npc: specialistNpc(spec), isNew: true },
      "steward",
    );
    expect(result.ok).toBe(true);
    expect(flagOf(state, "carpenter")).toBe(true);
  });
});
