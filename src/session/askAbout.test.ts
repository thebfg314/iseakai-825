import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { WorldStateSchema } from "../engine/schema";
import { parseLlmResponse } from "../llm/parse";
import { defaultAppSettings } from "../llm/settings";
import { GameController, messagesForScene } from "./game";

const llmChatMock = vi.hoisted(() => vi.fn());

vi.mock("../llm", () => ({
  llmChat: (...args: unknown[]) => llmChatMock(...args),
}));

function tempGame() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isekai-"));
  const state = WorldStateSchema.parse(structuredClone(startingEstate));
  return new GameController(state, dir, defaultAppSettings());
}

function queueMill(game: GameController) {
  const parsed = parseLlmResponse(
    JSON.stringify({
      speech: "A flour mill on the stream, my lord.",
      proposals: [
        {
          type: "start_project",
          projectKey: "flour_mill",
          summary: "Raise a flour mill",
          holdingId: "fontenay",
        },
      ],
    }),
  );
  game.ingestParsedDialogue("steward", parsed, "Build a flour mill.");
}

function queueHunt(game: GameController) {
  const parsed = parseLlmResponse(JSON.stringify({ speech: "Pepper. I will name the purse.", proposals: [] }));
  game.ingestParsedDialogue("negotiator", parsed, "Find me pepper.");
}

function llmUserPack(): string {
  return llmChatMock.mock.calls
    .map((call) => {
      const messages = call[1] as { role: string; content: string }[] | undefined;
      if (!Array.isArray(messages)) return "";
      return messages.map((m) => m.content).join("\n");
    })
    .join("\n");
}

