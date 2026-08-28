import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { WorldStateSchema } from "../engine/schema";
import { cloneState } from "../engine/state";
import { finishSeasonClock } from "../engine/season";
import { yieldMultiplier } from "../engine/modifiers";
import type { RolledEvent } from "../engine/events";
import type { SeasonEffectLine } from "../engine/schema";
import { parseLlmResponse } from "../llm/parse";
import { defaultAppSettings } from "../llm/settings";
import { GameController } from "./game";

function tempGame() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isekai-"));
  const state = WorldStateSchema.parse(structuredClone(startingEstate));
  return new GameController(state, dir, defaultAppSettings());
}

function worldFile(c: GameController) {
  return JSON.parse(fs.readFileSync(path.join(c.saveDir, "world-state.json"), "utf8"));
}

describe("dialogue parse → queue → confirm → world-state", () => {
  it("keeps Fontenay start numbers after parse (arable 32, 10 households, 96 denarii)", () => {
    const state = WorldStateSchema.parse(structuredClone(startingEstate));
    expect(state.holdings[0].land.fertile_arable).toBe(32);
    expect(state.population.households).toBe(10);
    expect(state.resources.denarii).toBe(96);
    expect(state.agriculture.springBarleyShare).toBe(0.6);
  });

  it("queues a steward sowing order, Confirm writes sown acres and the save file", () => {
    const game = tempGame();
    const barleyBefore = game.state.holdings[0].sown.barley;
    const parsed = parseLlmResponse(
      JSON.stringify({
        speech: "We can put the remaining spring share to barley.",
        proposals: [
          {
            type: "adjust_sowing",
            summary: "Sow more barley",
            holdingId: "fontenay",
            springBarleyShare: 0.85,
          },
        ],
      }),
    );
    game.ingestParsedDialogue("steward", parsed, "Sow more barley on the remaining acres.");
    expect(game.state.holdings[0].sown.barley).toBe(barleyBefore);
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(1);
    expect(game.messages.some((m) => m.role === "system" && /Confirm/i.test(m.text))).toBe(true);

    const result = game.confirmProposal(game.pending[0].id);
    expect(result.error).toBeUndefined();
    expect(game.state.agriculture.springBarleyShare).toBe(0.85);
    expect(game.state.holdings[0].sown.barley).toBeGreaterThan(barleyBefore);
    const saved = worldFile(game);
    expect(saved.agriculture.springBarleyShare).toBe(0.85);
    expect(saved.holdings[0].sown.barley).toBe(game.state.holdings[0].sown.barley);
  });

  it("does not mutate resources on speech-only replies", () => {
    const game = tempGame();
    const before = cloneState(game.state);
    const parsed = parseLlmResponse(JSON.stringify({ speech: "The rye stands well, my lord.", proposals: [] }));
    game.ingestParsedDialogue("steward", parsed, "How fares the rye?");
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
    expect(game.state.resources).toEqual(before.resources);
    expect(game.state.holdings[0].sown).toEqual(before.holdings[0].sown);
    expect(game.state.modifiers).toEqual(before.modifiers);
  });

  it("drafts a pending clear-scrub project when the model returns speech and no proposal", () => {
    const game = tempGame();
    const ironBefore = game.state.resources.iron;
    const parsed = parseLlmResponse(JSON.stringify({ speech: "A wise thought, my lord.", proposals: [] }));
    game.ingestParsedDialogue("steward", parsed, "Start clearing the scrub.");
    const pending = game.pending.filter((p) => p.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].proposal.type).toBe("start_project");
    expect(game.state.resources.iron).toBe(ironBefore);
    expect(game.messages.some((m) => /drafted from your order/i.test(m.text))).toBe(true);

    game.confirmProposal(pending[0].id);
    expect(game.state.projects.some((p) => p.key === "clear_scrub" && p.status === "active")).toBe(true);
    expect(game.state.resources.iron).toBeLessThan(ironBefore);
  });

  it("shows a ledger line when JSON is missing and no order can be drafted", () => {
    const game = tempGame();
    const parsed = parseLlmResponse("I am silent, and this is not JSON.");
    game.ingestParsedDialogue("steward", parsed, "Tell me of the weather.");
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
    expect(game.messages.some((m) => m.role === "system" && /unchanged/i.test(m.text))).toBe(true);
  });

  it("gives grain to the cell on confirm without a merchant", () => {
    const game = tempGame();
    const ryeBefore = game.state.resources.rye;
    const parsed = parseLlmResponse(
      JSON.stringify({
        speech: "The brothers will have bread.",
        proposals: [{ type: "transfer_resources", summary: "Grain to the cell", resource: "rye", amount: 2, direction: "give" }],
      }),
    );
    game.ingestParsedDialogue("steward", parsed, "Give the cell two modii of rye.");
    game.confirmProposal(game.pending[0].id);
    expect(game.state.resources.rye).toBe(ryeBefore - 2);
  });
});

describe("season events and persistent buffs", () => {
  it("applies a numeric stub when the referee emits flavour-only event_effect", () => {
    const game = tempGame();
    const ryeBefore = game.state.resources.rye;
    const effects: SeasonEffectLine[] = [];
    const ev: RolledEvent = {
      id: "w-rain",
      category: "weather",
      polarity: "negative",
      text: "Rain",
      resolvedText: "Rain",
      crop: "rye",
    };
    game.applySeasonProposals(
      [{ type: "event_effect", eventId: "w-rain", summary: "It rained prettily." }],
      [ev],
      effects,
    );
    const mood = game.state.modifiers.some((m) => m.target === "mood");
    const ryeMoved = game.state.resources.rye !== ryeBefore;
    expect(mood || ryeMoved).toBe(true);
    expect(effects.some((e) => /Default effect|Flavour only/i.test(e.text))).toBe(true);
  });

  it("lets an accepted mood blessing raise later yield and survive a season tick", () => {
    const game = tempGame();
    const base = yieldMultiplier(game.state, "rye");
    const parsed = parseLlmResponse(
      JSON.stringify({
        speech: "A blessing upon the house.",
        proposals: [
          {
            type: "add_modifier",
            summary: "Blessing",
            target: "mood",
            kind: "temporary",
            seasonsRemaining: 4,
            effect: { op: "add", value: 1 },
            source: "Ermenald's blessing",
          },
        ],
      }),
    );
    game.ingestParsedDialogue("chaplain", parsed, "Give us your blessing.");
    game.confirmProposal(game.pending[0].id);
    expect(yieldMultiplier(game.state, "rye")).toBeGreaterThan(base);
    const remaining = game.state.modifiers.find((m) => m.source === "Ermenald's blessing")?.seasons_remaining;
    expect(remaining).toBe(4);

    finishSeasonClock(game.state);
    const after = game.state.modifiers.find((m) => m.source === "Ermenald's blessing");
    expect(after?.seasons_remaining).toBe(3);
    expect(yieldMultiplier(game.state, "rye")).toBeGreaterThan(base);
  });
});
