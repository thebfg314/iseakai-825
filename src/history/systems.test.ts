import { afterEach, describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import dutiesFile from "../../data/history/events/duties.json";
import questFile from "../../data/history/events/quest.json";
import { applyProposal } from "../engine/applyDelta";
import { WorldStateSchema, type WorldState } from "../engine/schema";
import { ESPIONAGE_CUT_SEASONS } from "./diffusion";
import { DUTY_IDS, rollDuty } from "./duties";
import { ladderThresholdMet } from "./ladder";
import { lintHistory, lintHistoryStructure } from "./lint";
import { historyContent, setHistoryContentForTests } from "./load";
import { alliesWon } from "./quest";
import { runHistorySeasonPass, type HistoryPassResult } from "./season";
import { slotValue } from "./slots";

/** Step F: royal vassal duties, the escalation ladder, the king quest, the diffusion ledger. */

function fresh(): WorldState {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

const ORDER = ["spring", "summer", "autumn", "winter"] as const;

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
  return { next };
}

const choose = (state: WorldState, eventId: string, optionId: string) => applyProposal(state, { type: "history_choice", summary: "", eventId, optionId }, "steward");
const hook = (state: WorldState, eventId: string, hookId: string, actor = "steward") =>
  applyProposal(state, { type: "history_hook", summary: "", eventId, hookId }, actor);

/** A quiet calendar: only the rolled events, with the switches set. */
function quiet(features: { ladder?: boolean; quest?: boolean; promotions?: boolean; diffusion?: boolean } = {}) {
  setHistoryContentForTests({ events: [...dutiesFile.events, ...questFile.events], features });
}

afterEach(() => setHistoryContentForTests(null));

/**
 * Flags the registry carries for the two passes still to come (03_HISTORY §9–§10).
 * Anything else the lint reports as unset is a content bug.
 */
/**
 * Flags registered for scenes not yet written. The battle pass (03_HISTORY §9) sets saved_gaucelm,
 * saved_gerberga, oath_under_duress_834 and robert_saved from the forces tables; the promotion pass
 * (§10) sets royal_vassal, villa_confirmed, second_villa and distrusted_834 from 834-02. These remain:
 * witnessed_mutiny_830 and pippin_restoration are 830/834 campaign beats with no battle of their own,
 * letter_of_protection a hook not yet scripted.
 */
const DEFERRED_PASS_FLAGS = {
  battles: ["witnessed_mutiny_830", "pippin_restoration", "letter_of_protection"],
};

describe("the content lint", () => {
  it("every registered flag is set by content or the engine, save those of the deferred passes", () => {
    const unset = lintHistory(historyContent())
      .filter((p) => p.includes("nothing sets it"))
      .map((p) => /flag '([^']+)'/.exec(p)?.[1] ?? p)
      .sort();
    expect(unset).toEqual([...DEFERRED_PASS_FLAGS.battles].sort());
  });
});

