import type { MechanicalProposal, NpcMemory, WorldState } from "./schema";

/** Keep the save compact; the prompt uses a shorter tail. */
export const MAX_STORED_MEMORIES = 20;
export const MAX_PROMPT_MEMORIES = 8;
export const MAX_SUMMARY_CHARS = 220;

const JARGON = /\b(transfer_resources|register_npc|register_feature|register_resource|adjust_sowing|adjust_project|assign_labour|start_project|start_hunt|sponsor_feast|add_modifier|remove_modifier|set_standing_order|event_effect|defer_proposal|schedule_order|world-state\.json|world-state|JSON|npcId|isNew)\b/gi;

export function compactMemorySummary(proposal: MechanicalProposal, logLine: string): string {
  const fromProposal = proposal.summary?.trim();
  const raw = logLine.trim() || (fromProposal && fromProposal !== proposal.type ? fromProposal : "");
  let text = raw.replace(JARGON, " ").replace(/[{}\[\]"]/g, " ").replace(/\s+/g, " ").trim();
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? (text ? [text] : []);
  text = sentences.slice(0, 2).join(" ").replace(/\s+/g, " ").trim();
  if (text.length > MAX_SUMMARY_CHARS) {
    text = `${text.slice(0, MAX_SUMMARY_CHARS - 1).replace(/\s+\S*$/, "").trimEnd()}…`;
  }
  return text;
}

export function stampMemory(state: WorldState, summary: string): NpcMemory {
  return {
    turn: state.meta.turn,
    year: state.meta.year,
    season: state.meta.season,
    summary,
  };
}

function capMemories(list: NpcMemory[]): NpcMemory[] {
  return list.length > MAX_STORED_MEMORIES ? list.slice(-MAX_STORED_MEMORIES) : list;
}

export function memoriesForMerchantName(state: WorldState, name: string | undefined): NpcMemory[] {
  if (!name) return [];
  return state.merchant_memories?.[name] ?? [];
}

export function persistMerchantVisitorMemories(state: WorldState, name: string, memories: NpcMemory[]): void {
  if (!name) return;
  state.merchant_memories ??= {};
  if (!memories.length && state.merchant_memories[name]?.length) return;
  if (!memories.length) return;
  state.merchant_memories[name] = capMemories([...memories]);
}

function syncMerchantNpcMemories(state: WorldState, name: string, memories: NpcMemory[]): void {
  const npc = state.npcs.find((n) => n.id === "merchant" && n.name === name);
  if (npc) npc.memories = memories;
}

export function appendMerchantMemoryByName(state: WorldState, name: string, memory: NpcMemory): void {
  if (!name) return;
  state.merchant_memories ??= {};
  const next = capMemories([...(state.merchant_memories[name] ?? []), memory]);
  state.merchant_memories[name] = next;
  syncMerchantNpcMemories(state, name, next);
}

export function appendNpcMemory(state: WorldState, npcId: string, memory: NpcMemory): void {
  if (npcId === "merchant") {
    const name = state.merchant.name ?? state.npcs.find((n) => n.id === "merchant")?.name;
    if (name) appendMerchantMemoryByName(state, name, memory);
    return;
  }
  const npc = state.npcs.find((n) => n.id === npcId);
  if (!npc) return;
  npc.memories = capMemories([...(npc.memories ?? []), memory]);
}

function isMerchantTrade(proposal: MechanicalProposal): boolean {
  return proposal.type === "transfer_resources" && (proposal.direction === "buy" || proposal.direction === "sell");
}

/**
 * Confirm-backed deals only. Records the proposing person, plus the hired
 * person on register_npc and the visiting merchant (by name) on buy/sell.
 */
export function recordConfirmedTransaction(
  state: WorldState,
  npcId: string,
  proposal: MechanicalProposal,
  logLine: string,
): void {
  const summary = compactMemorySummary(proposal, logLine);
  if (!summary) return;
  const memory = stampMemory(state, summary);

  if (npcId && npcId !== "referee") {
    appendNpcMemory(state, npcId, memory);
  }

  if (isMerchantTrade(proposal) && state.merchant.name && npcId !== "merchant") {
    appendMerchantMemoryByName(state, state.merchant.name, memory);
  }

  if (proposal.type === "register_npc") {
    const hiredId = proposal.npc.id;
    if (hiredId && hiredId !== npcId) appendNpcMemory(state, hiredId, memory);
  }
}

export function memoriesForSpeaker(state: WorldState, npcId: string): NpcMemory[] {
  if (npcId === "merchant") {
    const name = state.merchant.name ?? state.npcs.find((n) => n.id === "merchant")?.name;
    const byName = memoriesForMerchantName(state, name);
    if (byName.length) return byName;
    return state.npcs.find((n) => n.id === "merchant")?.memories ?? [];
  }
  return state.npcs.find((n) => n.id === npcId)?.memories ?? [];
}

function seasonLabel(season: string): string {
  return season.charAt(0).toUpperCase() + season.slice(1);
}

/** Compact block for one speaker's system prompt. Empty when they have no deals. */
export function speakerMemoryPrompt(state: WorldState, npcId: string): string {
  const memories = memoriesForSpeaker(state, npcId).slice(-MAX_PROMPT_MEMORIES);
  if (!memories.length) return "";
  const lines = memories.map((m) => `- ${seasonLabel(m.season)} ${m.year}: ${m.summary}`);
  return `You remember these past dealings with the lord. If they matter, mention them in your own voice. Never mention a memory list, JSON, or save files.\n${lines.join("\n")}`;
}

export function withSpeakerMemories(prompt: string, npcId: string, state?: WorldState): string {
  if (!state) return prompt;
  const block = speakerMemoryPrompt(state, npcId);
  return block ? `${prompt}\n${block}` : prompt;
}

/** World-state slice must not dump everyone's memories (or merchant_memories). */
export function npcWithoutMemories<T extends { memories?: NpcMemory[] }>(npc: T): Omit<T, "memories"> {
  const { memories: _ignored, ...rest } = npc;
  return rest;
}
