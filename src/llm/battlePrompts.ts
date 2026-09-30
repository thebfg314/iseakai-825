import type { BattleLogEntry, BattleState } from "../combat/battleTypes";
import type { Vignette } from "../combat/vignetteSchema";
import type { WorldState } from "../engine/schema";
import { extractJsonObject } from "./parse";

/**
 * Prompts for the battle narrator (design doc §4.1 presentation pipeline). The narrator
 * describes; it never adjudicates. Every number it may mention is handed to it by the engine.
 */

export const BATTLE_NARRATOR_SYSTEM = `You are the chronicler of a Carolingian battle in the year 825, narrating in the second person to a minor Frankish noble riding as one horseman among many. Write vivid, grounded, period-true prose: mud, horses, spears, shield-rims, the noise. No modern idiom, no game terms (never say HP, morale points, rounds, rolls, tiers, units, or stats), no headings, no lists, no markdown. Never invent outcomes, wounds, deaths, or numbers the engine did not give you; you describe what the engine says happened, in the order it happened. Keep to the length asked. Reply with plain prose only.`;

const roundWord = (n: number) => (n <= 1 ? "the first exchange" : n <= 3 ? "the early fighting" : n <= 7 ? "the long middle of the fight" : "the late fighting");

function sideSummary(state: BattleState): string {
  const mine = state.units.filter((u) => u.side === "player");
  const foe = state.units.filter((u) => u.side === "enemy");
  const line = (us: typeof mine) =>
    us
      .map((u) => `${u.name}${u.status === "active" ? ` (${Math.round((u.morale / u.maxMorale) * 100)}% heart, ${Math.round((u.hp / u.maxHp) * 100)}% whole)` : ` (${u.status})`}`)
      .join("; ");
  return `Our host: ${line(mine)}.\nTheir host: ${line(foe)}.`;
}

function recentLog(state: BattleState, sinceSeq: number): string {
  const kinds = new Set<BattleLogEntry["kind"]>(["engage", "strike", "fire", "shock", "rout", "morale", "player", "structure", "phase"]);
  const rows = state.log.filter((e) => e.seq >= sinceSeq && kinds.has(e.kind)).slice(-24);
  return rows.map((e) => `- ${e.text}`).join("\n") || "- Nothing decisive yet; the hosts are still closing.";
}

export function battleSceneUserPrompt(world: WorldState, state: BattleState, premise: string): string {
  const attached = state.units.find((u) => u.id === state.player.attachedUnitId);
  return `Open the battle. Season ${world.meta.season} ${world.meta.year}, near ${world.meta.region}. ${premise}
The lord rides in the file called "${attached?.name ?? "the horse"}" — one mounted man in the line, commanding no one.
${sideSummary(state)}
Field: ${state.battlefield.name}; weather ${state.battlefield.weather}.
Write two short paragraphs (120–180 words total): the ground, the two hosts drawing up, the lord's place in the line. End before the first blow.`;
}

export function vignetteBridgeUserPrompt(state: BattleState, sinceSeq: number, card: Vignette): string {
  return `We are in ${roundWord(state.round)}. Since the last moment we narrated, the engine records:
${recentLog(state, sinceSeq)}
${sideSummary(state)}
The lord: ${state.player.hp}/${state.player.maxHp} of his strength left${state.player.dismounted ? ", fighting on foot" : ", still mounted"}.

Write ONE paragraph (60–110 words) that carries the story from those events up to the instant this next scene begins, so it does not feel like a cut. Do not describe the scene itself or offer any choice — stop exactly where it starts:
"${card.text.slice(0, 220)}…"`;
}

export function routCardUserPrompt(state: BattleState, fate: { escaped: number; killed: number; captured: number }): string {
  const e = Math.round(fate.escaped * 100);
  const k = Math.round(fate.killed * 100);
  const c = Math.round(fate.captured * 100);
  return `The lord's own file has broken and is running. The engine has computed his odds if he rides with them: about ${e} in 100 to get clear, ${k} in 100 to be cut down, ${c} in 100 to be taken for ransom. These numbers are fixed; do not change them or invent others.
${sideSummary(state)}
Write ONE paragraph (70–110 words) of the moment the line gives way around him — the sound of it, who is pursuing, what he can see of the way out — and end on the choice: run with the rest and take those odds, or turn and stand over the fallen banner. Do not state the odds as numbers in the prose; make them felt (how close the pursuit is, how open the ground). Plain prose only.`;
}

