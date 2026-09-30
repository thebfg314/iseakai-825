import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { WorldStateSchema } from "../engine/schema";
import { cloneState } from "../engine/state";
import { finishSeasonClock, resolveAgricultureAndProjects } from "../engine/season";
import { yieldMultiplier } from "../engine/modifiers";
import { labourPool } from "../engine/labour";
import { HAPPINESS_MOOD_PER_ADD, peopleEffortFactor } from "../engine/peopleHappiness";
import type { RolledEvent } from "../engine/events";
import type { SeasonEffectLine } from "../engine/schema";
import { MERCHANT_INTROS } from "../engine/intros";
import { ordinaryHuntPurse } from "../engine/hunts";
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
    expect(game.state.npcs.find((n) => n.id === "steward")?.memories).toHaveLength(1);
    expect(saved.npcs.find((n: { id: string }) => n.id === "steward").memories).toHaveLength(1);
    expect(saved.npcs.find((n: { id: string }) => n.id === "steward").memories[0].summary).toMatch(/barley|sowing/i);
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
    expect(game.state.npcs.every((n) => n.memories.length === 0)).toBe(true);
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
    expect(game.state.resources.iron).toBe(ironBefore);
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
    expect(effects.some((e) => /usual change|season's tale had no figures/i.test(e.text))).toBe(true);
  });

  it("lets an accepted mood blessing raise the people's heart and later yield without extra callable labour", () => {
    const game = tempGame();
    const poolBefore = { ...labourPool(game.state) };
    const yieldModsBefore = yieldMultiplier(game.state, "rye");
    const effortBefore = peopleEffortFactor(game.state);
    const happyBefore = game.state.peopleHappiness;
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
    expect(game.state.peopleHappiness).toBe(happyBefore + HAPPINESS_MOOD_PER_ADD);
    expect(labourPool(game.state)).toEqual(poolBefore);
    expect(yieldMultiplier(game.state, "rye")).toBe(yieldModsBefore);
    expect(peopleEffortFactor(game.state)).toBeGreaterThan(effortBefore);
    const remaining = game.state.modifiers.find((m) => m.source === "Ermenald's blessing")?.seasons_remaining;
    expect(remaining).toBe(4);

    finishSeasonClock(game.state);
    const after = game.state.modifiers.find((m) => m.source === "Ermenald's blessing");
    expect(after?.seasons_remaining).toBe(3);
    expect(peopleEffortFactor(game.state)).toBeGreaterThan(effortBefore);
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
    expect(game.state.last_season_deltas.sown_barley).toBe(1.8);
    expect(Object.keys(game.state.last_season_deltas).length).toBeGreaterThan(0);
    expect(game.state.estate_history).toHaveLength(1);
    expect(game.state.estate_history[0].season).toBe("spring");
    expect(game.state.estate_history[0].year).toBe(825);
    expect(game.state.peopleHappiness).toBeGreaterThanOrEqual(0);
    expect(game.state.peopleHappiness).toBeLessThanOrEqual(100);
    expect(game.state.estate_history[0].resources.denarii).toBe(96);
    expect(game.state.estate_history[0].population.households).toBe(10);
    expect(game.state.meta.season).toBe("summer");
    const smith = game.setScene("smith");
    expect(smith.messages.some((m) => /harvest is gathered|Season written/.test(m.text))).toBe(false);
    expect(smith.messages.some((m) => opening.test(m.text))).toBe(false);
  });

  it("does not leak steward chat onto an empty merchant tab", () => {
    const game = tempGame();
    game.state.flags.merchant_present = true;
    game.state.merchant.present = true;
    game.state.merchant.name = "Gero";
    game.state.npcs.push({ id: "merchant", name: "Gero", role: "merchant", location: "fontenay", memories: [], wantsTalk: false });
    const merchant = game.setScene("merchant");
    expect(merchant.sceneNpcId).toBe("merchant");
    expect(merchant.messages).toHaveLength(1);
    expect(merchant.messages[0]).toMatchObject({ role: "npc", npcId: "merchant", text: MERCHANT_INTROS.Gero });
    expect(merchant.messages.some((m) => opening.test(m.text))).toBe(false);
  });
});

