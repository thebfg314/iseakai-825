import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Speak wait overlays the waiting reel only while dialogue send is in flight", () => {
  const app = readFileSync(path.join(root, "src/ui/App.tsx"), "utf8");
  const css = readFileSync(path.join(root, "src/ui/styles.css"), "utf8");
  const anim = readFileSync(path.join(root, "src/ui/waitingAnim.ts"), "utf8");

  assert.match(app, /from "\.\/waitingAnim"/);
  assert.match(app, /SpeakWaitingReel/);
  assert.match(app, /speakWaiting/);
  assert.match(app, /aria-label=\{`Speak to \$\{npc\?\.name \?\? "them"\}`\}/);

  const send = app.slice(app.indexOf("async function send()"), app.indexOf("const settingsModal"));
  assert.match(send, /setSpeakWaiting\(true\)/);
  assert.match(send, /setSpeakWaiting\(false\)/);

  const advance = app.slice(app.indexOf("async function advanceSeason()"), app.indexOf("async function send()"));
  assert.doesNotMatch(advance, /setSpeakWaiting/);
  assert.match(advance, /setLoopingSeason/);

  assert.match(anim, /art assets\/Anim sprites\/waiting\/waiting 1\.png/);
  assert.match(anim, /waiting 12\.png/);
  assert.match(anim, /WAITING_HOLD_MS = 1000/);

  assert.match(css, /\.speak-waiting-reel/);
  assert.match(css, /object-fit:\s*contain/);
  assert.match(
    css,
    /\.composer \.speak-submit\.speak-waiting,\s*\.composer \.speak-submit\.speak-waiting:disabled\s*\{[^}]*background:\s*#000/,
  );
  assert.match(
    css,
    /\.composer \.speak-submit\.speak-waiting:disabled\s*\{[^}]*opacity:\s*1/,
  );

  for (let i = 1; i <= 12; i++) {
    const file = path.join(root, "art assets/Anim sprites/waiting", `waiting ${i}.png`);
    assert.equal(existsSync(file), true, file);
    const buf = readFileSync(file);
    assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${file} PNG signature`);
    assert.equal(buf.toString("ascii", 12, 16), "IHDR");
    assert.equal(buf.readUInt32BE(16), 2128, `${file} width`);
    assert.equal(buf.readUInt32BE(20), 912, `${file} height`);
  }
});
