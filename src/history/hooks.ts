import type { ApplyResult, MechanicalProposal, WorldState } from "../engine/schema";
import { advanceScene, takeChoice, takeHook, takeOutcome, type HistoryBeat } from "./deliver";
import { historyContent } from "./load";
import { eventActive, type SeasonAt } from "./scheduler";
import type { HistorySeason } from "./schema";
import { moveVassalMood } from "./vassals";

export type HistoryProposal = Extract<
  MechanicalProposal,
  { type: "history_choice" | "history_hook" | "history_outcome" | "history_scene" | "innovation_register" | "innovation_expose" | "vassal_mood" }
>;

export function isHistoryProposal(p: MechanicalProposal): p is HistoryProposal {
  return p.type.startsWith("history_") || p.type.startsWith("innovation_") || p.type === "vassal_mood";
}

const HISTORY_ACTORS = new Set(["steward", "chaplain", "referee", "player"]);

/** Beats produced by a confirmed scene advance; the controller posts them. */
export type HistoryApplyResult = ApplyResult & { beats?: HistoryBeat[] };

function at(state: WorldState): SeasonAt {
  return { year: state.meta.year, season: state.meta.season as HistorySeason };
}

export function applyHistoryProposal(state: WorldState, p: HistoryProposal, actor: string): HistoryApplyResult {
  const fail = (reason: string): HistoryApplyResult => ({ ok: false, reason, logLine: reason, state });
  const content = historyContent();
  if (p.type === "innovation_register" || p.type === "innovation_expose") {
    if (!content.features.diffusion) return fail("That ledger is closed.");
    return applyInnovation(state, p);
  }
  if (!HISTORY_ACTORS.has(actor)) return fail("npc_not_authorized");
  if (p.type === "vassal_mood") return applyVassalMood(state, p);
  const event = content.byId.get(p.eventId);
  if (!event) return fail(`No such matter as ${p.eventId} is before the hall.`);
  if (!state.history.fired[event.id]) return fail(`${event.title} has not yet come to the hall.`);
  const now = at(state);
  const turn = state.meta.turn;

  switch (p.type) {
    case "history_choice": {
      const scene = state.history.scenes[event.id];
      const stage = scene ? event.stages[scene.stage] : undefined;
      const stageId = stage?.choices ? stage.id : undefined;
      const open = state.history.openChoices.find((c) => c.eventId === event.id && c.stageId === stageId);
      if (!open) return fail(`The choice on ${event.title} is no longer open.`);
      const r = takeChoice(state, event, stageId, p.optionId, now);
      if (!r.ok) return fail(r.reason ?? "It cannot be made so.");
      const lines = [p.summary, ...r.lines].filter(Boolean).join(" ");
      if (scene && stage && (r.endsScene || stage.advanceOn !== "season")) {
        const adv = advanceScene(state, event, now, turn, { close: r.endsScene });
        return { ok: true, logLine: [lines, ...adv.lines].filter(Boolean).join(" "), state, beats: [...r.beats, ...adv.beats] };
      }
      return { ok: true, logLine: lines, state, beats: r.beats };
    }
    case "history_hook": {
      if (!eventActive(state, event, turn)) return fail(`The moment for ${event.title} has passed.`);
      const r = takeHook(state, event, p.hookId, now);
      if (!r.ok) return fail(r.reason ?? "It cannot be made so.");
      return { ok: true, logLine: [p.summary, ...r.lines].filter(Boolean).join(" "), state, beats: r.beats };
    }
    case "history_outcome": {
      const scene = state.history.scenes[event.id];
      const stage = scene ? event.stages[scene.stage] : undefined;
      const stageId = stage?.outcomes ? stage.id : undefined;
      const open = state.history.openOutcomes.find((c) => c.eventId === event.id && c.stageId === stageId);
      if (!open) return fail(`${event.title} is not waiting on a judgement.`);
      const outcomes = stage?.outcomes ?? event.outcomes;
      if (event.links.fixedPoint && outcomes && outcomes.options.length <= 1) return fail("That is a fixed point; it is not for the household to judge.");
      const r = takeOutcome(state, event, stageId, p.outcomeId, now);
      if (!r.ok) return fail(r.reason ?? "It cannot be made so.");
      const why = p.reasoning ? ` (${p.reasoning})` : "";
      return { ok: true, logLine: `${p.summary}${why} ${r.lines.join(" ")}`.trim(), state, beats: r.beats };
    }
    case "history_scene": {
      const scene = state.history.scenes[event.id];
      if (!scene) return fail(`${event.title} is not in progress.`);
      const stage = event.stages[scene.stage];
      if (!stage) return fail(`${event.title} is not in progress.`);
      if (stage.advanceOn === "season") return fail("That will settle with the season, not with words.");
      if (p.choiceId && stage.choices) {
        const r = takeChoice(state, event, stage.id, p.choiceId, now);
        if (!r.ok) return fail(r.reason ?? "It cannot be made so.");
        const adv = advanceScene(state, event, now, turn, { close: r.endsScene });
        return { ok: true, logLine: [p.summary, ...r.lines, ...adv.lines].filter(Boolean).join(" "), state, beats: [...r.beats, ...adv.beats] };
      }
      const adv = advanceScene(state, event, now, turn);
      return { ok: true, logLine: [p.summary, ...adv.lines].filter(Boolean).join(" "), state, beats: adv.beats };
    }
  }
  return fail("Unknown proposal type.");
}

