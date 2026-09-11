import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("src/ui module stems do not collide on case-insensitive volumes", () => {
  const dir = path.join(root, "src/ui");
  const stems = new Map();
  for (const name of readdirSync(dir)) {
    if (!/\.(tsx?|jsx?)$/i.test(name)) continue;
    if (/\.test\.(tsx?|jsx?)$/i.test(name)) continue;
    const stem = name.replace(/\.(tsx?|jsx?)$/i, "").toLowerCase();
    const prior = stems.get(stem);
    assert.equal(
      prior,
      undefined,
      `Windows Vite treats ${prior} and ${name} as the same module; rename one so the title screen can load`,
    );
    stems.set(stem, name);
  }
  assert.equal(stems.get("bookspanel"), "BooksPanel.tsx");
  assert.ok(stems.get("booksview"), "books view-model must keep a distinct stem from BooksPanel.tsx");
});
