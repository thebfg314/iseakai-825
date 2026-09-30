import { describe, expect, it } from "vitest";
import { forgeSystemPrompt, parseForgeReply } from "./forge";

const good = {
  sheet: {
    id: "scythed_chariot",
    name: "Scythed War Chariot",
    kind: "troop",
    hp: 70,
    atk: 16,
    def: 8,
    damage: { min: 7, max: 12 },
    range: 0,
    speed: 5,
    morale: 60,
    strength: 40,
    tags: ["mounted", "shock", "scythe_wheels"],
    anachronistic: true,
  },
  newTags: [
    {
      id: "scythe_wheels",
      summary: "Blades on the axles shred foot troops that are not braced.",
      conditional: [{ when: { targetLacksTag: "mounted", attackKind: "melee" }, damageMultiplier: 1.3 }],
    },
  ],
  rationale: "Persian-style chariots reimagined by a player; anachronistic for Francia.",
};

describe("forge reply parsing", () => {
  it("accepts a well-formed proposal with a new tag in the closed vocabulary", () => {
    const r = parseForgeReply(`Here you go:\n\`\`\`json\n${JSON.stringify(good)}\n\`\`\``);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proposal.sheet.id).toBe("scythed_chariot");
    expect(r.proposal.newTags).toHaveLength(1);
    expect(r.proposal.warnings.some((w) => /anachronistic/.test(w))).toBe(true);
  });

  it("rejects hooks outside the closed vocabulary", () => {
    const bad = { ...good, newTags: [{ id: "scythe_wheels", summary: "x", shredFactor: 3 }] };
    const r = parseForgeReply(JSON.stringify(bad));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join(" ")).toMatch(/newTags\[0\]/);
  });

  it("rejects unknown tags on the sheet, roster id collisions, and redefining built-in tags", () => {
    const unknown = { ...good, newTags: [] };
    expect(parseForgeReply(JSON.stringify(unknown)).ok).toBe(false);
    const collide = { ...good, sheet: { ...good.sheet, id: "heavy_horse", tags: ["mounted"] } };
    const rc = parseForgeReply(JSON.stringify(collide));
    expect(rc.ok).toBe(false);
    if (!rc.ok) expect(rc.errors.join(" ")).toMatch(/collides/);
    const redefine = { ...good, newTags: [...good.newTags, { id: "shock", summary: "again" }] };
    const rr = parseForgeReply(JSON.stringify(redefine));
    expect(rr.ok).toBe(false);
    if (!rr.ok) expect(rr.errors.join(" ")).toMatch(/already exists/);
  });

  it("enforces tag requirements and the ranged flag against the proposed stats", () => {
    const slow = { ...good, sheet: { ...good.sheet, speed: 3 } };
    const rs = parseForgeReply(JSON.stringify(slow));
    expect(rs.ok).toBe(false);
    if (!rs.ok) expect(rs.errors.join(" ")).toMatch(/shock.*Speed >= 4/);
    const archer = { ...good, sheet: { ...good.sheet, range: 2, tags: ["mounted", "scythe_wheels"] } };
    const ra = parseForgeReply(JSON.stringify(archer));
    expect(ra.ok).toBe(false);
    if (!ra.ok) expect(ra.errors.join(" ")).toMatch(/lacks the "ranged" tag/);
  });

  it("fails cleanly on garbage", () => {
    const r = parseForgeReply("I cannot help with that.");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/No JSON/);
  });

  it("system prompt lists the registry and the roster so the model reuses tags", () => {
    const p = forgeSystemPrompt();
    expect(p).toMatch(/anti_cavalry_spears/);
    expect(p).toMatch(/heavy_horse \(troop\)/);
    expect(p).toMatch(/targetLacksTag/);
    expect(p).not.toMatch(/low_armor/);
  });
});
