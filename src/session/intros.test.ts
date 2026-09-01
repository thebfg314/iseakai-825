import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { HOUSEHOLD_INTROS, MERCHANT_INTROS } from "../engine/intros";
import { applyMerchantRoll } from "../engine/merchant";
import { WorldStateSchema } from "../engine/schema";
import { loadWorldState } from "../engine/state";
import { parseLlmResponse } from "../llm/parse";
import { defaultAppSettings } from "../llm/settings";
import { GameController } from "./game";

function tempGame(state = WorldStateSchema.parse(structuredClone(startingEstate))) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isekai-"));
  return new GameController(state, dir, defaultAppSettings());
}

function stewardNpcLines(game: GameController) {
  return game.messages.filter((m) => m.role === "npc" && m.npcId === "steward").map((m) => m.text);
}

function presentMerchant(game: GameController, name: keyof typeof MERCHANT_INTROS) {
  game.state.flags.merchant_present = true;
  game.state.merchant.present = true;
  game.state.merchant.name = name;
  game.state.npcs = game.state.npcs.filter((n) => n.id !== "merchant");
  game.state.npcs.push({
    id: "merchant",
    name,
    role: "merchant",
    location: "fontenay",
    memories: [],
  });
}

describe("first-meeting intros", () => {
  it("puts Aldric's intro before the opening estate report on a fresh game", () => {
    const game = tempGame();
    const lines = stewardNpcLines(game);
    expect(lines[0]).toBe(HOUSEHOLD_INTROS.steward);
    expect(lines[1]).toMatch(/It is spring in the year 825/);
    expect(lines[1]).toMatch(/I am Aldric, your steward/);
    expect(lines.filter((t) => t === HOUSEHOLD_INTROS.steward)).toHaveLength(1);
    expect(game.state.npcs.find((n) => n.id === "steward")?.introSpoken).toBe(true);

    game.view();
    const saved = JSON.parse(fs.readFileSync(path.join(game.saveDir, "world-state.json"), "utf8"));
    expect(saved.npcs.find((n: { id: string }) => n.id === "steward").introSpoken).toBe(true);
  });

  it("does not replay Aldric's intro on a second look at the steward tab", () => {
    const game = tempGame();
    const before = stewardNpcLines(game);
    expect(before[0]).toBe(HOUSEHOLD_INTROS.steward);
    game.setScene("smith");
    const back = game.setScene("steward");
    expect(back.messages.filter((m) => m.role === "npc").map((m) => m.text)).toEqual(before);
    expect(stewardNpcLines(game).filter((t) => t === HOUSEHOLD_INTROS.steward)).toHaveLength(1);
  });

  it("does not replay Aldric's intro when loading a save that already heard it", () => {
    const first = tempGame();
    first.view();
    const loaded = loadWorldState(path.join(first.saveDir, "world-state.json"));
    const again = tempGame(loaded);
    const lines = stewardNpcLines(again);
    expect(lines[0]).not.toBe(HOUSEHOLD_INTROS.steward);
    expect(lines[0]).toMatch(/It is spring in the year 825/);
    expect(lines.filter((t) => t === HOUSEHOLD_INTROS.steward)).toHaveLength(0);
  });

  it("shows Bernard and Ermenald intros once when their tabs first open", () => {
    const game = tempGame();
    const smith = game.setScene("smith");
    expect(smith.messages.map((m) => m.text)).toEqual([HOUSEHOLD_INTROS.smith]);
    expect(game.setScene("smith").messages.map((m) => m.text)).toEqual([HOUSEHOLD_INTROS.smith]);
    expect(game.state.npcs.find((n) => n.id === "smith")?.introSpoken).toBe(true);

    const cell = game.setScene("chaplain");
    expect(cell.messages.map((m) => m.text)).toEqual([HOUSEHOLD_INTROS.chaplain]);
    expect(game.setScene("chaplain").messages.map((m) => m.text)).toEqual([HOUSEHOLD_INTROS.chaplain]);
  });

  it("shows Colman's intro once after hire when his tab opens", () => {
    const game = tempGame();
    game.state.resources.denarii = 200;
    const parsed = parseLlmResponse(JSON.stringify({ speech: "Colman can be brought in.", proposals: [] }));
    game.ingestParsedDialogue("steward", parsed, "Find me a quarry master.");
    game.confirmProposal(game.pending[0].id);
    expect(game.state.npcs.some((n) => n.id === "quarry_master")).toBe(true);

    const first = game.setScene("quarry_master");
    expect(first.messages.map((m) => m.text)).toEqual([HOUSEHOLD_INTROS.quarry_master]);
    expect(game.state.npcs.find((n) => n.id === "quarry_master")?.introSpoken).toBe(true);
    expect(game.setScene("quarry_master").messages.map((m) => m.text)).toEqual([HOUSEHOLD_INTROS.quarry_master]);
  });

  it("shows a merchant intro once per visitor name this save", () => {
    const game = tempGame();
    presentMerchant(game, "Isaac");
    const first = game.setScene("merchant");
    expect(first.messages.map((m) => m.text)).toEqual([MERCHANT_INTROS.Isaac]);
    expect(game.state.merchant_intro_spoken.Isaac).toBe(true);
    expect(game.setScene("merchant").messages.map((m) => m.text)).toEqual([MERCHANT_INTROS.Isaac]);

    presentMerchant(game, "Gero");
    const gero = game.setScene("merchant");
    expect(gero.messages.filter((m) => m.text === MERCHANT_INTROS.Gero)).toHaveLength(1);
    expect(gero.messages.filter((m) => m.text === MERCHANT_INTROS.Isaac)).toHaveLength(1);

    presentMerchant(game, "Isaac");
    const isaacAgain = game.setScene("merchant");
    expect(isaacAgain.messages.filter((m) => m.text === MERCHANT_INTROS.Isaac)).toHaveLength(1);
  });

  it("keeps Isaac's intro flag when he leaves and returns on a later roll", () => {
    const game = tempGame();
    presentMerchant(game, "Isaac");
    game.setScene("merchant");
    applyMerchantRoll(game.state, { base: 0.3, bonus: 0, chance: 0.3, notes: [], arrived: false });
    expect(game.state.merchant_intro_spoken.Isaac).toBe(true);

    vi.spyOn(Math, "random").mockReturnValue(5 / 8);
    applyMerchantRoll(game.state, { base: 0.3, bonus: 0, chance: 0.3, notes: [], arrived: true });
    vi.restoreAllMocks();
    expect(game.state.merchant.name).toBe("Isaac");
    expect(game.state.npcs.find((n) => n.id === "merchant")?.introSpoken).toBe(true);

    const again = game.setScene("merchant");
    expect(again.messages.filter((m) => m.text === MERCHANT_INTROS.Isaac)).toHaveLength(1);
  });
});
