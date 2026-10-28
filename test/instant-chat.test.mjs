import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("player send paints a local bubble before waiting on the court", () => {
  const app = readFileSync(path.join(root, "src/ui/App.tsx"), "utf8");
  assert.match(app, /viewWithOptimisticPlayer/);
  assert.match(app, /applyServerDialogueView/);
  const sendIdx = app.indexOf("function send(draft: string)");
  assert.ok(sendIdx >= 0, "send(draft) in App.tsx");
  const optimisticIdx = app.indexOf("viewWithOptimisticPlayer", sendIdx);
  const ipcIdx = app.indexOf("window.api.sendDialogue", sendIdx);
  assert.ok(optimisticIdx > sendIdx && ipcIdx > optimisticIdx, "the local bubble is painted before the IPC call");
});

test("HUD shows remaining credits or used-this-save without printing the API key", () => {
  const app = readFileSync(path.join(root, "src/ui/App.tsx"), "utf8");
  assert.match(app, /hudInkLine\(view\.llmMeter\)/);
  assert.match(app, /settingsInkLines/);
  const ink = readFileSync(path.join(root, "src/ui/scribeInk.ts"), "utf8");
  assert.doesNotMatch(ink, /apiKey/);
  const styles = readFileSync(path.join(root, "src/ui/styles.css"), "utf8");
  assert.match(styles, /\.ink-meter/);
});