export function aftermathUserPrompt(world: WorldState, state: BattleState, facts: string[], woundCount: number): string {
  return `The battle is over. The engine's ledger:
${facts.map((f) => `- ${f}`).join("\n")}
${sideSummary(state)}

Write the aftermath as two short paragraphs (120–200 words): the field at the end, what became of the lord and the men around him, what the day is worth to his name. Then, ONLY if the ledger lists wounds (${woundCount} new), append a final line in exactly this form, one entry per wound, nothing else on the line:
WOUNDS: <location one> — <five to ten words of how it was got>; <location two> — <...>
Use plausible period wound locations (a cut across the brow, two fingers of the left hand, a spear-graze along the ribs, a broken nose, an arrow through the calf). No markdown.`;
}

// ---------------------------------------------------------------------------
// Sub-Command: the commander's orders (design doc §4.2)
// ---------------------------------------------------------------------------

export const COMMANDER_SYSTEM = `You are the count's marshal, commanding a Carolingian host in the year 825, giving orders to a minor noble who leads his own small contingent within your line. Speak in the second person, curt and plain, as a veteran commander speaks to a junior he expects to obey: two to four sentences, no headings, no lists, no game terms (never HP, morale, rounds, units, stats). You choose ONLY among the objectives the engine offers you — never invent one, never change its terms — and you put the chosen one into a commander's words that a man could act on. Reply with ONE JSON object and nothing else: { "pick": <index of the chosen objective>, "order": "<your words>" }.`;

export type CandidateForPrompt = { plain: string; difficulty: number };

export function commanderOrderUserPrompt(
  state: BattleState,
  candidates: readonly CandidateForPrompt[],
  previous?: { text: string; status: "success" | "failed"; note: string },
): string {
  const mine = state.units.filter((u) => u.side === "player" && u.owner === "player" && u.status === "active").map((u) => u.name).join(", ");
  const list = candidates.map((c, i) => `${i}. (difficulty ${c.difficulty}) ${c.plain}`).join("\n");
  const before = previous
    ? `Your last order to him was: "${previous.text}" — it ${previous.status === "success" ? "was carried out" : "failed"}: ${previous.note} Acknowledge that in a clause, then give the next order.`
    : `The hosts are drawn up and the fighting is about to begin. Give him his first order.`;
  return `${before}
His contingent: ${mine || "his own file only"}.
${sideSummary(state)}
Objectives the engine can measure (choose one by index):
${list}`;
}

export function parseCommanderReply(raw: string, count: number): { pick: number; order: string } | null {
  const json = extractJsonObject(raw);
  if (!json) return null;
  try {
    const obj = JSON.parse(json) as { pick?: unknown; order?: unknown };
    const pick = typeof obj.pick === "number" ? obj.pick : typeof obj.pick === "string" ? Number(obj.pick) : NaN;
    if (!Number.isInteger(pick) || pick < 0 || pick >= count) return null;
    const order = typeof obj.order === "string" ? obj.order.trim() : "";
    return order.length > 10 ? { pick, order } : null;
  } catch {
    return null;
  }
}

/** Plain prose from a reply that may be bare text, fenced text, or a JSON wrapper with a prose field. */
export function proseFromReply(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const json = trimmed.startsWith("{") || trimmed.startsWith("```") ? extractJsonObject(trimmed) : null;
  if (json) {
    try {
      const obj = JSON.parse(json) as Record<string, unknown>;
      for (const key of ["narration", "speech", "text", "prose", "chronicle"]) {
        if (typeof obj[key] === "string" && (obj[key] as string).trim()) return (obj[key] as string).trim();
      }
    } catch {
      /* fall through to text */
    }
  }
  return trimmed
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/^#+\s.*$/gm, "")
    .trim();
}

/** Split the narrator's optional WOUNDS line off the aftermath prose. */
export function splitAftermath(text: string): { prose: string; wounds: { location: string; how: string }[] } {
  const lines = text.split(/\r?\n/);
  const idx = lines.findIndex((l) => /^\s*WOUNDS:/i.test(l));
  if (idx < 0) return { prose: text.trim(), wounds: [] };
  const woundLine = lines[idx].replace(/^\s*WOUNDS:\s*/i, "");
  const wounds = woundLine
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [location, ...rest] = s.split(/\s+—\s+|\s+-\s+/);
      return { location: location.trim(), how: rest.join(" — ").trim() };
    });
  return { prose: [...lines.slice(0, idx), ...lines.slice(idx + 1)].join("\n").trim(), wounds };
}
