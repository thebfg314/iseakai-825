import { z } from "zod";

/**
 * Historical events layer (03_HISTORY.md). Zod contracts for the JSON under
 * data/history/ and for the `history` block kept in the world state.
 */

export const HISTORY_SPEAKERS = ["steward", "chaplain"] as const;
export type HistorySpeaker = (typeof HISTORY_SPEAKERS)[number];

export const SEASON_ORDER = ["spring", "summer", "autumn", "winter"] as const;
export type HistorySeason = (typeof SEASON_ORDER)[number];

export const EVENT_TYPES = [
  "news",
  "choice",
  "summons",
  "live",
  "promotion",
  "battle",
  "levy",
  "journey",
  "hazard",
  "background",
  "oath",
] as const;

export const FlagValueSchema = z.union([z.boolean(), z.number(), z.string()]);
export type FlagValue = z.infer<typeof FlagValueSchema>;

/** `"+1"` / `"-2"` add to an integer flag; a bare value sets it. */
export const FlagOpSchema = z.union([z.boolean(), z.number(), z.string()]);

export const RENOWN_BANDS = ["small", "moderate", "large", "-small", "-moderate", "-large"] as const;

export const LandEffectSchema = z
  .object({
    tenure: z.enum(["benefice", "owned", "precaria", "forfeit_claimed"]).optional(),
    charter: z.enum(["none", "count", "royal"]).optional(),
    visibility: z.union([z.number(), z.string()]).optional(),
    recordedValue: z.number().optional(),
    marriedLocal: z.boolean().optional(),
    secondVilla: z.boolean().optional(),
    precariaRent: z.object({ kind: z.enum(["fixed", "nona"]), denarii: z.number().optional() }).optional(),
    /** Manses handed over or lost (negative) on the first holding. */
    manses: z.number().int().optional(),
  })
  .strict();

export const ModifierEffectSchema = z.object({
  target: z.string(),
  kind: z.enum(["temporary", "permanent"]).default("temporary"),
  seasonsRemaining: z.number().int().optional(),
  op: z.enum(["multiply", "add", "set"]),
  value: z.number(),
  source: z.string(),
  customNote: z.string().optional(),
});

export const EffectsSchema = z
  .object({
    /** Condition (§6.1); the block applies only when true. Lets one option branch on earlier flags. */
    when: z.string().optional(),
    flags: z.record(z.string(), FlagOpSchema).optional(),
    renown: z.union([z.number(), z.enum(RENOWN_BANDS)]).optional(),
    /** Amounts are numbers or a `{slot}` name resolved from rank and manses (slots.ts). */
    cost: z.record(z.string(), z.union([z.number().nonnegative(), z.string().regex(/^\{[a-z0-9_]+\}$/)])).optional(),
    gain: z.record(z.string(), z.union([z.number().nonnegative(), z.string().regex(/^\{[a-z0-9_]+\}$/)])).optional(),
    land: LandEffectSchema.optional(),
    realm: z.object({ swornTo: z.string().optional() }).optional(),
    mood: z.number().optional(),
    modifier: ModifierEffectSchema.optional(),
    settle: z.object({ households: z.number().int().positive(), skilled: z.string().optional() }).optional(),
    away: z.object({ reason: z.string(), seasons: z.number().int().positive() }).optional(),
    scene: z.object({ open: z.string().optional(), advance: z.boolean().optional(), close: z.boolean().optional() }).optional(),
    record: z.string().optional(),
    /** Regional famine switch and grain band multiplier, for natural events. */
    prices: z.object({ severity: z.enum(["normal", "shortage", "famine", "severe"]), seasons: z.number().int().positive().optional() }).optional(),
  })
  .strict();
export type HistoryEffects = z.infer<typeof EffectsSchema>;

/** One block or several; blocks with when apply only when the condition holds. */
export const EffectsListSchema = z.union([EffectsSchema, z.array(EffectsSchema)]);
export type HistoryEffectsList = z.infer<typeof EffectsListSchema>;

