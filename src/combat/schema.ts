import { z } from "zod";

/**
 * Combat data contracts (design doc §5–§9). Pure types and validators; no I/O.
 *
 * Sheet stats are final values: armor DEF and load Speed are already priced in.
 * `armorSource.defBonus` on a tag records how much of the sheet DEF is armor so
 * armor_piercing can reduce it — it is never added a second time.
 */

export const RangeSchema = z.object({ min: z.number(), max: z.number() });
export type NumRange = z.infer<typeof RangeSchema>;

/** Closed condition vocabulary. New tags (including LLM-proposed ones) may only use these keys. */
export const TagConditionSchema = z
  .object({
    targetHasTag: z.string().optional(),
    targetLacksTag: z.string().optional(),
    targetArmored: z.boolean().optional(),
    targetState: z.enum(["routing", "charging", "engagedMelee"]).optional(),
    selfState: z.enum(["engagedMelee", "charging"]).optional(),
    attackerHasTag: z.string().optional(),
    attackerState: z.enum(["charging"]).optional(),
    attackKind: z.enum(["melee", "ranged"]).optional(),
  })
  .strict();
export type TagCondition = z.infer<typeof TagConditionSchema>;

/** Closed hook vocabulary for a conditional modifier. */
export const ConditionalModifierSchema = z
  .object({
    when: TagConditionSchema,
    atkMultiplier: z.number().positive().optional(),
    defMultiplier: z.number().positive().optional(),
    defBonus: z.number().optional(),
    damageMultiplier: z.number().positive().optional(),
    moraleDelta: z.number().optional(),
    counterDamage: z.boolean().optional(),
    bypassesAmmoCost: z.boolean().optional(),
  })
  .strict();
export type ConditionalModifier = z.infer<typeof ConditionalModifierSchema>;

export const ORDER_IDS = [
  "advance",
  "hold",
  "engage",
  "fire",
  "withdraw",
  "hold_formation",
  "skirmish_and_withdraw",
  "rally",
  "swap_presented",
] as const;
export type OrderId = (typeof ORDER_IDS)[number];

/** Full tag definition. Every key is part of the closed hook list the engine understands. */
export const TagDefSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    summary: z.string(),
    note: z.string().optional(),
    introducedOn: z.string().nullable().optional(),
    aliases: z.array(z.string()).optional(),
    requires: z.object({ minSpeed: z.number().optional(), minRange: z.number().optional() }).strict().optional(),

    atkMultiplier: z.number().positive().optional(),
    defMultiplier: z.number().positive().optional(),
    hpMultiplier: z.number().positive().optional(),
    moraleDamageRatioMultiplier: z.number().positive().optional(),
    moraleLossMultiplier: z.number().positive().optional(),
    armorSource: z.object({ defBonus: z.number().nonnegative() }).strict().optional(),
    ignoreArmorDefFraction: z.number().min(0).max(1).optional(),
    firesEveryNRounds: z.number().int().min(1).optional(),
    volleyCharges: z.number().int().positive().optional(),
    onChargesDepleted: z.object({ losesTag: z.string().optional(), gainsTag: z.string().optional() }).strict().optional(),
    unlocksOrders: z.array(z.enum(ORDER_IDS)).optional(),
    conditional: z.array(ConditionalModifierSchema).optional(),
    onCharge: z.object({ atkMultiplier: z.number().positive() }).strict().optional(),
    onChargeStopped: z.object({ moraleDelta: z.number() }).strict().optional(),
    onNearbyAllyRouts: z.object({ moraleDelta: z.number() }).strict().optional(),
    onRally: z.object({ atkMultiplier: z.number().positive(), oneTime: z.boolean() }).strict().optional(),
    disengageCostMultiplier: z.number().positive().optional(),
    skirmishVolley: z.object({ extraVolleys: z.number().int().positive(), targetMaxSpeed: z.number() }).strict().optional(),
    siege: z
      .object({ bypassesHardenedStructure: z.boolean(), vsUnitsHpDamageMultiplier: z.number().positive() })
      .strict()
      .optional(),
    mobileFortification: z.boolean().optional(),
    stationaryEmplacement: z.boolean().optional(),
    damageRollMultiplierRange: RangeSchema.optional(),
    precisionBolt: z.boolean().optional(),
    wallHeightNegation: z.boolean().optional(),
    dualShotType: z.boolean().optional(),
    misfireChance: z.number().min(0).max(1).optional(),
  })
  .strict();
export type TagDef = z.infer<typeof TagDefSchema>;

export const TagRegistryFileSchema = z.object({
  $comment: z.string().optional(),
  tags: z.array(TagDefSchema),
});

export const UNIT_KINDS = ["troop", "siege"] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

/** Per-unit overrides of a tag's numeric parameters (e.g. a dozen javelins instead of 24 arrows). */
export const TagParamsSchema = z.record(
  z.string(),
  z.object({ volleyCharges: z.number().int().positive().optional() }).strict(),
);

