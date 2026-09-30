import { useEffect, useState } from "react";
import type { BattleState, Order, UnitInstance } from "../../combat/battleTypes";
import { cellKey } from "../../combat/grid";
import { isEngaged, sheetFor } from "../../combat/units";
import type { BattleSession } from "../../engine/schema";
import { ORDER_LABELS, allCells, availableOrders, buildOrder, describeOrder, pct, shortName, targetOptions, unitsByCell } from "../lab/labView";

/**
 * Sub-/Full Command field view (design doc §4): real numbers for the files you command,
 * a man-in-the-line's read of everyone else, and an order for each of your units.
 */

type Props = {
  battle: BattleState;
  session: BattleSession;
  controlled: string[];
  busy: boolean;
  onRound: (orders: Order[]) => void;
};

function heartWord(u: UnitInstance): string {
  const h = u.morale / u.maxMorale;
  if (u.status !== "active") return u.status;
  if (h > 0.7) return "steady";
  if (h > 0.4) return "shaken";
  if (h > 0.25) return "wavering";
  return "breaking";
}

export function CommandPanel({ battle, session, controlled, busy, onRound }: Props) {
  const [queued, setQueued] = useState<Order[]>([]);
  const [selected, setSelected] = useState<string | null>(controlled[0] ?? null);
  useEffect(() => {
    setQueued([]);
    if (selected && !controlled.includes(selected)) setSelected(controlled[0] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle.round]);
  const byCell = unitsByCell(battle);
  const unit = battle.units.find((u) => u.id === selected) ?? null;
  const active = session.objectives.find((o) => o.status === "active");
  const canAct = battle.phase === "rounds" && session.openingDone;

  return (
    <div className="cmd">
      <div className="cmd-grid">
        {allCells().map((c) => {
          const cell = battle.battlefield.cells[(c.row - 1) * 3 + c.col];
          const units = byCell.get(cellKey(c)) ?? [];
          const rowClass = c.row <= 2 ? "own" : c.row === 3 ? "nml" : "foe";
          return (
            <div key={cellKey(c)} className={`cmd-cell ${rowClass}`}>
              <div className="cmd-cell-head">
                <span>{c.row <= 2 ? "Ours" : c.row === 3 ? "Between" : "Theirs"} · {["left", "centre", "right"][c.col]}</span>
                <span className="muted">{cell.terrain.join("+")}</span>
              </div>
              {units.map((u) => {
                const mine = controlled.includes(u.id);
                return (
                  <button key={u.id} className={`cmd-chip ${u.side}${mine ? " mine" : ""}${selected === u.id ? " selected" : ""}`} disabled={!mine} onClick={() => setSelected(u.id)} title={u.id}>
                    <span className="cmd-chip-name">
                      {battle.player.attachedUnitId === u.id ? "♛ " : ""}
                      {shortName(u)}
                      {isEngaged(u) ? " ⚔" : ""}
                    </span>
                    {mine ? (
                      <>
                        <span className="lab-bar hp">
                          <span style={{ width: `${pct(u.hp, u.maxHp)}%` }} />
                        </span>
                        <span className="lab-bar morale">
                          <span style={{ width: `${pct(u.morale, u.maxMorale)}%` }} />
                          {u.shield > 0 && <span className="shield" style={{ width: `${pct(u.shield, u.maxMorale)}%` }} />}
                        </span>
                      </>
                    ) : (
                      <span className="cmd-chip-word muted">{heartWord(u)}</span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="cmd-side">
        <div className="field-card">
          <h3>The marshal's order</h3>
          {active ? <p className="cmd-order-text">{active.text}</p> : <p className="muted">Awaiting orders.</p>}
          {session.objectives.filter((o) => o.status !== "active").length > 0 && (
            <ul className="tiny muted cmd-past">
              {session.objectives
                .filter((o) => o.status !== "active")
                .map((o) => (
                  <li key={o.id}>
                    {o.status === "success" ? "✓" : "✗"} {o.text.slice(0, 70)}
                    {o.text.length > 70 ? "…" : ""} ({o.bonus !== undefined && o.bonus >= 0 ? "+" : ""}
                    {o.bonus})
                  </li>
                ))}
            </ul>
          )}
        </div>

        {unit && canAct && <OrderForm battle={battle} unit={unit} onQueue={(o) => setQueued((q) => [...q.filter((x) => !(x.type !== "rally" && o.type !== "rally" && x.unitId === o.unitId)), o])} />}

        <div className="field-card">
          <h3>Orders this exchange</h3>
          {queued.length === 0 ? <p className="muted tiny">Files without an order fight on as their sergeants see fit.</p> : (
            <ul className="cmd-queue">
              {queued.map((o, i) => (
                <li key={i}>
                  {describeOrder(o)}{" "}
                  <button className="lab-x" onClick={() => setQueued((q) => q.filter((_, j) => j !== i))}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button className="primary" disabled={busy || !canAct} onClick={() => onRound(queued)}>
            {busy ? "…" : "Advance the exchange"}
          </button>
        </div>
      </div>
    </div>
  );
}

function OrderForm({ battle, unit, onQueue }: { battle: BattleState; unit: UnitInstance; onQueue: (o: Order) => void }) {
  const sheet = sheetFor(unit);
  const orders = availableOrders(battle, unit);
  const [orderType, setOrderType] = useState<string>(orders[0] ?? "hold");
  const [target, setTarget] = useState("");
  const [secondary, setSecondary] = useState("");
  const [amount, setAmount] = useState(10);
  useEffect(() => {
    setOrderType(orders.includes(orderType) ? orderType : orders[0] ?? "hold");
    setTarget("");
    setSecondary("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit.id, battle.round]);
  const options = targetOptions(battle, unit, orderType);
  const needsSecondary = orderType === "skirmish_and_withdraw";
  const moveOptions = needsSecondary ? targetOptions(battle, unit, "move") : [];
  return (
    <div className="field-card">
      <h3>{unit.name}</h3>
      <div className="lab-stats">
        <span>HP {unit.hp}/{unit.maxHp}</span>
        <span>Heart {unit.morale}/{unit.maxMorale}{unit.shield ? ` +${unit.shield}` : ""}</span>
        <span>ATK {sheet.atk}</span>
        <span>DEF {sheet.def}</span>
        <span>Men {unit.strength}</span>
        {unit.ammo !== undefined && <span>Arrows {unit.ammo}</span>}
        {unit.engagedWith.length > 0 && <span>Engaged: {unit.engagedWith.length}</span>}
        {unit.holdFormation && <span>Braced</span>}
      </div>
      <div className="lab-order-form">
        <select value={orderType} onChange={(e) => { setOrderType(e.target.value); setTarget(""); }}>
          {orders.map((o) => (
            <option key={o} value={o}>
              {ORDER_LABELS[o] ?? o}
            </option>
          ))}
        </select>
        {options.length > 0 && (
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">— target —</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {options.length === 0 && ["engage", "fire", "attack_structure", "skirmish_and_withdraw"].includes(orderType) && <span className="muted tiny">No one in reach.</span>}
        {needsSecondary && (
          <select value={secondary} onChange={(e) => setSecondary(e.target.value)}>
            <option value="">— withdraw to —</option>
            {moveOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {orderType === "rally" && <input type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value) || 1)} title="Pool to spend" />}
        <button
          onClick={() => {
            const o = buildOrder(unit, orderType, target, { amount, secondary });
            if (o) onQueue(o);
          }}
        >
          Give order
        </button>
      </div>
    </div>
  );
}
