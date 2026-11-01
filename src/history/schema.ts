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

/**
 * A promotion window (03_HISTORY §10): the lord rises one rank if his renown has reached the next
 * threshold (scaled when `scaleWhen` holds), capped at `cap`. `onPromote` / `onThanks` apply after.
 */
export const PromoteEffectSchema = z
  .object({
    /** Who grants it; benefices that come with the step are held from this hand. */
    patron: z.string().min(1),
    /** Highest rank this patron can give (a king of part of Aquitaine cannot make dukes). */
    cap: z.number().int().min(2).max(4).default(4),
    /** Multiply the threshold when this condition holds (a doubtful man needs more). */
    scaleWhen: z.string().optional(),
    scale: z.number().positive().default(1),
    /** Flag set when the step is granted (registered setBy "engine"). */
    mark: z.string().optional(),
    onPromote: z.lazy((): z.ZodTypeAny => EffectsListSchema).optional(),
    onThanks: z.lazy((): z.ZodTypeAny => EffectsListSchema).optional(),
  })
  .strict();
export type PromoteEffect = z.infer<typeof PromoteEffectSchema>;

/** Land or office handed over outside a rank step: villas as benefices from `patron`, or a named county. */
export const GrantEffectSchema = z
  .object({
    patron: z.string().min(1),
    villas: z.number().int().positive().optional(),
    tenure: z.enum(["benefice", "owned"]).default("benefice"),
    /** Villa template to use: the rank step's (default: the lord's current rank, at least Viscount's). */
    like: z.number().int().min(2).max(4).optional(),
    county: z.string().optional(),
  })
  .strict();
export type GrantEffect = z.infer<typeof GrantEffectSchema>;

