import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { applyProposal } from "../engine/applyDelta";
import { WorldStateSchema, type WorldState } from "../engine/schema";
import { holdingsBook } from "../ui/booksView";
import { proposalBlurb } from "../ui/ledgerCopy";
import {
  administrationLine,
  applyOfficeAction,
  capacity,
  officeCost,
  overBy,
  overloadFactor,
  overloadTier,
  stewardTitle,
  syncOverload,
  tickAdministration,
  upkeepPerSeason,
} from "./administration";
import { historyPromptBlock } from "./promptBlocks";
import { grantVillas, promoteTo } from "./promotion";
import { runHistorySeasonPass } from "./season";

/** Administration (rank design 'Administration — abstracted through Aldric'; 03_HISTORY §10c). */

function fresh(): WorldState {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

function atRank(rank: number): WorldState {
  const state = fresh();
  state.player.renown = [1, 100, 500, 1000, 2000][rank - 1] + 50;
  promoteTo(state, rank, { patron: "the king", turn: 40 });
  state.meta.turn = 40;
  return state;
}

describe("capacity", () => {
  it("follows the rank's low end: one villa for a steward of one villa, three for a viscount, ten for a count, forty for a duke", () => {
    expect(capacity(fresh())).toBe(1);
    expect(overBy(fresh())).toBe(0);
    const viscount = atRank(2);
    expect(capacity(viscount)).toBe(3);
    expect(viscount.holdings).toHaveLength(3);
    expect(overloadTier(viscount)).toBe(0);
    const count = atRank(3);
    expect(capacity(count)).toBe(10);
    expect(count.holdings).toHaveLength(12);
    expect(overBy(count)).toBe(2);
    expect(overloadTier(count)).toBe(1);
    const duke = atRank(4);
    expect(capacity(duke)).toBe(40);
    expect(duke.holdings).toHaveLength(45);
    expect(overloadTier(duke)).toBe(2);
    expect(stewardTitle(count)).toContain("chief officer");
  });

  it("raising Aldric moves capacity toward the range's high end; clerks add three each; a deputy a region at Duke", () => {
    const count = atRank(3);
    count.resources.denarii = 5000;
    const p = officeCost(count, "promote");
    expect(p).toEqual({ once: 300, perSeason: 15 });
    expect(applyOfficeAction(count, "promote", 41).ok).toBe(true);
    expect(capacity(count)).toBe(13);
    expect(count.resources.denarii).toBe(4700);
    expect(overloadTier(count)).toBe(0);
    applyOfficeAction(count, "promote", 41);
    expect(capacity(count)).toBe(16);
    expect(applyOfficeAction(count, "promote", 41).ok).toBe(false);
    expect(applyOfficeAction(count, "hire", 41).ok).toBe(true);
    expect(capacity(count)).toBe(19);
    expect(upkeepPerSeason(count)).toBe(30 + 8);
    expect(applyOfficeAction(count, "deputy", 41).ok).toBe(false); // a duke's officer
    const duke = atRank(4);
    duke.resources.denarii = 1000;
    const d = applyOfficeAction(duke, "deputy", 41, "Gerbald");
    expect(d.ok).toBe(true);
    expect(d.line).toContain("Gerbald");
    expect(capacity(duke)).toBe(52);
    expect(overloadTier(duke)).toBe(0);
    expect(applyOfficeAction(duke, "deputy", 41).ok).toBe(false);
    // The chest must bear it.
    const poor = atRank(2);
    poor.resources.denarii = 10;
    expect(applyOfficeAction(poor, "hire", 41).ok).toBe(false);
  });
});

describe("overload", () => {
  it("the furthest villas yield less: a maintained modifier on the harvest and the herds, gone when the books are in hand", () => {
    const count = atRank(3);
    syncOverload(count);
    const grain = count.modifiers.find((m) => m.id === "mod-administration-grain");
    expect(grain?.target).toBe("grain_yield");
    expect(grain?.effect.value).toBeCloseTo(overloadFactor(count), 3);
    expect(overloadFactor(count)).toBeCloseTo(1 - (0.1 * 2) / 12, 3);
    expect(count.modifiers.some((m) => m.id === "mod-administration-livestock")).toBe(true);
    count.resources.denarii = 5000;
    applyOfficeAction(count, "promote", 41);
    expect(count.modifiers.some((m) => m.source === "administration")).toBe(false);
  });

  it("three or more over: dues go uncollected each season; six or more: a villa runs itself and the people mutter", () => {
    const viscount = atRank(2);
    grantVillas(viscount, 4, { patron: "the king", turn: 41, like: 2 });
    expect(viscount.holdings).toHaveLength(7);
    expect(overBy(viscount)).toBe(4);
    expect(overloadTier(viscount)).toBe(2);
    viscount.resources.denarii = 500;
    const r = tickAdministration(viscount, { year: 835, season: "summer" }, 42);
    expect(viscount.resources.denarii).toBe(500 - 16);
    expect(r.lines.some((l) => l.includes("went uncollected"))).toBe(true);
    expect(r.beats).toHaveLength(1);
    expect(r.beats[0].text).toContain("uncollected");
    // Once per step: the next season he says nothing new.
    expect(tickAdministration(viscount, { year: 835, season: "autumn" }, 43).beats).toHaveLength(0);
    grantVillas(viscount, 3, { patron: "the king", turn: 43, like: 2 });
    const before = viscount.peopleHappiness;
    const r3 = tickAdministration(viscount, { year: 835, season: "winter" }, 44);
    expect(overloadTier(viscount)).toBe(3);
    expect(viscount.peopleHappiness).toBe(before - 1);
    expect(r3.beats[0].text).toContain("running itself");
    expect(viscount.history.administration.leaked).toBeGreaterThan(16);
    // Clerks bring it back; Aldric says so.
    viscount.resources.denarii = 2000;
    applyOfficeAction(viscount, "hire", 45);
    applyOfficeAction(viscount, "hire", 45);
    applyOfficeAction(viscount, "promote", 45);
    expect(overloadTier(viscount)).toBe(0);
    const back = tickAdministration(viscount, { year: 836, season: "spring" }, 45);
    expect(back.beats.some((b) => b.text.includes("in hand again"))).toBe(true);
    expect(back.lines.some((l) => l.includes("officers were paid"))).toBe(true);
  });

  it("Aldric complains once when a count's grant stretches him, in the season pass", () => {
    const state = fresh();
    state.player.renown = 600;
    promoteTo(state, 3, { patron: "the king", turn: 40 });
    state.meta.turn = 40;
    const r = runHistorySeasonPass(state, { year: 835, season: "spring" }, 41);
    expect(r.beats.some((b) => b.eventId === "administration:tier:1" && b.text.includes("more than one steward can walk"))).toBe(true);
    expect(state.history.administration.lastTier).toBe(1);
  });

  it("a deputy keeps back a tenth of the outlying dues some years", () => {
    const duke = atRank(4);
    duke.resources.denarii = 10000;
    applyOfficeAction(duke, "deputy", 41, "Gerbald");
    duke.history.rank.lastRevenue = { turn: 44, tolls: 0, market: 0, justice: 0, fisc: 2000, mint: 0, deputy: 0, fines: 0, officers: 0, net: 2000 };
    let kept = 0;
    for (let year = 836; year < 856; year++) {
      const before = duke.resources.denarii;
      const r = tickAdministration(duke, { year, season: "spring" }, (year - 825) * 4 + 1);
      const pay = upkeepPerSeason(duke);
      if (before - duke.resources.denarii > pay) {
        kept += 1;
        expect(r.beats.some((b) => b.text.includes("Gerbald"))).toBe(true);
      }
    }
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(12);
  });
});

describe("the card, the prompt and the Books", () => {
  it("steward_office through Aldric's Confirm card; not for the smith; the blurb names the price", () => {
    const count = atRank(3);
    count.resources.denarii = 5000;
    expect(applyProposal(count, { type: "steward_office", summary: "", action: "hire" }, "smith").ok).toBe(false);
    const r = applyProposal(count, { type: "steward_office", summary: "", action: "hire" }, "steward");
    expect(r.ok).toBe(true);
    expect(r.logLine).toContain("clerks");
    expect(count.history.administration.staff).toBe(1);
    expect(proposalBlurb({ type: "steward_office", summary: "", action: "promote" }, count)).toBe("Raise Aldric in the household, so he may hold more villas in his books (300 d now, 15 d a season).");
    expect(proposalBlurb({ type: "steward_office", summary: "", action: "deputy", name: "Gerbald" }, count)).toContain("Gerbald");
  });

  it("the prompt line offers what can be had; a villa lord with one villa hears nothing of it", () => {
    expect(administrationLine(fresh())).toBeNull();
    const count = atRank(3);
    const line = administrationLine(count)!;
    expect(line).toContain("runs 12 villas against 10");
    expect(line).toContain("promote (300 d, 15 d a season)");
    expect(line).toContain("hire (120 d, 8 d a season)");
    expect(line).not.toContain("deputy (");
    expect(historyPromptBlock(count, "steward")).toContain("steward_office");
    expect(historyPromptBlock(count, "chaplain")).not.toContain("steward_office");
    const book = holdingsBook(count);
    expect(book.officers.some((l) => l.includes("12 villas in his books against 10"))).toBe(true);
    expect(holdingsBook(fresh()).officers).toHaveLength(0);
  });
});
