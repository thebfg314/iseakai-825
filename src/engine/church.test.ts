import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { customsBookEntries } from "../ui/booksView";
import { proposalBlurb } from "../ui/ledgerCopy";
import { parseProposal } from "../llm/parse";
import { defaultAppSettings } from "../llm/settings";
import { GameController } from "../session/game";
import { applyProposal } from "./applyDelta";
import {
  BISHOP_REPUTATION,
  CELL_ALMS_MODEST,
  CELL_ALMS_SMALL,
  closeChurchSeason,
  FEAST_GRAND_BONUS,
  FEAST_HAPPINESS_CAP,
  FEAST_PLAIN_BONUS,
  FEAST_PLAIN_DENARII,
  feastHappinessGrant,
  ordersWithholdGrainTithe,
  recordChurchNeglect,
  standingOrderIsSundayWork,
} from "./church";
import { applyPeopleHappinessDelta, fadeSponsoredFeastJoy, PEOPLE_HAPPINESS_MAX, PEOPLE_HAPPINESS_MIN, tickPeopleHappiness } from "./peopleHappiness";
import { resolveAgricultureAndProjects } from "./season";
import { WorldStateSchema, type WorldState } from "./schema";

const JARGON = /\b(modifier|JSON|buff|peopleHappiness|happiness|sponsor_feast)\b/i;

function boot(extra?: (s: WorldState) => void): WorldState {
  const state = WorldStateSchema.parse(structuredClone(startingEstate));
  extra?.(state);
  return state;
}

function feast(state: WorldState, tier: "plain" | "grand", feastName?: string) {
  return applyProposal(
    state,
    {
      type: "sponsor_feast",
      tier,
      summary: tier === "grand" ? "A grand feast at the cell." : "A plain feast at the cell.",
      feastName,
    },
    "chaplain",
  );
}

describe("people's heart scale", () => {
  it("stays on 0–100, with a feast ceiling of 80 inside that scale", () => {
    expect(PEOPLE_HAPPINESS_MIN).toBe(0);
    expect(PEOPLE_HAPPINESS_MAX).toBe(100);
    expect(FEAST_HAPPINESS_CAP).toBe(80);
    const high = structuredClone(startingEstate) as { peopleHappiness?: number };
    high.peopleHappiness = 100;
    expect(WorldStateSchema.parse(high).peopleHappiness).toBe(100);
    high.peopleHappiness = 101;
    expect(() => WorldStateSchema.parse(high)).toThrow();
    high.peopleHappiness = -1;
    expect(() => WorldStateSchema.parse(high)).toThrow();
  });
});

