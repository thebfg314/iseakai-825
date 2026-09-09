import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Season } from "../engine/schema";
import {
  SEASON_FRAME_INSET,
  SEASON_IDLE_CANVAS_HEIGHT,
  SEASON_IDLE_CANVAS_WIDTH,
  SEASON_IDLE_FRAME_COUNT,
  SEASON_IDLE_FRAME_MS,
  SEASON_IDLE_FPS,
  SEASON_TIMBER_FRAME,
  SEASON_TRANSITION_ART,
  SEASON_TRANSITION_FRAME_COUNT,
  SEASON_TRANSITION_FRAME_MS,
  SEASON_TRANSITION_FPS,
  SEASONS,
  beginSeasonAdvanceLoop,
  beginSeasonTransition,
  endSeasonAdvanceLoop,
  endSeasonTransition,
  nextIdleFrameIndex,
  nextTransitionFrameIndex,
  wrapIdleFrameIndex,
  seasonArtFolder,
  seasonArtPrefix,
  seasonFrameIdleBoxStyle,
  seasonHeaderSrc,
  seasonHeaderView,
  seasonIdleFrame,
  seasonIdleFrames,
  seasonTransitionFrame,
  seasonTransitionFrames,
  preloadSeasonImages,
  transitionReelFor,
} from "./seasonAnim";

const FOLDER: Record<Season, string> = {
  spring: "Spring Idle",
  summer: "Summer idle",
  autumn: "Fall Idle",
  winter: "Winter Idle",
};

const PREFIX: Record<Season, string> = {
  spring: "Spring",
  summer: "Summer",
  autumn: "Fall",
  winter: "Winter",
};

describe("season idle art mapping", () => {
  it("maps game seasons onto Anim sprites folders (autumn → Fall, Summer idle lowercase)", () => {
    for (const season of SEASONS) {
      expect(seasonArtFolder(season)).toBe(FOLDER[season]);
      expect(seasonArtPrefix(season)).toBe(PREFIX[season]);
    }
    expect(seasonArtFolder("autumn")).toBe("Fall Idle");
    expect(seasonArtPrefix("autumn")).toBe("Fall");
    expect(seasonArtFolder("summer")).toBe("Summer idle");
  });

  it("has eight idle frames per season and Vite-bundled paths include the expected files", () => {
    for (const season of SEASONS) {
      const frames = seasonIdleFrames(season);
      expect(frames).toHaveLength(SEASON_IDLE_FRAME_COUNT);
      expect(frames).toHaveLength(8);
      frames.forEach((src, i) => {
        expect(src).toContain(`${FOLDER[season]}/${PREFIX[season]} ${i + 1}.jpg`);
      });
    }
  });

  it("keeps every idle JPEG on the same 3168×1344 canvas", () => {
    expect(SEASON_IDLE_CANVAS_WIDTH).toBe(3168);
    expect(SEASON_IDLE_CANVAS_HEIGHT).toBe(1344);
    const root = resolve(process.cwd(), "art assets/Anim sprites");
    for (const season of SEASONS) {
      for (let i = 1; i <= SEASON_IDLE_FRAME_COUNT; i++) {
        const file = resolve(root, FOLDER[season], `${PREFIX[season]} ${i}.jpg`);
        const size = jpegSize(readFileSync(file));
        expect(size, file).toEqual({ w: 3168, h: 1344 });
      }
    }
  });

  it("uses 4 fps (250ms per frame)", () => {
    expect(SEASON_IDLE_FPS).toBe(4);
    expect(SEASON_IDLE_FRAME_MS).toBe(250);
  });

  it("wraps the idle loop 1→8→1", () => {
    expect(wrapIdleFrameIndex(0)).toBe(0);
    expect(wrapIdleFrameIndex(7)).toBe(7);
    expect(wrapIdleFrameIndex(8)).toBe(0);
    expect(nextIdleFrameIndex(0)).toBe(1);
    expect(nextIdleFrameIndex(6)).toBe(7);
    expect(nextIdleFrameIndex(7)).toBe(0);
    expect(seasonIdleFrame("spring", 0)).toContain("Spring 1.jpg");
    expect(seasonIdleFrame("spring", 7)).toContain("Spring 8.jpg");
    expect(seasonIdleFrame("spring", 8)).toContain("Spring 1.jpg");
  });
});

