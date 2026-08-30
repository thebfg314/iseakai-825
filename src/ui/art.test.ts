import { describe, expect, it } from "vitest";
import { npcPortrait } from "./art";

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
      concerned: "Eberhard Concerned.jpg",
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

  it("still resolves Bernard and Colman the same way", () => {
    expect(npcPortrait("smith", "pleased")).toMatch(/Bernard Happy/);
    expect(npcPortrait("smith", "disappointed")).toMatch(/Bernard Displeased/);
    expect(npcPortrait("quarry_master", "pleased")).toMatch(/Colman Happy/);
    expect(npcPortrait("quarry_master", "disappointed")).toMatch(/Colman Displeased/);
  });
});
