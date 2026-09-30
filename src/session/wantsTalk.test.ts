import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { HOUSEHOLD_INTROS } from "../engine/intros";
import { applyMerchantRoll } from "../engine/merchant";
import { WorldStateSchema } from "../engine/schema";
import { quoteHunt, startHunt, huntProposal, resolveHunts } from "../engine/hunts";
import { parseLlmResponse } from "../llm/parse";
import { defaultAppSettings } from "../llm/settings";
import { GameController } from "./game";

function tempGame(state = WorldStateSchema.parse(structuredClone(startingEstate))) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isekai-"));
  return new GameController(state, dir, defaultAppSettings());
}

function flagOf(game: GameController, id: string): boolean {
  return game.state.npcs.find((n) => n.id === id)?.wantsTalk === true;
}

describe("wantsTalk tab badges", () => {
  it("starts a fresh game with smith/chaplain/negotiator nags and not Aldric", () => {
    const game = tempGame();
    expect(flagOf(game, "steward")).toBe(false);
    expect(flagOf(game, "smith")).toBe(true);
    expect(flagOf(game, "chaplain")).toBe(true);
    expect(flagOf(game, "negotiator")).toBe(true);
  });

  it("clears the intro badge when that NPC's tab opens and introSpoken becomes true", () => {
    const game = tempGame();
    const smith = game.setScene("smith");
    expect(smith.messages.map((m) => m.text)).toContain(HOUSEHOLD_INTROS.smith);
    expect(game.state.npcs.find((n) => n.id === "smith")?.introSpoken).toBe(true);
    expect(flagOf(game, "smith")).toBe(false);
    expect(flagOf(game, "chaplain")).toBe(true);
    game.setScene("chaplain");
    expect(flagOf(game, "chaplain")).toBe(false);
    game.setScene("negotiator");
    expect(flagOf(game, "negotiator")).toBe(false);
  });

  it("keeps the badge while a Confirm card waits, even if the player opens that tab", () => {
    const game = tempGame();
    const parsed = parseLlmResponse(
      JSON.stringify({
        speech: "We can put more of the remaining share to barley.",
        proposals: [{ type: "adjust_sowing", summary: "Sow more barley", holdingId: "fontenay", springBarleyShare: 0.85 }],
      }),
    );
    game.ingestParsedDialogue("steward", parsed, "Sow more barley on the remaining acres.");
    expect(flagOf(game, "steward")).toBe(true);
    game.setScene("smith");
    game.setScene("steward");
    expect(flagOf(game, "steward")).toBe(true);
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(1);

    game.confirmProposal(game.pending[0].id);
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
    expect(flagOf(game, "steward")).toBe(false);
  });

  it("clears a Confirm nag when the player declines the card", () => {
    const game = tempGame();
    const parsed = parseLlmResponse(
      JSON.stringify({
        speech: "A mill, if you will Confirm.",
        proposals: [{ type: "start_project", summary: "Flour mill", projectKey: "flour_mill", holdingId: "fontenay" }],
      }),
    );
    game.ingestParsedDialogue("steward", parsed, "Build a flour mill.");
    expect(flagOf(game, "steward")).toBe(true);
    game.rejectProposal(game.pending[0].id);
    expect(flagOf(game, "steward")).toBe(false);
  });

  it("sets wantsTalk on a new hire until their intro plays", () => {
    const game = tempGame();
    game.state.resources.denarii = 200;
    const parsed = parseLlmResponse(JSON.stringify({ speech: "Haimo can be brought in.", proposals: [] }));
    game.ingestParsedDialogue("steward", parsed, "Hire a carpenter full-time for the villa.");
    expect(flagOf(game, "steward")).toBe(true);
    game.confirmProposal(game.pending[0].id);
    expect(flagOf(game, "steward")).toBe(false);
    expect(flagOf(game, "carpenter")).toBe(true);
    game.setScene("carpenter");
    expect(game.state.npcs.find((n) => n.id === "carpenter")?.introSpoken).toBe(true);
    expect(flagOf(game, "carpenter")).toBe(false);
  });

  it("sets Gerulf wantsTalk when a hunt completes, then clears on opening his tab", () => {
    const game = tempGame();
    game.setScene("negotiator");
    expect(flagOf(game, "negotiator")).toBe(false);
    const brief = quoteHunt(game.state, { goods: "pepper", resource: "pepper", amount: 1 });
    game.state.resources.denarii = Math.max(game.state.resources.denarii, brief.quotedDenarii);
    expect(startHunt(game.state, huntProposal(brief)).ok).toBe(true);
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    for (let i = 0; i < brief.durationSeasons; i++) resolveHunts(game.state);
    vi.restoreAllMocks();
    expect(flagOf(game, "negotiator")).toBe(true);
    game.setScene("steward");
    expect(flagOf(game, "negotiator")).toBe(true);
    game.setScene("negotiator");
    expect(flagOf(game, "negotiator")).toBe(false);
  });

  it("sets merchant wantsTalk on arrival and clears on first talk that visit", () => {
    const game = tempGame();
    vi.spyOn(Math, "random").mockReturnValue(5 / 8);
    applyMerchantRoll(game.state, { base: 0.3, bonus: 0, chance: 0.3, notes: [], arrived: true });
    vi.restoreAllMocks();
    expect(game.state.merchant.name).toBe("Isaac");
    expect(flagOf(game, "merchant")).toBe(true);
    game.setScene("merchant");
    expect(flagOf(game, "merchant")).toBe(false);
  });
});
