import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { WorldStateSchema } from "../engine/schema";
import { HOLD_AT_ONCE_APOLOGY } from "../llm/providerErrors";
import { CHECK_RECORDS_LINE, RECALL_DEALS_LINE } from "../llm/toolProtocol";
import { defaultAppSettings } from "../llm/settings";

const llmChatMock = vi.hoisted(() => vi.fn());

vi.mock("../llm", () => ({
  llmChat: (...args: unknown[]) => llmChatMock(...args),
}));

import { GameController } from "./game";

function tempGame() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isekai-"));
  const state = WorldStateSchema.parse(structuredClone(startingEstate));
  return new GameController(state, dir, defaultAppSettings());
}

function speechJson(speech: string) {
  return JSON.stringify({ speech, emotion: "respectful", proposals: [] });
}

function grainGiveJson() {
  return JSON.stringify({
    speech: "Two modii of rye to the cell.",
    emotion: "thoughtful",
    proposals: [
      {
        type: "transfer_resources",
        summary: "Grain to the cell",
        resource: "rye",
        amount: 2,
        direction: "consume",
      },
    ],
  });
}

function lastTurn(game: GameController) {
  const idx = game.messages.map((m) => m.role).lastIndexOf("player");
  return idx < 0 ? [] : game.messages.slice(idx);
}

function callText(index: number) {
  const messages = llmChatMock.mock.calls[index][1] as { content: string }[];
  return messages.map((m) => m.content).join("\n");
}

