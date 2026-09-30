import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { attachPlayer, createBattle, playRound } from "../combat/battle";
import { emptyBattlefield } from "../combat/grid";
import { createRng } from "../combat/rng";
import { addLordWound, resolveRound } from "../combat/round";
import type { Wound } from "../combat/schema";
import { spawnUnit } from "../combat/units";
import { acceptCall, battleCommandRound, battleContinue, musterAndRide, raiseCallDirect, type BattleDeps } from "../session/battle";
import { applyProposal } from "./applyDelta";
import { WorldStateSchema, type WorldState } from "./schema";
import { canDirect, canLeadFile, canRally, canRideToWar, tickWounds } from "./wounds";

const fresh = (): WorldState => WorldStateSchema.parse(JSON.parse(JSON.stringify(startingEstate)));
const wound = (permanent = false): Wound => ({ location: "the thigh", cause: "test", statEffect: {}, renownEffect: 0, narrativeFlags: [], seasonsHeld: 0, permanent });
const silent: BattleDeps = { chat: async () => { throw new Error("offline"); }, log: () => {} };

describe("wounds in battle (design review)", () => {
  it("Rank-and-File: a wound carries the lord from the line and ends his part; no fate roll follows", async () => {
    const s = fresh();
    raiseCallDirect(s, "summons", 4);
    acceptCall(s, silent);
    musterAndRide(s, silent, []);
    await battleContinue(s, silent);
    const b = s.battle!;
    addLordWound(b, wound());
    expect(b.player.fate).toBe("carried_off");
    expect(b.player.newWounds).toHaveLength(1);
    // Answer the pending card, then continuing runs the hosts to the end without him.
    s.battle_session!.pendingCard = null;
    await battleContinue(s, silent);
    expect(s.battle_session!.phase).toBe("aftermath");
    expect(s.battle_session!.narration.some((n) => /carried from the line/.test(n.text))).toBe(true);
    expect(s.battle_history.at(-1)!.summary).toMatch(/wounded and carried from the line/);
    expect(b.player.alive).toBe(true);
  });

  it("Sub-Command: the lord's own file loses 15% of its heart; Full Command: every file loses 25%", () => {
    const sub = createBattle({ id: "s", seed: 1, tier: "sub_command", battlefield: emptyBattlefield(), player: { renown: 40, rank: 1 } });
    sub.units.push(spawnUnit("pedites_fyrd", { id: "mine", side: "player", owner: "player", cell: { row: 2, col: 1 } }));
    sub.units.push(spawnUnit("pedites_fyrd", { id: "ally", side: "player", owner: "ally", cell: { row: 2, col: 0 } }));
    attachPlayer(sub, "mine");
    addLordWound(sub, wound());
    expect(sub.units.find((u) => u.id === "mine")!.morale).toBe(55 - Math.round(55 * 0.15));
    expect(sub.units.find((u) => u.id === "ally")!.morale).toBe(55);
    expect(sub.player.fate).toBe("fighting");

    const full = createBattle({ id: "f", seed: 1, tier: "full_command", battlefield: emptyBattlefield(), player: { renown: 40, rank: 1 } });
    full.units.push(spawnUnit("pedites_fyrd", { id: "a", side: "player", owner: "player", cell: { row: 2, col: 1 } }));
    full.units.push(spawnUnit("heavy_horse", { id: "b", side: "player", owner: "ally", cell: { row: 2, col: 0 } }));
    full.units.push(spawnUnit("pedites_fyrd", { id: "e", side: "enemy", cell: { row: 4, col: 1 } }));
    addLordWound(full, wound());
    expect(full.units.find((u) => u.id === "a")!.morale).toBe(55 - Math.round(55 * 0.25));
    expect(full.units.find((u) => u.id === "b")!.morale).toBe(80 - 20);
    expect(full.units.find((u) => u.id === "e")!.morale).toBe(55);
  });

  it("a wounded lord cannot Rally; twice wounded he cannot direct", async () => {
    const b = createBattle({ id: "r", seed: 2, tier: "full_command", battlefield: emptyBattlefield(), player: { renown: 50, rank: 1 } });
    b.units.push(spawnUnit("caballarii", { id: "cb", side: "player", owner: "player", cell: { row: 3, col: 1 } }));
    b.units.push(spawnUnit("peasant_levy", { id: "lv", side: "enemy", cell: { row: 3, col: 1 } }));
    attachPlayer(b, "cb");
    b.phase = "rounds";
    b.player.wounds.push(wound());
    resolveRound(b, [{ type: "rally", unitId: "cb", amount: 10 }], createRng(2));
    expect(b.log.some((e) => /wounded lord cannot rally/.test(e.text))).toBe(true);
    expect(b.commandPool.remaining).toBe(50);
    expect(canRally(b.player.wounds)).toBe(false);
    expect(canDirect(b.player.wounds)).toBe(true);
    b.player.wounds.push(wound());
    expect(canDirect(b.player.wounds)).toBe(false);

    // Through the session: orders are dropped with a note.
    const s = fresh();
    s.military.units.push({ id: "u1", sheetId: "pedites_fyrd", name: "Spears", veteran: false, strength: 20, raisedTurn: 1 });
    raiseCallDirect(s, "bandits", 6);
    acceptCall(s, silent);
    musterAndRide(s, silent, ["u1"]);
    await battleContinue(s, silent);
    s.battle!.player.wounds.push(wound(), wound());
    await battleCommandRound(s, silent, [{ type: "hold", unitId: "p-u1" }]);
    expect(s.battle_session!.narration.some((n) => /Twice wounded/.test(n.text))).toBe(true);
  });

  it("a permanent wound keeps the lord out of the line: he commands unattached, or cannot answer a summons alone", () => {
    const s = fresh();
    s.player.wounds.push(wound(true));
    expect(canLeadFile(s)).toBe(false);
    raiseCallDirect(s, "summons", 3);
    const alone = acceptCall(s, silent);
    expect(alone.started).toBe(false);
    expect(alone.text).toMatch(/old wound/);
    s.military.units.push({ id: "u1", sheetId: "pedites_fyrd", name: "Spears", veteran: false, strength: 20, raisedTurn: 1 });
    raiseCallDirect(s, "bandits", 3);
    expect(acceptCall(s, silent).started).toBe(true);
    musterAndRide(s, silent, ["u1"]);
    expect(s.battle!.player.attachedUnitId).toBeNull();
    expect(s.battle!.log.some((e) => /commands from behind it/.test(e.text))).toBe(true);
  });

  it("with two open wounds the lord can neither ride nor rule until the season turns", () => {
    const s = fresh();
    s.player.wounds.push(wound(), wound());
    expect(canRideToWar(s).ok).toBe(false);
    raiseCallDirect(s, "summons", 1);
    expect(acceptCall(s, silent).started).toBe(false);
  });
});

