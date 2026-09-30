import { useState } from "react";
import type { Battlefield, BattleState } from "../../combat/battleTypes";
import { cellKey } from "../../combat/grid";
import { maxShieldFor } from "../../combat/renown";
import type { BattleSession } from "../../engine/schema";
import { allCells, shortName, unitsByCell } from "../lab/labView";

/** Full Command screens (design doc §3, §9.5, §8.6). */

const TERRAIN_ABBR: Record<string, string> = {
  hills: "hill",
  woodland: "wood",
  heavy_brush: "brush",
  swamp: "swamp",
  stream: "stream",
  river: "river",
  cliffs: "cliff",
};

export function FieldMiniMap({ field, selected, onSelect, label }: { field: Battlefield; selected?: boolean; onSelect?: () => void; label?: string }) {
  const body = (
    <>
      <div className="minimap-grid">
        {field.cells.map((c, i) => {
          const row = Math.floor(i / 3) + 1;
          const terrain = c.terrain.filter((t) => t !== "cliffs").map((t) => TERRAIN_ABBR[t] ?? t).join("+");
          return (
            <span key={i} className={`minimap-cell r${row}${c.cliffBelow ? " cliff" : ""}${c.fortification ? " fort" : ""}`} title={`Row ${row}: ${c.terrain.join(", ") || "grass"}${c.cliffBelow ? "; cliff below" : ""}`}>
              {terrain || "·"}
            </span>
          );
        })}
      </div>
      <div className="minimap-caption">
        <strong>{label ?? field.name}</strong> <span className="muted">· {field.weather.replace("_", " ")}</span>
      </div>
    </>
  );
  if (!onSelect) return <div className="minimap">{body}</div>;
  return (
    <button className={`minimap selectable${selected ? " selected" : ""}`} onClick={onSelect}>
      {body}
    </button>
  );
}

