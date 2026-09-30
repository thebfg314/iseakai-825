import { describe, expect, it, vi } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { applyProposal } from "./applyDelta";
import { GERULF_NOTES, GERULF_ROAD_LOCATION, NEGOTIATOR_ID, ROAD_PREMIUM_RATE, ensureGerulfInHousehold, extractHuntRequest, huntFulfillReason, huntProposal, inferHuntProposals, looksLikeHuntOrder, ordinaryHuntPurse, quoteHunt, resolveHunts, startHunt, withComputedHuntPrice } from "./hunts";
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

  it("refuses barley, quotes iron himself, and keeps scarce goods dear", () => {
    expect(looksLikeHuntOrder("Find me some pepper.")).toBe(true);
    expect(extractHuntRequest("Find me some pepper.")).toMatchObject({ goods: "pepper", resource: "pepper" });
    expect(huntFulfillReason(boot(), "Find me barley for the granary.")).toMatch(/Aldric/i);
    expect(huntFulfillReason(boot(), "Find me iron for the forge.")).toBeNull();
    expect(inferHuntProposals(boot(), "Find me barley.")).toEqual([]);

    const state = boot();
    const iron = inferHuntProposals(state, "Find me 4 pounds of iron.");
    expect(iron).toHaveLength(1);
    expect(iron[0]).toMatchObject({ type: "start_hunt", resource: "iron", amount: 4 });
    if (iron[0].type !== "start_hunt") throw new Error("expected start_hunt");
    expect(iron[0].quotedDenarii).toBe(ordinaryHuntPurse(state.market.iron.max, 4));
    expect(iron[0].quotedDenarii).toBe(Math.round(4 * state.market.iron.max * (1 + ROAD_PREMIUM_RATE)));
    expect(iron[0].durationSeasons).toBe(1);

    const proposals = inferHuntProposals(state, "Find me pepper.");
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ type: "start_hunt", goods: "pepper" });
    if (proposals[0].type !== "start_hunt") throw new Error("expected start_hunt");
    expect(proposals[0].quotedDenarii).toBeGreaterThan(iron[0].quotedDenarii);
    expect(proposals[0].durationSeasons).toBeGreaterThanOrEqual(1);
    expect(proposals[0].summary).toMatch(/denarii/i);
  });

  it("Confirm spends the purse and a successful return adds the iron", () => {
    const state = boot();
    const chest = state.resources.denarii;
    const ironBefore = state.resources.iron;
    const proposals = inferHuntProposals(state, "Find me 4 pounds of iron for the bloomery.");
    expect(proposals).toHaveLength(1);
    if (proposals[0].type !== "start_hunt") throw new Error("expected start_hunt");
    const quote = proposals[0].quotedDenarii;
    const amount = proposals[0].amount;
    expect(applyProposal(state, proposals[0], NEGOTIATOR_ID).ok).toBe(true);
    expect(state.resources.denarii).toBe(chest - quote);
    expect(state.resources.iron).toBe(ironBefore);
    expect(state.npcs.find((n) => n.id === NEGOTIATOR_ID)?.location).toBe(GERULF_ROAD_LOCATION);
    expect(huntFulfillReason(state, "Find me silk instead.")).toMatch(/already on the road/i);

    vi.spyOn(Math, "random").mockReturnValue(0.1);
    const duration = state.projects.find((p) => p.hunt)?.hunt?.durationSeasons ?? 1;
    for (let i = 0; i < duration; i++) resolveHunts(state);
    vi.restoreAllMocks();
    expect(state.resources.iron).toBe(ironBefore + amount);
    expect(state.resources.denarii).toBe(chest - quote);
    expect(state.npcs.find((n) => n.id === NEGOTIATOR_ID)?.location).toBe("fontenay");
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

  it("prices identical asks at the high end of the band plus 10% for the road", () => {
    const state = boot();
    const ask = "Buy 35 lb of iron. I cannot wait for a merchant.";
    const again = "Buy thirty-five pounds of iron because I cannot wait for a merchant.";
    expect(looksLikeHuntOrder(ask)).toBe(true);
    expect(extractHuntRequest(ask)).toMatchObject({ resource: "iron", amount: 35 });
    expect(extractHuntRequest(again)).toMatchObject({ resource: "iron", amount: 35 });

    const first = quoteHunt(state, extractHuntRequest(ask)!);
    const second = quoteHunt(state, extractHuntRequest(again)!);
    expect(state.market.iron).toEqual({ min: 3, max: 8 });
    const atTheHighEnd = 35 * state.market.iron.max;
    const expected = Math.round(atTheHighEnd + atTheHighEnd * ROAD_PREMIUM_RATE);
    expect(atTheHighEnd).toBe(280);
    expect(expected).toBe(308);
    expect(ordinaryHuntPurse(state.market.iron.max, 35)).toBe(308);
    expect(ordinaryHuntPurse(state.market.iron.min, 35)).not.toBe(308);
    expect(first.quotedDenarii).toBe(expected);
    expect(second.quotedDenarii).toBe(first.quotedDenarii);
    expect(first.amount).toBe(35);

    const salt = quoteHunt(state, { goods: "salt", resource: "salt", amount: 4 });
    expect(salt.quotedDenarii).toBe(ordinaryHuntPurse(state.market.salt.max, 4));
    expect(salt.quotedDenarii).toBe(Math.round(4 * state.market.salt.max * (1 + ROAD_PREMIUM_RATE)));
    const charcoal = quoteHunt(state, { goods: "charcoal", resource: "charcoal", amount: 2 });
    expect(charcoal.quotedDenarii).toBe(ordinaryHuntPurse(state.market.charcoal.max, 2));
    expect(charcoal.quotedDenarii).toBe(Math.round(2 * state.market.charcoal.max * (1 + ROAD_PREMIUM_RATE)));

    expect(huntFulfillReason(state, ask)).toMatch(/cannot spare/);
    expect(huntFulfillReason(state, ask)).toContain(`${expected} denarii`);
    expect(huntFulfillReason(state, ask)).toMatch(/take nothing/i);
    expect(inferHuntProposals(state, ask)).toEqual([]);

    const invented = withComputedHuntPrice(
      "Aye. I'll fetch 35 pounds of iron for 42 denarii, road costs included, and have it back within one season. Better my boots wear than your forge stand idle.",
      first,
    );
    const inventedAgain = withComputedHuntPrice(
      "Aye. Thirty-five pounds of iron, fetched inland rather than prayed for at the gate. Give me 28 denarii and one season; that covers fair market price, tolls, and enough road-money to keep the iron from becoming someone else's iron.",
      second,
    );
    expect(invented).toContain(`${expected} denarii`);
    expect(inventedAgain).toContain(`${expected} denarii`);
    expect(invented).not.toMatch(/\b42\b/);
    expect(inventedAgain).not.toMatch(/\b28\b/);
    expect(invented).toMatch(/forge stand idle/);
  });
});
