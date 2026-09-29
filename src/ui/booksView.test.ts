import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import startingEstate from "../../data/starting-estate.json";
import { archiveEstateSeason } from "../engine/estateBooks";
import { applyProposal } from "../engine/applyDelta";
import { labourPool, labourRemaining } from "../engine/labour";
import { WorldStateSchema, type Project, type WorldState } from "../engine/schema";
import { emptyMeter } from "../llm/usage";
import type { GameView } from "../shared/types";
import { BooksPanel } from "./BooksPanel";
import {
  BOOKS_TAB_LABELS,
  BOOKS_TABS,
  customsBookEntries,
  customsEmptyLines,
  estatePagerView,
  isBooksTab,
  labourBookEntries,
  laboursEmptyLine,
  selectBooksTab,
  stepEstateOffset,
} from "./booksView";

const JARGON = /\b(delta|schema|npc id|npcId|world-state|JSON|proj-|assign_labour)\b/i;

function estate(extra?: (s: WorldState) => void): WorldState {
  const state = WorldStateSchema.parse(structuredClone(startingEstate));
  extra?.(state);
  return state;
}

function viewOf(state: WorldState): GameView {
  return {
    state,
    pending: [],
    messages: [],
    sceneNpcId: "steward",
    labour: { pool: labourPool(state), remaining: labourRemaining(state) },
    smithAvailable: true,
    chaplainAvailable: true,
    merchantAvailable: false,
    sceneEmotion: "neutral",
    historyTail: [],
    llmMeter: emptyMeter("rfab"),
  };
}

function mill(partial: Partial<Project> = {}): Project {
  return {
    id: "proj-mill",
    key: "flour_mill",
    name: "Flour mill",
    holdingId: "fontenay",
    labourDaysRequired: 230,
    labourDaysDone: 120,
    materials: { lumber: 11, iron: 60, stone: 4 },
    materialsReserved: true,
    status: "active",
    startedYear: 825,
    startedSeason: "spring",
    seasonMarks: [
      { year: 825, season: "spring", labourDaysDone: 40 },
      { year: 825, season: "summer", labourDaysDone: 80 },
      { year: 825, season: "autumn", labourDaysDone: 120 },
    ],
    ...partial,
  };
}

const UNHIRED_NAMES = /\b(Eberhard|Otto|Ambrosius|Hildegard|Lorenzo|Colman|Haimo|Gerold|Hugo)\b/;

describe("arms at a new game", () => {
  it("does not name Eberhard or the other unhired posts in the books", () => {
    const view = viewOf(estate());
    for (const tab of BOOKS_TABS) {
      const html = renderToStaticMarkup(createElement(BooksPanel, { view, initialTab: tab }));
      expect(html).not.toMatch(UNHIRED_NAMES);
    }
    const estateHtml = renderToStaticMarkup(createElement(BooksPanel, { view, initialTab: "estate" }));
    expect(estateHtml).toContain("Arms");
    expect(estateHtml).toContain("No captain of the guard yet.");
    expect(estateHtml).not.toMatch(JARGON);
  });

  it("names the captain in Arms once he has been hired", () => {
    const state = estate();
    state.npcs.push({
      id: "captain",
      name: "Eberhard",
      role: "captain",
      location: "fontenay",
      notes: "",
      memories: [],
      wantsTalk: false,
    });
    const html = renderToStaticMarkup(createElement(BooksPanel, { view: viewOf(state), initialTab: "estate" }));
    expect(html).toContain("Eberhard is captain of the guard.");
    expect(html).not.toContain("No captain of the guard yet.");
  });
});

describe("books tabs", () => {
  it("names the three tabs in hall language", () => {
    expect([...BOOKS_TABS]).toEqual(["estate", "labours", "customs"]);
    expect(BOOKS_TAB_LABELS.estate).toBe("Estate");
    expect(BOOKS_TAB_LABELS.labours).toBe("Labours");
    expect(BOOKS_TAB_LABELS.customs).toBe("Customs");
    expect(isBooksTab("estate")).toBe(true);
    expect(isBooksTab("ledger")).toBe(false);
    expect(selectBooksTab("estate", "labours")).toBe("labours");
    expect(selectBooksTab("labours", "customs")).toBe("customs");
    expect(selectBooksTab("customs", "not-a-tab")).toBe("customs");
    expect(JSON.stringify(BOOKS_TAB_LABELS)).not.toMatch(JARGON);
  });
});

