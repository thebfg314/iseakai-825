import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { WorldStateSchema } from "../engine/schema";
import { looksLikeMechanicalOrder } from "../engine/orderIntent";
import { looksLikeSpokenAgree } from "../engine/spokenWork";
import { defaultAppSettings } from "../llm/settings";

const llmChatMock = vi.hoisted(() => vi.fn());

vi.mock("../llm", () => ({
  llmChat: (...args: unknown[]) => llmChatMock(...args),
}));

import { GameController } from "./game";

function tempGame() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isekai-"));
  const state = WorldStateSchema.parse(structuredClone(startingEstate));
  return new GameController(state, dir, defaultAppSettings());
}

function lastTurn(game: GameController) {
  const idx = game.messages.map((m) => m.role).lastIndexOf("player");
  return idx < 0 ? [] : game.messages.slice(idx);
}

function callText(index: number) {
  const messages = llmChatMock.mock.calls[index][1] as { content: string }[];
  return messages.map((m) => m.content).join("\n");
}

// Word for word from the play log that started this work: the regex never heard it as an order.
const COPPICE_ORDER =
  "Id also like us to fence off some of our woodlands allowing up to harvest some of the younger sprouting trees regularly as they grow up.  I believe this is called coppiceing and will help greatly with sustainable wood supplies.";
const SCHOOL_ORDER = "From now on every child on the estate under twelve is to spend their mornings with the monks learning letters.";

const coppiceBooks = () =>
  JSON.stringify({
    speech: "It will be done, my lord.",
    emotion: "thoughtful",
    proposals: [
      {
        type: "start_project",
        summary: "Coppice the hazel and ash along the wood edge",
        projectKey: "coppice_wood_edge",
        holdingId: "fontenay",
        customCosts: { labourDays: 30 },
        days: 30,
      },
      {
        type: "set_standing_order",
        summary: "Seven-year coppice round",
        text: "Cut each coppice panel to the stool in its seventh winter, and no sooner.",
        active: true,
      },
    ],
  });

