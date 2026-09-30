import type { BattleState, UnitInstance } from "./battleTypes";
import { COLUMN_NAMES } from "./grid";
import { isActive } from "./units";

/**
 * Sub-Command objectives (design doc §4.2). The engine proposes feasible objectives from the
 * actual field, checks them each round against real state, and grades them with a fixed
 * rubric; the narrator only chooses among candidates and puts them into a commander's words.
 */

export type ObjectiveKind = "hold_column" | "break_unit" | "protect_unit" | "advance" | "keep_whole";

export type ObjectiveCandidate = {
  kind: ObjectiveKind;
  target?: string;
  byRound?: number;
  difficulty: 1 | 2 | 3;
  /** Engine's plain statement, used as the fallback order text and shown to the narrator. */
  plain: string;
};

export type ObjectiveLike = {
  kind: ObjectiveKind;
  target?: string;
  byRound?: number;
  difficulty: number;
  issuedRound: number;
};

/** §4.2 rubric (fills the doc's open item): scaled to difficulty, symmetric on failure. */
export const OBJECTIVE_BONUS_PER_DIFFICULTY = { success: 10, failed: -10 } as const;

export function objectiveBonus(status: "success" | "failed" | "active", difficulty: number): number {
  if (status === "active") return 0;
  return difficulty * OBJECTIVE_BONUS_PER_DIFFICULTY[status];
}

function myUnits(state: BattleState): UnitInstance[] {
  return state.units.filter((u) => u.side === "player" && u.owner === "player" && isActive(u));
}

function columnOf(units: UnitInstance[]): number | undefined {
  const cols = units.map((u) => u.cell?.col).filter((c): c is number => c !== undefined);
  if (!cols.length) return undefined;
  const counts = new Map<number, number>();
  for (const c of cols) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** Two or three objectives that are actually possible on this field right now. */
export function candidateObjectives(state: BattleState, already: readonly ObjectiveLike[] = []): ObjectiveCandidate[] {
  const mine = myUnits(state);
  if (!mine.length) return [];
  const out: ObjectiveCandidate[] = [];
  const used = new Set(already.map((o) => `${o.kind}:${o.target ?? ""}`));
  const col = columnOf(mine);
  const enemies = state.units.filter((u) => u.side === "enemy" && isActive(u));
  const allies = state.units.filter((u) => u.side === "player" && u.owner === "ally" && isActive(u) && u.id !== state.player.attachedUnitId);

  if (col !== undefined && !used.has(`hold_column:${col}`)) {
    const until = Math.min(10, state.round + 6);
    out.push({ kind: "hold_column", target: String(col), byRound: until, difficulty: 1, plain: `Hold the ${COLUMN_NAMES[col]} with your men until the ${ordinal(until)} exchange.` });
  }
  const weakest = [...enemies].sort((a, b) => a.morale / a.maxMorale - b.morale / b.maxMorale)[0];
  const strongest = [...enemies].sort((a, b) => b.maxHp + b.morale - (a.maxHp + a.morale))[0];
  if (weakest && !used.has(`break_unit:${weakest.id}`)) {
    out.push({ kind: "break_unit", target: weakest.id, difficulty: 2, plain: `Break ${weakest.name} and drive them from the field.` });
  }
  if (strongest && strongest.id !== weakest?.id && !used.has(`break_unit:${strongest.id}`)) {
    out.push({ kind: "break_unit", target: strongest.id, difficulty: 3, plain: `Break ${strongest.name}, the heart of their line.` });
  }
  if (allies.length && !used.has(`protect_unit:${allies[0].id}`)) {
    out.push({ kind: "protect_unit", target: allies[0].id, difficulty: 2, plain: `Keep ${allies[0].name} standing; cover their flank whatever comes.` });
  }
  if (!used.has("advance:")) {
    const by = Math.min(10, state.round + 4);
    out.push({ kind: "advance", byRound: by, difficulty: 2, plain: `Push your men into their front by the ${ordinal(by)} exchange.` });
  }
  if (!used.has("keep_whole:")) {
    out.push({ kind: "keep_whole", difficulty: 1, plain: `Bring every one of your files off the field still standing.` });
  }
  return out.slice(0, 4);
}

export type ObjectiveCheck = { status: "active" | "success" | "failed"; note: string };

/** Evaluate one objective against the live field. Terminal objectives resolve at battle end. */
export function checkObjective(state: BattleState, o: ObjectiveLike): ObjectiveCheck {
  const mine = myUnits(state);
  const finished = state.phase === "finished";
  switch (o.kind) {
    case "hold_column": {
      const col = Number(o.target);
      const holding = mine.some((u) => u.cell?.col === col);
      if (!holding) return { status: "failed", note: `No file of yours stands in the ${COLUMN_NAMES[col]}.` };
      if (o.byRound !== undefined && state.round >= o.byRound) return { status: "success", note: `The ${COLUMN_NAMES[col]} held through the ${ordinal(o.byRound)} exchange.` };
      if (finished) return { status: "success", note: `The ${COLUMN_NAMES[col]} was still yours at the end.` };
      return { status: "active", note: `Holding the ${COLUMN_NAMES[col]}.` };
    }
    case "break_unit": {
      const target = state.units.find((u) => u.id === o.target);
      if (!target) return { status: "failed", note: "The named enemy could not be found." };
      if (target.status !== "active") return { status: "success", note: `${target.name} ${target.status === "destroyed" ? "were destroyed" : "broke and ran"}.` };
      if (finished || !mine.length) return { status: "failed", note: `${target.name} still stood when it ended.` };
      return { status: "active", note: `${target.name} still stand (${Math.round((target.morale / target.maxMorale) * 100)}% heart).` };
    }
    case "protect_unit": {
      const ward = state.units.find((u) => u.id === o.target);
      if (!ward) return { status: "failed", note: "The ward could not be found." };
      if (ward.status !== "active") return { status: "failed", note: `${ward.name} ${ward.status === "destroyed" ? "were destroyed" : "broke"}.` };
      if (finished) return { status: "success", note: `${ward.name} were still standing at the end.` };
      return { status: "active", note: `${ward.name} stand.` };
    }
    case "advance": {
      const reached = mine.some((u) => u.cell && u.cell.row >= 4);
      if (reached) return { status: "success", note: "Your men are in their front." };
      if (o.byRound !== undefined && state.round >= o.byRound) return { status: "failed", note: `The ${ordinal(o.byRound)} exchange passed with their front unreached.` };
      if (finished || !mine.length) return { status: "failed", note: "Their front was never reached." };
      return { status: "active", note: "Still short of their front." };
    }
    case "keep_whole": {
      const ownAll = state.units.filter((u) => u.side === "player" && u.owner === "player");
      const broken = ownAll.filter((u) => u.status !== "active");
      if (broken.length) return { status: "failed", note: `${broken.map((u) => u.name).join(", ")} ${broken.length === 1 ? "has" : "have"} broken.` };
      if (finished) return { status: "success", note: "Every file of yours came off the field." };
      return { status: "active", note: "All your files stand." };
    }
  }
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
