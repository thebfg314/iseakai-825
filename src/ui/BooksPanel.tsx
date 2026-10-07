import { useEffect, useState } from "react";
import { PROJECT_CATALOG } from "../engine/projectCatalog";
import { CANONICAL_RESOURCES } from "../engine/schema";
import type { GameView } from "../shared/types";
import {
  BOOKS_TAB_LABELS,
  BOOKS_TABS,
  armsBook,
  customsBookEntries,
  customsEmptyLines,
  estatePagerView,
  labourBookEntries,
  laboursEmptyLine,
  selectBooksTab,
  stepEstateOffset,
  type BooksTab,
  type EstateLedgerSource,
  type LabourBookEntry,
} from "./booksView";
import {
  BOOKS_TITLE,
  HUNGER_LINE,
  featuresSentence,
  formatLedgerNumber,
  formatSignedDelta,
  labourSentence,
  landName,
  marketLine,
  merchantPresentLine,
  peopleSentence,
  resourceName,
  resourceUnit,
  armsBookLine,
  roleName,
  sowingShareLine,
  sowingRotationLine,
} from "./ledgerCopy";
import { GlossaryText } from "./GlossaryText";

export function BooksPanel({
  view,
  onCancelForthcoming,
  initialTab = "estate",
}: {
  view: GameView;
  onCancelForthcoming?: (id: string) => void;
  initialTab?: BooksTab;
}) {
  const [tab, setTab] = useState<BooksTab>(initialTab);
  const [estateOffset, setEstateOffset] = useState(0);
  const historyLength = view.state.estate_history?.length ?? 0;
  const seasonKey = `${view.state.meta.year}:${view.state.meta.season}:${view.state.meta.turn}`;

  useEffect(() => {
    setEstateOffset(0);
  }, [seasonKey]);

  const pager = estatePagerView(view, estateOffset);
  const labours = labourBookEntries(view.state);
  const customs = customsBookEntries(view.state);
  const customsEmpty = customsEmptyLines(customs);

  return (
    <aside className="ledger" id="books-panel">
      <div className="ledger-head">
        <h2>
          <GlossaryText text={BOOKS_TITLE} />
        </h2>
        <div className="books-tabs" id="books-tabs" role="tablist" aria-label={BOOKS_TITLE}>
          {BOOKS_TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(selectBooksTab(tab, id))}
            >
              {BOOKS_TAB_LABELS[id]}
            </button>
          ))}
        </div>
      </div>
      <div className="ledger-body">
        {tab === "estate" && (
          <EstateTab
            pager={pager}
            historyLength={historyLength}
            onBack={() => setEstateOffset((o) => stepEstateOffset(o, historyLength, true))}
            onForward={() => setEstateOffset((o) => stepEstateOffset(o, historyLength, false))}
          />
        )}
        {tab === "labours" && <LaboursTab entries={labours} />}
        {tab === "arms" && <ArmsTab book={armsBook(view.state)} />}
        {tab === "customs" && (
          <CustomsTab
            forthcoming={customs.forthcoming}
            orders={customs.orders}
            laws={customs.laws}
            letters={customs.letters}
            empty={customsEmpty}
            onCancelForthcoming={onCancelForthcoming}
          />
        )}
      </div>
    </aside>
  );
}

function EstateTab({
  pager,
  historyLength,
  onBack,
  onForward,
}: {
  pager: ReturnType<typeof estatePagerView>;
  historyLength: number;
  onBack: () => void;
  onForward: () => void;
}) {
  return (
    <>
      <div className="season-pager">
        <button type="button" disabled={!pager.canGoBack} title="Prior season's books" onClick={onBack}>
          Earlier
        </button>
        <div className="season-label">
          <strong>{pager.label}</strong>
          {pager.viewingCurrent ? <span className="season-now"> · this season</span> : null}
        </div>
        <button
          type="button"
          className="season-forward"
          disabled={!pager.canGoForward}
          hidden={!pager.showForward}
          title="Toward this season"
          onClick={onForward}
        >
          Later
        </button>
      </div>
      <p className="muted season-hint">
        <GlossaryText text={pager.hint} />
      </p>
      {pager.source ? (
        <EstateBody source={pager.source} />
      ) : historyLength === 0 ? null : (
        <p className="muted">
          <GlossaryText text={pager.hint} />
        </p>
      )}
    </>
  );
}

