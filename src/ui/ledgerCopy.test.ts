import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { applyProposal } from "../engine/applyDelta";
import { WorldStateSchema, type WorldState } from "../engine/schema";
import {
  confirmBanner,
  featureName,
  landName,
  marketLine,
  merchantPresentLine,
  modifierLine,
  labourOnWorkLine,
  playerFacingReason,
  playerFacingSummary,
  projectProgressLine,
  proposalBlurb,
  proposalTypeName,
  resourceName,
  roleName,
  seasonBooksLabel,
  sowingShareLine,
  workDisplayName,
} from "./ledgerCopy";

const JARGON = /proj-|REJECT\b|npc_not_authorized|customCosts|\b[a-z]+_[a-z0-9]+\b/;

function estate(): WorldState {
  const state = WorldStateSchema.parse(structuredClone(startingEstate));
  state.resources.softwood = 40;
  state.resources.hardwood = 20;
  state.resources.iron = 80;
  state.resources.stone = 20;
  return state;
}

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
    expect(proposalTypeName("add_modifier")).toBe("A custom of the hall");
    expect(proposalTypeName("remove_modifier")).toBe("A standing custom");
    expect(proposalTypeName("add_modifier")).not.toMatch(/_|modifier/i);
    expect(workDisplayName("flour_mill")).toBe("Flour mill");
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
    expect(labourOnWorkLine({ men: 12, women: 0, youths: 0 })).toBe("12 men called this season");
    expect(labourOnWorkLine({ men: 0, women: 0, youths: 0 })).toBe("no extra hands called this season");
    expect(seasonBooksLabel("spring", 825)).toBe("Spring 825");
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
    expect(
      proposalBlurb({
        type: "assign_labour",
        summary: "assign_labour",
        projectId: "proj-xyz",
        men: 12,
        women: 0,
        youths: 0,
      }),
    ).toBe("12 men to the work.");
    expect(playerFacingSummary({ type: "assign_labour", summary: "assign_labour" })).toBe("");
    expect(proposalTypeName("settle_households")).toBe("People at the gate");
    expect(proposalTypeName("defer_proposal")).toBe("A forthcoming order");
    expect(
      proposalBlurb({
        type: "defer_proposal",
        summary: "After this harvest: three-field rotation on the ploughland.",
        beat: "after_harvest",
        text: "After this harvest: three-field rotation on the ploughland.",
        proposal: {
          type: "adjust_sowing",
          summary: "Keep a three-field rotation.",
          holdingId: "fontenay",
          rotation: "three_field",
        },
      }),
    ).toMatch(/After this harvest: three-field rotation/);
    expect(proposalTypeName("settle_households")).not.toMatch(/_|settle/i);
    expect(
      proposalBlurb({
        type: "settle_households",
        summary: "A family seeks a place among the demesne people.",
        households: 1,
        adult_men: 1,
        adult_women: 1,
        youths: 1,
      }),
    ).toMatch(/one household/i);
    expect(
      proposalBlurb({
        type: "settle_households",
        summary: "A family seeks a place among the demesne people.",
        households: 1,
        adult_men: 1,
        adult_women: 1,
        youths: 1,
      }),
    ).not.toMatch(/happiness|peopleHappiness|mood/i);
  });

  it("rewrites apply fail reasons into steward speech", () => {
    expect(playerFacingReason("npc_not_authorized")).toBe("That is not theirs to order.");
    expect(playerFacingReason("Unknown project.")).toBe("I know no such work on the estate.");
    expect(playerFacingReason("No such active project.")).toBe("There is no such work underway.");
    expect(playerFacingReason("Unknown holding.")).toBe("I know no such holding.");
    expect(playerFacingReason("Unknown project 'flour_mill' and no customCosts declared.")).toMatch(/flour mill/i);
    expect(playerFacingReason("REJECT smith assign_labour: npc_not_authorized")).toBe("That is not theirs to order.");
    expect(playerFacingReason("Not enough callable labour (pool men 180, women 80, youths 40).")).toMatch(
      /180 men, 80 women, and 40 youths/,
    );
    expect(playerFacingReason("The merchant has no 4 trade_goods on the carts.")).toMatch(/wares/);
    for (const reason of [
      "npc_not_authorized",
      "Unknown project.",
      "No such active project.",
      "Unknown holding.",
      "Unknown project 'flour_mill' and no customCosts declared.",
      "REJECT smith assign_labour: npc_not_authorized",
      "Unknown resource 'trade_goods'. Register it first.",
    ]) {
      expect(playerFacingReason(reason)).not.toMatch(JARGON);
    }
  });
});

describe("apply success and fail voice the lord can read", () => {
  it("start_project and assign_labour logLines have no generated ids or engine keys", () => {
    const state = estate();
    const started = applyProposal(
      state,
      { type: "start_project", summary: "Begin a flour mill", projectKey: "flour_mill", holdingId: "fontenay" },
      "steward",
    );
    expect(started.ok).toBe(true);
    expect(started.logLine).toMatch(/I have called/i);
    expect(started.logLine).toMatch(/flour mill/i);
    expect(started.logLine).not.toMatch(JARGON);
    expect(started.logLine).not.toMatch(/Materials reserved/i);

    const mill = state.projects.find((p) => p.key === "flour_mill")!;
    const assigned = applyProposal(
      state,
      { type: "assign_labour", summary: "Hands on the mill", projectId: mill.id, men: 12, women: 0, youths: 0 },
      "steward",
    );
    expect(assigned.ok).toBe(true);
    expect(assigned.logLine).toMatch(/I have called/i);
    expect(assigned.logLine).toMatch(/flour mill/i);
    expect(assigned.logLine).not.toMatch(JARGON);
    expect(assigned.logLine).not.toContain(mill.id);
  });

  it("common fail reasons stay coded internally but playerFacingReason has no jargon", () => {
    const state = estate();
    const miss = applyProposal(
      state,
      { type: "assign_labour", summary: "Hands", projectId: "glassworks", men: 4, women: 0, youths: 0 },
      "steward",
    );
    expect(miss.ok).toBe(false);
    expect(miss.reason).toBe("No such active project.");
    expect(playerFacingReason(miss.reason!)).not.toMatch(JARGON);

    const unknown = applyProposal(
      state,
      { type: "start_project", summary: "Begin a glassworks", projectKey: "glassworks", holdingId: "fontenay" },
      "steward",
    );
    expect(unknown.ok).toBe(false);
    expect(unknown.reason).toMatch(/customCosts|Unknown project/);
    expect(playerFacingReason(unknown.reason!)).not.toMatch(JARGON);

    const smith = applyProposal(
      state,
      { type: "adjust_sowing", summary: "More barley", holdingId: "fontenay", springBarleyShare: 0.9 },
      "smith",
    );
    expect(smith.ok).toBe(false);
    expect(smith.reason).toBe("npc_not_authorized");
    expect(playerFacingReason(smith.reason!)).not.toMatch(JARGON);
    expect(smith.logLine).not.toMatch(/REJECT/);
  });
});