describe("estate season pager", () => {
  it("defaults estate_history to empty on a fresh estate with no field in the json", () => {
    expect("estate_history" in startingEstate).toBe(false);
    expect(estate().estate_history).toEqual([]);
  });

  it("hides forward on this season and pages back to real prior figures", () => {
    const live = estate();
    live.resources.denarii = 70;
    live.meta.season = "autumn";
    live.meta.turn = 3;
    const spring = estate();
    spring.resources.denarii = 96;
    archiveEstateSeason(live, spring);
    const summer = estate();
    summer.meta.season = "summer";
    summer.meta.turn = 2;
    summer.resources.denarii = 88;
    archiveEstateSeason(live, summer);

    const now = estatePagerView(viewOf(live), 0);
    expect(now.viewingCurrent).toBe(true);
    expect(now.showForward).toBe(false);
    expect(now.canGoForward).toBe(false);
    expect(now.canGoBack).toBe(true);
    expect(now.label).toBe("Autumn 825");
    expect(now.source?.resources.denarii).toBe(70);
    expect(now.hint).toMatch(/this season/i);
    expect(now.hint).not.toMatch(JARGON);

    const backOne = estatePagerView(viewOf(live), stepEstateOffset(0, live.estate_history.length, true));
    expect(backOne.viewingCurrent).toBe(false);
    expect(backOne.showForward).toBe(true);
    expect(backOne.canGoForward).toBe(true);
    expect(backOne.label).toBe("Summer 825");
    expect(backOne.source?.resources.denarii).toBe(88);
    expect(backOne.source?.resources.denarii).not.toBe(70);
    expect(backOne.hint).toMatch(/as the books stood/i);

    const backTwo = estatePagerView(viewOf(live), 2);
    expect(backTwo.label).toBe("Spring 825");
    expect(backTwo.source?.resources.denarii).toBe(96);
    expect(backTwo.canGoBack).toBe(false);

    const towardNow = estatePagerView(viewOf(live), stepEstateOffset(2, live.estate_history.length, false));
    expect(towardNow.label).toBe("Summer 825");
  });

  it("does not invent a prior season when none was kept", () => {
    const fresh = estatePagerView(viewOf(estate()), 1);
    expect(fresh.viewingCurrent).toBe(true);
    expect(fresh.showForward).toBe(false);
    expect(fresh.canGoBack).toBe(false);
    expect(fresh.label).toBe("Spring 825");
    expect(fresh.source?.resources.denarii).toBe(96);
    expect(fresh.hint).toMatch(/not yet kept/i);
  });
});

describe("labours list", () => {
  it("lists multi-season work with recorded progress across seasons", () => {
    const state = estate((s) => {
      s.meta.season = "winter";
      s.projects.push(mill());
      s.projects.push({
        id: "proj-scrub",
        key: "clear_scrub",
        name: "Clear scrub",
        holdingId: "fontenay",
        labourDaysRequired: 35,
        labourDaysDone: 35,
        materials: { lumber: 0.5, iron: 4, stone: 0 },
        materialsReserved: true,
        status: "completed",
        startedYear: 825,
        startedSeason: "spring",
        completedYear: 825,
        completedSeason: "summer",
        seasonMarks: [
          { year: 825, season: "spring", labourDaysDone: 20 },
          { year: 825, season: "summer", labourDaysDone: 35 },
        ],
      });
    });
    const entries = labourBookEntries(state);
    expect(laboursEmptyLine(entries)).toBeNull();
    const millEntry = entries.find((e) => e.name === "Flour mill");
    expect(millEntry?.statusLine).toBe("Underway");
    expect(millEntry?.progressLine).toMatch(/half raised/);
    expect(millEntry?.spanLine).toMatch(/Begun Spring 825/);
    expect(millEntry?.spanLine).toMatch(/three seasons of work/);
    expect(millEntry?.marks.map((m) => m.label)).toEqual(["Spring 825", "Summer 825", "Autumn 825"]);
    expect(millEntry?.marks[0].progress).toMatch(/begun|not yet begun/);
    expect(millEntry?.marks[2].progress).toMatch(/half raised/);
    expect([millEntry?.statusLine, millEntry?.progressLine, millEntry?.spanLine, millEntry?.handsLine, ...(millEntry?.marks ?? []).flatMap((m) => [m.label, m.progress])].join("\n")).not.toMatch(JARGON);

    const scrub = entries.find((e) => e.name === "Clear scrub");
    expect(scrub?.statusLine).toBe("Finished");
    expect(scrub?.spanLine).toMatch(/finished Summer 825/);
    expect(entries.findIndex((e) => e.name === "Flour mill")).toBeLessThan(entries.findIndex((e) => e.name === "Clear scrub"));
  });

  it("does not invent a beginning when the books never recorded one", () => {
    const state = estate((s) => {
      s.projects.push({
        id: "old-barn",
        key: "large_barn",
        name: "Large barn",
        holdingId: "fontenay",
        labourDaysRequired: 160,
        labourDaysDone: 10,
        materials: { lumber: 14, iron: 30, stone: 2.5 },
        materialsReserved: true,
        status: "active",
      });
    });
    const [entry] = labourBookEntries(state);
    expect(entry.spanLine).toMatch(/not in these books/i);
    expect(entry.marks).toEqual([]);
    expect(entry.progressLine).toMatch(/begun|not yet begun/);
  });
});