describe("npc transaction memories", () => {
  it("writes Isaac's bargain to world-state by name and does not write on speech", () => {
    const game = tempGame();
    game.state.flags.merchant_present = true;
    game.state.merchant.present = true;
    game.state.merchant.name = "Isaac";
    game.state.merchant.stock = [{ resource: "salt", amount: 8 }];
    game.state.npcs.push({
      id: "merchant",
      name: "Isaac",
      role: "merchant",
      location: "fontenay",
      memories: [],
      wantsTalk: false,
    });
    game.state.resources.denarii = 200;

    const chat = parseLlmResponse(JSON.stringify({ speech: "Salt I have, if the price is fair.", proposals: [] }));
    game.ingestParsedDialogue("merchant", chat, "What wares do you carry?");
    expect(game.state.merchant_memories).toEqual({});
    expect(game.state.npcs.find((n) => n.id === "merchant")?.memories).toEqual([]);

    const parsed = parseLlmResponse(
      JSON.stringify({
        speech: "Four pounds of salt, then.",
        proposals: [{ type: "transfer_resources", summary: "Buy salt", resource: "salt", amount: 4, direction: "buy" }],
      }),
    );
    game.ingestParsedDialogue("merchant", parsed, "Buy four pounds of salt.");
    expect(game.state.npcs.find((n) => n.id === "merchant")?.memories).toEqual([]);
    game.confirmProposal(game.pending[0].id);
    expect(game.state.merchant_memories.Isaac).toHaveLength(1);
    expect(game.state.merchant_memories.Isaac[0].summary).toMatch(/salt/i);
    const saved = worldFile(game);
    expect(saved.merchant_memories.Isaac[0].summary).toMatch(/salt/i);
    expect(saved.npcs.find((n: { id: string }) => n.id === "smith").memories ?? []).toEqual([]);
  });

  it("confirms the stall basket without LLM JSON and writes stock, denarii, and Isaac's memory", () => {
    const game = tempGame();
    game.state.flags.merchant_present = true;
    game.state.merchant.present = true;
    game.state.merchant.name = "Isaac";
    game.state.merchant.stock = [{ resource: "salt", amount: 8 }];
    game.state.npcs.push({
      id: "merchant",
      name: "Isaac",
      role: "merchant",
      location: "fontenay",
      memories: [],
      wantsTalk: true,
    });
    game.state.resources.denarii = 200;
    const saltBefore = game.state.resources.salt;
    const result = game.confirmMerchantShop({ buyStall: { salt: 3 }, buyBack: {}, sell: {} });
    expect(result.error).toBeUndefined();
    expect(game.state.resources.salt).toBe(saltBefore + 3);
    expect(game.state.merchant.stock.find((s) => s.resource === "salt")?.amount).toBe(5);
    expect(game.state.resources.denarii).toBeLessThan(200);
    expect(game.state.merchant_memories.Isaac?.length).toBeGreaterThan(0);
    const saved = worldFile(game);
    expect(saved.resources.salt).toBe(game.state.resources.salt);
    expect(saved.merchant.stock.find((s: { resource: string }) => s.resource === "salt").amount).toBe(5);
  });
});