export const ScriptBlockSchema = z.object({
  speaker: z.enum(HISTORY_SPEAKERS),
  /** Stage direction the engine prefixes in italics-free prose: "reads the letter aloud", "after". */
  frame: z.string().optional(),
  text: z.string().min(1),
  /** Condition; the block is spoken only when true. */
  when: z.string().optional(),
  emotion: z.string().optional(),
});
export type ScriptBlock = z.infer<typeof ScriptBlockSchema>;

export const OptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  note: z.string().optional(),
  requires: z.string().optional(),
  effects: EffectsListSchema.optional(),
  default: z.boolean().optional(),
  /** Scene option: closes the scene when taken. */
  ends: z.boolean().optional(),
});
export type HistoryOption = z.infer<typeof OptionSchema>;

export const ChoicesSchema = z.object({
  prompt: z.string().optional(),
  deadlineSeasons: z.number().int().positive().default(1),
  options: z.array(OptionSchema).min(2),
});

export const HookSchema = z.object({
  id: z.string().min(1),
  /** What the lord's words must plainly amount to. */
  trigger: z.string().min(1),
  requires: z.string().optional(),
  effects: EffectsListSchema.optional(),
  /** Seasons the hook stays open after delivery. Default: the event's hookWindow. */
  window: z.number().int().positive().optional(),
});
export type HistoryHook = z.infer<typeof HookSchema>;

export const OutcomesSchema = z.object({
  momentum: z.number().int().min(1).max(100),
  canChange: z.string(),
  windowSeasons: z.number().int().positive().default(1),
  options: z.array(OptionSchema).min(1),
});

export const StageSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  script: z.array(ScriptBlockSchema).default([]),
  advanceOn: z.enum(["speech", "season", "both"]).default("both"),
  requires: z.string().optional(),
  choices: ChoicesSchema.optional(),
  hooks: z.array(HookSchema).default([]),
  outcomes: OutcomesSchema.optional(),
  /** Applied when the scene moves past this stage. */
  exitEffects: EffectsListSchema.optional(),
  /**
   * At the season turn, keep advancing through following fallthrough stages (taking
   * defaults) so a scene of several nights settles inside one season.
   */
  fallthrough: z.boolean().default(false),
});
export type HistoryStage = z.infer<typeof StageSchema>;

export const VariantSchema = z.object({
  when: z.string(),
  /** Index into `script`. */
  replace: z.number().int().nonnegative(),
  text: z.string().min(1),
});

export const HistoryEventSchema = z.object({
  id: z.string().regex(/^[0-9]{3}-[A-Z]?[0-9A-Z]+$|^[A-Z]-[0-9]{3}(-[0-9A-Z]+)?$|^[a-z0-9_]+$/),
  title: z.string().min(1),
  arc: z.union([z.number().int().min(1).max(9), z.enum(["church", "economy", "natural", "ending", "realm"])]),
  type: z.enum(EVENT_TYPES),
  fires: z.object({ year: z.number().int(), season: z.enum(SEASON_ORDER) }),
  order: z.number().int().default(0),
  requires: z.string().optional(),
  unless: z.string().optional(),
  carry: z.boolean().default(false),
  carryMax: z.number().int().nonnegative().default(0),
  fallback: z.string().nullable().default(null),
  channel: z.array(z.enum(HISTORY_SPEAKERS)).min(1),
  form: z.enum(["spoken", "note", "letter", "envoy", "summons", "scene", "report"]).default("spoken"),
  source: z.string().optional(),
  slant: z.string().optional(),
  script: z.array(ScriptBlockSchema).default([]),
  variants: z.array(VariantSchema).default([]),
  knows: z.array(z.string()).default([]),
  doesntKnow: z.array(z.string()).default([]),
  choices: ChoicesSchema.optional(),
  hooks: z.array(HookSchema).default([]),
  outcomes: OutcomesSchema.optional(),
  stages: z.array(StageSchema).default([]),
  /** Effects applied the moment the event is delivered (realm changes, flags the news itself sets). */
  onFire: EffectsListSchema.optional(),
  supplyCheck: z
    .object({ situation: z.enum(["enemy_main", "friendly_main", "foraging", "deserters"]), seasons: z.number().int().positive().default(1) })
    .nullable()
    .default(null),
  /** Not run in this pass (03_HISTORY §9–§10). The data stays for the later passes. */
  deferred: z.enum(["battle", "promotion"]).nullable().default(null),
  battle: z.record(z.string(), z.unknown()).optional(),
  promotion: z.record(z.string(), z.unknown()).optional(),
  links: z.object({
    arc: z.string().optional(),
    momentum: z.number().int().min(1).max(100),
    keystone: z.string().optional(),
    fixedPoint: z.boolean().default(false),
  }),
  record: z.string().optional(),
  /** Seasons the Knows/hooks stay active after delivery. */
  hookWindow: z.number().int().positive().default(2),
  /** Design notes for the implementer; never shown. */
  notes: z.string().optional(),
});
export type HistoryEvent = z.infer<typeof HistoryEventSchema>;

