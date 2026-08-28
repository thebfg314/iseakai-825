import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("BUTTON_CLICK is a short 16-bit PCM WAV tick, not the old MP3", () => {
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
  assert.equal(channels, 1);
  assert.equal(sampleRate, 44100);
  assert.equal(bitsPerSample, 16);

  const data = buf.indexOf(Buffer.from("data"));
  assert.ok(data >= 0, "WAV data chunk");
  const byteLength = buf.readUInt32LE(data + 4);
  const durationMs = (byteLength / (channels * (bitsPerSample / 8)) / sampleRate) * 1000;
  assert.ok(durationMs >= 40 && durationMs <= 80, `duration ${durationMs.toFixed(1)}ms should be 40–80ms`);
});
