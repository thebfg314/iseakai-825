import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { applyProposal } from "../engine/applyDelta";
import { grainOnHand, HOUSEHOLD_SEASON_GRAIN } from "../engine/grain";
import { WorldStateSchema, type WorldState } from "../engine/schema";
import { resolveAgricultureAndProjects } from "../engine/season";
import { nextSeason } from "../engine/util";
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
      const quarter = bill.householdSeason + bill.maintenanceSeason;
      expect(bill.kindSeason + bill.labourSeason + bill.coinSeason).toBe(quarter);
      const coinShare = [0.15, 0.25, 0.45, 0.6, 0.7][row.rank - 1];
      expect(bill.coinSeason).toBe(Math.round(quarter * coinShare));
    }
  });

  it("a new villa lord pays the keep from the stores and the tenants' days, and a few denarii", () => {
    const state = fresh();
    expect(structureScale(state)).toBe(1);
    const bill = assessUpkeep(state);
    expect(bill.grossYear).toBe(525);
    expect(bill.netYear).toBe(368);
    expect(bill.householdSeason).toBe(33);
    expect(bill.maintenanceSeason).toBe(7);
    expect(bill.coinSeason).toBe(6);
    expect(bill.kindSeason / (bill.householdSeason + bill.maintenanceSeason)).toBeGreaterThanOrEqual(0.7);
    expect(bill.kindSeason / (bill.householdSeason + bill.maintenanceSeason)).toBeLessThanOrEqual(0.8);
    expect(bill.labourDays).toBeGreaterThanOrEqual(Math.round(bill.maintenanceSeason * 0.5));
    expect(incomeSentence(state)).toBe(
      "The household is kept from the stores and the tenants' days. The chest owes about 24 d a year, near 6 d a season, for iron, salt, and what the estate cannot make.",
    );
    expect(incomeSentence(state)).not.toContain("525");

    const wheat = state.resources.wheat;
    state.resources.denarii = 138;
    const paid = tickUpkeep(state, { year: 825, season: "summer" }, 2);
    expect(state.resources.denarii).toBe(138 - 6);
    expect(state.resources.wheat).toBeLessThan(wheat);
    expect(paid.lines.join(" ")).toContain("The household took its keep from the stores");
    expect(paid.lines.join(" ")).toContain("the chest paid 6 d");
    expect(paid.beats).toHaveLength(0);
    expect(state.labour.assigned.some((a) => a.projectId === "household-keeping")).toBe(true);
    expect(tickUpkeep(state, { year: 825, season: "summer" }, 2).lines).toHaveLength(0);
    expect(state.resources.denarii).toBe(132);
  });

  it("the opening granary still has bread when the summer harvest is reaped", () => {
    const state = fresh();
    resolveAgricultureAndProjects(state);
    expect(state.flags.hunger).toBe(false);
    const summer = nextSeason(state.meta.year, state.meta.season);
    runHistorySeasonPass(state, summer, state.meta.turn + 1);
    const ration = state.population.households * HOUSEHOLD_SEASON_GRAIN;
    const tithe = state.population.households * 0.15;
    // What summer shows, before the wheat is cut: the ration and the tithe still to come, and another season of bread behind that.
    expect(grainOnHand(state)).toBeGreaterThan(ration + tithe + ration);
    state.meta.season = summer.season;
    state.meta.year = summer.year;
    state.meta.turn += 1;
    const lines = resolveAgricultureAndProjects(state).map((l) => l.text);
    expect(lines.some((t) => /Hunger begins/.test(t))).toBe(false);
    expect(state.flags.hunger).toBe(false);
    expect(lines.some((t) => /Harvested .+ wheat/.test(t))).toBe(true);
  });

  it("keeps the gross for Aldric, and not for Ermenald", () => {
    const state = fresh();
    const steward = historyPromptBlock(state, "steward");
    expect(steward).toContain("Receipts this year are about 525 d");
    expect(steward).toContain("Viking tributes");
    expect(steward).toContain("silver");
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

  function spendEveryDay(state: WorldState) {
    state.labour.assigned = [{ projectId: "other-work", men: 100000, women: 100000, youths: 100000 }];
  }

  it("warns before anything is lost, then lets a wall, a mill and a barn fail slowly when the days are gone", () => {
    const state = fresh();
    state.resources.denarii = 500;
    spendEveryDay(state);
    state.holdings[0].features.push("palisade", "mill_flour");
    expect(villaWallMakeshift(state)).toBe(false);
    const draw = () => tradeImprovements(state).find((i) => /people come to/.test(i.what))?.bonus ?? 0;
    const drawBefore = draw();

    const warn = tickUpkeep(state, at, 1);
    expect(state.history.upkeep.neglect).toBe(1);
    expect(warn.beats.some((b) => b.text.includes("Nothing is lost yet"))).toBe(true);
    expect(state.holdings[0].features).toContain("barn");
    expect(state.holdings[0].features).toContain("palisade");
    expect(villaWallMakeshift(state)).toBe(false);

    spendEveryDay(state);
    state.resources.wheat = 20;
    const wear = tickUpkeep(state, at, 2);
    expect(state.history.upkeep.neglect).toBe(2);
    expect(wear.beats.some((b) => b.text.includes("gone past a warning"))).toBe(true);
    expect(state.holdings[0].features).toEqual(expect.arrayContaining(["barn", "palisade", "mill_flour"]));
    expect(wear.beats.some((b) => /ground coarse|modii were lost|damp took/.test(b.text))).toBe(true);
    expect(villaWallMakeshift(state)).toBe(true);
    expect(draw()).toBeLessThan(drawBefore);

    spendEveryDay(state);
    const lost = tickUpkeep(state, at, 3, { collapseRoll: 0 });
    expect(lost.beats.some((b) => b.text.includes("has come down"))).toBe(true);
    expect(state.holdings[0].features).not.toContain("palisade");
    expect(state.holdings[0].features).toContain("mill_flour");
  });

  it("two seasons of days on the roofs put a worn wall back", () => {
    const state = fresh();
    state.resources.denarii = 500;
    spendEveryDay(state);
    state.holdings[0].features.push("palisade");
    tickUpkeep(state, at, 1);
    spendEveryDay(state);
    tickUpkeep(state, at, 2);
    expect(villaWallMakeshift(state)).toBe(true);

    state.labour.assigned = [];
    const patched = tickUpkeep(state, at, 3);
    expect(state.history.upkeep.worn.length).toBeGreaterThan(0);
    expect(patched.beats.some((b) => /modii were lost/i.test(b.text))).toBe(false);
    state.labour.assigned = state.labour.assigned.filter((a) => a.projectId !== "other-work");
    tickUpkeep(state, at, 4);
    expect(state.history.upkeep.worn).toEqual([]);
    expect(state.holdings[0].features).toContain("palisade");
    expect(villaWallMakeshift(state)).toBe(false);
  });

  it("a short chest is an inconvenience, and it does not bring a roof down", () => {
    const state = fresh();
    state.resources.denarii = 0;
    state.holdings[0].features.push("palisade", "mill_flour");
    const iron = state.resources.iron;
    const first = tickUpkeep(state, at, 1);
    expect(first.beats.some((b) => /inconvenience, not a crisis/i.test(b.text))).toBe(true);
    expect(state.history.upkeep.neglect).toBe(0);
    expect(state.history.upkeep.coinShort).toBe(1);
    expect(state.resources.iron).toBe(iron);
    expect(state.holdings[0].features).toContain("palisade");
    expect(villaWallMakeshift(state)).toBe(false);

    state.resources.denarii = 0;
    tickUpkeep(state, at, 2);
    state.resources.denarii = 0;
    tickUpkeep(state, at, 3);
    expect(state.resources.iron).toBe(iron - 1);
    expect(state.history.upkeep.neglect).toBe(0);
    expect(state.holdings[0].features).toContain("palisade");
    expect(state.holdings[0].features).toContain("mill_flour");
  });

  it("an empty granary is the household's crisis", () => {
    const state = fresh();
    state.resources.denarii = 500;
    for (const id of ["wheat", "rye", "barley", "oats", "cheese", "honey", "wine", "wool", "linen", "softwood", "hardwood", "charcoal", "pigs", "sheep", "poultry"] as const) {
      state.resources[id] = 0;
    }
    const paid = tickUpkeep(state, at, 1);
    expect(paid.beats.some((b) => /granary and the stores/i.test(b.text))).toBe(true);
    expect(state.history.upkeep.last?.householdPaid).toBe(0);
    expect(state.history.upkeep.last?.householdDue).toBeGreaterThan(0);
    expect(state.history.upkeep.neglect).toBe(0);
    expect(state.peopleHappiness).toBeLessThan(50);
  });

  it("the season pass takes the chest's share once the office has paid", () => {
    const state = fresh();
    state.resources.denarii = 500;
    const r = runHistorySeasonPass(state, { year: 825, season: "summer" }, 2);
    expect(r.effects.some((line) => line.startsWith("The household took"))).toBe(true);
    expect(state.resources.denarii).toBe(500 - 6);
  });
});
