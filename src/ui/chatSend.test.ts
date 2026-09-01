import { describe, expect, it } from "vitest";
import { emptyMeter } from "../llm/usage";
import type { GameView } from "../shared/types";
import { applyServerDialogueView, isOptimisticPlayerId, viewWithOptimisticPlayer } from "./chatSend";

function stubView(over: Partial<GameView> = {}): GameView {
  return {
    state: {} as GameView["state"],
    pending: [],
    messages: [],
    sceneNpcId: "steward",
    labour: { pool: { men: 0, women: 0, youths: 0 }, remaining: { men: 0, women: 0, youths: 0 } },
    smithAvailable: true,
    chaplainAvailable: true,
    merchantAvailable: false,
    sceneEmotion: "neutral",
    historyTail: [],
    llmMeter: emptyMeter("rfab"),
    ...over,
  };
}

describe("optimistic player send", () => {
  it("appends a player bubble on the open NPC tab before any model reply", () => {
    const view = stubView({
      messages: [{ id: "msg-open", role: "npc", npcId: "steward", text: "My lord.", at: "t0" }],
    });
    const next = viewWithOptimisticPlayer(view, "How fares the rye?");
    expect(next.messages.map((m) => m.role)).toEqual(["npc", "player"]);
    expect(next.messages[1]).toMatchObject({ role: "player", npcId: "steward", text: "How fares the rye?" });
    expect(isOptimisticPlayerId(next.messages[1].id)).toBe(true);
    expect(view.messages).toHaveLength(1);
  });

  it("does not double the player line when the session already recorded it", () => {
    const optimistic = viewWithOptimisticPlayer(stubView(), "How fares the rye?");
    const server = stubView({
      messages: [
        { id: "msg-1", role: "player", npcId: "steward", text: "How fares the rye?", at: "t1" },
        { id: "msg-2", role: "npc", npcId: "steward", text: "The rye stands well.", at: "t2" },
      ],
    });
    const merged = applyServerDialogueView(optimistic, server);
    expect(merged.messages.filter((m) => m.role === "player")).toHaveLength(1);
    expect(merged.messages.some((m) => isOptimisticPlayerId(m.id))).toBe(false);
    expect(merged.messages.some((m) => /rye stands well/.test(m.text))).toBe(true);
  });

  it("keeps the player bubble if the reply fails before the session records it", () => {
    const optimistic = viewWithOptimisticPlayer(stubView(), "How fares the rye?");
    const server = stubView({
      messages: [{ id: "msg-open", role: "npc", npcId: "steward", text: "My lord.", at: "t0" }],
    });
    const merged = applyServerDialogueView(optimistic, server);
    expect(merged.messages.some((m) => m.role === "player" && m.text === "How fares the rye?")).toBe(true);
  });

  it("does not leak a steward line onto the smith tab", () => {
    const optimistic = viewWithOptimisticPlayer(stubView({ sceneNpcId: "steward" }), "How fares the rye?");
    const smith = stubView({ sceneNpcId: "smith", messages: [] });
    const merged = applyServerDialogueView(optimistic, smith);
    expect(merged.sceneNpcId).toBe("smith");
    expect(merged.messages.some((m) => /rye/.test(m.text))).toBe(false);
  });
});
