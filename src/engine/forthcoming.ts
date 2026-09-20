import type {
  ApplyResult,
  DeferProposal,
  ForthcomingBeat,
  ForthcomingOrder,
  InnerMechanicalProposal,
  MechanicalProposal,
  SeasonEffectLine,
  WorldState,
} from "./schema";
import { FORTHCOMING_BEATS } from "./schema";
import { recordConfirmedTransaction } from "./memory";
import { newId } from "./util";
import {
  forthcomingKeptLine,
  forthcomingOrderText,
  forthcomingStruckLine,
  forthcomingWrittenLine,
} from "../ui/ledgerCopy";

export type ForthcomingFireBeat = ForthcomingBeat | "season_start";

export type NormalizedDeferTrigger =
  | { kind: "beat"; beat: ForthcomingBeat }
  | { kind: "after_seasons"; seasonsRemaining: number };

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function isForthcomingBeat(value: unknown): value is ForthcomingBeat {
  return typeof value === "string" && (FORTHCOMING_BEATS as readonly string[]).includes(value);
}

export function isDeferProposal(p: MechanicalProposal | unknown): p is DeferProposal {
  return Boolean(p && typeof p === "object" && (p as { type?: string }).type === "defer_proposal");
}

function seasonsFromUnknown(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 1) return undefined;
  return Math.floor(n);
}

/** Beat or N-season wait. Defaults to after_harvest so a promised later order still parks. */
export function normalizeDeferTrigger(raw: unknown): NormalizedDeferTrigger {
  const obj = asRecord(raw) ?? {};
  const triggerRaw = obj.trigger;
  if (isForthcomingBeat(triggerRaw)) return { kind: "beat", beat: triggerRaw };
  const triggerObj = asRecord(triggerRaw);
  if (isForthcomingBeat(triggerObj?.beat)) return { kind: "beat", beat: triggerObj.beat };
  const triggerSeasons =
    seasonsFromUnknown(triggerObj?.seasonsRemaining) ?? seasonsFromUnknown(triggerObj?.applyAfterSeasons);
  if (triggerSeasons != null) return { kind: "after_seasons", seasonsRemaining: triggerSeasons };
  if (isForthcomingBeat(obj.beat)) return { kind: "beat", beat: obj.beat };
  const seasons = seasonsFromUnknown(obj.seasonsRemaining) ?? seasonsFromUnknown(obj.applyAfterSeasons);
  if (seasons != null) return { kind: "after_seasons", seasonsRemaining: seasons };
  return { kind: "beat", beat: "after_harvest" };
}

export function innerProposalOfDefer(p: DeferProposal): InnerMechanicalProposal | undefined {
  const inner = p.proposal;
  if (!inner || typeof inner !== "object") return undefined;
  if (isDeferProposal(inner)) return innerProposalOfDefer(inner);
  return inner as InnerMechanicalProposal;
}

/** Unwrap nested defer once (and keep unwrapping if the model stacked them). */
export function flattenDeferInner(raw: unknown): unknown {
  let current = raw;
  for (let i = 0; i < 4; i++) {
    const rec = asRecord(current);
    if (!rec) return current;
    if (rec.type === "defer_proposal" || rec.type === "schedule_order") {
      current = rec.proposal ?? rec.inner ?? rec.order;
      continue;
    }
    return current;
  }
  return current;
}

function waitingOrders(state: WorldState): ForthcomingOrder[] {
  state.forthcoming_orders ??= [];
  return state.forthcoming_orders.filter((o) => o.status === "waiting");
}

function fail(state: WorldState, reason: string, logLine: string): ApplyResult {
  return { ok: false, reason, logLine, state };
}

function ok(state: WorldState, logLine: string): ApplyResult {
  return { ok: true, logLine, state };
}

export function parkForthcomingOrder(
  state: WorldState,
  proposal: DeferProposal,
  actor: string,
): ApplyResult {
  const inner = innerProposalOfDefer(proposal);
  if (!inner || isDeferProposal(inner)) {
    return fail(state, "A forthcoming order needs a real change inside it.", proposal.summary);
  }
  const trigger = normalizeDeferTrigger(proposal);
  const text = (proposal.text && proposal.text.trim()) || forthcomingOrderText(trigger, inner);
  state.forthcoming_orders ??= [];
  const order: ForthcomingOrder = {
    id: proposal.id && proposal.id.startsWith("fo-") ? proposal.id : newId("fo"),
    npcId: actor,
    text,
    proposal: inner,
    status: "waiting",
    createdTurn: state.meta.turn,
    createdSeason: state.meta.season,
    createdYear: state.meta.year,
  };
  if (trigger.kind === "beat") order.beat = trigger.beat;
  else order.seasonsRemaining = trigger.seasonsRemaining;
  state.forthcoming_orders.push(order);
  return ok(state, forthcomingWrittenLine(text));
}

export function cancelForthcomingOrder(state: WorldState, id: string): ApplyResult {
  state.forthcoming_orders ??= [];
  const order = state.forthcoming_orders.find((o) => o.id === id && o.status === "waiting");
  if (!order) return fail(state, "No such pending proposal.", "That order is no longer before me.");
  order.status = "cancelled";
  return ok(state, forthcomingStruckLine(order.text));
}

function applyStoredOrder(
  state: WorldState,
  order: ForthcomingOrder,
  apply: (state: WorldState, proposal: MechanicalProposal, actor: string) => ApplyResult,
): SeasonEffectLine {
  const inner = order.proposal as MechanicalProposal;
  if (!inner || typeof inner !== "object" || isDeferProposal(inner)) {
    order.status = "rejected";
    return { kind: "reject", text: "A forthcoming order could not be kept." };
  }
  const result = apply(state, inner, order.npcId || "steward");
  order.status = result.ok ? "applied" : "rejected";
  if (result.ok) {
    recordConfirmedTransaction(state, order.npcId || "steward", inner, result.logLine);
  }
  return {
    kind: result.ok ? "apply" : "reject",
    text: result.ok
      ? forthcomingKeptLine(result.logLine)
      : `A forthcoming order could not be kept. ${result.reason ?? result.logLine}`,
  };
}

export function fireForthcomingBeat(
  state: WorldState,
  beat: ForthcomingFireBeat,
  apply: (state: WorldState, proposal: MechanicalProposal, actor: string) => ApplyResult,
): SeasonEffectLine[] {
  const lines: SeasonEffectLine[] = [];
  if (beat === "season_start") {
    for (const order of waitingOrders(state)) {
      if (order.seasonsRemaining == null || order.beat) continue;
      order.seasonsRemaining = Math.max(0, order.seasonsRemaining - 1);
      if (order.seasonsRemaining === 0) {
        lines.push(applyStoredOrder(state, order, apply));
      }
    }
    return lines;
  }
  for (const order of waitingOrders(state)) {
    if (order.beat !== beat) continue;
    if (
      (beat === "next_spring_sowing" || beat === "next_autumn_sowing") &&
      order.createdTurn === state.meta.turn
    ) {
      continue;
    }
    lines.push(applyStoredOrder(state, order, apply));
  }
  return lines;
}

export function waitingForthcoming(state: WorldState): ForthcomingOrder[] {
  return waitingOrders(state);
}