describe("hire specialists via Aldric Confirm", () => {
  it("starts Fontenay with Aldric, Bernard, Ermenald, and Gerulf", () => {
    const state = WorldStateSchema.parse(structuredClone(startingEstate));
    expect(state.npcs.map((n) => n.id).sort()).toEqual(["chaplain", "negotiator", "smith", "steward"]);
    expect(state.npcs.map((n) => n.name)).toEqual(["Aldric", "Bernard", "Ermenald", "Gerulf"]);
    expect(state.npcs.some((n) => /colman|haimo|gerold|hugo|otto|ambrosius|hildegard|lorenzo|eberhard/i.test(n.name))).toBe(false);
    expect(state.npcs.some((n) => /quarry|carpenter|mason|potter|reeve|vinedresser|seamstress|copper|captain/i.test(n.role))).toBe(false);
  });

  it("does not hire on speech-only talk about needing a carpenter", () => {
    const game = tempGame();
    const before = cloneState(game.state);
    const parsed = parseLlmResponse(JSON.stringify({ speech: "The rye stands well, my lord.", proposals: [] }));
    game.ingestParsedDialogue("steward", parsed, "How fares the rye?");
    expect(game.state.npcs).toHaveLength(4);
    expect(game.state.resources.denarii).toBe(before.resources.denarii);
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
  });

  it("drafts a carpenter hire from Aldric, Confirm writes Haimo and takes 110 denarii", () => {
    const game = tempGame();
    game.state.resources.denarii = 200;
    expect(game.setScene("carpenter").sceneNpcId).toBe("steward");
    const denariiBefore = game.state.resources.denarii;
    const parsed = parseLlmResponse(JSON.stringify({ speech: "I can send for a carpenter, my lord.", proposals: [] }));
    game.ingestParsedDialogue("steward", parsed, "Hire a carpenter full-time for the villa.");
    const pending = game.pending.filter((p) => p.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].proposal.type).toBe("register_npc");
    expect(game.state.npcs).toHaveLength(4);
    expect(game.state.resources.denarii).toBe(denariiBefore);

    const result = game.confirmProposal(pending[0].id);
    expect(result.error).toBeUndefined();
    const haimo = game.state.npcs.find((n) => n.id === "carpenter");
    expect(haimo).toMatchObject({ name: "Haimo", role: "carpenter", location: "fontenay" });
    expect(game.state.npcs).toHaveLength(5);
    expect(game.state.resources.denarii).toBe(denariiBefore - 110);
    const saved = worldFile(game);
    expect(saved.npcs.some((n: { id: string }) => n.id === "carpenter")).toBe(true);
    expect(saved.resources.denarii).toBe(denariiBefore - 110);

    expect(game.setScene("carpenter").sceneNpcId).toBe("carpenter");
    expect(game.view().messages.every((m) => m.npcId === "carpenter")).toBe(true);
    expect(game.setScene("steward").messages.some((m) => /I am Aldric/.test(m.text))).toBe(true);
  });

  it("does not take the hiring gift twice when the model also spends denarii", () => {
    const game = tempGame();
    game.state.resources.denarii = 200;
    const denariiBefore = game.state.resources.denarii;
    const parsed = parseLlmResponse(
      JSON.stringify({
        speech: "Haimo will come.",
        proposals: [
          {
            type: "register_npc",
            summary: "Hire Haimo",
            npc: { id: "carpenter", name: "Haimo", role: "carpenter", location: "fontenay" },
            isNew: true,
          },
          { type: "transfer_resources", summary: "Hiring gift", resource: "denarii", amount: 110, direction: "consume" },
        ],
      }),
    );
    game.ingestParsedDialogue("steward", parsed, "Hire a carpenter.");
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(1);
    game.confirmProposal(game.pending[0].id);
    expect(game.state.resources.denarii).toBe(denariiBefore - 110);
    expect(game.state.npcs.some((n) => n.id === "carpenter")).toBe(true);
  });

  it("does not add the specialist until Confirm", () => {
    const game = tempGame();
    game.state.resources.denarii = 150;
    const parsed = parseLlmResponse(
      JSON.stringify({
        speech: "Colman can be brought in.",
        proposals: [
          {
            type: "register_npc",
            summary: "Hire Colman",
            npc: { id: "quarry_master", name: "Colman", role: "quarry_master", location: "fontenay" },
            isNew: true,
          },
        ],
      }),
    );
    game.ingestParsedDialogue("steward", parsed, "Find me a quarry master.");
    expect(game.state.npcs.map((n) => n.id)).toEqual(["steward", "smith", "chaplain", "negotiator"]);
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(1);
  });

  it("refuses a hiring gift the chest cannot spare", () => {
    const game = tempGame();
    game.state.resources.denarii = 5;
    const parsed = parseLlmResponse(JSON.stringify({ speech: "The chest is too thin.", proposals: [] }));
    game.ingestParsedDialogue("steward", parsed, "Hire a mason for the villa.");
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
    expect(game.state.npcs).toHaveLength(4);
    expect(game.messages.some((m) => /chest cannot spare|denarii/i.test(m.text))).toBe(true);
  });

  it("hires Hugo for 80 denarii from the start chest and leaves 16", () => {
    const game = tempGame();
    expect(game.state.resources.denarii).toBe(96);
    const parsed = parseLlmResponse(JSON.stringify({ speech: "Hugo will come.", proposals: [] }));
    game.ingestParsedDialogue("steward", parsed, "Hire Hugo the potter.");
    const pending = game.pending.filter((p) => p.status === "pending");
    expect(pending).toHaveLength(1);
    const result = game.confirmProposal(pending[0].id);
    expect(result.error).toBeUndefined();
    expect(game.state.npcs.some((n) => n.id === "potter" && n.name === "Hugo")).toBe(true);
    expect(game.state.resources.denarii).toBe(16);
    expect(worldFile(game).resources.denarii).toBe(16);
  });

  it("refuses Gerold at boot because 200 denarii is more than the start chest", () => {
    const game = tempGame();
    expect(game.state.resources.denarii).toBe(96);
    const parsed = parseLlmResponse(JSON.stringify({ speech: "The chest is too thin for a mason.", proposals: [] }));
    game.ingestParsedDialogue("steward", parsed, "Hire Gerold the mason.");
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
    expect(game.state.npcs.some((n) => n.id === "mason")).toBe(false);
    expect(game.state.resources.denarii).toBe(96);
    expect(game.messages.some((m) => /chest cannot spare 200 denarii/i.test(m.text))).toBe(true);
  });

  it("does not hire Bernard, who already keeps the forge", () => {
    const game = tempGame();
    const parsed = parseLlmResponse(JSON.stringify({ speech: "Bernard is already ours.", proposals: [] }));
    game.ingestParsedDialogue("steward", parsed, "Hire Bernard the smith.");
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
    expect(game.state.npcs.filter((n) => n.id === "smith" || n.name === "Bernard")).toHaveLength(1);
    expect(game.messages.some((m) => /not for hire|already keeps the forge/i.test(m.text))).toBe(true);

    const forced = parseLlmResponse(
      JSON.stringify({
        speech: "I will write Bernard again.",
        proposals: [
          {
            type: "register_npc",
            summary: "Hire Bernard",
            npc: { id: "bernard", name: "Bernard", role: "smith", location: "fontenay" },
            isNew: true,
          },
        ],
      }),
    );
    game.ingestParsedDialogue("steward", forced, "Hire Bernard.");
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
    expect(game.state.npcs.filter((n) => /bernard/i.test(n.name))).toHaveLength(1);
  });

  it("does not hire twice, and Bernard cannot hire for the house", () => {
    const game = tempGame();
    game.state.resources.denarii = 200;
    const parsed = parseLlmResponse(JSON.stringify({ speech: "Aye.", proposals: [] }));
    game.ingestParsedDialogue("steward", parsed, "Hire Gerold the mason.");
    game.confirmProposal(game.pending[0].id);
    expect(game.state.npcs.filter((n) => n.role === "mason")).toHaveLength(1);

    game.ingestParsedDialogue("steward", parsed, "Hire a mason full-time.");
    expect(game.pending.filter((p) => p.status === "pending" && p.proposal.type === "register_npc")).toHaveLength(0);
    expect(game.messages.some((m) => /already serves/i.test(m.text))).toBe(true);

    const smithParsed = parseLlmResponse(JSON.stringify({ speech: "That is Aldric's business.", proposals: [] }));
    game.ingestParsedDialogue("smith", smithParsed, "Hire a potter for the villa.");
    expect(game.state.npcs.some((n) => n.id === "potter")).toBe(false);
  });

  it("canonicalizes a named hire from messy LLM JSON and keeps a separate potter log", () => {
    const game = tempGame();
    const parsed = parseLlmResponse(
      JSON.stringify({
        speech: "Hugo will come, if the gift is paid.",
        proposals: [{ type: "hire", summary: "Take on Hugo", name: "Hugo", role: "potter", isNew: true }],
      }),
    );
    expect(parsed.proposals[0]).toMatchObject({
      type: "register_npc",
      npc: { id: "potter", name: "Hugo", role: "potter" },
    });
    game.ingestParsedDialogue("steward", parsed, "Hire Hugo the potter.");
    game.confirmProposal(game.pending[0].id);
    expect(game.state.npcs.some((n) => n.id === "potter" && n.name === "Hugo")).toBe(true);
    expect(game.state.resources.denarii).toBe(16);
    const potter = game.setScene("potter");
    expect(potter.sceneNpcId).toBe("potter");
    expect(potter.messages).toHaveLength(1);
    expect(potter.messages[0]?.text).toMatch(/Hugo\. Potter/);
    expect(potter.messages.some((m) => /I am Aldric/.test(m.text))).toBe(false);
  });
});

