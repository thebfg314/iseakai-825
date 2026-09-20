import type { WorldState } from "./schema";
import { round1 } from "./util";

export const FIELD_ROTATIONS = ["two_field", "three_field"] as const;
export type FieldRotation = (typeof FIELD_ROTATIONS)[number];

export const TWO_FIELD_SOWN_FRACTION = 0.5;
export const THREE_FIELD_SOWN_FRACTION = 2 / 3;

export function fieldRotation(state: WorldState | { agriculture?: { rotation?: string } } | undefined): FieldRotation {
  return state?.agriculture?.rotation === "three_field" ? "three_field" : "two_field";
}

export function sownFraction(rotation: FieldRotation): number {
  return rotation === "three_field" ? THREE_FIELD_SOWN_FRACTION : TWO_FIELD_SOWN_FRACTION;
}

/** Acres that may be under seed at once (half in two-field, two thirds in three-field). */
export function sownCapacity(arable: number, rotation: FieldRotation): number {
  return round1(arable * sownFraction(rotation));
}

/**
 * Spring barley/oats acres for this rotation.
 * Two-field: leftover of the sown half after autumn wheat/rye.
 * Three-field: a third of the arable, still capped so total sown cannot exceed the sown share
 * while a two-field winter crop is still in the ground.
 */
export function springFieldAcres(arable: number, rotation: FieldRotation, alreadyWinter: number): number {
  const cap = sownCapacity(arable, rotation);
  const room = Math.max(0, cap - alreadyWinter);
  if (rotation === "three_field") {
    return Math.min(round1(arable / 3), room);
  }
  return room;
}

/** Autumn wheat/rye acres. Two-field takes the whole sown half; three-field takes one third. */
export function autumnFieldAcres(arable: number, rotation: FieldRotation): number {
  if (rotation === "three_field") return round1(arable / 3);
  return sownCapacity(arable, rotation);
}

export function ensureAgriculture(
  state: WorldState,
): NonNullable<WorldState["agriculture"]> {
  if (!state.agriculture) {
    state.agriculture = { springBarleyShare: 0.6, autumnWheatShare: 0.45, rotation: "two_field" };
  } else if (!state.agriculture.rotation) {
    state.agriculture.rotation = "two_field";
  }
  return state.agriculture;
}
