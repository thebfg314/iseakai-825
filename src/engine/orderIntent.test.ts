import { describe, expect, it } from "vitest";
import { looksLikeMechanicalOrder, inferOrderProposals } from "./orderIntent";
import { WorldStateSchema } from "./schema";
import startingEstate from "../../data/starting-estate.json";

const THREE_FIELD_ORDER =
  "ok. Id like us to split our farming fields into a three-field rotation, rest one year under legumes (peas), put manure on the tired acres, and keep the best seed-selection back for sowing.";

describe("looksLikeMechanicalOrder", () => {
  it("treats the three-field / legumes / manure / seed-selection paragraph as an order", () => {
    expect(looksLikeMechanicalOrder(THREE_FIELD_ORDER)).toBe(true);
  });

  it("drafts a deferred three-field sowing for that paragraph", () => {
    const state = WorldStateSchema.parse(structuredClone(startingEstate));
    const inferred = inferOrderProposals(state, "steward", THREE_FIELD_ORDER);
    expect(inferred).toHaveLength(1);
    expect(inferred[0]).toMatchObject({
      type: "defer_proposal",
      beat: "after_harvest",
      proposal: { type: "adjust_sowing", rotation: "three_field" },
    });
  });

  it("does not treat a lands report question as an order", () => {
    expect(looksLikeMechanicalOrder("How are my lands faring Aldric?")).toBe(false);
  });

  it("does not treat a pure husbandry question as an order", () => {
    expect(looksLikeMechanicalOrder("How should we handle manure?")).toBe(false);
  });

  it("still treats sow / hire verbs as orders", () => {
    expect(looksLikeMechanicalOrder("Sow more barley on the remaining acres.")).toBe(true);
    expect(looksLikeMechanicalOrder("Hire Haimo the carpenter.")).toBe(true);
  });

  it("treats a Gerulf find request as an order", () => {
    expect(looksLikeMechanicalOrder("Find me pepper.", "negotiator")).toBe(true);
    expect(looksLikeMechanicalOrder("How are the roads?", "negotiator")).toBe(false);
  });
});