describe("sponsored feast", () => {
  it("Confirm of a plain feast takes twelve denarii and beeswax and lifts the people by four", () => {
    const game = new GameController(
      boot(),
      fs.mkdtempSync(path.join(os.tmpdir(), "isekai-feast-")),
      defaultAppSettings(),
    );
    game.queueProposal("chaplain", {
      type: "sponsor_feast",
      tier: "plain",
      summary: "A plain feast for the Rogation Days.",
      feastName: "the Rogation Days",
    });
    const id = game.pending.find((p) => p.status === "pending")!.id;
    const view = game.confirmProposal(id);
    expect(view.error).toBeUndefined();
    expect(game.state.resources.denarii).toBe(138 - FEAST_PLAIN_DENARII);
    expect(game.state.resources.beeswax).toBe(0);
    expect(game.state.peopleHappiness).toBe(50 + FEAST_PLAIN_BONUS);
    expect(game.state.church.feastFade).toBe(FEAST_PLAIN_BONUS / 2);
    expect(game.messages.some((m) => m.role === "system" && /Rogation Days/.test(m.text) && !JARGON.test(m.text))).toBe(true);
    expect(proposalBlurb(game.pending[0].proposal, game.state)).toMatch(/12 denarii/);
    expect(proposalBlurb(game.pending[0].proposal, game.state)).not.toMatch(JARGON);
  });

  it("refuses a feast the chest or the candles cannot pay, and changes nothing", () => {
    const state = boot((s) => {
      s.resources.denarii = 5;
      s.resources.beeswax = 0;
    });
    const before = state.peopleHappiness;
    const r = feast(state, "plain");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/chest has not 12 denarii/i);
    expect(r.reason).toMatch(/beeswax/i);
    expect(r.reason).not.toMatch(JARGON);
    expect(state.peopleHappiness).toBe(before);
    expect(state.resources.denarii).toBe(5);
    expect(state.resources.beeswax).toBe(0);
    expect(state.church.feastHeldKey).toBe("");
  });

  it("allows only one sponsored feast in a season", () => {
    const state = boot();
    expect(feast(state, "plain").ok).toBe(true);
    const denarii = state.resources.denarii;
    const heart = state.peopleHappiness;
    const again = feast(state, "grand");
    expect(again.ok).toBe(false);
    expect(again.reason).toMatch(/already kept a feast this season/i);
    expect(state.resources.denarii).toBe(denarii);
    expect(state.peopleHappiness).toBe(heart);
  });

  it("lets half the feast's joy cool on the next Advance, and keeps half", () => {
    const state = boot();
    expect(feast(state, "plain").ok).toBe(true);
    expect(state.peopleHappiness).toBe(54);
    expect(fadeSponsoredFeastJoy(state)).toBe(2);
    expect(state.peopleHappiness).toBe(52);
    expect(state.church.feastFade).toBe(0);
    expect(fadeSponsoredFeastJoy(state)).toBe(0);
    expect(state.peopleHappiness).toBe(52);

    const grand = boot((s) => {
      s.resources.beeswax = 2;
    });
    expect(feast(grand, "grand", "Martinmas").ok).toBe(true);
    expect(grand.peopleHappiness).toBe(50 + FEAST_GRAND_BONUS);
    expect(grand.resources.denarii).toBe(138 - 30);
    expect(grand.resources.beeswax).toBe(1);
    expect(grand.resources.wine).toBe(0);
    expect(grand.resources.rye).toBe(8 - 2);
    expect(fadeSponsoredFeastJoy(grand)).toBe(4);
    expect(grand.peopleHappiness).toBe(54);
  });

  it("does not let a feast push the people above 80, including when the gift would cross or they are already past it", () => {
    const below = boot();
    expect(feastHappinessGrant(50, FEAST_PLAIN_BONUS)).toBe(4);
    expect(feast(below, "plain").ok).toBe(true);
    expect(below.peopleHappiness).toBe(54);

    const crossing = boot((s) => {
      s.peopleHappiness = 76;
    });
    const crossed = feast(crossing, "grand");
    expect(crossed.ok).toBe(true);
    expect(crossing.peopleHappiness).toBe(80);
    expect(crossing.church.feastFade).toBe(2);
    expect(crossed.logLine).not.toMatch(JARGON);
    expect(fadeSponsoredFeastJoy(crossing)).toBe(2);
    expect(crossing.peopleHappiness).toBe(78);

    const full = boot((s) => {
      s.peopleHappiness = 80;
    });
    expect(feast(full, "plain").ok).toBe(true);
    expect(full.peopleHappiness).toBe(80);
    expect(full.church.feastFade).toBe(0);
    expect(full.resources.denarii).toBe(138 - 12);

    const above = boot((s) => {
      s.peopleHappiness = 90;
      s.resources.beeswax = 2;
    });
    expect(feast(above, "plain").ok).toBe(true);
    expect(above.peopleHappiness).toBe(90);
    expect(fadeSponsoredFeastJoy(above)).toBe(0);
    expect(above.peopleHappiness).toBe(90);

    const other = boot((s) => {
      s.peopleHappiness = 75;
    });
    applyPeopleHappinessDelta(other, 10);
    expect(other.peopleHappiness).toBe(85);
  });

  it("counts the cooling inside the season's heart tick, once", () => {
    const state = boot();
    feast(state, "plain");
    const before = state.peopleHappiness;
    tickPeopleHappiness(state);
    expect(state.church.feastFade).toBe(0);
    expect(state.peopleHappiness).toBe(before - 2 + 4);
    tickPeopleHappiness(state);
    expect(state.peopleHappiness).toBe(before - 2 + 4 + 4);
  });

  it("parses a feast proposal and will not let the steward order it", () => {
    const parsed = parseProposal({ type: "feast", tier: "grand", summary: "Martinmas", feastName: "Martinmas" });
    expect(parsed.proposal).toMatchObject({ type: "sponsor_feast", tier: "grand", feastName: "Martinmas" });
    const state = boot();
    const r = applyProposal(state, { type: "sponsor_feast", tier: "plain", summary: "A feast" }, "steward");
    expect(r.ok).toBe(false);
    expect(state.resources.denarii).toBe(138);
  });
});

