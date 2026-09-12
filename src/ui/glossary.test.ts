import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { HOUSEHOLD_INTROS, MERCHANT_INTROS } from "../engine/intros";
import { CHECK_RECORDS_LINE, RECALL_DEALS_LINE } from "../llm/toolProtocol";
import { labourPool, labourRemaining } from "../engine/labour";
import { WorldStateSchema } from "../engine/schema";
import { emptyMeter } from "../llm/usage";
import type { GameView } from "../shared/types";
import { BooksPanel } from "./BooksPanel";
import {
  GLOSSARY_ENTRIES,
  GLOSSARY_OMIT,
  findGlossaryHits,
  glossaryEntry,
  omitRanges,
} from "./glossary";
import { GlossaryPopover, GlossaryProvider, GlossaryText } from "./GlossaryText";

const REQUIRED_IDS = [
  "missus",
  "manses",
  "modii",
  "denarii",
  "demesne",
  "pagus",
  "cell",
  "pannage",
  "bloomery",
  "mill_leat",
  "two_field",
  "villa",
  "waste",
  "scrub",
  "marling",
  "reeve",
  "oratory",
  "cell_saint_martin",
  "feast_days",
  "francia",
  "carolingian",
  "louis_the_pious",
  "alemannic",
  "lombard",
  "frank",
  "tithe",
  "renders",
  "standing_order",
  "lasting_custom",
  "hunt",
  "hides",
  "muster",
  "prior",
  "hall",
] as const;

function ids(text: string, ctx?: Parameters<typeof findGlossaryHits>[1]): string[] {
  return findGlossaryHits(text, ctx).map((h) => h.id);
}

