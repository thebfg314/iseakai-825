import type { WorldState } from "../engine/schema";
import { VASSAL_ICONS } from "./art";
import { vassalFigures, vassalRowTitle } from "./vassalsView";

/** The sworn men as a row of figures beneath the people's happiness meter; nothing until the lord has rank. */
export function VassalRow({ state }: { state: WorldState }) {
  const figures = vassalFigures(state);
  if (!figures.length) return null;
  return (
    <div className="vassal-row" role="list" aria-label={vassalRowTitle(state)} title={vassalRowTitle(state)}>
      {figures.map((f) => (
        <img
          key={f.id}
          role="listitem"
          className={`vassal-figure vassal-${f.mood}${f.group ? " vassal-group" : ""}`}
          src={VASSAL_ICONS[f.mood]}
          alt={f.title}
          title={f.title}
          draggable={false}
        />
      ))}
    </div>
  );
}
