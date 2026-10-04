import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  TUTORIAL_NPC_NAMES,
  TUTORIAL_OFFER,
  TUTORIAL_STEPS,
  TUTORIAL_TITLE,
  isLastTutorialStep,
  nextTutorialState,
  tutorialAwaitingReply,
  tutorialEntryFrom,
  tutorialEntryUpdate,
  tutorialNextHint as nextHint,
  tutorialProgressLabel,
  tutorialStep,
  tutorialStepSatisfied,
  tutorialWaitingNote,
  type TutorialEntry,
  type TutorialState,
  type TutorialStep,
  type TutorialWatch,
} from "../engine/tutorial";
import { GlossaryText } from "./GlossaryText";

export type Rect = { top: number; left: number; width: number; height: number };
export type ArrowSide = "up" | "down" | "left" | "right" | "none";

export type TutorialBoxPlacement = {
  top: number;
  left: number;
  arrow: ArrowSide;
  /** Distance along the arrow's edge from the box's top-left corner. */
  arrowOffset: number;
  spot: Rect | null;
};

const EDGE = 8;
const GAP = 16;
const SPOT_PAD = 6;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Where the box goes next to its anchor: below, above, right, then left, the
 * first that fits. The arrow sits on the edge facing the anchor, at its centre.
 */
export function placeTutorialBox(
  anchor: Rect | null,
  box: { width: number; height: number },
  viewport: { width: number; height: number },
): TutorialBoxPlacement {
  const { width: w, height: h } = box;
  if (!anchor) {
    return {
      top: Math.max(EDGE, (viewport.height - h) / 2),
      left: Math.max(EDGE, (viewport.width - w) / 2),
      arrow: "none",
      arrowOffset: 0,
      spot: null,
    };
  }
  const spot: Rect = {
    top: anchor.top - SPOT_PAD,
    left: anchor.left - SPOT_PAD,
    width: anchor.width + SPOT_PAD * 2,
    height: anchor.height + SPOT_PAD * 2,
  };
  const cx = anchor.left + anchor.width / 2;
  const cy = anchor.top + anchor.height / 2;
  const maxLeft = Math.max(EDGE, viewport.width - w - EDGE);
  const maxTop = Math.max(EDGE, viewport.height - h - EDGE);

  const horizontal = (top: number, arrow: ArrowSide): TutorialBoxPlacement => {
    const left = clamp(cx - w / 2, EDGE, maxLeft);
    return { top, left, arrow, arrowOffset: clamp(cx - left, 18, w - 18), spot };
  };
  const vertical = (left: number, arrow: ArrowSide): TutorialBoxPlacement => {
    const top = clamp(cy - h / 2, EDGE, maxTop);
    return { top, left, arrow, arrowOffset: clamp(cy - top, 18, h - 18), spot };
  };

  if (spot.top + spot.height + GAP + h <= viewport.height - EDGE) return horizontal(spot.top + spot.height + GAP, "up");
  if (spot.top - GAP - h >= EDGE) return horizontal(spot.top - GAP - h, "down");
  if (spot.left + spot.width + GAP + w <= viewport.width - EDGE) return vertical(spot.left + spot.width + GAP, "left");
  if (spot.left - GAP - w >= EDGE) return vertical(spot.left - GAP - w, "right");
  return { ...horizontal(clamp(spot.top + spot.height + GAP, EDGE, maxTop), "up") };
}

function samePlacement(a: TutorialBoxPlacement | null, b: TutorialBoxPlacement): boolean {
  if (!a) return false;
  if (a.top !== b.top || a.left !== b.left || a.arrow !== b.arrow || a.arrowOffset !== b.arrowOffset) return false;
  if (!a.spot || !b.spot) return a.spot === b.spot;
  return a.spot.top === b.spot.top && a.spot.left === b.spot.left && a.spot.width === b.spot.width && a.spot.height === b.spot.height;
}