function viewOf(): GameView {
  const state = WorldStateSchema.parse(structuredClone(startingEstate));
  return {
    state,
    pending: [],
    messages: [
      {
        id: "b1",
        role: "npc",
        npcId: "steward",
        npcName: "Aldric",
        text: "A missus is asking after the demesne, my lord — forty modii and the pagus will hear of it.",
        at: "825-03-01T00:00:00.000Z",
      },
    ],
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

describe("glossary dictionary", () => {
  it("keeps every signed-off term and omits mill-forge tech explainers", () => {
    expect(GLOSSARY_ENTRIES.map((e) => e.id).sort()).toEqual([...REQUIRED_IDS].sort());
    expect(GLOSSARY_OMIT).toEqual(
      expect.arrayContaining(["fulling mill", "trip-hammer", "forge mill", "mill-forge"]),
    );
    for (const id of REQUIRED_IDS) {
      const entry = glossaryEntry(id);
      expect(entry?.definition.length).toBeGreaterThan(20);
      expect(entry?.title.length).toBeGreaterThan(2);
    }
    const blob = GLOSSARY_ENTRIES.map((e) => `${e.title} ${e.definition}`).join("\n");
    expect(blob).not.toMatch(/fulling mill|trip-hammer|forge mill|mill-forge/i);
  });
});

describe("glossary linker", () => {
  it("finds terms longest-match-first and is case-insensitive for mansus/manses", () => {
    const hits = findGlossaryHits(
      "The Pagus of Autun sent a Missus. Forty MODII and twenty Denarii. The MANSES (one mansus) sit on the demesne.",
    );
    expect(hits.map((h) => h.id)).toEqual(["pagus", "missus", "modii", "denarii", "manses", "manses", "demesne"]);
    expect(ids("cell of Saint-Martin and the timber oratory")).toEqual(["cell_saint_martin", "oratory"]);
    expect(ids("Louis the Pious held Francia in the Carolingian age")).toEqual([
      "louis_the_pious",
      "francia",
      "carolingian",
    ]);
    expect(ids("standing order and a lasting custom of the hall")).toEqual(["standing_order", "lasting_custom"]);
    expect(ids("two-field rotation, mill leat, bloom iron, mast year, village reeve")).toEqual([
      "two_field",
      "mill_leat",
      "bloomery",
      "pannage",
      "reeve",
    ]);
  });

  it("skips the omit list and does not invent mill-forge explainers", () => {
    const text = "The fulling mill and trip-hammer / forge mill sit by the mill-forge. A bloomery and mill leat are another matter.";
    const ranges = omitRanges(text);
    expect(ranges.length).toBeGreaterThanOrEqual(3);
    const hits = findGlossaryHits(text);
    expect(hits.map((h) => h.matched.toLowerCase()).join(" ")).not.toMatch(/fulling|trip-hammer|forge mill|mill-forge/);
    expect(hits.map((h) => h.id)).toEqual(expect.arrayContaining(["bloomery", "mill_leat"]));
  });

  it("applies contextual rules for cell, hunt, hall, waste, prior, hides, and Frank", () => {
    expect(ids("not the forge, and not the cell")).toContain("cell");
    expect(ids("Requires a chapel or cell on the estate")).toContain("cell");
    expect(ids("the prison cell was dark")).not.toContain("cell");

    expect(ids("A hunt")).toContain("hunt");
    expect(ids("Do not change it mid-hunt")).toContain("hunt");
    expect(ids("Gerulf still on the road; the hunt for pepper", { hunt: true })).toContain("hunt");
    expect(ids("The deer hunt at dawn")).not.toContain("hunt");

    expect(ids("while the hall waited on a master")).toContain("hall");
    expect(ids("Works known to the hall")).toContain("hall");
    expect(ids("the hallway door")).not.toContain("hall");

    expect(ids("overgrown waste and overgrown scrub")).toEqual(["waste", "scrub"]);
    expect(ids("Much of the holding is overgrown — waste, scrub, and swamp")).toEqual(
      expect.arrayContaining(["waste", "scrub"]),
    );
    expect(ids("Do not waste the last of the iron")).not.toContain("waste");

    expect(ids("I am Ermenald, prior of Saint-Martin's cell")).toEqual(
      expect.arrayContaining(["prior", "cell_saint_martin"]),
    );
    expect(ids("Prior season's books")).not.toContain("prior");

    expect(ids("I speak for the hides")).toContain("hides");
    expect(ids("three hides of land")).not.toContain("hides");

    expect(ids("a loud Frank who did you a favor")).toContain("frank");
    expect(ids("Frankly I prefer frankincense")).toEqual([]);
    expect(ids("the master of the house")).not.toContain("pannage");
  });

  it("links household and merchant intros and engine holding lines stay safe to scan", () => {
    expect(ids(HOUSEHOLD_INTROS.steward)).toEqual(expect.arrayContaining(["hall", "cell"]));
    expect(ids(HOUSEHOLD_INTROS.chaplain)).toEqual(expect.arrayContaining(["prior", "cell_saint_martin", "oratory"]));
    expect(ids(HOUSEHOLD_INTROS.village_reeve)).toEqual(expect.arrayContaining(["reeve", "hides"]));
    expect(ids(HOUSEHOLD_INTROS.copper_smith)).toContain("lombard");
    expect(ids(MERCHANT_INTROS.Gero)).toContain("frank");
    expect(ids(MERCHANT_INTROS.Liutward)).toContain("alemannic");
    expect(ids(MERCHANT_INTROS.Wichard)).toEqual(expect.arrayContaining(["hides", "bloomery"]));
    expect(ids(CHECK_RECORDS_LINE)).toEqual([]);
    expect(ids(RECALL_DEALS_LINE)).toEqual([]);
  });
});

describe("glossary UI", () => {
  it("turns intro and bubble copy into term buttons", () => {
    const intro = renderToStaticMarkup(createElement(GlossaryText, { text: HOUSEHOLD_INTROS.chaplain }));
    expect(intro).toContain("glossary-term");
    expect(intro).toContain("data-glossary-id=\"prior\"");
    expect(intro).toContain("data-glossary-id=\"cell_saint_martin\"");

    const bubble = "A missus is asking after the demesne — forty modii.";
    const html = renderToStaticMarkup(createElement(GlossaryText, { text: bubble }));
    expect(html).toContain("data-glossary-id=\"missus\"");
    expect(html).toContain("data-glossary-id=\"demesne\"");
    expect(html).toContain("data-glossary-id=\"modii\"");
    expect(html).toContain("aria-haspopup=\"dialog\"");
  });

  it("opens a small dialog with the term title and definition", () => {
    const entry = glossaryEntry("missus")!;
    const html = renderToStaticMarkup(
      createElement(GlossaryPopover, {
        entry: { id: entry.id, title: entry.title, definition: entry.definition, anchor: null },
        onClose: () => undefined,
      }),
    );
    expect(html).toContain("role=\"dialog\"");
    expect(html).toContain("aria-modal=\"true\"");
    expect(html).toContain("aria-label=\"Close\"");
    expect(html).toContain(entry.title);
    expect(html).toMatch(/missus dominicus/);
    expect(html).toContain("glossary-popover");
  });

  it("paints books labels and the sample steward bubble with links", () => {
    const view = viewOf();
    const books = renderToStaticMarkup(createElement(BooksPanel, { view }));
    expect(books).toContain("data-glossary-id=\"denarii\"");
    expect(books).toContain("data-glossary-id=\"manses\"");
    expect(books).toContain("data-glossary-id=\"villa\"");
    expect(books).toContain("data-glossary-id=\"pagus\"");
    expect(books).toContain("data-glossary-id=\"louis_the_pious\"");
    expect(books).toContain("data-glossary-id=\"waste\"");
    expect(books).toContain("data-glossary-id=\"scrub\"");
    expect(books).toContain("role=\"tablist\"");
    expect(books).toContain("Estate");
    expect(books).toContain("Labours");
    expect(books).toContain("Customs");

    const bubble = renderToStaticMarkup(createElement(GlossaryText, { text: view.messages[0].text }));
    expect(bubble).toContain("data-glossary-id=\"missus\"");
    expect(bubble).toContain("data-glossary-id=\"pagus\"");
  });

  it("provider can open the popover for a clicked term id", () => {
    const html = renderToStaticMarkup(
      createElement(
        GlossaryProvider,
        null,
        createElement(GlossaryText, { text: "The pagus is quiet." }),
        createElement(GlossaryPopover, {
          entry: {
            id: "pagus",
            title: "pagus",
            definition: glossaryEntry("pagus")!.definition,
            anchor: null,
          },
          onClose: () => undefined,
        }),
      ),
    );
    expect(html).toContain("data-glossary-id=\"pagus\"");
    expect(html).toContain("role=\"dialog\"");
    expect(html).toMatch(/Autun County/);
  });
});