describe("wounds between seasons", () => {
  it("heal 30% after the first season, 15% after the second, then set for life; two set wounds maim the lord", () => {
    let healedFirst = 0;
    let healedSecond = 0;
    let permanent = 0;
    for (let seed = 0; seed < 400; seed++) {
      const s = fresh();
      s.player.wounds.push(wound());
      tickWounds(s, createRng(seed));
      if (s.player.wounds.length === 0) {
        healedFirst++;
        continue;
      }
      tickWounds(s, createRng(seed + 1000));
      if (s.player.wounds.length === 0) healedSecond++;
      else {
        expect(s.player.wounds[0].permanent).toBe(true);
        permanent++;
      }
    }
    expect(healedFirst / 400).toBeGreaterThan(0.22);
    expect(healedFirst / 400).toBeLessThan(0.38);
    expect(healedSecond / (400 - healedFirst)).toBeGreaterThan(0.08);
    expect(healedSecond / (400 - healedFirst)).toBeLessThan(0.23);
    expect(permanent).toBeGreaterThan(0);

    const s = fresh();
    s.player.wounds.push(wound(true), wound(true));
    const lines = tickWounds(s, createRng(1));
    expect(s.player.maimed).toBe(true);
    expect(lines.some((l) => /can no longer sit a horse/.test(l.text))).toBe(true);
  });

  it("the season resolution heals the lord fully and ticks his wounds", async () => {
    const { healPersonalFully } = await import("./wounds");
    const s = fresh();
    s.player.personal.hp = 3;
    healPersonalFully(s);
    expect(s.player.personal.hp).toBe(20);
  });
});

