import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import startingEstate from "../../data/starting-estate.json";
import { labourPool } from "./labour";
import { peopleEffortFactor } from "./peopleHappiness";
import {
  ARRIVAL_CHANCE_CAP,
  ARRIVAL_CONFIRM_LINE,
  ARRIVAL_REFUSE_LINE,
  ARRIVAL_SEASON_NOTE,
  ARRIVAL_STREAK_MIN,
  ARRIVAL_SUMMARY,
  ABANDONED_GAME_OVER,
  arrivalChance,
  canDepartHousehold,
  DEPARTURE_CHANCE_CAP,
  DEPARTURE_SEASON_NOTE,
  DEPARTURE_STREAK_MIN,
  departureChance,
  departureDelta,
  makeArrivalProposal,
  resolvePeopleMovement,
  tickHappinessStreaks,
} from "./peopleMovement";
import { WorldStateSchema, type WorldState } from "./schema";
import { defaultAppSettings } from "../llm/settings";
import { GameController } from "../session/game";

function boot(extra?: (s: WorldState) => void): WorldState {
  const state = WorldStateSchema.parse(structuredClone(startingEstate));
  extra?.(state);
  return state;
}

function tempGame(extra?: (s: WorldState) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "isekai-"));
  return new GameController(boot(extra), dir, defaultAppSettings());
}

describe("happiness streaks", () => {
  it("defaults to 0 on old saves that omit the fields", () => {
    const raw = structuredClone(startingEstate) as {
      peopleHappinessHighStreak?: number;
      peopleHappinessLowStreak?: number;
      estateAbandoned?: boolean;
    };
    delete raw.peopleHappinessHighStreak;
    delete raw.peopleHappinessLowStreak;
    delete raw.estateAbandoned;
    const state = WorldStateSchema.parse(raw);
    expect(state.peopleHappinessHighStreak).toBe(0);
    expect(state.peopleHappinessLowStreak).toBe(0);
    expect(state.estateAbandoned).toBe(false);
  });

  it("counts consecutive joyful or wretched seasons and resets on settled", () => {
    const state = boot();
    state.peopleHappiness = 80;
    expect(tickHappinessStreaks(state)).toEqual({ high: 1, low: 0 });
    expect(tickHappinessStreaks(state)).toEqual({ high: 2, low: 0 });
    state.peopleHappiness = 50;
    expect(tickHappinessStreaks(state)).toEqual({ high: 0, low: 0 });
    state.peopleHappiness = 10;
    expect(tickHappinessStreaks(state)).toEqual({ high: 0, low: 1 });
    expect(tickHappinessStreaks(state)).toEqual({ high: 0, low: 2 });
    state.peopleHappiness = 90;
    expect(tickHappinessStreaks(state)).toEqual({ high: 1, low: 0 });
  });
});

describe("rising odds", () => {
  it("is zero until the second consecutive season, then rises and caps", () => {
    expect(arrivalChance(0)).toBe(0);
    expect(arrivalChance(1)).toBe(0);
    expect(arrivalChance(ARRIVAL_STREAK_MIN)).toBeCloseTo(0.15);
    expect(arrivalChance(3)).toBeCloseTo(0.3);
    expect(arrivalChance(4)).toBeCloseTo(ARRIVAL_CHANCE_CAP);
    expect(arrivalChance(12)).toBe(ARRIVAL_CHANCE_CAP);
    expect(departureChance(1)).toBe(0);
    expect(departureChance(DEPARTURE_STREAK_MIN)).toBeCloseTo(0.2);
    expect(departureChance(3)).toBeCloseTo(0.4);
    expect(departureChance(8)).toBe(DEPARTURE_CHANCE_CAP);
    expect(ARRIVAL_CHANCE_CAP).toBeLessThan(1);
    expect(DEPARTURE_CHANCE_CAP).toBeLessThan(1);
  });
});

