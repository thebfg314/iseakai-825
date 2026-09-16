import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("BUTTON_CLICK is the trimmed MPEG click, not the old WAV or laptop pock", () => {
  const mp3Path = path.join(root, "art assets/Sound fx/ui-click.mp3");
  const wavPath = path.join(root, "art assets/Sound fx/ui-click.wav");
  const oldMp3 = path.join(root, "art assets/Sound fx/Old School Pc Button Click (1.99x).mp3");
  const art = readFileSync(path.join(root, "src/ui/art.ts"), "utf8");
  const app = readFileSync(path.join(root, "src/ui/App.tsx"), "utf8");
  const playback = readFileSync(path.join(root, "src/ui/sfxPlayback.ts"), "utf8");

  assert.equal(existsSync(oldMp3), false, "old laptop-click MP3 must be gone");
  assert.equal(existsSync(wavPath), false, "untrimmed ui-click.wav must be gone");
  assert.equal(existsSync(mp3Path), true, "trimmed ui-click.mp3");
  assert.match(art, /from "\.\.\/\.\.\/art assets\/Sound fx\/ui-click\.mp3"/);
  assert.doesNotMatch(art, /Old School Pc Button Click/);
  assert.doesNotMatch(art, /ui-click\.wav/);
  assert.doesNotMatch(app, /new Audio\(BUTTON_CLICK\)/);
  assert.match(app, /createSfxPlayer/);
  assert.match(app, /player\?\.play\(BUTTON_CLICK/);
  assert.match(playback, /currentTime = 0/);
  assert.match(playback, /createBufferSource/);

  const buf = readFileSync(mp3Path);
  const mpeg = buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
  const id3 = buf.toString("ascii", 0, 3) === "ID3";
  assert.ok(mpeg || id3, "MPEG frame or ID3 header");
  assert.ok(buf.length > 2_000 && buf.length < 30_000, `short click size ${buf.length}`);
});

test("App preloads one-shots and ducks music only for fanfare and horn", () => {
  const art = readFileSync(path.join(root, "src/ui/art.ts"), "utf8");
  const app = readFileSync(path.join(root, "src/ui/App.tsx"), "utf8");
  const files = {
    "pen-confirm.mp3": "PEN_CONFIRM",
    "season-fanfare.wav": "SEASON_FANFARE",
    "hall-horn.mp3": "HALL_HORN",
    "coins.wav": "COINS",
    "game-over.mp3": "GAME_OVER_THEME",
  };
  for (const [file, exp] of Object.entries(files)) {
    assert.equal(existsSync(path.join(root, "art assets/Sound fx", file)), true, file);
    assert.match(art, new RegExp(file.replace(".", "\\.")));
    assert.match(app, new RegExp(exp));
  }
  assert.match(app, /confirmSfx/);
  assert.match(app, /seasonAdvanceSfx/);
  assert.match(app, /hallHornDue/);
  assert.match(app, /musicBedFor/);
  assert.match(app, /GAME_OVER_THEME/);
  assert.match(app, /playSfx\(SEASON_FANFARE, true\)/);
  assert.match(app, /playSfx\(HALL_HORN, true\)/);
  assert.match(app, /playSfx\(PEN_CONFIRM\)/);
  assert.match(app, /playSfx\(COINS\)/);
  assert.match(app, /holdingMusic/);
  assert.doesNotMatch(app, /onConfirm=\{\(\) => withBusy\(\(\) => window\.api\.confirmProposal/);
});
