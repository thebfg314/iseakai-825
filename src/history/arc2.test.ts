import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { applyProposal } from "../engine/applyDelta";
import { WorldStateSchema, type WorldState } from "../engine/schema";
import { lintHistoryStructure } from "./lint";
import { historyContent } from "./load";
import { historyPromptBlock } from "./promptBlocks";
import { runHistorySeasonPass, type HistoryPassResult } from "./season";

/** Arc 2 against the shipped content: oaths of 840, Fontenoy, Verdun, Toulouse, Bernard's end. */

function fresh(): WorldState {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

const ORDER = ["spring", "summer", "autumn", "winter"] as const;
type Season = (typeof ORDER)[number];

function clockFor(state: WorldState) {
  const next = (): HistoryPassResult => {
    const i = ORDER.indexOf(state.meta.season);
    const incoming = i === 3 ? { year: state.meta.year + 1, season: ORDER[0] } : { year: state.meta.year, season: ORDER[i + 1] };
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
const judge = (state: WorldState, eventId: string, outcomeId: string) =>
  applyProposal(state, { type: "history_outcome", summary: "", eventId, outcomeId }, "referee");

/** Keep the manses by taking the church out in 830, so later tests are not about the seizure. */
function settled830(state: WorldState) {
  const clock = clockFor(state);
  clock.to(830, "autumn");
  hook(state, "830-L1", "church_fixed", "chaplain");
  return clock;
}

describe("Arc 2 content", () => {
  it("passes the structural lint", () => {
    const content = historyContent();
    expect(lintHistoryStructure(content)).toEqual([]);
    expect(content.events.filter((e) => String(e.arc) === "2").length).toBeGreaterThanOrEqual(15);
  });

  it("840: the emperor's death and Lothair's envoy share the autumn; refusing is the default", () => {
    const state = fresh();
    const clock = settled830(state);
    clock.to(840, "summer");
    const autumn = clock.next();
    expect(autumn.fired).toEqual(["840-02", "840-03"]);
    const t = texts(autumn);
    expect(t.some((x) => x.startsWith("My lord, the emperor is dead."))).toBe(true);
    expect(t.some((x) => x.startsWith("(Lothair's envoy, in the hall) The emperor Lothair greets"))).toBe(true);
    expect(t.some((x) => x.includes("third voice"))).toBe(false);
    expect(state.history.realm.emperor).toBe("Lothair");
    const block = historyPromptBlock(state, "steward");
    expect(block).toContain("OPEN CHOICE");
    expect(block).toContain("swear_lothair");
    clock.next();
    expect(state.history.chosen["840-03"]).toBe("refuse");
    expect(state.history.flags.oath_charles_840).toBe(true);
  });

  it("841: the summons, Fontenoy as an interim line with the lord away, the report with the relief-column line", () => {
    const state = fresh();
    const clock = settled830(state);
    clock.to(840, "winter");
    const spring = clock.next();
    expect(spring.fired).toEqual(["N-841", "841-01"]);
    const summer = clock.next();
    expect(state.history.chosen["841-01"]).toBe("answer");
    expect(summer.fired).toEqual(["N-841-S", "841-02", "841-V1"]);
    expect(texts(summer).some((x) => x.includes("not yet written in this chronicle"))).toBe(true);
    expect(state.history.away?.reason).toContain("Auxerre");
    expect(state.history.supply.lastRoll?.situation).toBe("foraging");
    expect(summer.refereeLines.some((l) => l.includes("rode out for 841-02"))).toBe(true);
    const autumn = clock.next();
    expect(state.history.away).toBeNull();
    expect(autumn.fired).toEqual(["N-841-A", "841-03"]);
    expect(texts(autumn).some((x) => x.includes("relief") || x.includes("Count Warin's column are spoken of with pride"))).toBe(true);
    expect(autumn.beats.some((b) => b.npcId === "chaplain" && b.text.startsWith("The bishops have ordered three days"))).toBe(true);
    expect(state.history.supply.lastRoll?.situation).toBe("deserters");
  });

  it("841: paying the fine keeps the lord home for the foragers; a man of Bernard's can sit in his camp", () => {
    const home = fresh();
    const c1 = settled830(home);
    c1.to(841, "spring");
    home.resources.denarii = 1000;
    expect(choose(home, "841-01", "pay_fine").ok).toBe(true);
    expect(home.resources.denarii).toBe(280);
    expect(home.history.flags.heribannum_paid).toBe(1);
    const summer = c1.next();
    expect(summer.fired).toEqual(["N-841-S", "841-H1", "841-V1"]);
    expect(home.history.away).toBeNull();

    const bern = fresh();
    const c2 = settled830(bern); // stay_loyal by default → oath_kept_lord
    c2.to(841, "spring");
    expect(choose(bern, "841-01", "bernard_camp").ok).toBe(true);
    const s2 = c2.next();
    expect(s2.fired).toEqual(["N-841-S", "841-02B", "841-V1"]);
    expect(hook(bern, "841-02B", "urge_bernard").ok).toBe(true);
    const a2 = c2.next();
    expect(texts(a2).some((x) => x.includes("it was you who turned him"))).toBe(true);
  });

  it("842–843: the talks, Verdun as a fixed point, Coulaines; the Toulouse summons offers Bernard's road only to his men", () => {
    const state = fresh();
    const clock = settled830(state);
    clock.to(842, "spring");
    const summer842 = clock.next();
    expect(summer842.fired).toEqual(["842-02"]);
    state.resources.wheat = 50;
    const coin = state.resources.denarii;
    expect(hook(state, "842-02", "supply_camps").ok).toBe(true);
    expect(state.resources.denarii).toBe(coin + 80);
    expect(state.history.land.visibility).toBeGreaterThanOrEqual(15);
    clock.to(843, "winter");
    expect(state.history.fired["843-02"]).toBeDefined();
    expect(state.history.record.some((r) => r.text.includes("Verdun"))).toBe(true);
    expect(state.history.fired["843-03"]).toBeDefined();
  });

  it("843-01 defaults to Warin even for Bernard's man; 844 ends with Bernard dead unless judged otherwise", () => {
    const state = fresh();
    const clock = settled830(state);
    clock.to(843, "spring");
    const summer843 = clock.next();
    expect(state.history.chosen["843-01"]).toBe("warin");
    expect(summer843.fired).toEqual(["843-B1"]);
    expect(state.history.away?.reason).toContain("Gothia");
    clock.to(843, "winter");
    const spring844 = clock.next();
    expect(spring844.fired).toEqual(["844-B1", "844-F1"]);
    expect(state.history.openOutcomes.some((o) => o.eventId === "844-F1")).toBe(true);
    // the referee may only pick outcomes the lord's road allows
    const renown = state.player.renown;
    state.player.renown = 10;
    expect(judge(state, "844-F1", "interceded").ok).toBe(false); // renown too low
    state.player.renown = renown;
    expect(judge(state, "844-F1", "let_slip").ok).toBe(true);
    expect(state.history.flags.bernard_saved).toBe(true);
    const summer844 = clock.next();
    expect(summer844.fired).toEqual(["844-01S", "C-844"]);
    expect(state.history.dropped).toContain("844-01");

    const dead = fresh();
    const c2 = settled830(dead);
    c2.to(844, "spring");
    const s = c2.next();
    expect(dead.history.outcomes["844-F1"]).toBe("executed");
    expect(s.fired).toEqual(["844-01", "C-844"]);
    expect(texts(s).some((x) => x.startsWith("My lord, Bernard is dead."))).toBe(true);
    expect(texts(s).some((x) => x.includes("Dhuoda"))).toBe(true); // oath_kept_lord
    expect(hook(dead, "844-01", "befriend_dhuoda").ok).toBe(true);
    const autumn844 = c2.next();
    expect(autumn844.fired).toEqual(["844-02"]);
  });
});
