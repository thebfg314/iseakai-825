import { afterEach, describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { clearCustomContent, unitSheet } from "../combat/registry";
import { parseProposal } from "../llm/parse";
import { collectDrawers } from "../llm/toolProtocol";
import { acceptCall, musterAndRide, raiseCallDirect } from "../session/battle";
import { simulateBattle } from "../combat/simulate";
import { applyProposal } from "./applyDelta";
import { ensureCampaignContent, quoteRaise, tickMilitary, upkeepDue } from "./military";
import { WorldStateSchema, type WorldState } from "./schema";

function fresh(withCaptain = false): WorldState {
  const s = WorldStateSchema.parse(JSON.parse(JSON.stringify(startingEstate)));
  if (withCaptain) s.npcs.push({ id: "captain", name: "Eberhard", role: "captain", location: "fontenay", memories: [], wantsTalk: false });
  return s;
}

afterEach(() => clearCustomContent());

describe("raising units", () => {
  it("quotes follow the spec table and clamp men to the allowed range", () => {
    const q = quoteRaise("caballarii", 3)!;
    expect(q.men).toBe(5);
    expect(q.denarii).toBe(60);
    expect(q.horses).toBe(5);
    expect(q.iron).toBe(5);
    expect(q.seasons).toBe(3);
    expect(q.upkeepPerSeason).toBe(5);
    expect(quoteRaise("peasant_levy", 500)!.men).toBe(100);
    expect(quoteRaise("heavy_horse", 10)).toBeUndefined();
  });

  it("Aldric can call up the villa's levy at once, limited by free men, at no cost", () => {
    const s = fresh();
    const denarii = s.resources.denarii;
    const r = applyProposal(s, { type: "raise_unit", summary: "levy", sheetId: "peasant_levy", men: 10, name: "Fontenay levy" }, "steward");
    expect(r.ok).toBe(true);
    expect(s.military.units).toHaveLength(1);
    expect(s.military.units[0].strength).toBe(10);
    expect(s.resources.denarii).toBe(denarii);
    expect(s.population.adult_men).toBe(12); // levy do not leave the population
    const again = applyProposal(s, { type: "raise_unit", summary: "more", sheetId: "peasant_levy", men: 10 }, "steward");
    expect(again.ok).toBe(false);
    expect(again.reason).toMatch(/Only 2 men/);
  });

  it("paid men need Eberhard, cost denarii/iron/horses, and drill for seasons before they stand", () => {
    const noCaptain = fresh();
    noCaptain.resources.denarii = 500;
    noCaptain.resources.iron = 50;
    const blocked = applyProposal(noCaptain, { type: "raise_unit", summary: "spears", sheetId: "pedites_fyrd", men: 10 }, "captain");
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toMatch(/captain/);

    const s = fresh(true);
    s.resources.denarii = 500;
    s.resources.iron = 50;
    s.resources.horses = 6;
    const poor = applyProposal(s, { type: "raise_unit", summary: "horse", sheetId: "caballarii", men: 10 }, "captain");
    expect(poor.ok).toBe(false);
    expect(poor.reason).toMatch(/horses/);
    const r = applyProposal(s, { type: "raise_unit", summary: "horse", sheetId: "caballarii", men: 5, name: "The lord's riders" }, "captain");
    expect(r.ok).toBe(true);
    expect(s.resources.denarii).toBe(440);
    expect(s.resources.iron).toBe(45);
    expect(s.resources.horses).toBe(1);
    expect(s.military.units).toHaveLength(0);
    expect(s.military.training).toHaveLength(1);
    let lines = tickMilitary(s);
    expect(s.military.training[0].seasonsElapsed).toBe(1);
    expect(s.military.units).toHaveLength(0);
    tickMilitary(s);
    lines = tickMilitary(s);
    expect(s.military.training).toHaveLength(0);
    expect(s.military.units[0].name).toBe("The lord's riders");
    expect(lines.some((l) => /finished their drill/.test(l.text))).toBe(true);
  });

  it("Aldric may not drill paid men; Bernard may not raise anyone; only Eberhard sounds the call", () => {
    const s = fresh(true);
    s.resources.denarii = 500;
    s.resources.iron = 50;
    expect(applyProposal(s, { type: "raise_unit", summary: "x", sheetId: "pedites_fyrd", men: 10 }, "steward").reason).toMatch(/Eberhard/);
    expect(applyProposal(s, { type: "raise_unit", summary: "x", sheetId: "peasant_levy", men: 10 }, "smith").ok).toBe(false);
    expect(applyProposal(s, { type: "call_to_arms", summary: "x", kind: "bandits" }, "steward").ok).toBe(false);
    const call = applyProposal(s, { type: "call_to_arms", summary: "x", kind: "bandits" }, "captain");
    expect(call.ok).toBe(true);
    expect(s.battle_call?.kind).toBe("bandits");
    expect(applyProposal(s, { type: "call_to_arms", summary: "x", kind: "raid" }, "captain").ok).toBe(false); // one at a time
  });

  it("upkeep is paid each season; when the chest is short, men drift home with their gear", () => {
    const s = fresh(true);
    s.military.units.push({ id: "u1", sheetId: "caballarii", name: "Riders", veteran: false, strength: 20, raisedTurn: 1 });
    s.military.units.push({ id: "u2", sheetId: "peasant_levy", name: "Levy", veteran: false, strength: 10, raisedTurn: 1 });
    expect(upkeepDue(s)).toBe(20);
    s.resources.denarii = 50;
    let lines = tickMilitary(s);
    expect(s.resources.denarii).toBe(30);
    expect(lines.some((l) => /Paid 20 denarii/.test(l.text))).toBe(true);
    s.resources.denarii = 5;
    const horses = s.resources.horses;
    lines = tickMilitary(s);
    expect(s.resources.denarii).toBe(0);
    expect(s.military.units.find((u) => u.id === "u1")?.strength).toBe(18);
    expect(s.military.units.find((u) => u.id === "u2")?.strength).toBe(10); // levy cost nothing, lose no one
    expect(s.resources.horses).toBe(horses + 2);
    expect(lines.some((l) => l.kind === "reject")).toBe(true);
  });

  it("disbanding returns the horses to the stables", () => {
    const s = fresh(true);
    s.military.units.push({ id: "u1", sheetId: "caballarii", name: "Riders", veteran: false, strength: 8, raisedTurn: 1 });
    const horses = s.resources.horses;
    const r = applyProposal(s, { type: "disband_unit", summary: "x", unitId: "Riders" }, "steward");
    expect(r.ok).toBe(true);
    expect(s.military.units).toHaveLength(0);
    expect(s.resources.horses).toBe(horses + 8);
  });
});

describe("invented units in the campaign", () => {
  const chariot = {
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
  };
  const wheels = { id: "scythe_wheels", summary: "Blades on the axles.", conditional: [{ when: { targetLacksTag: "mounted" }, damageMultiplier: 1.3 }] };

  it("register_unit_sheet validates like the forge, persists in the save, and survives a registry clear", () => {
    const s = fresh(true);
    const bad = applyProposal(s, { type: "register_unit_sheet", summary: "x", sheet: { ...chariot, tags: ["mounted", "laser"] }, newTags: [], isNew: true }, "captain");
    expect(bad.ok).toBe(false);
    expect(bad.reason).toMatch(/unknown tag "laser"/);
    const r = applyProposal(s, { type: "register_unit_sheet", summary: "x", sheet: chariot, newTags: [wheels], rationale: "why not", isNew: true }, "smith");
    expect(r.ok).toBe(true);
    expect(s.military.customSheets).toHaveLength(1);
    expect(s.military.customTags).toHaveLength(1);
    expect(unitSheet("scythed_chariot")).toBeDefined();
    clearCustomContent();
    expect(unitSheet("scythed_chariot")).toBeUndefined();
    const reloaded = WorldStateSchema.parse(JSON.parse(JSON.stringify(s)));
    ensureCampaignContent(reloaded);
    expect(unitSheet("scythed_chariot")?.tags).toContain("scythe_wheels");
    expect(applyProposal(s, { type: "register_unit_sheet", summary: "x", sheet: chariot, newTags: [wheels], isNew: true }, "chaplain").ok).toBe(false);
  });
});

describe("LLM plumbing", () => {
  it("parses the new proposal types from model JSON", () => {
    expect(parseProposal({ type: "raise_unit", summary: "s", sheetId: "peasant_levy", men: "12" }).proposal).toMatchObject({ type: "raise_unit", men: 12 });
    expect(parseProposal({ type: "call_to_arms", summary: "s", kind: "raid" }).proposal?.type).toBe("call_to_arms");
    expect(parseProposal({ type: "disband_unit", summary: "s", unitId: "u1" }).proposal?.type).toBe("disband_unit");
    expect(parseProposal({ type: "register_unit_sheet", summary: "s", sheet: { id: "x" }, newTags: [] }).proposal?.type).toBe("register_unit_sheet");
    expect(parseProposal({ type: "call_to_arms", summary: "s", kind: "crusade" }).error).toBeTruthy();
  });

  it("the arms drawer gives the captain the price list and the state of the men", () => {
    const s = fresh(true);
    s.military.units.push({ id: "u1", sheetId: "peasant_levy", name: "Levy", veteran: true, strength: 10, raisedTurn: 1 });
    const arms = collectDrawers(s, ["arms"], "captain").arms as Record<string, unknown>;
    expect(arms.captain_present).toBe(true);
    expect(arms.villa_men_free_for_levy).toBe(2);
    // The fixed four plus the roster sheets that carry requirements (crossbowmen, horse archers).
    expect((arms.raisable as { sheetId: string }[]).map((r) => r.sheetId)).toEqual(
      expect.arrayContaining(["peasant_levy", "pedites_fyrd", "sagittarii", "caballarii", "crossbowmen", "frankish_horse_archers"]),
    );
    expect((arms.wanting as { resource: string; ask: string }[]).map((w) => `${w.resource}:${w.ask}`)).toEqual(
      expect.arrayContaining(["crossbow_hardware:Bernard the smith", "steppe_horses:Gerulf the negotiator"]),
    );
    expect((arms.units as { veteran: boolean }[])[0].veteran).toBe(true);
  });
});

describe("owned units in battle", () => {
  it("bringing a unit of his own lifts the lord to Sub-Command and veterans persist", () => {
    const s = fresh(true);
    s.military.units.push({ id: "u1", sheetId: "pedites_fyrd", name: "Fontenay spears", veteran: false, strength: 20, raisedTurn: 1 });
    raiseCallDirect(s, "bandits", 21);
    const d = { chat: async () => "", log: () => {} };
    const accepted = acceptCall(s, d);
    expect(accepted.started).toBe(true); // own units → no solo loss even with no allies
    expect(musterAndRide(s, d, ["u1"])).toBeUndefined();
    expect(s.battle?.tier).toBe("sub_command");
    const mine = s.battle!.units.find((u) => u.id === "p-u1")!;
    expect(mine.owner).toBe("player");
    expect(mine.strength).toBe(20);
    // Above Rank-and-File there is no free extra file: the lord rides with his own men.
    expect(s.battle!.units.some((u) => u.id === "p-lord-file")).toBe(false);
    expect(s.battle!.player.attachedUnitId).toBe("p-u1");
    simulateBattle(s.battle!, { maxRounds: 40 });
    // The ledger step is exercised through enterAftermath in the flow tests; here confirm the raw engine facts feed it.
    expect(["victory", "defeat", "draw"]).toContain(s.battle!.outcome);
  });
});