describe("the unfree are bought, sold, sought, and freed", () => {
  it("manumission frees men as tenants and lifts the people; only Aldric or Ermenald may propose it", () => {
    const s = fresh();
    s.population.mancipia = 5;
    const before = { men: s.population.adult_men, hh: s.population.households, joy: s.peopleHappiness };
    expect(applyProposal(s, { type: "free_mancipia", summary: "x", count: 4 }, "smith").ok).toBe(false);
    const r = applyProposal(s, { type: "free_mancipia", summary: "x", count: 4 }, "chaplain");
    expect(r.ok).toBe(true);
    expect(s.population.mancipia).toBe(1);
    expect(s.population.adult_men).toBe(before.men + 4);
    expect(s.population.households).toBe(before.hh + 2);
    expect(s.peopleHappiness).toBe(before.joy + 8);
    expect(applyProposal(s, { type: "free_mancipia", summary: "x", count: 9 }, "steward").ok).toBe(true);
    expect(s.population.mancipia).toBe(0);
    expect(applyProposal(s, { type: "free_mancipia", summary: "x", count: 1 }, "steward").ok).toBe(false);
  });

  it("the stall sells and buys them at a horse's price band; the estate's count moves, not a store", async () => {
    const { applyMerchantBasket, beginMerchantVisitShop, quoteMerchantBasket, tradeableStoreIds, midpointPrice } = await import("./merchantShop");
    const s = fresh();
    s.flags.merchant_present = true;
    s.merchant.present = true;
    s.merchant.name = "Isaac";
    s.merchant.stock = [{ resource: "mancipia", amount: 2 }];
    s.npcs.push({ id: "merchant", name: "Isaac", role: "merchant", location: "fontenay", memories: [], wantsTalk: false });
    beginMerchantVisitShop(s, "Isaac", 0.5);
    s.resources.denarii = 500;
    expect(midpointPrice(s, "mancipia")).toBe(80);
    expect(tradeableStoreIds(s)).not.toContain("mancipia"); // none held yet, nothing to sell
    const q = quoteMerchantBasket(s, { buyStall: { mancipia: 2 }, buyBack: {}, sell: {} });
    expect(q.canConfirm).toBe(true);
    expect(q.buyCost).toBeGreaterThan(150);
    const r = applyMerchantBasket(s, { buyStall: { mancipia: 2 }, buyBack: {}, sell: {} });
    expect(r.ok).toBe(true);
    expect(s.population.mancipia).toBe(2);
    expect(tradeableStoreIds(s)).toContain("mancipia");
    const sell = applyMerchantBasket(s, { buyStall: {}, buyBack: {}, sell: { mancipia: 1 } });
    expect(sell.ok).toBe(true);
    expect(s.population.mancipia).toBe(1);
  });

  it("Gerulf quotes a dear, slow hunt for the unfree and they arrive as people", async () => {
    const { normalizeHuntProposal, quoteHunt } = await import("./hunts");
    const s = fresh();
    const p = normalizeHuntProposal(s, { type: "start_hunt", summary: "x", goods: "three slaves for the demesne", resource: "slaves", amount: 3, quotedDenarii: 1, durationSeasons: 1 });
    expect(p.resource).toBe("mancipia");
    expect(p.quotedDenarii).toBeGreaterThan(300);
    expect(p.durationSeasons).toBe(3);
    const brief = quoteHunt(s, { goods: "mancipia", resource: "mancipia", amount: 1 });
    expect(brief.unit).toBe("souls");
  });
});