function EstateBody({ source: s }: { source: EstateLedgerSource }) {
  const holding = s.holdings[0];
  const deltas = s.last_season_deltas ?? {};
  const d = (id: string) => deltas[id];
  return (
    <>
      <p className="muted">
        <GlossaryText text={s.region} />
      </p>
      {s.eraNote ? (
        <p className="muted">
          <GlossaryText text={s.eraNote} />
        </p>
      ) : null}
      {s.flags.merchant_present && s.merchant.present && (
        <p className="flag">
          <GlossaryText text={merchantPresentLine(s.merchant.name)} />
        </p>
      )}
      {s.flags.hunger && (
        <p className="flag warn">
          <GlossaryText text={HUNGER_LINE} />
        </p>
      )}

      <h3>Chest and people</h3>
      <Row k="Denarii" v={formatLedgerNumber(s.resources.denarii)} delta={d("denarii")} />
      <Row k="Manses" v={String(s.population.households)} delta={d("households")} />
      <p className="ledger-note">
        <GlossaryText text={peopleSentence(s.population)} />
      </p>
      {s.labour ? (
        <p className="ledger-note">
          <GlossaryText text={labourSentence(s.labour.pool, s.labour.remaining)} />
        </p>
      ) : (
        <p className="muted">The extra days of that season were not kept.</p>
      )}
      {s.npcs.map((n) => (
        <Row key={`${n.name}:${n.role}`} k={n.name} v={roleName(n.role)} />
      ))}

      <h3>Arms</h3>
      <p className="ledger-note">
        <GlossaryText text={armsBookLine(s.npcs)} />
      </p>

      <h3>Land — {holding?.name}</h3>
      {holding &&
        Object.entries(holding.land).map(([k, v]) => (
          <Row key={k} k={landName(k)} v={`${v} acres`} land />
        ))}
      {holding && (
        <>
          <h3>Sown</h3>
          {Object.entries(holding.sown).map(([k, v]) => (
            <Row key={k} k={resourceName(k)} v={`${v} acres`} delta={d(`sown_${k}`)} />
          ))}
          <p className="ledger-note">
            <GlossaryText text={sowingRotationLine(s.agriculture?.rotation)} />
          </p>
          <p className="ledger-note">
            <GlossaryText text={sowingShareLine("spring", s.agriculture?.springBarleyShare ?? 0.6)} />
          </p>
          <p className="ledger-note">
            <GlossaryText text={sowingShareLine("autumn", s.agriculture?.autumnWheatShare ?? 0.45)} />
          </p>
          <h3>On the holding</h3>
          <p className="ledger-note">
            <GlossaryText text={featuresSentence(holding.features)} />
          </p>
        </>
      )}

      {s.merchant.present && (
        <>
          <h3>{s.merchant.name ? `${s.merchant.name}'s carts` : "The merchant's carts"}</h3>
          {s.merchant.stock.length === 0 && <p className="muted">The carts are empty.</p>}
          {s.merchant.stock.map((w) => {
            const range = s.market[w.resource];
            const price = range ? marketLine(w.resource, range.min, range.max) : "price not yet known";
            return (
              <Row
                key={w.resource}
                k={resourceName(w.resource)}
                v={`${formatLedgerNumber(w.amount)} on the carts · ${price}`}
              />
            );
          })}
        </>
      )}

      <h3>Stores</h3>
      {CANONICAL_RESOURCES.filter((r) => r !== "denarii").map((r) => (
        <Row
          key={r}
          k={resourceName(r)}
          v={`${formatLedgerNumber(s.resources[r])} ${resourceUnit(r)}`}
          delta={d(r)}
          hideZero={s.resources[r] === 0 && d(r) == null}
        />
      ))}
      {s.custom_resources.map((c) => (
        <Row key={c.id} k={c.name} v={`${formatLedgerNumber(c.amount)} ${c.unit}`} />
      ))}

      <h3>Prices</h3>
      {Object.entries(s.market)
        .slice(0, 16)
        .map(([k, p]) => (
          <p key={k} className="ledger-note">
            <GlossaryText text={`${marketLine(k, p.min, p.max)}.`} />
          </p>
        ))}

      <h3>Known crafts</h3>
      {s.known_techniques.length === 0 && <p className="muted">None recorded.</p>}
      {s.known_techniques.map((t) => (
        <p key={t.id} className="ledger-note">
          <GlossaryText text={t.name} />
        </p>
      ))}
    </>
  );
}

