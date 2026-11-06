import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { applyProposal } from "../engine/applyDelta";
import { WorldStateSchema, type WorldState } from "../engine/schema";
import { proposalBlurb } from "../ui/ledgerCopy";
import { historyPromptBlock } from "./promptBlocks";
import { runHistorySeasonPass } from "./season";
import { tradeImprovements } from "./trade";
import { villaWallMakeshift } from "../session/battle";
import { assessUpkeep, billFor, incomeSentence, structureScale, tickUpkeep } from "./upkeep";

/**
 * Household and roofs (the rank table): at a typical gross and a typical set of works,
 * the shares leave the spendable net the design names.
 */
const TABLE = [
  { rank: 1, gross: 525, household: 131, maintenance: 26, net: 368, season: 92 },
  { rank: 2, gross: 1600, household: 560, maintenance: 96, net: 944, season: 236 },
  { rank: 3, gross: 16500, household: 7425, maintenance: 1320, net: 7755, season: 1939 },
  { rank: 4, gross: 73000, household: 40150, maintenance: 7300, net: 25550, season: 6388 },
  { rank: 5, gross: 300000, household: 180000, maintenance: 36000, net: 84000, season: 21000 },
] as const;

function fresh(): WorldState {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

describe("the year's shares", () => {
  it("matches the rank table when receipts and roofs are the typical ones", () => {
    for (const row of TABLE) {
      const bill = billFor(row.gross, row.rank, 1, 0);
      expect(bill.householdYear).toBe(row.household);
      expect(bill.maintenanceYear).toBe(row.maintenance);
      expect(bill.netYear).toBe(row.net);
      expect(bill.netSeason).toBe(row.season);
      expect(bill.householdYear + bill.maintenanceYear + bill.netYear).toBe(row.gross);
    }
  });

  it("a new villa lord's books name the net, and the quarter comes off the chest", () => {
    const state = fresh();
    expect(structureScale(state)).toBe(1);
    const bill = assessUpkeep(state);
    expect(bill.grossYear).toBe(525);
    expect(bill.netYear).toBe(368);
    expect(bill.householdSeason).toBe(33);
    expect(bill.maintenanceSeason).toBe(7);
    expect(incomeSentence(state)).toBe("About 368 d a year is free to spend, near 92 d a season, once the household is kept and the roofs are mended.");
    expect(incomeSentence(state)).not.toContain("525");

    state.resources.denarii = 138;
    const paid = tickUpkeep(state, { year: 825, season: "summer" }, 2);
    expect(state.resources.denarii).toBe(138 - 33 - 7);
    expect(paid.lines.join(" ")).toContain("The household took 33 d");
    expect(paid.beats).toHaveLength(0);
    expect(tickUpkeep(state, { year: 825, season: "summer" }, 2).lines).toHaveLength(0);
    expect(state.resources.denarii).toBe(98);
  });

  it("keeps the gross for Aldric, and not for Ermenald", () => {
    const state = fresh();
    const steward = historyPromptBlock(state, "steward");
    expect(steward).toContain("Receipts this year are about 525 d");
    expect(steward).toContain("household_upkeep");
    expect(historyPromptBlock(state, "chaplain")).not.toContain("household_upkeep");
    expect(historyPromptBlock(state, "chaplain")).not.toContain("Receipts this year");
  });

  it("scales the roofs with what stands: a mill raises the cost, an empty yard lowers it", () => {
    const built = fresh();
    built.holdings[0].features.push("mill_flour", "palisade", "stone_wall");
    const rich = assessUpkeep(built);
    expect(rich.scale).toBeGreaterThan(1);
    expect(rich.maintenanceYear).toBeGreaterThan(26);
    expect(rich.householdYear).toBe(131);

    const bare = fresh();
    bare.holdings[0].features = bare.holdings[0].features.filter((f) => f !== "manor_hall" && f !== "barn");
    expect(assessUpkeep(bare).maintenanceYear).toBe(0);
    expect(assessUpkeep(bare).householdYear).toBe(131);
  });

  it("a lean household gives up as many as ten points, and the sworn men feel it", () => {
    const state = fresh();
    state.history.vassals.push({ id: "v1", name: "Adalhard", holding: "Saulieu", men: 3, mood: 50, since: 1, group: false, angrySince: null, lastReason: null, bent: "court", gifts: [], grievances: [], snubbed: false });
    expect(applyProposal(state, { type: "household_upkeep", summary: "", cut: 10 }, "chaplain").ok).toBe(false);
    expect(applyProposal(state, { type: "household_upkeep", summary: "", cut: 11 } as never, "steward").ok).toBe(false);
    const set = applyProposal(state, { type: "household_upkeep", summary: "", cut: 10 }, "steward");
    expect(set.ok).toBe(true);
    expect(state.history.upkeep.lean).toBe(10);
    expect(state.history.vassals[0].mood).toBe(40);
    expect(state.peopleHappiness).toBe(40);
    const bill = assessUpkeep(state);
    expect(bill.householdYear).toBe(Math.round(525 * 0.15));
    expect(bill.maintenanceYear).toBe(26);
    expect(proposalBlurb({ type: "household_upkeep", summary: "", cut: 10 }, state)).toContain("ten parts in a hundred");

    state.resources.denarii = 500;
    tickUpkeep(state, { year: 825, season: "autumn" }, 3);
    expect(state.history.vassals[0].mood).toBe(38);
    expect(state.peopleHappiness).toBe(38);
  });
});

describe("works let go", () => {
  const at = { year: 826, season: "spring" as const };

  it("warns before anything is lost, then lets a wall, a mill and a barn fail slowly", () => {
    const state = fresh();
    state.resources.denarii = 0;
    state.holdings[0].features.push("palisade", "mill_flour");
    expect(villaWallMakeshift(state)).toBe(false);
    const wheat = state.resources.wheat;
    const draw = () => tradeImprovements(state).find((i) => /people come to/.test(i.what))?.bonus ?? 0;
    const drawBefore = draw();

    const warn = tickUpkeep(state, at, 1);
    expect(state.history.upkeep.neglect).toBe(1);
    expect(warn.beats.some((b) => b.text.includes("Nothing is lost yet"))).toBe(true);
    expect(state.holdings[0].features).toContain("barn");
    expect(state.holdings[0].features).toContain("palisade");
    expect(state.resources.wheat).toBe(wheat);
    expect(villaWallMakeshift(state)).toBe(false);

    const wear = tickUpkeep(state, at, 2);
    expect(state.history.upkeep.neglect).toBe(2);
    expect(wear.beats.some((b) => b.text.includes("gone past a warning"))).toBe(true);
    expect(state.holdings[0].features).toEqual(expect.arrayContaining(["barn", "palisade", "mill_flour"]));
    expect(state.resources.wheat).toBeLessThan(wheat);
    expect(villaWallMakeshift(state)).toBe(true);
    expect(draw()).toBeLessThan(drawBefore);

    const lost = tickUpkeep(state, at, 3, { collapseRoll: 0 });
    expect(lost.beats.some((b) => b.text.includes("has come down"))).toBe(true);
    expect(state.holdings[0].features).not.toContain("palisade");
    expect(state.holdings[0].features).toContain("mill_flour");
  });

  it("two seasons of paid keeping put a worn wall back", () => {
    const state = fresh();
    state.resources.denarii = 0;
    state.holdings[0].features.push("palisade");
    tickUpkeep(state, at, 1);
    tickUpkeep(state, at, 2);
    expect(villaWallMakeshift(state)).toBe(true);
    const grain = state.resources.wheat;

    state.resources.denarii = 500;
    tickUpkeep(state, at, 3);
    expect(state.history.upkeep.worn.length).toBeGreaterThan(0);
    expect(state.resources.wheat).toBe(grain);
    tickUpkeep(state, at, 4);
    expect(state.history.upkeep.worn).toEqual([]);
    expect(state.holdings[0].features).toContain("palisade");
    expect(villaWallMakeshift(state)).toBe(false);
  });

  it("the season pass takes the quarter once the office has paid", () => {
    const state = fresh();
    state.resources.denarii = 500;
    const r = runHistorySeasonPass(state, { year: 825, season: "summer" }, 2);
    expect(r.effects.some((line) => line.startsWith("The household took"))).toBe(true);
    expect(state.resources.denarii).toBe(500 - 33 - 7);
  });
});
