import type { WorldState } from "../engine/schema";
import { evalCondition } from "./conditions";
import { applyEffects } from "./effects";
import { conditionContext } from "./flags";
import { historyContent } from "./load";
import { defaultOption, type SeasonAt } from "./scheduler";
import type { HistoryEvent, HistoryOption, HistorySpeaker, HistoryStage, ScriptBlock } from "./schema";
import { fillSlots } from "./slots";

/** One verbatim line for an NPC's tab. */
export type HistoryBeat = {
  npcId: HistorySpeaker;
  text: string;
  emotion?: string;
  eventId: string;
};

export type DeliveryResult = {
  beats: HistoryBeat[];
  /** Ledger lines (costs, renown) for the season report. */
  lines: string[];
};

function speakerName(state: WorldState, id: HistorySpeaker): string {
  return state.npcs.find((n) => n.id === id)?.name ?? (id === "steward" ? "Aldric" : "Ermenald");
}

/** `(reads the letter aloud) My lord, …` */
export function renderBlock(block: ScriptBlock, text = block.text): string {
  return block.frame ? `(${block.frame}) ${text}` : text;
}

export function renderScript(state: WorldState, event: HistoryEvent, blocks: ScriptBlock[], at: SeasonAt, variants = event.variants): HistoryBeat[] {
  const ctx = conditionContext(state, at);
  const beats: HistoryBeat[] = [];
  blocks.forEach((block, i) => {
    if (block.when && !evalCondition(block.when, ctx)) return;
    let text = block.text;
    for (const v of variants) {
      if (v.replace === i && evalCondition(v.when, ctx)) {
        text = v.text;
        break;
      }
    }
    beats.push({ npcId: block.speaker, text: renderBlock(block, fillSlots(state, text)), emotion: block.emotion, eventId: event.id });
  });
  return beats;
}

function openChoice(state: WorldState, event: HistoryEvent, stage: HistoryStage | undefined, turn: number) {
  const choices = stage?.choices ?? event.choices;
  if (!choices) return;
  const key = { eventId: event.id, stageId: stage?.id, opensTurn: turn, deadlineTurn: turn + choices.deadlineSeasons };
  state.history.openChoices = state.history.openChoices.filter((c) => !(c.eventId === event.id && c.stageId === stage?.id));
  state.history.openChoices.push(key);
}

function openOutcome(state: WorldState, event: HistoryEvent, stage: HistoryStage | undefined, turn: number) {
  const outcomes = stage?.outcomes ?? event.outcomes;
  if (!outcomes) return;
  if (event.links.fixedPoint && outcomes.options.length === 1) {
    // Fixed points are not judged; the single option lands at the deadline.
  }
  state.history.openOutcomes = state.history.openOutcomes.filter((c) => !(c.eventId === event.id && c.stageId === stage?.id));
  state.history.openOutcomes.push({ eventId: event.id, stageId: stage?.id, opensTurn: turn, deadlineTurn: turn + outcomes.windowSeasons });
}

/** Mark delivered, run onFire, open what the event opens, return the verbatim beats. */
export function deliverEvent(state: WorldState, event: HistoryEvent, at: SeasonAt, turn: number): DeliveryResult {
  const lines: string[] = [];
  state.history.fired[event.id] = { year: at.year, season: at.season, turn };
  const beats = renderScript(state, event, event.script, at);
  if (event.onFire) {
    const r = applyEffects(state, event.onFire, `${event.id}:onFire`, { at });
    if (r.refused) lines.push(`${event.title}: ${r.refused}`);
    lines.push(...r.lines);
  }
  if (event.stages.length) {
    state.history.scenes[event.id] = { stage: 0, openedTurn: turn, stageTurn: turn };
    const stage = event.stages[0];
    beats.push(...renderScript(state, event, stage.script, at));
    openChoice(state, event, stage, turn);
    openOutcome(state, event, stage, turn);
  } else {
    openChoice(state, event, undefined, turn);
    openOutcome(state, event, undefined, turn);
  }
  if (event.record && !event.choices && !event.outcomes && !event.stages.length) {
    state.history.record.push({ year: at.year, season: at.season, text: event.record, thread: String(event.arc) });
  }
  return { beats, lines };
}

/** 03_HISTORY §9: the battle pass is off, but the lord accepted the summons. */
export function interimBattleBeat(event: HistoryEvent): HistoryBeat {
  const custom = typeof event.battle?.interimLine === "string" ? (event.battle.interimLine as string) : null;
  return {
    npcId: "steward",
    eventId: event.id,
    text: custom ?? `The lord rode out when the call came: ${event.title}. What happened in the field is not yet written in this chronicle.`,
  };
}

