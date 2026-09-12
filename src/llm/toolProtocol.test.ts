import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { WorldStateSchema } from "../engine/schema";
import {
  CHECK_RECORDS_LINE,
  collectDrawers,
  drawerForResource,
  hasMalformedToolMarker,
  holdingLineForDrawers,
  isMemoryOnlyDrawers,
  missingCitedDrawers,
  parseToolRequest,
  RECALL_DEALS_LINE,
  stripToolMarkers,
} from "./toolProtocol";

function boot() {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

describe("hidden tool markers", () => {
  it("parses a batch marker into grain and chest", () => {
    const req = parseToolRequest("A moment.\n<=-tool: grain, chest -=>\n");
    expect(req.malformed).toBe(false);
    expect(req.requested).toBe(true);
    expect(req.drawers.sort()).toEqual(["chest", "grain"]);
    expect(req.unknown).toEqual([]);
  });

  it("strips every marker from player-visible speech", () => {
    expect(stripToolMarkers("The rye stands well.\n<=-tool: grain, sown -=>\nAye.")).toBe(
      "The rye stands well.\n\nAye.",
    );
    expect(stripToolMarkers("<=-tool: grain -=>")).toBe("");
    expect(stripToolMarkers("<=-tool: my_deals -=>")).toBe("");
    expect(CHECK_RECORDS_LINE).toMatch(/check the records/i);
    expect(RECALL_DEALS_LINE).toMatch(/think on that/i);
    expect(RECALL_DEALS_LINE).not.toMatch(/check the records/i);
  });

  it("treats memories and deals as my_deals, and picks the think line only for memory-only pulls", () => {
    expect(parseToolRequest("<=-tool: my_deals -=>").drawers).toEqual(["my_deals"]);
    expect(parseToolRequest("<=-tool: memories -=>").drawers).toEqual(["my_deals"]);
    expect(parseToolRequest("<=-tool: deals -=>").drawers).toEqual(["my_deals"]);
    expect(parseToolRequest("<=-tool: grain, my_deals -=>").drawers.sort()).toEqual(["grain", "my_deals"]);
    expect(isMemoryOnlyDrawers(["my_deals"])).toBe(true);
    expect(isMemoryOnlyDrawers(["grain"])).toBe(false);
    expect(isMemoryOnlyDrawers(["grain", "my_deals"])).toBe(false);
    expect(isMemoryOnlyDrawers([])).toBe(false);
    expect(holdingLineForDrawers(["my_deals"])).toBe(RECALL_DEALS_LINE);
    expect(holdingLineForDrawers(["grain"])).toBe(CHECK_RECORDS_LINE);
    expect(holdingLineForDrawers(["chest", "my_deals"])).toBe(CHECK_RECORDS_LINE);
  });

  it("ignores unknown drawer names without treating the marker as malformed", () => {
    const req = parseToolRequest("<=-tool: grain, not_a_drawer, banana -=>");
    expect(req.malformed).toBe(false);
    expect(req.requested).toBe(true);
    expect(req.drawers).toEqual(["grain"]);
    expect(req.unknown).toEqual(["not_a_drawer", "banana"]);
  });

  it("treats a chopped marker as malformed", () => {
    expect(hasMalformedToolMarker("<=-tool: grain, chest")).toBe(true);
    expect(parseToolRequest("Let me see.\n<=-tool: grain").malformed).toBe(true);
    expect(parseToolRequest("<=-tool: grain, chest -=>").malformed).toBe(false);
  });
});

describe("engine drawers from live WorldState", () => {
  it("returns grain and chest together from a batch request", () => {
    const state = boot();
    const pack = collectDrawers(state, ["grain", "chest"]);
    expect(pack.grain).toMatchObject({ wheat: 5, rye: 8, barley: 4, oats: 3 });
    expect(pack.chest).toEqual({ denarii: 96 });
    expect(pack).not.toHaveProperty("not_a_drawer");
  });

  it("skips unknown names and does not throw", () => {
    const state = boot();
    expect(() => collectDrawers(state, ["nope", "grain"])).not.toThrow();
    const pack = collectDrawers(state, ["nope", "grain"]);
    expect(Object.keys(pack)).toEqual(["grain"]);
  });

  it("reports remaining extra days without an assignment harvest_risk flag", () => {
    const state = boot();
    const pack = collectDrawers(state, ["labour"]);
    expect(pack.labour).toMatchObject({
      remaining: { men: 180, women: 130, youths: 27 },
      assigned: [],
    });
    expect(pack.labour).not.toHaveProperty("harvest_risk");
  });

  it("fills my_deals from the speaker's memories", () => {
    const state = boot();
    state.npcs.find((n) => n.id === "steward")!.memories.push({
      turn: 1,
      year: 825,
      season: "spring",
      summary: "The lord ordered more barley sown.",
    });
    const pack = collectDrawers(state, ["my_deals"], "steward");
    expect(pack.my_deals).toEqual([
      expect.objectContaining({ year: 825, season: "spring", summary: "The lord ordered more barley sown." }),
    ]);
    expect(collectDrawers(state, ["memories"], "steward")).toEqual(pack);
  });

  it("maps rye to grain and denarii to chest", () => {
    expect(drawerForResource("rye")).toBe("grain");
    expect(drawerForResource("denarii")).toBe("chest");
    expect(drawerForResource("iron")).toBe("forge");
    expect(drawerForResource("wool")).toBe("stores");
  });

  it("finds grain missing when a rye transfer was never given that drawer", () => {
    const missing = missingCitedDrawers(
      [
        {
          type: "transfer_resources",
          summary: "Grain to the cell",
          resource: "rye",
          amount: 2,
          direction: "consume",
        },
      ],
      [],
    );
    expect(missing).toEqual(["grain"]);
    expect(missingCitedDrawers(
      [
        {
          type: "transfer_resources",
          summary: "Grain to the cell",
          resource: "rye",
          amount: 2,
          direction: "consume",
        },
      ],
      ["grain"],
    )).toEqual([]);
  });
});
