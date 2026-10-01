import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { applyProposal } from "../engine/applyDelta";
import { yieldMultiplier } from "../engine/modifiers";
import { WorldStateSchema, type MechanicalProposal } from "../engine/schema";
import {
  ALDRIC_PLOUGH_ALREADY,
  ALDRIC_PLOUGH_UNFINISHED,
  ALDRIC_TURNING_PLOUGH,
  BERNARD_HARVEST_REDIRECT,
  IMPROVEMENT_ALREADY,
  TURNING_PLOUGH_YIELD,
} from "../engine/toolImprovement";
import { parseLlmResponse } from "../llm/parse";
import { defaultAppSettings } from "../llm/settings";
import { GameController } from "./game";

function tempGame() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isekai-"));
  const state = WorldStateSchema.parse(structuredClone(startingEstate));
  return new GameController(state, dir, defaultAppSettings());
}

function modifier(target: "grain_yield" | "labour_efficiency" | "mood", value: number, op: "multiply" | "add" = "multiply"): MechanicalProposal {
  return {
    type: "add_modifier",
    summary: "A change in the work",
    target,
    kind: "permanent",
    effect: { op, value },
    source: "The people use the new tool",
  };
}

describe("tool improvements wait on Aldric", () => {
  it("writes nothing until the lord tells Aldric to put the people on the tool", () => {
    const game = tempGame();
    const before = yieldMultiplier(game.state);
    const parsed = parseLlmResponse(
      JSON.stringify({
        speech: "The fields will give a quarter more.",
        proposals: [modifier("grain_yield", 2)],
      }),
    );
    game.ingestParsedDialogue("steward", parsed, "Bernard has forged the new tool.");
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
    expect(game.state.modifiers).toEqual([]);
    expect(yieldMultiplier(game.state)).toBe(before);
  });

  it("uses the figure Aldric names, and does not stack that kind again", () => {
    const game = tempGame();
    const parsed = parseLlmResponse(
      JSON.stringify({
        speech: "Put them to it, and the fields will give a quarter more.",
        proposals: [modifier("grain_yield", 2)],
      }),
    );
    game.ingestParsedDialogue("steward", parsed, "Put the people onto the new tool.");
    const card = game.pending.find((p) => p.status === "pending");
    expect(card?.proposal.type).toBe("add_modifier");
    if (card?.proposal.type !== "add_modifier") throw new Error("expected a modifier card");
    expect(card.proposal.effect).toEqual({ op: "multiply", value: 1.25 });

    const written = game.confirmProposal(card.id);
    expect(written.error).toBeUndefined();
    expect(game.state.modifiers[0]?.effect.value).toBe(1.25);
    expect(yieldMultiplier(game.state)).toBeCloseTo(1.25);

    const again = parseLlmResponse(
      JSON.stringify({
        speech: "Another quarter more on the fields.",
        proposals: [modifier("grain_yield", 1.25)],
      }),
    );
    game.ingestParsedDialogue("steward", again, "Put the people onto the new tool.");
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
    expect(game.messages.some((m) => m.text === IMPROVEMENT_ALREADY)).toBe(true);
    expect(yieldMultiplier(game.state)).toBeCloseTo(1.25);

    const hands = parseLlmResponse(
      JSON.stringify({
        speech: "The same hands will finish a fifth more of the work.",
        proposals: [modifier("labour_efficiency", 2)],
      }),
    );
    game.ingestParsedDialogue("steward", hands, "Put the people onto the new tool.");
    const labour = game.pending.find((p) => p.status === "pending");
    expect(labour?.proposal.type).toBe("add_modifier");
    if (labour?.proposal.type !== "add_modifier") throw new Error("expected a labour card");
    expect(labour.proposal.target).toBe("labour_efficiency");
    expect(labour.proposal.effect).toEqual({ op: "multiply", value: 1.2 });
  });

  it("leaves the book's figure alone when speech names none", () => {
    const game = tempGame();
    const parsed = parseLlmResponse(
      JSON.stringify({
        speech: "The hands will get through more of the work.",
        proposals: [modifier("labour_efficiency", 1.15)],
      }),
    );
    game.ingestParsedDialogue("steward", parsed, "Put the people onto the new tool.");
    const card = game.pending.find((p) => p.status === "pending");
    expect(card?.proposal.type).toBe("add_modifier");
    if (card?.proposal.type !== "add_modifier") throw new Error("expected a modifier card");
    expect(card.proposal.effect.value).toBe(1.15);
  });

  it("still takes a sowing order and a blessing beside a tool the lord has not put people on", () => {
    const game = tempGame();
    const parsed = parseLlmResponse(
      JSON.stringify({
        speech: "Barley on the remaining share. The tool can wait.",
        proposals: [
          { type: "adjust_sowing", summary: "Sow more barley", holdingId: "fontenay", springBarleyShare: 0.85 },
          modifier("grain_yield", 1.25),
        ],
      }),
    );
    game.ingestParsedDialogue("steward", parsed, "Sow more barley on the remaining acres.");
    const pending = game.pending.filter((p) => p.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].proposal.type).toBe("adjust_sowing");

    const blessing = parseLlmResponse(
      JSON.stringify({
        speech: "A word to the household.",
        proposals: [modifier("mood", 1, "add")],
      }),
    );
    game.ingestParsedDialogue("steward", blessing, "Give the household a blessing.");
    expect(game.pending.filter((p) => p.status === "pending").some((p) => p.proposal.type === "add_modifier")).toBe(true);
  });

  it("gives one fifth more grain only after a finished turning plough is put to use", () => {
    const game = tempGame();
    expect(yieldMultiplier(game.state)).toBe(1);
    expect(game.state.modifiers).toEqual([]);

    const order = "Put the people onto the new plough.";
    const ask = () =>
      parseLlmResponse(
        JSON.stringify({
          speech: "The fields will give a quarter more.",
          proposals: [modifier("grain_yield", 2)],
        }),
      );

    game.ingestParsedDialogue("steward", ask(), order);
    expect(game.state.modifiers).toEqual([]);
    expect(yieldMultiplier(game.state)).toBe(1);
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
    expect(game.messages.some((m) => m.text === ALDRIC_PLOUGH_UNFINISHED)).toBe(true);

    const started = applyProposal(
      game.state,
      {
        type: "start_project",
        summary:
          "One plough of a new design: a long heavy coulter, a wider one-sided share, an iron-shod wooden board, and a socketed replaceable share.",
        projectKey: "heavy_coulter_plough",
        name: "Heavy coulter plough",
        holdingId: "fontenay",
        customCosts: { labourDays: 12, lumber: 2, iron: 8, stone: 0, charcoal: 1 },
      },
      "smith",
    );
    expect(started.ok).toBe(true);
    expect(yieldMultiplier(game.state)).toBe(1);

    game.ingestParsedDialogue("steward", ask(), order);
    expect(game.state.modifiers).toEqual([]);
    expect(game.pending.filter((p) => p.status === "pending" && p.proposal.type === "add_modifier")).toHaveLength(0);

    const made = game.state.projects.find((p) => p.key === "heavy_coulter_plough");
    if (!made) throw new Error("expected the plough");
    expect(made.notes).toMatch(/turns the earth/i);
    made.status = "completed";
    expect(yieldMultiplier(game.state)).toBe(1);

    game.ingestParsedDialogue("steward", ask(), order);
    const card = game.pending.find((p) => p.status === "pending" && p.proposal.type === "add_modifier");
    expect(card?.proposal.type).toBe("add_modifier");
    if (card?.proposal.type !== "add_modifier") throw new Error("expected the grain card");
    expect(card.proposal.target).toBe("grain_yield");
    expect(card.proposal.effect).toEqual({ op: "multiply", value: TURNING_PLOUGH_YIELD });
    expect(game.messages.some((m) => m.text === ALDRIC_TURNING_PLOUGH)).toBe(true);
    expect(yieldMultiplier(game.state)).toBe(1);

    const written = game.confirmProposal(card.id);
    expect(written.error).toBeUndefined();
    expect(game.state.modifiers.filter((m) => m.target === "grain_yield")).toHaveLength(1);
    expect(yieldMultiplier(game.state)).toBeCloseTo(1.2);

    game.ingestParsedDialogue("steward", ask(), order);
    expect(game.pending.filter((p) => p.status === "pending" && p.proposal.type === "add_modifier")).toHaveLength(0);
    expect(game.messages.some((m) => m.text === ALDRIC_PLOUGH_ALREADY)).toBe(true);
    expect(game.state.modifiers.filter((m) => m.target === "grain_yield")).toHaveLength(1);
    expect(yieldMultiplier(game.state)).toBeCloseTo(1.2);
  });

  it("sends a harvest question to Aldric and writes no yield", async () => {
    const game = tempGame();
    const spy = vi.spyOn(game as unknown as { callLlm: (...args: unknown[]) => Promise<unknown> }, "callLlm");
    spy.mockResolvedValue({
      speech: "The wheat will stand thicker, my lord.",
      emotion: "thoughtful",
      proposals: [modifier("grain_yield", 1.2)],
      raw: "{}",
      parseErrors: [],
    });
    const before = yieldMultiplier(game.state);
    await game.sendDialogue("smith", "How will the harvest fare with the new tool?");
    expect(game.messages.some((m) => m.npcId === "smith" && m.role === "npc" && m.text === BERNARD_HARVEST_REDIRECT)).toBe(true);
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
    expect(game.state.modifiers).toEqual([]);
    expect(yieldMultiplier(game.state)).toBe(before);
  });

  it("drops a field yield Bernard proposes and still points at Aldric", () => {
    const game = tempGame();
    const parsed = parseLlmResponse(
      JSON.stringify({
        speech: "I will write the fields myself.",
        proposals: [modifier("grain_yield", 1.25)],
      }),
    );
    game.ingestParsedDialogue("smith", parsed, "How will the harvest fare once they use it?");
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
    expect(game.messages.some((m) => m.npcId === "smith" && m.text === BERNARD_HARVEST_REDIRECT)).toBe(true);
    expect(game.state.modifiers).toEqual([]);
  });
});
