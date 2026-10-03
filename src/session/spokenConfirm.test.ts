import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { applyProposal } from "../engine/applyDelta";
import { resolveAgricultureAndProjects } from "../engine/season";
import { WorldStateSchema } from "../engine/schema";
import { defaultAppSettings } from "../llm/settings";
import { proposalBlurb } from "../ui/ledgerCopy";
import { GameController } from "./game";

function tempGame() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isekai-spoken-"));
  const state = WorldStateSchema.parse(structuredClone(startingEstate));
  return new GameController(state, dir, defaultAppSettings());
}

const PRICE =
  "The two ploughs want 24 lb of iron and 1 cart-load of charcoal. Both ironwork sets will be done by the season's turn. The wooden beams and boards are fitted afterward. That leaves 1 lb of iron, and no charcoal.";

const LIE =
  "I have begun. I have set aside 24 lb of iron and 1 cart-load of charcoal. Both ironwork sets will be ready when the season turns.";

const JARGON = /customCosts|\bresult\b|catalogue|proposal|JSON|start_project|projectKey|finishesThisSeason/i;
const CLAIM =
  /\b(have|has|had|i've|we've)\s+begun\b|\b(is|was)\s+begun\b|\bi began\b|\b(have|has)\s+started\b|\b(have|has|had)\s+set aside\b|\b(is|are|was|were)\s+set aside\b/i;

function reply(speech: string) {
  return {
    speech,
    emotion: "thoughtful" as const,
    proposals: [],
    raw: "{}",
    parseErrors: [] as string[],
  };
}

async function agreeAfterPrice(agree: string) {
  const game = tempGame();
  const spy = vi.spyOn(game as unknown as { callLlm: (...args: unknown[]) => Promise<unknown> }, "callLlm");
  spy.mockResolvedValueOnce(reply(PRICE)).mockResolvedValueOnce(reply(LIE));
  await game.sendDialogue("smith", "What will the two ploughs cost?");
  expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
  expect(game.state.projects).toEqual([]);
  expect(game.state.resources.iron).toBe(25);
  expect(game.state.resources.charcoal).toBe(1);
  await game.sendDialogue("smith", agree);
  return game;
}

function smithSpeech(game: GameController): string {
  return game.messages.filter((m) => m.role === "npc" && m.npcId === "smith").at(-1)?.text ?? "";
}

