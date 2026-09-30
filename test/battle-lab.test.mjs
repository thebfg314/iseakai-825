import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

test("title menu offers the Battle Lab and the lab screen is wired", () => {
  const app = read("src/ui/App.tsx");
  assert.match(app, /Battle Lab/);
  assert.match(app, /setScreen\("lab"\)/);
  assert.match(app, /<BattleLab onExit=/);
  assert.match(app, /type Screen = "title" \| "game" \| "lab"/);
});

test("lab IPC surface matches between main and preload", () => {
  const main = read("electron/main.ts");
  const preload = read("electron/preload.ts");
  const channels = [...main.matchAll(/ipcMain\.handle\("(lab:[a-zA-Z]+)"/g)].map((m) => m[1]);
  assert.ok(channels.length >= 15, `expected lab channels, found ${channels.length}`);
  for (const ch of channels) assert.match(preload, new RegExp(`"${ch}"`), `preload exposes ${ch}`);
  assert.match(main, /lab\?\.dispose\(\)/, "closing the lab disposes forged content");
});

test("the lab never writes the campaign save", () => {
  const lab = read("src/session/lab.ts");
  assert.doesNotMatch(lab, /saveWorldState|world-state\.json|appendHistory/);
});
