import waiting1 from "../../art assets/Anim sprites/waiting/waiting 1.png";
import waiting2 from "../../art assets/Anim sprites/waiting/waiting 2.png";
import waiting3 from "../../art assets/Anim sprites/waiting/waiting 3.png";
import waiting4 from "../../art assets/Anim sprites/waiting/waiting 4.png";
import waiting5 from "../../art assets/Anim sprites/waiting/waiting 5.png";
import waiting6 from "../../art assets/Anim sprites/waiting/waiting 6.png";
import waiting7 from "../../art assets/Anim sprites/waiting/waiting 7.png";
import waiting8 from "../../art assets/Anim sprites/waiting/waiting 8.png";
import waiting9 from "../../art assets/Anim sprites/waiting/waiting 9.png";
import waiting10 from "../../art assets/Anim sprites/waiting/waiting 10.png";
import waiting11 from "../../art assets/Anim sprites/waiting/waiting 11.png";
import waiting12 from "../../art assets/Anim sprites/waiting/waiting 12.png";

/** Same cadence as season idle for frames 1–11. */
export const WAITING_FPS = 4;
export const WAITING_FRAME_MS = 1000 / WAITING_FPS;
export const WAITING_FRAME_COUNT = 12;
/** 0-based index of frame 12 — holds before the loop restarts. */
export const WAITING_HOLD_FRAME_INDEX = WAITING_FRAME_COUNT - 1;
export const WAITING_HOLD_MS = 1000;
export const WAITING_CANVAS_WIDTH = 2128;
export const WAITING_CANVAS_HEIGHT = 912;

const WAITING_FRAMES: readonly string[] = [
  waiting1,
  waiting2,
  waiting3,
  waiting4,
  waiting5,
  waiting6,
  waiting7,
  waiting8,
  waiting9,
  waiting10,
  waiting11,
  waiting12,
];

export function waitingFrames(): readonly string[] {
  return WAITING_FRAMES;
}

/** Normalize a 0-based frame index onto the 12-frame waiting reel. */
export function wrapWaitingFrameIndex(index: number, count = WAITING_FRAME_COUNT): number {
  return ((index % count) + count) % count;
}

/** Advance one frame, wrapping 11 → 0 (frames 1→12→1). */
export function nextWaitingFrameIndex(index: number, count = WAITING_FRAME_COUNT): number {
  return wrapWaitingFrameIndex(index + 1, count);
}

export function waitingFrame(frameIndex: number): string {
  const frames = waitingFrames();
  return frames[wrapWaitingFrameIndex(frameIndex, frames.length)];
}

/** Frames 1–11 are 250ms; frame 12 (index 11) holds 1000ms. */
export function waitingFrameDurationMs(frameIndex: number): number {
  return wrapWaitingFrameIndex(frameIndex) === WAITING_HOLD_FRAME_INDEX ? WAITING_HOLD_MS : WAITING_FRAME_MS;
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

/** Decode waiting frames so the first Speak-wait paint is not a blank. */
export function preloadWaitingImages(srcs: readonly string[] = waitingFrames()): Promise<void> {
  return Promise.all(srcs.map((src) => preloadOneImage(src))).then(() => undefined);
}
