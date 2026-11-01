import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { applyProposal } from "../engine/applyDelta";
import { WorldStateSchema, type WorldState } from "../engine/schema";
import { VassalRow } from "../ui/VassalRow";
import { proposalBlurb } from "../ui/ledgerCopy";
import { vassalFigures, vassalRowTitle } from "../ui/vassalsView";
import { canStrip } from "./ladder";
import { setHistoryContentForTests } from "./load";
import { historyPromptBlock } from "./promptBlocks";
import { demoteBy, forfeitFrom, promoteTo } from "./promotion";
import { runHistorySeasonPass } from "./season";
import {
  averageVassalMood,
  menAtMuster,
  moveVassalMood,
  noteBattleForVassals,
  noteVassalEvent,
  tickVassals,
  vassalMoodWord,
  vassalMusterLines,
  vassalsLine,
} from "./vassals";

/** Vassals (rank design 'Vassals'; 03_HISTORY §10a). */

function fresh(): WorldState {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

function count(): WorldState {
  const state = fresh();
  state.player.renown = 600;
  promoteTo(state, 3, { patron: "the king", turn: 40 });
  return state;
}

describe("vassal mood", () => {
  afterEach(() => setHistoryContentForTests(null));

  it("a villa lord has no one sworn; a count has ten men at the middle, each with a holding and a few men", () => {
    expect(fresh().history.vassals).toEqual([]);
    expect(averageVassalMood(fresh())).toBe(50);
    const state = count();
    const own = state.history.vassals.filter((v) => !v.group);
    expect(own).toHaveLength(10);
    for (const v of own) {
      expect(v.mood).toBe(50);
      expect(v.men).toBeGreaterThanOrEqual(2);
      expect(v.angrySince).toBeNull();
      expect(state.holdings.some((h) => h.name === v.holding)).toBe(false); // their own holdings, not the lord's villas
    }
    expect(vassalMoodWord(50)).toBe("steady");
    expect(vassalMoodWord(65)).toBe("content");
    expect(vassalMoodWord(34)).toBe("angry");
  });

  it("the engine's movers: victory, defeat, a call refused, a feast, a step up, a holding taken back", () => {
    const state = count();
    expect(noteVassalEvent(state, "victory", 41)).toBe("The sworn men: led to victory (+8).");
    expect(averageVassalMood(state)).toBe(58);
    noteVassalEvent(state, "defeat", 42);
    noteVassalEvent(state, "refused_call", 42);
    expect(averageVassalMood(state)).toBe(44);
    expect(state.history.vassals[0].lastReason).toBe("the lord did not answer the call");
    const one = state.history.vassals[0];
    expect(noteVassalEvent(state, "judged_for", 43, [one.id])).toBe(`${one.name}: judged in his favour (+6).`);
    expect(one.mood).toBe(50);
    expect(state.history.vassals[1].mood).toBe(44);
    // A lord raised up pleases the men already sworn; the new ones come in at the middle.
    promoteTo(state, 4, { patron: "the king", turn: 44 });
    expect(state.history.vassals[1].mood).toBe(49);
    expect(state.history.vassals.filter((v) => v.group).every((v) => v.mood === 50)).toBe(true);
    // Stripped: the men who stay are colder; the groups go with the counties.
    demoteBy(state, 1, { by: "the king", turn: 45 });
    expect(state.history.vassals.filter((v) => v.group)).toHaveLength(1);
    expect(state.history.vassals[1].mood).toBe(39);
    expect(state.history.vassals[1].lastReason).toBe("their lord stripped of his office");
  });

  it("a benefice taken back loses the men on it and sours the rest", () => {
    const state = count();
    const v = state.history.vassals[2];
    // Put one man on a villa the lord holds from the king, so the forfeit takes him with it.
    v.holding = state.holdings[3].name;
    const lost = forfeitFrom(state, "the king");
    expect(lost).toContain(state.holdings.length ? v.holding : v.holding);
    expect(state.history.vassals.some((x) => x.id === v.id)).toBe(false);
    expect(state.history.vassals[0].mood).toBe(45);
    expect(state.history.vassals[0].lastReason).toBe("a holding taken back");
  });

  it("men at muster: content men bring one more, angry men none; a county's lords a tenth of the levy by mood", () => {
    const state = count();
    const [a, b, c] = state.history.vassals;
    a.mood = 70;
    b.mood = 50;
    c.mood = 20;
    expect(menAtMuster(a)).toBe(a.men + 1);
    expect(menAtMuster(b)).toBe(b.men);
    expect(menAtMuster(c)).toBe(0);
    const muster = vassalMusterLines(state);
    expect(muster.stayed).toEqual([c.name]);
    const expected = state.history.vassals.reduce((n, v) => n + menAtMuster(v), 0);
    expect(muster.men).toBe(expected);
    expect(muster.lines[0].name).toBe("The sworn men");
    expect(muster.lines[0].sheetId).toBe("caballarii");
    expect(muster.lines.reduce((n, l) => n + l.overrides.strength, 0)).toBe(expected);
    for (const l of muster.lines) expect(l.overrides.strength).toBeLessThanOrEqual(30);
    promoteTo(state, 4, { patron: "the king", turn: 44 });
    const group = state.history.vassals.find((v) => v.group)!;
    expect(group.men).toBe(300);
    expect(menAtMuster(group)).toBe(Math.round(300 * 0.1 * 0.75));
    group.mood = 20;
    expect(menAtMuster(group)).toBe(12);
    const duke = vassalMusterLines(state);
    expect(duke.lines.filter((l) => l.sheetId === "pedites_fyrd")).toHaveLength(4);
    // After the field: those who rode follow the result; those left at home while the lord won feel it.
    expect(noteBattleForVassals(state, "victory", 45, true)).toContain("led to victory");
    expect(noteBattleForVassals(state, "draw", 45, true)).toContain("nothing to show");
    expect(noteBattleForVassals(state, "victory", 45, false)).toContain("left out");
    expect(noteBattleForVassals(state, "defeat", 45, false)).toBeNull();
  });

  it("moods fade toward the middle, and a man angry four seasons may go with his men and his benefice", () => {
    const state = count();
    const v = state.history.vassals[0];
    v.holding = state.holdings[1].name; // he holds one of the king's villas of the lord
    moveVassalMood(state, 30, "a gift", 40, [state.history.vassals[1].id]);
    moveVassalMood(state, -40, "judged against him", 40, [v.id]);
    expect(v.angrySince).toBe(40);
    const first = tickVassals(state, { year: 835, season: "spring" }, 41);
    expect(first.left).toEqual([]);
    expect(state.history.vassals[1].mood).toBe(79);
    expect(v.mood).toBe(11);
    // Not before four seasons; then a seeded quarter chance each season.
    let left: string[] = [];
    for (let turn = 42; turn <= 60 && !left.length; turn++) {
      const r = tickVassals(state, { year: 835 + Math.floor((turn - 41) / 4), season: "spring" }, turn);
      left = r.left;
      if (left.length) {
        expect(turn - 40).toBeGreaterThanOrEqual(4);
        expect(r.beats[0].npcId).toBe("steward");
        expect(r.beats[0].text).toContain(`${v.name} has taken his men and gone`);
        expect(r.beats[0].text).toContain("judged against him");
        expect(r.lines[0]).toContain(`and the villa of ${v.holding}`);
      }
    }
    expect(left).toEqual([v.name]);
    expect(state.history.vassals.some((x) => x.id === v.id)).toBe(false);
    expect(state.holdings.some((h) => h.name === v.holding)).toBe(false);
    expect(state.holdings).toHaveLength(11);
    expect(state.history.vassalsLost[0]).toMatchObject({ name: v.name, why: "judged against him" });
    expect(state.history.record.at(-1)?.text).toContain(`${v.name} left the lord's service`);
    // The mood recovers to the middle and stays; angrySince clears above the line.
    const w = state.history.vassals[0];
    w.mood = 34;
    tickVassals(state, { year: 840, season: "spring" }, 61);
    expect(w.mood).toBe(35);
    expect(w.angrySince).toBeNull();
  });

  it("the season pass runs the vassals' tick", () => {
    const state = count();
    state.history.vassals[0].mood = 80;
    runHistorySeasonPass(state, { year: 835, season: "spring" }, 41);
    expect(state.history.vassals[0].mood).toBe(79);
  });
});

describe("where vassal mood pays out", () => {
  it("a king cannot strip a lord whose sworn men are content, and need not wait for the people when they are angry", () => {
    const villa = fresh();
    villa.peopleHappiness = 20;
    expect(canStrip(villa)).toBe(true);
    const state = count();
    state.peopleHappiness = 20;
    expect(canStrip(state)).toBe(true);
    for (const v of state.history.vassals) v.mood = 70;
    expect(canStrip(state)).toBe(false);
    state.peopleHappiness = 80;
    for (const v of state.history.vassals) v.mood = 20;
    expect(canStrip(state)).toBe(true);
  });

  it("Aldric's vassal_mood proposal moves one man or all of them on Confirm, and reads as hall language on the card", () => {
    const state = count();
    const v = state.history.vassals[0];
    const one = applyProposal(state, { type: "vassal_mood", summary: "", vassalId: v.id, delta: 10, reason: "a horse given at the hall" }, "steward");
    expect(one.ok).toBe(true);
    expect(one.logLine).toBe(`${v.name} is warmer toward the lord: a horse given at the hall.`);
    expect(v.mood).toBe(60);
    expect(v.lastReason).toBe("a horse given at the hall");
    const all = applyProposal(state, { type: "vassal_mood", summary: "", vassalId: "all", delta: -5, reason: "service demanded with no reward" }, "steward");
    expect(all.ok).toBe(true);
    expect(v.mood).toBe(55);
    expect(state.history.vassals[1].mood).toBe(45);
    const bad = applyProposal(state, { type: "vassal_mood", summary: "", vassalId: "vassal_nobody", delta: 5, reason: "x" }, "steward");
    expect(bad.ok).toBe(false);
    expect(applyProposal(fresh(), { type: "vassal_mood", summary: "", vassalId: "all", delta: 5, reason: "x" }, "steward").ok).toBe(false);
    expect(applyProposal(state, { type: "vassal_mood", summary: "", vassalId: "all", delta: 5, reason: "x" }, "smith").ok).toBe(false);
    expect(proposalBlurb({ type: "vassal_mood", summary: "", vassalId: v.id, delta: 10, reason: "a horse given at the hall" }, state)).toBe(
      `Note in the books that ${v.name} is warmer toward the lord: a horse given at the hall.`,
    );
    expect(proposalBlurb({ type: "vassal_mood", summary: "", vassalId: "all", delta: -5, reason: "the levy" }, state)).toContain("the sworn men are colder");
  });

  it("Aldric's HISTORY block lists the men by id and mood and tells him when to propose", () => {
    const state = count();
    const v = state.history.vassals[0];
    v.mood = 70;
    v.lastReason = "a gift";
    const line = vassalsLine(state)!;
    expect(line).toContain(`${v.id}: ${v.name} of ${v.holding}, content (a gift), ${v.men} men`);
    expect(line).toContain("propose vassal_mood");
    expect(historyPromptBlock(state, "steward")).toContain("Sworn men (id: name, mood, men)");
    expect(historyPromptBlock(state, "chaplain")).not.toContain("Sworn men (id");
    expect(vassalsLine(fresh())).toBeNull();
  });
});

describe("the row of figures", () => {
  it("nothing for a villa lord; a figure per man up to twelve; at Duke the counties' lords and the three who matter", () => {
    expect(vassalFigures(fresh())).toEqual([]);
    expect(renderToStaticMarkup(createElement(VassalRow, { state: fresh() }))).toBe("");
    const state = count();
    state.history.vassals[0].mood = 70;
    state.history.vassals[1].mood = 20;
    state.history.vassals[1].lastReason = "judged against him";
    const figures = vassalFigures(state);
    expect(figures).toHaveLength(10);
    expect(figures[0].mood).toBe("content");
    expect(figures[1].mood).toBe("angry");
    expect(figures[1].title).toContain("angry");
    expect(figures[1].title).toContain("judged against him");
    const html = renderToStaticMarkup(createElement(VassalRow, { state }));
    expect(html.match(/vassal-figure/g)).toHaveLength(10);
    expect(html).toContain("vassal-content");
    expect(html).toContain("vassal-angry");
    expect(html).toContain(vassalRowTitle(state));
    expect(vassalRowTitle(state)).toBe("The sworn men: 10 sworn men (1 content, 1 angry)");
    promoteTo(state, 4, { patron: "the king", turn: 44 });
    const duke = vassalFigures(state);
    expect(duke.filter((f) => f.group)).toHaveLength(4);
    expect(duke.filter((f) => !f.group)).toHaveLength(3);
    expect(duke.find((f) => !f.group)?.id).toBe(state.history.vassals[1].id); // the angriest first
    expect(vassalRowTitle(state)).toContain("4 counties' lords");
    expect(renderToStaticMarkup(createElement(VassalRow, { state })).match(/vassal-group/g)).toHaveLength(4);
  });
});