describe("expansion hires via Aldric after unlock", () => {
  function unlockOtto(game: GameController) {
    game.state.population.households = 15;
    game.state.holdings[0].households = 15;
  }

  it("does not unlock or recommend the five at boot, and speech-only does not hire them", () => {
    const game = tempGame();
    const before = cloneState(game.state);
    const parsed = parseLlmResponse(JSON.stringify({ speech: "The rye stands well, my lord.", proposals: [] }));
    game.ingestParsedDialogue("steward", parsed, "How fares the rye?");
    expect(game.state.npcs).toHaveLength(4);
    expect(game.state.npcs.map((n) => n.id)).toEqual(["steward", "smith", "chaplain", "negotiator"]);
    expect(game.messages.some((m) => /Otto|Ambrosius|Hildegard|Lorenzo|Eberhard/.test(m.text))).toBe(false);
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
    expect(game.state.resources).toEqual(before.resources);
  });

  it("refuses Otto before the village grows, even if the model emits register_npc", () => {
    const game = tempGame();
    const parsed = parseLlmResponse(
      JSON.stringify({
        speech: "Otto can be brought in.",
        proposals: [
          {
            type: "register_npc",
            summary: "Hire Otto",
            npc: { id: "village_reeve", name: "Otto", role: "village_reeve", location: "fontenay" },
            isNew: true,
          },
        ],
      }),
    );
    game.ingestParsedDialogue("steward", parsed, "Hire Otto the reeve.");
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
    expect(game.state.npcs).toHaveLength(4);
    expect(game.messages.some((m) => /still small|households/i.test(m.text))).toBe(true);
  });

  it("recommends Otto after households reach 15, and Confirm writes him with his own tab", () => {
    const game = tempGame();
    expect(game.setScene("village_reeve").sceneNpcId).toBe("steward");
    unlockOtto(game);
    const denariiBefore = game.state.resources.denarii;
    const parsed = parseLlmResponse(JSON.stringify({ speech: "The village has grown.", proposals: [] }));
    game.ingestParsedDialogue("steward", parsed, "How fares the village?");
    expect(game.messages.some((m) => m.npcId === "steward" && /Otto/.test(m.text))).toBe(true);
    expect(game.state.npcs).toHaveLength(4);
    expect(game.state.resources.denarii).toBe(denariiBefore);
    expect(worldFile(game).npcs).toHaveLength(4);

    const hire = parseLlmResponse(JSON.stringify({ speech: "I can send for Otto.", proposals: [] }));
    game.ingestParsedDialogue("steward", hire, "Hire Otto the reeve.");
    const pending = game.pending.filter((p) => p.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].proposal.type).toBe("register_npc");
    expect(game.state.npcs).toHaveLength(4);

    const ryeBefore = game.state.resources.rye;
    const result = game.confirmProposal(pending[0].id);
    expect(result.error).toBeUndefined();
    const otto = game.state.npcs.find((n) => n.id === "village_reeve");
    expect(otto).toMatchObject({ name: "Otto", role: "village_reeve", location: "fontenay" });
    expect(game.state.resources.denarii).toBe(denariiBefore - 20);
    expect(game.state.resources.rye).toBe(ryeBefore - 0.5);
    expect(worldFile(game).npcs.some((n: { id: string }) => n.id === "village_reeve")).toBe(true);
    expect(game.setScene("village_reeve").sceneNpcId).toBe("village_reeve");
    expect(game.view().messages.every((m) => m.npcId === "village_reeve")).toBe(true);
  });

  it("refuses Otto after unlock if the chest cannot spare 20 denarii", () => {
    const game = tempGame();
    unlockOtto(game);
    game.state.resources.denarii = 19;
    const parsed = parseLlmResponse(JSON.stringify({ speech: "The chest is thin.", proposals: [] }));
    game.ingestParsedDialogue("steward", parsed, "Hire Otto the reeve.");
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
    expect(game.state.npcs.some((n) => n.id === "village_reeve")).toBe(false);
    expect(game.messages.some((m) => /chest cannot spare 20 denarii/i.test(m.text))).toBe(true);
  });

  it("refuses Otto after unlock if the granary cannot spare his house ration", () => {
    const game = tempGame();
    unlockOtto(game);
    game.state.resources.denarii = 20;
    game.state.resources.rye = 0;
    game.state.resources.wheat = 0;
    game.state.resources.barley = 0;
    game.state.resources.oats = 0;
    const parsed = parseLlmResponse(JSON.stringify({ speech: "The granary is thin.", proposals: [] }));
    game.ingestParsedDialogue("steward", parsed, "Hire Otto the reeve.");
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
    expect(game.state.npcs.some((n) => n.id === "village_reeve")).toBe(false);
    expect(game.state.resources.denarii).toBe(20);
    expect(game.messages.some((m) => /granary cannot spare|household ration/i.test(m.text))).toBe(true);
  });

  it("does not hire on speech-only talk after unlock", () => {
    const game = tempGame();
    unlockOtto(game);
    const before = cloneState(game.state);
    const parsed = parseLlmResponse(JSON.stringify({ speech: "Otto would keep the dues.", proposals: [] }));
    game.ingestParsedDialogue("steward", parsed, "Tell me of the village.");
    expect(game.state.npcs).toHaveLength(4);
    expect(game.state.resources.denarii).toBe(before.resources.denarii);
    expect(game.pending.filter((p) => p.status === "pending" && p.proposal.type === "register_npc")).toHaveLength(0);
  });

  it("hires each expansion person after their own condition, and Bernard cannot hire them", () => {
    const cases: { id: string; name: string; order: string; unlock: (g: GameController) => void }[] = [
      {
        id: "vinedresser",
        name: "Ambrosius",
        order: "Hire Ambrosius the vinedresser.",
        unlock: (g) => {
          g.state.holdings[0].land.vineyard = 2;
        },
      },
      {
        id: "head_seamstress",
        name: "Hildegard",
        order: "Hire Hildegard the seamstress.",
        unlock: (g) => {
          g.state.holdings[0].features.push("textile_workshop");
        },
      },
      {
        id: "copper_smith",
        name: "Lorenzo",
        order: "Hire Lorenzo the copper smith.",
        unlock: (g) => {
          g.state.holdings[0].features.push("bloomery");
        },
      },
      {
        id: "captain",
        name: "Eberhard",
        order: "Hire Eberhard the captain.",
        unlock: (g) => {
          g.state.holdings[0].features.push("watch_post");
        },
      },
    ];

    for (const row of cases) {
      const game = tempGame();
      game.state.resources.denarii = 300;
      const parsed = parseLlmResponse(JSON.stringify({ speech: "Aye.", proposals: [] }));
      game.ingestParsedDialogue("steward", parsed, row.order);
      expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
      expect(game.state.npcs.some((n) => n.id === row.id)).toBe(false);

      row.unlock(game);
      game.ingestParsedDialogue("steward", parsed, row.order);
      expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(1);
      game.confirmProposal(game.pending[0].id);
      expect(game.state.npcs.some((n) => n.id === row.id && n.name === row.name)).toBe(true);
      expect(game.setScene(row.id).sceneNpcId).toBe(row.id);

      const smith = parseLlmResponse(JSON.stringify({ speech: "That is Aldric's business.", proposals: [] }));
      const other = tempGame();
      row.unlock(other);
      other.ingestParsedDialogue("smith", smith, row.order);
      expect(other.state.npcs.some((n) => n.id === row.id)).toBe(false);
      other.ingestParsedDialogue("chaplain", smith, row.order);
      expect(other.state.npcs.some((n) => n.id === row.id)).toBe(false);
    }
  });

  it("does not auto-hire from a season report register_npc", () => {
    const game = tempGame();
    unlockOtto(game);
    game.applySeasonProposals(
      [
        {
          type: "register_npc",
          summary: "Hire Otto",
          isNew: true,
          npc: { id: "village_reeve", name: "Otto", role: "village_reeve", location: "fontenay", memories: [], wantsTalk: false },
        },
      ],
      [],
      [],
    );
    expect(game.state.npcs.some((n) => n.id === "village_reeve")).toBe(false);
    expect(game.state.npcs).toHaveLength(4);
  });

  it("recommends Hildegard when a textile workshop is confirmed, without inserting her", () => {
    const game = tempGame();
    const parsed = parseLlmResponse(
      JSON.stringify({
        speech: "We can raise a textile workshop.",
        proposals: [
          {
            type: "register_feature",
            summary: "Record the textile workshop",
            holdingId: "fontenay",
            feature: "textile_workshop",
            isNew: true,
          },
        ],
      }),
    );
    game.ingestParsedDialogue("steward", parsed, "Record the textile workshop on the holding.");
    game.confirmProposal(game.pending[0].id);
    expect(game.state.holdings[0].features).toContain("textile_workshop");
    expect(game.messages.some((m) => /Hildegard/.test(m.text))).toBe(true);
    expect(game.state.npcs.some((n) => n.id === "head_seamstress")).toBe(false);
  });
});

