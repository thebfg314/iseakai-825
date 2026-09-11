import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  WAITING_CANVAS_HEIGHT,
  WAITING_CANVAS_WIDTH,
  WAITING_FRAME_COUNT,
  WAITING_FRAME_MS,
  WAITING_FPS,
  WAITING_HOLD_FRAME_INDEX,
  WAITING_HOLD_MS,
  nextWaitingFrameIndex,
  preloadWaitingImages,
  waitingFrame,
  waitingFrameDurationMs,
  waitingFrames,
  wrapWaitingFrameIndex,
} from "./waitingAnim";

describe("speak waiting reel", () => {
  it("has twelve frames in order waiting 1.png … waiting 12.png", () => {
    const frames = waitingFrames();
    expect(frames).toHaveLength(WAITING_FRAME_COUNT);
    expect(frames).toHaveLength(12);
    frames.forEach((src, i) => {
      expect(src).toContain(`waiting/waiting ${i + 1}.png`);
    });
    expect(waitingFrame(0)).toContain("waiting 1.png");
    expect(waitingFrame(10)).toContain("waiting 11.png");
    expect(waitingFrame(11)).toContain("waiting 12.png");
  });

  it("keeps every waiting PNG on the same 2128×912 (~21∶9) canvas", () => {
    expect(WAITING_CANVAS_WIDTH).toBe(2128);
    expect(WAITING_CANVAS_HEIGHT).toBe(912);
    expect(WAITING_CANVAS_WIDTH / WAITING_CANVAS_HEIGHT).toBeCloseTo(21 / 9, 5);
    const root = resolve(process.cwd(), "art assets/Anim sprites/waiting");
    for (let i = 1; i <= WAITING_FRAME_COUNT; i++) {
      const file = resolve(root, `waiting ${i}.png`);
      expect(pngSize(readFileSync(file)), file).toEqual({ w: 2128, h: 912 });
    }
  });

  it("uses 4 fps (250ms) for frames other than the hold, and 1000ms on index 11", () => {
    expect(WAITING_FPS).toBe(4);
    expect(WAITING_FRAME_MS).toBe(250);
    expect(WAITING_HOLD_FRAME_INDEX).toBe(11);
    expect(WAITING_HOLD_MS).toBe(1000);
    for (let i = 0; i < 11; i++) {
      expect(waitingFrameDurationMs(i), `frame ${i}`).toBe(250);
    }
    expect(waitingFrameDurationMs(11)).toBe(1000);
    expect(waitingFrameDurationMs(11 + 12)).toBe(1000);
  });

  it("wraps the loop 1→12→1 after the hold", () => {
    expect(wrapWaitingFrameIndex(0)).toBe(0);
    expect(wrapWaitingFrameIndex(11)).toBe(11);
    expect(wrapWaitingFrameIndex(12)).toBe(0);
    expect(nextWaitingFrameIndex(0)).toBe(1);
    expect(nextWaitingFrameIndex(10)).toBe(11);
    expect(nextWaitingFrameIndex(11)).toBe(0);
    expect(waitingFrame(12)).toContain("waiting 1.png");

    const seen: { index: number; ms: number }[] = [];
    let index = 0;
    for (let step = 0; step < WAITING_FRAME_COUNT; step++) {
      seen.push({ index, ms: waitingFrameDurationMs(index) });
      index = nextWaitingFrameIndex(index);
    }
    expect(seen.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(seen.map((s) => s.ms)).toEqual([250, 250, 250, 250, 250, 250, 250, 250, 250, 250, 250, 1000]);
    expect(index).toBe(0);
    expect(waitingFrameDurationMs(index)).toBe(250);
  });

  it("preloads srcs without throwing when Image is unavailable", async () => {
    await expect(preloadWaitingImages(waitingFrames())).resolves.toBeUndefined();
  });

  it("paints the Speak button solid black while waiting so transparent frames are not muddy on brown", () => {
    const css = readFileSync(resolve(process.cwd(), "src/ui/styles.css"), "utf8");
    const rules = [...css.matchAll(/([^{]+)\{([^}]+)\}/g)].map((m) => ({
      selector: m[1].replace(/\s+/g, " ").trim(),
      body: m[2],
    }));
    const waitingFill = rules.filter(
      (r) =>
        r.selector.includes("speak-submit.speak-waiting") &&
        !r.selector.includes("speak-label") &&
        !r.selector.includes("reel"),
    );
    expect(waitingFill.some((r) => r.selector.includes(":disabled"))).toBe(true);
    for (const rule of waitingFill) {
      expect(rule.body, rule.selector).toMatch(/background(?:-color)?:\s*#000(?:000)?\b/i);
      expect(rule.body, rule.selector).toMatch(/opacity:\s*1\b/);
    }
    expect(css).toMatch(/button\.primary\s*\{[^}]*background:\s*#5c3d1e/);
    expect(css).not.toMatch(/Advance season[\s\S]{0,80}speak-waiting/);
  });
});

function pngSize(buf: Buffer): { w: number; h: number } {
  if (buf.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("PNG signature not found");
  }
  if (buf.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("PNG IHDR not found");
  }
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