describe("the books gate: regex floor plus the model's hidden tag", () => {
  beforeEach(() => {
    llmChatMock.mockReset();
  });

  it("the regex alone does not hear coppicing or the school as orders", () => {
    expect(looksLikeMechanicalOrder(COPPICE_ORDER, "steward")).toBe(false);
    expect(looksLikeMechanicalOrder(SCHOOL_ORDER, "steward")).toBe(false);
  });

  it("[[books:yes]] from the speech pass opens the books for a coppicing order the regex never heard of", async () => {
    const game = tempGame();
    llmChatMock.mockResolvedValueOnce("Coppicing, my lord? The hazel will take to it. Thirty days of work this winter. [[books:yes]]");
    llmChatMock.mockResolvedValueOnce(coppiceBooks());
    await game.sendDialogue("steward", COPPICE_ORDER);
    expect(llmChatMock).toHaveBeenCalledTimes(2);
    expect(callText(1)).toMatch(/The lord gave an order that must change the ledger/);
    const turn = lastTurn(game);
    expect(turn.some((m) => m.role === "npc" && /Coppicing, my lord\?/.test(m.text))).toBe(true);
    expect(turn.every((m) => !/\[\[books/.test(m.text))).toBe(true);
    const pending = game.pending.filter((p) => p.status === "pending");
    expect(pending).toHaveLength(2);
    expect(pending[0].proposal).toMatchObject({ type: "start_project", projectKey: "coppice_wood_edge" });
    expect(pending[1].proposal).toMatchObject({ type: "set_standing_order" });
  });

  it("[[books:yes]] on an anachronistic order runs a books pass without forcing a proposal", async () => {
    const game = tempGame();
    llmChatMock.mockResolvedValueOnce("Letters for the children? Brother Odo will think it strange, but it can be done. [[books:yes]]");
    llmChatMock.mockResolvedValueOnce(JSON.stringify({ speech: "I will speak to the cell.", proposals: [] }));
    await game.sendDialogue("steward", SCHOOL_ORDER);
    // Speech, then books. No "proposals was empty" repair: only the model's tag opened the gate.
    expect(llmChatMock).toHaveBeenCalledTimes(2);
    const turn = lastTurn(game);
    expect(turn.some((m) => m.role === "npc" && /Letters for the children/.test(m.text))).toBe(true);
    expect(turn.some((m) => m.role === "system" && /nothing was set down in the books/i.test(m.text))).toBe(true);
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
  });

  it("[[books:no]] on talk leaves it at one call and no ledger line", async () => {
    const game = tempGame();
    llmChatMock.mockResolvedValueOnce("A fair morning, my lord. The rye stands well. [[books:no]]");
    await game.sendDialogue("steward", "Good morning, Aldric. How is the weather treating us?");
    expect(llmChatMock).toHaveBeenCalledTimes(1);
    const turn = lastTurn(game);
    expect(turn.map((m) => m.role)).toEqual(["player", "npc"]);
    expect(turn[1].text).toBe("A fair morning, my lord. The rye stands well.");
  });

  it("[[books:no]] cannot close the gate on a plain regex order", async () => {
    const game = tempGame();
    llmChatMock.mockResolvedValueOnce("As you say. [[books:no]]");
    llmChatMock.mockResolvedValue(
      JSON.stringify({
        speech: "Done.",
        proposals: [{ type: "start_project", summary: "Clear scrub", projectKey: "clear_scrub", holdingId: "fontenay" }],
      }),
    );
    await game.sendDialogue("steward", "Start clearing the scrub.");
    expect(llmChatMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(1);
  });
});

describe("agreeing to a spoken plan", () => {
  beforeEach(() => {
    llmChatMock.mockReset();
  });

  it("hears the wider agreement phrases", () => {
    for (const line of [
      "Approved.",
      "Approve them all.",
      "Send me the projects to approve.",
      "Put it in the books.",
      "Write it down.",
      "Draw up the cards.",
      "Set that down in the books, Aldric.",
      "Let us do it.",
      "Yes.",
      "Yes, do it.",
    ]) {
      expect(looksLikeSpokenAgree(line), line).toBe(true);
    }
    expect(looksLikeSpokenAgree("yes lets go and see what each side has to say.")).toBe(false);
    for (const line of ["How would coppicing work?", "What do the projects cost?", "Tell me of the weather."]) {
      expect(looksLikeSpokenAgree(line), line).toBe(false);
    }
  });

  it("runs a books pass over the steward's last spoken plan when the lord says 'send me the projects'", async () => {
    const game = tempGame();
    // Turn one: the lord asks, the steward lays out a plan in talk. [[books:no]]: it is still a question.
    llmChatMock.mockResolvedValueOnce(
      "Coppicing, my lord? Cut the hazel to the stool this winter, thirty days of work, and a seven-year round after. [[books:no]]",
    );
    await game.sendDialogue("steward", "How would coppicing the wood edge work here?");
    expect(llmChatMock).toHaveBeenCalledTimes(1);
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);

    // Turn two: the lord agrees. The speech pass answers, then the plan is set down.
    llmChatMock.mockResolvedValueOnce("I will have the cards drawn, my lord. [[books:yes]]");
    llmChatMock.mockResolvedValueOnce(coppiceBooks());
    await game.sendDialogue("steward", "Send me the projects to approve.");
    expect(llmChatMock).toHaveBeenCalledTimes(3);
    const follow = callText(2);
    expect(follow).toMatch(/The lord agreed to the plan you spoke/);
    expect(follow).toMatch(/Cut the hazel to the stool this winter/);
    const turn = lastTurn(game);
    expect(turn.some((m) => m.role === "npc" && /I will have the cards drawn/.test(m.text))).toBe(true);
    const pending = game.pending.filter((p) => p.status === "pending");
    expect(pending).toHaveLength(2);
    expect(pending[0].proposal).toMatchObject({ type: "start_project", projectKey: "coppice_wood_edge" });
  });

  it("does not turn a yes to hearing a case into plough ironwork from older talk", async () => {
    const game = tempGame();
    llmChatMock.mockResolvedValueOnce(
      "The mill wants 40 lb of iron and 20 cart-loads of stone. The plough is already in the barn. [[books:no]]",
    );
    await game.sendDialogue("steward", "What would a mill cost, and what of the plough?");
    llmChatMock.mockResolvedValueOnce(
      "My lord, I have brought both households to the hall door. Ask what you will. [[books:yes]]",
    );
    await game.sendDialogue("steward", "yes lets go and see what each side has to say.");
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
    expect(game.state.projects).toEqual([]);
  });

  it("keeps a spoken iron figure on the pending mill instead of opening another work", async () => {
    const game = tempGame();
    game.queueProposal("steward", {
      type: "start_project",
      summary: "Begin the flour mill at Fontenay",
      projectKey: "flour_mill",
      holdingId: "fontenay",
      finishesThisSeason: true,
    });
    llmChatMock.mockResolvedValueOnce(
      "My lord, I have set down a plainer mill at 40 lb. [[books:yes]]",
    );
    await game.sendDialogue("steward", "did we not say that 40 lbs of iron would suffice?");
    const pending = game.pending.filter((p) => p.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].proposal).toMatchObject({
      type: "start_project",
      projectKey: "flour_mill",
      customCosts: { iron: 40 },
    });
    expect(game.messages.some((m) => /now takes 40 lb of iron/.test(m.text))).toBe(true);
    expect(llmChatMock).toHaveBeenCalledTimes(1);
  });

  it("a bare 'yes' after greeting talk the model marks [[books:no]] stays one call", async () => {
    const game = tempGame();
    llmChatMock.mockResolvedValueOnce("A fair morning to you too, my lord. [[books:no]]");
    await game.sendDialogue("steward", "Good morning, Aldric.");
    llmChatMock.mockResolvedValueOnce("Aye, my lord. [[books:no]]");
    await game.sendDialogue("steward", "Yes.");
    expect(llmChatMock).toHaveBeenCalledTimes(2);
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
  });
});
