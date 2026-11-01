import type { WorldState } from "../engine/schema";
import { ownVassals, vassalGroups, vassalMoodWord, type Vassal } from "../history/vassals";

/**
 * The row of sworn men under the happiness meter (rank design 'Vassals'). Viscount and
 * Count: the named men as figures, up to twelve. Duke and King: a figure per county's
 * lords, and the two or three named men who matter most (the angriest, then the strongest).
 */

export const MAX_FIGURES = 12;
export const NAMED_AT_DUKE = 3;

export type VassalFigure = {
  id: string;
  name: string;
  mood: "content" | "steady" | "angry";
  group: boolean;
  /** Tooltip in the hall's words. */
  title: string;
};

export const VASSAL_ROW_LABEL = "The sworn men";

function figureOf(v: Vassal): VassalFigure {
  const mood = vassalMoodWord(v.mood);
  const men = v.group ? `${v.men} to the levy` : `${v.men} men`;
  const why = v.lastReason ? ` — ${v.lastReason}` : "";
  return { id: v.id, name: v.name, mood, group: v.group, title: `${v.name}${v.group ? "" : ` of ${v.holding}`}: ${mood}, ${men}${why}` };
}

/** Which figures to show; empty when the lord has no sworn men. */
export function vassalFigures(state: WorldState): VassalFigure[] {
  const own = ownVassals(state);
  const groups = vassalGroups(state);
  if (!own.length && !groups.length) return [];
  if (!groups.length) return own.slice(0, MAX_FIGURES).map(figureOf);
  const named = [...own].sort((a, b) => a.mood - b.mood || b.men - a.men).slice(0, NAMED_AT_DUKE);
  return [...groups.map(figureOf), ...named.map(figureOf)];
}

/** The row's own tooltip: how many stand with the lord. */
export function vassalRowTitle(state: WorldState): string {
  const all = state.history.vassals ?? [];
  if (!all.length) return VASSAL_ROW_LABEL;
  const content = all.filter((v) => vassalMoodWord(v.mood) === "content").length;
  const angry = all.filter((v) => vassalMoodWord(v.mood) === "angry").length;
  const groups = all.filter((v) => v.group).length;
  const parts = [`${all.length - groups} sworn ${all.length - groups === 1 ? "man" : "men"}`];
  if (groups) parts.push(`${groups} ${groups === 1 ? "county's lords" : "counties' lords"}`);
  const moods = [content ? `${content} content` : null, angry ? `${angry} angry` : null].filter(Boolean).join(", ");
  return `${VASSAL_ROW_LABEL}: ${parts.join(" and ")}${moods ? ` (${moods})` : ""}`;
}