export const EffectsSchema = z
  .object({
    /** Condition (§6.1); the block applies only when true. Lets one option branch on earlier flags. */
    when: z.string().optional(),
    promote: PromoteEffectSchema.optional(),
    grant: GrantEffectSchema.optional(),
    /** Benefices held from this patron are lost (the patron fell). */
    forfeit: z.object({ patron: z.string().min(1) }).strict().optional(),
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
    /**
     * Trade health: `shift` knocks the slow number (it recovers), with `seasons` it is a passing shock instead;
     * `baseline` moves the regional baseline for good (an abbey, a mint). `reason` is what the household says.
     */
    trade: z
      .object({
        shift: z.number().optional(),
        seasons: z.number().int().positive().optional(),
        baseline: z.number().optional(),
        reason: z.string().min(1),
      })
      .strict()
      .optional(),
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
  /** Delivered by an engine system (duties, ladder, quest), not the calendar; `fires` is nominal. */
  rolled: z.boolean().default(false),
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

// ---------------------------------------------------------------------------
// Battle forces (design/history/Battle_Force_Tables.md; 03_HISTORY §9)
// ---------------------------------------------------------------------------

/** One roster line of a sector. `fixed` lines are named allies and royal engines: never displaced. */
export const BattleLineSchema = z
  .object({
    sheet: z.string().min(1),
    count: z.number().int().positive().default(1),
    name: z.string().optional(),
    /** Stable id for results that look a unit up (Robert at Brissarthe, the betrayer's files). */
    id: z.string().optional(),
    fixed: z.boolean().default(false),
    /** At Rank-and-File the lord rides in this file. */
    lord: z.boolean().default(false),
    /** Starts Disordered (morale under a quarter): a camp surprised, deserters without a captain. */
    disordered: z.boolean().default(false),
    /** Morale as a fraction of the sheet's, for a flank worn down before the sector joins. */
    morale: z.number().positive().max(1).optional(),
    /** Men, when under strength (a foraging party of 15). */
    strength: z.number().int().positive().optional(),
    tags: z.array(z.string()).default([]),
  })
  .strict();
export type BattleLine = z.infer<typeof BattleLineSchema>;

/** The allied part of the sector at one rank, and how many files the lord is expected to bring. */
export const BattleRankRowSchema = z
  .object({
    allies: z.array(BattleLineSchema).default([]),
    slots: z.number().int().nonnegative().default(0),
    /** Files that make up the sector when he brings fewer than `slots` (cycled). */
    fill: z.array(BattleLineSchema).optional(),
  })
  .strict();
export type BattleRankRow = z.infer<typeof BattleRankRowSchema>;

export const AbstractEventSchema = z
  .object({
    round: z.number().int().positive(),
    side: z.enum(["player", "enemy"]),
    /** Negative: a morale loss to every file of that side; positive: a boost. */
    morale: z.number(),
    text: z.string().min(1),
  })
  .strict();
export type AbstractEvent = z.infer<typeof AbstractEventSchema>;

export const BattleForcesSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    /** The calendar (or quest, or supply-check) event that raises this battle. */
    event: z.string().min(1),
    /** Picks between variants of one event (Fontenoy's main line and Warin's column). First match wins. */
    when: z.string().optional(),
    title: z.string().min(1),
    /** The call banner. */
    call: z.string().min(1),
    /** The narrator's premise. */
    premise: z.string().min(1),
    momentum: z.number().int().min(1).max(100),
    /** Home defence: no allies at any rank; fought at the villa behind its own walls. */
    home: z.boolean().default(false),
    /** Raised by the event's supply check when the lord has a militia, instead of the loss roll. */
    supply: z.boolean().default(false),
    /** The king-quest battle: the sector is composed from the supporters won. */
    quest: z.boolean().default(false),
    /** Full Command regardless of rank (the lord's own war). */
    fullCommand: z.boolean().default(false),
    fort: z
      .object({
        side: z.enum(["player", "enemy"]),
        type: z.enum(["wooden", "stone"]),
        makeshift: z.boolean().default(false),
        points: z.number().int().min(1).max(3).default(3),
      })
      .strict()
      .optional(),
    field: z
      .object({
        weather: z.string().optional(),
        roughness: z.number().min(0).max(1).optional(),
        /** Terrain weights replacing the generator's (swamp for Ballon, a stream for Fontenoy). */
        terrain: z.record(z.string(), z.number().nonnegative()).optional(),
        name: z.string().optional(),
      })
      .strict()
      .optional(),
    posture: z.object({ allies: z.enum(["attack", "defend"]).optional(), enemy: z.enum(["attack", "defend"]).optional() }).strict().optional(),
    enemy: z.array(BattleLineSchema).min(1),
    /** Allied rows by rank 1–5 (villa lord, viscount, count, duke, king). A missing rank reads the one below. */
    rows: z.record(z.enum(["1", "2", "3", "4", "5"]), BattleRankRowSchema).default({}),
    /** The lord's own files begin Disordered too, unless veterans (Andernach). */
    ownDisordered: z.boolean().default(false),
    /** The abstract layer: the rest of the battle arriving as morale events. */
    abstract: z.array(AbstractEventSchema).default([]),
    /** Effects by the sector's result: won (victory, the enemy drew off), lost (defeat), held (a draw, a withdrawal). */
    results: z
      .object({ won: EffectsListSchema.optional(), lost: EffectsListSchema.optional(), held: EffectsListSchema.optional(), any: EffectsListSchema.optional() })
      .strict()
      .optional(),
    /** Effects when a named file (by `id`) is still standing at the end, whatever the result. */
    survivor: z.object({ unit: z.string(), effects: EffectsListSchema }).strict().optional(),
    /** Turning back once the call is raised. */
    onRefuse: EffectsListSchema.optional(),
    notes: z.string().optional(),
  })
  .strict();
export type BattleForces = z.infer<typeof BattleForcesSchema>;

export const BattleFileSchema = z.object({ battles: z.array(BattleForcesSchema) });

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

// ---------------------------------------------------------------------------
// Rank steps (data/history/ranks.json; 03_HISTORY §10)
// ---------------------------------------------------------------------------

