import type { GameModifier, ModifierTarget, WorldState } from "./schema";
import { clamp } from "./util";

export function modifiersFor(state: WorldState, target: ModifierTarget, extra?: { resourceId?: string; holdingId?: string }): GameModifier[] {
  return state.modifiers.filter((m) => {
    if (m.target !== target) return false;
    if (extra?.resourceId && m.resourceId && m.resourceId !== extra.resourceId) return false;
    if (extra?.holdingId && m.holdingId && m.holdingId !== extra.holdingId) return false;
    return true;
  });
}

export function applyMultiplyAdd(base: number, mods: GameModifier[], caps?: { lo: number; hi: number }): number {
  let n = base;
  let mult = 1;
  let add = 0;
  let set: number | undefined;
  for (const m of mods) {
    if (m.effect.op === "multiply") mult *= m.effect.value;
    else if (m.effect.op === "add") add += m.effect.value;
    else set = m.effect.value;
  }
  if (set !== undefined) n = set;
  else n = n * mult + add;
  if (caps) n = clamp(n, caps.lo, caps.hi);
  return n;
}

export function maxRisk(state: WorldState, target: "accident_risk" | "harvest_risk"): number {
  const mods = modifiersFor(state, target);
  let v = 0;
  for (const m of mods) {
    if (m.effect.op === "set" || m.effect.op === "add") v = Math.max(v, m.effect.value);
    if (m.effect.op === "multiply") v = Math.max(v, m.effect.value);
  }
  return v;
}

export function tickModifiers(state: WorldState): string[] {
  const notes: string[] = [];
  const kept: GameModifier[] = [];
  for (const m of state.modifiers) {
    if (m.kind !== "temporary") {
      kept.push(m);
      continue;
    }
    const remaining = (m.seasons_remaining ?? 1) - 1;
    if (remaining > 0) {
      kept.push({ ...m, seasons_remaining: remaining });
      continue;
    }
    if (m.promote_on_expire) {
      kept.push({ ...m, kind: "permanent", seasons_remaining: null, source: `${m.source} (established)` });
      notes.push(`Technique settled into custom: ${m.source}`);
    } else {
      notes.push(`Temporary effect ended: ${m.source}`);
    }
  }
  state.modifiers = kept;
  return notes;
}

/** +1 mood add ≈ +3% yield/labour, clamped. Multiply ops apply directly. */
export function moodFactor(state: WorldState): number {
  let add = 0;
  let mult = 1;
  let set: number | undefined;
  for (const m of modifiersFor(state, "mood")) {
    if (m.effect.op === "add") add += m.effect.value;
    else if (m.effect.op === "multiply") mult *= m.effect.value;
    else set = m.effect.value;
  }
  if (set !== undefined) return clamp(set, 0.85, 1.15);
  return clamp((1 + add * 0.03) * mult, 0.85, 1.15);
}

export function yieldMultiplier(state: WorldState, crop?: string): number {
  const grain = applyMultiplyAdd(1, modifiersFor(state, "grain_yield"), { lo: 0.4, hi: 2.5 });
  const specific = crop
    ? applyMultiplyAdd(1, modifiersFor(state, "specific_resource_output", { resourceId: crop }), { lo: 0.4, hi: 2.5 })
    : 1;
  let harvest = 1;
  if (state.labour.harvest_risk) harvest *= 0.85;
  const hr = maxRisk(state, "harvest_risk");
  if (hr > 0) harvest *= clamp(1 - hr, 0.4, 1);
  if (state.flags.hunger) harvest *= 0.9;
  return grain * specific * harvest * moodFactor(state);
}