describe("Gerulf hunt via Confirm", () => {
  it("injects Gerulf when loading a save that predates him", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isekai-"));
    const state = WorldStateSchema.parse(structuredClone(startingEstate));
    state.npcs = state.npcs.filter((n) => n.id !== "negotiator");
    const game = new GameController(state, dir, defaultAppSettings());
    expect(game.state.npcs.some((n) => n.id === "negotiator" && n.name === "Gerulf")).toBe(true);
  });

  it("queues a find proposal, escrows the purse on Confirm, and marks Gerulf on the road", () => {
    const game = tempGame();
    const chest = game.state.resources.denarii;
    expect(game.setScene("negotiator").sceneNpcId).toBe("negotiator");
    const parsed = parseLlmResponse(JSON.stringify({ speech: "Pepper. I will name the purse.", proposals: [] }));
    game.ingestParsedDialogue("negotiator", parsed, "Find me pepper.");
    const pending = game.pending.filter((p) => p.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].proposal.type).toBe("start_hunt");
    expect(pending[0].npcId).toBe("negotiator");
    if (pending[0].proposal.type !== "start_hunt") throw new Error("expected start_hunt");
    const quote = pending[0].proposal.quotedDenarii;
    expect(quote).toBeGreaterThan(0);
    expect(game.state.resources.denarii).toBe(chest);
    expect(game.state.projects).toHaveLength(0);

    const result = game.confirmProposal(pending[0].id);
    expect(result.error).toBeUndefined();
    expect(game.state.resources.denarii).toBe(chest - quote);
    const hunt = game.state.projects.find((p) => p.tag === "hunt");
    expect(hunt?.status).toBe("active");
    expect(hunt?.hunt?.goods).toMatch(/pepper/i);
    expect(hunt?.hunt?.escrowedDenarii).toBe(quote);
    expect(game.state.npcs.find((n) => n.id === "negotiator")?.location).toBe("road");
    expect(worldFile(game).projects.some((p: { tag?: string }) => p.tag === "hunt")).toBe(true);
  });

  it("does not take a second brief while he is out, and engine speech reports a successful return", () => {
    const game = tempGame();
    const parsed = parseLlmResponse(JSON.stringify({ speech: "I will go.", proposals: [] }));
    game.ingestParsedDialogue("negotiator", parsed, "Find me pepper.");
    game.confirmProposal(game.pending[0].id);
    const duration = game.state.projects.find((p) => p.hunt)?.hunt?.durationSeasons ?? 2;

    game.ingestParsedDialogue("negotiator", parsed, "Find me silk instead.");
    expect(game.pending.filter((p) => p.status === "pending" && p.proposal.type === "start_hunt")).toHaveLength(0);
    expect(game.messages.some((m) => /already on the road|mid-hunt/i.test(m.text))).toBe(true);

    vi.spyOn(Math, "random").mockReturnValue(0.1);
    for (let i = 0; i < duration; i++) {
      resolveAgricultureAndProjects(game.state);
    }
    vi.restoreAllMocks();
    expect(game.state.projects.find((p) => p.hunt)?.hunt?.reportSpeech).toMatch(/I have it, my lord/i);
    expect(game.state.custom_resources.some((c) => c.id === "pepper" && c.amount > 0)).toBe(true);
    expect(game.state.npcs.find((n) => n.id === "negotiator")?.location).toBe("fontenay");
  });

  it("buys iron on Confirm: the purse leaves, and the return puts iron in the stores", () => {
    const game = tempGame();
    const chest = game.state.resources.denarii;
    const iron = game.state.resources.iron;
    const parsed = parseLlmResponse(JSON.stringify({ speech: "Iron. I will name the purse.", proposals: [] }));
    game.ingestParsedDialogue("negotiator", parsed, "Find me 4 pounds of iron for the work.");
    const pending = game.pending.filter((p) => p.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].proposal.type).toBe("start_hunt");
    expect(pending[0].npcId).toBe("negotiator");
    if (pending[0].proposal.type !== "start_hunt") throw new Error("expected start_hunt");
    const quote = pending[0].proposal.quotedDenarii;
    const amount = pending[0].proposal.amount;
    expect(quote).toBe(ordinaryHuntPurse(game.state.market.iron.max, amount));
    expect(quote).toBe(Math.round(amount * game.state.market.iron.max * 1.1));
    expect(game.state.resources.denarii).toBe(chest);
    expect(game.state.resources.iron).toBe(iron);

    const result = game.confirmProposal(pending[0].id);
    expect(result.error).toBeUndefined();
    expect(game.state.resources.denarii).toBe(chest - quote);
    expect(game.state.npcs.find((n) => n.id === "negotiator")?.location).toBe("road");

    game.ingestParsedDialogue("negotiator", parsed, "Find me salt instead.");
    expect(game.pending.filter((p) => p.status === "pending" && p.proposal.type === "start_hunt")).toHaveLength(0);
    expect(game.messages.some((m) => /already on the road/i.test(m.text))).toBe(true);

    vi.spyOn(Math, "random").mockReturnValue(0.1);
    const duration = game.state.projects.find((p) => p.hunt)?.hunt?.durationSeasons ?? 1;
    for (let i = 0; i < duration; i++) resolveAgricultureAndProjects(game.state);
    vi.restoreAllMocks();
    expect(game.state.resources.iron).toBe(iron + amount);
    expect(game.state.resources.denarii).toBe(chest - quote);
  });

  it("ignores an invented purse: identical buys share one price, Confirm spends it, Deny spends nothing", () => {
    const ask = "Buy 4 pounds of iron. I cannot wait for a merchant.";
    const invented = (denarii: number) =>
      parseLlmResponse(
        JSON.stringify({
          speech: `Aye. Give me ${denarii} denarii.`,
          proposals: [
            {
              type: "start_hunt",
              summary: "Fetch iron",
              goods: "iron",
              resource: "iron",
              amount: 4,
              quotedDenarii: denarii,
              durationSeasons: 1,
            },
          ],
        }),
      );

    const confirmGame = tempGame();
    const chest = confirmGame.state.resources.denarii;
    const iron = confirmGame.state.resources.iron;
    confirmGame.ingestParsedDialogue("negotiator", invented(42), ask);
    const denyGame = tempGame();
    denyGame.ingestParsedDialogue("negotiator", invented(28), ask);

    const confirmed = confirmGame.pending.filter((p) => p.status === "pending");
    const denied = denyGame.pending.filter((p) => p.status === "pending");
    expect(confirmed).toHaveLength(1);
    expect(denied).toHaveLength(1);
    expect(confirmed[0].proposal.type).toBe("start_hunt");
    expect(denied[0].proposal.type).toBe("start_hunt");
    if (confirmed[0].proposal.type !== "start_hunt" || denied[0].proposal.type !== "start_hunt") {
      throw new Error("expected start_hunt");
    }
    const price = ordinaryHuntPurse(confirmGame.state.market.iron.max, 4);
    expect(confirmed[0].proposal.quotedDenarii).toBe(price);
    expect(denied[0].proposal.quotedDenarii).toBe(price);
    expect(confirmed[0].proposal.quotedDenarii).not.toBe(42);
    expect(denied[0].proposal.quotedDenarii).not.toBe(28);
    expect(confirmGame.state.resources.denarii).toBe(chest);
    expect(denyGame.state.resources.denarii).toBe(chest);

    denyGame.rejectProposal(denied[0].id);
    expect(denyGame.state.resources.denarii).toBe(chest);
    expect(denyGame.state.resources.iron).toBe(iron);
    expect(denyGame.state.projects).toHaveLength(0);

    const result = confirmGame.confirmProposal(confirmed[0].id);
    expect(result.error).toBeUndefined();
    expect(confirmGame.state.resources.denarii).toBe(chest - price);
    expect(confirmGame.state.resources.iron).toBe(iron);
    expect(confirmGame.state.npcs.find((n) => n.id === "negotiator")?.location).toBe("road");
  });

  it("refuses 35 lb of iron in hall language when the chest cannot pay, and takes nothing", () => {
    const game = tempGame();
    const chest = game.state.resources.denarii;
    const parsed = parseLlmResponse(
      JSON.stringify({
        speech: "Aye. I'll fetch 35 pounds of iron for 42 denarii.",
        proposals: [
          {
            type: "start_hunt",
            summary: "Fetch iron",
            goods: "iron",
            resource: "iron",
            amount: 35,
            quotedDenarii: 28,
            durationSeasons: 1,
          },
        ],
      }),
    );
    game.ingestParsedDialogue("negotiator", parsed, "Buy 35 lb of iron. I cannot wait for a merchant.");
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
    expect(game.state.resources.denarii).toBe(chest);
    expect(game.state.projects).toHaveLength(0);
    expect(game.messages.some((m) => /cannot spare/i.test(m.text) && /take nothing/i.test(m.text))).toBe(true);
    expect(game.messages.some((m) => /\b42\b/.test(m.text) || /\b28\b/.test(m.text))).toBe(false);
    expect(game.messages.some((m) => /308 denarii/.test(m.text))).toBe(true);
  });

  it("honors a named difficulty and treats 14x as no difficulty", () => {
    const ask = "Buy 4 pounds of iron. I cannot wait for a merchant.";
    const difficult = Math.round(4 * 8 * 1.7);
    const easy = Math.round(4 * 8 * 1.1);
    const game = tempGame();
    game.ingestParsedDialogue(
      "negotiator",
      parseLlmResponse(
        JSON.stringify({
          speech: "A hard road.",
          proposals: [
            {
              type: "start_hunt",
              summary: "Fetch iron",
              goods: "iron",
              resource: "iron",
              amount: 4,
              quotedDenarii: 28,
              difficulty: "difficult",
              durationSeasons: 1,
            },
          ],
        }),
      ),
      ask,
    );
    const pending = game.pending.filter((p) => p.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].proposal).toMatchObject({
      type: "start_hunt",
      quotedDenarii: difficult,
      difficulty: "difficult",
    });
    if (pending[0].proposal.type !== "start_hunt") throw new Error("expected start_hunt");
    expect(pending[0].proposal.quotedDenarii).not.toBe(28);

    const bogus = tempGame();
    bogus.ingestParsedDialogue(
      "negotiator",
      parseLlmResponse(
        JSON.stringify({
          speech: "Aye.",
          proposals: [
            {
              type: "start_hunt",
              summary: "Fetch iron",
              goods: "iron",
              resource: "iron",
              amount: 4,
              quotedDenarii: 28,
              difficulty: "14x",
              durationSeasons: 1,
            },
          ],
        }),
      ),
      ask,
    );
    const dropped = bogus.pending.filter((p) => p.status === "pending");
    expect(dropped).toHaveLength(1);
    expect(dropped[0].proposal).toMatchObject({
      type: "start_hunt",
      quotedDenarii: easy,
      difficulty: "easy",
    });
    expect(easy).toBe(ordinaryHuntPurse(8, 4, "easy"));

    const saltGame = tempGame();
    saltGame.state.resources.denarii = 200;
    saltGame.ingestParsedDialogue(
      "negotiator",
      parseLlmResponse(
        JSON.stringify({
          speech: "Salt.",
          proposals: [
            {
              type: "start_hunt",
              summary: "Fetch salt",
              goods: "salt",
              resource: "salt",
              amount: 19,
              quotedDenarii: 10,
              difficulty: "difficult",
              durationSeasons: 1,
            },
          ],
        }),
      ),
      "Buy 19 lb of salt.",
    );
    const saltCard = saltGame.pending.filter((p) => p.status === "pending");
    expect(saltCard).toHaveLength(1);
    if (saltCard[0].proposal.type !== "start_hunt") throw new Error("expected start_hunt");
    const saltPrice = ordinaryHuntPurse(saltGame.state.market.salt.max, 19, "difficult");
    expect(saltCard[0].proposal.quotedDenarii).toBe(saltPrice);
    expect(saltCard[0].proposal.difficulty).toBe("difficult");
    const chest = saltGame.state.resources.denarii;
    expect(saltGame.confirmProposal(saltCard[0].id).error).toBeUndefined();
    expect(saltGame.state.resources.denarii).toBe(chest - saltPrice);

    const poor = tempGame();
    const poorChest = poor.state.resources.denarii;
    poor.ingestParsedDialogue(
      "negotiator",
      parseLlmResponse(
        JSON.stringify({
          speech: "A hard road.",
          proposals: [
            {
              type: "start_hunt",
              summary: "Fetch salt",
              goods: "salt",
              resource: "salt",
              amount: 19,
              quotedDenarii: 10,
              difficulty: "difficult",
              durationSeasons: 1,
            },
          ],
        }),
      ),
      "Buy 19 lb of salt.",
    );
    expect(poor.pending.filter((p) => p.status === "pending")).toHaveLength(0);
    expect(poor.state.resources.denarii).toBe(poorChest);
    expect(poor.state.projects).toHaveLength(0);
    expect(poor.messages.some((m) => m.text.includes(`${saltPrice} denarii`) && /take nothing/i.test(m.text))).toBe(true);
    expect(ordinaryHuntPurse(poor.state.market.salt.max, 19, "easy")).toBeLessThanOrEqual(poorChest);
  });
});

