import type { WorldState } from "../engine/schema";
import { createRng, seedFromString } from "../combat/rng";
import type { DeliveryResult } from "./deliver";
import { historyContent } from "./load";
import type { SeasonAt } from "./scheduler";

/**
 * Technology diffusion ledger (03_HISTORY §12; design/history/Technology_Diffusion_Rules.md).
 * The LLM registers and exposes innovations (hooks.ts); this tick runs the
 * timers: when one ends the thing moves from the lord's lands to the region and
 * then the kingdom, with a short Aldric note. Espionage: after a public showing
 * of an opaque process, a yearly roll can cut the timer to a few years. A
 * yield-raising method that reaches the kingdom lowers the grain bands once.
 */

type Innovation = WorldState["history"]["diffusion"]["innovations"][number];

const GRAINS = ["wheat", "rye", "barley", "oats"] as const;
const YIELD_WORDS = /rotation|three.field|drain|marl|legume|compost|plough|plow|harrow|seed drill|manur|fallow|yield|horse collar|mill/i;
export const ESPIONAGE_BASE = 0.1;
export const ESPIONAGE_PER_RIVAL = 0.1;
export const ESPIONAGE_CUT_SEASONS = 16;

export function isYieldRaising(inn: Pick<Innovation, "name">): boolean {
  return YIELD_WORDS.test(inn.name);
}

/** Rivals with a motive to buy a craftsman: the count when he covets, Richard once he is building, the king once the ladder has begun. */
export function rivalsWithMotive(state: WorldState): number {
  let n = 0;
  if (state.history.flags.count_covets) n += 1;
  if (state.history.richard.taken.length > 0) n += 1;
  if (state.history.ladder.stage !== "none") n += 1;
  return n;
}

/** The defence against espionage: specialists kept close (03_HISTORY §12). Read from NPC notes/flags. */
export function specialistsLoyal(state: WorldState): boolean {
  return state.npcs.some((npc) => /craftsman|smith|millwright|mason|engineer/i.test(npc.role ?? "") && /loyal|married|land of his own|paid well/i.test(npc.notes ?? ""));
}

function spreadWord(s: Innovation["spread"]): string {
  return s === "region" ? "the neighbouring estates" : s === "kingdom" ? "the whole kingdom" : "the lord's own lands";
}

export function tickDiffusion(state: WorldState, at: SeasonAt, turn: number): DeliveryResult {
  const out: DeliveryResult = { beats: [], lines: [] };
  const content = historyContent();
  if (!content.features.diffusion) return out;
  const d = state.history.diffusion;
  if (!d.innovations.length) return out;

  // Espionage: once a year, for opaque things shown in public that have no timer or a long one.
  if (d.lastSpyYear !== at.year && at.season === "spring") {
    d.lastSpyYear = at.year;
    for (const inn of d.innovations) {
      if (inn.spread === "kingdom" || inn.legibility !== "opaque") continue;
      if (!inn.exposure.some((e) => e === "public_use" || e === "battle_allies" || e === "shown_king")) continue;
      if (inn.spreadDueTurn !== null && inn.spreadDueTurn - turn <= ESPIONAGE_CUT_SEASONS) continue;
      const rng = createRng(seedFromString(`${state.meta.region}:spy:${inn.id}:${at.year}`));
      let chance = ESPIONAGE_BASE + ESPIONAGE_PER_RIVAL * rivalsWithMotive(state);
      if (specialistsLoyal(state)) chance *= 0.5;
      if (rng.chance(chance)) {
        inn.spreadDueTurn = turn + ESPIONAGE_CUT_SEASONS;
        if (!inn.exposure.includes("espionage")) inn.exposure.push("espionage");
        out.lines.push(`Espionage: a craftsman from the ${inn.name} works was bought; the secret will be out in a few years.`);
        out.beats.push({ npcId: "steward", eventId: `diffusion:${inn.id}`, text: `My lord, one of the men from the ${inn.name} works has gone. Not run off: gone with his tools and a purse, and a stranger's horse waiting at the ford. Whoever paid him knows the shape of the thing now, if not every detail. A few years, I should think, before we see it done elsewhere.` });
      }
    }
  }

  // Timers.
  for (const inn of d.innovations) {
    if (inn.spreadDueTurn === null || inn.spreadDueTurn > turn || inn.spread === "kingdom") continue;
    const was = inn.spread;
    inn.spread = was === "own_lands" ? "region" : "kingdom";
    inn.spreadTurn = turn;
    // Region to kingdom takes as long again, unless it was written down (monks copied): one year.
    inn.spreadDueTurn = inn.spread === "kingdom" ? null : inn.writtenDown ? turn + 4 : turn + Math.max(4, turn - inn.introducedTurn);
    out.lines.push(`${inn.name} has spread to ${spreadWord(inn.spread)}.`);
    out.beats.push({
      npcId: "steward",
      eventId: `diffusion:${inn.id}`,
      text: inn.spread === "region"
        ? `My lord, they are doing the ${inn.name} at the next villa now, and not badly. Our advantage is in doing it better, not in doing it alone.`
        : `My lord, the ${inn.name} is everywhere now. Travellers speak of it as a thing that has always been done. ${inn.creditedToPlayer ? "Some of them still say it came from Fontenay." : "Nobody says where it came from."}`,
    });
    state.history.record.push({ year: at.year, season: at.season, text: `${inn.name} spread to ${spreadWord(inn.spread)}.`, thread: "knowledge" });
    if (inn.spread === "kingdom" && isYieldRaising(inn) && !d.grainCut) {
      d.grainCut = true;
      for (const g of GRAINS) {
        const b = state.market[g];
        if (b) state.market[g] = { min: Math.round(b.min * 0.9), max: Math.round(b.max * 0.9) };
        const base = state.history.prices.base[g];
        if (base) state.history.prices.base[g] = { min: Math.round(base.min * 0.9), max: Math.round(base.max * 0.9) };
      }
      out.lines.push("Grain is a tenth cheaper everywhere: the kingdom grows more now.");
    }
  }
  return out;
}

/** One line for the prompt. */
export function diffusionLine(state: WorldState): string | null {
  const list = state.history.diffusion.innovations;
  if (!list.length) return null;
  const parts = list.map((i) => `${i.name} (${i.spread === "own_lands" ? "ours alone" : i.spread === "region" ? "copied nearby" : "everywhere"})`);
  return `New things of this house: ${parts.join("; ")}.`;
}