export function markInterimBattle(state: WorldState, event: HistoryEvent, at: SeasonAt, turn: number): DeliveryResult {
  state.history.fired[event.id] = { year: at.year, season: at.season, turn };
  const lines: string[] = [];
  if (event.onFire) {
    const r = applyEffects(state, event.onFire, `${event.id}:onFire`, { at });
    if (r.refused) lines.push(`${event.title}: ${r.refused}`);
    lines.push(...r.lines);
  }
  return { beats: [interimBattleBeat(event)], lines };
}

function recordChoice(state: WorldState, event: HistoryEvent, stage: HistoryStage | undefined, option: HistoryOption, at: SeasonAt) {
  const key = stage ? `${event.id}#${stage.id}` : event.id;
  state.history.chosen[key] = option.id;
  if (!stage && event.record) {
    const text = event.record.replace("{choice}", option.label.toLowerCase());
    state.history.record.push({ year: at.year, season: at.season, text, thread: String(event.arc) });
  }
}

/**
 * Take a declared choice. Writes nothing when the stores cannot pay (the card
 * stays pending with the reason). Returns the ledger lines.
 */
export function takeChoice(
  state: WorldState,
  event: HistoryEvent,
  stageId: string | undefined,
  optionId: string,
  at: SeasonAt,
): { ok: boolean; reason?: string; lines: string[]; endsScene?: boolean } {
  const stage = stageId ? event.stages.find((s) => s.id === stageId) : undefined;
  const choices = stage?.choices ?? event.choices;
  const option = choices?.options.find((o) => o.id === optionId);
  if (!choices || !option) return { ok: false, reason: `No such choice ${optionId} on ${event.id}.`, lines: [] };
  if (option.requires && !evalCondition(option.requires, conditionContext(state, at))) {
    return { ok: false, reason: `That course is not open: ${option.label}.`, lines: [] };
  }
  const r = applyEffects(state, option.effects, `${event.id}:${option.id}`, { at });
  if (r.refused) return { ok: false, reason: r.refused, lines: [] };
  recordChoice(state, event, stage, option, at);
  state.history.openChoices = state.history.openChoices.filter((c) => !(c.eventId === event.id && c.stageId === stageId));
  return { ok: true, lines: r.lines, endsScene: option.ends };
}

export function takeOutcome(state: WorldState, event: HistoryEvent, stageId: string | undefined, outcomeId: string, at: SeasonAt): { ok: boolean; reason?: string; lines: string[] } {
  const stage = stageId ? event.stages.find((s) => s.id === stageId) : undefined;
  const outcomes = stage?.outcomes ?? event.outcomes;
  const option = outcomes?.options.find((o) => o.id === outcomeId);
  if (!outcomes || !option) return { ok: false, reason: `No such outcome ${outcomeId} on ${event.id}.`, lines: [] };
  if (option.requires && !evalCondition(option.requires, conditionContext(state, at))) {
    return { ok: false, reason: `That outcome is not open to this lord: ${option.label}.`, lines: [] };
  }
  const r = applyEffects(state, option.effects, `${event.id}:${option.id}`, { at });
  if (r.refused) return { ok: false, reason: r.refused, lines: [] };
  const key = stage ? `${event.id}#${stage.id}` : event.id;
  state.history.outcomes[key] = option.id;
  state.history.openOutcomes = state.history.openOutcomes.filter((c) => !(c.eventId === event.id && c.stageId === stageId));
  return { ok: true, lines: r.lines };
}

export function takeHook(state: WorldState, event: HistoryEvent, hookId: string, at: SeasonAt): { ok: boolean; reason?: string; lines: string[] } {
  const scene = state.history.scenes[event.id];
  const stage = scene ? event.stages[scene.stage] : undefined;
  const hook = [...(stage?.hooks ?? []), ...event.hooks].find((h) => h.id === hookId);
  if (!hook) return { ok: false, reason: `No such hook ${hookId} on ${event.id}.`, lines: [] };
  const taken = state.history.hooksTaken[event.id] ?? [];
  if (taken.includes(hookId)) return { ok: false, reason: "That was already done.", lines: [] };
  if (hook.requires && !evalCondition(hook.requires, conditionContext(state, at))) {
    return { ok: false, reason: "That course is not open now.", lines: [] };
  }
  const r = applyEffects(state, hook.effects, `${event.id}:${hook.id}`, { at });
  if (r.refused) return { ok: false, reason: r.refused, lines: [] };
  state.history.hooksTaken[event.id] = [...taken, hookId];
  return { ok: true, lines: r.lines };
}

