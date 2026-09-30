import { describe, expect, it } from "vitest";
import startingEstate from "../../data/starting-estate.json";
import { WorldStateSchema } from "./schema";
import { applyProposal } from "./applyDelta";
import { resolveAgricultureAndProjects } from "./season";
import { archiveEstateSeason, captureEstateSeason, clampEstateOffset, estatePagerFlags, snapshotAtOffset } from "./estateBooks";

function boot() {
  return WorldStateSchema.parse(structuredClone(startingEstate));
}

describe("estate season books", () => {
  it("archives the figures as they stood, not later live totals", () => {
    const live = boot();
    const before = boot();
    expect(before.resources.denarii).toBe(138);
    live.resources.denarii = 40;
    archiveEstateSeason(live, before);
    expect(live.estate_history).toHaveLength(1);
    expect(live.estate_history[0].season).toBe("spring");
    expect(live.estate_history[0].year).toBe(825);
    expect(live.estate_history[0].resources.denarii).toBe(138);
    expect(live.estate_history[0].population.households).toBe(10);
    expect(live.estate_history[0].holdings[0].sown.wheat).toBe(6);
    expect(live.resources.denarii).toBe(40);
  });

  it("does not invent a second copy of the same season", () => {
    const live = boot();
    archiveEstateSeason(live, boot());
    archiveEstateSeason(live, boot());
    expect(live.estate_history).toHaveLength(1);
  });

  it("stamps a begun work and keeps season marks after the work advances", () => {
    const state = boot();
    state.resources.softwood = 40;
    state.resources.hardwood = 20;
    state.resources.iron = 80;
    state.resources.stone = 20;
    const started = applyProposal(
      state,
      { type: "start_project", summary: "Begin a flour mill", projectKey: "flour_mill", holdingId: "fontenay" },
      "steward",
    );
    expect(started.ok).toBe(true);
    const mill = state.projects.find((p) => p.key === "flour_mill")!;
    expect(mill.startedSeason).toBe("spring");
    expect(mill.startedYear).toBe(825);
    resolveAgricultureAndProjects(state);
    expect(mill.seasonMarks?.length).toBeGreaterThanOrEqual(1);
    expect(mill.seasonMarks?.[0].season).toBe("spring");
    expect(mill.seasonMarks?.[0].year).toBe(825);
    expect(mill.labourDaysDone).toBeGreaterThan(0);
    expect(mill.seasonMarks?.[0].labourDaysDone).toBe(mill.labourDaysDone);
  });
});

describe("estate pager offsets", () => {
  it("treats 0 as this season and hides forward there", () => {
    expect(estatePagerFlags(0, 2)).toEqual({
      offset: 0,
      viewingCurrent: true,
      canGoBack: true,
      canGoForward: false,
      showForward: false,
    });
    expect(estatePagerFlags(1, 2).showForward).toBe(true);
    expect(estatePagerFlags(1, 2).canGoForward).toBe(true);
    expect(clampEstateOffset(9, 2)).toBe(2);
    const history = [captureEstateSeason(boot())];
    expect(snapshotAtOffset(history, 0)).toBeUndefined();
    expect(snapshotAtOffset(history, 1)?.season).toBe("spring");
  });
});
