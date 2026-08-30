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
    expect(game.state.last_season_deltas.sown_barley).toBe(1.8);
    expect(Object.keys(game.state.last_season_deltas).length).toBeGreaterThan(0);
    const smith = game.setScene("smith");
    expect(smith.messages.some((m) => /harvest is gathered|Season written/.test(m.text))).toBe(false);
    expect(smith.messages.some((m) => opening.test(m.text))).toBe(false);
  });

  it("does not leak steward chat onto an empty merchant tab", () => {
    const game = tempGame();
    game.state.flags.merchant_present = true;
    game.state.merchant.present = true;
    game.state.merchant.name = "Gero";
    game.state.npcs.push({ id: "merchant", name: "Gero", role: "merchant", location: "fontenay", memories: [] });
    const merchant = game.setScene("merchant");
    expect(merchant.sceneNpcId).toBe("merchant");
    expect(merchant.messages).toHaveLength(0);
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
});

describe("hire specialists via Aldric Confirm", () => {
  it("starts Fontenay with only Aldric, Bernard, and Ermenald", () => {
    const state = WorldStateSchema.parse(structuredClone(startingEstate));
    expect(state.npcs.map((n) => n.id).sort()).toEqual(["chaplain", "smith", "steward"]);
    expect(state.npcs.map((n) => n.name)).toEqual(["Aldric", "Bernard", "Ermenald"]);
    expect(state.npcs.some((n) => /colman|haimo|gerold|hugo|otto|ambrosius|hildegard|lorenzo|eberhard/i.test(n.name))).toBe(false);
    expect(state.npcs.some((n) => /quarry|carpenter|mason|potter|reeve|vinedresser|seamstress|copper|captain/i.test(n.role))).toBe(false);
  });

  it("does not hire on speech-only talk about needing a carpenter", () => {
    const game = tempGame();
    const before = cloneState(game.state);
    const parsed = parseLlmResponse(JSON.stringify({ speech: "The rye stands well, my lord.", proposals: [] }));
    game.ingestParsedDialogue("steward", parsed, "How fares the rye?");
    expect(game.state.npcs).toHaveLength(3);
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
    expect(game.state.npcs).toHaveLength(3);
    expect(game.state.resources.denarii).toBe(denariiBefore);

    const result = game.confirmProposal(pending[0].id);
    expect(result.error).toBeUndefined();
    const haimo = game.state.npcs.find((n) => n.id === "carpenter");
    expect(haimo).toMatchObject({ name: "Haimo", role: "carpenter", location: "fontenay" });
    expect(haimo?.memories.some((m) => /Haimo|carpenter/i.test(m.summary))).toBe(true);
    expect(game.state.npcs.find((n) => n.id === "steward")?.memories.some((m) => /Haimo|carpenter/i.test(m.summary))).toBe(
      true,
    );
    expect(game.state.npcs).toHaveLength(4);
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
    expect(game.state.npcs.map((n) => n.id)).toEqual(["steward", "smith", "chaplain"]);
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(1);
  });

  it("refuses a hiring gift the chest cannot spare", () => {
    const game = tempGame();
    game.state.resources.denarii = 5;
    const parsed = parseLlmResponse(JSON.stringify({ speech: "The chest is too thin.", proposals: [] }));
    game.ingestParsedDialogue("steward", parsed, "Hire a mason for the villa.");
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
    expect(game.state.npcs).toHaveLength(3);
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
    expect(potter.messages).toHaveLength(0);
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
    expect(game.state.npcs).toHaveLength(3);
    expect(game.state.npcs.map((n) => n.id)).toEqual(["steward", "smith", "chaplain"]);
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
    expect(game.state.npcs).toHaveLength(3);
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
    expect(game.state.npcs).toHaveLength(3);
    expect(game.state.resources.denarii).toBe(denariiBefore);
    expect(worldFile(game).npcs).toHaveLength(3);

    const hire = parseLlmResponse(JSON.stringify({ speech: "I can send for Otto.", proposals: [] }));
    game.ingestParsedDialogue("steward", hire, "Hire Otto the reeve.");
    const pending = game.pending.filter((p) => p.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].proposal.type).toBe("register_npc");
    expect(game.state.npcs).toHaveLength(3);

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
    expect(game.state.npcs).toHaveLength(3);
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
          npc: { id: "village_reeve", name: "Otto", role: "village_reeve", location: "fontenay", memories: [] },
        },
      ],
      [],
      [],
    );
    expect(game.state.npcs.some((n) => n.id === "village_reeve")).toBe(false);
    expect(game.state.npcs).toHaveLength(3);
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
