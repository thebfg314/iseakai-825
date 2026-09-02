import { describe, expect, it } from "vitest";
import {
  confirmBanner,
  featureName,
  landName,
  marketLine,
  merchantPresentLine,
  modifierLine,
  projectProgressLine,
  proposalBlurb,
  proposalTypeName,
  resourceName,
  roleName,
  sowingShareLine,
} from "./ledgerCopy";

describe("steward ledger voice", () => {
  it("uses period names for land, features, roles, and stores", () => {
    expect(landName("fertile_arable")).toBe("good ploughland");
    expect(landName("waste")).toBe("overgrown waste");
    expect(featureName("chapel")).toBe("timber oratory");
    expect(featureName("mill_forge")).toBe("mill-forge");
    expect(featureName("bloomery")).toBe("bloomery");
    expect(resourceName("trade_goods")).toBe("wares");
    expect(roleName("village_reeve")).toBe("village reeve");
    expect(roleName("copper_smith")).toBe("copper-smith");
  });

  it("speaks sowing shares and market prices without percents or snake_case", () => {
    expect(sowingShareLine("spring", 0.6)).toBe("Of the spring seed, three parts barley, the rest oats.");
    expect(sowingShareLine("autumn", 0.45)).toBe("Of the autumn seed, near half wheat, the rest rye.");
    expect(marketLine("wheat", 3, 5)).toBe("wheat fetches 3–5 denarii the modius");
    expect(merchantPresentLine("Isaac")).toBe("Isaac the merchant is in the district.");
    expect(merchantPresentLine("Isaac")).not.toMatch(/rolled/i);
  });

  it("hides programmer proposal types, JSON fields, and modifier math", () => {
    expect(proposalTypeName("transfer_resources")).toBe("The stores");
    expect(proposalTypeName("transfer_resources")).not.toMatch(/_/);
    expect(
      proposalBlurb({
        type: "transfer_resources",
        summary: "Buy salt",
        resource: "salt",
        amount: 4,
        direction: "buy",
      }),
    ).toBe("Buy 4 pounds of salt from the merchant.");
    expect(
      proposalBlurb({
        type: "add_modifier",
        summary: "Blessing",
        target: "mood",
        kind: "temporary",
        seasonsRemaining: 2,
        effect: { op: "add", value: 0.1 },
        source: "Ermenald's blessing",
      }),
    ).toBe("The people would take heart for 2 seasons (Ermenald's blessing).");
    expect(modifierLine({
      id: "m1",
      target: "mood",
      kind: "temporary",
      seasons_remaining: 2,
      effect: { op: "add", value: 0.1 },
      source: "Ermenald's blessing",
    })).toBe("the people are in better heart (2 seasons yet)");
    expect(projectProgressLine(35, 70)).toBe("half raised · 35 days still owed");
    expect(confirmBanner(1)).toMatch(/Confirm is Aldric writing it in the books/);
    expect(confirmBanner(1)).not.toMatch(/world-state/);
    expect(
      proposalBlurb({
        type: "start_hunt",
        summary: "Gerulf seeks pepper",
        goods: "pepper",
        resource: "pepper",
        amount: 1,
        quotedDenarii: 42,
        durationSeasons: 2,
      }),
    ).toMatch(/42 denarii over 2 seasons/);
  });
});
