import { describe, expect, it, vi } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { applyProposal } from "./applyDelta";
import { GERULF_NOTES, GERULF_ROAD_LOCATION, NEGOTIATOR_ID, ensureGerulfInHousehold, extractHuntRequest, huntFulfillReason, huntProposal, inferHuntProposals, looksLikeHuntOrder, quoteHunt, resolveHunts, startHunt } from "./hunts";
import { WorldStateSchema, type WorldState } from "./schema";
import { resolveAgricultureAndProjects } from "./season";

function boot(): WorldState {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

describe("Gerulf the negotiator", () => {
  it("starts in the household with signed-off notes", () => {
    const state = boot();
    const gerulf = state.npcs.find((n) => n.id === NEGOTIATOR_ID);
    expect(gerulf).toMatchObject({ name: "Gerulf", role: "negotiator", location: "fontenay" });
    expect(gerulf?.notes).toBe(GERULF_NOTES);
    expect(state.npcs.map((n) => n.id)).toEqual(["steward", "smith", "chaplain", "negotiator"]);
  });

  it("injects Gerulf into an old save that lacks him", () => {
    const state = boot();
    state.npcs = state.npcs.filter((n) => n.id !== NEGOTIATOR_ID);
    expect(ensureGerulfInHousehold(state)).toBe(true);
    expect(state.npcs.some((n) => n.id === NEGOTIATOR_ID && n.name === "Gerulf")).toBe(true);
    expect(ensureGerulfInHousehold(state)).toBe(false);
  });

  it("refuses barley and iron, and quotes the purse himself", () => {
    expect(looksLikeHuntOrder("Find me some pepper.")).toBe(true);
    expect(extractHuntRequest("Find me some pepper.")).toMatchObject({ goods: "pepper", resource: "pepper" });
    expect(huntFulfillReason(boot(), "Find me barley for the granary.")).toMatch(/Aldric/i);
    expect(huntFulfillReason(boot(), "Find me iron for the forge.")).toMatch(/Bernard/i);
    expect(inferHuntProposals(boot(), "Find me barley.")).toEqual([]);

    const state = boot();
    const proposals = inferHuntProposals(state, "Find me pepper.");
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ type: "start_hunt", goods: "pepper" });
    if (proposals[0].type !== "start_hunt") throw new Error("expected start_hunt");
    expect(proposals[0].quotedDenarii).toBeGreaterThan(0);
    expect(proposals[0].durationSeasons).toBeGreaterThanOrEqual(1);
    expect(proposals[0].summary).toMatch(/denarii/i);
  });

  it("escrows the quoted purse on Confirm and creates a hunt project", () => {
    const state = boot();
    const chest = state.resources.denarii;
    const brief = quoteHunt(state, { goods: "pepper", resource: "pepper", amount: 1 });
    const result = applyProposal(state, huntProposal(brief), NEGOTIATOR_ID);
    expect(result.ok).toBe(true);
    expect(state.resources.denarii).toBe(chest - brief.quotedDenarii);
    const hunt = state.projects.find((p) => p.tag === "hunt" && p.status === "active");
    expect(hunt?.hunt).toMatchObject({
      goods: "pepper",
      resource: "pepper",
      quotedDenarii: brief.quotedDenarii,
      escrowedDenarii: brief.quotedDenarii,
      durationSeasons: brief.durationSeasons,
      seasonsElapsed: 0,
    });
    expect(state.npcs.find((n) => n.id === NEGOTIATOR_ID)?.location).toBe(GERULF_ROAD_LOCATION);
    expect(huntFulfillReason(state, "Find me silk instead.")).toMatch(/already on the road|mid-hunt/i);
    expect(inferHuntProposals(state, "Find me silk.")).toEqual([]);
  });

  it("resolves a successful hunt into stores after the quoted seasons", () => {
    const state = boot();
    const brief = quoteHunt(state, { goods: "pepper", resource: "pepper", amount: 1 });
    expect(startHunt(state, huntProposal(brief)).ok).toBe(true);
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    for (let i = 0; i < brief.durationSeasons - 1; i++) {
      const mid = resolveHunts(state);
      expect(mid.some((l) => /still on the road/i.test(l))).toBe(true);
      expect(state.projects.some((p) => p.status === "active" && p.hunt)).toBe(true);
    }
    const done = resolveHunts(state);
    vi.restoreAllMocks();
    expect(done.some((l) => /returned with/i.test(done.join(" ")))).toBe(true);
    expect(state.projects.find((p) => p.hunt)?.status).toBe("completed");
    const pepper = state.custom_resources.find((c) => c.id === "pepper");
    expect(pepper?.amount).toBe(1);
    expect(state.npcs.find((n) => n.id === NEGOTIATOR_ID)?.location).toBe("fontenay");
    expect(state.projects.find((p) => p.hunt)?.hunt?.reportSpeech).toMatch(/I have it, my lord/i);
  });

  it("returns coin and no goods on a false rumour", () => {
    const state = boot();
    const chestBefore = state.resources.denarii;
    const brief = quoteHunt(state, { goods: "silk", resource: "silk", amount: 1 });
    expect(startHunt(state, huntProposal(brief)).ok).toBe(true);
    expect(state.resources.denarii).toBe(chestBefore - brief.quotedDenarii);
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    for (let i = 0; i < brief.durationSeasons; i++) resolveHunts(state);
    vi.restoreAllMocks();
    expect(state.custom_resources.find((c) => c.id === "silk")?.amount ?? 0).toBe(0);
    expect(state.resources.denarii).toBeGreaterThan(chestBefore - brief.quotedDenarii);
    expect(state.resources.denarii).toBeLessThan(chestBefore);
    expect(state.projects.find((p) => p.hunt)?.hunt?.reportSpeech).toMatch(/False rumour/i);
  });

  it("advances hunts on season tick without labour", () => {
    const state = boot();
    const brief = quoteHunt(state, { goods: "pepper", resource: "pepper", amount: 1 });
    expect(startHunt(state, huntProposal(brief)).ok).toBe(true);
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    for (let i = 0; i < brief.durationSeasons - 1; i++) {
      resolveAgricultureAndProjects(state);
      expect(state.projects.find((p) => p.hunt)?.status).toBe("active");
    }
    resolveAgricultureAndProjects(state);
    vi.restoreAllMocks();
    expect(state.projects.find((p) => p.hunt)?.status).toBe("completed");
    expect(state.custom_resources.some((c) => c.id === "pepper" && c.amount > 0)).toBe(true);
  });
});