describe("customs list", () => {
  it("reads standing orders from the books, not from chat", () => {
    const state = estate();
    const { forthcoming, orders, laws } = customsBookEntries(state);
    expect(forthcoming).toEqual([]);
    expect(orders).toHaveLength(1);
    expect(orders[0].body).toMatch(/two-field rotation/);
    expect(orders[0].lasting).toBe(true);
    expect(customsEmptyLines({ forthcoming, orders, laws }).orders).toBeNull();
    expect(customsEmptyLines({ forthcoming, orders, laws }).forthcoming).toMatch(/no forthcoming order/i);
    expect(customsEmptyLines({ forthcoming, orders, laws }).laws).toMatch(/no lasting custom/i);
    expect(orders[0].body).not.toMatch(JARGON);
    expect(orders[0].title).not.toMatch(JARGON);
  });

  it("lists a confirmed lasting custom after it is written", () => {
    const state = estate();
    const written = applyProposal(
      state,
      {
        type: "add_modifier",
        summary: "Sunday rest",
        target: "custom",
        kind: "permanent",
        effect: { op: "set", value: 1 },
        source: "Keep the Lord's day",
        customNote: "No heavy labour on Sunday.",
      },
      "steward",
    );
    expect(written.ok).toBe(true);
    const { laws } = customsBookEntries(state);
    expect(laws).toHaveLength(1);
    expect(laws[0].lasting).toBe(true);
    expect(laws[0].title).toBe("A lasting custom");
    expect(laws[0].body).toMatch(/Keep the Lord's day|No heavy labour on Sunday/);
    expect(laws[0].body).not.toMatch(JARGON);
  });

  it("lists a confirmed forthcoming order while it waits", () => {
    const state = estate();
    const parked = applyProposal(
      state,
      {
        type: "defer_proposal",
        summary: "After this harvest: three-field rotation on the ploughland.",
        beat: "after_harvest",
        text: "After this harvest: three-field rotation on the ploughland.",
        proposal: {
          type: "adjust_sowing",
          summary: "Keep a three-field rotation.",
          holdingId: "fontenay",
          rotation: "three_field",
        },
      },
      "steward",
    );
    expect(parked.ok).toBe(true);
    const { forthcoming } = customsBookEntries(state);
    expect(forthcoming).toHaveLength(1);
    expect(forthcoming[0].title).toBe("An order yet to be kept");
    expect(forthcoming[0].body).toMatch(/After this harvest: three-field rotation/);
    expect(forthcoming[0].body).not.toMatch(JARGON);
    expect(JSON.stringify(forthcoming)).not.toMatch(/defer_proposal/);
  });

  it("paints Forthcoming on the Customs tab with a strike control", () => {
    const state = estate();
    applyProposal(
      state,
      {
        type: "defer_proposal",
        summary: "After this harvest: three-field rotation on the ploughland.",
        beat: "after_harvest",
        text: "After this harvest: three-field rotation on the ploughland.",
        proposal: {
          type: "adjust_sowing",
          summary: "Keep a three-field rotation.",
          holdingId: "fontenay",
          rotation: "three_field",
        },
      },
      "steward",
    );
    const html = renderToStaticMarkup(
      createElement(BooksPanel, {
        view: viewOf(state),
        initialTab: "customs",
        onCancelForthcoming: () => undefined,
      }),
    );
    expect(html).toContain("Forthcoming");
    expect(html).toContain("An order yet to be kept");
    expect(html).toMatch(/After this harvest:/);
    expect(html).toMatch(/three-field rotation/);
    expect(html).toContain("Strike it");
    expect(html).toContain("Estate");
    expect(html).toContain("Labours");
    expect(html).toContain("Customs");
    expect(html).not.toMatch(JARGON);
  });
});
