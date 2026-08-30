import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { WorldStateSchema } from "../engine/schema";
import { HOLD_AT_ONCE_APOLOGY } from "../llm/providerErrors";
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
    expect(playerFacing(game)).toContain(HOLD_AT_ONCE_APOLOGY);
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
    expect(game.messages.some((m) => m.role === "npc" && /rye stands well/.test(m.text))).toBe(true);
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
  });

  it("queues Confirm cards from the books pass when the order call succeeds", async () => {
    const game = tempGame();
    llmChatMock.mockResolvedValueOnce(speechJson("Barley on the remaining spring share, my lord."));
    llmChatMock.mockResolvedValueOnce(sowingJson());
    await game.sendDialogue("steward", "Sow more barley on the remaining acres.");
    expect(llmChatMock).toHaveBeenCalledTimes(2);
    const booksUser = String((llmChatMock.mock.calls[1][1] as { content: string }[])[3].content);
    expect(booksUser).toMatch(/proposals/);
    expect(game.messages.some((m) => m.role === "npc" && /Barley on the remaining/.test(m.text))).toBe(true);
    const pending = game.pending.filter((p) => p.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].proposal.type).toBe("adjust_sowing");
    expect(game.state.holdings[0].sown.barley).toBe(0);
  });

  it("keeps NPC speech and the apology when the books pass times out, with nothing pending", async () => {
    const game = tempGame();
    llmChatMock.mockResolvedValueOnce(speechJson("I hear you. Barley, then."));
    llmChatMock.mockRejectedValueOnce(new Error(RFAB_502));
    const result = await game.sendDialogue("steward", "Sow more barley on the remaining acres.");
    expect(result.error).toBeUndefined();
    expect(llmChatMock).toHaveBeenCalledTimes(2);
    expect(game.messages.some((m) => m.role === "npc" && /I hear you/.test(m.text))).toBe(true);
    expect(playerFacing(game)).toContain(HOLD_AT_ONCE_APOLOGY);
    expect(playerFacing(game)).not.toMatch(/RFAB|Grok|PROVIDER_ERROR|502|world-state/i);
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
  });

  it("strips leftover JSON when the speech pass is truncated mid-proposals", async () => {
    const speech =
      "It makes good sense, my lord. We shall keep a three-field rotation, legumes and peas on the rest year, manure on the tired acres, and the best seed set aside.";
    const truncated = `{ "speech": "${speech}",
  "chronicle": "The lord ordered a three-field rotation.",
  "emotion": "thoughtful",
  "proposals": [
    {
      "type": "set_standing_order",
      "summary": "Begin tracking peas (field legumes) in the estate stores",
      "text": "Three-field rotation with legumes",
      "active": true }`;
    const order =
      "ok. Id like us to split our farming fields into a three-field rotation, rest one year under legumes (peas), put manure on the tired acres, and keep the best seed-selection back for sowing.";
    const game = tempGame();
    llmChatMock.mockResolvedValueOnce(truncated);
    llmChatMock.mockResolvedValueOnce(sowingJson());
    await game.sendDialogue("steward", order);
    expect(llmChatMock).toHaveBeenCalledTimes(2);
    const npc = game.messages.find((m) => m.role === "npc");
    expect(npc?.text).toBe(speech);
    expect(npc?.text).not.toMatch(/\{|"proposals"/);
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(1);
  });

  it("keeps clean speech and the apology when the books pass 502s after a truncated speech dump", async () => {
    const speech = "It makes good sense, my lord. We shall keep a three-field rotation.";
    const truncated = `{ "speech": "${speech}",
  "emotion": "thoughtful",
  "proposals": [ { "type": "set_standing_order", "summary": "Begin tracking peas", "active": true }`;
    const game = tempGame();
    llmChatMock.mockResolvedValueOnce(truncated);
    llmChatMock.mockRejectedValueOnce(new Error(RFAB_502));
    await game.sendDialogue(
      "steward",
      "ok. Id like us to split our farming fields into a three-field rotation with legumes and manure.",
    );
    expect(llmChatMock).toHaveBeenCalledTimes(2);
    expect(game.messages.some((m) => m.role === "npc" && m.text === speech)).toBe(true);
    expect(playerFacing(game)).toContain(HOLD_AT_ONCE_APOLOGY);
    expect(playerFacing(game)).not.toMatch(/"proposals"|Begin tracking peas/);
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
