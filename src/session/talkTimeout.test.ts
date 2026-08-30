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
    const user = String((llmChatMock.mock.calls[0][1] as { content: string }[])[1].content);
    expect(user).toMatch(/This pass is speech only/);
    expect(user).toMatch(/proposals may be \[\]/);
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

  it("does not repair after a timeout, and other errors stay a plain books line", async () => {
    const game = tempGame();
    llmChatMock.mockRejectedValueOnce(new Error("No Reality Fabricator API key. Open Settings and paste a key from rfab.ai."));
    await game.sendDialogue("steward", "How fares the rye?");
    expect(llmChatMock).toHaveBeenCalledTimes(1);
    expect(playerFacing(game)).toMatch(/Aldric cannot be heard\. The books are unchanged\./);
    expect(playerFacing(game)).not.toMatch(/\{|PROVIDER_ERROR|world-state/i);
  });
});
