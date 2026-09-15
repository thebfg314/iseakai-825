import { HAPPINESS_ARROW, HAPPINESS_METER } from "./art";
import { happinessArrowLeftPercent, PEOPLE_HAPPINESS_LABEL, peopleHappinessVoice } from "./happinessMeter";

export function HappinessMeter({ value }: { value: number }) {
  const left = happinessArrowLeftPercent(value);
  const voice = peopleHappinessVoice(value);
  return (
    <div
      className="happiness-meter"
      role="meter"
      aria-label={PEOPLE_HAPPINESS_LABEL}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      aria-valuetext={voice}
      title={`${PEOPLE_HAPPINESS_LABEL} — ${voice}`}
    >
      <img className="happiness-meter-bar" src={HAPPINESS_METER} alt="" draggable={false} />
      <img
        className="happiness-meter-arrow"
        src={HAPPINESS_ARROW}
        alt=""
        draggable={false}
        style={{ left: `${left}%` }}
      />
    </div>
  );
}
