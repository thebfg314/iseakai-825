import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  findGlossaryHits,
  glossaryDefinitionParagraphs,
  glossaryEntry,
  type GlossaryScanContext,
} from "./glossary";

export type GlossaryOpen = {
  id: string;
  title: string;
  definition: string;
  anchor: { top: number; left: number; bottom: number; right: number } | null;
};

type GlossaryApi = {
  open: (id: string, anchor?: DOMRect | null) => void;
  close: () => void;
  current: GlossaryOpen | null;
};

const GlossaryCtx = createContext<GlossaryApi | null>(null);

export function useGlossary(): GlossaryApi | null {
  return useContext(GlossaryCtx);
}

export function GlossaryProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<GlossaryOpen | null>(null);

  const close = useCallback(() => setCurrent(null), []);

  const open = useCallback((id: string, anchor?: DOMRect | null) => {
    const entry = glossaryEntry(id);
    if (!entry) return;
    setCurrent({
      id: entry.id,
      title: entry.title,
      definition: entry.definition,
      anchor: anchor
        ? { top: anchor.top, left: anchor.left, bottom: anchor.bottom, right: anchor.right }
        : null,
    });
  }, []);

  return (
    <GlossaryCtx.Provider value={{ open, close, current }}>
      {children}
      {current ? <GlossaryPopover entry={current} onClose={close} /> : null}
    </GlossaryCtx.Provider>
  );
}

function popoverStyle(anchor: GlossaryOpen["anchor"]): CSSProperties | undefined {
  if (!anchor || typeof window === "undefined") return undefined;
  const width = Math.min(352, Math.max(240, window.innerWidth * 0.9));
  const left = Math.min(Math.max(8, anchor.left), Math.max(8, window.innerWidth - width - 8));
  const below = anchor.bottom + 8;
  const estimated = 220;
  const top =
    window.innerHeight - below < estimated
      ? Math.max(8, anchor.top - estimated)
      : below;
  return { position: "fixed", top, left, width };
}

export function GlossaryPopover({
  entry,
  onClose,
}: {
  entry: GlossaryOpen;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const style = popoverStyle(entry.anchor);
  const centered = !style;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose, entry.id]);

  return (
    <div className={centered ? "glossary-back glossary-back-center" : "glossary-back"} onClick={onClose}>
      <div
        ref={dialogRef}
        className="glossary-popover"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={style}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="glossary-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <h3 id={titleId}>{entry.title}</h3>
        {glossaryDefinitionParagraphs(entry.definition).map((p) => (
          <p key={p.slice(0, 24)}>{p}</p>
        ))}
      </div>
    </div>
  );
}

export function GlossaryText({
  text,
  context,
}: {
  text: string;
  context?: GlossaryScanContext;
}) {
  const api = useGlossary();
  const hits = findGlossaryHits(text, context);
  if (!hits.length) return <>{text}</>;

  const nodes: ReactNode[] = [];
  let cursor = 0;
  hits.forEach((hit, i) => {
    if (hit.start > cursor) nodes.push(text.slice(cursor, hit.start));
    nodes.push(
      <button
        key={`${hit.id}:${hit.start}:${i}`}
        type="button"
        className="glossary-term"
        data-glossary-id={hit.id}
        aria-haspopup="dialog"
        onClick={(e) => {
          e.stopPropagation();
          api?.open(hit.id, e.currentTarget.getBoundingClientRect());
        }}
      >
        {hit.matched}
      </button>,
    );
    cursor = hit.end;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return <>{nodes}</>;
}