export const EventFileSchema = z.object({
  arc: z.string(),
  events: z.array(HistoryEventSchema),
});

export const FlagDefSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["bool", "int", "enum"]),
  values: z.array(z.string()).optional(),
  meaning: z.string().min(1),
  /** "engine": a background system writes it, not event data; the lint does not demand an event setter. */
  setBy: z.enum(["events", "engine"]).default("events"),
});
export const FlagRegistrySchema = z.object({ flags: z.array(FlagDefSchema) });
export type FlagDef = z.infer<typeof FlagDefSchema>;

export const RealmCalendarSchema = z.object({
  emperors: z.array(z.object({ from: z.number().int(), season: z.enum(SEASON_ORDER).default("spring"), name: z.string().nullable(), announcedBy: z.string().optional() })),
  kings: z.array(
    z.object({ from: z.number().int(), season: z.enum(SEASON_ORDER).default("spring"), name: z.string().nullable(), kingdom: z.string(), announcedBy: z.string().optional() }),
  ),
  counts: z.array(
    z.object({
      from: z.number().int(),
      season: z.enum(SEASON_ORDER).default("spring"),
      name: z.string(),
      note: z.string().optional(),
      /** A calendar event already announces this change; no generic oath beat. */
      announcedBy: z.string().optional(),
    }),
  ),
});
export type RealmCalendar = z.infer<typeof RealmCalendarSchema>;

export const FeaturesSchema = z.object({
  historicalBattles: z.boolean().default(false),
  promotions: z.boolean().default(false),
  ladder: z.boolean().default(false),
  quest: z.boolean().default(false),
  diffusion: z.boolean().default(true),
});
export type HistoryFeatures = z.infer<typeof FeaturesSchema>;

// ---------------------------------------------------------------------------
// World-state block
// ---------------------------------------------------------------------------