describe("church neglect", () => {
  it("does not treat the Fontenay duty or Keep Sundays as neglect", () => {
    const state = boot();
    expect(ordersWithholdGrainTithe(state)).toBe(false);
    expect(standingOrderIsSundayWork("Keep Sundays.")).toBe(false);
    const lines = resolveAgricultureAndProjects(state).map((l) => l.text);
    expect(lines.some((t) => /Tithe to the cell took/.test(t))).toBe(true);
    expect(lines.some((t) => /Tithe: 1 lb wool to the cell/.test(t))).toBe(true);
    expect(state.church.neglect).toEqual([]);
    expect(state.church.letters).toEqual([]);
    expect(state.resources.rye).toBe(1.5);
  });

  it("counts a withheld tithe only when the stores could pay", () => {
    const state = boot();
    applyProposal(
      state,
      { type: "set_standing_order", summary: "Hold back the tithe", text: "Do not render the grain tithe.", active: true },
      "steward",
    );
    const lines = resolveAgricultureAndProjects(state).map((l) => l.text);
    expect(lines.some((t) => /grain tithe was not rendered/i.test(t))).toBe(true);
    expect(state.church.neglect.map((s) => s.kind)).toEqual(["tithe"]);
    expect(state.peopleHappiness).toBe(48);
    expect(state.resources.rye).toBe(3);

    const thin = boot((s) => {
      s.resources.wheat = 0;
      s.resources.rye = 5;
      s.resources.barley = 0;
      s.resources.oats = 0;
    });
    applyProposal(
      thin,
      { type: "set_standing_order", summary: "Hold back the tithe", text: "Do not render the grain tithe.", active: true },
      "steward",
    );
    resolveAgricultureAndProjects(thin);
    expect(thin.church.neglect.map((s) => s.kind)).not.toContain("tithe");
  });

  it("escalates three slips to a letter from the bishop", () => {
    const state = boot();
    const start = state.peopleHappiness;
    const sunday = applyProposal(
      state,
      { type: "set_standing_order", summary: "Sunday work", text: "Sunday labour on the demesne.", active: true },
      "steward",
    );
    expect(sunday.ok).toBe(true);
    expect(sunday.logLine).toMatch(/displeased/i);
    expect(sunday.logLine).not.toMatch(JARGON);
    expect(state.peopleHappiness).toBe(start + -2);
    expect(state.church.letters).toHaveLength(0);

    applyProposal(
      state,
      { type: "set_standing_order", summary: "Feast-day work", text: "Work on feast days in the fields.", active: true },
      "steward",
    );
    expect(state.church.letters).toHaveLength(0);
    expect(state.peopleHappiness).toBe(start - 4);

    const taken = applyProposal(
      state,
      {
        type: "transfer_resources",
        summary: "Seize rye from the cell",
        resource: "rye",
        amount: 1,
        direction: "gain",
        reason: "taken from the cell of Saint-Martin",
      },
      "steward",
    );
    expect(taken.ok).toBe(true);
    expect(state.peopleHappiness).toBe(start - 6 - 5);
    expect(state.church.reputation).toBe(BISHOP_REPUTATION);
    expect(state.church.letters).toHaveLength(1);
    expect(state.church.letters[0].text).toMatch(/bishop of Autun/i);
    expect(state.church.letters[0].text).not.toMatch(JARGON);
    const letters = customsBookEntries(state).letters;
    expect(letters).toHaveLength(1);
    expect(letters[0].title).toBe("A letter from Autun");
    expect(letters[0].body).toMatch(/count/i);
    const memory = state.npcs.find((n) => n.id === "chaplain")!.memories.map((m) => m.summary).join(" ");
    expect(memory).toMatch(/displeased/i);
    expect(memory).toMatch(/bishop of Autun/i);
  });

  it("lets a well-kept season forgive a slip, and lets old slips age out", () => {
    const state = boot();
    recordChurchNeglect(state, "wool", "The pound of wool was not rendered, though wool was on hand.");
    expect(state.church.neglect).toHaveLength(1);
    state.meta.turn += 1;
    closeChurchSeason(state);
    expect(state.church.neglect).toHaveLength(0);

    const aged = boot();
    recordChurchNeglect(aged, "sunday", "Work was ordered on Sunday.");
    recordChurchNeglect(aged, "wool", "The wool was withheld.");
    aged.meta.turn = 5;
    closeChurchSeason(aged);
    expect(aged.church.neglect).toHaveLength(0);
  });

  it("keeps the autumn sheep when the lord withholds it and the flock can spare one", () => {
    const state = boot((s) => {
      s.meta.season = "autumn";
    });
    applyProposal(
      state,
      { type: "set_standing_order", summary: "Keep the sheep", text: "Do not give the cell a sheep.", active: true },
      "steward",
    );
    resolveAgricultureAndProjects(state);
    expect(state.resources.sheep).toBe(15);
    expect(state.church.neglect.map((s) => s.kind)).toContain("sheep");
  });
});