describe("arrivals", () => {
  it("offers a Confirm after a joyful streak when the roll hits, and does nothing when it misses", () => {
    const hit = boot((s) => {
      s.peopleHappiness = 80;
      s.peopleHappinessHighStreak = 1;
    });
    const offered = resolvePeopleMovement(hit, () => 0);
    expect(hit.peopleHappinessHighStreak).toBe(2);
    expect(offered.arrival?.type).toBe("settle_households");
    expect(offered.arrival?.summary).toBe(ARRIVAL_SUMMARY);
    expect(offered.arrivalNote).toBe(ARRIVAL_SEASON_NOTE);
    expect(offered.departureNote).toBeUndefined();
    expect(hit.population.households).toBe(10);

    const miss = boot((s) => {
      s.peopleHappiness = 80;
      s.peopleHappinessHighStreak = 1;
    });
    expect(resolvePeopleMovement(miss, () => 0.99).arrival).toBeUndefined();
  });

  it("does not change the books until Confirm, and refuse leaves the people as they were", () => {
    const game = tempGame((s) => {
      s.peopleHappiness = 90;
    });
    const before = { ...game.state.population };
    const poolBefore = { ...labourPool(game.state) };
    game.queueProposal("steward", makeArrivalProposal());
    const pending = game.pending.filter((p) => p.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].proposal.type).toBe("settle_households");
    expect(game.state.population.households).toBe(before.households);

    const accepted = game.confirmProposal(pending[0].id);
    expect(accepted.state.population.households).toBe(before.households + 1);
    expect(accepted.state.population.adult_men).toBe(before.adult_men + 1);
    expect(accepted.state.population.adult_women).toBe(before.adult_women + 1);
    expect(accepted.state.population.youths).toBe(before.youths + 1);
    expect(accepted.state.holdings[0].households).toBe(before.households + 1);
    expect(labourPool(accepted.state).men).toBeGreaterThan(poolBefore.men);
    expect(accepted.messages.some((m) => m.text.includes(ARRIVAL_CONFIRM_LINE))).toBe(true);

    const refused = tempGame();
    const pop = { ...refused.state.population };
    refused.queueProposal("steward", makeArrivalProposal());
    const id = refused.pending.find((p) => p.status === "pending")!.id;
    refused.rejectProposal(id);
    expect(refused.state.population).toEqual(pop);
    expect(refused.messages.some((m) => m.text === ARRIVAL_REFUSE_LINE)).toBe(true);
    expect(refused.pending.find((p) => p.id === id)?.status).toBe("rejected");
  });
});

