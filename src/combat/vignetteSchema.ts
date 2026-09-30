import { z } from "zod";

/**
 * Rank-and-File vignette cards (design doc §4.1; content file "Rank and file vignettes").
 * Prose is presented verbatim; `mech` is the machine-readable reading of each option's
 * italic effect line, using the Effect Tier Reference.
 */

export const VIGNETTE_PHASES = ["opening", "crisis", "turning"] as const;
export type VignettePhase = (typeof VIGNETTE_PHASES)[number];

export const EFFECT_TIERS = ["low", "medium", "high"] as const;
export type EffectTier = (typeof EFFECT_TIERS)[number];

const TierSchema = z.enum(EFFECT_TIERS);
const SignedTierSchema = z.object({ tier: TierSchema, sign: z.union([z.literal(1), z.literal(-1)]) }).strict();

export const VignetteEffectSchema = z
  .object({
    renown: SignedTierSchema.optional(),
    /** Applied to the lord's own unit. */
    unitMorale: SignedTierSchema.optional(),
    /** HP and morale loss on the nearest engaged enemy unit (Low/Medium only). */
    enemy: z.enum(["low", "medium"]).optional(),
    /** §8.4 flank shock on the lord's unit is halved this round. */
    flankShockHalf: z.boolean().optional(),
    /** The lord's unit braces: hold_formation set for the next round. */
    holdFormation: z.boolean().optional(),
    dismount: z.boolean().optional(),
    remount: z.boolean().optional(),
    /** Positioning nudges for the lord's unit next round. */
    positioning: z.enum(["sooner", "later", "exposed", "distance", "high_ground"]).optional(),
    /** Below 10 HP: a separate small chance to recover a little. */
    stabilize: z.boolean().optional(),
    /** Narrative flag for the LLM-NPC layer (took_prisoner, spared_rival, …). */
    flag: z.string().optional(),
    /** §8.7 wound-risk roll this round is skipped / doubled. */
    skipWoundRoll: z.boolean().optional(),
    extraWoundRoll: z.boolean().optional(),
  })
  .strict();
export type VignetteEffect = z.infer<typeof VignetteEffectSchema>;

export const VignetteOptionSchema = z
  .object({
    key: z.enum(["A", "B"]),
    text: z.string(),
    /** The italic mechanical line, verbatim, for the player to read. */
    mechanics: z.string(),
    /** Personal HP Risk tier; absent = no personal risk. */
    risk: TierSchema.optional(),
    /** Effects when the risky action comes off (the lord is not hurt by the risk roll). */
    onSuccess: VignetteEffectSchema.optional(),
    /** Effects when the risk roll wounds the lord. */
    onFail: VignetteEffectSchema.optional(),
    /** Effects regardless of the roll. */
    always: VignetteEffectSchema.optional(),
  })
  .strict();
export type VignetteOption = z.infer<typeof VignetteOptionSchema>;

export const VignetteSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    phase: z.enum(VIGNETTE_PHASES),
    title: z.string(),
    text: z.string(),
    /** Highest Renown tier reachable on this card, for pool statistics. */
    renownTier: TierSchema.optional(),
    options: z.array(VignetteOptionSchema).length(2),
  })
  .strict();
export type Vignette = z.infer<typeof VignetteSchema>;

export const VignetteFileSchema = z.object({
  $comment: z.string().optional(),
  tiers: z.object({
    personalRisk: z.record(TierSchema, z.object({ chance: z.number(), damage: z.object({ min: z.number(), max: z.number() }) })),
    renown: z.record(TierSchema, z.number()),
    unitMorale: z.record(TierSchema, z.number()),
    enemy: z.record(z.enum(["low", "medium"]), z.object({ min: z.number(), max: z.number() })),
  }),
  vignettes: z.array(VignetteSchema),
});
export type VignetteFile = z.infer<typeof VignetteFileSchema>;
