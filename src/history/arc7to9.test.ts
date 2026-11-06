import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { applyProposal } from "../engine/applyDelta";
import { WorldStateSchema, type WorldState } from "../engine/schema";
import { lintHistory, lintHistoryStructure } from "./lint";
import { historyContent } from "./load";
import { dukeOpportunities, dukeTrackScore } from "./richard";
import { runHistorySeasonPass, type HistoryPassResult } from "./season";
/** Step E: Arcs 7–9 (878-K1 … 911-F1), Richard as rival, the open throne, minting, Saracens and Magyars, the Church and scholars. */

function fresh(): WorldState {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

const ORDER = ["spring", "summer", "autumn", "winter"] as const;
type Season = (typeof ORDER)[number];

function clockFor(state: WorldState) {
  const next = (): HistoryPassResult => {
    const i = ORDER.indexOf(state.meta.season);
    const incoming = i === 3 ? { year: state.meta.year + 1, season: ORDER[0] } : { year: state.meta.year, season: ORDER[i + 1] };
    if (state.battle_call?.kind === "history") state.battle_call = null; // The clock stands in for the hall: a history call left open is answered before the season turns.
    const r = runHistorySeasonPass(state, incoming, state.meta.turn + 1, { coverUpkeep: true });
    state.meta.year = incoming.year;
    state.meta.season = incoming.season;
    state.meta.turn += 1;
    return r;
  };
  const to = (year: number, season: Season): HistoryPassResult[] => {
    const all: HistoryPassResult[] = [];
    while (state.meta.year < year || (state.meta.year === year && ORDER.indexOf(state.meta.season) < ORDER.indexOf(season))) all.push(next());
    return all;
  };
  return { next, to };
}

const choose = (state: WorldState, eventId: string, optionId: string) => applyProposal(state, { type: "history_choice", summary: "", eventId, optionId }, "steward");
const hook = (state: WorldState, eventId: string, hookId: string, actor = "steward") =>
  applyProposal(state, { type: "history_hook", summary: "", eventId, hookId }, actor);
const judge = (state: WorldState, eventId: string, outcomeId: string) =>
  applyProposal(state, { type: "history_outcome", summary: "", eventId, outcomeId, reasoning: "test" }, "steward");

/** Keep the manses and the count's oath through the 830 crisis. */
function settled(state: WorldState, clock: ReturnType<typeof clockFor>) {
  clock.to(830, "autumn");
  hook(state, "830-L1", "marry_local");
}

/** Every id in the scripts' Event index (design/history/Event_Delivery_Scripts.md). */
const EVENT_INDEX = [
  "826-01", "827-01", "828-01", "829-01", "829-02", "830-01", "830-02", "831-01", "832-01", "832-02", "832-03", "833-01", "833-02", "834-01", "834-02",
  "834-03", "834-04", "835-01", "835-02", "837-01", "837-02", "837-03", "838-01", "838-02", "839-01", "839-02", "840-01", "840-02", "840-03", "840-04",
  "841-01", "841-02", "841-03", "841-V1", "842-01", "842-02", "842-03", "843-01", "843-02", "843-03", "843-V1", "844-01", "844-02", "845-V1", "845-A1",
  "845-B1", "848-A1", "851-B1", "852-A1", "853-V1", "855-A1", "855-C1", "858-C1", "858-C2", "862-V1", "863-C1", "864-V1", "864-V2", "866-V1", "869-C1",
  "870-C2", "875-C1", "875-V1", "876-C1", "877-C1", "878-K1", "879-K1", "879-K2", "880-K1", "880-K2", "880-K3", "881-V1", "882-K1", "882-K2", "884-K1",
  "885-K1", "885-V1", "886-V1", "886-V2", "887-K1", "887-K2", "887-S1", "887-V1", "888-K2", "888-V1", "893-K1", "897-K1", "898-K1", "898-V1", "910-E1",
  "911-F1",
];

const STEP_E_FLAGS = [
  "boso_sympathy", "boso_refused", "richard_vassal", "richard_respect", "resisted_880", "stalled_880", "vienne_880", "saone_880", "richard_squeeze",
  "side_893", "king_888", "odo_king", "candidate_888", "duke_backed_rudolph", "duke_married_adelaide", "duke_louis_provence", "duke_joined_plot",
  "duke_sheltered_charles", "duke_took_sens", "duke_lay_abbacies", "duke_marquis", "duke_assembly", "duke_track", "fraxinetum", "escorted_pilgrims",
  "mint", "lupus_correspondent", "nithard_account", "eriugena_met", "school_auxerre", "cluny_witness", "chaplain_curious", "scholar_contact",
];

describe("Arcs 7–9 content", () => {
  it("lints, the calendar is complete, and every Step E flag has a setter", () => {
    expect(lintHistoryStructure(historyContent())).toEqual([]);
    const unset = lintHistory(historyContent()).filter((p) => p.includes("nothing sets it"));
    for (const id of STEP_E_FLAGS) expect(unset.find((p) => p.includes(`'${id}'`)), id).toBeUndefined();
    for (const id of EVENT_INDEX) expect(historyContent().byId.has(id), id).toBe(true);
    expect(dukeOpportunities()).toHaveLength(9);
  });

  it("Boso and then Richard become count by their announcing events, and the oath to Richard defaults", () => {
    const state = fresh();
    const clock = clockFor(state);
    settled(state, clock);
    clock.to(878, "summer");
    const autumn = clock.next();
    expect(autumn.fired).toContain("878-K1");
    expect(state.history.realm.countOfAutun).toBe("Boso");
    expect(autumn.beats.filter((b) => b.eventId === "realm:count")).toHaveLength(0);
    clock.to(879, "winter");
    const spring = clock.next();
    expect(spring.fired).toContain("880-K1");
    expect(state.history.realm.countOfAutun).toBe("Richard the Justiciar");
    const summer = clock.next();
    expect(state.history.chosen["880-K1"]).toBe("swear");
    expect(state.history.flags.richard_vassal).toBe(true);
    expect(state.history.realm.swornTo).toBe("count");
    expect(state.history.land.charter).toBe("count");
    expect(summer.fired).toContain("880-K2");
    expect(summer.fired).not.toContain("880-L1");
  });

  it("stalling on Richard's oath opens a forfeiture claim and the 880 land window instead of the Saône summons", () => {
    const state = fresh();
    const clock = clockFor(state);
    settled(state, clock);
    clock.to(880, "spring");
    expect(choose(state, "880-K1", "stall").ok).toBe(true);
    expect(state.history.flags.stalled_880).toBe(true);
    expect(state.history.land.tenure).toBe("forfeit_claimed");
    expect(state.history.realm.swornTo).toBe("none");
    const summer = clock.next();
    expect(summer.fired).toContain("880-L1");
    expect(summer.fired).not.toContain("880-K2");
    expect(hook(state, "880-L1", "swear_late").ok).toBe(true);
    expect(state.history.land.tenure).toBe("benefice");
    expect(state.history.flags.richard_vassal).toBe(true);
  });

  it("the open throne: Odo by default, or the lord himself when the electors' factors hold", () => {
    const a = fresh();
    const ca = clockFor(a);
    settled(a, ca);
    ca.to(887, "winter");
    expect(a.history.fired["887-K2"]).toBeDefined();
    expect(a.history.openOutcomes.some((o) => o.eventId === "887-K2")).toBe(true);
    expect(judge(a, "887-K2", "self").ok).toBe(false);
    const spring = ca.next();
    expect(a.history.outcomes["887-K2"]).toBe("odo");
    expect(a.history.flags.king_888).toBe("odo");
    expect(a.history.flags.odo_king).toBe(true);
    expect(spring.fired).toContain("888-K2");
    expect(spring.beats.some((b) => b.eventId === "888-K2" && b.text.startsWith("My lord, they have made Odo king."))).toBe(true);
    expect(a.history.realm.king).toBe("Odo");

    const b = fresh();
    const cb = clockFor(b);
    settled(b, cb);
    cb.to(886, "winter");
    b.player.rankLevel = 3;
    b.player.renown = 850;
    b.history.flags.objected_886 = true;
    cb.to(887, "winter");
    expect(judge(b, "887-K2", "self").ok).toBe(true);
    expect(b.history.flags.king_888).toBe("self");
    expect(b.history.flags.candidate_888).toBe(true);
    const spring2 = cb.next();
    expect(spring2.beats.some((b2) => b2.eventId === "888-K2" && b2.text.startsWith("They have made you king, my lord."))).toBe(true);
    cb.to(893, "spring");
    expect(choose(b, "893-K1", "charles").ok).toBe(false);
    cb.next();
    expect(b.history.chosen["893-K1"]).toBe("hold_crown");
    expect(b.history.flags.side_893).toBe("self");
  });

  it("two kings: the lord follows Richard by default, and the kings' terms play out over two seasons", () => {
    const state = fresh();
    const clock = clockFor(state);
    settled(state, clock);
    clock.to(893, "spring");
    expect(state.history.fired["893-K1"]).toBeDefined();
    clock.next();
    expect(state.history.flags.side_893).toBe("charles");
    clock.to(897, "autumn");
    const winter = clock.next();
    expect(winter.fired).toContain("897-K1");
    expect(winter.beats.some((b) => b.text.startsWith("They have made peace, my lord."))).toBe(true);
    expect(state.history.realm.king).toBe("Odo");
    const spring = clock.next();
    expect(spring.beats.some((b) => b.text.startsWith("And now Odo is dead"))).toBe(true);
    expect(state.history.realm.king).toBe("Charles the Simple");
    expect(spring.beats.filter((b) => b.eventId === "realm:king")).toHaveLength(0);
    clock.next();
    expect(state.history.record.some((r) => r.text.startsWith("Odo died on 1 January 898"))).toBe(true);
    expect(state.history.scenes["897-K1"]).toBeUndefined();
  });

  it("Richard takes every chance the lord leaves him, and Aldric says so", () => {
    const state = fresh();
    const clock = clockFor(state);
    settled(state, clock);
    clock.to(889, "autumn");
    expect(state.history.flags.richard_standing).toBeUndefined();
    const winter = clock.next();
    expect(state.history.flags.richard_standing).toBe(2);
    expect(winter.beats.filter((b) => b.eventId.startsWith("richard:"))).toHaveLength(2);
    expect(winter.beats.some((b) => b.text.includes("married Adelaide"))).toBe(true);
    clock.to(902, "spring");
    expect(state.history.flags.richard_standing).toBe(9);
    expect(state.history.richard.taken).toHaveLength(9);
    expect(state.history.record.filter((r) => r.thread === "richard")).toHaveLength(9);
    expect(dukeTrackScore(state)).toEqual({ taken: 0, of: 9, result: "Autun and nothing more; Richard builds the duchy around the lord." });

    const d = fresh();
    const cd = clockFor(d);
    settled(d, cd);
    cd.to(889, "autumn");
    expect(hook(d, "889-R1", "back_rudolph").ok).toBe(false);
    d.player.rankLevel = 4;
    d.resources.denarii = 200;
    expect(hook(d, "889-R1", "back_rudolph").ok).toBe(true);
    expect(hook(d, "889-R1", "marry_adelaide").ok).toBe(true);
    cd.next();
    expect(d.history.flags.richard_standing).toBeUndefined();
    expect(dukeTrackScore(d).taken).toBe(2);
  });

  it("Fraxinetum is a standing hazard with a permanent price effect and open hooks", () => {
    const state = fresh();
    const clock = clockFor(state);
    settled(state, clock);
    clock.to(887, "spring");
    const summer = clock.next();
    expect(summer.fired).toContain("887-S1");
    expect(state.history.flags.fraxinetum).toBe(true);
    expect(state.modifiers.some((m) => m.kind === "permanent" && m.source.includes("Fraxinetum"))).toBe(true);
    clock.to(895, "spring");
    state.resources.denarii = 50;
    const favor = Number(state.history.flags.favor_church ?? 50);
    expect(hook(state, "887-S1", "ransom_contribution").ok).toBe(true);
    expect(state.resources.denarii).toBe(30);
    expect(state.history.flags.favor_church).toBe(favor + 1);
  });

  it("the Church entries open the scholars' hooks, gated by access", () => {
    const state = fresh();
    const clock = clockFor(state);
    settled(state, clock);
    clock.to(847, "spring");
    state.resources.denarii = 50;
    expect(hook(state, "C-847", "write_to_lupus", "chaplain").ok).toBe(true);
    expect(state.resources.denarii).toBe(40);
    expect(state.history.flags.lupus_correspondent).toBe(true);
    clock.to(861, "summer");
    expect(hook(state, "C-861", "reach_eriugena", "chaplain").ok).toBe(false);
    state.history.flags.royal_vassal = true;
    expect(hook(state, "C-861", "reach_eriugena", "chaplain").ok).toBe(true);
    expect(state.history.flags.eriugena_met).toBe(true);
    clock.to(910, "autumn");
    expect(state.history.fired["910-E1"]).toBeDefined();
    state.history.flags.favor_church = 0;
    state.history.flags.favor_septimania = 0;
    delete state.history.flags.tournus_friend;
    delete state.history.flags.oath_kept_lord;
    expect(hook(state, "910-E1", "witness_cluny", "chaplain").ok).toBe(false);
    state.history.flags.favor_church = 53;
    state.resources.denarii = 100;
    expect(hook(state, "910-E1", "witness_cluny", "chaplain").ok).toBe(true);
    expect(state.history.flags.cluny_witness).toBe(true);
    // From 910 the age roll runs (Step G): Chartres is heard only if he lives to hear it.
    const autumn911 = clock.to(911, "autumn");
    if (state.history.dead) expect(state.history.dead.year).toBeGreaterThanOrEqual(910);
    else expect(autumn911[autumn911.length - 1].fired).toContain("911-F1");
  });

  it("minting: the notes are flavour, the mint itself is count-rank", () => {
    const a = fresh();
    const ca = clockFor(a);
    settled(a, ca);
    ca.to(896, "spring");
    expect(a.history.fired["M-874"]).toBeDefined();
    expect(a.history.fired["M-891"]).toBeDefined();
    expect(a.history.fired["M-896"]).toBeUndefined();
    expect(a.history.dropped).toContain("M-896");

    const b = fresh();
    const cb = clockFor(b);
    settled(b, cb);
    cb.to(895, "winter");
    b.player.rankLevel = 3;
    b.resources.denarii = 200;
    const spring = cb.next();
    expect(spring.fired).toContain("M-896");
    expect(hook(b, "M-896", "strike_coin").ok).toBe(true);
    expect(b.history.flags.mint).toBe("usurped");
    expect(b.history.flags.richard_standing).toBeGreaterThanOrEqual(1);
  });

  it("the kings run out: Carloman's death brings Ermenald, and the Magyars arrive on schedule", () => {
    const state = fresh();
    const clock = clockFor(state);
    settled(state, clock);
    clock.to(884, "autumn");
    const winter = clock.next();
    expect(winter.fired).toContain("884-K1");
    expect(winter.beats.some((b) => b.eventId === "884-K1" && b.npcId === "chaplain")).toBe(true);
    clock.to(910, "autumn");
    for (const id of ["862-M1", "899-M1", "907-M1", "910-M1", "838-S1", "846-S1", "869-S1", "863-F1", "865-F1", "878-F1", "883-F1"]) {
      expect(state.history.fired[id], id).toBeDefined();
    }
  });
});
