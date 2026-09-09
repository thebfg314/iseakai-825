import type { Season } from "../engine/schema";
import { SEASONS } from "../engine/schema";

import spring1 from "../../art assets/Anim sprites/Spring Idle/Spring 1.jpg";
import spring2 from "../../art assets/Anim sprites/Spring Idle/Spring 2.jpg";
import spring3 from "../../art assets/Anim sprites/Spring Idle/Spring 3.jpg";
import spring4 from "../../art assets/Anim sprites/Spring Idle/Spring 4.jpg";
import spring5 from "../../art assets/Anim sprites/Spring Idle/Spring 5.jpg";
import spring6 from "../../art assets/Anim sprites/Spring Idle/Spring 6.jpg";
import spring7 from "../../art assets/Anim sprites/Spring Idle/Spring 7.jpg";
import spring8 from "../../art assets/Anim sprites/Spring Idle/Spring 8.jpg";

import summer1 from "../../art assets/Anim sprites/Summer idle/Summer 1.jpg";
import summer2 from "../../art assets/Anim sprites/Summer idle/Summer 2.jpg";
import summer3 from "../../art assets/Anim sprites/Summer idle/Summer 3.jpg";
import summer4 from "../../art assets/Anim sprites/Summer idle/Summer 4.jpg";
import summer5 from "../../art assets/Anim sprites/Summer idle/Summer 5.jpg";
import summer6 from "../../art assets/Anim sprites/Summer idle/Summer 6.jpg";
import summer7 from "../../art assets/Anim sprites/Summer idle/Summer 7.jpg";
import summer8 from "../../art assets/Anim sprites/Summer idle/Summer 8.jpg";

import fall1 from "../../art assets/Anim sprites/Fall Idle/Fall 1.jpg";
import fall2 from "../../art assets/Anim sprites/Fall Idle/Fall 2.jpg";
import fall3 from "../../art assets/Anim sprites/Fall Idle/Fall 3.jpg";
import fall4 from "../../art assets/Anim sprites/Fall Idle/Fall 4.jpg";
import fall5 from "../../art assets/Anim sprites/Fall Idle/Fall 5.jpg";
import fall6 from "../../art assets/Anim sprites/Fall Idle/Fall 6.jpg";
import fall7 from "../../art assets/Anim sprites/Fall Idle/Fall 7.jpg";
import fall8 from "../../art assets/Anim sprites/Fall Idle/Fall 8.jpg";

import winter1 from "../../art assets/Anim sprites/Winter Idle/Winter 1.jpg";
import winter2 from "../../art assets/Anim sprites/Winter Idle/Winter 2.jpg";
import winter3 from "../../art assets/Anim sprites/Winter Idle/Winter 3.jpg";
import winter4 from "../../art assets/Anim sprites/Winter Idle/Winter 4.jpg";
import winter5 from "../../art assets/Anim sprites/Winter Idle/Winter 5.jpg";
import winter6 from "../../art assets/Anim sprites/Winter Idle/Winter 6.jpg";
import winter7 from "../../art assets/Anim sprites/Winter Idle/Winter 7.jpg";
import winter8 from "../../art assets/Anim sprites/Winter Idle/Winter 8.jpg";

export const SEASON_IDLE_FPS = 4;
export const SEASON_IDLE_FRAME_MS = 1000 / SEASON_IDLE_FPS;
export const SEASON_IDLE_FRAME_COUNT = 8;
/** Shared canvas for every idle frame so the header reel does not jump. */
export const SEASON_IDLE_CANVAS_WIDTH = 3168;
export const SEASON_IDLE_CANVAS_HEIGHT = 1344;

/** Folder names under `art assets/Anim sprites/` (Summer uses lowercase "idle"). */
export const SEASON_ART_FOLDER: Record<Season, string> = {
  spring: "Spring Idle",
  summer: "Summer idle",
  autumn: "Fall Idle",
  winter: "Winter Idle",
};

/** File prefix inside each folder. Game season `autumn` maps to Fall. */
export const SEASON_ART_PREFIX: Record<Season, string> = {
  spring: "Spring",
  summer: "Summer",
  autumn: "Fall",
  winter: "Winter",
};

const SEASON_IDLE: Record<Season, readonly string[]> = {
  spring: [spring1, spring2, spring3, spring4, spring5, spring6, spring7, spring8],
  summer: [summer1, summer2, summer3, summer4, summer5, summer6, summer7, summer8],
  autumn: [fall1, fall2, fall3, fall4, fall5, fall6, fall7, fall8],
  winter: [winter1, winter2, winter3, winter4, winter5, winter6, winter7, winter8],
};

export function seasonArtFolder(season: Season): string {
  return SEASON_ART_FOLDER[season];
}

export function seasonArtPrefix(season: Season): string {
  return SEASON_ART_PREFIX[season];
}

export function seasonIdleFrames(season: Season): readonly string[] {
  return SEASON_IDLE[season];
}

/** Normalize a 0-based frame index onto the 8-frame idle reel. */
export function wrapIdleFrameIndex(index: number, count = SEASON_IDLE_FRAME_COUNT): number {
  return ((index % count) + count) % count;
}

/** Advance one frame, wrapping 7 → 0 (frames 1→8→1). */
export function nextIdleFrameIndex(index: number, count = SEASON_IDLE_FRAME_COUNT): number {
  return wrapIdleFrameIndex(index + 1, count);
}

export function seasonIdleFrame(season: Season, frameIndex: number): string {
  const frames = seasonIdleFrames(season);
  return frames[wrapIdleFrameIndex(frameIndex, frames.length)];
}

/**
 * Later PR: play optional transition frames from → to, then settle on the new
 * season's idle frame 1. Empty until transition art is added.
 */
export const seasonTransition: Partial<Record<Season, Partial<Record<Season, readonly string[]>>>> = {};

export function seasonTransitionFrames(from: Season, to: Season): readonly string[] {
  return seasonTransition[from]?.[to] ?? [];
}

export type SeasonHeaderView = {
  displaySeason: Season;
  frameIndex: number;
  animating: boolean;
};

/** Idle: frame 1 of the current season. Looping: 0-based index of the old season. */
export function seasonHeaderView(
  currentSeason: Season,
  loopingSeason: Season | null,
  frameIndex: number,
): SeasonHeaderView {
  if (loopingSeason) {
    return { displaySeason: loopingSeason, frameIndex, animating: true };
  }
  return { displaySeason: currentSeason, frameIndex: 0, animating: false };
}

export function seasonHeaderSrc(currentSeason: Season, loopingSeason: Season | null, frameIndex: number): string {
  const view = seasonHeaderView(currentSeason, loopingSeason, frameIndex);
  return seasonIdleFrame(view.displaySeason, view.frameIndex);
}

export function beginSeasonAdvanceLoop(currentSeason: Season): Season {
  return currentSeason;
}

export function endSeasonAdvanceLoop(): null {
  return null;
}

export { SEASONS };
