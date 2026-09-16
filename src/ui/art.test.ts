import { describe, expect, it } from "vitest";
import {
  BUTTON_CLICK,
  COINS,
  GAME_OVER_THEME,
  HALL_HORN,
  HAPPINESS_ARROW,
  HAPPINESS_METER,
  npcPortrait,
  NPC_WANTS_TALK,
  PEN_CONFIRM,
  SEASON_FANFARE,
} from "./art";

const EXPANSION: { id: string; files: Record<string, string> }[] = [
  {
    id: "village_reeve",
    files: {
      neutral: "Otto Neutral.png",
      concerned: "Otto Concerned.png",
      disappointed: "Otto Displeased.png",
      pleased: "Otto Happy.png",
      thoughtful: "Otto Thoughtful.png",
    },
  },
  {
    id: "vinedresser",
    files: {
      neutral: "ambrosius Neutral.png",
      concerned: "Ambrosius Concerned.png",
      disappointed: "Ambrosius Displeased.png",
      pleased: "Ambrosius Happy.png",
      thoughtful: "Ambrosius Thoughful.png",
    },
  },
  {
    id: "head_seamstress",
    files: {
      neutral: "Hildegard  Neutral.png",
      concerned: "Hildegard Concerned.png",
      disappointed: "Hildegard Displeased.png",
      pleased: "Hildegard Happy.png",
      thoughtful: "Hildegard Thoughtful.png",
    },
  },
  {
    id: "copper_smith",
    files: {
      neutral: "Lorenzo Neutral.png",
      concerned: "Lorenzo Concerned.png",
      disappointed: "Lorenzo displeased.png",
      pleased: "Lorenzo Happy.png",
      thoughtful: "Lorenzo Thoightful.png",
    },
  },
  {
    id: "captain",
    files: {
      neutral: "Eberhard Neutral.png",
      concerned: "Eberhard Concerned.png",
      disappointed: "Eberhard Displeased.png",
      pleased: "Eberhard Happy.png",
      thoughtful: "Eberhard Thoughtful .png",
    },
  },
];

describe("expansion NPC portraits", () => {
  it("resolves Happy as pleased and Displeased as disappointed, including typo filenames", () => {
    for (const row of EXPANSION) {
      expect(npcPortrait(row.id, "neutral")).toContain(row.files.neutral);
      expect(npcPortrait(row.id, "concerned")).toContain(row.files.concerned);
      expect(npcPortrait(row.id, "alarmed")).toContain(row.files.concerned);
      expect(npcPortrait(row.id, "disappointed")).toContain(row.files.disappointed);
      expect(npcPortrait(row.id, "pleased")).toContain(row.files.pleased);
      expect(npcPortrait(row.id, "thoughtful")).toContain(row.files.thoughtful);
      expect(npcPortrait(row.id, undefined)).toContain(row.files.neutral);
    }
  });

  it("still resolves Bernard, Gerulf, and Gerold the same way", () => {
    expect(npcPortrait("smith", "pleased")).toMatch(/Bernard Happy/);
    expect(npcPortrait("smith", "disappointed")).toMatch(/Bernard Displeased/);
    expect(npcPortrait("negotiator", "neutral")).toMatch(/Gerulf Neutral/);
    expect(npcPortrait("negotiator", "pleased")).toMatch(/Gerulf Happy/);
    expect(npcPortrait("negotiator", "disappointed")).toMatch(/Gerulf Displeased/);
    expect(npcPortrait("negotiator", "thoughtful")).toMatch(/Gerulf Thoughtful/);
    expect(npcPortrait("negotiator", "concerned")).toMatch(/Gerulf Concerned/);
    expect(npcPortrait("mason", "pleased")).toMatch(/Gerold Happy\.jpg/);
    expect(npcPortrait("mason", "disappointed")).toMatch(/Gerold Displeased\.jpg/);
    expect(npcPortrait("mason", "neutral")).toMatch(/Gerold Neutral\.jpg/);
    expect(npcPortrait("quarry_master", "pleased")).toMatch(/Colman Happy/);
    expect(npcPortrait("quarry_master", "disappointed")).toMatch(/Colman Displeased/);
  });
});

const MERCHANT_FACE_FILES = [
  [1, "Gero.png"],
  [2, "Odo.png"],
  [3, "Liutward.png"],
  [4, "Theudo.png"],
  [5, "Boso.png"],
  [6, "Isaac.png"],
  [7, "Salamon.png"],
  [8, "Wichard.png"],
] as const;

describe("merchant portraits", () => {
  it.each(MERCHANT_FACE_FILES)("face %s resolves to %s", (face, file) => {
    expect(npcPortrait("merchant", "neutral", face)).toContain(file);
  });
});

describe("wants-talk tab badge", () => {
  it("points at the UI icon", () => {
    expect(NPC_WANTS_TALK).toMatch(/npc-wants-talk\.png/);
  });
});

describe("sfx pack art", () => {
  it("points at the packed click, pen, fanfare, horn, coins, and game-over cues", () => {
    expect(BUTTON_CLICK).toMatch(/ui-click\.mp3/);
    expect(PEN_CONFIRM).toMatch(/pen-confirm\.mp3/);
    expect(SEASON_FANFARE).toMatch(/season-fanfare\.wav/);
    expect(HALL_HORN).toMatch(/hall-horn\.mp3/);
    expect(COINS).toMatch(/coins\.wav/);
    expect(GAME_OVER_THEME).toMatch(/game-over\.mp3/);
  });
});

describe("people's happiness meter art", () => {
  it("points at the meter and arrow UI files", () => {
    expect(HAPPINESS_METER).toMatch(/happiness-meter\.png/);
    expect(HAPPINESS_ARROW).toMatch(/happiness-arrow\.png/);
  });
});