describe("season header idle vs advance", () => {
  it("idle shows frame 1 of the current season", () => {
    expect(seasonHeaderView("spring", null, 4)).toEqual({
      displaySeason: "spring",
      frameIndex: 0,
      animating: false,
    });
    expect(seasonHeaderSrc("spring", null, 4)).toContain("Spring 1.jpg");
    expect(seasonHeaderSrc("autumn", null, 0)).toContain("Fall 1.jpg");
  });

  it("advancing loops the old season then settles on the new season's frame 1", () => {
    const current: Season = "spring";
    let looping: Season | null = beginSeasonAdvanceLoop(current);
    expect(looping).toBe("spring");
    expect(seasonHeaderView(current, looping, 3)).toEqual({
      displaySeason: "spring",
      frameIndex: 3,
      animating: true,
    });
    expect(seasonHeaderSrc(current, looping, 3)).toContain("Spring 4.jpg");

    const next: Season = "summer";
    looping = endSeasonAdvanceLoop();
    expect(looping).toBeNull();
    expect(seasonHeaderView(next, looping, 3)).toEqual({
      displaySeason: "summer",
      frameIndex: 0,
      animating: false,
    });
    expect(seasonHeaderSrc(next, looping, 3)).toContain("Summer 1.jpg");
  });

  it("keeps the still-current season's frame 1 if advance fails", () => {
    const current: Season = "winter";
    let looping: Season | null = beginSeasonAdvanceLoop(current);
    expect(seasonHeaderSrc(current, looping, 5)).toContain("Winter 6.jpg");
    looping = endSeasonAdvanceLoop();
    expect(seasonHeaderSrc(current, looping, 5)).toContain("Winter 1.jpg");
  });
});

describe("season timber frame overlay", () => {
  it("bundles the overlay PNG and sizes the idle box to the inner opening", () => {
    expect(SEASON_TIMBER_FRAME).toContain("season-timber-frame.png");
    const innerW = 1 - SEASON_FRAME_INSET.left - SEASON_FRAME_INSET.right;
    const innerH = 1 - SEASON_FRAME_INSET.top - SEASON_FRAME_INSET.bottom;
    expect(innerW).toBeGreaterThan(0.7);
    expect(innerH).toBeGreaterThan(0.6);
    expect(SEASON_FRAME_INSET.top).toBeGreaterThan(0.1);
    expect(SEASON_FRAME_INSET.left).toBeGreaterThan(0.05);
    const box = seasonFrameIdleBoxStyle();
    expect(box.top).toBe(`${SEASON_FRAME_INSET.top * 100}%`);
    expect(box.left).toBe(`${SEASON_FRAME_INSET.left * 100}%`);
    expect(box.width).toBe(`${innerW * 100}%`);
    expect(box.height).toBe(`${innerH * 100}%`);
  });
});

