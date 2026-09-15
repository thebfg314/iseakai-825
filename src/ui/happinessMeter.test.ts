import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HappinessMeter } from "./HappinessMeter";
import { HAPPINESS_ARROW, HAPPINESS_METER } from "./art";
import {
  HAPPINESS_TRACK_LEFT,
  HAPPINESS_TRACK_RIGHT,
  happinessArrowLeftPercent,
  PEOPLE_HAPPINESS_LABEL,
  peopleHappinessVoice,
} from "./happinessMeter";

function pngSize(buf: Buffer): { w: number; h: number } {
  if (buf.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("PNG signature not found");
  }
  if (buf.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("PNG IHDR not found");
  }
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

describe("happiness arrow mapping", () => {
  it("puts min on the red, mid in the white, max on the green", () => {
    expect(happinessArrowLeftPercent(0)).toBeCloseTo(HAPPINESS_TRACK_LEFT * 100, 5);
    expect(happinessArrowLeftPercent(50)).toBeCloseTo(50, 5);
    expect(happinessArrowLeftPercent(100)).toBeCloseTo(HAPPINESS_TRACK_RIGHT * 100, 5);
    expect(happinessArrowLeftPercent(-10)).toBeCloseTo(HAPPINESS_TRACK_LEFT * 100, 5);
    expect(happinessArrowLeftPercent(140)).toBeCloseTo(HAPPINESS_TRACK_RIGHT * 100, 5);
  });

  it("speaks hall language, not engine jargon", () => {
    expect(peopleHappinessVoice(8)).toMatch(/wretched/i);
    expect(peopleHappinessVoice(50)).toMatch(/settled/i);
    expect(peopleHappinessVoice(90)).toMatch(/joyful/i);
    expect(PEOPLE_HAPPINESS_LABEL).toBe("People's happiness");
    expect(PEOPLE_HAPPINESS_LABEL).not.toMatch(/peopleHappiness|moodFactor|moodDelta/i);
  });
});

describe("happiness meter art", () => {
  it("points at the UI meter and upward arrow PNGs", () => {
    expect(HAPPINESS_METER).toMatch(/happiness-meter\.png/);
    expect(HAPPINESS_ARROW).toMatch(/happiness-arrow\.png/);
    expect(pngSize(readFileSync(resolve(process.cwd(), "art assets/UI/happiness-meter.png")))).toEqual({
      w: 2128,
      h: 912,
    });
    expect(pngSize(readFileSync(resolve(process.cwd(), "art assets/UI/happiness-arrow.png")))).toEqual({
      w: 130,
      h: 462,
    });
  });
});

describe("happiness meter markup", () => {
  it("exposes an accessible people's happiness meter and places the arrow", () => {
    const html = renderToStaticMarkup(createElement(HappinessMeter, { value: 20 }));
    expect(html).toContain('role="meter"');
    expect(html).toContain("People's happiness");
    expect(html).toContain(`left:${happinessArrowLeftPercent(20)}%`);
    expect(html).not.toContain("peopleHappiness");
    const high = renderToStaticMarkup(createElement(HappinessMeter, { value: 90 }));
    expect(high).toContain(`left:${happinessArrowLeftPercent(90)}%`);
    expect(happinessArrowLeftPercent(90)).toBeGreaterThan(happinessArrowLeftPercent(20));
  });
});