export const VillaTemplateSchema = z
  .object({
    manses: z.object({ free: z.number().int().nonnegative(), servile: z.number().int().nonnegative(), vacant: z.number().int().nonnegative() }),
    land: z.object({
      fertile_arable: z.number().nonnegative(),
      meadow: z.number().nonnegative(),
      vineyard: z.number().nonnegative(),
      orchard: z.number().nonnegative(),
      woodland: z.number().nonnegative(),
      scrub: z.number().nonnegative(),
      waste: z.number().nonnegative(),
      swamp: z.number().nonnegative(),
    }),
    people: z.object({ men: z.number().int().nonnegative(), women: z.number().int().nonnegative(), youths: z.number().int().nonnegative() }),
    stores: z.record(z.string(), z.number().nonnegative()),
    features: z.array(z.string()).default([]),
  })
  .strict();
export type VillaTemplate = z.infer<typeof VillaTemplateSchema>;

export const CountyTemplateSchema = z
  .object({
    fiscManses: z.number().int().nonnegative(),
    fiscVillas: z.number().int().nonnegative(),
    levy: z.number().int().nonnegative(),
    yearly: z.object({ tolls: z.number().nonnegative(), market: z.number().nonnegative(), justice: z.number().nonnegative(), fisc: z.number().nonnegative(), officers: z.number().nonnegative() }),
  })
  .strict();

export const RankStepSchema = z
  .object({
    title: z.string(),
    targetVillas: z.number().int().nonnegative(),
    villa: VillaTemplateSchema.optional(),
    chest: z.number().nonnegative(),
    units: z.array(z.object({ sheet: z.string(), men: z.number().int().positive(), name: z.string() })).default([]),
    vassals: z.number().int().nonnegative().default(0),
    seatFeature: z.string().optional(),
    office: z.object({ deputyShare: z.number().nonnegative(), courtFines: z.number().nonnegative() }).optional(),
    counties: z.number().int().nonnegative().default(0),
    county: CountyTemplateSchema.optional(),
    mint: z.number().nonnegative().optional(),
    royalFisc: z.object({ yearly: z.number().nonnegative(), host: z.object({ min: z.number().int(), max: z.number().int() }) }).optional(),
  })
  .strict();
export type RankStep = z.infer<typeof RankStepSchema>;

export const RanksFileSchema = z.object({
  notes: z.string().optional(),
  thresholds: z.array(z.number()).length(5),
  summons: z.object({
    minSeasons: z.number().int().positive(),
    maxSeasons: z.number().int().positive(),
    cooldownSeasons: z.number().int().nonnegative(),
    quietAfterScriptedSeasons: z.number().int().nonnegative(),
  }),
  steps: z.object({ "2": RankStepSchema, "3": RankStepSchema, "4": RankStepSchema, "5": RankStepSchema }),
  administration: z.object({
    notes: z.string().optional(),
    capacity: z.record(z.enum(["1", "2", "3", "4", "5"]), z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])),
    titles: z.record(z.enum(["1", "2", "3", "4", "5"]), z.string()),
    staffPerHire: z.number().int().positive(),
    maxStaff: z.number().int().nonnegative(),
    costs: z.object({
      promote: z.object({ oncePerRank: z.number().nonnegative(), perSeasonPerRank: z.number().nonnegative() }),
      staff: z.object({ once: z.number().nonnegative(), perSeason: z.number().nonnegative() }),
      deputy: z.object({ once: z.number().nonnegative(), perSeason: z.number().nonnegative(), capacity: z.number().int().positive(), leakChance: z.number().min(0).max(1), leakShare: z.number().min(0).max(1) }),
    }),
    overload: z.array(z.object({ over: z.number().int().positive(), drop: z.number().min(0).max(1), leakPerHolding: z.number().nonnegative(), mood: z.number().int() })).min(1),
  }),
  autun: z.object({ tollsMultiplier: z.number().positive(), seatFeature: z.string(), mintFromYear: z.number().int() }),
  counties: z.array(z.string()).min(4),
  villaNames: z.array(z.string()).min(45),
  vassalNames: z.array(z.string()).min(10),
});
export type RanksFile = z.infer<typeof RanksFileSchema>;

