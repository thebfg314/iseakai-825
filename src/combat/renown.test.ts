import { describe, expect, it } from "vitest";
import {
  absorbMoraleLoss,
  applyRenown,
  commandPool,
  contributionScore,
  maxShieldFor,
  rankAndFileRenown,
  rankForRenown,
  rankTitle,
  renownDelta,
  resolveCommandClaim,
  spendShield,
  stickyRank,
  subCommandRenown,
} from "./renown";
import { requireUnitSheet } from "./registry";

describe("§5.2.1 rank thresholds", () => {
  it("1 / 100 / 500 / 1000 / 2000", () => {
    expect(rankForRenown(1)).toBe(1);
    expect(rankForRenown(99)).toBe(1);
    expect(rankForRenown(100)).toBe(2);
    expect(rankForRenown(500)).toBe(3);
    expect(rankForRenown(1000)).toBe(4);
    expect(rankForRenown(2000)).toBe(5);
    expect(rankTitle(1)).toBe("Minor Noble");
    expect(rankTitle(5)).toBe("King");
  });

  it("titles are sticky and Renown never drops below 1", () => {
    expect(stickyRank(3, 40)).toBe(3);
    expect(stickyRank(1, 600)).toBe(3);
    expect(applyRenown(10, -50)).toBe(1);
    expect(applyRenown(10, 25)).toBe(35);
  });

  it("delta is morale dealt minus morale taken, uncapped", () => {
    expect(renownDelta(120, 30)).toBe(90);
    expect(renownDelta(30, 120)).toBe(-90);
    expect(renownDelta(4000, 0)).toBe(4000);
  });
});

describe("§5.2.2 Command Pool", () => {
  it("pool = Renown × rank multiplier (1.0 / 1.5 / 2.0 / 2.75 / 3.5)", () => {
    expect(commandPool(100, 1)).toBe(100);
    expect(commandPool(100, 2)).toBe(150);
    expect(commandPool(100, 3)).toBe(200);
    expect(commandPool(100, 4)).toBe(275);
    expect(commandPool(100, 5)).toBe(350);
  });

  it("a unit never holds more shield than its own base Morale", () => {
    const levy = requireUnitSheet("peasant_levy");
    expect(maxShieldFor(levy.morale)).toBe(35);
    const spend = spendShield(100, 50, levy.morale);
    expect(spend.spent).toBe(35);
    expect(spend.poolAfter).toBe(65);
    expect(spendShield(spend.poolAfter, 10, levy.morale, spend.shieldAfter).spent).toBe(0);
    expect(spendShield(5, 50, 80).spent).toBe(5);
  });

  it("shield absorbs before Morale and the absorbed part still counts as morale taken", () => {
    const r = absorbMoraleLoss(10, 35, 14);
    expect(r).toEqual({ shield: 0, morale: 31, absorbed: 10, toMorale: 4 });
    expect(r.absorbed + r.toMorale).toBe(14);
  });
});

describe("tier Renown variants", () => {
  it("Rank-and-File: personal delta + Turning Point award, nothing from the file's orders (second review, item 7)", () => {
    expect(rankAndFileRenown(12, 30)).toBe(42);
    expect(rankAndFileRenown(-5, 0)).toBe(-5);
  });

  it("Sub-Command adds the objective bonus, which may be negative", () => {
    expect(subCommandRenown(120, 30, 25)).toBe(115);
    expect(subCommandRenown(120, 30, -40)).toBe(50);
  });
});

describe("Command Claim (stub)", () => {
  it("score = Renown + Σ(HP + ATK + DEF) of contributed units", () => {
    const cab = requireUnitSheet("caballarii");
    expect(contributionScore({ renown: 50, units: [cab] })).toBe(50 + 85 + 15 + 11);
  });

  it("no allies → no claim; otherwise the higher contribution takes command", () => {
    const cab = requireUnitSheet("caballarii");
    const hh = requireUnitSheet("heavy_horse");
    expect(resolveCommandClaim({ renown: 50, units: [cab] }, []).playerWins).toBe(false);
    const lose = resolveCommandClaim({ renown: 50, units: [cab] }, [{ renown: 300, units: [hh, hh] }]);
    expect(lose.playerWins).toBe(false);
    const win = resolveCommandClaim({ renown: 600, units: [cab, hh] }, [{ renown: 100, units: [cab] }]);
    expect(win.playerWins).toBe(true);
    expect(win.bestAllyScore).toBe(100 + 85 + 15 + 11);
  });
});
