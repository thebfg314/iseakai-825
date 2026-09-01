import type { ChatMessage } from "../engine/schema";
import type { GameView } from "../shared/types";

export const OPTIMISTIC_PLAYER_PREFIX = "local-player-";

export function makeOptimisticPlayerMessage(npcId: string, text: string, at = new Date().toISOString()): ChatMessage {
  return {
    id: `${OPTIMISTIC_PLAYER_PREFIX}${npcId}-${at}`,
    role: "player",
    npcId,
    text,
    at,
  };
}

export function isOptimisticPlayerId(id: string): boolean {
  return id.startsWith(OPTIMISTIC_PLAYER_PREFIX);
}

/** Local player bubble for the open NPC tab, before the model answers. */
export function viewWithOptimisticPlayer(view: GameView, text: string): GameView {
  const trimmed = text.trim();
  return {
    ...view,
    messages: [...view.messages, makeOptimisticPlayerMessage(view.sceneNpcId, trimmed)],
  };
}

function playerKey(m: Pick<ChatMessage, "npcId" | "text" | "role">): string {
  return `${m.npcId ?? ""}\0${m.text}`;
}

/**
 * Prefer the session's chat log. Drop a local player bubble when the save
 * already recorded that same line for this NPC, so the reply cannot double it.
 * Keep the local line if the server view never got it (failed before record).
 */
export function applyServerDialogueView(previous: GameView, server: GameView): GameView {
  if (server.sceneNpcId !== previous.sceneNpcId) return server;

  const serverKeys = new Set(server.messages.filter((m) => m.role === "player").map(playerKey));
  const leftover = previous.messages.filter(
    (m) =>
      m.role === "player" &&
      isOptimisticPlayerId(m.id) &&
      m.npcId === server.sceneNpcId &&
      !serverKeys.has(playerKey(m)),
  );
  if (!leftover.length) return server;
  return { ...server, messages: [...server.messages, ...leftover] };
}
