import type { WorldState } from "../engine/schema";
import { administrationLine } from "./administration";
import { evalCondition } from "./conditions";
import { bodyAge, conditionContext } from "./flags";
import { landLine } from "./land";
import { historyContent } from "./load";
import { pricesLine } from "./prices";
import { rankLine } from "./promotion";
import { realmLine } from "./realm";
import { diffusionLine } from "./diffusion";
import { dutiesLine } from "./duties";
import { justiceLines } from "./justice";
import { ladderLine } from "./ladder";
import { questLines } from "./quest";
import { relicsLine } from "./relics";
import { richardLine } from "./richard";
import { activeEvents } from "./scheduler";
import { tradeLine } from "./trade";
import { vassalsLine } from "./vassals";
import { vikingLine } from "./vikings";
import type { HistoryEvent, HistorySpeaker } from "./schema";
import { fillSlots } from "./slots";

const SPEAKER_NAMES: Record<HistorySpeaker, string> = { steward: "Aldric", chaplain: "Ermenald" };

function seasonWord(state: WorldState): string {
  return `${state.meta.season} ${state.meta.year}`;
}

function optionsLine(options: { id: string; label: string; requires?: string }[], state: WorldState): string {
  const ctx = conditionContext(state);
  return options
    .filter((o) => !o.requires || evalCondition(o.requires, ctx))
    .map((o) => `${o.id} ("${o.label}")`)
    .join(" | ");
}

function momentumWord(m: number): string {
  if (m >= 80) return "all but certain; only something extraordinary bends it";
  if (m >= 60) return "likely; a strong, well-aimed effort could change it";
  if (m >= 40) return "contingent; a well-placed man could tip it";
  return "open; largely in the lord's hands";
}

function eventBlock(state: WorldState, event: HistoryEvent, speaker: HistorySpeaker, turn: number): string[] {
  const fired = state.history.fired[event.id];
  const when = fired ? `${fired.season} ${fired.year}` : "";
  const onChannel = event.channel.includes(speaker);
  const lines: string[] = [];
  const head = `- ${event.id} ${event.title} (${when})`;
  if (!onChannel) {
    const other = event.channel.map((c) => SPEAKER_NAMES[c]).join("/");
    lines.push(`${head} — told by ${other}; you know only that it was said.`);
    return lines;
  }
  const src = [event.source ? `Source: ${event.source}` : "", event.slant ? `Slant: ${event.slant}` : ""].filter(Boolean).join(" ");
  lines.push(src ? `${head}. ${src}` : head);
  const scene = state.history.scenes[event.id];
  const stage = scene ? event.stages[scene.stage] : undefined;
  if (event.knows.length) lines.push(`  Knows: ${fillSlots(state, event.knows.join(" "))}`);
  if (event.doesntKnow.length) lines.push(`  Doesn't know: ${event.doesntKnow.join(" ")}`);
  if (stage) {
    lines.push(`  SCENE in progress, stage "${stage.id}"${stage.title ? ` (${stage.title})` : ""}.${stage.advanceOn === "season" ? " It moves on with the season." : " When the lord's words settle it, emit history_scene {eventId, advance:true" + (stage.choices ? ", choiceId" : "") + "}."}`);
  }
  const choices = stage?.choices ?? event.choices;
  const openChoice = state.history.openChoices.find((c) => c.eventId === event.id && c.stageId === (stage?.choices ? stage.id : undefined));
  if (choices && openChoice) {
    const left = openChoice.deadlineTurn - turn;
    const deadline = left <= 1 ? "end of this season" : `${left} seasons`;
    lines.push(`  OPEN CHOICE (deadline: ${deadline})${choices.prompt ? ` — ${choices.prompt}` : ""}: ${optionsLine(choices.options, state)}. When the lord decides, emit history_choice {eventId:"${event.id}", optionId}.`);
  } else if (choices) {
    const key = stage?.choices ? `${event.id}#${stage.id}` : event.id;
    const chosen = state.history.chosen[key];
    if (chosen) lines.push(`  Decided: ${chosen}.`);
  }
  const hooks = [...(stage?.hooks ?? []), ...event.hooks].filter((h) => !(state.history.hooksTaken[event.id] ?? []).includes(h.id));
  const ctx = conditionContext(state);
  const openHooks = hooks.filter((h) => !h.requires || evalCondition(h.requires, ctx));
  if (openHooks.length) {
    lines.push(`  Hooks: ${openHooks.map((h) => `${h.id} ("${h.trigger}")`).join(", ")} — emit history_hook {eventId:"${event.id}", hookId} only when his words plainly do this.`);
  }
  const outcomes = stage?.outcomes ?? event.outcomes;
  const openOutcome = state.history.openOutcomes.find((c) => c.eventId === event.id && c.stageId === (stage?.outcomes ? stage.id : undefined));
  if (outcomes && openOutcome && !(event.links.fixedPoint && outcomes.options.length <= 1)) {
    lines.push(
      `  OUTCOME TO JUDGE (momentum ${outcomes.momentum} — ${momentumWord(outcomes.momentum)}). What could change it: ${outcomes.canChange} When the season's efforts are spoken and done, emit history_outcome {eventId:"${event.id}", outcomeId, reasoning} with one of: ${outcomes.options.map((o) => o.id).join(" | ")}. Weigh what the lord actually did and paid for, his renown (${Math.round(state.player.renown ?? 1)}), and the momentum; higher momentum means the historical result unless the effort was real and well-aimed.`,
    );
  }
  return lines;
}