/** Justice (data/history/justice.json; 03_HISTORY §10b): the dispute tables, the stances, the cadence. */
export const JUSTICE_STANCES = ["lenient", "fair", "strict", "extortionate"] as const;
export type JusticeStance = (typeof JUSTICE_STANCES)[number];
export const JUSTICE_TABLES = ["villa", "county", "duke"] as const;
export type JusticeTable = (typeof JUSTICE_TABLES)[number];

export const JusticeVerdictSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    /** Denarii into the chest (negative: paid out). */
    fines: z.number().default(0),
    /** −1 unjust, 0 neither, +1 fair: the running measure of the lord as a judge. */
    fairness: z.number().int().min(-1).max(1).default(0),
    /** The people's happiness. */
    people: z.number().int().default(0),
    /** favor_church. */
    church: z.number().int().default(0),
    /** The sworn men's mood (vassals.ts). */
    vassals: z.number().int().default(0),
    renown: z.union([z.number(), z.enum(RENOWN_BANDS)]).optional(),
    /** The king's missi take notice. */
    missi: z.number().int().nonnegative().default(0),
    /** Nothing settled: the quarrel comes back as a feud in a few seasons. */
    feud: z.boolean().default(false),
  })
  .strict();
export type JusticeVerdict = z.infer<typeof JusticeVerdictSchema>;

export const JusticeCaseSchema = z
  .object({
    id: z.string().min(1),
    speaker: z.enum(["steward", "chaplain"]),
    title: z.string().min(1),
    text: z.string().min(1),
    verdicts: z.array(JusticeVerdictSchema).min(2),
  })
  .strict();
export type JusticeCase = z.infer<typeof JusticeCaseSchema>;