/** The scene moves to the next stage (or closes). Posts the next stage's script. */
export function advanceScene(state: WorldState, event: HistoryEvent, at: SeasonAt, turn: number, opts?: { close?: boolean }): DeliveryResult {
  const scene = state.history.scenes[event.id];
  const beats: HistoryBeat[] = [];
  const lines: string[] = [];
  if (!scene) return { beats, lines };
  const current = event.stages[scene.stage];
  if (current) {
    // Unanswered stage choice: take the default.
    const open = state.history.openChoices.find((c) => c.eventId === event.id && c.stageId === current.id);
    if (open && current.choices) {
      const d = defaultOption(current.choices.options, conditionContext(state, at));
      const r = takeChoice(state, event, current.id, d.id, at);
      lines.push(...r.lines);
      if (r.endsScene) opts = { close: true };
    }
    const openOut = state.history.openOutcomes.find((c) => c.eventId === event.id && c.stageId === current.id);
    if (openOut && current.outcomes) {
      const d = defaultOption(current.outcomes.options, conditionContext(state, at));
      lines.push(...takeOutcome(state, event, current.id, d.id, at).lines);
    }
    if (current.exitEffects) {
      const r = applyEffects(state, current.exitEffects, `${event.id}:${current.id}:exit`, { at });
      lines.push(...r.lines);
    }
  }
  const ctx = conditionContext(state, at);
  let nextIndex = scene.stage + 1;
  while (nextIndex < event.stages.length && event.stages[nextIndex].requires && !evalCondition(event.stages[nextIndex].requires, ctx)) nextIndex++;
  if (opts?.close || nextIndex >= event.stages.length) {
    delete state.history.scenes[event.id];
    state.history.openChoices = state.history.openChoices.filter((c) => c.eventId !== event.id);
    if (event.record) {
      state.history.record.push({ year: at.year, season: at.season, text: event.record.replace("{choice}", ""), thread: String(event.arc) });
    }
    return { beats, lines };
  }
  const next = event.stages[nextIndex];
  state.history.scenes[event.id] = { ...scene, stage: nextIndex, stageTurn: turn };
  beats.push(...renderScript(state, event, next.script, at));
  openChoice(state, event, next, turn);
  openOutcome(state, event, next, turn);
  return { beats, lines };
}

/** Deadlines: unanswered choices take their default; unjudged outcomes land on the historical result. */
export function expireDeadlines(state: WorldState, at: SeasonAt, turn: number): DeliveryResult {
  const content = historyContent();
  const beats: HistoryBeat[] = [];
  const lines: string[] = [];
  for (const open of [...state.history.openChoices]) {
    if (open.deadlineTurn > turn) continue;
    const event = content.byId.get(open.eventId);
    if (!event) {
      state.history.openChoices = state.history.openChoices.filter((c) => c !== open);
      continue;
    }
    if (open.stageId && state.history.scenes[event.id]) continue; // scene stages settle in advanceScene
    const stage = open.stageId ? event.stages.find((s) => s.id === open.stageId) : undefined;
    const choices = stage?.choices ?? event.choices;
    if (!choices) continue;
    const d = defaultOption(choices.options, conditionContext(state, at));
    const r = takeChoice(state, event, open.stageId, d.id, at);
    if (!r.ok) {
      // A default that costs more than the stores hold still closes the window.
      state.history.chosen[open.stageId ? `${event.id}#${open.stageId}` : event.id] = d.id;
      state.history.openChoices = state.history.openChoices.filter((c) => c !== open);
    }
    lines.push(...r.lines);
    beats.push({ npcId: "steward", eventId: event.id, text: `The matter settled itself: ${d.label.toLowerCase()}.` });
  }
  for (const open of [...state.history.openOutcomes]) {
    if (open.deadlineTurn > turn) continue;
    const event = content.byId.get(open.eventId);
    if (!event) {
      state.history.openOutcomes = state.history.openOutcomes.filter((c) => c !== open);
      continue;
    }
    if (open.stageId && state.history.scenes[event.id]) continue;
    const stage = open.stageId ? event.stages.find((s) => s.id === open.stageId) : undefined;
    const outcomes = stage?.outcomes ?? event.outcomes;
    if (!outcomes) continue;
    const d = defaultOption(outcomes.options, conditionContext(state, at));
    lines.push(...takeOutcome(state, event, open.stageId, d.id, at).lines);
  }
  // Scenes whose stage advances with the season; fallthrough stages keep going.
  for (const [eventId, scene] of Object.entries(state.history.scenes)) {
    const event = content.byId.get(eventId);
    if (!event) {
      delete state.history.scenes[eventId];
      continue;
    }
    const stage = event.stages[scene.stage];
    if (!stage || scene.stageTurn >= turn) continue;
    if (stage.advanceOn === "speech" && !stage.fallthrough) continue;
    let guard = event.stages.length + 1;
    for (;;) {
      const live = state.history.scenes[eventId];
      const here = live ? event.stages[live.stage] : undefined;
      if (!here || guard-- <= 0) break;
      const r = advanceScene(state, event, at, turn);
      beats.push(...r.beats);
      lines.push(...r.lines);
      const after = state.history.scenes[eventId];
      if (!after) break;
      const next = event.stages[after.stage];
      if (!here.fallthrough || !next?.fallthrough) break;
    }
  }
  return { beats, lines };
}

export { speakerName };
