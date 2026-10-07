import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { defaultAppSettings } from "../llm/settings";
import { GameController } from "../session/game";
import { loadWorldState } from "./state";
import { WorldStateSchema } from "./schema";
import { TutorialOverlay, TutorialProse, placeTutorialBox } from "../ui/TutorialOverlay";
import { GlossaryProvider } from "../ui/GlossaryText";
import {
  TUTORIAL_LINES,
  TUTORIAL_OFFER,
  TUTORIAL_STEPS,
  isLastTutorialStep,
  nextTutorialState,
  tutorialAwaitingReply,
  tutorialEntryFrom,
  tutorialEntryUpdate,
  tutorialNextHint,
  tutorialProgressLabel,
  tutorialStep,
  tutorialStepSatisfied,
  tutorialWaitingNote,
  type TutorialWatch,
} from "./tutorial";

function boot() {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

function watch(partial: Partial<TutorialWatch> = {}): TutorialWatch {
  return { sceneNpcId: "steward", messages: [], pendingCount: 0, turn: 1, busy: false, ...partial };
}

const npc = (npcId: string) => ({ role: "npc" as const, npcId });
const player = () => ({ role: "player" as const, npcId: undefined });

describe("the opening tutorial script", () => {
  it("follows the script: seven sections, four lines to say, each addressed to the right speaker", () => {
    const sections = [...new Set(TUTORIAL_STEPS.map((s) => s.section))];
    expect(sections).toHaveLength(7);
    expect(sections[0]).toMatch(/Aldric: the Three-Field Rotation/);
    expect(sections[6]).toMatch(/Wrapping Up/);
    const says = TUTORIAL_STEPS.filter((s) => s.say).map((s) => s.say!);
    expect(says.map((s) => s.npcId)).toEqual(["steward", "smith", "steward", "negotiator", "chaplain"]);
    expect(says[0].text).toBe(TUTORIAL_LINES.rotation);
    expect(says[1].text).toMatch(/heavy mouldboard plough/);
    expect(says[3].text).toMatch(/10 pounds of iron/);
    expect(says[4].text).toMatch(/Easter/);
    expect(TUTORIAL_STEPS.map((s) => s.id)).toEqual([...new Set(TUTORIAL_STEPS.map((s) => s.id))]);
    expect(tutorialProgressLabel(0)).toBe("Section 1 of 7");
    expect(tutorialProgressLabel(TUTORIAL_STEPS.length - 1)).toBe("Section 7 of 7");
    expect(isLastTutorialStep(TUTORIAL_STEPS.length - 1)).toBe(true);
    expect(tutorialStep(999).id).toBe("wrap");
    expect(tutorialStep(-3).id).toBe("aldric-intro");
  });

  it("every step is moved by the game, and each says what it is waiting for", () => {
    for (const step of TUTORIAL_STEPS) {
      expect(step.advance, step.id).toBeDefined();
      expect(tutorialNextHint(step), step.id).toMatch(/^(Moves on|Ends) when /);
    }
    expect(tutorialNextHint(tutorialStep(1))).toBe("Moves on when Aldric answers.");
    expect(tutorialNextHint(TUTORIAL_STEPS.find((s) => s.id === "bernard-tab")!)).toBe("Moves on when you open Bernard's tab.");
  });

  it("the first step moves on when the lord speaks; the books step when Aldric answers", () => {
    const first = tutorialStep(0);
    const arrived = watch({ messages: [npc("steward")] });
    const entry = tutorialEntryFrom(arrived);
    expect(tutorialStepSatisfied(first, entry, arrived)).toBe(false);
    const spoke = watch({ messages: [npc("steward"), player()], busy: true });
    expect(tutorialStepSatisfied(first, entry, spoke)).toBe(true);
    expect(nextTutorialState({ status: "active", step: 0 }, first)).toEqual({ status: "active", step: 1 });

    // The books are read while Aldric drafts; the box moves on by itself when he answers.
    const books = tutorialStep(1);
    expect(books.waitFor).toBe("steward");
    const booksEntry = tutorialEntryFrom(spoke);
    expect(tutorialStepSatisfied(books, booksEntry, spoke)).toBe(false);
    const stillThinking = watch({ messages: [npc("steward"), player(), npc("steward")], busy: true });
    expect(tutorialStepSatisfied(books, booksEntry, stillThinking)).toBe(false);
    const answered = watch({ messages: [npc("steward"), player(), npc("steward")], pendingCount: 1 });
    expect(tutorialStepSatisfied(books, booksEntry, answered)).toBe(true);
    expect(tutorialWaitingNote("steward")).toBe("Waiting on Aldric…");
  });

  it("a reply step needs the lord's own line after arrival, then the speaker's answer", () => {
    const bernard = TUTORIAL_STEPS.find((s) => s.id === "bernard-line")!;
    // Arrive with Bernard's hello already on the scene: that is not an answer.
    const arrived = watch({ sceneNpcId: "smith", messages: [npc("smith")] });
    const entry = tutorialEntryFrom(arrived);
    expect(tutorialStepSatisfied(bernard, entry, arrived)).toBe(false);
    expect(tutorialAwaitingReply(bernard, entry, arrived)).toBe(false);

    const sent = watch({ sceneNpcId: "smith", messages: [npc("smith"), player()], busy: true });
    expect(tutorialAwaitingReply(bernard, entry, sent)).toBe(true);
    expect(tutorialStepSatisfied(bernard, entry, sent)).toBe(false);

    const answered = watch({ sceneNpcId: "smith", messages: [npc("smith"), player(), npc("smith")] });
    expect(tutorialAwaitingReply(bernard, entry, answered)).toBe(false);
    expect(tutorialStepSatisfied(bernard, entry, answered)).toBe(true);
  });

  it("re-bases the message count when the lord changes speaker mid-step", () => {
    const bernard = TUTORIAL_STEPS.find((s) => s.id === "bernard-line")!;
    // Pressed Next while still with Aldric (three messages), then opened Bernard (one hello).
    const onAldric = watch({ sceneNpcId: "steward", messages: [npc("steward"), player(), npc("steward")] });
    let entry = tutorialEntryFrom(onAldric);
    const onBernard = watch({ sceneNpcId: "smith", messages: [npc("smith")] });
    entry = tutorialEntryUpdate(entry, onBernard);
    expect(entry.messageScene).toBe("smith");
    expect(entry.messageCount).toBe(1);
    const answered = watch({ sceneNpcId: "smith", messages: [npc("smith"), player(), npc("smith")] });
    expect(tutorialStepSatisfied(bernard, entry, answered)).toBe(true);
  });

  it("a scene step is satisfied whenever that tab is open, so it can never strand the lord", () => {
    const tab = TUTORIAL_STEPS.find((s) => s.id === "clearing-tab")!;
    const fromBernard = tutorialEntryFrom(watch({ sceneNpcId: "smith" }));
    expect(tutorialStepSatisfied(tab, fromBernard, watch({ sceneNpcId: "smith" }))).toBe(false);
    expect(tutorialStepSatisfied(tab, fromBernard, watch({ sceneNpcId: "steward" }))).toBe(true);
    // Confirmed Bernard's work while already back with Aldric: the step passes on arrival.
    const alreadyThere = tutorialEntryFrom(watch({ sceneNpcId: "steward" }));
    expect(tutorialStepSatisfied(tab, alreadyThere, watch({ sceneNpcId: "steward" }))).toBe(true);
  });

  it("an approve step moves on when the table is clear — confirmed, denied, or nothing proposed", () => {
    const approve = TUTORIAL_STEPS.find((s) => s.id === "aldric-approve")!;
    const withCard = tutorialEntryFrom(watch({ pendingCount: 1 }));
    expect(tutorialStepSatisfied(approve, withCard, watch({ pendingCount: 1 }))).toBe(false);
    expect(tutorialStepSatisfied(approve, withCard, watch({ pendingCount: 0, busy: true }))).toBe(false);
    expect(tutorialStepSatisfied(approve, withCard, watch({ pendingCount: 0 }))).toBe(true);
    // The speaker answered without proposing anything: there is nothing to approve, so it passes.
    const empty = tutorialEntryFrom(watch({ pendingCount: 0 }));
    expect(tutorialStepSatisfied(approve, empty, watch({ pendingCount: 0 }))).toBe(true);
  });

  it("the last step finishes on Advance season", () => {
    const wrap = tutorialStep(TUTORIAL_STEPS.length - 1);
    expect(wrap.anchor).toBe("advance-season");
    const entry = tutorialEntryFrom(watch({ turn: 1 }));
    expect(tutorialStepSatisfied(wrap, entry, watch({ turn: 1 }))).toBe(false);
    expect(tutorialStepSatisfied(wrap, entry, watch({ turn: 2 }))).toBe(true);
    expect(nextTutorialState({ status: "active", step: TUTORIAL_STEPS.length - 1 }, wrap)).toEqual({
      status: "done",
      step: TUTORIAL_STEPS.length - 1,
    });
  });
});

describe("tutorial in the save", () => {
  it("a fresh estate is offered the tutorial; an older save is not interrupted", () => {
    expect(boot().tutorial).toEqual({ status: "offered", step: 0 });
    const old = structuredClone(startingEstate) as Record<string, unknown>;
    delete old.tutorial;
    expect(WorldStateSchema.parse(old).tutorial).toEqual({ status: "declined", step: 0 });
  });

  it("progress is written to the save and comes back on load", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isekai-tutorial-"));
    const game = new GameController(boot(), dir, defaultAppSettings());
    expect(game.setTutorial({ status: "active", step: 4 })).toEqual({ status: "active", step: 4 });
    expect(game.setTutorial({ step: 5.7 })).toEqual({ status: "active", step: 5 });
    expect(game.setTutorial({ status: "done" })).toEqual({ status: "done", step: 5 });
    const reloaded = loadWorldState(path.join(dir, "world-state.json"));
    expect(reloaded.tutorial).toEqual({ status: "done", step: 5 });
  });
});