function LaboursTab({ entries }: { entries: LabourBookEntry[] }) {
  const empty = laboursEmptyLine(entries);
  const underway = entries.filter((e) => e.status === "active");
  const finished = entries.filter((e) => e.status !== "active");
  if (empty) {
    return (
      <>
        <p className="muted">
          <GlossaryText text={empty} />
        </p>
        <KnownWorks />
      </>
    );
  }
  return (
    <>
      <h3>Underway</h3>
      {underway.length === 0 && <p className="muted">None underway.</p>}
      {underway.map((e) => (
        <LabourCard key={e.id} entry={e} />
      ))}
      <h3>Finished</h3>
      {finished.length === 0 && <p className="muted">None finished in these books.</p>}
      {finished.map((e) => (
        <LabourCard key={e.id} entry={e} />
      ))}
      <KnownWorks />
    </>
  );
}

function KnownWorks() {
  return (
    <details>
      <summary>
        <GlossaryText text="Works known to the hall" />
      </summary>
      <ul className="tiny">
        {PROJECT_CATALOG.map((p) => (
          <li key={p.key}>
            <GlossaryText text={`${p.name} — ${p.labourDays} days, ${p.lumber} timber, ${p.iron} iron, ${p.stone} stone`} />
          </li>
        ))}
      </ul>
    </details>
  );
}

