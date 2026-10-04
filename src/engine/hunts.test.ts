import { describe, expect, it, vi } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { applyProposal } from "./applyDelta";
import { GERULF_NOTES, GERULF_ROAD_LOCATION, HUNT_DIFFICULTY_MULTIPLIER, NEGOTIATOR_ID, ensureGerulfInHousehold, extractHuntRequest, huntFulfillReason, huntProposal, huntProposalForAsk, inferHuntProposals, looksLikeHuntOrder, normalizeHuntProposal, ordinaryHuntPurse, parseHuntDifficulty, quoteHunt, resolveHuntDifficulty, resolveHunts, resolveRoadSeasons, roadSeasonWords, seasonsAskedByLord, seasonsNamedInText, startHunt, withComputedHuntPrice } from "./hunts";
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
    expect(iron[0].quotedDenarii).toBe(ordinaryHuntPurse(state.market.iron.max, 4, "easy"));
    expect(iron[0].quotedDenarii).toBe(Math.round(4 * state.market.iron.max * HUNT_DIFFICULTY_MULTIPLIER.easy));
    expect(iron[0].difficulty).toBe("easy");
    expect(iron[0].durationSeasons).toBe(1);

    const proposals = inferHuntProposals(state, "Find me pepper.");
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ type: "start_hunt", goods: "pepper", difficulty: "medium" });
    if (proposals[0].type !== "start_hunt") throw new Error("expected start_hunt");
    expect(proposals[0].quotedDenarii).toBe(Math.round(42 * 1.4));
    expect(proposals[0].quotedDenarii).toBeGreaterThan(iron[0].quotedDenarii);
    expect(proposals[0].durationSeasons).toBeGreaterThanOrEqual(1);
    expect(proposals[0].summary).toMatch(/denarii/i);
  });

  it("reads beeswax and honey as the wax and honey, not as hives", () => {
    const state = boot();
    expect(state.market.beeswax).toEqual({ min: 3, max: 8 });
    expect(state.market.honey).toEqual({ min: 2, max: 5 });
    expect(state.market.bees.max).toBe(30);

    for (const ask of [
      "Send Gerulf to buy 3 pounds of beeswax.",
      "Buy me three pounds of bees wax for the candles.",
      "Fetch 3 pounds of bee's wax.",
      "Go find 3 pounds of wax.",
    ]) {
      expect(looksLikeHuntOrder(ask)).toBe(true);
      expect(extractHuntRequest(ask)).toMatchObject({ resource: "beeswax", amount: 3 });
    }

    const wax = inferHuntProposals(state, "Buy me 3 pounds of bees wax.");
    expect(wax).toHaveLength(1);
    if (wax[0].type !== "start_hunt") throw new Error("expected start_hunt");
    expect(wax[0].resource).toBe("beeswax");
    expect(wax[0].unit).toBe("pound");
    expect(wax[0].quotedDenarii).toBe(ordinaryHuntPurse(state.market.beeswax.max, 3, "medium"));
    // Before the fix this brief was read as 3 hives: 3 × 30 × 1.4 = 126 denarii.
    expect(wax[0].quotedDenarii).toBe(34);
    expect(wax[0].quotedDenarii).toBeLessThan(ordinaryHuntPurse(state.market.bees.max, 3, "medium"));
    expect(huntFulfillReason(state, "Buy me 3 pounds of bees wax.")).toBeNull();

    const honey = inferHuntProposals(state, "Fetch 4 pounds of honey.");
    expect(honey).toHaveLength(1);
    if (honey[0].type !== "start_hunt") throw new Error("expected start_hunt");
    expect(honey[0].resource).toBe("honey");
    expect(honey[0].quotedDenarii).toBe(ordinaryHuntPurse(state.market.honey.max, 4, "medium"));

    expect(extractHuntRequest("Buy two bee hives.")).toMatchObject({ resource: "bees", amount: 2 });
    expect(extractHuntRequest("Buy two skeps of bees.")).toMatchObject({ resource: "bees", amount: 2 });
    expect(extractHuntRequest("Find me 2 hives.")).toMatchObject({ resource: "bees", amount: 2 });
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
    const brief = quoteHunt(state, { goods: "pepper", resource: "pepper", amount: 1 });
    state.resources.denarii = Math.max(state.resources.denarii, brief.quotedDenarii);
    const chest = state.resources.denarii;
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
    state.resources.denarii = Math.max(state.resources.denarii, brief.quotedDenarii);
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
    const brief = quoteHunt(state, { goods: "silk", resource: "silk", amount: 1 });
    state.resources.denarii = Math.max(state.resources.denarii, brief.quotedDenarii);
    const chestBefore = state.resources.denarii;
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
    state.resources.denarii = Math.max(state.resources.denarii, brief.quotedDenarii);
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

  it("prices identical asks at the high end of the band times the road's difficulty", () => {
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
    expect(atTheHighEnd).toBe(280);
    expect(HUNT_DIFFICULTY_MULTIPLIER).toEqual({ easy: 1.1, medium: 1.4, difficult: 1.7 });
    expect(ordinaryHuntPurse(state.market.iron.max, 35, "easy")).toBe(308);
    expect(ordinaryHuntPurse(state.market.iron.max, 35, "medium")).toBe(392);
    expect(ordinaryHuntPurse(state.market.iron.max, 35, "medium")).not.toBe(35 * 8 * 14);
    expect(ordinaryHuntPurse(state.market.iron.max, 35, "difficult")).toBe(476);
    expect(ordinaryHuntPurse(state.market.iron.min, 35)).not.toBe(308);
    expect(first.difficulty).toBe("easy");
    expect(first.quotedDenarii).toBe(308);
    expect(second.quotedDenarii).toBe(first.quotedDenarii);
    expect(first.amount).toBe(35);
    expect(quoteHunt(state, { ...extractHuntRequest(ask)!, difficulty: "difficult" }).quotedDenarii).toBe(476);
    expect(quoteHunt(state, { ...extractHuntRequest(again)!, difficulty: "difficult" }).quotedDenarii).toBe(476);

    expect(parseHuntDifficulty("14")).toBeUndefined();
    expect(parseHuntDifficulty("14x")).toBeUndefined();
    expect(parseHuntDifficulty(14)).toBeUndefined();
    expect(parseHuntDifficulty("1.4")).toBeUndefined();
    expect(parseHuntDifficulty("medium")).toBe("medium");
    expect(parseHuntDifficulty("hard")).toBe("difficult");
    expect(resolveHuntDifficulty("iron", "14x")).toBe("easy");
    expect(resolveHuntDifficulty("charcoal", "medium")).toBe("medium");
    expect(resolveHuntDifficulty("iron")).toBe("easy");
    expect(resolveHuntDifficulty("iron", "difficult")).toBe("difficult");
    expect(resolveHuntDifficulty("salt")).toBe("easy");
    expect(resolveHuntDifficulty("softwood")).toBe("easy");
    expect(resolveHuntDifficulty("hardwood")).toBe("easy");
    expect(resolveHuntDifficulty("timber")).toBe("easy");
    expect(resolveHuntDifficulty("wheat")).toBe("easy");
    expect(resolveHuntDifficulty("charcoal")).toBe("medium");
    expect(resolveHuntDifficulty("pepper")).toBe("medium");
    expect(resolveHuntDifficulty("stone")).toBe("medium");

    const salt = quoteHunt(state, { goods: "salt", resource: "salt", amount: 4 });
    expect(salt.difficulty).toBe("easy");
    expect(salt.quotedDenarii).toBe(ordinaryHuntPurse(state.market.salt.max, 4, "easy"));
    expect(salt.quotedDenarii).toBe(Math.round(4 * state.market.salt.max * 1.1));
    const charcoal = quoteHunt(state, { goods: "charcoal", resource: "charcoal", amount: 2 });
    expect(charcoal.difficulty).toBe("medium");
    expect(charcoal.quotedDenarii).toBe(ordinaryHuntPurse(state.market.charcoal.max, 2, "medium"));
    expect(charcoal.quotedDenarii).toBe(Math.round(2 * state.market.charcoal.max * 1.4));
    const timber = quoteHunt(state, { goods: "softwood", resource: "softwood", amount: 1 });
    expect(timber.difficulty).toBe("easy");
    expect(timber.quotedDenarii).toBe(Math.round(state.market.softwood.max * 1.1));

    expect(huntFulfillReason(state, ask)).toMatch(/cannot spare/);
    expect(huntFulfillReason(state, ask)).toContain("308 denarii");
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
    expect(invented).toContain("308 denarii");
    expect(inventedAgain).toContain("308 denarii");
    expect(invented).not.toMatch(/\b42\b/);
    expect(inventedAgain).not.toMatch(/\b28\b/);
    expect(invented).toMatch(/forge stand idle/);
    expect(invented).toMatch(/one season/);
    expect(first.durationSeasons).toBe(1);
  });

  it("starts with 25 lb of iron and 138 denarii", () => {
    const state = boot();
    expect(state.resources.iron).toBe(25);
    expect(state.resources.denarii).toBe(138);
  });

  it("takes the seasons from the road he judged, not from the purse or the weight", () => {
    const state = boot();
    const small = quoteHunt(state, { goods: "iron", resource: "iron", amount: 1 }, { judged: 3 });
    expect(small.quotedDenarii).toBe(Math.round(8 * 1.1));
    expect(small.quotedDenarii).toBeLessThan(60);
    expect(small.durationSeasons).toBe(3);

    const dear = quoteHunt(state, { goods: "iron", resource: "iron", amount: 40 }, { judged: 1 });
    expect(dear.quotedDenarii).toBe(Math.round(40 * 8 * 1.1));
    expect(dear.quotedDenarii).toBe(352);
    expect(dear.durationSeasons).toBe(1);

    const wide = quoteHunt(state, { goods: "iron", resource: "iron", amount: 1000 });
    const wider = quoteHunt(state, { goods: "iron", resource: "iron", amount: 1000 }, { judged: 2 });
    const widest = quoteHunt(state, { goods: "iron", resource: "iron", amount: 1000 }, { judged: 3 });
    expect(wide.quotedDenarii).toBe(wider.quotedDenarii);
    expect(widest.quotedDenarii).toBe(wide.quotedDenarii);
    expect(wide.quotedDenarii).toBe(ordinaryHuntPurse(state.market.iron.max, wide.amount, "easy"));
    expect(wide.durationSeasons).toBe(1);
    expect(wider.durationSeasons).toBe(2);
    expect(widest.durationSeasons).toBe(3);
    expect(resolveRoadSeasons(undefined, undefined, 1)).toBe(1);
    expect(resolveRoadSeasons(4, 1, 1)).toBe(4);
  });

  it("lets the lord shorten a nearby errand and leaves a far road as judged", () => {
    const state = boot();
    const nearby = quoteHunt(state, { goods: "iron", resource: "iron", amount: 10 }, { judged: 2, asked: 1 });
    expect(nearby.quotedDenarii).toBe(88);
    expect(nearby.durationSeasons).toBe(1);
    expect(quoteHunt(state, { goods: "iron", resource: "iron", amount: 10 }, { judged: 2 }).durationSeasons).toBe(2);
    expect(quoteHunt(state, { goods: "iron", resource: "iron", amount: 10 }, { judged: 1, asked: 4 }).durationSeasons).toBe(1);

    const horses = quoteHunt(state, { goods: "horses", resource: "horses", amount: 1 }, { judged: 3, asked: 1 });
    expect(horses.quotedDenarii).toBe(ordinaryHuntPurse(state.market.horses.max, 1, "medium"));
    expect(horses.durationSeasons).toBe(3);
    const silk = quoteHunt(state, { goods: "silk", resource: "silk", amount: 1 }, { asked: 1 });
    expect(silk.durationSeasons).toBe(3);
    const pepper = quoteHunt(state, { goods: "pepper", resource: "pepper", amount: 1 }, { asked: 1 });
    expect(pepper.durationSeasons).toBe(1);
    expect(pepper.quotedDenarii).toBe(Math.round(42 * 1.4));
  });

  it("does not let an ordinary-goods season shorten an unfree hunt", () => {
    const state = boot();
    const one = quoteHunt(state, { goods: "unfree", resource: "mancipia", amount: 1 }, { judged: 1, asked: 1 });
    expect(one.quotedDenarii).toBe(112);
    expect(one.durationSeasons).toBe(2);
    const three = quoteHunt(
      state,
      { goods: "three slaves", resource: "slaves", amount: 3 },
      { judged: 1, asked: 1 },
    );
    expect(three.quotedDenarii).toBeGreaterThan(300);
    expect(three.durationSeasons).toBe(3);
    const asked = "Find three slaves in one season.";
    expect(seasonsAskedByLord(asked)).toBe(1);
    state.resources.denarii = 1000;
    const queued = huntProposalForAsk(state, asked, "medium", 1);
    expect(queued?.[0]).toMatchObject({ type: "start_hunt", resource: "mancipia", durationSeasons: 3 });
  });

  it("makes his speech name the same seasons as the card", () => {
    const state = boot();
    const far = quoteHunt(state, { goods: "horses", resource: "horses", amount: 1 }, { judged: 3, asked: 1 });
    const spoken = withComputedHuntPrice("I can have the horses in one season for 10 denarii.", far);
    expect(spoken).toMatch(/three seasons/);
    expect(spoken).not.toMatch(/\bone season\b/);
    expect(spoken).toContain(`${far.quotedDenarii} denarii`);
    expect(spoken).not.toMatch(/\b10 denarii\b/);
    expect(huntProposal(far).summary).toMatch(/3 seasons/);

    const quiet = withComputedHuntPrice("Aye.", quoteHunt(state, { goods: "iron", resource: "iron", amount: 4 }, { judged: 2 }));
    expect(quiet).toContain(roadSeasonWords(2));
    expect(seasonsNamedInText("back within a single season")).toBe(1);
    expect(seasonsNamedInText("five seasons, then one season")).toBe(1);
  });

  it("keeps the card's seasons when he leaves", () => {
    const state = boot();
    state.resources.denarii = 500;
    const brief = quoteHunt(state, { goods: "iron", resource: "iron", amount: 40 }, { judged: 1 });
    expect(brief.durationSeasons).toBe(1);
    expect(startHunt(state, huntProposal(brief)).ok).toBe(true);
    expect(state.projects.find((p) => p.hunt)?.hunt?.durationSeasons).toBe(1);
  });
});
