import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
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

describe("per-NPC dialogue logs", () => {
  const opening = /I am Aldric/;

  function stubTalk(
    game: GameController,
    speech: string,
    extra: { chronicle?: string; emotion?: string; proposals?: unknown[] } = {},
  ) {
    return vi.spyOn(game as unknown as { callLlm: (...args: unknown[]) => Promise<unknown> }, "callLlm").mockResolvedValue({
      speech,
      chronicle: extra.chronicle,
      emotion: extra.emotion ?? "neutral",
      proposals: extra.proposals ?? [],
      raw: "{}",
      parseErrors: [],
    });
  }

  it("does not show the steward opening on the smith log", () => {
    const game = tempGame();
    expect(game.view().messages.some((m) => opening.test(m.text))).toBe(true);
    const smith = game.setScene("smith");
    expect(smith.sceneNpcId).toBe("smith");
    expect(smith.messages.some((m) => opening.test(m.text))).toBe(false);
    expect(smith.messages.every((m) => m.npcId === "smith")).toBe(true);
  });

  it("does not show a smith reply on the steward log", async () => {
    const game = tempGame();
    stubTalk(game, "The charcoal is nearly gone, my lord.");
    await game.sendDialogue("smith", "How fares the forge?");
    const steward = game.setScene("steward");
    expect(steward.messages.some((m) => /charcoal is nearly gone/.test(m.text))).toBe(false);
    expect(steward.messages.some((m) => opening.test(m.text))).toBe(true);
    const smith = game.setScene("smith");
    expect(smith.messages.some((m) => /charcoal is nearly gone/.test(m.text))).toBe(true);
    expect(smith.messages.some((m) => opening.test(m.text))).toBe(false);
  });

  it("keeps the steward thread when switching back from the smith", async () => {
    const game = tempGame();
    const first = game.view().messages.map((m) => m.text);
    stubTalk(game, "Nails I can make, if the iron holds.");
    await game.sendDialogue("smith", "Make nails.");
    game.setScene("smith");
    const back = game.setScene("steward");
    expect(back.messages.map((m) => m.text)).toEqual(first);
    expect(back.messages.some((m) => /Nails I can make/.test(m.text))).toBe(false);
  });

  it("puts the season report on the steward log only", async () => {
    const game = tempGame();
    game.setScene("smith");
    stubTalk(game, "The harvest is gathered, my lord.", { chronicle: "Grain to the barn.", emotion: "respectful" });
    await game.advanceSeason();
    expect(game.sceneNpcId).toBe("steward");
    const steward = game.view();
    expect(steward.messages.some((m) => /harvest is gathered/.test(m.text))).toBe(true);
    expect(steward.messages.some((m) => /Season written to the books/.test(m.text))).toBe(true);
    const smith = game.setScene("smith");
    expect(smith.messages.some((m) => /harvest is gathered|Season written/.test(m.text))).toBe(false);
    expect(smith.messages.some((m) => opening.test(m.text))).toBe(false);
  });

  it("does not leak steward chat onto an empty merchant tab", () => {
    const game = tempGame();
    game.state.flags.merchant_present = true;
    game.state.merchant.present = true;
    game.state.merchant.name = "Gero";
    game.state.npcs.push({ id: "merchant", name: "Gero", role: "merchant", location: "fontenay" });
    const merchant = game.setScene("merchant");
    expect(merchant.sceneNpcId).toBe("merchant");
    expect(merchant.messages).toHaveLength(0);
    expect(merchant.messages.some((m) => opening.test(m.text))).toBe(false);
  });
});
