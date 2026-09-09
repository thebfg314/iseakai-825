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

import springToSum1 from "../../art assets/Anim sprites/Spring to Summer/SpringtoSum 1.jpg";
import springToSum2 from "../../art assets/Anim sprites/Spring to Summer/SpringtoSum 2.jpg";
import springToSum3 from "../../art assets/Anim sprites/Spring to Summer/SpringtoSum 3.jpg";
import springToSum4 from "../../art assets/Anim sprites/Spring to Summer/SpringtoSum 4.jpg";
import springToSum5 from "../../art assets/Anim sprites/Spring to Summer/SpringtoSum 5.jpg";

import sumToFall1 from "../../art assets/Anim sprites/Summer to Fall/SumtoFall 1.jpg";
import sumToFall2 from "../../art assets/Anim sprites/Summer to Fall/SumtoFall 2.jpg";
import sumToFall3 from "../../art assets/Anim sprites/Summer to Fall/SumtoFall 3.jpg";
import sumToFall4 from "../../art assets/Anim sprites/Summer to Fall/SumtoFall 4.jpg";
import sumToFall5 from "../../art assets/Anim sprites/Summer to Fall/SumtoFall 5.jpg";

import fallToWint1 from "../../art assets/Anim sprites/Fall to Winter/FalltoWint 1.jpg";
import fallToWint2 from "../../art assets/Anim sprites/Fall to Winter/FalltoWint 2.jpg";
import fallToWint3 from "../../art assets/Anim sprites/Fall to Winter/FalltoWint 3.jpg";
import fallToWint4 from "../../art assets/Anim sprites/Fall to Winter/FalltoWint 4.jpg";
import fallToWint5 from "../../art assets/Anim sprites/Fall to Winter/FalltoWint 5.jpg";

import wintToSpring1 from "../../art assets/Anim sprites/Winter to Spring/WinttoSpring 1.jpg";
import wintToSpring2 from "../../art assets/Anim sprites/Winter to Spring/WinttoSpring 2.jpg";
import wintToSpring3 from "../../art assets/Anim sprites/Winter to Spring/WinttoSpring 3.jpg";
import wintToSpring4 from "../../art assets/Anim sprites/Winter to Spring/WinttoSpring 4.jpg";
import wintToSpring5 from "../../art assets/Anim sprites/Winter to Spring/WinttoSpring 5.jpg";

import seasonTimberFrame from "../../art assets/UI/season-timber-frame.png";

export const SEASON_IDLE_FPS = 4;
export const SEASON_IDLE_FRAME_MS = 1000 / SEASON_IDLE_FPS;
export const SEASON_IDLE_FRAME_COUNT = 8;
export const SEASON_TRANSITION_FPS = SEASON_IDLE_FPS;
export const SEASON_TRANSITION_FRAME_MS = SEASON_IDLE_FRAME_MS;
export const SEASON_TRANSITION_FRAME_COUNT = 5;
/** Shared canvas for every idle frame so the header reel does not jump. */
export const SEASON_IDLE_CANVAS_WIDTH = 3168;
export const SEASON_IDLE_CANVAS_HEIGHT = 1344;

/**
 * Timber/iron overlay around the season idle image. Swap this PNG later if a
 * painter replaces it; update SEASON_FRAME_INSET to match the new inner hole.
 */
export const SEASON_TIMBER_FRAME = seasonTimberFrame;

/** Inner opening as fractions of the overlay PNG (top, right, bottom, left). */
export const SEASON_FRAME_INSET = {
  top: 0.1625,
  right: 0.09547,
  bottom: 0.165278,
  left: 0.096167,
} as const;

/** Absolutely position the idle sprite in the frame's transparent opening. */
export function seasonFrameIdleBoxStyle(): {
  top: string;
  left: string;
  width: string;
  height: string;
} {
  const { top, right, bottom, left } = SEASON_FRAME_INSET;
  return {
    top: `${top * 100}%`,
    left: `${left * 100}%`,
    width: `${(1 - left - right) * 100}%`,
    height: `${(1 - top - bottom) * 100}%`,
  };
}

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

/** Consecutive-season reels under `art assets/Anim sprites/` (autumn → Fall). */
export const SEASON_TRANSITION_ART: readonly {
  from: Season;
  to: Season;
  folder: string;
  prefix: string;
}[] = [
  { from: "spring", to: "summer", folder: "Spring to Summer", prefix: "SpringtoSum" },
  { from: "summer", to: "autumn", folder: "Summer to Fall", prefix: "SumtoFall" },
  { from: "autumn", to: "winter", folder: "Fall to Winter", prefix: "FalltoWint" },
  { from: "winter", to: "spring", folder: "Winter to Spring", prefix: "WinttoSpring" },
];

/**
 * Play-once transition frames from → to, then settle on the new season's idle
 * frame 1. Only consecutive seasons have art.
 */
