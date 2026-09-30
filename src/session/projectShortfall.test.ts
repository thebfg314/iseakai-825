import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { WorldStateSchema } from "../engine/schema";
import { proposalBlurb } from "../ui/ledgerCopy";
import { defaultAppSettings } from "../llm/settings";
import { GameController } from "./game";

function tempGame() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isekai-short-"));
  const state = WorldStateSchema.parse(structuredClone(startingEstate));
  return new GameController(state, dir, defaultAppSettings());
}

const JARGON = /customCosts|catalogue|proposal|JSON|start_project|projectKey/i;

describe("Bernard names what a new plough still needs", () => {
  it("stamps the book gap into his mouth and the card, then Confirm takes that charge", async () => {
    const game = tempGame();
    expect(game.state.resources.iron).toBe(25);
    expect(game.state.resources.denarii).toBe(138);
    const spy = vi.spyOn(game as unknown as { callLlm: (...args: unknown[]) => Promise<unknown> }, "callLlm");
    const costs = { labourDays: 40, lumber: 2, iron: 8, stone: 0, charcoal: 6 };
    const proposal = {
      type: "start_project",
      summary: "A heavy plough",
      projectKey: "heavy_plough",
      name: "Heavy plough",
      holdingId: "fontenay",
      tag: "forge",
      customCosts: costs,
    };
    const books = {
      speech: "Set down.",
      emotion: "thoughtful" as const,
      proposals: [proposal],
      raw: "{}",
      parseErrors: [] as string[],
    };
    spy
      .mockResolvedValueOnce({
        speech: "A good idea, but we would need more charcoal and more iron. Call it twenty loads of charcoal.",
        emotion: "thoughtful",
        proposals: [],
        raw: "{}",
        parseErrors: [],
      })
      .mockResolvedValueOnce(books)
      .mockResolvedValueOnce(books)
      .mockResolvedValueOnce({
        speech: "I cannot give you a figure.",
        emotion: "thoughtful",
        proposals: [],
        raw: "{}",
        parseErrors: [],
      })
      .mockResolvedValueOnce({
        speech: "Set down.",
        emotion: "thoughtful",
        proposals: [],
        raw: "{}",
        parseErrors: [],
      });

    await game.sendDialogue("smith", "Build me a new plough, a heavy one with an iron share.");
    const spoken = game.messages.filter((m) => m.role === "npc" && m.npcId === "smith").at(-1)?.text ?? "";
    expect(spoken).toMatch(/5 cart-loads of charcoal/);
    expect(spoken).not.toMatch(/twenty/i);
    expect(spoken).not.toMatch(/more iron/i);
    expect(spoken).not.toMatch(/\biron\b/i);
    expect(spoken).not.toMatch(JARGON);

    const card = game.pending.find((p) => p.status === "pending");
    expect(card).toBeTruthy();
    if (!card || card.proposal.type !== "start_project") throw new Error("expected the plough card");
    expect(card.proposal.customCosts).toMatchObject(costs);
    const blurb = proposalBlurb(card.proposal, game.state);
    expect(blurb).toMatch(/6 cart-loads of charcoal/);
    expect(blurb).toMatch(/8 lb of iron/);
    expect(blurb).not.toMatch(JARGON);

    await game.sendDialogue("smith", "How much charcoal?");
    const again = game.messages.filter((m) => m.role === "npc" && m.npcId === "smith").at(-1)?.text ?? "";
    expect(again).toMatch(/5 cart-loads of charcoal/);
    expect(again).not.toMatch(/cannot give you a figure/i);
    expect(again).not.toMatch(JARGON);

    game.state.resources.charcoal = 6;
    const ok = game.confirmProposal(card.id);
    expect(ok.error).toBeUndefined();
    expect(game.state.resources.charcoal).toBe(0);
    expect(game.state.resources.iron).toBe(17);
    expect(game.state.resources.denarii).toBe(138);
    expect(game.state.projects[0].materials.charcoal).toBe(6);
    expect(game.state.projects[0].materials.iron).toBe(8);
  });
});