describe("tutorial boxes", () => {
  const viewport = { width: 1400, height: 900 };
  const box = { width: 400, height: 300 };

  it("sits below a tab at the top with the arrow pointing up at it", () => {
    const p = placeTutorialBox({ top: 60, left: 100, width: 120, height: 30 }, box, viewport);
    expect(p.arrow).toBe("up");
    expect(p.top).toBeGreaterThan(90);
    expect(p.spot).toMatchObject({ top: 54, left: 94, width: 132, height: 42 });
    // Arrow sits under the tab's centre (x = 160).
    expect(p.left + p.arrowOffset).toBe(160);
  });

  it("sits above the composer at the bottom with the arrow pointing down", () => {
    const p = placeTutorialBox({ top: 820, left: 0, width: 800, height: 70 }, box, viewport);
    expect(p.arrow).toBe("down");
    expect(p.top + box.height).toBeLessThan(820);
  });

  it("goes to the side when neither above nor below fits, and never leaves the viewport", () => {
    const p = placeTutorialBox({ top: 100, left: 0, width: 700, height: 700 }, box, viewport);
    expect(p.arrow).toBe("left");
    expect(p.left).toBeGreaterThan(700);
    expect(p.left + box.width).toBeLessThanOrEqual(viewport.width);
    const tight = placeTutorialBox({ top: 100, left: 0, width: 1390, height: 790 }, box, viewport);
    expect(tight.top).toBeGreaterThanOrEqual(8);
    expect(tight.top + box.height).toBeLessThanOrEqual(viewport.height);
  });

  it("tries the step's preferred side first, so the Books box sits beside the panel and leaves it readable", () => {
    // The Books panel is the right-hand column; the tutorial lights the whole panel and wants the box to its left.
    const books = { top: 60, left: 900, width: 480, height: 820 };
    const p = placeTutorialBox(books, box, viewport, "left");
    expect(p.arrow).toBe("right");
    expect(p.left + box.width).toBeLessThan(books.left);
    expect(p.spot).toMatchObject({ left: 894, width: 492 });
    // Arrow points at the panel's vertical centre (y = 470).
    expect(p.top + p.arrowOffset).toBe(470);

    // A preferred side that does not fit falls back to the usual order.
    const tab = { top: 60, left: 100, width: 120, height: 30 };
    expect(placeTutorialBox(tab, box, viewport, "left").arrow).toBe("up");

    const step = TUTORIAL_STEPS.find((s) => s.id === "books")!;
    expect(step).toMatchObject({ anchor: "books-panel", side: "left" });
  });

  it("centres when there is nothing to point at", () => {
    const p = placeTutorialBox(null, box, viewport);
    expect(p).toMatchObject({ arrow: "none", spot: null, top: 300, left: 500 });
  });

  it("offers the tutorial with Yes and No, and renders bullets as a list", () => {
    const html = renderToStaticMarkup(
      createElement(
        GlossaryProvider,
        null,
        createElement(TutorialOverlay, {
          tutorial: { status: "offered", step: 0 },
          watch: watch(),
          onChange: () => {},
          onSay: () => {},
        }),
      ),
    );
    expect(html).toContain(TUTORIAL_OFFER);
    expect(html).toContain(">Yes<");
    expect(html).toContain(">No<");

    const prose = renderToStaticMarkup(
      createElement(GlossaryProvider, null, createElement(TutorialProse, { paragraphs: tutorialStep(1).paragraphs })),
    );
    expect(prose).toContain("<ul>");
    expect(prose.match(/<li>/g)).toHaveLength(4);
    expect(prose).toContain("Labours");

    const declined = renderToStaticMarkup(
      createElement(TutorialOverlay, { tutorial: { status: "declined", step: 0 }, watch: watch(), onChange: () => {}, onSay: () => {} }),
    );
    expect(declined).toBe("");
  });
});