describe("departures", () => {
  it("removes a household at once when the roll hits, with no Confirm", () => {
    const state = boot((s) => {
      s.peopleHappiness = 8;
      s.peopleHappinessLowStreak = 3;
    });
    const before = { ...state.population };
    const result = resolvePeopleMovement(state, () => 0);
    expect(result.departureNote).toBe(DEPARTURE_SEASON_NOTE);
    expect(result.arrival).toBeUndefined();
    expect(state.population.households).toBe(before.households - 1);
    expect(state.population.adult_men).toBe(before.adult_men - 1);
    expect(state.population.adult_women).toBe(before.adult_women - 1);
    expect(state.holdings[0].households).toBe(before.households - 1);
  });

  it("cannot be stopped by refusing, and may fall below the old four-household floor", () => {
    const state = boot((s) => {
      s.peopleHappiness = 4;
      s.population.households = 4;
      s.population.adult_men = 4;
      s.population.adult_women = 4;
      s.population.youths = 2;
      s.holdings[0].households = 4;
      s.peopleHappinessLowStreak = 8;
    });
    expect(canDepartHousehold(state)).toBe(true);
    expect(departureDelta(state)).toEqual({
      households: -1,
      adult_men: -1,
      adult_women: -1,
      youths: -1,
    });
    const result = resolvePeopleMovement(state, () => 0);
    expect(result.departureNote).toBe(DEPARTURE_SEASON_NOTE);
    expect(result.abandoned).toBeUndefined();
    expect(state.estateAbandoned).toBe(false);
    expect(state.population.households).toBe(3);
    expect(state.population.adult_men).toBe(3);
    expect(state.population.adult_women).toBe(3);
    expect(state.population.youths).toBe(1);

    const game = tempGame((s) => {
      s.peopleHappiness = 8;
      s.peopleHappinessLowStreak = 4;
    });
    const before = game.state.population.households;
    const movement = resolvePeopleMovement(game.state, () => 0);
    expect(movement.departureNote).toBe(DEPARTURE_SEASON_NOTE);
    expect(game.pending.filter((p) => p.status === "pending")).toHaveLength(0);
    expect(game.state.population.households).toBe(before - 1);
  });

  it("ends the game when the last household slips away", async () => {
    const game = tempGame((s) => {
      s.peopleHappiness = 4;
      s.peopleHappinessLowStreak = 8;
      s.population.households = 1;
      s.population.adult_men = 1;
      s.population.adult_women = 1;
      s.population.youths = 1;
      s.holdings[0].households = 1;
    });
    expect(game.messages.some((m) => /I am Aldric/.test(m.text))).toBe(true);

    const result = resolvePeopleMovement(game.state, () => 0);
    expect(result.departureNote).toBe(DEPARTURE_SEASON_NOTE);
    expect(result.abandoned).toBe(true);
    expect(result.gameOverNote).toBe(ABANDONED_GAME_OVER);
    expect(game.state.estateAbandoned).toBe(true);
    expect(game.state.population.households).toBe(0);
    expect(game.state.population.adult_men).toBe(0);
    expect(game.state.holdings[0].households).toBe(0);
    expect(game.view().state.estateAbandoned).toBe(true);

    const talk = await game.sendDialogue("steward", "What news of the people?");
    expect(talk.error).toBe(ABANDONED_GAME_OVER);
    const season = await game.advanceSeason();
    expect(season.effects?.some((e) => e.text === ABANDONED_GAME_OVER)).toBe(true);
  });

  it("treats an already empty holding as abandoned without a further roll", () => {
    const empty = boot((s) => {
      s.population.households = 0;
      s.population.adult_men = 0;
      s.population.adult_women = 0;
      s.population.youths = 0;
      s.holdings[0].households = 0;
    });
    expect(canDepartHousehold(empty)).toBe(false);
    expect(departureDelta(empty)).toBeNull();
    const result = resolvePeopleMovement(empty, () => 0);
    expect(result.abandoned).toBe(true);
    expect(result.gameOverNote).toBe(ABANDONED_GAME_OVER);
    expect(empty.estateAbandoned).toBe(true);

    const loaded = tempGame((s) => {
      s.population.households = 0;
      s.population.adult_men = 0;
      s.population.adult_women = 0;
      s.population.youths = 0;
      s.holdings[0].households = 0;
    });
    expect(loaded.state.estateAbandoned).toBe(true);
    expect(loaded.messages).toHaveLength(0);
  });
});

describe("effort curve stays independent", () => {
  it("does not change hidden effort when people join or leave", () => {
    const game = tempGame((s) => {
      s.peopleHappiness = 90;
    });
    const effort = peopleEffortFactor(game.state);
    game.queueProposal("steward", makeArrivalProposal());
    game.confirmProposal(game.pending.find((p) => p.status === "pending")!.id);
    expect(peopleEffortFactor(game.state)).toBe(effort);

    const low = boot((s) => {
      s.peopleHappiness = 8;
      s.peopleHappinessLowStreak = 4;
    });
    const lowEffort = peopleEffortFactor(low);
    resolvePeopleMovement(low, () => 0);
    expect(peopleEffortFactor(low)).toBe(lowEffort);
  });

  it("speaks hall language, not engine jargon", () => {
    expect(ARRIVAL_SEASON_NOTE).not.toMatch(/happiness|peopleHappiness|moodFactor|settle_households/i);
    expect(DEPARTURE_SEASON_NOTE).not.toMatch(/happiness|peopleHappiness|moodFactor/i);
    expect(ABANDONED_GAME_OVER).not.toMatch(/happiness|peopleHappiness|moodFactor|game over|estateAbandoned/i);
    expect(ABANDONED_GAME_OVER).toMatch(/villa stands empty/i);
    expect(ARRIVAL_SUMMARY).toMatch(/demesne people/i);
  });
});
