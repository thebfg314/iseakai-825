import { afterEach, describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { clearCustomContent, unitSheet } from "../combat/registry";
import { parseForgeReply } from "../combat/forge";
import { acceptCall, applyLevyGrief, garrisonWalls, LEVY_DEAD_HAPPINESS_FLOOR, musterAndRide, raiseCallDirect, settleRansom, villaWallKind, type BattleDeps } from "../session/battle";
import { applyProposal } from "./applyDelta";
import { captainWanted, derivedRaiseSpec, quoteRaise, unitWants, unmetRequirements } from "./military";
import { WorldStateSchema, type WorldState } from "./schema";
import { specialistById, specialistUnlocked } from "./specialists";

const fresh = (withCaptain = false): WorldState => {
  const s = WorldStateSchema.parse(JSON.parse(JSON.stringify(startingEstate)));
  if (withCaptain) s.npcs.push({ id: "captain", name: "Eberhard", role: "captain", location: "fontenay", memories: [], wantsTalk: false });
  return s;
};
const silent: BattleDeps = { chat: async () => { throw new Error("offline"); }, log: () => {} };

afterEach(() => clearCustomContent());

describe("what the district lacks (design review, item 12)", () => {
  it("roster sheets with requirements get a derived spec; ordinary roster sheets do not", () => {
    expect(derivedRaiseSpec("crossbowmen")).toMatchObject({ source: "hire", needsCaptain: true, horsesPerMan: 0, seasons: 2 });
    // Steppe horses stand in for stable horses.
    expect(derivedRaiseSpec("frankish_horse_archers")).toMatchObject({ horsesPerMan: 0, seasons: 3, denariiPerMan: 12 });
    expect(derivedRaiseSpec("heavy_horse")).toBeUndefined();
    expect(derivedRaiseSpec("ship_crew")).toBeUndefined();
    expect(quoteRaise("crossbowmen", 20)!.men).toBe(20);
  });

  it("Eberhard refuses the raise until the goods are in store, naming what is wanting and whom to ask; then consumes them", () => {
    const s = fresh(true);
    s.resources.denarii = 500;
    s.resources.iron = 60;
    const short = unmetRequirements(s, "crossbowmen", 10);
    expect(short).toHaveLength(1);
    expect(short[0]).toMatchObject({ need: 10, have: 0 });
    const refused = applyProposal(s, { type: "raise_unit", summary: "x", sheetId: "crossbowmen", men: 10 }, "captain");
    expect(refused.ok).toBe(false);
    expect(refused.reason).toMatch(/Wanting: 10 crossbow locks and steel prods \(0 in store; ask Bernard the smith\)/);

    // Bernard registers the good and turns out the pieces.
    expect(applyProposal(s, { type: "register_resource", summary: "x", isNew: true, resourceId: "crossbow_hardware", name: "crossbow locks and prods", unit: "piece", priceMin: 10, priceMax: 20, tags: ["craft", "arms"], initialAmount: 0 }, "smith").ok).toBe(true);
    expect(applyProposal(s, { type: "transfer_resources", summary: "x", resource: "crossbow_hardware", amount: 12, direction: "gain" }, "smith").ok).toBe(true);
    expect(unitWants(s).find((w) => w.resource === "crossbow_hardware")!.have).toBe(12);

    const raised = applyProposal(s, { type: "raise_unit", summary: "x", sheetId: "crossbowmen", men: 10, name: "The lord's crossbows" }, "captain");
    expect(raised.ok).toBe(true);
    expect(s.military.training).toHaveLength(1);
    expect(s.military.training[0].sheetId).toBe("crossbowmen");
    expect(s.custom_resources.find((c) => c.id === "crossbow_hardware")!.amount).toBe(2);
  });

  it("the captain is wanted once the lord has men of his own or has begun gathering a new unit's goods — not for a wall", () => {
    const s = fresh();
    expect(captainWanted(s)).toBe(false);
    s.holdings[0].features.push("palisade", "gatehouse", "tower");
    expect(captainWanted(s)).toBe(false);
    expect(specialistUnlocked(s, specialistById("captain")!)).toBe(false);
    s.custom_resources.push({ id: "steppe_horses", name: "steppe horses", unit: "head", amount: 2, priceMin: 60, priceMax: 140 });
    expect(captainWanted(s)).toBe(true);
    const t = fresh();
    applyProposal(t, { type: "raise_unit", summary: "levy", sheetId: "peasant_levy", men: 10 }, "steward");
    expect(captainWanted(t)).toBe(true);
  });

  it("a forged sheet may carry requirements; the validator accepts them and the campaign lists them as wanting", () => {
    const reply = JSON.stringify({
      sheet: {
        id: "lamellar_lancers", name: "Lamellar Lancers", kind: "troop", hp: 90, atk: 17, def: 15, damage: { min: 8, max: 13 }, range: 0, speed: 5, morale: 70, strength: 50,
        tags: ["mounted", "shock", "heavy_armor"], anachronistic: true,
        requirements: [
          { resource: "lamellar_plates", name: "lamellar plate sets", perMan: 1, source: "smith" },
          { resource: "war_saddles", name: "high war saddles with stirrups", perMan: 1, source: "hunt", note: "Avar work." },
        ],
      },
      newTags: [],
      rationale: "Avar-pattern heavy horse.",
    });
    const parsed = parseForgeReply(reply);
    expect(parsed.ok).toBe(true);
    const s = fresh(true);
    const r = applyProposal(s, { type: "register_unit_sheet", summary: "x", sheet: JSON.parse(reply).sheet, newTags: [], isNew: true }, "captain");
    expect(r.ok).toBe(true);
    expect(unitSheet("lamellar_lancers")!.requirements).toHaveLength(2);
    const wants = unitWants(s).filter((w) => w.sheetId === "lamellar_lancers");
    expect(wants.map((w) => w.askOf)).toEqual(["Bernard the smith", "Gerulf the negotiator"]);
    // Mounted with no replacesHorses: still needs stable horses too.
    expect(derivedRaiseSpec("lamellar_lancers")!.horsesPerMan).toBe(1);
  });
});

describe("the villa's walls (design review, item 8)", () => {
  it("a raid is fought behind a timber face on the lord's front row, garrisoned by his files; a mason's wall makes it stone", () => {
    const s = fresh();
    expect(villaWallKind(s)).toBe("wooden");
    s.military.units.push({ id: "u1", sheetId: "pedites_fyrd", name: "Spears", veteran: false, strength: 20, raisedTurn: 1 });
    raiseCallDirect(s, "raid", 7);
    expect(acceptCall(s, silent).started).toBe(true);
    musterAndRide(s, silent, ["u1"]);
    const b = s.battle!;
    const row2 = b.battlefield.cells.filter((c) => c.fortification);
    expect(row2).toHaveLength(3);
    expect(row2.every((c) => c.fortification!.side === "player" && c.fortification!.points[0].typeId === "wooden")).toBe(true);
    const mine = b.units.find((u) => u.id === "p-u1")!;
    expect(mine.cell!.row).toBe(2);
    expect(mine.fort?.pointId).toBeDefined();

    const t = fresh();
    t.holdings[0].features.push("stone_wall");
    expect(villaWallKind(t)).toBe("stone");
    t.military.units.push({ id: "u1", sheetId: "pedites_fyrd", name: "Spears", veteran: false, strength: 20, raisedTurn: 1 });
    raiseCallDirect(t, "raid", 7);
    acceptCall(t, silent);
    musterAndRide(t, silent, ["u1"]);
    expect(t.battle!.battlefield.cells.find((c) => c.fortification)!.fortification!.points[0].typeId).toBe("stone");
  });

  it("outlaws on the road and the count's muster are fought on open ground", () => {
    const s = fresh();
    s.military.units.push({ id: "u1", sheetId: "pedites_fyrd", name: "Spears", veteran: false, strength: 20, raisedTurn: 1 });
    raiseCallDirect(s, "bandits", 7);
    acceptCall(s, silent);
    musterAndRide(s, silent, ["u1"]);
    expect(s.battle!.battlefield.cells.some((c) => c.fortification)).toBe(false);
    garrisonWalls(s.battle!); // harmless with no walls
  });

  it("the stone wall is a mason's project", () => {
    const s = fresh();
    s.resources.hardwood = 50;
    s.resources.iron = 100;
    s.resources.stone = 100;
    const refused = applyProposal(s, { type: "start_project", summary: "x", projectKey: "stone_wall" }, "steward");
    expect(refused.ok).toBe(false);
    expect(refused.reason).toMatch(/needs a mason/);
    s.npcs.push({ id: "mason", name: "Gerold", role: "mason", location: "fontenay", memories: [], wantsTalk: false });
    expect(applyProposal(s, { type: "start_project", summary: "x", projectKey: "stone_wall" }, "mason").ok).toBe(true);
  });
});

describe("ransom and grief (design review, items 9 and 10)", () => {
  it("a ransom the chest cannot meet is written down, and he comes home; the taxation that would end it is not built", () => {
    const s = fresh();
    s.player.renown = 100;
    s.resources.denarii = 1000;
    expect(settleRansom(s)).toMatch(/ransomed for/);
    expect(s.player.captive).toBe(false);
    expect(s.resources.denarii).toBeLessThan(1000);
    const poor = fresh();
    poor.player.renown = 100;
    poor.resources.denarii = 5;
    expect(settleRansom(poor)).toMatch(/stands owing/);
    expect(poor.player.captive).toBe(false);
    expect(poor.player.dead).toBe(false);
    expect(poor.history.ransom?.owed).toBeGreaterThan(0);
    expect(poor.resources.denarii).toBe(0);
    raiseCallDirect(poor, "summons", 1);
    expect(acceptCall(poor, silent).started).toBe(true);
  });

  it("each levy man who does not come home costs the people 3, but grief alone stops at 20", () => {
    const s = fresh();
    s.peopleHappiness = 50;
    expect(applyLevyGrief(s, 4)).toBe(-12);
    expect(s.peopleHappiness).toBe(38);
    expect(applyLevyGrief(s, 10)).toBe(LEVY_DEAD_HAPPINESS_FLOOR - 38);
    expect(s.peopleHappiness).toBe(LEVY_DEAD_HAPPINESS_FLOOR);
    s.peopleHappiness = 15;
    expect(applyLevyGrief(s, 3)).toBe(0); // already below the floor: no further fall from grief
    expect(applyLevyGrief(s, 0)).toBe(0);
  });
});
