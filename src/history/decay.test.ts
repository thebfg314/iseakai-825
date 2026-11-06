import { afterEach, describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import dutiesFile from "../../data/history/events/duties.json";
import mishapsFile from "../../data/history/events/mishaps.json";
import battlesFile from "../../data/history/battles.json";
import { applyProposal } from "../engine/applyDelta";
import { resolvePeopleMovement } from "../engine/peopleMovement";
import { WorldStateSchema, type WorldState } from "../engine/schema";
import { raiseCallDirect, refuseCall } from "../session/battle";
import { HUNGER_DECAY, hungerRow, judgeField, OBLIGATION_DECAY, tickRenownDecay, unmetObligations, updateFieldVerdict } from "./decay";
import { historyContent, setHistoryContentForTests } from "./load";
import { mishapSeverity, tickMishaps } from "./mishaps";
import { ensureNeighbours, recordFlight, resolveDepopulation } from "./neighbours";
import { noteMusterRefused, officeCause, tickOffice } from "./office";
import { historyPromptBlock } from "./promptBlocks";
import { promoteTo } from "./promotion";
import { runHistorySeasonPass, type HistoryPassResult } from "./season";
import { fillSlots } from "./slots";

/**
 * Renown decay from estate failure, the field's verdict, the viscount's office, the mishap
 * table, depopulation by rank and the named neighbours.
 */

function fresh(): WorldState {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

const ORDER = ["spring", "summer", "autumn", "winter"] as const;
const at = (state: WorldState) => ({ year: state.meta.year, season: state.meta.season as (typeof ORDER)[number] });

function clockFor(state: WorldState, opts: { coverUpkeep?: boolean } = { coverUpkeep: true }) {
  const next = (): HistoryPassResult => {
    const i = ORDER.indexOf(state.meta.season);
    const incoming = i === 3 ? { year: state.meta.year + 1, season: ORDER[0] } : { year: state.meta.year, season: ORDER[i + 1] };
    const r = runHistorySeasonPass(state, incoming, state.meta.turn + 1, opts);
    state.meta.year = incoming.year;
    state.meta.season = incoming.season;
    state.meta.turn += 1;
    return r;
  };
  return { next };
}

/** Only the rolled calendars, with every other system quiet. */
function quiet() {
  setHistoryContentForTests({ events: [...dutiesFile.events, ...mishapsFile.events], battles: battlesFile.battles.filter((b) => b.event.startsWith("M-")), features: { ladder: false, quest: false, promotions: false, historicalBattles: true } });
}

function count(renown = 600): WorldState {
  const s = fresh();
  s.player.renown = renown;
  s.meta.turn = 40;
  promoteTo(s, 3, { patron: "the king", turn: 40 });
  s.resources.denarii = 2000;
  return s;
}

function hook(state: WorldState, eventId: string, hookId: string) {
  return applyProposal(state, { type: "history_hook", summary: "", eventId, hookId }, "steward");
}

afterEach(() => setHistoryContentForTests(null));

describe("renown decay from estate failure", () => {
  it("an unpaid household costs the rank's figure a season: 2 for a villa lord, 15 for a count", () => {
    const s = fresh();
    s.player.renown = 50;
    s.resources.denarii = 0;
    const turn = s.meta.turn + 1;
    s.history.upkeep.last = { turn, grossYear: 500, householdYear: 125, maintenanceYear: 25, householdPaid: 0, maintenancePaid: 0, householdDue: 31, maintenanceDue: 6, netYear: 350 };
    expect(unmetObligations(s, turn)).toEqual(["the household went unpaid", "the works went unkept"]);
    const r = tickRenownDecay(s, at(s), turn);
    expect(s.player.renown).toBe(50 - OBLIGATION_DECAY[0]);
    expect(r.lines[0]).toMatch(/^Renown −2 \(minor noble; the household went unpaid, the works went unkept\)/);
    expect(r.beats[0].text).toMatch(/kept less/);
    expect(s.history.decay.sinceTurn).toBe(turn);

    const c = count(600);
    c.history.upkeep.last = { turn: 41, grossYear: 5000, householdYear: 2250, maintenanceYear: 400, householdPaid: 100, maintenancePaid: 100, householdDue: 562, maintenanceDue: 100, netYear: 2350 };
    tickRenownDecay(c, at(c), 41);
    expect(c.player.renown).toBe(600 - OBLIGATION_DECAY[2]);
  });

  it("hunger rows scale with rank and severity; the floor holds at 1; a paid season clears the streak", () => {
    const rows: [number, number][] = [
      [1, 3],
      [2, 6],
      [3, 15],
      [4, 30],
      [5, 50],
    ];
    for (const [rank, loss] of rows) {
      const s = fresh();
      s.player.rankLevel = rank;
      s.player.renown = 1000;
      s.flags.hunger = true;
      s.history.prices.hungrySeasons = 1;
      expect(hungerRow(s, 10)).toBe("real");
      tickRenownDecay(s, at(s), 10);
      expect(s.player.renown).toBe(1000 - loss);
      expect(loss).toBe(HUNGER_DECAY[rank - 1][1]);
    }
    const starving = fresh();
    starving.player.rankLevel = 3;
    starving.player.renown = 20;
    starving.flags.hunger = true;
    starving.history.prices.hungrySeasons = 2;
    expect(hungerRow(starving, 10)).toBe("starvation");
    tickRenownDecay(starving, at(starving), 10);
    expect(starving.player.renown).toBe(1);
    const mild = fresh();
    mild.player.renown = 100;
    for (const crop of ["wheat", "rye", "barley", "oats"] as const) mild.resources[crop] = 0;
    mild.resources.wheat = 1;
    expect(hungerRow(mild, 10)).toBe("mild");
    tickRenownDecay(mild, at(mild), 10);
    expect(mild.player.renown).toBe(99);
    mild.resources.wheat = 200;
    tickRenownDecay(mild, at(mild), 11);
    expect(mild.player.renown).toBe(99);
    expect(mild.history.decay.sinceTurn).toBeNull();
  });

  it("the season pass does not bleed a sound estate", () => {
    quiet();
    const s = fresh();
    s.player.renown = 60;
    const clock = clockFor(s);
    for (let i = 0; i < 8; i++) clock.next();
    expect(s.player.renown).toBe(60);
  });
});

describe("the field: the cause, not the loss", () => {
  const record = (s: WorldState, outcome: "victory" | "defeat", dealt: number, taken: number, ownMen: number, captain = false) =>
    s.battle_history.push({ id: `b${s.battle_history.length}`, turn: 10, year: 830, season: "summer", kind: "summons", tier: "sub_command", outcome, rounds: 6, renownDelta: 0, summary: "", moraleDealt: dealt, moraleTaken: taken, ownMen, manses: 40, captain });

  it("poor exchange with men enough reads as 'he cannot lead'; too few men for the manses as 'he did not equip them'; a captain's day is not counted", () => {
    const s = fresh();
    record(s, "defeat", 10, 40, 12);
    record(s, "defeat", 8, 30, 12);
    expect(judgeField(s).verdict).toBe("none");
    record(s, "defeat", 12, 35, 12);
    expect(judgeField(s).verdict).toBe("cannot_lead");
    const beats = updateFieldVerdict(s, 12);
    expect(beats[0].text).toMatch(/cannot lead/);
    expect(beats[0].text).toMatch(/send a captain/);
    expect(s.history.decay.verdict).toBe("cannot_lead");
    expect(historyPromptBlock(s, "steward")).toMatch(/the hall says the lord cannot lead/);

    const thin = fresh();
    record(thin, "defeat", 10, 20, 2);
    record(thin, "defeat", 10, 20, 2);
    record(thin, "victory", 30, 10, 2);
    record(thin, "defeat", 5, 30, 3);
    expect(judgeField(thin).verdict).toBe("ill_equipped");
    expect(updateFieldVerdict(thin, 12)[0].text).toMatch(/arms, horses, drill/);

    const sent = fresh();
    record(sent, "defeat", 10, 40, 12, true);
    record(sent, "defeat", 10, 40, 12, true);
    record(sent, "defeat", 10, 40, 12, true);
    expect(judgeField(sent).verdict).toBe("none");
  });

  it("a run of good days lifts the verdict, and Aldric says so once", () => {
    const s = fresh();
    for (let i = 0; i < 4; i++) record(s, "defeat", 10, 40, 12);
    updateFieldVerdict(s, 12);
    for (let i = 0; i < 4; i++) record(s, "victory", 40, 10, 12);
    const lifted = updateFieldVerdict(s, 14);
    expect(lifted[0].text).toMatch(/has stopped/);
    expect(s.history.decay.verdict).toBe("none");
    expect(updateFieldVerdict(s, 15)).toEqual([]);
  });
});

describe("the viscount's office", () => {
  function viscount(): WorldState {
    const s = fresh();
    s.player.renown = 150;
    s.meta.turn = 20;
    promoteTo(s, 2, { patron: "Thierry, count of Autun", turn: 20 });
    s.resources.denarii = 1000;
    return s;
  }

  it("two musters unanswered bring the count's word, a sharper word, then dismissal; the lord keeps what he owns and loses the office's villas", () => {
    quiet();
    const s = viscount();
    const owned = s.holdings[0].name;
    const officeVillas = s.holdings.slice(1).map((h) => h.name);
    expect(officeVillas.length).toBeGreaterThan(0);
    s.history.flags.lord_standing = 40;
    raiseCallDirect(s, "summons", 1);
    refuseCall(s, { chat: async () => "", log: () => {} });
    expect(s.history.office.refusedMusters).toBe(1);
    expect(officeCause(s, 21)).toBeNull();
    noteMusterRefused(s);
    expect(officeCause(s, 21)).toBe("musters not answered");
    const clock = clockFor(s);
    const first = clock.next();
    expect(first.beats.some((b) => /heard that his musters have gone out/.test(b.text))).toBe(true);
    expect(s.history.office.stage).toBe("heard");
    const second = clock.next();
    expect(second.beats.some((b) => /second word/.test(b.text))).toBe(true);
    expect(s.history.office.stage).toBe("sharp");
    const third = clock.next();
    expect(third.beats.some((b) => /given the office to another/.test(b.text))).toBe(true);
    expect(s.player.rankLevel).toBe(1);
    expect(s.holdings.map((h) => h.name)).toEqual([owned]);
    expect(s.history.office.dismissals).toBe(1);
    expect(s.history.record.some((r) => /Dismissed from the office of viscount/.test(r.text))).toBe(true);
  });

  it("good standing with the count buys a season more; a mended cause is let lie", () => {
    quiet();
    const s = viscount();
    s.history.flags.lord_standing = 70;
    noteMusterRefused(s);
    noteMusterRefused(s);
    const clock = clockFor(s);
    expect(clock.next().beats.some((b) => /quiet word/.test(b.text))).toBe(true);
    clock.next();
    expect(s.history.office.stage).toBe("heard");
    clock.next();
    expect(s.history.office.stage).toBe("sharp");
    // Mended: the musters answered again.
    s.history.office.refusedMusters = 0;
    const r = clock.next();
    expect(r.beats.some((b) => /heard better of you/.test(b.text))).toBe(true);
    expect(s.history.office.stage).toBe("none");
    expect(s.player.rankLevel).toBe(2);
  });

  it("a name at the floor, courts not held, and the villas emptying are each cause", () => {
    const s = viscount();
    s.player.renown = 1;
    expect(officeCause(s, 21)).toBe("a name worth nothing");
    s.player.renown = 150;
    s.history.office.lapsedCases = 2;
    expect(officeCause(s, 21)).toBe("courts not held");
    s.history.office.lapsedCases = 0;
    s.population.households = Math.floor((s.history.office.householdsAtGrant ?? 30) / 3);
    expect(officeCause(s, 21)).toBe("villas emptying");
    expect(tickOffice(fresh(), { year: 825, season: "spring" }, 1).cause).toBeNull();
  });
});

describe("the mishap table", () => {
  it("fires for a count below 100, a duke below 500, a king below 1000, never for a viscount; severity scales with the gap", () => {
    const c = count(600);
    expect(mishapSeverity(c)).toBeNull();
    c.player.renown = 99;
    expect(mishapSeverity(c)?.severity).toBe("low");
    c.player.renown = 50;
    expect(mishapSeverity(c)?.severity).toBe("moderate");
    c.player.renown = 10;
    expect(mishapSeverity(c)?.severity).toBe("high");
    c.player.renown = 1;
    expect(mishapSeverity(c)?.severity).toBe("severe");
    const d = fresh();
    d.player.rankLevel = 4;
    d.player.renown = 500;
    expect(mishapSeverity(d)).toBeNull();
    d.player.renown = 499;
    expect(mishapSeverity(d)?.severity).toBe("low");
    d.player.renown = 100;
    expect(mishapSeverity(d)?.severity).toBe("severe");
    const k = fresh();
    k.player.rankLevel = 5;
    k.player.renown = 999;
    expect(mishapSeverity(k)?.severity).toBe("low");
    const v = fresh();
    v.player.rankLevel = 2;
    v.player.renown = 1;
    expect(mishapSeverity(v)).toBeNull();
  });

  it("rumours at court: answered by going to be seen, renown comes back; unanswered, the judgement settles and renown goes", () => {
    quiet();
    const s = count(90);
    const clock = clockFor(s);
    const r = clock.next();
    expect(r.fired).toEqual([]);
    expect(s.history.mishaps.open?.id).toBe("M-001");
    expect(r.beats.some((b) => b.eventId === "M-001" && /borrowed|wondering/.test(b.text))).toBe(true);
    expect(r.refereeLines.some((l) => /M-001/.test(l))).toBe(true);
    expect(historyPromptBlock(s, "steward")).toMatch(/mishap table is in play at low severity/);
    const before = s.player.renown;
    expect(hook(s, "M-001", "go_be_seen").ok).toBe(true);
    expect(s.player.renown).toBeGreaterThan(before);
    clock.next();
    expect(s.history.mishaps.open).toBeNull();
    expect(s.history.mishaps.answered).toBe(1);

    const t = count(90);
    const tclock = clockFor(t);
    tclock.next();
    expect(t.history.mishaps.open?.id).toBe("M-001");
    const renown = t.player.renown;
    tclock.next();
    expect(t.history.mishaps.open?.id).toBe("M-001");
    tclock.next();
    expect(t.history.mishaps.open).toBeNull();
    expect(t.player.renown).toBeLessThan(renown);
    expect(t.history.mishaps.answered).toBe(0);
  });

  it("a vassal who tests the lord goes to a named neighbour when nothing is done; judged, he stays", () => {
    quiet();
    const s = count(90);
    s.history.mishaps.faced = 1; // the walk through the band starts at the second entry
    const clock = clockFor(s);
    const r = clock.next();
    expect(s.history.mishaps.open?.id).toBe("M-002");
    const vassalId = s.history.mishaps.open!.vassalId!;
    const vassal = s.history.vassals.find((v) => v.id === vassalId)!;
    expect(r.beats.some((b) => b.text.includes(vassal.name))).toBe(true);
    const neighbours = ensureNeighbours(s);
    expect(neighbours.length).toBe(3);
    clock.next();
    clock.next();
    expect(s.history.vassals.some((v) => v.id === vassalId)).toBe(false);
    expect(s.history.vassalsLost.at(-1)?.name).toBe(vassal.name);
    expect(s.history.record.some((x) => new RegExp(`${vassal.name} left the lord's service.*commended himself to`).test(x.text))).toBe(true);

    const t = count(90);
    t.history.mishaps.faced = 1;
    const tclock = clockFor(t);
    tclock.next();
    const id = t.history.mishaps.open!.vassalId!;
    expect(hook(t, "M-002", "judge_him").ok).toBe(true);
    tclock.next();
    expect(t.history.vassals.some((v) => v.id === id)).toBe(true);
    expect(t.history.mishaps.answered).toBe(1);
  });

  it("riding against the encroaching neighbour raises the lord's own battle at once; a won field answers the matter", () => {
    quiet();
    const s = count(50);
    s.military.units.push({ id: "u1", sheetId: "pedites_fyrd", name: "Spears", veteran: false, strength: 20, raisedTurn: 1 });
    s.history.mishaps.faced = 0;
    const clock = clockFor(s);
    const r = clock.next();
    expect(s.history.mishaps.open?.id).toBe("M-004");
    const text = r.beats.find((b) => b.eventId === "M-004")!.text;
    expect(text).not.toMatch(/\{neighbour/);
    const neighbour = s.history.neighbours.find((n) => n.id === s.history.mishaps.open!.neighbourId)!;
    expect(text).toContain(neighbour.name);
    const ride = hook(s, "M-004", "ride_against_him");
    expect(ride.ok).toBe(true);
    expect(s.battle_call?.kind).toBe("history");
    expect(s.battle_call?.eventId).toBe("M-004-B");
    expect(s.history.mishaps.open?.battleOpen).toBe(true);
    // The field is the battle layer's; here the table's result stands in for it.
    s.battle_call = null;
    s.history.flags.mishap_battle = "won";
    const after = clock.next();
    expect(s.history.mishaps.open).toBeNull();
    expect(s.history.mishaps.answered).toBe(1);
    expect(after.beats.some((b) => /ours again/.test(b.text))).toBe(true);
    expect(s.history.flags.mishap_battle).toBeUndefined();
  });

  it("turning back from the neighbour's field loses the woodland and renown; the neighbour is remembered as having it", () => {
    quiet();
    const s = count(50);
    s.military.units.push({ id: "u1", sheetId: "pedites_fyrd", name: "Spears", veteran: false, strength: 20, raisedTurn: 1 });
    const clock = clockFor(s);
    clock.next();
    hook(s, "M-004", "ride_against_him");
    const renown = s.player.renown;
    const wood = s.holdings.reduce((n, h) => n + h.land.woodland, 0);
    const mills = s.holdings.reduce((n, h) => n + h.features.filter((f) => f === "mill" || f.startsWith("mill_")).length, 0);
    refuseCall(s, { chat: async () => "", log: () => {} });
    expect(s.history.flags.mishap_battle).toBe("refused");
    clock.next();
    expect(s.history.mishaps.open).toBeNull();
    expect(s.player.renown).toBeLessThan(renown);
    const neighbour = s.history.neighbours.find((n) => n.encroached.length)!;
    expect(neighbour.encroached[0]).toMatch(/mill|woodland/);
    const woodAfter = s.holdings.reduce((n, h) => n + h.land.woodland, 0);
    const millsAfter = s.holdings.reduce((n, h) => n + h.features.filter((f) => f === "mill" || f.startsWith("mill_")).length, 0);
    expect(woodAfter < wood || millsAfter < mills).toBe(true);
    expect(historyPromptBlock(s, "steward")).toMatch(new RegExp(`${neighbour.name} of ${neighbour.seat} has`));
  });

  it("the rival's summons: ignored, the office goes; the king's letter contested with good standing keeps the county and earns renown", () => {
    quiet();
    const s = count(10);
    s.history.mishaps.faced = 0;
    const clock = clockFor(s);
    clock.next();
    expect(s.history.mishaps.open?.id).toBe("M-007");
    expect(s.history.openChoices.some((c) => c.eventId === "M-007")).toBe(true);
    clock.next(); // the deadline passes: the default (ignore) is taken
    expect(s.history.chosen["M-007"]).toBe("ignore");
    clock.next();
    expect(s.history.mishaps.open).toBeNull();
    expect(s.player.rankLevel).toBe(2); // one county held: the rank itself went

    const k = count(1);
    k.history.flags.crown = 70;
    const kclock = clockFor(k);
    kclock.next();
    expect(k.history.mishaps.open?.id).toBe("M-009");
    const before = k.player.renown;
    expect(applyProposal(k, { type: "history_choice", summary: "", eventId: "M-009", optionId: "go_to_court" }, "steward").ok).toBe(true);
    kclock.next();
    expect(k.history.mishaps.open).toBeNull();
    expect(k.player.rankLevel).toBe(3);
    expect(k.history.rank.counties.length).toBe(1);
    expect(k.player.renown).toBeGreaterThan(before);
  });

  it("the outright attack raises a home defence on delivery; barring the hall loses a villa to the neighbour", () => {
    quiet();
    const s = count(10);
    s.history.mishaps.faced = 1;
    s.military.units.push({ id: "u1", sheetId: "pedites_fyrd", name: "Spears", veteran: false, strength: 20, raisedTurn: 1 });
    const clock = clockFor(s);
    const r = clock.next();
    expect(s.history.mishaps.open?.id).toBe("M-008");
    expect(s.battle_call?.kind).toBe("history");
    expect(s.battle_call?.historyId).toBe("neighbour_attack");
    expect(r.refereeLines.some((l) => /attacking the villa/.test(l))).toBe(true);
    const villas = s.holdings.length;
    refuseCall(s, { chat: async () => "", log: () => {} });
    clock.next();
    expect(s.holdings.length).toBe(villas - 1);
    expect(s.history.neighbours.some((n) => n.encroached.some((e) => /villa/.test(e)))).toBe(true);
  });

  it("the shipped calendar carries the table: every entry is registered, slots resolve, and the lint is clean", () => {
    const content = historyContent();
    for (const id of ["M-001", "M-002", "M-003", "M-004", "M-004-B", "M-005", "M-006", "M-007", "M-008", "M-009"]) expect(content.byId.has(id)).toBe(true);
    expect(content.battles.some((b) => b.id === "neighbour_woodland" && b.event === "M-004-B")).toBe(true);
    expect(content.battles.some((b) => b.id === "neighbour_attack" && b.event === "M-008" && b.home)).toBe(true);
    const s = count(90);
    expect(fillSlots(s, "{neighbour} of {neighbour_seat}; {mishap_vassal}; {count_of_autun}")).not.toMatch(/\{/);
  });
});

describe("depopulation by rank", () => {
  it("a minor noble's empty villa ends the play; a viscount falls back to minor noble; a count goes on and his crops rot standing", () => {
    const villa = fresh();
    villa.population.households = 0;
    expect(resolvePeopleMovement(villa).abandoned).toBe(true);
    expect(villa.estateAbandoned).toBe(true);

    const v = fresh();
    v.player.renown = 150;
    promoteTo(v, 2, { patron: "Thierry, count of Autun", turn: 20 });
    v.population.households = 0;
    v.population.adult_men = 0;
    v.population.adult_women = 0;
    v.population.youths = 0;
    const moved = resolvePeopleMovement(v);
    expect(moved.emptied).toBe(true);
    expect(moved.abandoned).toBeUndefined();
    expect(v.estateAbandoned).toBe(false);
    const r = resolveDepopulation(v, 21);
    expect(v.player.rankLevel).toBe(1);
    expect(r.beats[0].text).toMatch(/does not keep a viscount over nobody/);

    const c = count(600);
    c.population.households = 0;
    c.population.adult_men = 0;
    c.population.adult_women = 0;
    c.population.youths = 0;
    expect(resolvePeopleMovement(c).emptied).toBe(true);
    const rc = resolveDepopulation(c, 41);
    expect(c.player.rankLevel).toBe(3);
    expect(c.history.decay.emptiedTurn).toBe(41);
    expect(rc.beats[0].text).toMatch(/end at court, not in the fields/);
    expect(resolveDepopulation(c, 42).beats).toEqual([]);
    expect(hungerRow(c, 42)).toBe("starvation");
    const renown = c.player.renown;
    const vassalMood = c.history.vassals[0].mood;
    tickRenownDecay(c, at(c), 42);
    expect(c.player.renown).toBe(renown - HUNGER_DECAY[2][2]);
    expect(c.history.vassals[0].mood).toBeLessThan(vassalMood);
  });

  it("from viscount on, a household that slips away goes to a named neighbour, and Aldric can say who has them", () => {
    const s = fresh();
    expect(recordFlight(s, 5)).toBe("In the night a household slipped away from the demesne.");
    expect(s.history.neighbours).toEqual([]);
    s.player.rankLevel = 2;
    const line = recordFlight(s, 6);
    expect(line).toMatch(/slipped away from the demesne, to \w+'s lands at .+\. He offered them better terms/);
    expect(s.history.neighbours.length).toBe(3);
    expect(s.history.neighbours.reduce((n, x) => n + x.taken, 0)).toBe(1);
    expect(s.history.decay.flightTurn).toBe(6);
    expect(historyPromptBlock(s, "steward")).toMatch(/The neighbours: \w+ of .+ has 1 household of ours/);
    // The same neighbour keeps gaining: the second family goes where the first did.
    recordFlight(s, 7);
    expect(Math.max(...s.history.neighbours.map((n) => n.taken))).toBe(2);
  });
});
