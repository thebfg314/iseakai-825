import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("season timber frame overlay ships as an RGBA PNG and stacks over idle art", () => {
  const pngPath = path.join(root, "art assets/UI/season-timber-frame.png");
  assert.equal(existsSync(pngPath), true, "frame overlay PNG must be in the repo");

  const buf = readFileSync(pngPath);
  assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "PNG signature");
  assert.equal(buf.toString("ascii", 12, 16), "IHDR");
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  assert.ok(width > height, "ultrawide overlay");
  assert.ok(width / height > 1.8 && width / height < 2.3, `outer aspect ${width / height}`);
  assert.equal(bitDepth, 8);
  assert.equal(colorType, 6, "RGBA so the inner opening can be transparent");

  const app = readFileSync(path.join(root, "src/ui/App.tsx"), "utf8");
  const css = readFileSync(path.join(root, "src/ui/styles.css"), "utf8");
  const anim = readFileSync(path.join(root, "src/ui/seasonAnim.ts"), "utf8");
  assert.match(anim, /art assets\/UI\/season-timber-frame\.png/);
  assert.match(app, /className="season-art-idle"/);
  assert.match(app, /className="season-art-frame"/);
  assert.match(app, /SEASON_TIMBER_FRAME/);
  assert.match(app, /seasonHeaderSrc\(/);
  assert.match(css, /\.season-art-frame/);
  assert.match(css, /object-fit:\s*contain/);
});