describe("Ask about a pending card", () => {
  beforeEach(() => {
    llmChatMock.mockReset();
  });

  it("switches to the mill proposer and does not confirm or reject", () => {
    const game = tempGame();
    game.setScene("negotiator");
    queueMill(game);
    const before = game.state.projects.length;
    const denarii = game.state.resources.denarii;
    const card = game.pending.find((p) => p.status === "pending");
    expect(card?.npcId).toBe("steward");

    const view = game.askAboutProposal(card!.id);
    expect(view.error).toBeUndefined();
    expect(view.sceneNpcId).toBe("steward");
    expect(game.sceneNpcId).toBe("steward");
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(1);
    expect(game.pending[0].status).toBe("pending");
    expect(game.pending[0].id).toBe(card!.id);
    expect(game.state.projects.length).toBe(before);
    expect(game.state.resources.denarii).toBe(denarii);
    expect(game.state.projects.some((p) => p.key === "flour_mill")).toBe(false);
  });

  it("switches to Gerulf on a hunt card and leaves the purse unspent", () => {
    const game = tempGame();
    expect(game.sceneNpcId).toBe("steward");
    queueHunt(game);
    const card = game.pending.find((p) => p.status === "pending");
    expect(card?.npcId).toBe("negotiator");
    const chest = game.state.resources.denarii;

    game.askAboutProposal(card!.id);
    expect(game.sceneNpcId).toBe("negotiator");
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(1);
    expect(game.pending[0].proposal.type).toBe("start_hunt");
    expect(game.state.resources.denarii).toBe(chest);
    expect(game.state.projects).toHaveLength(0);
  });

  it("puts the cue on that NPC's tab only", () => {
    const game = tempGame();
    queueHunt(game);
    const card = game.pending.find((p) => p.status === "pending")!;
    game.askAboutProposal(card.id);

    const gerulf = messagesForScene(game.messages, "negotiator");
    const aldric = messagesForScene(game.messages, "steward");
    expect(gerulf.some((m) => m.aside && /hunt for pepper/i.test(m.text) && /Gerulf/.test(m.text))).toBe(true);
    expect(gerulf.filter((m) => m.aside)).toHaveLength(1);
    expect(aldric.some((m) => m.aside)).toBe(false);
    expect(aldric.some((m) => /hunt for pepper/i.test(m.text))).toBe(false);
    expect(game.view().messages.some((m) => m.aside && /hunt for pepper/i.test(m.text))).toBe(true);

    game.setScene("steward");
    expect(game.view().messages.some((m) => m.aside)).toBe(false);
  });

  it("replaces the asked-about mill when a matching start_project returns", () => {
    const game = tempGame();
    queueMill(game);
    const original = game.pending.find((p) => p.status === "pending")!;
    game.askAboutProposal(original.id);

    const revised = parseLlmResponse(
      JSON.stringify({
        speech: "A second wheel, then, and more stone.",
        proposals: [
          {
            type: "start_project",
            projectKey: "flour_mill",
            summary: "Flour mill with a second wheel",
            holdingId: "fontenay",
            customCosts: { labourDays: 280, lumber: 12, iron: 70, stone: 8 },
          },
        ],
      }),
    );
    game.ingestParsedDialogue("steward", revised, "the mill should have a second wheel");

    const pending = game.pending.filter((p) => p.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].id).not.toBe(original.id);
    expect(pending[0].proposal).toMatchObject({
      type: "start_project",
      projectKey: "flour_mill",
      summary: "Flour mill with a second wheel",
    });
    if (pending[0].proposal.type !== "start_project") throw new Error("expected start_project");
    expect(pending[0].proposal.customCosts?.stone).toBe(8);
    expect(game.state.projects).toHaveLength(0);
  });

  it("replaces the asked-about hunt when a matching start_hunt returns", () => {
    const game = tempGame();
    queueHunt(game);
    const original = game.pending.find((p) => p.status === "pending")!;
    if (original.proposal.type !== "start_hunt") throw new Error("expected start_hunt");
    game.askAboutProposal(original.id);

    const revised = parseLlmResponse(
      JSON.stringify({
        speech: "Forty denarii, then.",
        proposals: [
          {
            type: "start_hunt",
            goods: "pepper",
            resource: "pepper",
            amount: 2,
            quotedDenarii: 40,
            durationSeasons: 3,
            summary: "Seek pepper for a thinner purse",
          },
        ],
      }),
    );
    game.ingestParsedDialogue("negotiator", revised, "offer 40 denarii not 80");

    const pending = game.pending.filter((p) => p.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].id).not.toBe(original.id);
    expect(pending[0].proposal).toMatchObject({ type: "start_hunt" });
    if (pending[0].proposal.type !== "start_hunt") throw new Error("expected start_hunt");
    expect(pending[0].proposal.goods).toMatch(/pepper/i);
    expect(game.state.projects).toHaveLength(0);
    expect(game.state.resources.denarii).toBeGreaterThan(0);
  });

  it("still queues a genuinely new extra order beside the asked-about card", () => {
    const game = tempGame();
    queueMill(game);
    game.askAboutProposal(game.pending[0].id);

    const extra = parseLlmResponse(
      JSON.stringify({
        speech: "And we can clear an acre of scrub besides.",
        proposals: [
          {
            type: "start_project",
            projectKey: "clear_scrub",
            summary: "Clear an acre of scrub",
            holdingId: "fontenay",
          },
        ],
      }),
    );
    game.ingestParsedDialogue("steward", extra, "Also start clearing the scrub.");

    const pending = game.pending.filter((p) => p.status === "pending");
    expect(pending).toHaveLength(2);
    expect(pending.map((p) => (p.proposal.type === "start_project" ? p.proposal.projectKey : ""))).toEqual(
      expect.arrayContaining(["flour_mill", "clear_scrub"]),
    );
  });

  it("leaves the card unchanged on incomplete JSON", () => {
    const game = tempGame();
    queueMill(game);
    const original = game.pending[0];
    game.askAboutProposal(original.id);
    const parsed = parseLlmResponse('{ "speech": "A second wheel", "proposals": [ { "type": "start_project" }');
    expect(parsed.incomplete).toBe(true);
    game.ingestParsedDialogue("steward", parsed, "use more stone");
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(1);
    expect(game.pending[0].id).toBe(original.id);
    expect(game.pending[0].proposal).toMatchObject({ type: "start_project", projectKey: "flour_mill" });
  });

  it("puts the asked-about offer in the next talk pack and does not auto-send a player line", async () => {
    const game = tempGame();
    queueMill(game);
    game.askAboutProposal(game.pending[0].id);
    const beforeAsk = game.messages.filter((m) => m.role === "player").length;

    llmChatMock.mockResolvedValue(
      JSON.stringify({
        speech: "A second wheel is possible.",
        emotion: "thoughtful",
        proposals: [],
      }),
    );
    await game.sendDialogue("steward", "the mill should have a second wheel");

    const pack = llmUserPack();
    expect(pack).toMatch(/PENDING OFFER UNDER DISCUSSION/);
    expect(pack).toMatch(/flour_mill/);
    expect(pack).toMatch(/230 days/);
    expect(game.messages.filter((m) => m.role === "player")).toHaveLength(beforeAsk + 1);
    expect(game.messages.filter((m) => m.role === "player").at(-1)?.text).toBe("the mill should have a second wheel");
  });

  it("does not write the books when the next talk times out", async () => {
    const game = tempGame();
    queueMill(game);
    const original = game.pending[0];
    game.askAboutProposal(original.id);
    llmChatMock.mockRejectedValueOnce(
      new Error('RFAB chat 502: {"success":false,"error":"PROVIDER_ERROR","message":"No response"}'),
    );
    await game.sendDialogue("steward", "use more stone");
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(1);
    expect(game.pending[0].id).toBe(original.id);
    expect(game.state.projects).toHaveLength(0);
  });

  it("still lets Confirm write the books after Ask about", () => {
    const game = tempGame();
    const ironBefore = game.state.resources.iron;
    const parsed = parseLlmResponse(
      JSON.stringify({
        speech: "We can clear an acre.",
        proposals: [{ type: "start_project", projectKey: "clear_scrub", summary: "Clear scrub", holdingId: "fontenay" }],
      }),
    );
    game.ingestParsedDialogue("steward", parsed, "Start clearing the scrub.");
    game.askAboutProposal(game.pending[0].id);
    const result = game.confirmProposal(game.pending[0].id);
    expect(result.error).toBeUndefined();
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
    expect(game.state.projects.some((p) => p.key === "clear_scrub" && p.status === "active")).toBe(true);
    expect(game.state.resources.iron).toBe(ironBefore);
  });
});
