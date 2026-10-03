import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { WorldStateSchema } from "../engine/schema";
import { BOOKS_NOT_TAKEN_LINE, HOLD_AT_ONCE_APOLOGY } from "../llm/providerErrors";
import { defaultAppSettings } from "../llm/settings";

const llmChatMock = vi.hoisted(() => vi.fn());

vi.mock("../llm", () => ({
  llmChat: (...args: unknown[]) => llmChatMock(...args),
}));

import { GameController } from "./game";

const RFAB_502 =
  'RFAB chat 502: {"success":false,"error":"PROVIDER_ERROR","message":"Model call failed: Grok API Error: No response received from server"}';

function tempGame() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isekai-"));
  const state = WorldStateSchema.parse(structuredClone(startingEstate));
  return new GameController(state, dir, defaultAppSettings());
}

function speechJson(speech: string) {
  return JSON.stringify({ speech, emotion: "respectful", proposals: [] });
}

function sowingJson() {
  return JSON.stringify({
    speech: "I will put more of the remaining spring share to barley.",
    emotion: "thoughtful",
    proposals: [
      {
        type: "adjust_sowing",
        summary: "Sow more barley",
        holdingId: "fontenay",
        springBarleyShare: 0.85,
      },
    ],
  });
}

function playerFacing(game: GameController) {
  return game.messages.map((m) => m.text).join("\n");
}

/** Messages from the last player line onward (one turn). */
function lastTurn(game: GameController) {
  const idx = game.messages.map((m) => m.role).lastIndexOf("player");
  return idx < 0 ? [] : game.messages.slice(idx);
}

function expectNpcApologyOnly(game: GameController, npcId = "steward") {
  const turn = lastTurn(game);
  expect(turn.map((m) => m.role)).toEqual(["player", "npc"]);
  expect(turn[1]).toMatchObject({ role: "npc", npcId, text: HOLD_AT_ONCE_APOLOGY });
  expect(turn[1].npcName).toBe(game.npcName(npcId));
  expect(turn.filter((m) => m.role === "npc")).toHaveLength(1);
  expect(turn.some((m) => m.role === "system")).toBe(false);
  expect(game.messages.some((m) => m.role === "system" && m.text.includes(HOLD_AT_ONCE_APOLOGY))).toBe(false);
}

