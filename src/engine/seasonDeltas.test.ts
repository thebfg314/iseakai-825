import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { consumeGrain } from "./grain";
import { WorldStateSchema } from "./schema";
import { resolveAgricultureAndProjects } from "./season";
import { diffSeasonLedger, snapshotSeasonLedger, writeLastSeasonDeltas } from "./seasonDeltas";

function boot() {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

describe("season ledger deltas", () => {
  it("starts a new game with no last-season deltas", () => {
    const state = boot();
    expect(state.last_season_deltas).toEqual({});
  });

  it("omits +0 and rounds like the ledger", () => {
    const state = boot();
    const before = snapshotSeasonLedger(state);
    expect(diffSeasonLedger(before, state)).toEqual({});
    state.resources.wheat += 1.25;
    state.resources.wool += 0;
    const deltas = diffSeasonLedger(before, state);
    expect(deltas.wheat).toBe(1.3);
    expect(deltas.wool).toBeUndefined();
    expect(deltas.denarii).toBeUndefined();
  });

  it("records a signed grain consume without touching livestock luck", () => {
    const state = boot();
    const ryeBefore = state.resources.rye;
    const before = snapshotSeasonLedger(state);
    consumeGrain(state, 5, "Households");
    const deltas = diffSeasonLedger(before, state);
    expect(deltas.rye).toBe(-5);
    expect(state.resources.rye).toBe(ryeBefore - 5);
    expect(deltas.wheat).toBeUndefined();
    expect(deltas.cattle).toBeUndefined();
    expect(deltas.sheep).toBeUndefined();
  });

  it("records harvest gains and sown losses on a summer tick", () => {
    const state = boot();
    state.meta.season = "summer";
    const wheatAcres = state.holdings[0].sown.wheat;
    const ryeAcres = state.holdings[0].sown.rye;
    const wheatBefore = state.resources.wheat;
    const before = snapshotSeasonLedger(state);
    resolveAgricultureAndProjects(state);
    const deltas = diffSeasonLedger(before, state);
    expect(wheatAcres).toBeGreaterThan(0);
    expect(deltas.wheat).toBeGreaterThan(0);
    expect(deltas.sown_wheat).toBe(-wheatAcres);
    expect(deltas.sown_rye).toBe(-ryeAcres);
    expect(state.holdings[0].sown.wheat).toBe(0);
    expect(state.holdings[0].sown.rye).toBe(0);
    expect(state.resources.wheat).toBeGreaterThan(wheatBefore);
    expect(deltas.wheat).toBe(state.resources.wheat - wheatBefore);
  });

  it("records spring consume, wool shear, and sowing, then replaces the previous diffs", () => {
    const state = boot();
    expect(state.meta.season).toBe("spring");
    const before = snapshotSeasonLedger(state);
    resolveAgricultureAndProjects(state);
    writeLastSeasonDeltas(state, before);
    expect(state.last_season_deltas.rye).toBeLessThan(0);
    expect(state.last_season_deltas.wool).toBeGreaterThan(0);
    expect(state.last_season_deltas.sown_barley).toBe(1.8);
    expect(state.last_season_deltas.sown_oats).toBe(1.2);

    const mid = snapshotSeasonLedger(state);
    consumeGrain(state, 2, "Households");
    writeLastSeasonDeltas(state, mid);
    expect(state.last_season_deltas.wool).toBeUndefined();
    expect(state.last_season_deltas.sown_barley).toBeUndefined();
    expect(state.last_season_deltas.rye).toBeLessThan(0);
  });
});
