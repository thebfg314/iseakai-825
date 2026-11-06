import { afterEach, describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { applyProposal } from "../engine/applyDelta";
import { WorldStateSchema, type WorldState } from "../engine/schema";
import { holdingsBook } from "../ui/booksView";
import { proposalBlurb } from "../ui/ledgerCopy";
import { flagInt } from "./flags";
import {
  applyVerdict,
  caseDue,
  caseText,
  fairnessWord,
  justiceCase,
  justiceLines,
  justiceTable,
  openCase,
  setJusticeStance,
  stanceFinesFactor,
  tableFor,
  tickJustice,
} from "./justice";
import { canStrip } from "./ladder";
import { setHistoryContentForTests } from "./load";
import { historyPromptBlock } from "./promptBlocks";
import { promoteTo } from "./promotion";
import { justiceMultiplier, seasonRevenue } from "./revenue";
import { runHistorySeasonPass } from "./season";
import type { SeasonAt } from "./scheduler";

/** Justice (rank design 'Justice'; 03_HISTORY §10b). */

function fresh(): WorldState {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

function count(): WorldState {
  const state = fresh();
  state.player.renown = 600;
  promoteTo(state, 3, { patron: "the king", turn: 40 });
  state.meta.turn = 40;
  state.meta.year = 834;
  state.meta.season = "winter";
  return state;
}

const SEASONS: SeasonAt["season"][] = ["spring", "summer", "autumn", "winter"];
function atFor(turn: number): SeasonAt {
  return { year: 825 + Math.floor((turn - 1) / 4), season: SEASONS[(turn - 1) % 4] };
}

/** Run the justice tick alone over a span of turns, quiet seasons throughout. */
function runYears(state: WorldState, fromTurn: number, seasons: number, onOpen?: (caseId: string, turn: number) => void): string[] {
  const opened: string[] = [];
  for (let turn = fromTurn; turn < fromTurn + seasons; turn++) {
    const at = atFor(turn);
    const r = tickJustice(state, at, turn, { quiet: true });
    if (r.opened) {
      opened.push(r.opened);
      onOpen?.(r.opened, turn);
    }
    state.meta.turn = turn;
    state.meta.year = at.year;
    state.meta.season = at.season;
  }
  return opened;
}

describe("the dispute tables", () => {
  it("three tables of cases, each verdict with an id and a label, every case with a way to refuse or let it lie", () => {
    const t = justiceTable();
    expect(t.tables.villa).toHaveLength(12);
    expect(t.tables.county).toHaveLength(10);
    expect(t.tables.duke).toHaveLength(6);
    const ids = new Set<string>();
    for (const c of [...t.tables.villa, ...t.tables.county, ...t.tables.duke]) {
      expect(ids.has(c.id)).toBe(false);
      ids.add(c.id);
      expect(c.verdicts.length).toBeGreaterThanOrEqual(3);
      expect(c.verdicts.some((v) => v.fairness === 1)).toBe(true);
      expect(c.verdicts.some((v) => v.fairness === -1 || v.feud)).toBe(true);
    }
    expect(justiceCase("J-V01")?.speaker).toBe("steward");
    expect(justiceCase("J-V12")?.speaker).toBe("chaplain");
    expect(caseText(justiceCase("J-V01")!, "villa")).not.toContain("dozens of cases");
    expect(caseText(justiceCase("J-C01")!, "county")).toContain("dozens of cases");
    expect(caseText(justiceCase("J-D01")!, "duke")).toContain("could not be settled below");
  });

  it("the table follows the rank: a villa lord's quarrels, a count's pleas, a duke's one great case a year then a county matter", () => {
    expect(tableFor(fresh())).toBe("villa");
    expect(tableFor(count())).toBe("county");
    const duke = fresh();
    duke.player.renown = 1200;
    promoteTo(duke, 4, { patron: "the king", turn: 40 });
    expect(tableFor(duke)).toBe("duke");
    duke.history.justice.casesThisYear = 1;
    expect(tableFor(duke)).toBe("county");
  });
});

describe("cadence", () => {
  it("one to two cases a year on average, never two in a season, some years none, over forty quiet years", () => {
    const state = fresh();
    const byYear = new Map<number, number>();
    const seasons = new Set<number>();
    runYears(state, 1, 160, (id, turn) => {
      byYear.set(atFor(turn).year, (byYear.get(atFor(turn).year) ?? 0) + 1);
      expect(seasons.has(turn)).toBe(false);
      seasons.add(turn);
      // Judge each at once so the next may come.
      const c = justiceCase(id)!;
      applyVerdict(state, id, c.verdicts[0].id, atFor(turn), turn);
    });
    const total = [...byYear.values()].reduce((n, x) => n + x, 0);
    const average = total / 40;
    expect(average).toBeGreaterThanOrEqual(1);
    expect(average).toBeLessThanOrEqual(2);
    for (const n of byYear.values()) expect(n).toBeLessThanOrEqual(2);
    // No year is forced: a well-behaved villa has quiet years.
    expect(byYear.size).toBeLessThan(40);
    expect(state.history.justice.verdicts.length).toBe(8); // the books keep the last eight
  });

  it("no second case while one is open; none while the lord is away, the call to arms is open, a dated event fired, or the year has had two", () => {
    const state = fresh();
    const c = justiceCase("J-V01")!;
    openCase(state, c, "villa", 3);
    expect(caseDue(state, { year: 825, season: "winter" }, 4, true)).toBe(false);
    state.history.justice.open = null;
    state.history.justice.casesThisYear = 0;
    // Find a turn whose quiet-season roll says yes, then show each gate closes it.
    let turn = 4;
    while (!caseDue(state, atFor(turn), turn, true)) turn++;
    expect(caseDue(state, atFor(turn), turn, false)).toBe(false);
    state.history.away = { reason: "at the king's court", untilTurn: turn + 4 };
    expect(caseDue(state, atFor(turn), turn, true)).toBe(false);
    state.history.away = null;
    state.battle_call = { kind: "raid", eventId: "th-raid", text: "Riders at the ford.", seed: 1, createdTurn: turn };
    expect(caseDue(state, atFor(turn), turn, true)).toBe(false);
    state.battle_call = null;
    state.history.justice.casesThisYear = 2;
    expect(caseDue(state, atFor(turn), turn, true)).toBe(false);
  });

  it("a case is not repeated until its table is spent", () => {
    const state = fresh();
    const seen: string[] = [];
    runYears(state, 2, 60, (id, turn) => {
      seen.push(id);
      applyVerdict(state, id, justiceCase(id)!.verdicts[0].id, atFor(turn), turn);
    });
    const firstTwelve = seen.slice(0, 12);
    expect(new Set(firstTwelve).size).toBe(12);
  });
});

describe("judging", () => {
  afterEach(() => setHistoryContentForTests(null));

  it("the verdict pays what the table says: fines to the chest, the people, the church, fairness, a feud when nothing is settled", () => {
    const state = fresh();
    state.resources.denarii = 100;
    const before = state.peopleHappiness;
    openCase(state, justiceCase("J-V06")!, "villa", 3);
    const r = applyVerdict(state, "J-V06", "seize", atFor(3), 3);
    expect(r.ok).toBe(true);
    expect(state.resources.denarii).toBe(112);
    expect(state.peopleHappiness).toBe(before - 4);
    expect(state.history.justice.fairness).toBe(-1);
    expect(state.history.justice.open).toBeNull();
    expect(state.history.record.at(-1)?.thread).toBe("justice");

    openCase(state, justiceCase("J-V12")!, "villa", 4);
    applyVerdict(state, "J-V12", "forbid", atFor(4), 4);
    expect(flagInt(state, "favor_church")).toBe(52);

    openCase(state, justiceCase("J-V01")!, "villa", 5);
    applyVerdict(state, "J-V01", "refuse", atFor(5), 5);
    expect(state.history.justice.feuds).toHaveLength(1);
    expect(state.history.justice.feuds[0].dueTurn).toBeGreaterThanOrEqual(7);
    expect(state.history.justice.feuds[0].dueTurn).toBeLessThanOrEqual(11);

    // A wrong verdict id or a case not before the hall is refused.
    expect(applyVerdict(state, "J-V01", "restore", atFor(5), 5).ok).toBe(false);
    openCase(state, justiceCase("J-V02")!, "villa", 6);
    expect(applyVerdict(state, "J-V02", "nonsense", atFor(6), 6).ok).toBe(false);
  });

  it("a feud comes back: the people grow uneasy and Aldric says so", () => {
    const state = fresh();
    openCase(state, justiceCase("J-V07")!, "villa", 3);
    applyVerdict(state, "J-V07", "refuse", atFor(3), 3);
    const due = state.history.justice.feuds[0].dueTurn;
    const before = state.peopleHappiness;
    const r = tickJustice(state, atFor(due), due, { quiet: false });
    expect(state.peopleHappiness).toBe(before - 3);
    expect(state.history.justice.feuds).toHaveLength(0);
    expect(r.beats.some((b) => b.npcId === "steward" && b.text.includes("come to blood"))).toBe(true);
  });

  it("a case left two seasons goes by default", () => {
    const state = fresh();
    openCase(state, justiceCase("J-V03")!, "villa", 3);
    expect(state.history.justice.open?.deadlineTurn).toBe(4);
    tickJustice(state, atFor(4), 4, { quiet: false });
    expect(state.history.justice.open?.caseId).toBe("J-V03");
    const r = tickJustice(state, atFor(5), 5, { quiet: false });
    expect(state.history.justice.open).toBeNull();
    expect(r.lines.some((l) => l.includes("went unjudged"))).toBe(true);
    expect(state.history.justice.feuds).toHaveLength(1);
    expect(state.history.justice.verdicts.at(-1)?.verdictId).toBe("refuse");
    // A table without a refusal lapses all the same.
    openCase(state, justiceCase("J-V09")!, "villa", 6);
    tickJustice(state, atFor(8), 8, { quiet: false });
    expect(state.history.justice.verdicts.at(-1)?.verdictId).toBe("lapsed");
  });

  it("a count's judgement moves his sworn men and can draw the missi", () => {
    const state = count();
    openCase(state, justiceCase("J-C04")!, "county", 41);
    const before = state.history.vassals[0].mood;
    applyVerdict(state, "J-C04", "for_tenants", atFor(41), 41);
    expect(state.history.vassals[0].mood).toBe(before - 8);
    openCase(state, justiceCase("J-C10")!, "county", 42);
    applyVerdict(state, "J-C10", "seize", atFor(42), 42);
    expect(state.history.justice.missiAttention).toBe(1);
    expect(state.history.vassals[0].mood).toBe(before - 8 + 3);
  });

  it("the speaker's proposal: justice_verdict from the closed list, the blurb in the hall's words", () => {
    const state = fresh();
    openCase(state, justiceCase("J-V05")!, "villa", 3);
    state.meta.turn = 3;
    const bad = applyProposal(state, { type: "justice_verdict", summary: "", caseId: "J-V05", verdictId: "hang" }, "steward");
    expect(bad.ok).toBe(false);
    const smith = applyProposal(state, { type: "justice_verdict", summary: "", caseId: "J-V05", verdictId: "acquit" }, "smith");
    expect(smith.ok).toBe(false);
    const r = applyProposal(state, { type: "justice_verdict", summary: "", caseId: "J-V05", verdictId: "acquit" }, "steward");
    expect(r.ok).toBe(true);
    expect(r.logLine).toContain("Tools from the forge: Nothing found, nothing proven");
    expect(state.history.justice.fairness).toBe(1);
    expect(proposalBlurb({ type: "justice_verdict", summary: "", caseId: "J-V05", verdictId: "oath" }, state)).toBe("On tools from the forge: he swears with oath-helpers; if he finds them he is clear.");
  });
});

describe("the stance", () => {
  it("only a count sets one; it scales the pleas' fines and pays the people each year", () => {
    const villa = fresh();
    expect(setJusticeStance(villa, "strict")).not.toBeNull();
    expect(stanceFinesFactor(villa)).toBe(1);
    const state = count();
    expect(justiceMultiplier(state)).toBe(1);
    const fair = seasonRevenue(state).justice;
    expect(setJusticeStance(state, "extortionate")).toBeNull();
    expect(justiceMultiplier(state)).toBe(2);
    expect(seasonRevenue(state).justice).toBe(fair * 2);
    setJusticeStance(state, "lenient");
    expect(seasonRevenue(state).justice).toBe(fair / 2);

    // The first year the county is held pays nothing; the next does.
    const r1 = tickJustice(state, { year: 835, season: "spring" }, 41, { quiet: false });
    expect(r1.lines.some((l) => l.includes("judged"))).toBe(false);
    const before = state.peopleHappiness;
    tickJustice(state, { year: 836, season: "spring" }, 45, { quiet: false });
    expect(state.peopleHappiness).toBe(before + 2);
    expect(flagInt(state, "favor_church")).toBe(51);
    // Only once a year.
    tickJustice(state, { year: 836, season: "summer" }, 46, { quiet: false });
    expect(state.peopleHappiness).toBe(before + 2);
  });

  it("an extortionate court draws the king's missi: a tenth of the chest, renown, the king's favour", () => {
    const state = count();
    setJusticeStance(state, "extortionate");
    state.resources.denarii = 1000;
    state.player.renown = 600;
    tickJustice(state, { year: 835, season: "spring" }, 41, { quiet: false });
    tickJustice(state, { year: 836, season: "spring" }, 45, { quiet: false });
    expect(state.history.justice.missiAttention).toBe(1);
    expect(state.history.justice.missiVisits).toBe(0);
    const r = tickJustice(state, { year: 837, season: "spring" }, 49, { quiet: false });
    expect(state.history.justice.missiVisits).toBe(1);
    expect(state.history.justice.missiAttention).toBe(0);
    expect(state.resources.denarii).toBeLessThan(1000);
    expect(state.player.renown).toBeLessThan(600);
    expect(state.history.duties.favour).toBe(-1);
    expect(r.beats.some((b) => b.text.includes("missi"))).toBe(true);
  });

  it("Aldric explains the stance once, at the first county, and the Books show it", () => {
    const state = count();
    const r = tickJustice(state, { year: 835, season: "spring" }, 41, { quiet: false });
    expect(r.beats.filter((b) => b.eventId === "justice:stance")).toHaveLength(1);
    expect(tickJustice(state, { year: 835, season: "summer" }, 42, { quiet: false }).beats.some((b) => b.eventId === "justice:stance")).toBe(false);
    const book = holdingsBook(state);
    expect(book.justice.stance?.id).toBe("fair");
    expect(book.justice.fairness).toBe(fairnessWord(0));
    expect(holdingsBook(fresh()).justice.stance).toBeNull();
  });

  it("set_stance from Aldric: the court, or the tolls; a villa lord has neither", () => {
    const state = count();
    const r = applyProposal(state, { type: "set_stance", summary: "", kind: "justice", stance: "strict" }, "steward");
    expect(r.ok).toBe(true);
    expect(state.history.justice.stance).toBe("strict");
    expect(applyProposal(state, { type: "set_stance", summary: "", kind: "justice", stance: "greedy" }, "steward").ok).toBe(false);
    const tolls = applyProposal(state, { type: "set_stance", summary: "", kind: "tolls", stance: "greedy" }, "steward");
    expect(tolls.ok).toBe(true);
    expect(state.history.trade.tollStance).toBe("greedy");
    expect(applyProposal(fresh(), { type: "set_stance", summary: "", kind: "justice", stance: "strict" }, "steward").ok).toBe(false);
    expect(applyProposal(fresh(), { type: "set_stance", summary: "", kind: "tolls", stance: "low" }, "steward").ok).toBe(false);
    expect(proposalBlurb({ type: "set_stance", summary: "", kind: "justice", stance: "lenient" }, state)).toContain("leniently");
    expect(proposalBlurb({ type: "set_stance", summary: "", kind: "tolls", stance: "low" }, state)).toContain("tolls");
  });

  it("a partial judge gives the king his pretext", () => {
    const state = count();
    for (const v of state.history.vassals) v.mood = 70; // content men would otherwise shield him
    expect(canStrip(state)).toBe(false);
    state.history.justice.fairness = -4;
    expect(canStrip(state)).toBe(true);
  });
});

describe("the prompt and the season pass", () => {
  afterEach(() => setHistoryContentForTests(null));

  it("the speaker who brought the case sees the closed list; the other knows only that it was brought", () => {
    const state = fresh();
    openCase(state, justiceCase("J-V04")!, "villa", 3);
    state.meta.turn = 3;
    const chaplain = justiceLines(state, "chaplain").join("\n");
    expect(chaplain).toContain('OPEN CASE J-V04 "The betrothal refused"');
    expect(chaplain).toContain('repay ("The price is repaid over two harvests; no one is forced")');
    const steward = justiceLines(state, "steward").join("\n");
    expect(steward).toContain("Ermenald has brought a case before the lord");
    expect(steward).not.toContain("OPEN CASE");
    expect(historyPromptBlock(state, "chaplain")).toContain("OPEN CASE J-V04");
    // A count's steward is told the stance and how to change it.
    const c = count();
    expect(justiceLines(c, "steward").join("\n")).toContain('set_stance {kind:"justice"');
    expect(justiceLines(c, "chaplain").join("\n")).not.toContain("set_stance");
  });

  it("the season pass brings a case in a quiet season and the referee is told who brought it", () => {
    setHistoryContentForTests({ events: [] });
    const state = fresh();
    let turn = 1;
    let r = runHistorySeasonPass(state, atFor(turn + 1), turn + 1);
    while (!state.history.justice.open && turn < 12) {
      turn++;
      state.meta.turn = turn;
      state.meta.year = atFor(turn).year;
      state.meta.season = atFor(turn).season;
      r = runHistorySeasonPass(state, atFor(turn + 1), turn + 1);
    }
    expect(state.history.justice.open).not.toBeNull();
    expect(r.beats.some((b) => b.eventId.startsWith("justice:J-V"))).toBe(true);
    expect(r.refereeLines.some((l) => l.includes("brought a case before the lord"))).toBe(true);
  });
});
