import type { ApplyResult, MechanicalProposal, WorldState } from "../engine/schema";
import { applyOfficeAction } from "./administration";
import { advanceScene, takeChoice, takeHook, takeOutcome, type HistoryBeat } from "./deliver";
import { applyVerdict, justiceCase, setJusticeStance } from "./justice";
import { historyContent } from "./load";
import { applyMarriageAction, marriageBlocked, marry, type MarriageAction, type WifeArchetype } from "./marriage";
import { afterMishapHook } from "./mishaps";
import { eventActive, type SeasonAt } from "./scheduler";
import { JUSTICE_STANCES, type HistorySeason, type JusticeStance } from "./schema";
import { setTollStance } from "./trade";
import { giveGift, setGivingLevel, type GiftKind, type GiftOccasion, type GivingLevel } from "./gifts";
import { resolveOccasion, type OccasionOption } from "./occasions";
import { endow, purchase, type EndowmentKind, type PurchaseAim } from "./patronage";
import { setHouseholdLean } from "./upkeep";
import { afterQuestHook, questHookRefusal } from "./quest";
import { moveVassalMood } from "./vassals";

export type HistoryProposal = Extract<
  MechanicalProposal,
  { type: "history_choice" | "history_hook" | "history_outcome" | "history_scene" | "innovation_register" | "innovation_expose" | "vassal_mood" | "justice_verdict" | "set_stance" | "steward_office" | "household_upkeep" | "giving_stance" | "vassal_gift" | "vassal_occasion" | "church_endowment" | "church_purchase" | "marriage" }
>;

const RANK_PROPOSALS = new Set(["vassal_mood", "justice_verdict", "set_stance", "steward_office", "household_upkeep", "giving_stance", "vassal_gift", "vassal_occasion", "church_endowment", "church_purchase", "marriage"]);

export function isHistoryProposal(p: MechanicalProposal): p is HistoryProposal {
  return p.type.startsWith("history_") || p.type.startsWith("innovation_") || RANK_PROPOSALS.has(p.type);
}

const HISTORY_ACTORS = new Set(["steward", "chaplain", "referee", "player", "audience"]);

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
  if (p.type === "justice_verdict") return applyJusticeVerdict(state, p);
  if (p.type === "set_stance") return applySetStance(state, p);
  if (p.type === "steward_office") {
    const r = applyOfficeAction(state, p.action, state.meta.turn, p.name);
    return r.ok ? { ok: true, logLine: r.line, state } : fail(r.line);
  }
  if (p.type === "household_upkeep") {
    if (actor !== "steward") return fail("npc_not_authorized");
    const r = setHouseholdLean(state, p.cut, state.meta.turn);
    return r.ok ? { ok: true, logLine: r.line, state } : fail(r.line);
  }
  if (p.type === "giving_stance") {
    if (actor !== "steward") return fail("npc_not_authorized");
    const r = setGivingLevel(state, p.level as GivingLevel);
    return r.ok ? { ok: true, logLine: r.line, state } : fail(r.line);
  }
  if (p.type === "vassal_gift") {
    if (actor !== "steward") return fail("npc_not_authorized");
    const r = giveGift(state, p.vassalId, p.kind as GiftKind, (p.occasion ?? "ordinary") as GiftOccasion);
    return r.ok ? { ok: true, logLine: r.line, state } : fail(r.line);
  }
  if (p.type === "vassal_occasion") {
    if (actor !== "steward") return fail("npc_not_authorized");
    const r = resolveOccasion(state, p.option as OccasionOption);
    return r.ok ? { ok: true, logLine: r.line, state } : fail(r.line);
  }
  if (p.type === "church_endowment" || p.type === "church_purchase") {
    if (actor !== "chaplain") return fail("npc_not_authorized");
    const r = p.type === "church_endowment" ? endow(state, p.kind as EndowmentKind) : purchase(state, p.aim as PurchaseAim);
    return r.ok ? { ok: true, logLine: r.line, state } : fail(r.line);
  }
  if (p.type === "marriage") {
    if (actor !== "steward" && actor !== "player") return fail("npc_not_authorized");
    const r = applyMarriageAction(state, p.archetype as WifeArchetype, (p.action ?? "marry") as MarriageAction);
    return r.ok ? { ok: true, logLine: r.line, state, beats: r.beats } : fail(r.line);
  }
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
      if (actor === "audience") {
        const motive = state.history.quest.meeting?.motive;
        const allowed = motive != null && event.id === "Q-001" && (p.hookId === `approach_${motive}` || p.hookId === "end_audience");
        if (!allowed) return fail("That is not his to grant.");
      }
      if (event.id === "Q-001") {
        const blocked = questHookRefusal(state, p.hookId);
        if (blocked) return fail(blocked);
      }
      // The land crisis's second way out is the neighbour's daughter: the hook is the match (marriage.ts).
      const isMatch = p.hookId === "marry_local";
      if (isMatch) {
        const blocked = marriageBlocked(state, "hildegard", "marry");
        if (blocked) return fail(blocked);
      }
      const r = takeHook(state, event, p.hookId, now);
      if (!r.ok) return fail(r.reason ?? "It cannot be made so.");
      if (event.id === "Q-001") afterQuestHook(state, p.hookId);
      const wed = isMatch ? marry(state, "hildegard", { turn }) : null;
      const wedLines = wed?.ok ? [wed.line] : [];
      const wedBeats = wed?.ok ? wed.beats : [];
      // A mishap answered with men: the ride raises its field at once.
      const after = afterMishapHook(state, event.id, p.hookId, now, turn);
      return { ok: true, logLine: [p.summary, ...r.lines, ...wedLines, ...after.lines].filter(Boolean).join(" "), state, beats: [...r.beats, ...wedBeats, ...after.beats] };
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