export const seasonTransition: Partial<Record<Season, Partial<Record<Season, readonly string[]>>>> = {
  spring: {
    summer: [springToSum1, springToSum2, springToSum3, springToSum4, springToSum5],
  },
  summer: {
    autumn: [sumToFall1, sumToFall2, sumToFall3, sumToFall4, sumToFall5],
  },
  autumn: {
    winter: [fallToWint1, fallToWint2, fallToWint3, fallToWint4, fallToWint5],
  },
  winter: {
    spring: [wintToSpring1, wintToSpring2, wintToSpring3, wintToSpring4, wintToSpring5],
  },
};

export function seasonTransitionFrames(from: Season, to: Season): readonly string[] {
  return seasonTransition[from]?.[to] ?? [];
}

/** One frame of the reel. Out-of-range indices return undefined — never clamp an idle 0–7 onto the last frame. */
export function seasonTransitionFrame(from: Season, to: Season, frameIndex: number): string | undefined {
  const frames = seasonTransitionFrames(from, to);
  if (frameIndex < 0 || frameIndex >= frames.length) return undefined;
  return frames[frameIndex];
}

/** Matching consecutive reel to decode while the old season idle is looping. */
export function transitionReelFor(from: Season): { from: Season; to: Season } | null {
  const pair = SEASON_TRANSITION_ART.find((p) => p.from === from);
  return pair ? { from: pair.from, to: pair.to } : null;
}

function preloadOneImage(src: string): Promise<void> {
  if (typeof Image === "undefined") return Promise.resolve();
  const img = new Image();
  img.src = src;
  if (typeof img.decode === "function") {
    return img.decode().then(
      () => undefined,
      () => undefined,
    );
  }
  return new Promise((resolve) => {
    img.onload = () => resolve();
    img.onerror = () => resolve();
  });
}

/** Decode frames now (during the Advance wait) so the first transition paint is not a blank/stutter. */
export function preloadSeasonImages(srcs: readonly string[]): Promise<void> {
  return Promise.all(srcs.map((src) => preloadOneImage(src))).then(() => undefined);
}

/** Advance one transition frame. Null when the one-shot reel has finished (does not loop). */
export function nextTransitionFrameIndex(index: number, count = SEASON_TRANSITION_FRAME_COUNT): number | null {
  const next = index + 1;
  return next < count ? next : null;
}

export type SeasonTransitionPlay = {
  from: Season;
  to: Season;
};

/** After Advance writes the new season, start the matching reel if art exists. */
export function beginSeasonTransition(from: Season, to: Season): SeasonTransitionPlay | null {
  if (from === to) return null;
  return seasonTransitionFrames(from, to).length > 0 ? { from, to } : null;
}

export function endSeasonTransition(): null {
  return null;
}

export type SeasonHeaderView = {
  displaySeason: Season;
  frameIndex: number;
  animating: boolean;
};

/** Idle: frame 1 of the current season. Looping: idle index of the old season. Transition uses its own index. */
export function seasonHeaderView(
  currentSeason: Season,
  loopingSeason: Season | null,
  idleFrameIndex: number,
  transition: SeasonTransitionPlay | null = null,
  transitionFrameIndex = 0,
  transitionReady = true,
): SeasonHeaderView {
  if (loopingSeason) {
    return { displaySeason: loopingSeason, frameIndex: idleFrameIndex, animating: true };
  }
  if (transition && seasonTransitionFrames(transition.from, transition.to).length > 0) {
    if (!transitionReady) {
      return { displaySeason: transition.from, frameIndex: idleFrameIndex, animating: true };
    }
    return { displaySeason: currentSeason, frameIndex: transitionFrameIndex, animating: true };
  }
  return { displaySeason: currentSeason, frameIndex: 0, animating: false };
}

/**
 * Looping uses `idleFrameIndex` only. Transition uses `transitionFrameIndex` only
 * (defaults to 0). A leftover idle 0–7 must not pick a transition frame.
 */
export function seasonHeaderSrc(
  currentSeason: Season,
  loopingSeason: Season | null,
  idleFrameIndex: number,
  transition: SeasonTransitionPlay | null = null,
  transitionFrameIndex = 0,
  transitionReady = true,
): string {
  if (loopingSeason) {
    return seasonIdleFrame(loopingSeason, idleFrameIndex);
  }
  if (transition) {
    if (!transitionReady) {
      return seasonIdleFrame(transition.from, idleFrameIndex);
    }
    const transitionSrc = seasonTransitionFrame(transition.from, transition.to, transitionFrameIndex);
    if (transitionSrc) return transitionSrc;
    return seasonIdleFrame(currentSeason, 0);
  }
  return seasonIdleFrame(currentSeason, 0);
}

export function beginSeasonAdvanceLoop(currentSeason: Season): Season {
  return currentSeason;
}

export function endSeasonAdvanceLoop(): null {
  return null;
}

export { SEASONS };