export const HistoryStateSchema = z.object({
  flags: z.record(z.string(), FlagValueSchema).default({}),
  fired: z.record(z.string(), z.object({ year: z.number().int(), season: z.enum(SEASON_ORDER), turn: z.number().int() })).default({}),
  dropped: z.array(z.string()).default([]),
  chosen: z.record(z.string(), z.string()).default({}),
  hooksTaken: z.record(z.string(), z.array(z.string())).default({}),
  outcomes: z.record(z.string(), z.string()).default({}),
  openChoices: z.array(z.object({ eventId: z.string(), stageId: z.string().optional(), opensTurn: z.number().int(), deadlineTurn: z.number().int() })).default([]),
  openOutcomes: z.array(z.object({ eventId: z.string(), stageId: z.string().optional(), opensTurn: z.number().int(), deadlineTurn: z.number().int() })).default([]),
  scenes: z.record(z.string(), z.object({ stage: z.number().int().nonnegative(), openedTurn: z.number().int(), stageTurn: z.number().int() })).default({}),
  realm: z
    .object({
      emperor: z.string().nullable().default("Louis the Pious"),
      king: z.string().nullable().default("Pippin of Aquitaine"),
      kingdom: z.string().default("Aquitaine"),
      countOfAutun: z.string().default("Thierry"),
      countSince: z.number().int().default(815),
      swornTo: z.enum(["count", "church", "king", "none"]).default("count"),
    })
    .default({}),
  land: z
    .object({
      recordedValue: z.number().default(6500),
      trueValue: z.number().default(6300),
      yearlyIncome: z.number().default(525),
      visibility: z.number().min(0).max(100).default(5),
      tenure: z.enum(["benefice", "owned", "precaria", "forfeit_claimed"]).default("benefice"),
      precariaRent: z.object({ kind: z.enum(["fixed", "nona"]), denarii: z.number().optional() }).optional(),
      charter: z.enum(["none", "count", "royal"]).default("none"),
      marriedLocal: z.boolean().default(false),
      secondVilla: z.boolean().default(false),
      /** Turn the forfeiture deadline falls (830 crisis); null when no claim is open. */
      claimDeadlineTurn: z.number().int().nullable().default(null),
    })
    .default({}),
  prices: z
    .object({
      severity: z.enum(["normal", "shortage", "famine", "severe"]).default("normal"),
      grainMultiplier: z.number().positive().default(1),
      untilTurn: z.number().int().nullable().default(null),
      /** Event-set severity (overrides the famine calendar while `untilTurn` holds). */
      eventSeverity: z.enum(["normal", "shortage", "famine", "severe"]).nullable().default(null),
      /** The grain bands as they stood before the multiplier, restored when prices return to normal. */
      base: z.record(z.string(), z.object({ min: z.number(), max: z.number() })).default({}),
      /** Seasons of hunger in a row; two or more eat next year's seed. */
      hungrySeasons: z.number().int().nonnegative().default(0),
    })
    .default({}),
  weather: z
    .object({
      forcedThisSeason: z.string().nullable().default(null),
      /** Extra crop loss multiplier applied by the engine to a forced event this season (1 = normal, 2 = doubled). */
      forcedSeverity: z.number().default(1),
    })
    .default({}),
  supply: z
    .object({
      lastRoll: z.object({ turn: z.number().int(), situation: z.string(), lost: z.number() }).nullable().default(null),
    })
    .default({}),
  vikings: z
    .object({
      danger: z.enum(["none", "low", "moderate", "high"]).default("none"),
      campNear: z.boolean().default(false),
    })
    .default({}),
  duties: z.object({ lastRollTurn: z.number().int().nullable().default(null), favour: z.number().int().default(0) }).default({}),
  ladder: z
    .object({
      stage: z.enum(["none", "warning", "stripped", "excommunicated", "attempt", "quest"]).default("none"),
      since: z.number().int().nullable().default(null),
    })
    .default({}),
  quest: z
    .object({
      active: z.boolean().default(false),
      attempt: z.number().int().nonnegative().default(0),
      nobles: z
        .array(z.object({ motive: z.string(), name: z.string(), status: z.enum(["unknown", "won", "refused", "hedging", "betrayer"]) }))
        .default([]),
      phase: z.enum(["none", "gathering", "battle", "election", "crowned", "submitted", "failed"]).default("none"),
    })
    .default({}),
  diffusion: z
    .object({
      innovations: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            introducedTurn: z.number().int(),
            legibility: z.enum(["obvious", "puzzling", "opaque"]),
            reproduction: z.enum(["trivial", "craftsman", "capital", "programme"]),
            proof: z.enum(["self", "season", "cycles", "generation"]),
            exposure: z.array(z.string()).default([]),
            spread: z.enum(["own_lands", "region", "kingdom"]).default("own_lands"),
            spreadTurn: z.number().int().optional(),
            spreadDueTurn: z.number().int().nullable().default(null),
            writtenDown: z.boolean().default(false),
            creditedToPlayer: z.boolean().default(true),
          }),
        )
        .default([]),
    })
    .default({}),
  record: z.array(z.object({ year: z.number().int(), season: z.enum(SEASON_ORDER), text: z.string(), thread: z.string() })).default([]),
  away: z.object({ reason: z.string(), untilTurn: z.number().int() }).nullable().default(null),
  dead: z.object({ cause: z.enum(["old_age", "battle", "illness", "wound"]), year: z.number().int() }).nullable().default(null),
});
export type HistoryState = z.infer<typeof HistoryStateSchema>;

export const HISTORY_STATE_DEFAULT: HistoryState = HistoryStateSchema.parse({});