describe("spoken confirm raises the plough card and does not write the books", () => {
  it("puts up the priced job when the lord says conform, and Confirm is what writes it", async () => {
    const game = await agreeAfterPrice("conform");
    const spoken = smithSpeech(game);
    expect(spoken).toMatch(/not begun/);
    expect(spoken).toMatch(/24 lb of iron/);
    expect(spoken).toMatch(/1 cart-load of charcoal/);
    expect(spoken).toMatch(/will set aside/);
    expect(spoken).not.toMatch(CLAIM);
    expect(spoken).not.toMatch(JARGON);
    expect(game.state.projects).toEqual([]);
    expect(game.state.resources.iron).toBe(25);
    expect(game.state.resources.charcoal).toBe(1);

    const cards = game.pending.filter((p) => p.status === "pending");
    expect(cards).toHaveLength(1);
    const card = cards[0];
    if (card.proposal.type !== "start_project") throw new Error("expected the plough card");
    expect(card.proposal.customCosts).toMatchObject({
      labourDays: 0,
      forgeDays: 70,
      lumber: 0,
      iron: 24,
      stone: 0,
      charcoal: 1,
    });
    expect(card.proposal.finishesThisSeason).toBe(true);
    expect(card.proposal.tag).toBe("forge");
    expect(card.proposal.projectKey).toBe("plough_ironwork");
    expect(card.proposal.result).toEqual([{ resource: "ironwork_sets", amount: 2, name: "ironwork sets" }]);
    const blurb = proposalBlurb(card.proposal, game.state);
    expect(blurb).toMatch(/24 lb of iron/);
    expect(blurb).toMatch(/1 cart-load of charcoal/);
    expect(blurb).toMatch(/2 ironwork sets/);
    expect(blurb).not.toMatch(JARGON);

    const refused = tempGame();
    refused.pending = structuredClone(game.pending);
    refused.rejectProposal(refused.pending[0].id);
    expect(refused.state.projects).toEqual([]);
    expect(refused.state.resources.iron).toBe(25);
    expect(refused.state.resources.charcoal).toBe(1);

    const ok = game.confirmProposal(card.id);
    expect(ok.error).toBeUndefined();
    expect(game.state.projects).toHaveLength(1);
    const work = game.state.projects[0];
    expect(work.status).toBe("active");
    expect(work.materials.iron).toBe(24);
    expect(work.materials.charcoal).toBe(1);
    expect(work.resultPaid).not.toBe(true);
    expect(game.state.resources.iron).toBe(1);
    expect(game.state.resources.charcoal).toBe(0);
    expect(game.state.custom_resources.find((c) => c.id === "ironwork_sets")).toBeUndefined();

    const lines = resolveAgricultureAndProjects(game.state);
    expect(work.status).toBe("completed");
    expect(game.state.resources.iron).toBe(1);
    expect(game.state.resources.charcoal).toBe(0);
    const sets = game.state.custom_resources.find((c) => c.id === "ironwork_sets");
    expect(sets).toMatchObject({ amount: 2, name: "ironwork sets" });
    expect(lines.some((line) => /2 ironwork sets/.test(line.text))).toBe(true);
    resolveAgricultureAndProjects(game.state);
    expect(game.state.custom_resources.find((c) => c.id === "ironwork_sets")?.amount).toBe(2);
  });

  it("opens the same card when the spoken word is confirm", async () => {
    const game = await agreeAfterPrice("confirm");
    const cards = game.pending.filter((p) => p.status === "pending");
    expect(cards).toHaveLength(1);
    expect(game.state.projects).toEqual([]);
    expect(game.state.resources.iron).toBe(25);
    expect(game.state.resources.charcoal).toBe(1);
    expect(smithSpeech(game)).not.toMatch(CLAIM);
  });

  it("pays no ironwork if the work is stopped, and invents nothing when no price was named", async () => {
    const game = await agreeAfterPrice("conform");
    const card = game.pending.find((p) => p.status === "pending");
    if (!card) throw new Error("expected the plough card");
    expect(game.confirmProposal(card.id).error).toBeUndefined();
    const work = game.state.projects[0];
    const stopped = applyProposal(
      game.state,
      { type: "adjust_project", summary: "Stop the plough ironwork", projectId: work.id, cancel: true },
      "smith",
    );
    expect(stopped.ok).toBe(true);
    expect(work.status).toBe("cancelled");
    expect(game.state.resources.iron).toBe(13);
    expect(game.state.resources.charcoal).toBe(0.5);
    expect(game.state.custom_resources.find((c) => c.id === "ironwork_sets")).toBeUndefined();
    expect(stopped.logLine).not.toMatch(/stores gain/i);

    const bare = tempGame();
    const spy = vi.spyOn(bare as unknown as { callLlm: (...args: unknown[]) => Promise<unknown> }, "callLlm");
    spy.mockResolvedValueOnce(reply("I have begun. The hearth is already at it."));
    await bare.sendDialogue("smith", "conform");
    expect(bare.pending.filter((p) => p.status === "pending")).toHaveLength(0);
    expect(bare.state.projects).toEqual([]);
    expect(bare.state.resources.iron).toBe(25);
    expect(bare.state.resources.charcoal).toBe(1);
    const spoken = smithSpeech(bare);
    expect(spoken).toMatch(/books are unchanged/i);
    expect(spoken).toMatch(/not begun/);
    expect(spoken).not.toMatch(CLAIM);
    expect(spoken).not.toMatch(JARGON);
  });
});