/** Narrator paragraphs; consecutive "• " lines become one list. */
export function TutorialProse({ paragraphs }: { paragraphs: readonly string[] }) {
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (!bullets.length) return;
    out.push(
      <ul key={`ul-${out.length}`}>
        {bullets.map((b) => (
          <li key={b}>
            <GlossaryText text={b} />
          </li>
        ))}
      </ul>,
    );
    bullets = [];
  };
  for (const p of paragraphs) {
    if (p.startsWith("• ")) {
      bullets.push(p.slice(2));
      continue;
    }
    flush();
    out.push(
      <p key={p.slice(0, 40)}>
        <GlossaryText text={p} />
      </p>,
    );
  }
  flush();
  return <>{out}</>;
}

export function TutorialOverlay({
  tutorial,
  watch,
  onChange,
  onSay,
}: {
  tutorial: TutorialState;
  watch: TutorialWatch;
  onChange: (next: TutorialState) => void;
  /** Put the line in the lord's mouth: switch to that speaker if needed and fill the composer. */
  onSay: (npcId: string, text: string) => void;
}) {
  if (tutorial.status === "offered") {
    return (
      <div className="tutorial-back" role="dialog" aria-modal="true" aria-label={TUTORIAL_TITLE}>
        <div className="tutorial-box tutorial-offer">
          <div className="tutorial-kicker">{TUTORIAL_TITLE}</div>
          <h3>Isekai in the Year of Our Lord 825</h3>
          <p>{TUTORIAL_OFFER}</p>
          <div className="tutorial-actions">
            <button type="button" className="primary" onClick={() => onChange({ status: "active", step: 0 })}>
              Yes
            </button>
            <button type="button" onClick={() => onChange({ status: "declined", step: 0 })}>
              No
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (tutorial.status !== "active") return null;
  return <TutorialStepBox tutorial={tutorial} watch={watch} onChange={onChange} onSay={onSay} />;
}

function TutorialStepBox({
  tutorial,
  watch,
  onChange,
  onSay,
}: {
  tutorial: TutorialState;
  watch: TutorialWatch;
  onChange: (next: TutorialState) => void;
  onSay: (npcId: string, text: string) => void;
}) {
  const step: TutorialStep = tutorialStep(tutorial.step);
  const stepKey = `${tutorial.status}:${tutorial.step}`;
  const entryRef = useRef<{ key: string; entry: TutorialEntry } | null>(null);
  const [, bump] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<TutorialBoxPlacement | null>(null);

  // Arrive at the step, then watch the game for the moment that moves it on.
  // A step the game has already satisfied on arrival passes straight through.
  useEffect(() => {
    let entry: TutorialEntry;
    if (!entryRef.current || entryRef.current.key !== stepKey) {
      entry = tutorialEntryFrom(watch);
      entryRef.current = { key: stepKey, entry };
      bump((n) => n + 1);
    } else {
      entry = tutorialEntryUpdate(entryRef.current.entry, watch);
      if (entry !== entryRef.current.entry) {
        entryRef.current = { key: stepKey, entry };
        bump((n) => n + 1);
      }
    }
    if (tutorialStepSatisfied(step, entry, watch)) onChange(nextTutorialState(tutorial, step));
    // Only the facts the rules read; the step object is derived from stepKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey, watch.sceneNpcId, watch.messages.length, watch.pendingCount, watch.turn, watch.busy]);

  useLayoutEffect(() => {
    let frame = 0;
    const place = () => {
      const el = step.anchor ? document.getElementById(step.anchor) : null;
      const rect = el ? el.getBoundingClientRect() : null;
      const anchor = rect && rect.width > 0 && rect.height > 0 ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null;
      const box = boxRef.current;
      const size = { width: box?.offsetWidth ?? 400, height: box?.offsetHeight ?? 240 };
      const next = placeTutorialBox(anchor, size, { width: window.innerWidth, height: window.innerHeight });
      setPlacement((prev) => (samePlacement(prev, next) ? prev : next));
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        place();
      });
    };
    place();
    const el = step.anchor ? document.getElementById(step.anchor) : null;
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, true);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    observer?.observe(document.body);
    if (boxRef.current && observer) observer.observe(boxRef.current);
    const tick = window.setInterval(schedule, 500);
    return () => {
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, true);
      observer?.disconnect();
      window.clearInterval(tick);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [step.anchor, step.id, watch.pendingCount, watch.sceneNpcId, watch.messages.length]);

  const entry = entryRef.current?.key === stepKey ? entryRef.current.entry : tutorialEntryFrom(watch);
  const waitingOn = step.say && tutorialAwaitingReply(step, entry, watch) ? step.say.npcId : step.waitFor && watch.busy ? step.waitFor : null;
  const last = isLastTutorialStep(tutorial.step);
  const sayName = step.say ? (TUTORIAL_NPC_NAMES[step.say.npcId] ?? "them") : "";
  const [closing, setClosing] = useState(false);
  useEffect(() => setClosing(false), [stepKey]);

  const boxStyle: CSSProperties = placement
    ? { top: placement.top, left: placement.left, visibility: "visible" }
    : { top: 0, left: 0, visibility: "hidden" };
  const arrowStyle: CSSProperties | undefined =
    placement && placement.arrow !== "none"
      ? placement.arrow === "up" || placement.arrow === "down"
        ? { left: placement.arrowOffset }
        : { top: placement.arrowOffset }
      : undefined;

  return (
    <div className="tutorial-layer" aria-live="polite">
      {placement?.spot ? (
        <div
          className="tutorial-spot"
          style={{ top: placement.spot.top, left: placement.spot.left, width: placement.spot.width, height: placement.spot.height }}
        />
      ) : (
        <div className="tutorial-dim" />
      )}
      <div
        ref={boxRef}
        className={`tutorial-box tutorial-step arrow-${placement?.arrow ?? "none"}`}
        style={boxStyle}
        role="dialog"
        aria-label={`${TUTORIAL_TITLE}: ${step.section}`}
      >
        {arrowStyle && <span className="tutorial-arrow" style={arrowStyle} aria-hidden="true" />}
        <div className="tutorial-inner">
        <div className="tutorial-head">
          <div className="tutorial-kicker">
            <span>{TUTORIAL_TITLE}</span>
            <span className="tutorial-progress">{tutorialProgressLabel(tutorial.step)}</span>
          </div>
          <h3>{step.section}</h3>
        </div>
        <div className="tutorial-body">
          <TutorialProse paragraphs={step.paragraphs} />
          {step.say && (
            <>
              <blockquote className="tutorial-line">{step.say.text}</blockquote>
              <p className="tutorial-say-help">
                “Put these words in my mouth” below fills what you will say to {sayName}; press Speak to send it.
              </p>
            </>
          )}
          {step.after && <TutorialProse paragraphs={step.after} />}
          {waitingOn && <p className="tutorial-waiting">{tutorialWaitingNote(waitingOn)}</p>}
        </div>
        <div className="tutorial-actions">
          {closing ? (
            <>
              <span className="tutorial-count">Close the tutorial for this game?</span>
              <span className="tutorial-close-choice">
                <button type="button" onClick={() => onChange({ status: "declined", step: tutorial.step })}>
                  Close it
                </button>
                <button type="button" className="primary" onClick={() => setClosing(false)}>
                  Keep going
                </button>
              </span>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setClosing(true)}>
                Close tutorial
              </button>
              <span className="tutorial-count">
                {tutorial.step + 1} / {TUTORIAL_STEPS.length}
              </span>
              {last ? (
                <button type="button" className="primary" onClick={() => onChange({ status: "done", step: tutorial.step })}>
                  {step.finishLabel ?? "Finish"}
                </button>
              ) : step.say && !waitingOn ? (
                <button
                  type="button"
                  className="primary"
                  disabled={watch.busy}
                  onClick={() => step.say && onSay(step.say.npcId, step.say.text)}
                >
                  Put these words in my mouth
                </button>
              ) : (
                <span className="tutorial-next-hint">{nextHint(step)}</span>
              )}
            </>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
