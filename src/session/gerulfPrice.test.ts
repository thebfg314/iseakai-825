import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { ordinaryHuntPurse } from "../engine/hunts";
import { WorldStateSchema } from "../engine/schema";
import { defaultAppSettings } from "../llm/settings";

const llmChatMock = vi.hoisted(() => vi.fn());

vi.mock("../llm", () => ({
  llmChat: (...args: unknown[]) => llmChatMock(...args),
}));

import { GameController } from "./game";

function tempGame() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isekai-gerulf-"));
  const state = WorldStateSchema.parse(structuredClone(startingEstate));
  return new GameController(state, dir, defaultAppSettings());
}

function speechJson(speech: string) {
  return JSON.stringify({ speech, emotion: "pleased", proposals: [] });
}

function huntJson(quotedDenarii: number) {
  return JSON.stringify({
    speech: "Set down.",
    proposals: [
      {
        type: "start_hunt",
        summary: "Fetch iron",
        goods: "iron",
        resource: "iron",
        amount: 4,
        quotedDenarii,
        durationSeasons: 1,
      },
    ],
  });
}

describe("Gerulf's spoken purse", () => {
  beforeEach(() => {
    llmChatMock.mockReset();
  });

  it("stamps the computed price into his speech and the Confirm card, whatever figure he invented", async () => {
    const ask = "Buy 4 pounds of iron. I cannot wait for a merchant.";
    const price = ordinaryHuntPurse(8, 4);

    const first = tempGame();
    const chest = first.state.resources.denarii;
    llmChatMock.mockResolvedValueOnce(
      speechJson(
        "Aye. I'll fetch 4 pounds of iron for 42 denarii, road costs included, and have it back within one season. Better my boots wear than your forge stand idle.",
      ),
    );
    llmChatMock.mockResolvedValueOnce(huntJson(42));
    await first.sendDialogue("negotiator", ask);

    const second = tempGame();
    llmChatMock.mockResolvedValueOnce(
      speechJson(
        "Aye. Four pounds of iron, fetched inland rather than prayed for at the gate. Give me 28 denarii and one season.",
      ),
    );
    llmChatMock.mockResolvedValueOnce(huntJson(28));
    await second.sendDialogue("negotiator", ask);

    for (const game of [first, second]) {
      const pending = game.pending.filter((p) => p.status === "pending");
      expect(pending).toHaveLength(1);
      expect(pending[0].proposal).toMatchObject({
        type: "start_hunt",
        resource: "iron",
        amount: 4,
        quotedDenarii: price,
      });
      const spoken = game.messages.filter((m) => m.role === "npc").map((m) => m.text).join("\n");
      expect(spoken).toContain(`${price} denarii`);
      expect(spoken).not.toMatch(/\b42 denarii\b/);
      expect(spoken).not.toMatch(/\b28 denarii\b/);
      expect(game.state.resources.denarii).toBe(chest);
    }

    const card = first.pending[0];
    if (card.proposal.type !== "start_hunt") throw new Error("expected start_hunt");
    expect(card.proposal.summary).toContain(`${price} denarii`);

    second.rejectProposal(second.pending[0].id);
    expect(second.state.resources.denarii).toBe(chest);
    expect(second.state.projects).toHaveLength(0);

    const result = first.confirmProposal(card.id);
    expect(result.error).toBeUndefined();
    expect(first.state.resources.denarii).toBe(chest - price);
    expect(first.state.npcs.find((n) => n.id === "negotiator")?.location).toBe("road");
  });

  it("refuses 35 lb in his own mouth when the chest cannot pay, with no Confirm and no coin taken", async () => {
    const game = tempGame();
    const chest = game.state.resources.denarii;
    const price = ordinaryHuntPurse(game.state.market.iron.max, 35);
    await game.sendDialogue("negotiator", "Buy 35 lb of iron. I cannot wait for a merchant.");
    expect(llmChatMock).not.toHaveBeenCalled();
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
    expect(game.state.resources.denarii).toBe(chest);
    expect(game.state.projects).toHaveLength(0);
    const spoken = game.messages.filter((m) => m.role === "npc" && m.npcId === "negotiator").map((m) => m.text).join("\n");
    expect(spoken).toContain(`${price} denarii`);
    expect(spoken).toMatch(/cannot spare/i);
    expect(spoken).toMatch(/take nothing/i);
    expect(spoken).toMatch(/35 pounds of iron/);
    expect(spoken).not.toMatch(/\b42\b/);
    expect(spoken).not.toMatch(/\b28\b/);
  });

  it("stamps the purse for the difficulty he chose, and refuses a road the chest cannot pay", async () => {
    const ask = "Buy 4 pounds of iron. I cannot wait for a merchant.";
    const price = ordinaryHuntPurse(8, 4, "difficult");
    const game = tempGame();
    const chest = game.state.resources.denarii;
    llmChatMock.mockResolvedValueOnce(speechJson("Aye. A hard road. Give me 42 denarii."));
    llmChatMock.mockResolvedValueOnce(
      JSON.stringify({
        speech: "Set down.",
        proposals: [
          {
            type: "start_hunt",
            summary: "Fetch iron",
            goods: "iron",
            resource: "iron",
            amount: 4,
            quotedDenarii: 42,
            difficulty: "difficult",
            durationSeasons: 1,
          },
        ],
      }),
    );
    await game.sendDialogue("negotiator", ask);
    const pending = game.pending.filter((p) => p.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].proposal).toMatchObject({
      type: "start_hunt",
      quotedDenarii: price,
      difficulty: "difficult",
    });
    const spoken = game.messages.filter((m) => m.role === "npc").map((m) => m.text).join("\n");
    expect(spoken).toContain(`${price} denarii`);
    expect(spoken).not.toMatch(/\b42 denarii\b/);
    expect(game.confirmProposal(pending[0].id).error).toBeUndefined();
    expect(game.state.resources.denarii).toBe(chest - price);

    const fromSpeech = tempGame();
    llmChatMock.mockResolvedValueOnce(speechJson("This errand is hard. I want 12 denarii."));
    llmChatMock.mockResolvedValueOnce(
      JSON.stringify({
        speech: "Set down.",
        proposals: [
          {
            type: "start_hunt",
            summary: "Fetch iron",
            goods: "iron",
            resource: "iron",
            amount: 4,
            durationSeasons: 1,
          },
        ],
      }),
    );
    await fromSpeech.sendDialogue("negotiator", ask);
    expect(fromSpeech.pending[0].proposal).toMatchObject({
      type: "start_hunt",
      quotedDenarii: price,
      difficulty: "difficult",
    });

    const salt = tempGame();
    const saltChest = salt.state.resources.denarii;
    const saltPrice = ordinaryHuntPurse(salt.state.market.salt.max, 19, "difficult");
    expect(saltPrice).toBeGreaterThan(saltChest);
    expect(ordinaryHuntPurse(salt.state.market.salt.max, 19, "easy")).toBeLessThanOrEqual(saltChest);
    llmChatMock.mockResolvedValueOnce(speechJson("A hard road for that much salt. Ten denarii."));
    llmChatMock.mockResolvedValueOnce(
      JSON.stringify({
        speech: "Set down.",
        proposals: [
          {
            type: "start_hunt",
            summary: "Fetch salt",
            goods: "salt",
            resource: "salt",
            amount: 19,
            quotedDenarii: 10,
            difficulty: "difficult",
            durationSeasons: 1,
          },
        ],
      }),
    );
    await salt.sendDialogue("negotiator", "Buy 19 lb of salt.");
    expect(llmChatMock).toHaveBeenCalled();
    expect(salt.pending.filter((p) => p.status === "pending")).toHaveLength(0);
    expect(salt.state.resources.denarii).toBe(saltChest);
    expect(salt.state.projects).toHaveLength(0);
    const saltSpoken = salt.messages.filter((m) => m.role === "npc").map((m) => m.text).join("\n");
    expect(saltSpoken).toContain(`${saltPrice} denarii`);
    expect(saltSpoken).toMatch(/cannot spare/i);
    expect(saltSpoken).toMatch(/take nothing/i);
    expect(saltSpoken).not.toMatch(/\b10 denarii\b/);
  });
});
