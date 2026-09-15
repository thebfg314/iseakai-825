import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { labourPool, labourRemaining } from "../engine/labour";
import { WorldStateSchema } from "../engine/schema";
import { emptyMeter } from "../llm/usage";
import type { GameView } from "../shared/types";
import { App } from "./App";
import { BooksPanel } from "./BooksPanel";
import { BOOKS_TAB_LABELS, BOOKS_TABS, estatePagerView } from "./booksView";

function freshView(): GameView {
  const state = WorldStateSchema.parse(structuredClone(startingEstate));
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

describe("fresh boot UI", () => {
  it("loads App and paints the title screen without a saved game", () => {
    const html = renderToStaticMarkup(createElement(App));
    expect(html).toContain("title-screen");
    expect(html).toContain("New Game");
    expect(html).toContain("Load Game");
    expect(html).toContain("Isekai in the year of our lord 825");
    expect(html).not.toContain("Opening the estate books");
    expect(html).not.toContain("Villa of Fontenay");
    expect(html).not.toContain("People's happiness");
    expect(html).not.toContain("happiness-meter");
  });

  it("mounts BooksPanel on a fresh estate with empty history and the three tabs", () => {
    const view = freshView();
    expect(view.state.estate_history).toEqual([]);
    const pager = estatePagerView(view, 0);
    expect(pager.viewingCurrent).toBe(true);
    expect(pager.source?.resources.denarii).toBe(96);

    const html = renderToStaticMarkup(createElement(BooksPanel, { view }));
    expect(html).toContain("The books");
    for (const tab of BOOKS_TABS) {
      expect(html).toContain(BOOKS_TAB_LABELS[tab]);
    }
    expect(html).toContain("Spring 825");
    expect(html).toContain("this season");
    expect(html).toContain("Earlier seasons are not yet kept");
  });
});
