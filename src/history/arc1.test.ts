import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { applyProposal } from "../engine/applyDelta";
import { WorldStateSchema, type WorldState } from "../engine/schema";
import { lintHistoryStructure } from "./lint";
import { historyContent } from "./load";
import { runHistorySeasonPass, type HistoryPassResult } from "./season";
import { rollSupply } from "./supply";
import { claimDeadlineFor, seizeVilla } from "./land";

/** Arc 1 against the shipped content: the scripts, the 830 crisis, the Field of Lies, 834. */

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
    const r = runHistorySeasonPass(state, incoming, state.meta.turn + 1);
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

const texts = (r: HistoryPassResult) => r.beats.map((b) => b.text);
const choose = (state: WorldState, eventId: string, optionId: string, actor = "steward") =>
  applyProposal(state, { type: "history_choice", summary: "", eventId, optionId }, actor);
const hook = (state: WorldState, eventId: string, hookId: string, actor = "steward") =>
  applyProposal(state, { type: "history_hook", summary: "", eventId, hookId }, actor);
const sceneAdvance = (state: WorldState, eventId: string) => applyProposal(state, { type: "history_scene", summary: "", eventId, advance: true }, "steward");

describe("Arc 1 content", () => {
  it("passes the structural lint and every event has a season between 826 and 840", () => {
    const content = historyContent();
    expect(lintHistoryStructure(content)).toEqual([]);
    const arc1 = content.events.filter((e) => String(e.arc) === "1");
    expect(arc1.length).toBeGreaterThanOrEqual(30);
    for (const e of arc1) expect(e.fires.year).toBeGreaterThanOrEqual(826);
  });

  it("delivers 826-01 verbatim from the steward and leaves the random other event suppressed", () => {
    const state = fresh();
    const clock = clockFor(state);
    clock.to(826, "spring");
    const r = clock.next();
    expect(r.fired).toEqual(["826-01"]);
    expect(texts(r)[0]).toMatch(/^My lord, Count Thierry of Autun is dead, God rest him\./);
    expect(r.suppressOther).toBe(true);
    expect(r.refereeLines[0]).toContain('History: 826-01 "A new count at Autun" was told by Aldric');
    expect(state.history.realm.countOfAutun).toBe("Bernard of Septimania");
  });

  it("the loyalist road: muster, keep the oath, the land crisis, Nijmegen, and the shrewd prediction", () => {
    const state = fresh();
    const clock = clockFor(state);
    clock.to(829, "summer");
    // 829-01 (chaplain) and 829-02 (steward) share the season
    const autumn829 = clock.next();
    expect(autumn829.fired).toEqual(["829-01", "829-02"]);
    expect(autumn829.beats[0].npcId).toBe("chaplain");
    expect(hook(state, "829-02", "predict_revolt").ok).toBe(true);
    expect(state.history.flags.prediction_830).toBe(true);

    const winter829 = clock.next();
    expect(winter829.fired).toEqual(["830-01"]);
    expect(texts(winter829)[0]).toMatch(/^\(bringing the count's messenger in, who reads\) By order of the emperor/);
    // say nothing: the default is to go
    const spring830 = clock.next();
    expect(state.history.chosen["830-01"]).toBe("go");
    expect(spring830.fired).toEqual(["830-02", "830-B1"]);
    expect(texts(spring830).some((t) => t.includes("this host will not march"))).toBe(true);
    // The battle pass: the tutorial fight is raised as a history call and holds the season until it is answered.
    expect(state.battle_call).toMatchObject({ kind: "history", eventId: "830-B1", historyId: "deserters_830", mode: "attached" });
    expect(texts(spring830).some((t) => t.includes("The muster waits on you"))).toBe(true);
    expect(spring830.refereeLines.some((l) => l.includes("830-B1") && l.includes("about to be fought"))).toBe(true);
    expect(state.history.away).not.toBeNull();

    const summer830 = clock.next();
    expect(state.history.away).toBeNull();
    expect(texts(summer830).some((t) => t.includes("the envoys are in our hall"))).toBe(true);
    expect(state.history.openChoices.find((c) => c.eventId === "830-02")?.stageId).toBe("reckoning");
    expect(state.history.realm.countOfAutun).toBe("Adalard");
    // keep the oath by name
    expect(choose(state, "830-02", "stay_loyal").ok).toBe(true);
    expect(state.history.flags.side_830).toBe("bernard");
    expect(state.history.land.tenure).toBe("forfeit_claimed");
    expect(state.history.realm.swornTo).toBe("none");
    // the scene waits for the season (advanceOn season)
    expect(state.history.scenes["830-02"].stage).toBe(1);

    const autumn830 = clock.next();
    expect(texts(autumn830).some((t) => t.includes("At Nijmegen"))).toBe(true);
    expect(autumn830.fired).toContain("830-L1");
    expect(autumn830.beats.some((b) => b.npcId === "chaplain" && b.text.includes("precaria"))).toBe(true);
    expect(state.history.land.claimDeadlineTurn).toBe(claimDeadlineFor(state, { year: 830, season: "autumn" }, state.meta.turn));
    expect(hook(state, "830-02", "ride_to_nijmegen").ok).toBe(true);
    expect(state.history.flags.loyalist_830).toBe(true);
    // the church out through Ermenald
    expect(hook(state, "830-L1", "church_nona", "chaplain").ok).toBe(true);
    expect(state.history.land.tenure).toBe("precaria");
    expect(state.history.realm.swornTo).toBe("church");

    const winter830 = clock.next();
    expect(state.history.scenes["830-02"]).toBeUndefined();
    expect(state.history.flags.reputation_shrewd).toBe(1);
    expect(winter830.beats.filter((b) => b.eventId.startsWith("land:"))).toHaveLength(0);
    clock.next(); // spring 831: no seizure
    expect(state.history.flags.forfeit_830).toBeUndefined();
    expect(state.holdings[0].manses.vacant).toBe(4);
  });

  it("the count seizes the villa at Aachen when the lord does nothing about the claim", () => {
    const state = fresh();
    const clock = clockFor(state);
    clock.to(830, "summer");
    choose(state, "830-02", "stay_loyal");
    clock.next(); // autumn 830: 830-L1
    const winter830 = clock.next();
    expect(winter830.beats.some((b) => b.eventId === "land:warning")).toBe(true);
    const spring831 = clock.next();
    expect(spring831.beats.some((b) => b.eventId === "land:seizure")).toBe(true);
    expect(state.holdings[0].manses).toEqual({ free: 4, servile: 4, vacant: 0 });
    expect(state.history.flags.forfeit_830).toBe(true);
    expect(state.history.land.tenure).toBe("benefice");
    expect(state.history.land.claimDeadlineTurn).toBeNull();
  });

  it("the rebel road: swear to Adalard, no letter from Bernard, ordinary service in 832", () => {
    const state = fresh();
    const clock = clockFor(state);
    clock.to(830, "summer");
    expect(choose(state, "830-02", "serve_new_count").ok).toBe(true);
    expect(state.history.flags.enemy_septimania).toBe(true);
    clock.to(831, "autumn");
    const winter831 = clock.next();
    expect(winter831.fired).toEqual(["831-01"]);
    expect(state.history.dropped).toContain("832-01");
    clock.to(832, "spring");
    const summer832 = clock.next();
    expect(summer832.fired).toEqual(["832-03"]);
    expect(texts(summer832).some((t) => t.includes("Ordinary service, my lord"))).toBe(true);
    expect(texts(summer832).some((t) => t.includes("He's testing you"))).toBe(false);
    const autumn832 = clock.next();
    expect(state.history.chosen["832-03"]).toBe("obey");
    expect(state.history.flags.served_832).toBe(true);
    expect(autumn832.fired).toContain("832-B1");
  });

  it("an outlaw of 832 keeps a claim hanging over the villa until Warin lifts it", () => {
    const state = fresh();
    const clock = clockFor(state);
    clock.to(830, "summer");
    choose(state, "830-02", "stay_loyal");
    clock.next();
    hook(state, "830-L1", "marry_local");
    expect(state.history.land.tenure).toBe("benefice");
    clock.to(831, "autumn");
    state.resources.horses = 4;
    clock.next();
    expect(choose(state, "832-01", "send_men").ok).toBe(true);
    expect(state.resources.horses).toBe(2);
    clock.to(832, "spring");
    clock.next();
    clock.next(); // autumn 832: default is already_south for a rebel_832
    expect(state.history.chosen["832-03"]).toBe("already_south");
    expect(state.history.flags.outlaw_832).toBe(true);
    expect(state.history.land.tenure).toBe("forfeit_claimed");
    expect(state.history.fired["832-L1"]).toBeDefined();
    clock.to(837, "summer");
    expect(state.history.land.tenure).toBe("forfeit_claimed");
    clock.next(); // 837-03
    expect(state.history.flags.outlaw_832).toBe(false);
    expect(state.history.land.tenure).toBe("benefice");
    expect(state.holdings[0].manses.vacant).toBe(4);
  });

  it("the Field of Lies: nights step by speech, an early exit ends the scene, silence stands to the end", () => {
    const early = fresh();
    const clock = clockFor(early);
    clock.to(833, "spring"); // two summons
    const summer = clock.next(); // emperor by default
    expect(summer.fired).toEqual(["833-01"]);
    expect(early.history.scenes["833-01"].stage).toBe(0);
    expect(sceneAdvance(early, "833-01").ok).toBe(true); // past the pope
    expect(early.history.scenes["833-01"].stage).toBe(1);
    expect(choose(early, "833-01", "take").ok).toBe(true);
    expect(early.history.scenes["833-01"]).toBeUndefined();
    expect(early.history.flags.bribed_833).toBe(true);
    expect(early.resources.denarii).toBe(fresh().resources.denarii + 60);
    expect(early.history.flags.stood_to_the_end).toBeUndefined();

    const silent = fresh();
    const c2 = clockFor(silent);
    c2.to(833, "summer");
    const renown = silent.player.renown ?? 1;
    const autumn = c2.next();
    expect(silent.history.scenes["833-01"]).toBeUndefined();
    expect(silent.history.flags.stood_to_the_end).toBe(true);
    expect(silent.player.renown).toBeGreaterThan(renown);
    expect(texts(autumn).some((t) => t.includes("purse of silver"))).toBe(true);
    expect(texts(autumn).some((t) => t.includes("released us from it"))).toBe(true);
    expect(autumn.fired).not.toContain("833-N1");

    const home = fresh();
    const c3 = clockFor(home);
    c3.to(833, "spring");
    choose(home, "833-S1", "stay");
    const s = c3.next();
    expect(s.fired).toEqual([]);
    const a = c3.next();
    expect(a.fired).toContain("833-N1");
  });

  it("834: restoration, the war in Burgundy with a supply check, refugees settle, Lothair submits", () => {
    const state = fresh();
    const clock = clockFor(state);
    clock.to(830, "autumn");
    hook(state, "830-L1", "church_fixed", "chaplain"); // keep the manses out of the count's hands
    clock.to(833, "winter"); // 833-02 told
    hook(state, "833-02", "predict_restoration", "chaplain");
    const spring834 = clock.next();
    expect(spring834.fired).toEqual(["834-01"]);
    expect(state.history.flags.reputation_shrewd).toBe(1);
    expect(texts(spring834).some((t) => t.includes("gratitude is fresh"))).toBe(true); // stood_to_the_end by default
    hook(state, "834-01", "ride_to_court");
    const summer834 = clock.next();
    expect(summer834.fired).toContain("834-03");
    expect(state.history.dropped).toContain("834-02"); // promotion windows are skipped this pass
    expect(summer834.fired).not.toContain("834-B1");
    expect(state.history.supply.lastRoll?.situation).toBe("foraging");
    const autumn834 = clock.next();
    expect(texts(autumn834).some((t) => t.includes("Chalon is taken and burned"))).toBe(true);
    expect(texts(autumn834).some((t) => t.includes("families from the Chalon district"))).toBe(true);
    expect(autumn834.fired).toContain("834-04");
    const households = state.population.households;
    expect(choose(state, "834-03", "take_in").ok).toBe(true);
    expect(state.population.households).toBe(households + 2);
    expect(state.holdings[0].manses.vacant).toBe(2);
    expect(state.history.scenes["834-03"]).toBeUndefined();
    expect(state.history.flags.chalon_834).toBe("stayed_home");
  });

  it("the supply roll is deterministic, respects paying off, and the militia can win", () => {
    const a = fresh();
    const b = fresh();
    const ra = rollSupply(a, "enemy_main", "x");
    const rb = rollSupply(b, "enemy_main", "x");
    expect(ra).toEqual(rb);
    const paid = fresh();
    paid.history.flags.paid_foragers = true;
    for (let i = 0; i < 20; i++) {
      const r = rollSupply(paid, "foraging", `k${i}`);
      if (r.happened) expect(r.share).toBeCloseTo(0.1);
    }
    const armed = fresh();
    armed.military.units = [{ ...(armed.military.units[0] ?? {}), id: "u1", sheetId: "pedites_fyrd", name: "The militia", veteran: false, strength: 40 } as never];
    let wins = 0;
    for (let i = 0; i < 40; i++) if (rollSupply(armed, "deserters", `d${i}`).militiaWon) wins++;
    expect(wins).toBeGreaterThan(0);
    // The battle pass: the militia's fight is the grid's; the stores wait on its result and nothing is taken yet.
    const stands = fresh();
    stands.military.units = armed.military.units;
    const grain = stands.resources.wheat;
    let calls = 0;
    for (let i = 0; i < 40; i++) {
      const r = rollSupply(stands, "deserters", `d${i}`, { militiaBattle: true });
      if (r.happened) {
        expect(r.militiaCall).toBe(true);
        expect(r.share).toBeGreaterThan(0);
        calls++;
      }
    }
    expect(calls).toBeGreaterThan(0);
    expect(stands.resources.wheat).toBe(grain);
  });

  it("seizure never touches the hall and the chronicle records it", () => {
    const state = fresh();
    seizeVilla(state);
    expect(state.holdings[0].manses.free).toBe(4);
    expect(state.history.record.at(-1)?.thread).toBe("land");
  });

  it("837–840: the count's illness defaults to his death, Warin takes Autun, the eclipse framing pays, the emperor dies", () => {
    const state = fresh();
    const clock = clockFor(state);
    clock.to(836, "winter");
    hook(state, "835-01", "predict_comet", "steward");
    expect(state.history.flags.predicted_comet).toBe(true);
    const renown = state.player.renown ?? 1;
    const spring837 = clock.next();
    expect(spring837.fired).toEqual(["837-01"]);
    expect(state.player.renown).toBeGreaterThan(renown);
    clock.next(); // 837-02 opens an outcome
    expect(state.history.openOutcomes.some((o) => o.eventId === "837-02")).toBe(true);
    const autumn837 = clock.next();
    expect(state.history.outcomes["837-02"]).toBe("died");
    expect(autumn837.fired).toEqual(["837-03"]);
    expect(texts(autumn837)[0]).toContain("took the flux at the end of the summer");
    expect(state.history.realm.countOfAutun).toBe("Warin");
    clock.to(840, "spring"); // 840-P1 told
    hook(state, "840-P1", "predict_quiet", "chaplain");
    const summer840 = clock.next();
    expect(summer840.fired).toEqual(["840-01"]);
    expect(texts(summer840).some((t) => t.includes("The bishop had the clergy ready"))).toBe(true);
    expect(state.history.flags.bishop_trust).toBe(2);
    const autumn840 = clock.next();
    expect(autumn840.fired).toContain("840-02");
    expect(autumn840.beats.some((b) => b.npcId === "chaplain")).toBe(true);
    expect(state.history.realm.emperor).toBe("Lothair");
  });
});