describe("royal vassal duties", () => {
  it("lints, and rolled events never come by the calendar", () => {
    expect(lintHistoryStructure(historyContent())).toEqual([]);
    const unset = lintHistory(historyContent()).filter((p) => p.includes("nothing sets it"));
    for (const id of ["petitioned_king", "submitted_to_king", "stripped_by_king", "rebel_king", "king_attempt", "quarrel_public", "traitor_hunted", "crowned_king", "crown_route", "simony_taint", "duke_by_counter_offer", "excommunicated", "missus_inspected", "land_visible"]) {
      expect(unset.find((p) => p.includes(`'${id}'`)), id).toBeUndefined();
    }
    const state = fresh();
    const clock = clockFor(state);
    for (let i = 0; i < 40; i++) clock.next();
    const rolled = Object.keys(state.history.fired).filter((id) => /^[DLQ]-/.test(id));
    expect(rolled).toEqual([]);
    expect(state.history.dropped.filter((id) => /^[DLQ]-/.test(id))).toEqual([]);
  });

  it("a royal vassal draws a duty each quiet season; hosting the court is a choice with a petition behind it", () => {
    quiet();
    const state = fresh();
    state.history.flags.royal_vassal = true;
    state.resources.denarii = 500;
    state.resources.horses = 6;
    const clock = clockFor(state);
    let hosted = false;
    for (let i = 0; i < 80 && !(hosted && i >= 8); i++) {
      const roll = rollDuty(state, nextSeason(state), state.meta.turn + 1);
      const awayUntil = state.history.away?.untilTurn ?? null;
      const r = clock.next();
      if (awayUntil !== null && awayUntil > state.meta.turn) {
        // Still away after the home-coming check: no duty this season.
        expect(r.fired.filter((id) => id.startsWith("D-"))).toEqual([]);
        continue;
      }
      expect(r.fired).toContain(DUTY_IDS[roll - 1]);
      expect(r.suppressOther).toBe(true);
      hosted = roll === 7;
    }
    expect(hosted).toBe(true);
    expect(state.history.flags.duty_performed).toBeGreaterThan(0);
    expect(state.history.duties.favour).toBeGreaterThan(0);
    const favour = state.history.duties.favour;
    state.resources.wheat = 50;
    state.resources.rye = 50;
    state.resources.pigs = 10;
    state.resources.cattle = 5;
    state.resources.wine = 30;
    expect(hook(state, "D-007", "petition_the_king").ok).toBe(false);
    expect(choose(state, "D-007", "lavishly").ok).toBe(true);
    expect(hook(state, "D-007", "petition_the_king").ok).toBe(true);
    expect(state.history.flags.petitioned_king).toBe(true);
    clock.next();
    expect(state.history.duties.favour).toBeGreaterThanOrEqual(favour + 2);
  });
});

function nextSeason(state: WorldState) {
  const i = ORDER.indexOf(state.meta.season);
  return i === 3 ? { year: state.meta.year + 1, season: ORDER[0] } : { year: state.meta.year, season: ORDER[i + 1] };
}

function dangerous(happiness: number, favorChurch: number): WorldState {
  const state = fresh();
  state.player.renown = 900;
  state.player.rankLevel = 3;
  state.peopleHappiness = happiness;
  state.history.flags.favor_church = favorChurch;
  state.resources.denarii = 2000;
  return state;
}

describe("the king's escalation ladder", () => {
  it("is closed by the feature switch", () => {
    quiet({ ladder: false });
    const state = dangerous(30, 0);
    expect(ladderThresholdMet(state)).toBe(true);
    clockFor(state).next();
    expect(state.history.ladder.stage).toBe("none");
    expect(state.history.fired["L-001"]).toBeUndefined();
  });

  it("warns, then strips a lord whose people would not rise for him; gifts at the warning end it", () => {
    quiet({ ladder: true, quest: true });
    const a = dangerous(30, 0);
    const ca = clockFor(a);
    const first = ca.next();
    expect(first.fired).toContain("L-001");
    expect(a.history.ladder.stage).toBe("warning");
    for (let i = 0; i < 3; i++) expect(ca.next().fired).not.toContain("L-002");
    const strike = ca.next();
    expect(strike.fired).toContain("L-002");
    expect(a.history.ladder.stage).toBe("stripped");
    ca.next(); // the summons defaults to "go"
    expect(a.history.chosen["L-002"]).toBe("go");
    expect(a.player.rankLevel).toBe(2);
    expect(a.history.flags.stripped_by_king).toBe(1);
    expect(a.history.ladder.stage).toBe("none");

    const b = dangerous(30, 0);
    const cb = clockFor(b);
    cb.next();
    expect(hook(b, "L-001", "send_gifts").ok).toBe(true);
    expect(b.resources.denarii).toBe(1900);
    cb.next();
    expect(b.history.ladder.stage).toBe("none");
    expect(b.history.quest.phase).toBe("submitted");
    expect(b.history.flags.submitted_to_king).toBe(1);
    for (let i = 0; i < 6; i++) cb.next();
    expect(b.history.fired["L-002"]).toBeUndefined();
  });

  it("excommunicates when the people are loyal and the bishops can be bought; penance lifts the ban", () => {
    quiet({ ladder: true, quest: true });
    const state = dangerous(70, 0);
    const clock = clockFor(state);
    for (let i = 0; i < 5; i++) clock.next();
    expect(state.history.fired["L-003"]).toBeDefined();
    expect(state.history.flags.excommunicated).toBe(true);
    const mood = state.peopleHappiness;
    clock.next();
    expect(state.peopleHappiness).toBeLessThan(mood);
    const fee = slotValue(state, "absolution_penance") ?? 0;
    expect(fee).toBeGreaterThan(0);
    const coin = state.resources.denarii;
    expect(hook(state, "L-003", "penance", "chaplain").ok).toBe(true);
    expect(state.resources.denarii).toBe(coin - fee);
    expect(state.history.flags.excommunicated).toBe(false);
    clock.next();
    expect(state.history.ladder.stage).toBe("none");
    expect(state.history.flags.absolved_once).toBe(true);
  });

  it("reaches for the road when the lawful tools are blocked, and the attempt starts the quest", () => {
    quiet({ ladder: true, quest: true });
    const state = dangerous(70, 5);
    const clock = clockFor(state);
    for (let i = 0; i < 5; i++) clock.next();
    expect(state.history.fired["L-004"]).toBeDefined();
    expect(state.history.flags.king_attempt).toBe(true);
    expect(state.history.ladder.stage).toBe("attempt");
    const r = clock.next(); // defaults to "prepare"
    expect(state.history.ladder.stage).toBe("quest");
    expect(state.history.quest.phase).toBe("gathering");
    expect(r.fired).toContain("Q-001");
    expect(state.history.quest.nobles).toHaveLength(9);
    expect(state.history.quest.nobles.filter((n) => n.status === "refused")).toHaveLength(1);
  });
});