function standingFacts(state: WorldState): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(state.history.flags)) {
    if (v === false || v === 0 || v === "" || v === "none") continue;
    parts.push(v === true ? k : `${k} = ${v}`);
  }
  return parts.join("; ");
}

/**
 * The HISTORY block for Aldric's and Ermenald's system prompts (03_HISTORY §7.1).
 * Empty string when nothing has fired and nothing is open, so quiet seasons cost no tokens.
 */
export function historyPromptBlock(state: WorldState, speaker: HistorySpeaker): string {
  if (!state.history) return "";
  const turn = state.meta.turn;
  const active = activeEvents(state, turn, historyContent());
  const facts = standingFacts(state);
  const lines: string[] = [];
  lines.push("HISTORY (engine truth; expand only from Knows, and plead ignorance on Doesn't know)");
  lines.push(`Today: ${seasonWord(state)}. ${realmLine(state)} The lord's body age is ${bodyAge(state)}.`);
  if (speaker === "steward") lines.push(landLine(state));
  lines.push(rankLine(state));
  if (speaker === "steward") {
    lines.push(tradeLine(state));
    const vassals = vassalsLine(state);
    if (vassals) lines.push(vassals);
    const admin = administrationLine(state);
    if (admin) lines.push(admin);
  }
  lines.push(...justiceLines(state, speaker));
  const prices = pricesLine(state);
  if (prices) lines.push(prices);
  const vikings = vikingLine(state);
  if (vikings) lines.push(vikings);
  const relics = relicsLine(state);
  if (relics) lines.push(relics);
  const richard = richardLine(state);
  if (richard && speaker === "steward") lines.push(richard);
  const duties = dutiesLine(state);
  if (duties) lines.push(duties);
  const ladder = ladderLine(state);
  if (ladder) lines.push(ladder);
  lines.push(...questLines(state));
  const diffusion = diffusionLine(state);
  if (diffusion) lines.push(diffusion);
  if (state.history.away) lines.push(`The lord is away: ${state.history.away.reason}. Speak as his clerk at his side.`);
  if (active.length) {
    lines.push("Active events (recent on your channel, or still open):");
    for (const e of active) lines.push(...eventBlock(state, e, speaker, turn));
  } else {
    lines.push("No dated matter is before the hall at present.");
  }
  if (facts) lines.push(`Standing facts the household knows: ${facts}.`);
  lines.push(
    "Rules: the scripts above were already spoken; do not repeat them. Never reveal a Doesn't-know item, even if the lord guesses right — say you have heard nothing of it. Never invent a flag, a reward, a rank, or an event; name only the choice, hook, outcome and scene ids declared here. A history proposal needs [[books:yes]]. If the lord's words fit no declared hook or choice, it is talk: [[books:no]].",
  );
  return lines.join("\n");
}

/** One line per fired event for the referee, so the season report can refer without retelling. */
export function historyRefereeLines(state: WorldState): string[] {
  const turn = state.meta.turn;
  const content = historyContent();
  return Object.entries(state.history.fired)
    .filter(([, f]) => f.turn === turn)
    .map(([id]) => content.byId.get(id))
    .filter((e): e is HistoryEvent => Boolean(e))
    .map((e) => `History this season: ${e.id} ${e.title} (told by ${e.channel.map((c) => SPEAKER_NAMES[c]).join("/")}).`);
}
