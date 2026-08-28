import titleScreen from "../../art assets/Isekai title screen.png";
import titleMenuBackground from "../../art assets/main  menu background.jpg";
import titleTheme from "../../art assets/Music/The Bard's March.mp3";
import frostOnTheStone from "../../art assets/Music/Frost on the Stone.mp3";
import springOnTheStone from "../../art assets/Music/Spring on the Stone.mp3";
import sunlitSteelAndLute from "../../art assets/Music/Sunlit Steel and Lute.mp3";
import harvestsGoldenSong from "../../art assets/Music/The Harvest's Golden Song.mp3";
import theQuietMarch from "../../art assets/Music/The Quiet March.mp3";
import buttonClick from "../../art assets/Sound fx/ui-click.wav";

import aldricNeutral from "../../art assets/NPC Images/Aldrec Steward/Aldric neutral nobg.png";
import aldricRespectful from "../../art assets/NPC Images/Aldrec Steward/Aldrec respectful nobg.png";
import aldricConcerned from "../../art assets/NPC Images/Aldrec Steward/Aldric  concerned nobg.png";
import aldricAlarmed from "../../art assets/NPC Images/Aldrec Steward/Aldric alarmed nobg.png";
import aldricDisappointed from "../../art assets/NPC Images/Aldrec Steward/Aldric disappointed nobg.png";
import aldricExhausted from "../../art assets/NPC Images/Aldrec Steward/Aldric exhausted.png";
import aldricPleased from "../../art assets/NPC Images/Aldrec Steward/Aldric pleased nobg.png";
import aldricThoughtful from "../../art assets/NPC Images/Aldrec Steward/Aldric thoughtful nobg.png";
import aldricFallback from "../../art assets/NPC Images/Aldrec Steward/Aldric nobg.png";

import bernardNeutral from "../../art assets/NPC Images/Bernard Blacksmith/Bernard Neutral.png";
import bernardConcerned from "../../art assets/NPC Images/Bernard Blacksmith/Bernard Concerned.png";
import bernardDispleased from "../../art assets/NPC Images/Bernard Blacksmith/Bernard Displeased.png";
import bernardHappy from "../../art assets/NPC Images/Bernard Blacksmith/Bernard Happy.png";
import bernardThoughtful from "../../art assets/NPC Images/Bernard Blacksmith/Bernard thoughtful.png";

import ermenaldNeutral from "../../art assets/NPC Images/Ermenald Priest/Ermenald Neutral .png";
import ermenaldConcerned from "../../art assets/NPC Images/Ermenald Priest/Ermenald Concerned.png";
import ermenaldDispleased from "../../art assets/NPC Images/Ermenald Priest/Ermenald Displeased.png";
import ermenaldHappy from "../../art assets/NPC Images/Ermenald Priest/Ermenald Happy.png";
import ermenaldThoughtful from "../../art assets/NPC Images/Ermenald Priest/Ermenald Thoughtful.png";

import merchant1 from "../../art assets/NPC Images/Merchants/Merchant 1.png";
import merchant2 from "../../art assets/NPC Images/Merchants/Merchant 2.png";
import merchant3 from "../../art assets/NPC Images/Merchants/Merchant 3.png";
import merchant4 from "../../art assets/NPC Images/Merchants/Merchant 4.png";
import merchant5 from "../../art assets/NPC Images/Merchants/Merchant 5.png";
import merchant6 from "../../art assets/NPC Images/Merchants/Merchant 6.png";
import merchant7 from "../../art assets/NPC Images/Merchants/Merchant 7.png";
import merchant8 from "../../art assets/NPC Images/Merchants/Merchant 8.png";

import type { AldricEmotion } from "../engine/emotion";

export const TITLE_SCREEN = titleScreen;
export const TITLE_MENU_BACKGROUND = titleMenuBackground;
export const TITLE_THEME = titleTheme;
export const BUTTON_CLICK = buttonClick;
export const GAME_THEMES = [
  titleTheme,
  frostOnTheStone,
  springOnTheStone,
  sunlitSteelAndLute,
  harvestsGoldenSong,
  theQuietMarch,
];

const ALDRIC: Record<AldricEmotion, string> = {
  neutral: aldricNeutral,
  respectful: aldricRespectful,
  concerned: aldricConcerned,
  alarmed: aldricAlarmed,
  disappointed: aldricDisappointed,
  exhausted: aldricExhausted,
  pleased: aldricPleased,
  thoughtful: aldricThoughtful,
};

type SparsePose = "neutral" | "concerned" | "disappointed" | "pleased" | "thoughtful";

const SPARSE_FROM_EMOTION: Record<AldricEmotion, SparsePose> = {
  neutral: "neutral",
  respectful: "neutral",
  concerned: "concerned",
  alarmed: "concerned",
  disappointed: "disappointed",
  exhausted: "disappointed",
  pleased: "pleased",
  thoughtful: "thoughtful",
};

const BERNARD: Record<SparsePose, string> = {
  neutral: bernardNeutral,
  concerned: bernardConcerned,
  disappointed: bernardDispleased,
  pleased: bernardHappy,
  thoughtful: bernardThoughtful,
};

const ERMENALD: Record<SparsePose, string> = {
  neutral: ermenaldNeutral,
  concerned: ermenaldConcerned,
  disappointed: ermenaldDispleased,
  pleased: ermenaldHappy,
  thoughtful: ermenaldThoughtful,
};

const MERCHANT_FACES: Record<number, string> = {
  1: merchant1,
  2: merchant2,
  3: merchant3,
  4: merchant4,
  5: merchant5,
  6: merchant6,
  7: merchant7,
  8: merchant8,
};

function sparsePortrait(table: Record<SparsePose, string>, emotion: AldricEmotion | undefined): string {
  const pose = emotion ? SPARSE_FROM_EMOTION[emotion] : "neutral";
  return table[pose] ?? table.neutral;
}

export function aldricPortrait(emotion: AldricEmotion | undefined): string {
  if (!emotion) return aldricFallback;
  return ALDRIC[emotion] ?? aldricFallback;
}

export function npcPortrait(npcId: string, emotion: AldricEmotion | undefined, face?: number): string | undefined {
  if (npcId === "steward") return aldricPortrait(emotion);
  if (npcId === "smith") return sparsePortrait(BERNARD, emotion);
  if (npcId === "chaplain") return sparsePortrait(ERMENALD, emotion);
  if (npcId === "merchant") return face != null ? MERCHANT_FACES[face] : undefined;
  return undefined;
}
