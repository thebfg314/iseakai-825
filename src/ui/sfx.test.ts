import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { labourPool, labourRemaining } from "../engine/labour";
import { WorldStateSchema } from "../engine/schema";
import { emptyMeter } from "../llm/usage";
import type { GameView } from "../shared/types";
import {
  BUTTON_CLICK,
  COINS,
  GAME_OVER_THEME,
  HALL_HORN,
  PEN_CONFIRM,
  SEASON_FANFARE,
} from "./art";
import {
  SFX_MASTER_FACTOR,
  advanceSeasonLanded,
  confirmSfx,
  enterGameHorn,
  hallHornDue,
  isMerchantBuySell,
  musicBedFor,
  musicGain,
  seasonAdvanceSfx,
  seasonKey,
  sfxDucksMusic,
  sfxGain,
} from "./sfx";

function viewOf(extra?: (v: GameView) => void): GameView {
  const state = WorldStateSchema.parse(structuredClone(startingEstate));
  const view: GameView = {
    state,
    pending: [],
    messages: [],
    sceneNpcId: "steward",
    labour: { pool: labourPool(state), remaining: labourRemaining(state) },
    smithAvailable: true,
    chaplainAvailable: true,
    merchantAvailable: false,
    sceneEmotion: "neutral",
    historyTail: [],
    llmMeter: emptyMeter("rfab"),
  };
  extra?.(view);
  return view;
}

describe("sfx asset wiring", () => {
  it("points at the packed cues", () => {
    expect(BUTTON_CLICK).toMatch(/ui-click\.mp3/);
    expect(PEN_CONFIRM).toMatch(/pen-confirm\.mp3/);
    expect(SEASON_FANFARE).toMatch(/season-fanfare\.wav/);
    expect(HALL_HORN).toMatch(/hall-horn\.mp3/);
    expect(COINS).toMatch(/coins\.wav/);
    expect(GAME_OVER_THEME).toMatch(/game-over\.mp3/);
  });

  it("keeps the packed files on disk", () => {
    const dir = resolve(process.cwd(), "art assets/Sound fx");
    for (const file of [
      "ui-click.mp3",
      "pen-confirm.mp3",
      "season-fanfare.wav",
      "hall-horn.mp3",
      "coins.wav",
      "game-over.mp3",
    ]) {
      expect(existsSync(resolve(dir, file)), file).toBe(true);
    }
  });
});

describe("volume", () => {
  it("rides master × music for beds and master × 0.6 for one-shots", () => {
    expect(musicGain({ masterVolume: 1, musicVolume: 0.55 })).toBeCloseTo(0.55);
    expect(musicGain({ masterVolume: 0.5, musicVolume: 0.4 })).toBeCloseTo(0.2);
    expect(musicGain({ masterVolume: 2, musicVolume: 1 })).toBe(1);
    expect(sfxGain(1)).toBeCloseTo(SFX_MASTER_FACTOR);
    expect(sfxGain(0.5)).toBeCloseTo(0.3);
    expect(sfxGain(-1)).toBe(0);
  });

  it("ducks music only for season fanfare and hall horn", () => {
    expect(sfxDucksMusic("fanfare")).toBe(true);
    expect(sfxDucksMusic("horn")).toBe(true);
    expect(sfxDucksMusic("click")).toBe(false);
    expect(sfxDucksMusic("pen")).toBe(false);
    expect(sfxDucksMusic("coins")).toBe(false);
    expect(sfxDucksMusic("gameOver")).toBe(false);
  });
});

describe("music bed", () => {
  it("plays title on the title screen even if a leftover abandoned view exists", () => {
    expect(musicBedFor("title", false)).toBe("title");
    expect(musicBedFor("title", true)).toBe("title");
  });

  it("replaces season music on the empty-villa screen", () => {
    expect(musicBedFor("game", false)).toBe("game");
    expect(musicBedFor("game", true)).toBe("gameOver");
  });
});

describe("confirm cues", () => {
  const ok = { state: {} };
  const fail = { state: {}, error: "It cannot be made so." };

  it("plays the pen when Confirm writes the books, not on error", () => {
    expect(confirmSfx({ type: "adjust_sowing" }, ok)).toEqual({ pen: true, coins: false });
    expect(confirmSfx({ type: "settle_households" }, ok)).toEqual({ pen: true, coins: false });
    expect(confirmSfx({ type: "adjust_sowing" }, fail)).toEqual({ pen: false, coins: false });
    expect(confirmSfx({ type: "adjust_sowing" }, null)).toEqual({ pen: false, coins: false });
  });

  it("plays coins only for a merchant buy/sell Confirm that completes", () => {
    expect(isMerchantBuySell({ type: "transfer_resources", direction: "buy" })).toBe(true);
    expect(isMerchantBuySell({ type: "transfer_resources", direction: "sell" })).toBe(true);
    expect(isMerchantBuySell({ type: "transfer_resources", direction: "consume" })).toBe(false);
    expect(confirmSfx({ type: "transfer_resources", direction: "buy" }, ok)).toEqual({
      pen: true,
      coins: true,
    });
    expect(confirmSfx({ type: "transfer_resources", direction: "sell" }, ok)).toEqual({
      pen: true,
      coins: true,
    });
    expect(confirmSfx({ type: "transfer_resources", direction: "buy" }, fail)).toEqual({
      pen: false,
      coins: false,
    });
    expect(confirmSfx({ type: "transfer_resources", direction: "consume" }, ok)).toEqual({
      pen: true,
      coins: false,
    });
  });
});

