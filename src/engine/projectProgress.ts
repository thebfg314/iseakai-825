import type { Project, Season, WorldState } from "./schema";

export function stampProjectStart(state: WorldState, proj: Project): void {
  if (proj.startedYear == null) proj.startedYear = state.meta.year;
  if (!proj.startedSeason) proj.startedSeason = state.meta.season;
}

export function stampProjectEnded(state: WorldState, proj: Project): void {
  proj.completedYear = state.meta.year;
  proj.completedSeason = state.meta.season;
  markProjectSeason(state, proj);
}

/** Record this season's progress as written — do not invent earlier marks. */
export function markProjectSeason(state: WorldState, proj: Project): void {
  stampProjectStart(state, proj);
  const marks = proj.seasonMarks ?? [];
  const last = marks[marks.length - 1];
  if (last && last.year === state.meta.year && last.season === state.meta.season) {
    last.labourDaysDone = proj.labourDaysDone;
    if (proj.hunt) last.huntSeasonsElapsed = proj.hunt.seasonsElapsed;
    if (proj.smithing) last.smithingSeasonsElapsed = proj.smithing.seasonsElapsed;
  } else {
    marks.push({
      year: state.meta.year,
      season: state.meta.season,
      labourDaysDone: proj.labourDaysDone,
      huntSeasonsElapsed: proj.hunt?.seasonsElapsed,
      smithingSeasonsElapsed: proj.smithing?.seasonsElapsed,
    });
  }
  proj.seasonMarks = marks;
}

export function seasonsBetween(
  startSeason: Season,
  startYear: number,
  endSeason: Season,
  endYear: number,
): number {
  const seasons: Season[] = ["spring", "summer", "autumn", "winter"];
  const idx = (year: number, season: Season) => year * 4 + seasons.indexOf(season);
  return Math.max(1, idx(endYear, endSeason) - idx(startYear, startSeason) + 1);
}