export function ScoutingPanel({ session, busy, onRole, onNarrow, onFinalize }: { session: BattleSession; busy: boolean; onRole: (r: "narrower" | "finalizer") => void; onNarrow: (keep: number[]) => void; onFinalize: (pick: number) => void }) {
  const sc = session.scouting!;
  const [keep, setKeep] = useState<number[]>([]);
  const toggle = (i: number) => setKeep((k) => (k.includes(i) ? k.filter((x) => x !== i) : k.length < 3 ? [...k, i] : k));
  return (
    <div className="field-muster scout">
      <p className="field-call">{session.premise}</p>
      {sc.stage === "choose_role" && (
        <>
          <p>
            Your scouts were quicker than theirs. You may <strong>narrow</strong> the ground — keep three of six likely fields and let the enemy choose among them — or <strong>finalize</strong>: let them keep three, and take your pick of those.
          </p>
          <div className="p-actions">
            <button className="primary" disabled={busy} onClick={() => onRole("narrower")}>
              Narrow: keep three of six
            </button>
            <button disabled={busy} onClick={() => onRole("finalizer")}>
              Finalize: choose one of their three
            </button>
          </div>
        </>
      )}
      {sc.stage === "narrow" && (
        <>
          <p>
            {sc.winner === "player" ? "You chose to narrow the ground." : "Their scouts were quicker; they will choose among what you leave them."} Keep <strong>three</strong> of these six. The enemy picks the final field from your three.
          </p>
          <div className="minimap-row">
            {sc.pool.map((f, i) => (
              <FieldMiniMap key={i} field={f} selected={keep.includes(i)} onSelect={() => toggle(i)} />
            ))}
          </div>
          <div className="p-actions">
            <button className="primary" disabled={busy || keep.length !== 3} onClick={() => onNarrow(keep)}>
              Keep these three
            </button>
          </div>
        </>
      )}
      {sc.stage === "finalize" && (
        <>
          <p>{sc.winner === "player" ? "You chose to take the final pick." : "Their scouts were quicker and they have narrowed the ground."} Choose where the hosts will meet.</p>
          <div className="minimap-row">
            {sc.shortlist.map((f, i) => (
              <FieldMiniMap key={i} field={f} onSelect={() => onFinalize(i)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function DeploymentPanel({
  battle,
  busy,
  onDeploy,
  onDeployRest,
  onAddress,
  onBegin,
}: {
  battle: BattleState;
  busy: boolean;
  onDeploy: (unitId: string, cell: { row: number; col: number }) => void;
  onDeployRest: () => void;
  onAddress: (unitId: string, amount: number) => void;
  onBegin: () => void;
}) {
  const mine = battle.units.filter((u) => u.side === "player");
  const unplaced = mine.filter((u) => !u.cell);
  const [selected, setSelected] = useState<string | null>(unplaced[0]?.id ?? mine[0]?.id ?? null);
  const [spend, setSpend] = useState<Record<string, number>>({});
  const byCell = unitsByCell(battle);
  const sel = mine.find((u) => u.id === selected) ?? null;
  return (
    <div className="deploy">
      <div className="deploy-grid">
        {allCells().map((c) => {
          const units = byCell.get(cellKey(c)) ?? [];
          const cell = battle.battlefield.cells[(c.row - 1) * 3 + c.col];
          const placeable = c.row <= 2 && Boolean(sel);
          return (
            <button key={cellKey(c)} className={`deploy-cell ${c.row <= 2 ? "own" : c.row === 3 ? "nml" : "foe"}`} disabled={!placeable || busy} onClick={() => sel && onDeploy(sel.id, c)} title={placeable ? `Place ${sel!.name} here` : ""}>
              <span className="cmd-cell-head">
                <span>{c.row <= 2 ? (c.row === 1 ? "Reserve" : "Front") : c.row === 3 ? "Between" : c.row === 4 ? "Their front" : "Their reserve"} · {["left", "centre", "right"][c.col]}</span>
                <span className="muted">{cell.terrain.join("+")}</span>
              </span>
              {units.map((u) => (
                <span key={u.id} className={`cmd-chip ${u.side}${u.id === selected ? " selected" : ""}`}>
                  <span className="cmd-chip-name">
                    {battle.player.attachedUnitId === u.id ? "♛ " : ""}
                    {shortName(u)}
                    {u.shield ? ` +${u.shield}` : ""}
                  </span>
                </span>
              ))}
            </button>
          );
        })}
      </div>
      <div className="cmd-side">
        <div className="field-card">
          <h3>Your files</h3>
          <p className="tiny muted">Pick a file, then a cell in your two rows. Pool {battle.commandPool.remaining}/{battle.commandPool.total} to spend on Address the Troops before the first blow.</p>
          {mine.map((u) => {
            const room = maxShieldFor(u.maxMorale, u.shield);
            return (
              <div key={u.id} className={`deploy-file${u.id === selected ? " selected" : ""}`}>
                <button className="deploy-file-name" onClick={() => setSelected(u.id)}>
                  {battle.player.attachedUnitId === u.id ? "♛ " : ""}
                  {u.name} <span className="muted">· {u.owner === "ally" ? "allied" : "yours"} · {u.cell ? `row ${u.cell.row}` : "unplaced"}</span>
                </button>
                <div className="deploy-address">
                  <input type="number" min={0} max={Math.min(room, battle.commandPool.remaining)} value={spend[u.id] ?? 0} disabled={busy || room <= 0} onChange={(e) => setSpend((s) => ({ ...s, [u.id]: Math.max(0, Number(e.target.value) || 0) }))} title={`Up to ${room} more shield`} />
                  <button disabled={busy || !(spend[u.id] > 0) || room <= 0 || battle.commandPool.remaining <= 0} onClick={() => onAddress(u.id, spend[u.id])}>
                    Address
                  </button>
                  <span className="tiny muted">{u.shield ? `shield ${u.shield}` : room > 0 ? `room ${room}` : "at cap"}</span>
                </div>
              </div>
            );
          })}
          <div className="p-actions">
            <button disabled={busy || unplaced.length === 0} onClick={onDeployRest}>
              Let the sergeants place the rest
            </button>
            <button className="primary" disabled={busy || unplaced.length > 0} onClick={onBegin} title={unplaced.length ? `${unplaced.length} still unplaced` : ""}>
              Begin the battle
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function NightfallCard({ session, busy, onChoose }: { session: BattleSession; busy: boolean; onChoose: (choice: "hold" | "reposition" | "withdraw", pick?: number) => void }) {
  if (session.repositionPool.length) {
    return (
      <div className="field-card">
        <h3>New ground by dawn</h3>
        <div className="minimap-row narrow">
          {session.repositionPool.map((f, i) => (
            <FieldMiniMap key={i} field={f} onSelect={() => onChoose("reposition", i)} />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="field-card">
      <h3>Nightfall</h3>
      <p className="muted tiny">Neither host has broken. The men will recover some heart overnight; wounds will not mend.</p>
      <button className="field-option" disabled={busy} onClick={() => onChoose("hold")}>
        <span className="field-option-key">H</span>
        <span className="field-option-text">Hold the ground</span>
        <span className="field-option-mech">Resume at dawn on the same field, same deployment.</span>
      </button>
      <button className="field-option" disabled={busy} onClick={() => onChoose("reposition")}>
        <span className="field-option-key">R</span>
        <span className="field-option-text">Seek better ground</span>
        <span className="field-option-mech">Your scouts offer three fields; the hosts re-form at dawn.</span>
      </button>
      <button className="field-option" disabled={busy} onClick={() => onChoose("withdraw")}>
        <span className="field-option-key">W</span>
        <span className="field-option-text">Draw off in the night</span>
        <span className="field-option-mech">Abandon the engagement without a rout; the day is inconclusive.</span>
      </button>
    </div>
  );
}