describe("season transition reels", () => {
  it("maps consecutive seasons onto the 5-frame transition folders", () => {
    expect(SEASON_TRANSITION_ART).toEqual([
      { from: "spring", to: "summer", folder: "Spring to Summer", prefix: "SpringtoSum" },
      { from: "summer", to: "autumn", folder: "Summer to Fall", prefix: "SumtoFall" },
      { from: "autumn", to: "winter", folder: "Fall to Winter", prefix: "FalltoWint" },
      { from: "winter", to: "spring", folder: "Winter to Spring", prefix: "WinttoSpring" },
    ]);
    const root = resolve(process.cwd(), "art assets/Anim sprites");
    for (const { from, to, folder, prefix } of SEASON_TRANSITION_ART) {
      const frames = seasonTransitionFrames(from, to);
      expect(frames).toHaveLength(SEASON_TRANSITION_FRAME_COUNT);
      expect(frames).toHaveLength(5);
      frames.forEach((src, i) => {
        expect(src).toContain(`${folder}/${prefix} ${i + 1}.jpg`);
        const file = resolve(root, folder, `${prefix} ${i + 1}.jpg`);
        expect(jpegSize(readFileSync(file))).toEqual({ w: SEASON_IDLE_CANVAS_WIDTH, h: SEASON_IDLE_CANVAS_HEIGHT });
      });
    }
    expect(seasonTransitionFrames("spring", "autumn")).toEqual([]);
    expect(seasonTransitionFrames("summer", "summer")).toEqual([]);
    expect(beginSeasonTransition("spring", "spring")).toBeNull();
  });

  it("uses 4 fps (250ms per frame) and does not loop", () => {
    expect(SEASON_TRANSITION_FPS).toBe(4);
    expect(SEASON_TRANSITION_FRAME_MS).toBe(250);
    expect(nextTransitionFrameIndex(0)).toBe(1);
    expect(nextTransitionFrameIndex(3)).toBe(4);
    expect(nextTransitionFrameIndex(4)).toBeNull();
    expect(nextTransitionFrameIndex(4)).not.toBe(0);
  });

  it("keeps looping the old idle while Advance is busy, even if a transition is queued", () => {
    const leftover = beginSeasonTransition("spring", "summer");
    expect(seasonHeaderSrc("summer", "spring", 2, leftover)).toContain("Spring 3.jpg");
  });

  it("plays the matching reel once after Advance, then settles on the new idle frame 1", () => {
    const from: Season = "spring";
    const to: Season = "summer";
    let looping: Season | null = beginSeasonAdvanceLoop(from);
    expect(seasonHeaderSrc(from, looping, 3)).toContain("Spring 4.jpg");

    looping = endSeasonAdvanceLoop();
    let transition = beginSeasonTransition(from, to);
    expect(transition).toEqual({ from, to });
    expect(seasonHeaderView(to, looping, 0, transition)).toEqual({
      displaySeason: "summer",
      frameIndex: 0,
      animating: true,
    });
    expect(seasonHeaderSrc(to, looping, 0, transition)).toContain("Spring to Summer/SpringtoSum 1.jpg");
    expect(seasonHeaderSrc(to, looping, 0, transition, 4)).toContain("Spring to Summer/SpringtoSum 5.jpg");

    const frames = seasonTransitionFrames(from, to);
    let frame = 0;
    const seen = [frames[frame]];
    while (true) {
      const next = nextTransitionFrameIndex(frame, frames.length);
      if (next === null) break;
      frame = next;
      seen.push(frames[frame]);
    }
    expect(seen).toHaveLength(5);
    expect(seen[0]).toContain("SpringtoSum 1.jpg");
    expect(seen[4]).toContain("SpringtoSum 5.jpg");
    expect(nextTransitionFrameIndex(frame, frames.length)).toBeNull();

    transition = endSeasonTransition();
    expect(seasonHeaderView(to, looping, 4, transition)).toEqual({
      displaySeason: "summer",
      frameIndex: 0,
      animating: false,
    });
    expect(seasonHeaderSrc(to, looping, 4, transition)).toContain("Summer 1.jpg");
  });

  it("covers summer→autumn, autumn→winter, and winter→spring then idle frame 1", () => {
    const steps: [Season, Season, string, string][] = [
      ["summer", "autumn", "Summer to Fall/SumtoFall 1.jpg", "Fall 1.jpg"],
      ["autumn", "winter", "Fall to Winter/FalltoWint 3.jpg", "Winter 1.jpg"],
      ["winter", "spring", "Winter to Spring/WinttoSpring 5.jpg", "Spring 1.jpg"],
    ];
    for (const [from, to, mid, idle] of steps) {
      const looping = endSeasonAdvanceLoop();
      const transition = beginSeasonTransition(from, to);
      expect(transition).toEqual({ from, to });
      const frameIndex = mid.includes("3.jpg") ? 2 : mid.includes("5.jpg") ? 4 : 0;
      expect(seasonHeaderSrc(to, looping, 0, transition, frameIndex)).toContain(mid);
      expect(seasonHeaderSrc(to, null, 0, endSeasonTransition())).toContain(idle);
    }
  });

  it("skips the reel if Advance fails and keeps the still-current season's frame 1", () => {
    const current: Season = "winter";
    let looping: Season | null = beginSeasonAdvanceLoop(current);
    expect(seasonHeaderSrc(current, looping, 5)).toContain("Winter 6.jpg");
    looping = endSeasonAdvanceLoop();
    const transition = beginSeasonTransition(current, current);
    expect(transition).toBeNull();
    expect(seasonHeaderSrc(current, looping, 5, transition)).toContain("Winter 1.jpg");
  });

  it("presents transition index 0 on first view after looping index 7 (no last-frame flash)", () => {
    for (const { from, to, folder, prefix } of SEASON_TRANSITION_ART) {
      expect(transitionReelFor(from)).toEqual({ from, to });
      const leftoverIdle = 7;
      expect(seasonHeaderSrc(from, from, leftoverIdle)).toMatch(new RegExp(`${PREFIX[from]} 8\\.jpg`));
      expect(seasonTransitionFrame(from, to, leftoverIdle)).toBeUndefined();
      expect(seasonTransitionFrame(from, to, 5)).toBeUndefined();
      expect(seasonTransitionFrame(from, to, 4)).toContain(`${prefix} 5.jpg`);

      const transition = beginSeasonTransition(from, to);
      expect(transition).toEqual({ from, to });
      const first = seasonHeaderSrc(to, null, leftoverIdle, transition);
      expect(first, `${from}→${to}`).toContain(`${folder}/${prefix} 1.jpg`);
      expect(first).not.toContain(`${prefix} 5.jpg`);
      expect(seasonHeaderView(to, null, leftoverIdle, transition)).toEqual({
        displaySeason: to,
        frameIndex: 0,
        animating: true,
      });
    }
  });

  it("holds the last idle frame until the transition reel is ready", () => {
    const transition = beginSeasonTransition("spring", "summer");
    expect(seasonHeaderSrc("summer", null, 7, transition, 0, false)).toContain("Spring 8.jpg");
    expect(seasonHeaderSrc("summer", null, 7, transition, 0, true)).toContain("SpringtoSum 1.jpg");
  });

  it("preloads srcs without throwing when Image is unavailable", async () => {
    await expect(preloadSeasonImages(seasonTransitionFrames("spring", "summer"))).resolves.toBeUndefined();
  });
});

function jpegSize(buf: Buffer): { w: number; h: number } {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
    }
    if (i + 3 >= buf.length) break;
    const len = buf.readUInt16BE(i + 2);
    i += 2 + len;
  }
  throw new Error("JPEG SOF not found");
}