/** The lord's judgement on the case before the hall (justice.ts); the verdict must be one the case lists. */
function applyJusticeVerdict(state: WorldState, p: Extract<HistoryProposal, { type: "justice_verdict" }>): HistoryApplyResult {
  const fail = (reason: string): HistoryApplyResult => ({ ok: false, reason, logLine: reason, state });
  const c = justiceCase(p.caseId);
  if (!c) return fail(`No case is written as ${p.caseId}.`);
  const verdict = c.verdicts.find((v) => v.id === p.verdictId);
  const r = applyVerdict(state, p.caseId, p.verdictId, at(state), state.meta.turn);
  if (!r.ok) return fail(r.reason ?? "It cannot be made so.");
  return { ok: true, logLine: [`${c.title}: ${verdict?.label ?? p.verdictId}.`, ...r.lines].join(" "), state };
}

/** How the officers judge (Count+), or how the tolls are set (justice.ts, trade.ts). */
function applySetStance(state: WorldState, p: Extract<HistoryProposal, { type: "set_stance" }>): HistoryApplyResult {
  const fail = (reason: string): HistoryApplyResult => ({ ok: false, reason, logLine: reason, state });
  if (p.kind === "justice") {
    if (!(JUSTICE_STANCES as readonly string[]).includes(p.stance)) return fail(`A court is lenient, fair, strict or extortionate; not ${p.stance}.`);
    const err = setJusticeStance(state, p.stance as JusticeStance);
    if (err) return fail(err);
    return { ok: true, logLine: `The county's courts will judge ${p.stance === "extortionate" ? "for the chest" : `${p.stance}ly`} in the lord's name from now.`, state };
  }
  if (p.stance !== "low" && p.stance !== "customary" && p.stance !== "greedy") return fail(`Tolls are low, customary or greedy; not ${p.stance}.`);
  if ((state.player.rankLevel ?? 1) < 3) return fail("The lord holds no county; the tolls are not his to set.");
  setTollStance(state, p.stance, state.meta.turn);
  return { ok: true, logLine: `The tolls on the lord's roads are set ${p.stance === "greedy" ? "high" : p.stance}.`, state };
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