describe("cell alms in hunger", () => {
  it("gives a modest gift once, remembers it, and refuses the next asking", () => {
    const quiet = boot();
    const refused = applyProposal(
      quiet,
      {
        type: "transfer_resources",
        summary: "Alms from the cell",
        resource: "rye",
        amount: 10,
        direction: "gain",
        reason: "alms from the cell",
      },
      "chaplain",
    );
    expect(refused.ok).toBe(false);
    expect(refused.reason).toMatch(/not hungry/i);
    expect(quiet.resources.rye).toBe(8);

    const state = boot((s) => {
      s.flags.hunger = true;
    });
    const gift = applyProposal(
      state,
      {
        type: "transfer_resources",
        summary: "Alms from the cell",
        resource: "rye",
        amount: 10,
        direction: "gain",
        reason: "alms from the cell",
      },
      "chaplain",
    );
    expect(gift.ok).toBe(true);
    expect(gift.logLine).toMatch(/not gladly/i);
    expect(gift.logLine).not.toMatch(JARGON);
    expect(state.resources.rye).toBe(8 + CELL_ALMS_MODEST);
    expect(state.church.almsTurn).toBe(state.meta.turn);
    expect(state.npcs.find((n) => n.id === "chaplain")!.memories.some((m) => /remember/i.test(m.summary))).toBe(true);

    const again = applyProposal(
      state,
      {
        type: "transfer_resources",
        summary: "Alms from the cell again",
        resource: "rye",
        amount: 3,
        direction: "gain",
        reason: "alms from the cell",
      },
      "chaplain",
    );
    expect(again.ok).toBe(false);
    expect(again.reason).toMatch(/once/i);
    expect(state.resources.rye).toBe(8 + CELL_ALMS_MODEST);

    state.meta.turn += 8;
    const later = applyProposal(
      state,
      {
        type: "transfer_resources",
        summary: "Alms from the cell, later",
        resource: "rye",
        amount: 3,
        direction: "gain",
        reason: "alms from the cell",
      },
      "chaplain",
    );
    expect(later.ok).toBe(true);
    expect(state.resources.rye).toBe(8 + CELL_ALMS_MODEST + CELL_ALMS_SMALL);
  });

  it("gives nothing when the dearth is across the pagus", () => {
    const state = boot((s) => {
      s.flags.hunger = true;
      s.flags.regional_famine = true;
    });
    const r = applyProposal(
      state,
      {
        type: "transfer_resources",
        summary: "Alms from the cell",
        resource: "rye",
        amount: 3,
        direction: "gain",
        reason: "alms from the cell",
      },
      "chaplain",
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/pagus/i);
    expect(state.resources.rye).toBe(8);
    expect(state.church.almsTurn).toBeNull();
  });
});

describe("cell surplus", () => {
  it("sells a little beans at a fair price and refuses a bulk sale", () => {
    const state = boot();
    const sale = applyProposal(
      state,
      {
        type: "transfer_resources",
        summary: "A modius of beans from the cell",
        resource: "beans",
        amount: 1,
        direction: "gain",
        pricePerUnit: 3,
      },
      "chaplain",
    );
    expect(sale.ok).toBe(true);
    expect(sale.logLine).toMatch(/1 modius of beans for 3 denarii/);
    expect(state.resources.denarii).toBe(135);
    expect(state.custom_resources.find((c) => c.id === "beans")?.amount).toBe(1);
    expect(state.church.neglect).toEqual([]);

    const bulk = applyProposal(
      state,
      {
        type: "transfer_resources",
        summary: "A cart of beans",
        resource: "beans",
        amount: 8,
        direction: "gain",
        pricePerUnit: 3,
      },
      "chaplain",
    );
    expect(bulk.ok).toBe(false);
    expect(bulk.reason).toMatch(/little/i);
    expect(state.resources.denarii).toBe(135);
  });
});