describe("Bernard's bloomery", () => {
  it("does not propose a bloomery from the opening chest", () => {
    const game = tempGame();
    const parsed = parseLlmResponse(JSON.stringify({ speech: "The hearth is thin.", proposals: [] }));
    game.ingestParsedDialogue("smith", parsed, "Build a bloomery.");
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
    expect(game.messages.some((m) => /not yet/i.test(m.text) && /charcoal/i.test(m.text))).toBe(true);
    expect(game.state.holdings[0].features).not.toContain("bloomery");
  });

  it("explains bog ore in plain words", () => {
    const game = tempGame();
    const parsed = parseLlmResponse(JSON.stringify({ speech: "Ask, and I will say.", proposals: [] }));
    game.ingestParsedDialogue("smith", parsed, "What is bog ore?");
    expect(game.messages.some((m) => /rusty mud/i.test(m.text) && /bloomery/i.test(m.text))).toBe(true);
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
  });

  it("puts a bloomery on the table once charcoal and the chest allow, and Confirm only sets the stores aside", () => {
    const game = tempGame();
    game.state.resources.charcoal = 6;
    game.state.resources.denarii = 180;
    game.state.resources.softwood = 8;
    game.state.resources.stone = 4;
    const parsed = parseLlmResponse(JSON.stringify({ speech: "The hearth is ready for a word.", proposals: [] }));
    game.ingestParsedDialogue("smith", parsed, "Good day, Bernard.");
    const pending = game.pending.filter((p) => p.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].proposal).toMatchObject({ type: "start_project", projectKey: "bloomery" });
    expect(game.messages.some((m) => /bloomery/i.test(m.text) && /clay/i.test(m.text))).toBe(true);
    expect(game.state.holdings[0].features).not.toContain("bloomery");

    const charcoal = game.state.resources.charcoal;
    const result = game.confirmProposal(pending[0].id);
    expect(result.error).toBeUndefined();
    expect(game.state.projects.some((p) => p.key === "bloomery" && p.status === "active")).toBe(true);
    expect(game.state.resources.charcoal).toBeLessThan(charcoal);
    expect(game.state.holdings[0].features).not.toContain("bloomery");
  });
});

