import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Ask about is only on pending ProposalCard, not the books panel", () => {
  const app = readFileSync(path.join(root, "src/ui/App.tsx"), "utf8");
  const books = readFileSync(path.join(root, "src/ui/BooksPanel.tsx"), "utf8");
  const card = readFileSync(path.join(root, "src/ui/ProposalsPanel.tsx"), "utf8");
  assert.match(card, /function ProposalsPanel/);
  assert.match(card, /onAskAbout/);
  assert.match(card, /Ask about/);
  assert.doesNotMatch(books, /Ask about/);
  assert.doesNotMatch(books, /askAbout/);
  assert.match(app, /window\.api\.askAboutProposal/);
  assert.doesNotMatch(app, /sendDialogue\(.*[Aa]sk about/);
});
