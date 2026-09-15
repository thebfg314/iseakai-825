import { clamp } from "../engine/util";
import { PEOPLE_HAPPINESS_MAX, PEOPLE_HAPPINESS_MIN, PEOPLE_JOYFUL_MIN, PEOPLE_WRETCHED_MAX } from "../engine/peopleHappiness";

/**
 * Inner coloured track on `art assets/UI/happiness-meter.png` (2128×912).
 * Measured on the mid-row fill: left red edge ~535px, right green edge ~1594px.
 * Masks and gold filigree sit outside this span; the arrow tip tracks this band.
 */
export const HAPPINESS_TRACK_LEFT = 0.251;
export const HAPPINESS_TRACK_RIGHT = 0.749;

export const PEOPLE_HAPPINESS_LABEL = "People's happiness";

export function happinessArrowLeftPercent(value: number): number {
  const t = clamp(
    (value - PEOPLE_HAPPINESS_MIN) / (PEOPLE_HAPPINESS_MAX - PEOPLE_HAPPINESS_MIN),
    0,
    1,
  );
  return (HAPPINESS_TRACK_LEFT + t * (HAPPINESS_TRACK_RIGHT - HAPPINESS_TRACK_LEFT)) * 100;
}

/** Hall language for the meter, not engine jargon. */
export function peopleHappinessVoice(value: number): string {
  if (value <= PEOPLE_WRETCHED_MAX) return "The people are wretched";
  if (value <= 44) return "The people are uneasy";
  if (value <= 55) return "The people are settled";
  if (value < PEOPLE_JOYFUL_MIN) return "The people are glad";
  return "The people are joyful";
}