describe("mid-season hidden ledger tools", () => {
  beforeEach(() => {
    llmChatMock.mockReset();
  });

  it("strips the tool marker from the bubble and has Aldric check the records", async () => {
    const game = tempGame();
    llmChatMock.mockResolvedValueOnce("The rye is in store.\n<=-tool: grain -=>");
    llmChatMock.mockResolvedValueOnce("Eight modii of rye remain, my lord.");
    await game.sendDialogue("steward", "How much rye do we hold?");
    const turn = lastTurn(game);
    expect(turn.some((m) => m.role === "npc" && m.text === CHECK_RECORDS_LINE)).toBe(true);
    expect(turn.some((m) => m.role === "npc" && /Eight modii of rye remain/.test(m.text))).toBe(true);
    expect(turn.every((m) => !/<=-tool:/.test(m.text))).toBe(true);
    expect(turn.some((m) => /The rye is in store/.test(m.text))).toBe(false);
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
  });

  it("thinks back on a memory-only my_deals pull and fills that drawer", async () => {
    const game = tempGame();
    game.state.npcs.find((n) => n.id === "steward")!.memories.push({
      turn: 1,
      year: 825,
      season: "spring",
      summary: "The lord ordered more barley sown on the remaining spring acres.",
    });
    llmChatMock.mockResolvedValueOnce("<=-tool: my_deals -=>");
    llmChatMock.mockResolvedValueOnce("Aye — you asked me to sow more barley, my lord.");
    await game.sendDialogue("steward", "Do you remember the sowing?");
    const turn = lastTurn(game);
    expect(turn.some((m) => m.role === "npc" && m.text === RECALL_DEALS_LINE)).toBe(true);
    expect(turn.every((m) => m.text !== CHECK_RECORDS_LINE)).toBe(true);
    expect(turn.some((m) => m.role === "npc" && /more barley/.test(m.text))).toBe(true);
    expect(turn.every((m) => !/<=-tool:/.test(m.text))).toBe(true);
    expect(llmChatMock).toHaveBeenCalledTimes(2);
    const facts = callText(1);
    expect(facts).toMatch(/more barley sown/);
    expect(facts).toMatch(/"my_deals"/);
    expect(facts).toMatch(/recall past dealings/i);
  });

  it("keeps the records holding line when grain is pulled with my_deals", async () => {
    const game = tempGame();
    game.state.npcs.find((n) => n.id === "steward")!.memories.push({
      turn: 1,
      year: 825,
      season: "spring",
      summary: "The lord ordered more barley sown on the remaining spring acres.",
    });
    llmChatMock.mockResolvedValueOnce("<=-tool: grain, my_deals -=>");
    llmChatMock.mockResolvedValueOnce("Eight modii of rye remain, my lord.");
    await game.sendDialogue("steward", "How much rye, and do you remember our deals?");
    const turn = lastTurn(game);
    expect(turn.some((m) => m.text === CHECK_RECORDS_LINE)).toBe(true);
    expect(turn.every((m) => m.text !== RECALL_DEALS_LINE)).toBe(true);
    expect(llmChatMock).toHaveBeenCalledTimes(2);
    const facts = callText(1);
    expect(facts).toMatch(/"rye"\s*:\s*8/);
    expect(facts).toMatch(/"my_deals"/);
    expect(facts).toMatch(/check the records/i);
  });

  it("treats a memories alias as a memory-only think pull", async () => {
    const game = tempGame();
    llmChatMock.mockResolvedValueOnce("<=-tool: memories -=>");
    llmChatMock.mockResolvedValueOnce("I remember no bargains yet, my lord.");
    await game.sendDialogue("steward", "What have we settled?");
    expect(lastTurn(game).some((m) => m.text === RECALL_DEALS_LINE)).toBe(true);
    expect(lastTurn(game).every((m) => m.text !== CHECK_RECORDS_LINE)).toBe(true);
    expect(callText(1)).toMatch(/"my_deals"/);
  });

  it("fills grain and chest together from a batch marker", async () => {
    const game = tempGame();
    llmChatMock.mockResolvedValueOnce("<=-tool: grain, chest -=>");
    llmChatMock.mockResolvedValueOnce("The chest holds ninety-six denarii, and the rye is eight modii.");
    await game.sendDialogue("steward", "How fare the chest and the grain?");
    expect(llmChatMock).toHaveBeenCalledTimes(2);
    const facts = callText(1);
    expect(facts).toMatch(/"rye"\s*:\s*8/);
    expect(facts).toMatch(/"denarii"\s*:\s*96/);
    expect(facts).toMatch(/RECORD DRAWERS/);
  });

  it("ignores an unknown drawer without crashing", async () => {
    const game = tempGame();
    llmChatMock.mockResolvedValueOnce("<=-tool: grain, not_a_drawer -=>");
    llmChatMock.mockResolvedValueOnce("Eight modii of rye, my lord.");
    await game.sendDialogue("steward", "How much rye do we hold?");
    expect(llmChatMock).toHaveBeenCalledTimes(2);
    const factsUser = (llmChatMock.mock.calls[1][1] as { role: string; content: string }[]).filter(
      (m) => m.role === "user",
    ).at(-1)!.content;
    expect(factsUser).toMatch(/"rye"\s*:\s*8/);
    expect(factsUser).not.toMatch(/not_a_drawer/);
    expect(lastTurn(game).some((m) => m.text === CHECK_RECORDS_LINE)).toBe(true);
  });

  it("quietly fetches grain when an order cites rye without that drawer", async () => {
    const game = tempGame();
    llmChatMock.mockResolvedValueOnce(speechJson("The brothers will have bread."));
    llmChatMock.mockResolvedValueOnce(grainGiveJson());
    llmChatMock.mockResolvedValueOnce(grainGiveJson());
    await game.sendDialogue("steward", "Give the cell two modii of rye.");
    expect(llmChatMock).toHaveBeenCalledTimes(3);
    const repair = callText(2);
    expect(repair).toMatch(/"rye"\s*:\s*8/);
    expect(repair).toMatch(/missing drawers|fetched these missing/i);
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(1);
    expect(game.pending[0].proposal).toMatchObject({ type: "transfer_resources", resource: "rye", amount: 2 });
    expect(lastTurn(game).some((m) => /The brothers will have bread/.test(m.text))).toBe(true);
    expect(lastTurn(game).every((m) => m.text !== "")).toBe(true);
  });

  it("apologizes as the NPC when the tool marker is chopped — no Confirm, books untouched", async () => {
    const game = tempGame();
    const ryeBefore = game.state.resources.rye;
    llmChatMock.mockResolvedValueOnce("Let me see the stores.\n<=-tool: grain, chest");
    await game.sendDialogue("steward", "How much rye do we hold?");
    expect(llmChatMock).toHaveBeenCalledTimes(1);
    const turn = lastTurn(game);
    expect(turn.map((m) => m.role)).toEqual(["player", "npc"]);
    expect(turn[1].text).toBe(HOLD_AT_ONCE_APOLOGY);
    expect(turn.some((m) => m.role === "system")).toBe(false);
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
    expect(game.state.resources.rye).toBe(ryeBefore);
  });

  it("apologizes as the NPC when quiet repair JSON is chopped — no Confirm", async () => {
    const game = tempGame();
    llmChatMock.mockResolvedValueOnce(speechJson("The brothers will have bread."));
    llmChatMock.mockResolvedValueOnce(grainGiveJson());
    llmChatMock.mockResolvedValueOnce(`{ "speech": "Two modii", "proposals": [ { "type": "transfer_resources"`);
    await game.sendDialogue("steward", "Give the cell two modii of rye.");
    expect(llmChatMock).toHaveBeenCalledTimes(3);
    const turn = lastTurn(game);
    expect(turn.some((m) => m.role === "npc" && m.text === HOLD_AT_ONCE_APOLOGY)).toBe(true);
    expect(turn.some((m) => m.role === "system")).toBe(false);
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
  });

  it("sends the season chronicler a skinny deltas pack, not the market or empty stores", async () => {
    const game = tempGame();
    llmChatMock.mockResolvedValueOnce(
      JSON.stringify({
        speech: "The harvest is gathered, my lord.",
        emotion: "respectful",
        proposals: [{ type: "event_effect", eventId: "w-yield", summary: "Fair weather.", moodDelta: 1 }],
      }),
    );
    await game.advanceSeason();
    expect(llmChatMock).toHaveBeenCalledTimes(1);
    const user = callText(0);
    expect(user).toMatch(/ENGINE LEDGER/);
    expect(user).toMatch(/"deltas"/);
    expect(user).toMatch(/"totals"/);
    expect(user).not.toMatch(/"market"/);
    expect(user).not.toMatch(/last_chance/);
    expect(user).not.toMatch(/"poultry": 0/);
    expect(user).not.toMatch(/WORLD STATE SLICE/);
  });
});