describe("the king quest", () => {
  function atGathering(features: { promotions?: boolean } = {}): { state: WorldState; clock: ReturnType<typeof clockFor> } {
    quiet({ ladder: true, quest: true, ...features });
    const state = dangerous(70, 5);
    state.history.flags.saint_florentin_888 = true;
    const clock = clockFor(state);
    for (let i = 0; i < 6; i++) clock.next();
    expect(state.history.quest.phase).toBe("gathering");
    return { state, clock };
  }

  it("resolves one approach a season, the king's man refuses, and the assembly needs four", () => {
    const { state, clock } = atGathering({ promotions: false });
    expect(hook(state, "Q-001", "call_the_assembly").ok).toBe(false);
    expect(hook(state, "Q-001", "approach_grievance").ok).toBe(true);
    expect(hook(state, "Q-001", "approach_divine", "chaplain").ok).toBe(true);
    expect(alliesWon(state)).toBe(0);
    clock.next();
    expect(alliesWon(state)).toBe(1);
    expect(state.history.quest.nobles.find((n) => n.motive === "grievance")?.status).toBe("won");
    clock.next();
    expect(alliesWon(state)).toBe(2);
    const kingsMan = state.history.quest.nobles.find((n) => n.status === "refused")!;
    const r = hook(state, "Q-001", `approach_${kingsMan.motive}`);
    if (r.ok) {
      clock.next();
      expect(state.history.quest.nobles.find((n) => n.motive === kingsMan.motive)?.status).toBe("refused");
    }
    for (const m of ["protection", "fear", "land", "office"]) {
      if (m === kingsMan.motive) continue;
      expect(hook(state, "Q-001", `approach_${m}`).ok, m).toBe(true);
    }
    for (let i = 0; i < 5; i++) clock.next();
    expect(alliesWon(state)).toBeGreaterThanOrEqual(5);
    expect(hook(state, "Q-001", "call_the_assembly").ok).toBe(true);
    const battle = clock.next();
    expect(state.history.quest.phase).toBe("battle");
    expect(battle.fired).toContain("Q-002");
    expect(state.history.quest.nobles.filter((n) => n.status === "betrayer")).toHaveLength(1);
    expect(state.history.away?.reason).toContain("against the king");
    clock.next();
    expect(state.history.quest.phase).toBe("election");
    expect(state.history.dropped).toContain("Q-003");
    expect(state.history.fired["Q-003"]).toBeUndefined();
  });

  it("with the promotion pass on, the assembly crowns a lord the bishops love", () => {
    const { state, clock } = atGathering({ promotions: true });
    for (const m of ["grievance", "divine", "protection", "fear", "land", "office", "money", "debt"]) hook(state, "Q-001", `approach_${m}`, m === "divine" || m === "fear" || m === "office" ? "chaplain" : "steward");
    for (let i = 0; i < 9; i++) clock.next();
    expect(alliesWon(state)).toBeGreaterThanOrEqual(6);
    expect(hook(state, "Q-001", "call_the_assembly").ok).toBe(true);
    clock.next();
    const election = clock.next();
    expect(election.fired).toContain("Q-003");
    expect(choose(state, "Q-003", "earned").ok).toBe(true);
    expect(state.history.flags.crowned_king).toBe(true);
    const crowned = clock.next();
    expect(state.history.quest.phase).toBe("crowned");
    expect(state.player.rankLevel).toBe(5);
    expect(state.player.rank).toBe("king");
    // The crown brings the steps between: counties by office, the chest, the royal fisc.
    expect(state.history.rank.counties.length).toBe(4);
    expect(state.history.rank.royalFisc?.yearly).toBe(300000);
    expect(state.history.vassals.some((v) => v.group)).toBe(true);
    expect(crowned.beats.some((b) => b.text.includes("King of this land"))).toBe(true);
  });

  it("a second attempt closes marriage, fear and divine favour", () => {
    const { state } = atGathering();
    state.history.quest.attempt = 1;
    expect(hook(state, "Q-001", "approach_marriage").ok).toBe(false);
    expect(hook(state, "Q-001", "approach_fear", "chaplain").ok).toBe(false);
    expect(hook(state, "Q-001", "approach_grievance").ok).toBe(true);
  });
});

