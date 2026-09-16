import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("BUTTON_CLICK is the packed mouse-click WAV, not the old laptop pock MP3", () => {
  const wavPath = path.join(root, "art assets/Sound fx/ui-click.wav");
  const oldMp3 = path.join(root, "art assets/Sound fx/Old School Pc Button Click (1.99x).mp3");
  const art = readFileSync(path.join(root, "src/ui/art.ts"), "utf8");
  const app = readFileSync(path.join(root, "src/ui/App.tsx"), "utf8");

  assert.equal(existsSync(oldMp3), false, "old laptop-click MP3 must be gone");
  assert.match(art, /from "\.\.\/\.\.\/art assets\/Sound fx\/ui-click\.wav"/);
  assert.doesNotMatch(art, /Old School Pc Button Click/);
  assert.match(app, /new Audio\(BUTTON_CLICK\)/);

  const buf = readFileSync(wavPath);
  assert.equal(buf.toString("ascii", 0, 4), "RIFF");
  assert.equal(buf.toString("ascii", 8, 12), "WAVE");

  const fmt = buf.indexOf(Buffer.from("fmt "));
  assert.ok(fmt >= 0, "WAV fmt chunk");
  const audioFormat = buf.readUInt16LE(fmt + 8);
  const channels = buf.readUInt16LE(fmt + 10);
  const sampleRate = buf.readUInt32LE(fmt + 12);
  const bitsPerSample = buf.readUInt16LE(fmt + 22);
  assert.equal(audioFormat, 1, "PCM (not mp3/adpcm)");
  assert.ok(channels === 1 || channels === 2, `channels ${channels}`);
  assert.ok(sampleRate === 44100 || sampleRate === 48000, `sampleRate ${sampleRate}`);
  assert.equal(bitsPerSample, 16);

  const data = buf.indexOf(Buffer.from("data"));
  assert.ok(data >= 0, "WAV data chunk");
  const byteLength = buf.readUInt32LE(data + 4);
  const durationMs = (byteLength / (channels * (bitsPerSample / 8)) / sampleRate) * 1000;
  assert.ok(durationMs >= 40 && durationMs <= 800, `duration ${durationMs.toFixed(1)}ms should be a short click`);
});

test("App and art wire the SFX pack cues", () => {
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
  assert.doesNotMatch(app, /onConfirm=\{\(\) => withBusy\(\(\) => window\.api\.confirmProposal/);
});