function LabourCard({ entry }: { entry: LabourBookEntry }) {
  const hunt = entry.hunt ? { hunt: true as const } : undefined;
  return (
    <article className="labour-entry">
      <div className="row">
        <span>
          <GlossaryText text={entry.name} context={hunt} />
        </span>
        <span>
          <GlossaryText text={entry.statusLine} context={hunt} />
        </span>
      </div>
      <p className="ledger-note">
        <GlossaryText text={entry.progressLine} context={hunt} />
      </p>
      {entry.handsLine ? (
        <p className="ledger-note">
          <GlossaryText text={entry.handsLine} context={hunt} />
        </p>
      ) : null}
      <p className="ledger-note">
        <GlossaryText text={entry.spanLine} />
      </p>
      {entry.marks.length > 0 ? (
        <ul className="tiny">
          {entry.marks.map((m) => (
            <li key={m.label}>
              <GlossaryText text={`${m.label} — ${m.progress}`} context={hunt} />
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function CustomsTab({
  forthcoming,
  orders,
  laws,
  letters,
  empty,
  onCancelForthcoming,
}: {
  forthcoming: ReturnType<typeof customsBookEntries>["forthcoming"];
  orders: ReturnType<typeof customsBookEntries>["orders"];
  laws: ReturnType<typeof customsBookEntries>["laws"];
  letters: ReturnType<typeof customsBookEntries>["letters"];
  empty: ReturnType<typeof customsEmptyLines>;
  onCancelForthcoming?: (id: string) => void;
}) {
  return (
    <>
      {letters.length > 0 && (
        <>
          <h3>
            <GlossaryText text="Letters" />
          </h3>
          {letters.map((letter) => (
            <article key={letter.id} className="custom-entry">
              <div className="row">
                <span>
                  <GlossaryText text={letter.title} />
                </span>
                <span>From the bishop</span>
              </div>
              <p className="order">
                <GlossaryText text={letter.body} />
              </p>
            </article>
          ))}
        </>
      )}
      {forthcoming.length > 0 && (
        <>
          <h3>
            <GlossaryText text="Forthcoming" />
          </h3>
          {forthcoming.map((o) => (
            <article key={o.id} className="custom-entry forthcoming-entry">
              <div className="row">
                <span>
                  <GlossaryText text={o.title} />
                </span>
                <span>Waiting</span>
              </div>
              <p className="order">
                <GlossaryText text={o.body} />
              </p>
              {onCancelForthcoming ? (
                <div className="p-actions forthcoming-actions">
                  <button type="button" onClick={() => onCancelForthcoming(o.id)}>
                    Strike it
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </>
      )}
      <h3>
        <GlossaryText text="Standing orders" />
      </h3>
      {empty.orders && (
        <p className="muted">
          <GlossaryText text={empty.orders} />
        </p>
      )}
      {orders.map((o) => (
        <article key={o.id} className="custom-entry">
          <div className="row">
            <span>
              <GlossaryText text={o.title} />
            </span>
            <span>{o.lasting ? "In force" : "Lifted"}</span>
          </div>
          <p className="order">
            <GlossaryText text={o.body} />
          </p>
        </article>
      ))}
      <h3>
        <GlossaryText text="Customs of the hall" />
      </h3>
      {empty.laws && (
        <p className="muted">
          <GlossaryText text={empty.laws} />
        </p>
      )}
      {laws.map((law) => (
        <article key={law.id} className="custom-entry">
          <div className="row">
            <span>
              <GlossaryText text={law.title} />
            </span>
            <span>{law.lasting ? "Lasting" : "For a time"}</span>
          </div>
          <p className="ledger-note">
            <GlossaryText text={law.body} />
          </p>
        </article>
      ))}
    </>
  );
}

function ArmsTab({ book }: { book: ReturnType<typeof armsBook> }) {
  return (
    <>
      <h3>The lord</h3>
      <Row k="Renown" v={String(book.lord.renown)} />
      <Row k="Rank" v={`${book.lord.rankTitle} (${book.lord.rankLevel})`} />
      <Row k="Strength" v={book.lord.strength} />
      {book.lord.dead && <p className="flag warn">Dead.</p>}
      {book.lord.wounds.length > 0 && (
        <>
          <h3>Wounds</h3>
          <ul className="tiny">
            {book.lord.wounds.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </>
      )}
      <h3>Men under arms</h3>
      {book.emptyLine && <p className="muted">{book.emptyLine}</p>}
      {book.units.map((u) => (
        <article key={u.id} className="labour-entry">
          <div className="row">
            <span>
              {u.name}
              {u.veteran ? " ★" : ""}
            </span>
            <span>{u.men} men</span>
          </div>
          <p className="order">
            {u.kind}
            {u.upkeep ? ` · ${u.upkeep} denarii a season` : " · no upkeep"}
          </p>
        </article>
      ))}
      {book.drilling.map((t) => (
        <article key={t.id} className="labour-entry">
          <div className="row">
            <span>{t.name}</span>
            <span>{t.men} men</span>
          </div>
          <p className="order">
            {t.kind} under drill · {t.seasonsLeft === 0 ? "ready next season" : `${t.seasonsLeft} season${t.seasonsLeft === 1 ? "" : "s"} to go`}
          </p>
        </article>
      ))}
      {(book.units.length > 0 || book.drilling.length > 0) && <Row k="Upkeep each season" v={`${book.upkeepPerSeason} denarii`} />}
      <Row k="Villa men free for levy" v={String(book.levyFree)} />
      {book.invented.length > 0 && <Row k="Invented soldiers" v={book.invented.join(", ")} />}
      <h3>Battles</h3>
      {book.history.length === 0 && <p className="muted">No battles yet.</p>}
      {book.history.map((b) => (
        <article key={b.id} className="custom-entry">
          <div className="row">
            <span>
              {b.when} · {b.kind}
            </span>
            <span>
              {b.outcome} · {b.renownDelta >= 0 ? "+" : ""}
              {b.renownDelta}
            </span>
          </div>
          <p className="order">{b.summary}</p>
        </article>
      ))}
    </>
  );
}

function Row({
  k,
  v,
  hideZero,
  delta,
  land,
}: {
  k: string;
  v: string;
  hideZero?: boolean;
  delta?: number;
  land?: boolean;
}) {
  if (hideZero) return null;
  const showDelta = delta != null && delta !== 0;
  const ctx = land ? { land: true as const } : undefined;
  return (
    <div className="row">
      <span>
        <GlossaryText text={k} context={ctx} />
      </span>
      <span>
        <GlossaryText text={v} context={ctx} />
        {showDelta && <span className={`delta ${delta > 0 ? "gain" : "loss"}`}>{formatSignedDelta(delta)}</span>}
      </span>
    </div>
  );
}
