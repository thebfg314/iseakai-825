export const ALDRIC_EMOTIONS = [
  "neutral",
  "respectful",
  "concerned",
  "alarmed",
  "disappointed",
  "exhausted",
  "pleased",
  "thoughtful",
] as const;

export type AldricEmotion = (typeof ALDRIC_EMOTIONS)[number];

export const PORTRAIT_NPCS = new Set([
  "steward",
  "smith",
  "chaplain",
  "merchant",
  "quarry_master",
  "carpenter",
  "mason",
  "potter",
  "village_reeve",
  "vinedresser",
  "head_seamstress",
  "copper_smith",
  "captain",
  "negotiator",
  "wife",
]);

const ALIASES: Record<string, AldricEmotion> = {
  neutral: "neutral",
  calm: "neutral",
  default: "neutral",
  respectful: "respectful",
  deferential: "respectful",
  formal: "respectful",
  bow: "respectful",
  concerned: "concerned",
  worry: "concerned",
  worried: "concerned",
  uneasy: "concerned",
  alarmed: "alarmed",
  shock: "alarmed",
  shocked: "alarmed",
  fear: "alarmed",
  afraid: "alarmed",
  angry: "alarmed",
  disappointed: "disappointed",
  disapproval: "disappointed",
  stern: "disappointed",
  exhausted: "exhausted",
  tired: "exhausted",
  weary: "exhausted",
  pleased: "pleased",
  happy: "pleased",
  glad: "pleased",
  smile: "pleased",
  thoughtful: "thoughtful",
  thinking: "thoughtful",
  considering: "thoughtful",
  displeased: "disappointed",
  unhappy: "disappointed",
};

const TAG =
  /\[\[\s*emotion\s*:\s*([a-z]+)\s*\]\]|<<\s*emotion\s*:\s*([a-z]+)\s*>>|\[\s*EMOTION\s*:\s*([a-z]+)\s*\]/gi;

export function normalizeEmotion(raw?: string | null): AldricEmotion | undefined {
  if (!raw) return undefined;
  const key = raw.trim().toLowerCase();
  if (ALIASES[key]) return ALIASES[key];
  if ((ALDRIC_EMOTIONS as readonly string[]).includes(key)) return key as AldricEmotion;
  return undefined;
}

export function stripEmotionCommands(speech: string): { speech: string; emotion?: AldricEmotion } {
  let found: AldricEmotion | undefined;
  const cleaned = speech
    .replace(TAG, (_m, a: string, b: string, c: string) => {
      found = normalizeEmotion(a || b || c) ?? found;
      return "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { speech: cleaned, emotion: found };
}