/**
 * What the district lacks before a sheet can be raised (design review, item 12). Each line names a
 * good — kept as a custom resource in the estate's stores — and who supplies it: Bernard's forge
 * ("smith"), Gerulf's roads ("hunt"), or a passing merchant ("merchant"). Eberhard drills the men
 * once `perMan × men` of every line is in store.
 */
export const UnitRequirementSchema = z
  .object({
    resource: z.string().regex(/^[a-z][a-z0-9_]*$/),
    name: z.string(),
    perMan: z.number().positive(),
    source: z.enum(["smith", "hunt", "merchant"]),
    /** The good stands in for stable horses (e.g. steppe stock for horse archers). */
    replacesHorses: z.boolean().optional(),
    note: z.string().optional(),
  })
  .strict();
export type UnitRequirement = z.infer<typeof UnitRequirementSchema>;

export const UnitSheetSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    name: z.string(),
    section: z.string().optional(),
    kind: z.enum(UNIT_KINDS),
    hp: z.number().positive(),
    atk: z.number().nonnegative(),
    def: z.number().nonnegative(),
    damage: RangeSchema,
    range: z.number().int().min(0).max(6),
    speed: z.number().int().min(0),
    morale: z.number().positive(),
    /** Abstracted headcount: casualties, prisoners, and levy feedback are computed from it. */
    strength: z.number().int().positive(),
    tags: z.array(z.string()),
    tagParams: TagParamsSchema.optional(),
    skins: z.array(z.string()).optional(),
    anachronistic: z.boolean().optional(),
    /** Goods the district must first obtain before the sheet can be raised in the campaign. */
    requirements: z.array(UnitRequirementSchema).optional(),
    notes: z.string().optional(),
  })
  .strict()
  .refine((u) => u.damage.min <= u.damage.max, { message: "damage.min must not exceed damage.max" });
export type UnitSheet = z.infer<typeof UnitSheetSchema>;

export const UnitRosterFileSchema = z.object({
  $comment: z.string().optional(),
  units: z.array(UnitSheetSchema),
});

export const TerrainDefSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    summary: z.string(),
    defenderOnly: z
      .object({ rangeBonus: z.number().optional(), atkMultiplier: z.number().optional(), defMultiplier: z.number().optional() })
      .strict()
      .optional(),
    rangeReduction: z.number().int().optional(),
    moveCostMultiplier: z.number().positive().optional(),
    moveCostAdd: z.number().nonnegative().optional(),
    rangedDefBonus: z.number().optional(),
    defBonusPer5BaseDef: z.number().optional(),
    blocksRowBoundary: z.boolean().optional(),
    impassable: z.boolean().optional(),
    stacksWith: z.array(z.string()).optional(),
  })
  .strict();
export type TerrainDef = z.infer<typeof TerrainDefSchema>;

export const WeatherDefSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    summary: z.string(),
    rangedAtkMultiplier: z.number().positive().optional(),
    rangeReduction: z.number().int().optional(),
    scoutingPoolSize: z.number().int().positive().optional(),
  })
  .strict();
export type WeatherDef = z.infer<typeof WeatherDefSchema>;

export const TerrainFileSchema = z.object({
  $comment: z.string().optional(),
  terrain: z.array(TerrainDefSchema),
  weather: z.array(WeatherDefSchema),
});

export const FortificationTypeSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    pointHp: z.number().positive(),
    structuralDef: z.number().nonnegative(),
    defenderDefBonus: z.number().nonnegative(),
    notes: z.string().optional(),
  })
  .strict();
export type FortificationType = z.infer<typeof FortificationTypeSchema>;

export const FortificationFileSchema = z.object({
  $comment: z.string().optional(),
  types: z.array(FortificationTypeSchema),
  makeshift: z
    .object({
      pointHpMultiplier: z.number().positive(),
      structuralDefMultiplier: z.number().positive(),
      defenderDefBonusMultiplier: z.number().positive(),
      note: z.string().optional(),
    })
    .strict(),
  pointsPerCell: RangeSchema,
  swapPresentedCost: z.number().nonnegative(),
});

export const RANK_TITLES = ["Minor Noble", "Viscount", "Count", "Duke", "King"] as const;
export type Rank = 1 | 2 | 3 | 4 | 5;

/**
 * Persistent wound on the player character (design doc §5.2, review rules): a fresh wound may heal
 * (30% after the first season, 15% after the second); one that survives two seasons is permanent.
 */
export const WoundSchema = z.object({
  location: z.string(),
  cause: z.string(),
  statEffect: z.record(z.string(), z.number()).default({}),
  renownEffect: z.number().default(0),
  narrativeFlags: z.array(z.string()).default([]),
  /** Seasons since the wound was taken (0 = this season). */
  seasonsHeld: z.number().int().nonnegative().default(0),
  permanent: z.boolean().default(false),
});
export type Wound = z.infer<typeof WoundSchema>;
