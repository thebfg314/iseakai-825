import { describe, expect, it } from "vitest";
import type { Season } from "../engine/schema";
import {
  SEASON_IDLE_FRAME_COUNT,
  SEASON_IDLE_FRAME_MS,
  SEASON_IDLE_FPS,
  SEASONS,
  beginSeasonAdvanceLoop,
  endSeasonAdvanceLoop,
  nextIdleFrameIndex,
  wrapIdleFrameIndex,
  seasonArtFolder,
  seasonArtPrefix,
  seasonHeaderSrc,
  seasonHeaderView,
  seasonIdleFrame,
  seasonIdleFrames,
  seasonTransitionFrames,
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

describe("season transition stub", () => {
  it("returns no frames yet so a later PR can play a reel then idle frame 1", () => {
    for (const from of SEASONS) {
      for (const to of SEASONS) {
        expect(seasonTransitionFrames(from, to)).toEqual([]);
      }
    }
  });
});