export const JusticeFileSchema = z.object({
  notes: z.string().optional(),
  cadence: z.object({
    perYearMax: z.number().int().positive(),
    maxPerSeason: z.number().int().positive(),
    chancePerSeason: z.number().min(0).max(1),
    deadlineSeasons: z.number().int().positive(),
    feudSeasons: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  }),
  stances: z.record(
    z.enum(JUSTICE_STANCES),
    z.object({ fines: z.number().positive(), loyaltyPerYear: z.number().int(), church: z.number().int(), missiPerYear: z.number().int().nonnegative(), word: z.string() }),
  ),
  missi: z.object({ attentionBefore: z.number().int().positive(), fineShare: z.number().min(0).max(1), renown: z.enum(RENOWN_BANDS), favour: z.number().int() }),
  framing: z.object({ county: z.string(), duke: z.string() }),
  tables: z.object({ villa: z.array(JusticeCaseSchema).min(1), county: z.array(JusticeCaseSchema).min(1), duke: z.array(JusticeCaseSchema).min(1) }),
});
export type JusticeFile = z.infer<typeof JusticeFileSchema>;

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
  duties: z
    .object({
      lastRollTurn: z.number().int().nullable().default(null),
      favour: z.number().int().default(0),
      /** Turn of the last D-007 hosting whose favour has been settled. */
      hostingSettledTurn: z.number().int().nullable().default(null),
    })
    .default({}),
  /** The Duke track: opportunities Richard has taken because the lord did not (richard.ts). */
  richard: z.object({ taken: z.array(z.string()).default([]) }).default({}),
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
      /** Turn the last approach was resolved (one a season). */
      lastApproachTurn: z.number().int().nullable().default(null),
      /** Turn the phase last changed. */
      phaseTurn: z.number().int().nullable().default(null),
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
      /** A yield-raising method reached the kingdom and the grain bands were cut once (03_HISTORY §12). */
      grainCut: z.boolean().default(false),
      /** Year of the last espionage roll. */
      lastSpyYear: z.number().int().nullable().default(null),
    })
    .default({}),
  /** Rank progression (03_HISTORY §10): eligibility, the generic summons clock, and what the office holds. */
  rank: z
    .object({
      /** Turn the renown first crossed the next threshold; null when not eligible. */
      eligibleSince: z.number().int().nullable().default(null),
      /** Turn the generic summons falls due (within two years of eligibility). */
      dueTurn: z.number().int().nullable().default(null),
      /** No generic summons before this turn (after a stripping). */
      cooldownUntil: z.number().int().nullable().default(null),
      /** Who granted the last step. */
      patron: z.string().nullable().default(null),
      promotedTurn: z.number().int().nullable().default(null),
      /** What each scripted window did: promoted | thanks. */
      windows: z.record(z.string(), z.enum(["promoted", "thanks"])).default({}),
      /** Counties held by office (Count and above). */
      counties: z
        .array(
          z.object({
            name: z.string(),
            since: z.number().int(),
            fiscManses: z.number().int().nonnegative(),
            fiscVillas: z.number().int().nonnegative(),
            levy: z.number().int().nonnegative(),
            yearly: z.object({
              tolls: z.number().nonnegative(),
              market: z.number().nonnegative(),
              justice: z.number().nonnegative(),
              fisc: z.number().nonnegative(),
              officers: z.number().nonnegative(),
            }),
          }),
        )
        .default([]),
      /** The crown's revenues while he is king: not his, but his to spend. */
      royalFisc: z.object({ yearly: z.number().nonnegative(), host: z.object({ min: z.number().int(), max: z.number().int() }) }).nullable().default(null),
      /** Mint share a year, when held. */
      mint: z.number().nonnegative().default(0),
      /** Last season's office revenue, itemised, for the Books. */
      lastRevenue: z
        .object({ turn: z.number().int(), tolls: z.number(), market: z.number(), justice: z.number(), fisc: z.number(), mint: z.number(), deputy: z.number(), fines: z.number(), officers: z.number(), net: z.number() })
        .nullable()
        .default(null),
    })
    .default({}),
  /** Sworn men (step 3 gives them moods that move; here they are rostered at 50). */
  vassals: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        holding: z.string(),
        men: z.number().int().nonnegative(),
        mood: z.number().int().min(0).max(100).default(50),
        since: z.number().int(),
        /** A county's lords as one line at Duke and King. */
        group: z.boolean().default(false),
        grantedBy: z.string().optional(),
        /** Turn his mood fell below angry and has stayed there (null when not angry); four seasons and he may go. */
        angrySince: z.number().int().nullable().default(null),
        /** The last thing that moved him, for the household's lines and the icon's tooltip. */
        lastReason: z.string().nullable().default(null),
      }),
    )
    .default([]),
  /** Sworn men who left the lord's service (vassals.ts), for the record and the prompt. */
  vassalsLost: z.array(z.object({ name: z.string(), turn: z.number().int(), why: z.string() })).default([]),
  /** Trade health (rank design 'Trade health'; 03_HISTORY §11.8a): one hidden number for the home region. */
  trade: z
    .object({
      /** What the roads carry this season, 0–100: the number revenue, the merchant and the prices read. */
      health: z.number().min(0).max(100).default(55),
      /** The slow underlying number: events knock it, it drifts back toward the baseline plus improvements. */
      base: z.number().min(0).max(100).default(55),
      /** The regional baseline (Autun 55); abbeys and mints raise it for good. */
      baseline: z.number().min(0).max(100).default(55),
      /** How the lord's tolls are set once he holds a county (Count+). */
      tollStance: z.enum(["low", "customary", "greedy"]).default("customary"),
      /** Passing shocks (a hard winter, a levy) with the turn they last apply. */
      shocks: z.array(z.object({ reason: z.string(), amount: z.number(), untilTurn: z.number().int() })).default([]),
      /** Market bands for the trade goods before this season's shift, so they can be restored. */
      marketBase: z.record(z.string(), z.object({ min: z.number(), max: z.number() })).default({}),
      /** Health a year ago (spring snapshot) for Gerulf's "thinner than last year". */
      lastYear: z.number().nullable().default(null),
      /** The last named cause of a knock, for the household's lines. */
      lastCause: z.string().nullable().default(null),
      /** The qualitative word last reported, so a change is spoken once. */
      lastWord: z.string().nullable().default(null),
      /** Rolled catalog events already counted this turn (one knock per event per season). */
      countedTurn: z.number().int().nullable().default(null),
    })
    .default({}),
  /** Justice (rank design 'Justice'; 03_HISTORY §10b): the case before the hall, the stance, the lord as a judge. */
  justice: z
    .object({
      /** How the officers judge in the lord's name once he holds a county (Count+). */
      stance: z.enum(JUSTICE_STANCES).default("fair"),
      /** Aldric has explained the stance once (at the first county). */
      stanceExplained: z.boolean().default(false),
      /** The case waiting on the lord's judgement, if any. */
      open: z
        .object({ caseId: z.string(), table: z.enum(JUSTICE_TABLES), speaker: z.enum(["steward", "chaplain"]), openedTurn: z.number().int(), deadlineTurn: z.number().int() })
        .nullable()
        .default(null),
      /** Cases already brought, so the tables do not repeat until they are spent. */
      heard: z.array(z.string()).default([]),
      /** Cases brought this year and the year they count for. */
      casesThisYear: z.number().int().nonnegative().default(0),
      year: z.number().int().nullable().default(null),
      /** Running measure of the lord as a judge: fair verdicts raise it, unjust ones lower it (−12..12). */
      fairness: z.number().int().min(-12).max(12).default(0),
      /** The king's missi: how much notice they have taken; at the threshold they come. */
      missiAttention: z.number().int().nonnegative().default(0),
      missiVisits: z.number().int().nonnegative().default(0),
      /** Quarrels left unsettled, due to come back as feuds. */
      feuds: z.array(z.object({ caseId: z.string(), title: z.string(), dueTurn: z.number().int() })).default([]),
      /** The last verdicts, newest last, for the Books. */
      verdicts: z.array(z.object({ caseId: z.string(), title: z.string(), verdictId: z.string(), label: z.string(), turn: z.number().int() })).default([]),
      /** Year the stance last paid its yearly effects. */
      stanceYear: z.number().int().nullable().default(null),
    })
    .default({}),
  /** Administration (rank design 'Administration — abstracted through Aldric'; 03_HISTORY §10c): what Aldric can run. */
  administration: z
    .object({
      /** Times the lord has raised Aldric within his tier (0–2): moves capacity from the low end of the rank's range to the high. */
      standing: z.number().int().min(0).max(2).default(0),
      /** Clerks hired under him. */
      staff: z.number().int().nonnegative().default(0),
      /** A regional deputy (Duke+): competent and ambitious. */
      deputy: z.object({ name: z.string(), since: z.number().int() }).nullable().default(null),
      /** The overload tier last spoken (0 none … 3 running itself), so Aldric complains once per step. */
      lastTier: z.number().int().min(0).max(3).default(0),
      /** Turn the household's pay was last taken. */
      paidTurn: z.number().int().nullable().default(null),
      /** Denarii lost to uncollected dues and the deputy's hand, for the Books. */
      leaked: z.number().nonnegative().default(0),
    })
    .default({}),
  record: z.array(z.object({ year: z.number().int(), season: z.enum(SEASON_ORDER), text: z.string(), thread: z.string() })).default([]),
  away: z.object({ reason: z.string(), untilTurn: z.number().int() }).nullable().default(null),
  dead: z.object({ cause: z.enum(["old_age", "battle", "illness", "wound", "captivity"]), year: z.number().int() }).nullable().default(null),
  /** The closing screen (03_HISTORY §13): the death and the life, written once. */
  ending: z.object({ death: z.string(), summary: z.string(), voice: z.string(), byModel: z.boolean().default(false) }).nullable().default(null),
});
export type HistoryState = z.infer<typeof HistoryStateSchema>;

export const HISTORY_STATE_DEFAULT: HistoryState = HistoryStateSchema.parse({});
