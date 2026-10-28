import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { WorldStateSchema } from "../engine/schema";
import { setHistoryContentForTests } from "../history/load";
import { npcSystemPrompt } from "../llm/prompts";
import { parseLlmResponse } from "../llm/parse";
import { defaultAppSettings } from "../llm/settings";

const llmChatMock = vi.hoisted(() => vi.fn());

vi.mock("../llm", () => ({
  llmChat: (...args: unknown[]) => llmChatMock(...args),
}));

import { GameController } from "./game";

const EVENTS = [
  {
    id: "825-01",
    title: "Word from the count",
    arc: 1,
    type: "choice",
    fires: { year: 825, season: "summer" },
    channel: ["chaplain", "steward"],
    source: "The count's messenger.",
    script: [
      { speaker: "chaplain", frame: "reads the letter aloud", text: "To the lord of Fontenay, greeting." },
      { speaker: "steward", frame: "after", text: "My lord, this wants an answer before the leaves turn." },
    ],
    knows: ["The messenger rode from Autun in two days."],
    doesntKnow: ["What the count means to do in 830."],
    choices: {
      deadlineSeasons: 1,
      options: [
        { id: "answer", label: "Send a warm answer", effects: { flags: { count_opinion: "+1" } } },
        { id: "silence", label: "Send nothing", default: true },
      ],
    },
    links: { momentum: 50 },
  },
];

function tempGame() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isekai-history-"));
  const state = WorldStateSchema.parse(structuredClone(startingEstate));
  return new GameController(state, dir, defaultAppSettings());
}

const SEASON_JSON = JSON.stringify({
  speech: "The season turned, my lord.",
  emotion: "neutral",
  proposals: [{ type: "event_effect", eventId: "season", summary: "The usual change", moodDelta: 1 }],
});

describe("history layer in the game controller", () => {
  beforeEach(() => {
    llmChatMock.mockReset();
    setHistoryContentForTests({ events: EVENTS });
  });
  afterEach(() => setHistoryContentForTests(null));

  it("posts the script on each speaker's tab after the season report, badges the absent tab, and briefs the referee", async () => {
    const game = tempGame();
    llmChatMock.mockResolvedValue(SEASON_JSON);
    await game.advanceSeason();
    expect(game.state.meta.season).toBe("summer");
    const steward = game.messages.filter((m) => m.npcId === "steward" && m.role === "npc").map((m) => m.text);
    const chaplain = game.messages.filter((m) => m.npcId === "chaplain" && m.role === "npc").map((m) => m.text);
    expect(chaplain).toContain("(reads the letter aloud) To the lord of Fontenay, greeting.");
    expect(steward.at(-1)).toBe("(after) My lord, this wants an answer before the leaves turn.");
    expect(steward.indexOf("The season turned, my lord.")).toBeLessThan(steward.indexOf("(after) My lord, this wants an answer before the leaves turn."));
    expect(game.state.npcs.find((n) => n.id === "chaplain")?.wantsTalk).toBe(true);
    const refereeUser = (llmChatMock.mock.calls[0][1] as { content: string }[]).map((m) => m.content).join("\n");
    expect(refereeUser).toContain('History: 825-01 "Word from the count" was told by Ermenald and Aldric');
    expect(game.state.history.openChoices).toHaveLength(1);
  });

  it("puts the HISTORY block in Aldric's and Ermenald's prompts, but not the smith's", async () => {
    const game = tempGame();
    llmChatMock.mockResolvedValue(SEASON_JSON);
    await game.advanceSeason();
    const aldric = npcSystemPrompt("steward", game.state);
    expect(aldric).toContain("HISTORY (engine truth");
    expect(aldric).toContain("OPEN CHOICE (deadline: end of this season)");
    expect(aldric).toContain('answer ("Send a warm answer")');
    expect(aldric).toContain("Count Thierry of Autun");
    expect(aldric).toContain("body age is 17");
    expect(npcSystemPrompt("chaplain", game.state)).toContain("Knows: The messenger rode from Autun in two days.");
    expect(npcSystemPrompt("smith", game.state)).not.toContain("HISTORY (engine truth");
  });

  it("a history_choice from the books pass becomes a Confirm card and writes the flag only on Confirm", async () => {
    const game = tempGame();
    llmChatMock.mockResolvedValue(SEASON_JSON);
    await game.advanceSeason();
    const parsed = parseLlmResponse(
      JSON.stringify({
        speech: "I will write to the count in warm terms.",
        emotion: "respectful",
        proposals: [{ type: "history_choice", summary: "A warm answer to the count", eventId: "825-01", optionId: "answer" }],
      }),
    );
    game.ingestParsedDialogue("steward", parsed, "Write back warmly and say we are his men.", undefined, undefined, true);
    const card = game.pending.find((p) => p.status === "pending");
    expect(card?.proposal.type).toBe("history_choice");
    expect(game.state.history.flags.count_opinion).toBeUndefined();
    game.confirmProposal(card!.id);
    expect(game.state.history.flags.count_opinion).toBe(1);
    expect(game.state.history.chosen["825-01"]).toBe("answer");
    expect(game.state.history.openChoices).toHaveLength(0);
  });

  it("an unanswered choice takes its default when the next season turns", async () => {
    const game = tempGame();
    llmChatMock.mockResolvedValue(SEASON_JSON);
    await game.advanceSeason();
    await game.advanceSeason();
    expect(game.state.history.chosen["825-01"]).toBe("silence");
    expect(game.messages.some((m) => m.npcId === "steward" && m.text === "The matter settled itself: send nothing.")).toBe(true);
  });

  it("dev hooks jump the calendar and set registered flags", () => {
    const game = tempGame();
    game.historyJumpTo(840, "autumn");
    expect(game.state.meta.turn).toBe(63);
    game.historySetFlags({ side_830: "bernard", favor_septimania: 2 });
    expect(game.state.history.flags.side_830).toBe("bernard");
    expect(() => game.historySetFlags({ not_a_flag: true })).toThrow(/Unknown history flag/);
  });
});