describe("hall horn", () => {
  it("fires once for merchant, wantsTalk, or a family settle Confirm — not for an empty hall", () => {
    const quiet = viewOf((v) => {
      for (const npc of v.state.npcs) npc.wantsTalk = false;
    });
    expect(hallHornDue(quiet)).toBe(false);

    const merchant = viewOf((v) => {
      for (const npc of v.state.npcs) npc.wantsTalk = false;
      v.merchantAvailable = true;
      v.state.merchant.present = true;
      v.state.flags.merchant_present = true;
    });
    expect(hallHornDue(merchant)).toBe(true);

    const talk = viewOf((v) => {
      for (const npc of v.state.npcs) npc.wantsTalk = false;
      v.state.npcs[0].wantsTalk = true;
    });
    expect(hallHornDue(talk)).toBe(true);

    const settle = viewOf((v) => {
      for (const npc of v.state.npcs) npc.wantsTalk = false;
      v.pending = [
        {
          id: "p1",
          npcId: "steward",
          status: "pending",
          proposal: {
            type: "settle_households",
            summary: "A family at the gate",
            households: 1,
            adult_men: 1,
            adult_women: 1,
            youths: 1,
          },
        },
      ];
    });
    expect(hallHornDue(settle)).toBe(true);

    const both = viewOf((v) => {
      v.merchantAvailable = true;
      v.state.merchant.present = true;
      v.state.flags.merchant_present = true;
      v.state.npcs[0].wantsTalk = true;
    });
    expect(hallHornDue(both)).toBe(true);
    expect(hallHornDue({ ...both, state: { ...both.state, estateAbandoned: true } })).toBe(false);
  });

  it("sounds on a fresh game because household NPCs still want a first word", () => {
    expect(enterGameHorn(viewOf())).toBe(true);
  });
});

describe("advance season cues", () => {
  it("plays fanfare when the clock actually turns, not on a same-season failure", () => {
    const summer = viewOf((v) => {
      for (const npc of v.state.npcs) npc.wantsTalk = false;
      v.state.meta.season = "summer";
    });
    expect(advanceSeasonLanded("spring", summer)).toBe(true);
    expect(seasonAdvanceSfx("spring", summer)).toEqual({ fanfare: true, horn: false });
    expect(seasonAdvanceSfx("spring", { ...summer, error: "timeout" })).toEqual({
      fanfare: false,
      horn: false,
    });
    expect(seasonAdvanceSfx("spring", viewOf((v) => {
      for (const npc of v.state.npcs) npc.wantsTalk = false;
    }))).toEqual({ fanfare: false, horn: false });
    expect(seasonAdvanceSfx("spring", null)).toEqual({ fanfare: false, horn: false });
  });

  it("skips fanfare and horn when the empty villa is the result", () => {
    const over = viewOf((v) => {
      v.state.meta.season = "summer";
      v.state.estateAbandoned = true;
      v.state.npcs[0].wantsTalk = true;
    });
    expect(seasonAdvanceSfx("spring", over)).toEqual({ fanfare: false, horn: false });
    expect(musicBedFor("game", true)).toBe("gameOver");
  });

  it("adds one horn when Advance lands on a season with visitors", () => {
    const landed = viewOf((v) => {
      for (const npc of v.state.npcs) npc.wantsTalk = false;
      v.state.meta.season = "summer";
      v.merchantAvailable = true;
      v.state.merchant.present = true;
      v.state.flags.merchant_present = true;
    });
    expect(seasonAdvanceSfx("spring", landed)).toEqual({ fanfare: true, horn: true });
    expect(seasonKey(landed.state.meta)).toBe("825:summer");
  });
});

describe("packed click mp3", () => {
  it("is the user-trimmed MPEG click, not the old WAV or laptop pock", () => {
    const mp3 = resolve(process.cwd(), "art assets/Sound fx/ui-click.mp3");
    const wav = resolve(process.cwd(), "art assets/Sound fx/ui-click.wav");
    expect(existsSync(mp3)).toBe(true);
    expect(existsSync(wav)).toBe(false);
    const buf = readFileSync(mp3);
    const mpeg = buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
    const id3 = buf.toString("ascii", 0, 3) === "ID3";
    expect(mpeg || id3).toBe(true);
    expect(buf.length).toBeGreaterThan(2_000);
    expect(buf.length).toBeLessThan(30_000);
  });
});
