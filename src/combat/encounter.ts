import type { Battlefield, CommandTier } from "./battleTypes";
import { createRng, seedFromString, type Rng } from "./rng";
import type { RosterLine } from "./scenario";
import { generateLayout } from "./scouting";

/**
 * Campaign encounter generator (Phase 0/3 decisions). Turns a call to arms into rosters:
 * the lord always rides as one Caballarius; a summons brings the count's host as allies;
 * raids and bandits bring no allies, so only the lord's own units stand with him.
 */

export type EncounterKind = "summons" | "raid" | "bandits";

export type Encounter = {
  kind: EncounterKind;
  seed: number;
  /** Allied NPC units (owner "ally"), empty for raids. */
  allies: RosterLine[];
  enemy: RosterLine[];
  battlefield: Battlefield;
  /** Prose seed for the narrator: who is fighting whom, and why. */
  premise: string;
};

export const LORD_FILE_ID = "p-lord-file";

export function hasAllies(kind: EncounterKind): boolean {
  return kind === "summons";
}

/** Tier the lord fights at: Sub-Command once he brings a unit of his own, Full Command if he has won the claim. */
export function tierFor(broughtUnits: number, fullCommandGranted: boolean): CommandTier {
  if (broughtUnits <= 0) return "rank_and_file";
  return fullCommandGranted ? "full_command" : "sub_command";
}

function pick<T>(rng: Rng, rows: [T, number][]): T {
  const total = rows.reduce((s, [, w]) => s + w, 0);
  let r = rng.float() * total;
  for (const [v, w] of rows) {
    r -= w;
    if (r <= 0) return v;
  }
  return rows[rows.length - 1][0];
}

export function generateEncounter(kind: EncounterKind, seed: number, opts?: { region?: string; year?: number }): Encounter {
  const rng = createRng(seed ^ seedFromString(kind));
  const battlefield = generateLayout(rng, { roughness: kind === "raid" ? 0.3 : 0.5 });
  switch (kind) {
    case "summons": {
      const allies: RosterLine[] = [
        { sheetId: "pedites_fyrd", count: rng.int(1, 2), owner: "ally", name: "The count's spearmen" },
        { sheetId: "caballarii", count: rng.int(0, 1), owner: "ally", name: "Vassal horse" },
      ];
      if (rng.chance(0.5)) allies.push({ sheetId: "sagittarii", count: 1, owner: "ally", name: "The count's archers" });
      if (rng.chance(0.35)) allies.push({ sheetId: "heavy_horse", count: 1, owner: "ally", name: "The count's household" });
      const foe = pick(rng, [
        ["neighbour", 5],
        ["raiders", 3],
        ["rebels", 2],
      ] as [string, number][]);
      const enemy: RosterLine[] =
        foe === "raiders"
          ? [
              { sheetId: "ship_crew", count: rng.int(2, 3), name: "Northmen" },
              ...(rng.chance(0.5) ? [{ sheetId: "elite_foot", count: 1, name: "The jarl's hird" }] : []),
            ]
          : foe === "rebels"
            ? [
                { sheetId: "peasant_levy", count: rng.int(2, 3), name: "Rebel levy" },
                { sheetId: "pedites_fyrd", count: 1, name: "Rebel spearmen" },
                ...(rng.chance(0.5) ? [{ sheetId: "caballarii", count: 1, name: "Rebel horse" }] : []),
              ]
            : [
                { sheetId: "pedites_fyrd", count: rng.int(1, 2), name: "The neighbour's spearmen" },
                { sheetId: "caballarii", count: 1, name: "The neighbour's horse" },
                ...(rng.chance(0.4) ? [{ sheetId: "sagittarii", count: 1, name: "The neighbour's archers" }] : []),
              ];
      const premise =
        foe === "raiders"
          ? "The count has called his vassals to drive off Northmen who have beached their ships on the river and are burning farms."
          : foe === "rebels"
            ? "The count has called his vassals against a rising of levy and disaffected freemen who have refused his justice."
            : "The count has called his vassals to settle a border quarrel with a neighbouring lord by force of arms.";
      return { kind, seed, allies, enemy, battlefield, premise };
    }
    case "raid":
      return {
        kind,
        seed,
        allies: [],
        enemy: [
          { sheetId: "ship_crew", count: rng.int(1, 2), name: "Northmen" },
        ],
        battlefield,
        premise: "Northmen have come up the river in the night and are at the villa's gate.",
      };
    case "bandits":
      return {
        kind,
        seed,
        allies: [],
        enemy: [
          { sheetId: "peasant_levy", count: 1, name: "Outlaws", overrides: { morale: 30 } },
          ...(rng.chance(0.5) ? [{ sheetId: "pedites_fyrd", count: 1, name: "Deserters" }] : []),
        ],
        battlefield,
        premise: "An outlaw band has been driving off cattle and now stands between the villa and the ford.",
      };
  }
}

/** Auto-loss consequences when the lord is called with no units and no allies (solo rule, §11.3). */
export function soloLossConsequences(kind: EncounterKind, denarii: number, rng: Rng): { denariiLost: number; livestockFraction: number; text: string } {
  const lostFraction = kind === "raid" ? 0.25 : 0.15;
  const denariiLost = Math.min(denarii, Math.round(denarii * lostFraction + rng.int(0, 5)));
  const livestockFraction = kind === "raid" ? 0.15 : 0.08;
  const text =
    kind === "summons"
      ? "One horseman is not a host. You ride to the muster and are told, not unkindly, to ride home again."
      : "A lone rider cannot hold a villa. You watch from the wood while they take what they came for.";
  return { denariiLost, livestockFraction, text };
}
