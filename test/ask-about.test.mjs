import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Ask about is only on pending ProposalCard, not ledger Works", () => {
  const app = readFileSync(path.join(root, "src/ui/App.tsx"), "utf8");
  const cardStart = app.indexOf("function ProposalCard");
  const ledgerStart = app.indexOf("function Ledger(");
  assert.ok(cardStart >= 0 && ledgerStart > cardStart);
  const card = app.slice(cardStart, ledgerStart);
  const ledger = app.slice(ledgerStart);
  assert.match(card, /onAskAbout/);
  assert.match(card, /Ask about/);
  assert.doesNotMatch(ledger, /Ask about/);
  assert.doesNotMatch(ledger, /askAbout/);
  assert.match(app, /window\.api\.askAboutProposal/);
  assert.doesNotMatch(app, /sendDialogue\(.*[Aa]sk about/);
});