/** Aldric's reading of how the lord's words sat with his sworn men (vassals.ts); ids come from the HISTORY block. */
function applyVassalMood(state: WorldState, p: Extract<HistoryProposal, { type: "vassal_mood" }>): HistoryApplyResult {
  const fail = (reason: string): HistoryApplyResult => ({ ok: false, reason, logLine: reason, state });
  const all = state.history.vassals ?? [];
  if (!all.length) return fail("No man is sworn to the lord yet.");
  const ids = p.vassalId === "all" ? [] : [p.vassalId];
  if (ids.length && !all.some((v) => v.id === ids[0])) return fail(`No sworn man is written as ${p.vassalId}.`);
  const names = moveVassalMood(state, p.delta, p.reason, state.meta.turn, ids);
  const who = ids.length ? names[0] : "the sworn men";
  const word = p.delta > 0 ? "warmer" : p.delta < 0 ? "colder" : "unmoved";
  return { ok: true, logLine: `${who[0].toUpperCase()}${who.slice(1)} ${names.length === 1 && ids.length ? "is" : "are"} ${word} toward the lord: ${p.reason}.`, state };
}

function applyInnovation(state: WorldState, p: Extract<HistoryProposal, { type: "innovation_register" | "innovation_expose" }>): HistoryApplyResult {
  const fail = (reason: string): HistoryApplyResult => ({ ok: false, reason, logLine: reason, state });
  const list = state.history.diffusion.innovations;
  if (p.type === "innovation_register") {
    if (list.some((i) => i.id === p.innovationId)) return fail(`${p.name} is already on the record.`);
    list.push({
      id: p.innovationId,
      name: p.name,
      introducedTurn: state.meta.turn,
      legibility: p.legibility,
      reproduction: p.reproduction,
      proof: p.proof,
      exposure: [],
      spread: "own_lands",
      spreadDueTurn: null,
      writtenDown: p.writtenDown,
      creditedToPlayer: true,
    });
    return { ok: true, logLine: `${p.name} is noted as a new thing of this house.`, state };
  }
  const inn = list.find((i) => i.id === p.innovationId);
  if (!inn) return fail("No such innovation is on the record.");
  if (!inn.exposure.includes(p.how)) inn.exposure.push(p.how);
  const due = exposureDelaySeasons(inn.legibility, inn.reproduction, p.how);
  if (p.how === "monks_copied") {
    inn.writtenDown = true;
    if (inn.spread === "own_lands") inn.spread = "region";
    inn.spreadTurn = state.meta.turn;
    inn.spreadDueTurn = state.meta.turn + 4;
  } else if (due !== null) {
    const candidate = state.meta.turn + due;
    inn.spreadDueTurn = inn.spreadDueTurn === null ? candidate : Math.min(inn.spreadDueTurn, candidate);
  }
  return { ok: true, logLine: `${inn.name} has been seen abroad (${p.how.replace(/_/g, " ")}).`, state };
}

/**
 * Seasons until the innovation leaves the lord's lands, from the Rules doc's
 * defaults (03_HISTORY §12). Null: no timer without espionage.
 */
export function exposureDelaySeasons(legibility: string, reproduction: string, how: string): number | null {
  if (how === "taught" || how === "sold") return 4;
  if (how === "public_use") {
    if (legibility === "opaque" && reproduction === "programme") return null;
    if (legibility === "opaque") return 20 * 2;
    return 20;
  }
  if (how === "shown_king") return legibility === "opaque" ? 12 : 4;
  if (how === "battle_allies") return legibility === "obvious" ? 4 : legibility === "puzzling" ? 12 : null;
  if (how === "espionage") return 14;
  return null;
}
