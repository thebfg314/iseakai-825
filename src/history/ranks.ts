import ranksFile from "../../data/history/ranks.json";
import { RanksFileSchema, type RankStep, type RanksFile } from "./schema";

/**
 * Rank progression tables (data/history/ranks.json; 03_HISTORY §10). What each step
 * grants, the generic summons clock, and the name pools for villas and vassals.
 */

let cached: RanksFile | null = null;

export function ranksTable(): RanksFile {
  if (!cached) cached = RanksFileSchema.parse(ranksFile);
  return cached;
}

/** The step granted on reaching `rank` (2–5); nothing for rank 1. */
export function rankStep(rank: number): RankStep | undefined {
  const key = String(rank) as "2" | "3" | "4" | "5";
  return key in ranksTable().steps ? ranksTable().steps[key] : undefined;
}

/** Renown needed to be eligible for `rank`. */
export function thresholdFor(rank: number): number {
  const t = ranksTable().thresholds;
  return t[Math.max(1, Math.min(5, rank)) - 1];
}
