import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { WorldStateSchema } from "../engine/schema";
import * as llm from "../llm";
import { defaultAppSettings, mergeSettings, normalizeSettings } from "../llm/settings";
import { GameController } from "./game";

const KEY = "sk-secret-play-log-key";
const FIRST_REASON = "REASONING-MARKER-ONE I weighed the barn before I spoke.";
const SECOND_REASON = "REASONING-MARKER-TWO the next play has its own page.";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "isekai-playlog-"));
}

function gameIn(dir: string) {
  const state = WorldStateSchema.parse(structuredClone(startingEstate));
  const settings = defaultAppSettings();
  settings.providers.rfab.apiKey = KEY;
  settings.providers.rfab.model = "grok-test";
  return new GameController(state, dir, settings);
}

function reply(speech: string, reasoning: string) {
  return async () => {
    llm.stashReasoning(reasoning);
    return JSON.stringify({ speech, emotion: "neutral", proposals: [] });
  };
}

describe("a finished play keeps a machinery file", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes the reasoning and the system pack, and a second play leaves that file", async () => {
    const dir = tempDir();
    const spy = vi.spyOn(llm, "llmChat");
    spy
      .mockImplementationOnce(reply("Let me look. <=-tool: grain -=>", FIRST_REASON))
      .mockImplementationOnce(reply("The rye is in the barn.", "The drawer listed the rye."));

    const first = gameIn(dir);
    await first.sendDialogue("steward", "How much rye do we hold?");
    const spoken = first.messages.filter((m) => m.role === "npc").map((m) => m.text).join("\n");
    expect(spoken).toMatch(/rye is in the barn/i);
    expect(spoken).not.toContain(FIRST_REASON);
    expect(spoken).not.toContain("System information given to the model");

    const firstFile = first.finishPlay("The player quit.");
    const text = fs.readFileSync(firstFile, "utf8");
    expect(text).toContain(FIRST_REASON);
    expect(text).toContain("The drawer listed the rye.");
    expect(text).toContain("System information given to the model");
    expect(text).toMatch(/Aldric/);
    expect(text).toContain("Tool call");
    expect(text).toContain("grain");
    expect(text).toContain("Raw model reply");
    expect(text).toContain("Proposals the books took from that reply");
    expect(text).toContain("The player quit.");
    expect(text).not.toContain(KEY);
    expect(first.finishPlay("again")).toBe(firstFile);
    expect(fs.readFileSync(firstFile, "utf8")).toBe(text);

    spy.mockImplementationOnce(reply("The oats can wait.", SECOND_REASON));
    const second = gameIn(dir);
    await second.sendDialogue("steward", "How fares the rye?");
    const secondFile = second.finishPlay("The player started a new estate.");

    expect(secondFile).not.toBe(firstFile);
    expect(fs.readFileSync(firstFile, "utf8")).toBe(text);
    const next = fs.readFileSync(secondFile, "utf8");
    expect(next).toContain(SECOND_REASON);
    expect(next).toContain("System information given to the model");
    expect(next).not.toContain(FIRST_REASON);
    expect(next).not.toContain(KEY);

    const names = fs.readdirSync(path.join(dir, "play-logs")).filter((name) => name.endsWith(".txt"));
    expect(names).toHaveLength(2);
    expect(names.every((name) => name.startsWith("play-"))).toBe(true);
  });

  it("writes what the books did beside the model's reasoning", () => {
    const dir = tempDir();
    const game = gameIn(dir);
    game.log("engine", "SEASON", "Now summer 825");
    const file = game.finishPlay("The player quit.");
    const text = fs.readFileSync(file, "utf8");
    expect(text).toContain("Ledger · SEASON · engine");
    expect(text).toContain("Now summer 825");
    expect(text).toContain("The player quit.");
  });

  it("writes nothing when play logging is off, and a switch seals then opens a new file", () => {
    const dir = tempDir();
    const settings = defaultAppSettings();
    settings.playLogEnabled = false;
    const quiet = new GameController(WorldStateSchema.parse(structuredClone(startingEstate)), dir, settings);
    quiet.log("engine", "EVENT", "MUST-NOT-APPEAR");
    expect(quiet.finishPlay("The player quit.")).toBe("");
    expect(fs.existsSync(path.join(dir, "play-logs"))).toBe(false);

    const game = gameIn(dir);
    game.log("steward", "APPLY", "The barn was raised.");
    const first = game.playLog.filePath;
    game.setPlayLogEnabled(false);
    const sealed = fs.readFileSync(first, "utf8");
    expect(sealed).toContain("The barn was raised.");
    expect(sealed).toContain("Logging stopped");
    expect(sealed).toContain("Play logging was turned off.");
    game.log("engine", "EVENT", "MUST-NOT-APPEAR");
    expect(fs.readFileSync(first, "utf8")).toBe(sealed);

    game.setPlayLogEnabled(true);
    game.log("engine", "SEASON", "Logging resumed.");
    const second = game.finishPlay("The player quit.");
    expect(second).not.toBe(first);
    expect(fs.readFileSync(first, "utf8")).toBe(sealed);
    const resumed = fs.readFileSync(second, "utf8");
    expect(resumed).toContain("turned back on");
    expect(resumed).toContain("Logging resumed.");
    expect(resumed).not.toContain("The barn was raised.");

    expect(normalizeSettings({}).playLogEnabled).toBe(true);
    expect(normalizeSettings({ playLogEnabled: false }).playLogEnabled).toBe(false);
    const off = mergeSettings(defaultAppSettings(), { playLogEnabled: false });
    expect(off.playLogEnabled).toBe(false);
    expect(mergeSettings(off, {}).playLogEnabled).toBe(false);
  });
});
