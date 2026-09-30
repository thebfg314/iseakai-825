import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

test("the main screen pans to the field and back while a battle session is open", () => {
  const app = read("src/ui/App.tsx");
  const css = read("src/ui/styles.css");
  assert.match(app, /className=\{onField \? "stage on-field" : "stage"\}/);
  assert.match(app, /<BattleScreen/);
  assert.match(app, /To the field/);
  assert.match(app, /call-to-arms/);
  assert.match(css, /\.stage\.on-field \{ transform: translateX\(-100vw\); \}/);
  assert.match(css, /prefers-reduced-motion/);
});

test("battle IPC surface matches between main and preload", () => {
  const main = read("electron/main.ts");
  const preload = read("electron/preload.ts");
  for (const ch of [
    "game:answerCall",
    "game:musterAndRide",
    "game:battleContinue",
    "game:battleChoose",
    "game:battleRound",
    "game:battleFinish",
    "game:raiseCall",
    "game:scoutRole",
    "game:scoutNarrow",
    "game:scoutFinalize",
    "game:deployFile",
    "game:deployRest",
    "game:addressFile",
    "game:beginBattle",
    "game:dayEnd",
    "game:grantFullCommand",
  ]) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\("${ch}"`), `main handles ${ch}`);
    assert.match(preload, new RegExp(`"${ch}"`), `preload exposes ${ch}`);
  }
});

test("the vignette pool is the full 40: 8 opening, 24 crisis, 8 turning point, 5 High crisis cards", () => {
  const file = JSON.parse(read("data/combat/vignettes.json"));
  const by = (phase) => file.vignettes.filter((v) => v.phase === phase);
  assert.equal(file.vignettes.length, 40);
  assert.equal(by("opening").length, 8);
  assert.equal(by("crisis").length, 24);
  assert.equal(by("turning").length, 8);
  const highCrisis = by("crisis").filter((v) => v.renownTier === "high").map((v) => v.id).sort();
  assert.deepEqual(highCrisis, ["banner_wavers", "captured_standard", "cut_off", "knight_falls", "routing_enemy"]);
  assert.equal(new Set(file.vignettes.map((v) => v.id)).size, 40);
  for (const v of file.vignettes) assert.equal(v.options.length, 2, v.id);
});
