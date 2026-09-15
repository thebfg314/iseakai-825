import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ABANDONED_GAME_OVER } from "../engine/peopleMovement";
import { EmptyVillaScreen, EMPTY_VILLA_TITLE } from "./emptyVilla";

describe("empty villa", () => {
  it("shows hall words and a title-screen return, not engine jargon", () => {
    const html = renderToStaticMarkup(
      createElement(EmptyVillaScreen, { onTitle: () => {}, onNewGame: () => {} }),
    );
    expect(html).toContain("title-screen");
    expect(html).toContain(EMPTY_VILLA_TITLE);
    expect(html).toContain(ABANDONED_GAME_OVER);
    expect(html).toContain("Title");
    expect(html).toContain("New Game");
    expect(html).not.toMatch(/peopleHappiness|estateAbandoned|settle_households|gameOver/i);
    expect(EMPTY_VILLA_TITLE).not.toMatch(/game over|defeat/i);
  });
});