describe("mid-season talk timeouts and two-phase NPC calls", () => {
  beforeEach(() => {
    llmChatMock.mockReset();
  });

  it("shows the engine apology on a 502 timeout and never dumps RFAB JSON or calls the model to apologize", async () => {
    const game = tempGame();
    llmChatMock.mockRejectedValueOnce(new Error(RFAB_502));
    const result = await game.sendDialogue("steward", "Sow barley, start clearing scrub, and give the cell grain.");
    expect(result.error).toBeUndefined();
    expect(llmChatMock).toHaveBeenCalledTimes(1);
    expectNpcApologyOnly(game);
    expect(playerFacing(game)).not.toMatch(/RFAB|Grok|PROVIDER_ERROR|502|world-state|success/i);
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
  });

  it("does not request proposals on a question", async () => {
    const game = tempGame();
    llmChatMock.mockResolvedValueOnce(speechJson("The rye stands well, my lord."));
    await game.sendDialogue("steward", "How fares the rye?");
    expect(llmChatMock).toHaveBeenCalledTimes(1);
    const system = String((llmChatMock.mock.calls[0][1] as { content: string }[])[0].content);
    const user = String((llmChatMock.mock.calls[0][1] as { content: string }[])[1].content);
    expect(system).toMatch(/speech-only reply/i);
    expect(system).not.toMatch(/You MUST reply with a single JSON object only/);
    expect(user).toMatch(/spoken words only/i);
    expect(user).toMatch(/No proposals array/);
    const turn = lastTurn(game);
    expect(turn[0].role).toBe("player");
    expect(turn.some((m) => m.role === "npc" && /rye stands well/.test(m.text))).toBe(true);
    expect(turn.some((m) => m.role === "system")).toBe(false);
    expect(playerFacing(game)).not.toContain(HOLD_AT_ONCE_APOLOGY);
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
  });

  it("queues Confirm cards from the books pass when the order call succeeds", async () => {
    const game = tempGame();
    llmChatMock.mockResolvedValueOnce(speechJson("Barley on the remaining spring share, my lord."));
    llmChatMock.mockResolvedValueOnce(sowingJson());
    llmChatMock.mockResolvedValueOnce(sowingJson());
    await game.sendDialogue("steward", "Sow more barley on the remaining acres.");
    expect(llmChatMock).toHaveBeenCalledTimes(3);
    const booksUser = String((llmChatMock.mock.calls[1][1] as { content: string }[])[3].content);
    expect(booksUser).toMatch(/proposals/);
    const turn = lastTurn(game);
    expect(turn.some((m) => m.role === "npc" && /Barley on the remaining/.test(m.text))).toBe(true);
    expect(turn.some((m) => m.text === HOLD_AT_ONCE_APOLOGY)).toBe(false);
    const pending = game.pending.filter((p) => p.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].proposal.type).toBe("adjust_sowing");
    expect(game.state.holdings[0].sown.barley).toBe(0);
  });

  it("keeps Aldric's speech when the books pass times out, with a books line and nothing queued", async () => {
    const game = tempGame();
    llmChatMock.mockResolvedValueOnce(speechJson("I hear you. Barley, then."));
    llmChatMock.mockRejectedValueOnce(new Error(RFAB_502));
    const result = await game.sendDialogue("steward", "Sow more barley on the remaining acres.");
    expect(result.error).toBeUndefined();
    // A network failure is not retried.
    expect(llmChatMock).toHaveBeenCalledTimes(2);
    const turn = lastTurn(game);
    expect(turn.map((m) => m.role)).toEqual(["player", "npc", "system"]);
    expect(turn[1]).toMatchObject({ role: "npc", npcId: "steward", text: "I hear you. Barley, then." });
    expect(turn[2].text).toBe(BOOKS_NOT_TAKEN_LINE);
    expect(playerFacing(game)).not.toContain(HOLD_AT_ONCE_APOLOGY);
    expect(playerFacing(game)).not.toMatch(/RFAB|Grok|PROVIDER_ERROR|502|world-state/i);
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
  });

  const TRUNCATED_SPEECH_DUMP = `{ "speech": "It makes good sense, my lord. We shall keep a three-field rotation, legumes and peas on the rest year, manure on the tired acres, and the best seed set aside.",
  "chronicle": "The lord ordered a three-field rotation.",
  "emotion": "thoughtful",
  "proposals": [
    {
      "type": "set_standing_order",
      "summary": "Begin tracking peas (field legumes) in the estate stores",
      "text": "Three-field rotation with legumes",
      "active": true }`;
  const THREE_FIELD_ORDER =
    "ok. Id like us to split our farming fields into a three-field rotation, rest one year under legumes (peas), put manure on the tired acres, and keep the best seed-selection back for sowing.";

  it("asks once more with twice the budget when the speech dump is truncated, then apologizes if it is cut again", async () => {
    const game = tempGame();
    const resourcesBefore = { ...game.state.resources };
    llmChatMock.mockResolvedValueOnce(TRUNCATED_SPEECH_DUMP);
    llmChatMock.mockResolvedValueOnce(TRUNCATED_SPEECH_DUMP);
    await game.sendDialogue("steward", THREE_FIELD_ORDER);
    expect(llmChatMock).toHaveBeenCalledTimes(2);
    const budgets = llmChatMock.mock.calls.map((c) => (c[2] as { maxTokens?: number } | undefined)?.maxTokens ?? 0);
    expect(budgets[1]).toBe(budgets[0] * 2);
    expectNpcApologyOnly(game);
    expect(game.messages.some((m) => m.role === "npc" && /It makes good sense/.test(m.text))).toBe(false);
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
    expect(game.state.resources).toEqual(resourcesBefore);
  });

  it("uses the whole reply from the larger-budget retry after a truncated speech dump", async () => {
    const game = tempGame();
    llmChatMock.mockResolvedValueOnce(TRUNCATED_SPEECH_DUMP);
    llmChatMock.mockResolvedValueOnce(speechJson("It makes good sense, my lord. The three-field course waits on the harvest."));
    // Books pass, and any drawer repair after it.
    llmChatMock.mockResolvedValue(sowingJson());
    await game.sendDialogue("steward", THREE_FIELD_ORDER);
    const turn = lastTurn(game);
    expect(turn.some((m) => m.role === "npc" && /It makes good sense/.test(m.text))).toBe(true);
    expect(turn.some((m) => m.text === HOLD_AT_ONCE_APOLOGY)).toBe(false);
    expect(game.pending.filter((p) => p.status === "pending").length).toBeGreaterThan(0);
  });

  it("keeps the speech when the books pass is chopped twice — a books line, nothing queued", async () => {
    const speech = "I hear you. Barley, then.";
    const truncated = `{ "speech": "The barley share is written.",
  "emotion": "thoughtful",
  "proposals": [ { "type": "adjust_sowing", "summary": "Sow more barley", "active": true }`;
    const game = tempGame();
    llmChatMock.mockResolvedValueOnce(speechJson(speech));
    llmChatMock.mockResolvedValueOnce(truncated);
    llmChatMock.mockResolvedValueOnce(truncated);
    await game.sendDialogue("steward", "Sow more barley on the remaining acres.");
    expect(llmChatMock).toHaveBeenCalledTimes(3);
    const turn = lastTurn(game);
    expect(turn.map((m) => m.role)).toEqual(["player", "npc", "system"]);
    expect(turn[1].text).toBe(speech);
    expect(turn[2].text).toBe(BOOKS_NOT_TAKEN_LINE);
    expect(game.messages.some((m) => /The barley share is written/.test(m.text))).toBe(false);
    expect(game.messages.some((m) => m.text === HOLD_AT_ONCE_APOLOGY)).toBe(false);
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
  });

  it("does not apply event_effects from a dirty season blob; uses engine stubs only", async () => {
    const dirty = `{ "speech": "The harvest is gathered, my lord. Peas are on the ledger.",
  "emotion": "pleased",
  "proposals": [
    { "type": "event_effect", "eventId": "w-rain", "summary": "Miracle coin", "resource": "denarii", "amount": 999, "direction": "gain"`;
    const game = tempGame();
    const denariiBefore = game.state.resources.denarii;
    llmChatMock.mockResolvedValueOnce(dirty);
    llmChatMock.mockResolvedValueOnce(dirty);
    await game.advanceSeason();
    // Chopped once, retried at twice the budget, chopped again: engine stubs only.
    expect(llmChatMock).toHaveBeenCalledTimes(2);
    expect(game.messages.some((m) => m.role === "npc" && /Peas are on the ledger|It makes good sense/.test(m.text))).toBe(
      false,
    );
    expect(game.messages.some((m) => m.role === "npc" && m.npcId === "steward" && m.text === HOLD_AT_ONCE_APOLOGY)).toBe(
      true,
    );
    expect(game.messages.some((m) => m.role === "system" && m.text.includes(HOLD_AT_ONCE_APOLOGY))).toBe(false);
    expect(game.state.resources.denarii).toBeLessThan(denariiBefore + 100);
    expect(game.state.resources.denarii).not.toBe(denariiBefore + 999);
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
  });

  it("does not repair after a timeout, and other errors stay a plain books line", async () => {
    const game = tempGame();
    llmChatMock.mockRejectedValueOnce(new Error("No Reality Fabricator API key. Open Settings and paste a key from rfab.ai."));
    await game.sendDialogue("steward", "How fares the rye?");
    expect(llmChatMock).toHaveBeenCalledTimes(1);
    expect(playerFacing(game)).toMatch(/Aldric cannot be heard\. The books are unchanged\./);
    expect(playerFacing(game)).not.toMatch(/\{|PROVIDER_ERROR|world-state/i);
  });
});
