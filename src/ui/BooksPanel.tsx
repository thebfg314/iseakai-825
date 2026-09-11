import { useEffect, useState } from "react";
import { PROJECT_CATALOG } from "../engine/projectCatalog";
import { CANONICAL_RESOURCES } from "../engine/schema";
import type { GameView } from "../shared/types";
import {
  BOOKS_TAB_LABELS,
  BOOKS_TABS,
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
} from "./booksPanel";
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
  roleName,
  sowingShareLine,
} from "./ledgerCopy";

export function BooksPanel({ view }: { view: GameView }) {
  const [tab, setTab] = useState<BooksTab>("estate");
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
    <aside className="ledger">
      <div className="ledger-head">
        <h2>{BOOKS_TITLE}</h2>
        <div className="books-tabs" role="tablist" aria-label={BOOKS_TITLE}>
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
        {tab === "customs" && <CustomsTab orders={customs.orders} laws={customs.laws} empty={customsEmpty} />}
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
        {pager.showForward ? (
          <button type="button" disabled={!pager.canGoForward} title="Toward this season" onClick={onForward}>
            Later
          </button>
        ) : (
          <span className="season-pager-spacer" aria-hidden="true" />
        )}
      </div>
      <p className="muted season-hint">{pager.hint}</p>
      {pager.source ? <EstateBody source={pager.source} /> : historyLength === 0 ? null : <p className="muted">{pager.hint}</p>}
    </>
  );
}

function EstateBody({ source: s }: { source: EstateLedgerSource }) {
  const holding = s.holdings[0];
  const deltas = s.last_season_deltas ?? {};
  const d = (id: string) => deltas[id];
  return (
    <>
      <p className="muted">{s.region}</p>
      {s.flags.merchant_present && s.merchant.present && (
        <p className="flag">{merchantPresentLine(s.merchant.name)}</p>
      )}
      {s.flags.hunger && <p className="flag warn">{HUNGER_LINE}</p>}

      <h3>Chest and people</h3>
      <Row k="Denarii" v={formatLedgerNumber(s.resources.denarii)} delta={d("denarii")} />
      <Row k="Manses" v={String(s.population.households)} delta={d("households")} />
      <p className="ledger-note">{peopleSentence(s.population)}</p>
      {s.labour ? (
        <p className="ledger-note">{labourSentence(s.labour.pool, s.labour.remaining)}</p>
      ) : (
        <p className="muted">The extra days of that season were not kept.</p>
      )}
      {s.npcs.map((n) => (
        <Row key={`${n.name}:${n.role}`} k={n.name} v={roleName(n.role)} />
      ))}

      <h3>Land — {holding?.name}</h3>
      {holding && Object.entries(holding.land).map(([k, v]) => <Row key={k} k={landName(k)} v={`${v} acres`} />)}
      {holding && (
        <>
          <h3>Sown</h3>
          {Object.entries(holding.sown).map(([k, v]) => (
            <Row key={k} k={resourceName(k)} v={`${v} acres`} delta={d(`sown_${k}`)} />
          ))}
          <p className="ledger-note">{sowingShareLine("spring", s.agriculture?.springBarleyShare ?? 0.6)}</p>
          <p className="ledger-note">{sowingShareLine("autumn", s.agriculture?.autumnWheatShare ?? 0.45)}</p>
          <h3>On the holding</h3>
          <p className="ledger-note">{featuresSentence(holding.features)}</p>
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
            {marketLine(k, p.min, p.max)}.
          </p>
        ))}

      <h3>Known crafts</h3>
      {s.known_techniques.length === 0 && <p className="muted">None recorded.</p>}
      {s.known_techniques.map((t) => (
        <p key={t.id} className="ledger-note">
          {t.name}
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
        <p className="muted">{empty}</p>
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
      <summary>Works known to the hall</summary>
      <ul className="tiny">
        {PROJECT_CATALOG.map((p) => (
          <li key={p.key}>
            {p.name} — {p.labourDays} days, {p.lumber} timber, {p.iron} iron, {p.stone} stone
          </li>
        ))}
      </ul>
    </details>
  );
}

function LabourCard({ entry }: { entry: LabourBookEntry }) {
  return (
    <article className="labour-entry">
      <div className="row">
        <span>{entry.name}</span>
        <span>{entry.statusLine}</span>
      </div>
      <p className="ledger-note">{entry.progressLine}</p>
      {entry.handsLine ? <p className="ledger-note">{entry.handsLine}</p> : null}
      <p className="ledger-note">{entry.spanLine}</p>
      {entry.marks.length > 0 ? (
        <ul className="tiny">
          {entry.marks.map((m) => (
            <li key={m.label}>
              {m.label} — {m.progress}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function CustomsTab({
  orders,
  laws,
  empty,
}: {
  orders: ReturnType<typeof customsBookEntries>["orders"];
  laws: ReturnType<typeof customsBookEntries>["laws"];
  empty: ReturnType<typeof customsEmptyLines>;
}) {
  return (
    <>
      <h3>Standing orders</h3>
      {empty.orders && <p className="muted">{empty.orders}</p>}
      {orders.map((o) => (
        <article key={o.id} className="custom-entry">
          <div className="row">
            <span>{o.title}</span>
            <span>{o.lasting ? "In force" : "Lifted"}</span>
          </div>
          <p className="order">{o.body}</p>
        </article>
      ))}
      <h3>Customs of the hall</h3>
      {empty.laws && <p className="muted">{empty.laws}</p>}
      {laws.map((law) => (
        <article key={law.id} className="custom-entry">
          <div className="row">
            <span>{law.title}</span>
            <span>{law.lasting ? "Lasting" : "For a time"}</span>
          </div>
          <p className="ledger-note">{law.body}</p>
        </article>
      ))}
    </>
  );
}

function Row({ k, v, hideZero, delta }: { k: string; v: string; hideZero?: boolean; delta?: number }) {
  if (hideZero) return null;
  const showDelta = delta != null && delta !== 0;
  return (
    <div className="row">
      <span>{k}</span>
      <span>
        {v}
        {showDelta && <span className={`delta ${delta > 0 ? "gain" : "loss"}`}>{formatSignedDelta(delta)}</span>}
      </span>
    </div>
  );
}
