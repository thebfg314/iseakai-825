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

describe("player line is recorded before the model answers", () => {
  beforeEach(() => {
    llmChatMock.mockReset();
  });

  it("shows the player's words on that NPC tab while the model is still working", async () => {
    const game = tempGame();
    llmChatMock.mockImplementationOnce(() => {
      const player = game.messages.filter((m) => m.role === "player");
      expect(player).toHaveLength(1);
      expect(player[0]).toMatchObject({ npcId: "steward", text: "How fares the rye?" });
      expect(game.view().messages.some((m) => m.role === "player" && m.text === "How fares the rye?")).toBe(true);
      expect(game.setScene("smith").messages.some((m) => m.role === "player")).toBe(false);
      game.setScene("steward");
      return Promise.resolve(speechJson("The rye stands well, my lord."));
    });
    await game.sendDialogue("steward", "How fares the rye?");
    expect(game.messages.filter((m) => m.role === "player" && m.text === "How fares the rye?")).toHaveLength(1);
    expect(game.view().messages.some((m) => m.role === "npc" && /rye stands well/.test(m.text))).toBe(true);
  });

  it("keeps the player line after a timeout apology", async () => {
    const game = tempGame();
    llmChatMock.mockImplementationOnce(() => {
      expect(game.messages.some((m) => m.role === "player" && m.text === "Sow barley.")).toBe(true);
      return Promise.reject(new Error(RFAB_502));
    });
    await game.sendDialogue("steward", "Sow barley.");
    const player = game.messages.filter((m) => m.role === "player" && m.text === "Sow barley.");
    expect(player).toHaveLength(1);
    expect(game.messages.some((m) => m.role === "npc" && m.text === HOLD_AT_ONCE_APOLOGY)).toBe(true);
  });

  it("persists used-this-save tokens beside the estate books", () => {
    const game = tempGame();
    game.meter.applyCall({
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, billedTokens: 40 },
    });
    game.view();
    const saved = JSON.parse(fs.readFileSync(path.join(game.saveDir, "llm-usage.json"), "utf8")) as { billedTokens: number };
    expect(saved.billedTokens).toBe(40);
    expect(game.view().llmMeter.usedThisSave.billedTokens).toBe(40);

    const loaded = new GameController(
      WorldStateSchema.parse(structuredClone(startingEstate)),
      game.saveDir,
      defaultAppSettings(),
    );
    expect(loaded.meter.usedThisSave.billedTokens).toBe(40);
    expect(loaded.meter.usedThisSession.totalTokens).toBe(0);

    const fresh = new GameController(
      WorldStateSchema.parse(structuredClone(startingEstate)),
      game.saveDir,
      defaultAppSettings(),
      { resetUsage: true },
    );
    expect(fresh.meter.usedThisSave.totalTokens).toBe(0);
  });
});
