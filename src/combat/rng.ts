/**
 * Seeded PRNG (mulberry32). Every battle carries its seed so a lab replay or a
 * bug report reproduces the same rolls. Not for anything security-related.
 */
export type Rng = {
  /** Uniform float in [0, 1). */
  float(): number;
  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** True with probability p (0–1). */
  chance(p: number): boolean;
  /** Uniform float in [min, max]. */
  between(min: number, max: number): number;
  /** Pick one element. Throws on empty. */
  pick<T>(items: readonly T[]): T;
  /** Current internal state, for snapshots. */
  state(): number;
};

export function seedFromString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const float = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    float,
    int(min, max) {
      if (max < min) [min, max] = [max, min];
      return min + Math.floor(float() * (max - min + 1));
    },
    chance(p) {
      if (p <= 0) return false;
      if (p >= 1) return true;
      return float() < p;
    },
    between(min, max) {
      return min + float() * (max - min);
    },
    pick(items) {
      if (!items.length) throw new Error("pick from empty list");
      return items[Math.floor(float() * items.length)];
    },
    state: () => a >>> 0,
  };
}

/** Resume a generator from a saved `state()` value. */
export function rngFromState(state: number): Rng {
  return createRng(state);
}
