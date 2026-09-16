import { useMemo, useState } from "react";
import type { GameView } from "../shared/types";
import { quoteMerchantBasket } from "../engine/merchantShop";
import { GlossaryText } from "./GlossaryText";
import {
  SHOP_CARTS,
  SHOP_CONFIRM_HELP,
  SHOP_SPEAK_HINT,
  SHOP_STORES,
  SHOP_TALLY,
  SHOP_TITLE,
  basketFromQtys,
  clampShopQty,
  sellRows,
  shopHave,
  shopLineLabel,
  shopNetLine,
  shopPurseLine,
  shopUnitLine,
  stallRows,
} from "./shopView";
import { formatLedgerNumber, resourceUnit } from "./ledgerCopy";

export function ShopPanel({
  view,
  busy,
  onConfirm,
  onSpeak,
}: {
  view: GameView;
  busy: boolean;
  onConfirm: (basket: ReturnType<typeof basketFromQtys>) => void;
  onSpeak?: () => void;
}) {
  const [buyStall, setBuyStall] = useState<Record<string, number>>({});
  const [buyBack, setBuyBack] = useState<Record<string, number>>({});
  const [sell, setSell] = useState<Record<string, number>>({});

  const basket = useMemo(() => basketFromQtys(buyStall, buyBack, sell), [buyStall, buyBack, sell]);
  const quote = quoteMerchantBasket(view.state, basket);
  const carts = stallRows(view.state);
  const stores = sellRows(view.state);
  const name = view.state.merchant.name;
  const purse = view.state.merchant.purse ?? 0;

  function setQty(kind: "stall" | "buyback" | "sell", resource: string, next: number) {
    const max = shopHave(view.state, resource, kind);
    const value = clampShopQty(next, max);
    if (kind === "stall") setBuyStall((prev) => ({ ...prev, [resource]: value }));
    else if (kind === "buyback") setBuyBack((prev) => ({ ...prev, [resource]: value }));
    else setSell((prev) => ({ ...prev, [resource]: value }));
  }

  return (
    <section className="shop-panel" aria-label={SHOP_TITLE}>
      <div className="shop-head">
        <h3>{SHOP_TITLE}</h3>
        <p className="shop-purse">
          <GlossaryText text={shopPurseLine(name, purse)} />
        </p>
      </div>
      <div className="shop-grid">
        <div className="shop-col">
          <h4>{SHOP_CARTS}</h4>
          {carts.length === 0 ? <p className="muted">The carts are empty.</p> : null}
          {carts.map((row) => (
            <ShopQtyRow
              key={`${row.kind}:${row.resource}`}
              label={shopLineLabel(row.resource, row.kind)}
              unit={resourceUnit(row.resource)}
              have={row.amount}
              value={Math.min(row.kind === "buyback" ? buyBack[row.resource] ?? 0 : buyStall[row.resource] ?? 0, row.amount)}
              price={shopUnitLine(row.resource, row.unitPrice, row.kind)}
              disabled={busy}
              onChange={(n) => setQty(row.kind, row.resource, n)}
            />
          ))}
        </div>
        <div className="shop-col">
          <h4>{SHOP_STORES}</h4>
          {stores.length === 0 ? <p className="muted">The stores are empty.</p> : null}
          {stores.map((row) => (
            <ShopQtyRow
              key={`sell:${row.resource}`}
              label={shopLineLabel(row.resource, "stall")}
              unit={resourceUnit(row.resource)}
              have={row.amount}
              value={Math.min(sell[row.resource] ?? 0, row.amount)}
              price={shopUnitLine(row.resource, row.unitPrice, "sell")}
              disabled={busy}
              onChange={(n) => setQty("sell", row.resource, n)}
            />
          ))}
        </div>
        <div className="shop-col shop-tally">
          <h4>{SHOP_TALLY}</h4>
          <p className="shop-net">
            <GlossaryText text={shopNetLine(quote)} />
          </p>
          {quote.buyLines.map((line) => (
            <p key={`b:${line.kind}:${line.resource}`} className="shop-tally-line">
              <GlossaryText
                text={`Buy ${formatLedgerNumber(line.amount)} ${resourceUnit(line.resource)} ${shopLineLabel(line.resource, line.kind === "buyback" ? "buyback" : "stall")} · ${formatLedgerNumber(line.total)} denarii`}
              />
            </p>
          ))}
          {quote.sellLines.map((line) => (
            <p key={`s:${line.resource}`} className="shop-tally-line">
              <GlossaryText
                text={`Sell ${formatLedgerNumber(line.amount)} ${resourceUnit(line.resource)} ${shopLineLabel(line.resource, "stall")} · ${formatLedgerNumber(line.total)} denarii`}
              />
            </p>
          ))}
          {quote.reason && !quote.canConfirm ? (
            <p className="shop-reason">
              <GlossaryText text={quote.reason} />
            </p>
          ) : null}
          <p className="proposal-help">
            <GlossaryText text={SHOP_CONFIRM_HELP} />
          </p>
          <div className="p-actions">
            <button
              className="primary"
              disabled={busy || !quote.canConfirm}
              onClick={() => onConfirm(basket)}
            >
              Confirm
            </button>
            {onSpeak ? (
              <button type="button" disabled={busy} onClick={onSpeak}>
                Speak
              </button>
            ) : null}
          </div>
          <p className="muted shop-speak-hint">
            <GlossaryText text={SHOP_SPEAK_HINT} />
          </p>
        </div>
      </div>
    </section>
  );
}

function ShopQtyRow({
  label,
  unit,
  have,
  value,
  price,
  disabled,
  onChange,
}: {
  label: string;
  unit: string;
  have: number;
  value: number;
  price: string;
  disabled: boolean;
  onChange: (n: number) => void;
}) {
  return (
    <div className="shop-row">
      <div className="shop-row-copy">
        <div className="shop-good">
          <GlossaryText text={label} />
        </div>
        <div className="shop-meta">
          <GlossaryText text={`${formatLedgerNumber(have)} ${unit} · ${price}`} />
        </div>
      </div>
      <div className="shop-qty">
        <button type="button" disabled={disabled || value <= 0} onClick={() => onChange(value - 1)} aria-label={`Less ${label}`}>
          −
        </button>
        <input
          type="number"
          min={0}
          max={have}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={`${label} quantity`}
        />
        <button type="button" disabled={disabled || value >= have} onClick={() => onChange(value + 1)} aria-label={`More ${label}`}>
          +
        </button>
      </div>
    </div>
  );
}