describe("the diffusion ledger", () => {
  it("runs the timers: taught spreads in a year, a copied text reaches the kingdom and cuts grain prices", () => {
    quiet({ diffusion: true });
    const state = fresh();
    const clock = clockFor(state);
    const reg = applyProposal(state, { type: "innovation_register", summary: "", innovationId: "rotation", name: "three-field rotation", legibility: "puzzling", reproduction: "trivial", proof: "generation", writtenDown: false }, "steward");
    expect(reg.ok).toBe(true);
    expect(applyProposal(state, { type: "innovation_expose", summary: "", innovationId: "rotation", how: "taught" }, "steward").ok).toBe(true);
    const inn = state.history.diffusion.innovations[0];
    expect(inn.spreadDueTurn).toBe(state.meta.turn + 4);
    for (let i = 0; i < 3; i++) clock.next();
    expect(inn.spread).toBe("own_lands");
    const r = clock.next();
    expect(inn.spread).toBe("region");
    expect(r.beats.some((b) => b.eventId === "diffusion:rotation")).toBe(true);
    const wheatBefore = { ...state.market.wheat };
    expect(applyProposal(state, { type: "innovation_expose", summary: "", innovationId: "rotation", how: "monks_copied" }, "chaplain").ok).toBe(true);
    expect(inn.writtenDown).toBe(true);
    for (let i = 0; i < 4; i++) clock.next();
    expect(inn.spread).toBe("kingdom");
    expect(state.history.diffusion.grainCut).toBe(true);
    expect(state.market.wheat.max).toBe(Math.round(wheatBefore.max * 0.9));
    expect(state.history.record.some((x) => x.thread === "knowledge" && x.text.includes("whole kingdom"))).toBe(true);
  });

  it("espionage can cut an opaque process shown in public to a few years", () => {
    quiet({ diffusion: true });
    const state = fresh();
    state.history.flags.count_covets = true;
    state.history.richard.taken.push("marquis");
    state.history.ladder.stage = "warning";
    applyProposal(state, { type: "innovation_register", summary: "", innovationId: "powder", name: "gunpowder", legibility: "opaque", reproduction: "programme", proof: "self", writtenDown: false }, "steward");
    applyProposal(state, { type: "innovation_expose", summary: "", innovationId: "powder", how: "public_use" }, "steward");
    const inn = state.history.diffusion.innovations[0];
    expect(inn.spreadDueTurn).toBeNull();
    const clock = clockFor(state);
    let spied = false;
    for (let i = 0; i < 80 && !spied; i++) {
      clock.next();
      if (inn.exposure.includes("espionage")) spied = true;
    }
    expect(spied).toBe(true);
    expect(inn.spreadDueTurn).not.toBeNull();
    expect((inn.spreadDueTurn ?? 0) - state.meta.turn).toBeLessThanOrEqual(ESPIONAGE_CUT_SEASONS);
  });
});
