import { useEffect, useMemo, useState } from "react";
import type { BattleLogEntry, BattleState, LogKind, Order, UnitInstance } from "../../combat/battleTypes";
import { LOG_KINDS } from "../../combat/battleTypes";
import { isTerrainDefender } from "../../combat/fortification";
import { cellKey } from "../../combat/grid";
import { isEngaged, sheetFor } from "../../combat/units";
import type { LabConfig, LabRosterLine, LabView } from "../../session/lab";
import {
  ORDER_LABELS,
  LOG_KIND_LABELS,
  allCells,
  availableOrders,
  buildOrder,
  describeOrder,
  filterLog,
  formatLogData,
  logToText,
  pct,
  phaseLabel,
  shortName,
  targetOptions,
  unitsByCell,
} from "./labView";

/**
 * Battle Lab: jump straight into a fight with any roster on any field, step it, read every
 * formula, rewind, and forge new units with the LLM. Never touches the campaign save.
 */

type Props = { onExit: () => void };

const DEFAULT_KINDS = new Set<LogKind>(LOG_KINDS.filter((k) => k !== "deploy" && k !== "ai"));

export function BattleLab({ onExit }: Props) {
  const [view, setView] = useState<LabView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [queued, setQueued] = useState<Order[]>([]);
  const [rightTab, setRightTab] = useState<"log" | "forge" | "summary">("log");
  const [brush, setBrush] = useState<string>("hills");
  const [cliffBrush, setCliffBrush] = useState(false);
  const [logKinds, setLogKinds] = useState<Set<LogKind>>(DEFAULT_KINDS);
  const [logSearch, setLogSearch] = useState("");
  const [logRoundOnly, setLogRoundOnly] = useState(false);
  const [showData, setShowData] = useState(true);
  const [forgeText, setForgeText] = useState("");
  const [importText, setImportText] = useState("");
  const [importOpen, setImportOpen] = useState(false);

  async function call(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      const next = (await fn()) as LabView;
      if (next && "config" in next) {
        setView(next);
        if (next.error) setError(next.error);
      }
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void call(() => window.api.lab.open());
    return () => {
      void window.api.lab.close();
    };
  }, []);

  const battle = view?.battle ?? null;
  const unit = useMemo(() => battle?.units.find((u) => u.id === selectedUnit) ?? null, [battle, selectedUnit]);
  const controlled = view?.controlled ?? [];

  useEffect(() => {
    if (battle && battle.phase === "finished") setRightTab("summary");
  }, [battle?.phase]);

  function patch(p: Partial<LabConfig>) {
    void call(() => window.api.lab.setConfig(p));
  }

  function step() {
    const orders = queued;
    setQueued([]);
    void call(() => window.api.lab.step(orders));
  }

  if (!view) {
    return (
      <div className="lab">
        <header className="lab-head">
          <h1>Battle Lab</h1>
          <button onClick={onExit}>Back to title</button>
        </header>
        <p className="muted lab-pad">Opening the lab…{error ? ` ${error}` : ""}</p>
      </div>
    );
  }

  const cfg = view.config;
  const inRounds = battle?.phase === "rounds";

  return (
    <div className="lab">
      <header className="lab-head">
        <h1>Battle Lab</h1>
        <span className="lab-phase">{phaseLabel(battle)}</span>
        {battle && (
          <span className="lab-pool" title="Command Pool remaining / total">
            Pool {battle.commandPool.remaining}/{battle.commandPool.total} · Lord {battle.player.fate}
            {battle.player.attachedUnitId ? ` with ${battle.player.attachedUnitId}` : ""}
          </span>
        )}
        <div className="lab-head-actions">
          <button disabled={busy} onClick={() => void call(() => window.api.lab.build())} className="primary">
            {battle ? "Rebuild" : "Build battle"}
          </button>
          <button disabled={busy || !inRounds} onClick={step}>
            Step round{queued.length ? ` (${queued.length} orders)` : ""}
          </button>
          <button disabled={busy || !battle || battle.phase === "finished"} onClick={() => void call(() => window.api.lab.autoRun())}>
            Auto-run
          </button>
          <button disabled={busy || !view.snapshotCount} onClick={() => void call(() => window.api.lab.rewind(1))} title={`${view.snapshotCount} snapshots`}>
            Rewind
          </button>
          {battle?.phase === "day_end" && (
            <>
              <button disabled={busy} onClick={() => void call(() => window.api.lab.dayEnd("hold"))}>
                Hold ground
              </button>
              <button disabled={busy} onClick={() => void call(() => window.api.lab.dayEnd("withdraw"))}>
                Withdraw
              </button>
            </>
          )}
          <button
            disabled={busy}
            onClick={async () => {
              const text = (await window.api.lab.exportScenario()) as string;
              await navigator.clipboard.writeText(text);
              setError("Scenario JSON copied to the clipboard.");
            }}
          >
            Export
          </button>
          <button disabled={busy} onClick={() => setImportOpen((v) => !v)}>
            Import
          </button>
          <button disabled={busy} onClick={() => void call(() => window.api.lab.reset())}>
            Clear battle
          </button>
          <button disabled={busy} onClick={onExit}>
            Back to title
          </button>
        </div>
      </header>
      {error && <div className="banner">{error}</div>}
      {importOpen && (
        <div className="lab-import">
          <textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="Paste a scenario JSON exported from the lab…" />
          <button
            className="primary"
            disabled={busy || !importText.trim()}
            onClick={() => {
              void call(() => window.api.lab.importScenario(importText));
              setImportOpen(false);
              setImportText("");
            }}
          >
            Load scenario
          </button>
        </div>
      )}

      <div className="lab-body">
        <aside className="lab-col lab-setup">
          <SettingsPanel cfg={cfg} view={view} busy={busy} onPatch={patch} />
          <RosterPanel title="Player side" side="player" lines={cfg.player} view={view} busy={busy} onChange={(lines) => patch({ player: lines })} attachIndex={cfg.attachIndex} onAttach={(i) => patch({ attachIndex: i })} />
          <RosterPanel title="Enemy side" side="enemy" lines={cfg.enemy} view={view} busy={busy} onChange={(lines) => patch({ enemy: lines })} />
          <FieldPainter cfg={cfg} view={view} busy={busy} brush={brush} setBrush={setBrush} cliffBrush={cliffBrush} setCliffBrush={setCliffBrush} onPatch={patch} />
        </aside>

        <section className="lab-col lab-field">
          {battle ? (
            <>
              <GridView battle={battle} selected={selectedUnit} onSelect={setSelectedUnit} controlled={controlled} />
              <div className="lab-unit-row">
                {unit ? (
                  <UnitCard
                    battle={battle}
                    unit={unit}
                    controllable={inRounds && controlled.includes(unit.id)}
                    onQueue={(o) => setQueued((q) => [...q.filter((x) => !(x.type !== "rally" && o.type !== "rally" && x.unitId === o.unitId)), o])}
                  />
                ) : (
                  <p className="muted lab-pad">Select a unit on the field to see its sheet and give it orders.</p>
                )}
                <div className="lab-queue">
                  <h4>Orders this round</h4>
                  {queued.length === 0 ? (
                    <p className="muted">{cfg.manualOrders ? "Strict manual: units without orders do nothing." : "Units without orders take the script commander's choice."}</p>
                  ) : (
                    <ul>
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
                </div>
              </div>
            </>
          ) : (
            <div className="lab-empty">
              <p>Set the rosters and the field on the left, then Build battle.</p>
              <p className="muted">The lord always rides with one player-side unit; at Rank-and-File the script commander gives every order and you watch the tally.</p>
            </div>
          )}
        </section>

        <aside className="lab-col lab-right">
          <div className="lab-tabs">
            <button className={rightTab === "log" ? "active" : ""} onClick={() => setRightTab("log")}>
              Log{battle ? ` (${battle.log.length})` : ""}
            </button>
            <button className={rightTab === "forge" ? "active" : ""} onClick={() => setRightTab("forge")}>
              Unit Forge{view.forge.pending ? " •" : ""}
            </button>
            <button className={rightTab === "summary" ? "active" : ""} onClick={() => setRightTab("summary")}>
              Summary
            </button>
          </div>
          {rightTab === "log" && battle && (
            <LogPanel
              battle={battle}
              kinds={logKinds}
              setKinds={setLogKinds}
              search={logSearch}
              setSearch={setLogSearch}
              roundOnly={logRoundOnly}
              setRoundOnly={setLogRoundOnly}
              showData={showData}
              setShowData={setShowData}
            />
          )}
          {rightTab === "log" && !battle && <p className="muted lab-pad">No battle yet.</p>}
          {rightTab === "forge" && (
            <ForgePanel
              view={view}
              busy={busy}
              text={forgeText}
              setText={setForgeText}
              onForge={() => void call(() => window.api.lab.forge(forgeText))}
              onApprove={() => void call(() => window.api.lab.approveForge())}
              onReject={() => void call(() => window.api.lab.rejectForge())}
              onDiscard={(id) => void call(() => window.api.lab.discardSheet(id))}
            />
          )}
          {rightTab === "summary" && <SummaryPanel view={view} />}
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setup panels
// ---------------------------------------------------------------------------

function SettingsPanel({ cfg, view, busy, onPatch }: { cfg: LabConfig; view: LabView; busy: boolean; onPatch: (p: Partial<LabConfig>) => void }) {
  return (
    <details open className="lab-panel">
      <summary>Battle settings</summary>
      <div className="lab-grid2">
        <label>
          Seed
          <input type="number" value={cfg.seed} disabled={busy} onChange={(e) => onPatch({ seed: Number(e.target.value) || 0 })} />
        </label>
        <label>
          Command tier
          <select value={cfg.tier} disabled={busy} onChange={(e) => onPatch({ tier: e.target.value as LabConfig["tier"] })}>
            <option value="rank_and_file">Rank and File</option>
            <option value="sub_command">Sub-Command</option>
            <option value="full_command">Full Command</option>
          </select>
        </label>
        <label>
          Renown
          <input type="number" min={1} value={cfg.renown} disabled={busy} onChange={(e) => onPatch({ renown: Math.max(1, Number(e.target.value) || 1) })} />
        </label>
        <label>
          Rank
          <select value={cfg.rank} disabled={busy} onChange={(e) => onPatch({ rank: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5].map((r) => (
              <option key={r} value={r}>
                {r} — {["Minor Noble", "Viscount", "Count", "Duke", "King"][r - 1]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Enemy posture
          <select value={cfg.enemyPosture} disabled={busy} onChange={(e) => onPatch({ enemyPosture: e.target.value as "attack" | "defend" })}>
            <option value="attack">Attack</option>
            <option value="defend">Defend</option>
          </select>
        </label>
        <label>
          Allied posture
          <select value={cfg.allyPosture} disabled={busy} onChange={(e) => onPatch({ allyPosture: e.target.value as "attack" | "defend" })}>
            <option value="attack">Attack</option>
            <option value="defend">Defend</option>
          </select>
        </label>
        <label>
          Weather
          <select value={cfg.field.weather} disabled={busy} onChange={(e) => onPatch({ field: { ...cfg.field, weather: e.target.value } })}>
            {view.registry.weather.map((w) => (
              <option key={w.id} value={w.id} title={w.summary}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label className="lab-check">
          <input type="checkbox" checked={cfg.manualOrders} disabled={busy} onChange={(e) => onPatch({ manualOrders: e.target.checked })} />
          Strict manual orders
        </label>
        <label title="Renown of the allied commander, for the Command Claim readout in the Summary">
          Ally Renown
          <input type="number" min={0} value={cfg.allyRenown} disabled={busy} onChange={(e) => onPatch({ allyRenown: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
      </div>
      <div className="lab-fort">
        <label className="lab-check">
          <input
            type="checkbox"
            checked={Boolean(cfg.fortification)}
            disabled={busy}
            onChange={(e) => onPatch({ fortification: e.target.checked ? { side: "player", typeId: "wooden", row: 2, makeshift: false, pointsPerCell: 2 } : undefined })}
          />
          Fortification face
        </label>
        {cfg.fortification && (
          <div className="lab-grid2">
            <label>
              Side
              <select value={cfg.fortification.side} disabled={busy} onChange={(e) => onPatch({ fortification: { ...cfg.fortification!, side: e.target.value as "player" | "enemy", row: e.target.value === "player" ? 2 : 4 } })}>
                <option value="player">Player</option>
                <option value="enemy">Enemy</option>
              </select>
            </label>
            <label>
              Type
              <select value={cfg.fortification.typeId} disabled={busy} onChange={(e) => onPatch({ fortification: { ...cfg.fortification!, typeId: e.target.value } })}>
                {view.registry.fortifications.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Row
              <select value={cfg.fortification.row} disabled={busy} onChange={(e) => onPatch({ fortification: { ...cfg.fortification!, row: Number(e.target.value) } })}>
                {(cfg.fortification.side === "player" ? [1, 2] : [4, 5]).map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Points per cell
              <select value={cfg.fortification.pointsPerCell} disabled={busy} onChange={(e) => onPatch({ fortification: { ...cfg.fortification!, pointsPerCell: Number(e.target.value) } })}>
                {[1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="lab-check">
              <input type="checkbox" checked={cfg.fortification.makeshift} disabled={busy} onChange={(e) => onPatch({ fortification: { ...cfg.fortification!, makeshift: e.target.checked } })} />
              Makeshift (×0.6)
            </label>
          </div>
        )}
      </div>
    </details>
  );
}

function RosterPanel({
  title,
  side,
  lines,
  view,
  busy,
  onChange,
  attachIndex,
  onAttach,
}: {
  title: string;
  side: "player" | "enemy";
  lines: LabRosterLine[];
  view: LabView;
  busy: boolean;
  onChange: (lines: LabRosterLine[]) => void;
  attachIndex?: number;
  onAttach?: (i: number) => void;
}) {
  const sheets = view.registry.sheets;
  const update = (i: number, patch: Partial<LabRosterLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  // Expanded roster index → unit ids, for the attach picker.
  const expanded: string[] = [];
  const counts = new Map<string, number>();
  for (const l of lines) {
    for (let i = 0; i < l.count; i++) {
      const k = (counts.get(l.sheetId) ?? 0) + 1;
      counts.set(l.sheetId, k);
      expanded.push(`${side[0]}-${l.sheetId}-${k}`);
    }
  }
  return (
    <details open className="lab-panel">
      <summary>
        {title} <span className="muted">({expanded.length} units)</span>
      </summary>
      {lines.map((line, i) => (
        <div key={i} className="lab-line">
          <div className="lab-line-main">
            <select value={line.sheetId} disabled={busy} onChange={(e) => update(i, { sheetId: e.target.value })}>
              <optgroup label="Roster">
                {sheets.filter((s) => !view.registry.customSheetIds.includes(s.id)).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
              {view.registry.customSheetIds.length > 0 && (
                <optgroup label="Forged this session">
                  {sheets.filter((s) => view.registry.customSheetIds.includes(s.id)).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <input type="number" min={1} max={8} value={line.count} disabled={busy} onChange={(e) => update(i, { count: Math.max(1, Math.min(8, Number(e.target.value) || 1)) })} title="Count" />
            {side === "player" && (
              <select value={line.owner ?? "player"} disabled={busy} onChange={(e) => update(i, { owner: e.target.value as "player" | "ally" })} title="Who commands these">
                <option value="player">Mine</option>
                <option value="ally">Allied</option>
              </select>
            )}
            <label className="lab-check" title="Adds the veteran tag">
              <input type="checkbox" checked={line.veteran} disabled={busy} onChange={(e) => update(i, { veteran: e.target.checked })} />
              Vet
            </label>
            <button className="lab-x" disabled={busy || lines.length === 1} onClick={() => onChange(lines.filter((_, j) => j !== i))} title="Remove line">
              ×
            </button>
          </div>
          <details className="lab-overrides">
            <summary className="muted">Stat overrides{line.overrides && Object.keys(line.overrides).length ? " (active)" : ""}</summary>
            <OverrideEditor line={line} sheet={sheets.find((s) => s.id === line.sheetId)} busy={busy} onChange={(o) => update(i, { overrides: o })} />
          </details>
        </div>
      ))}
      <div className="lab-line-actions">
        <button disabled={busy} onClick={() => onChange([...lines, { sheetId: side === "player" ? "pedites_fyrd" : "peasant_levy", count: 1, veteran: false, extraTags: [] }])}>
          + Add unit line
        </button>
        {side === "player" && onAttach && (
          <label>
            Lord rides with
            <select value={Math.min(attachIndex ?? 0, Math.max(0, expanded.length - 1))} disabled={busy} onChange={(e) => onAttach(Number(e.target.value))}>
              {expanded.map((id, i) => (
                <option key={id} value={i}>
                  {id}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </details>
  );
}

function OverrideEditor({ line, sheet, busy, onChange }: { line: LabRosterLine; sheet?: LabView["registry"]["sheets"][number]; busy: boolean; onChange: (o: LabRosterLine["overrides"]) => void }) {
  const o = line.overrides ?? {};
  const set = (k: string, raw: string) => {
    const next: Record<string, unknown> = { ...o };
    if (raw === "") delete next[k];
    else next[k] = Number(raw);
    onChange(Object.keys(next).length ? (next as LabRosterLine["overrides"]) : undefined);
  };
  const setDmg = (which: "min" | "max", raw: string) => {
    const next: Record<string, unknown> = { ...o };
    const cur = (o.damage ?? sheet?.damage ?? { min: 1, max: 1 }) as { min: number; max: number };
    if (raw === "") delete next.damage;
    else next.damage = { ...cur, [which]: Number(raw) };
    onChange(Object.keys(next).length ? (next as LabRosterLine["overrides"]) : undefined);
  };
  const fields: [keyof NonNullable<LabRosterLine["overrides"]>, string][] = [
    ["hp", "HP"],
    ["atk", "ATK"],
    ["def", "DEF"],
    ["range", "Range"],
    ["speed", "Speed"],
    ["morale", "Morale"],
    ["strength", "Men"],
  ];
  return (
    <div className="lab-grid4">
      {fields.map(([k, label]) => (
        <label key={k}>
          {label}
          <input type="number" placeholder={String(sheet?.[k] ?? "")} value={(o[k] as number | undefined) ?? ""} disabled={busy} onChange={(e) => set(k, e.target.value)} />
        </label>
      ))}
      <label>
        Dmg min
        <input type="number" placeholder={String(sheet?.damage.min ?? "")} value={o.damage?.min ?? ""} disabled={busy} onChange={(e) => setDmg("min", e.target.value)} />
      </label>
      <label>
        Dmg max
        <input type="number" placeholder={String(sheet?.damage.max ?? "")} value={o.damage?.max ?? ""} disabled={busy} onChange={(e) => setDmg("max", e.target.value)} />
      </label>
    </div>
  );
}

function FieldPainter({
  cfg,
  view,
  busy,
  brush,
  setBrush,
  cliffBrush,
  setCliffBrush,
  onPatch,
}: {
  cfg: LabConfig;
  view: LabView;
  busy: boolean;
  brush: string;
  setBrush: (b: string) => void;
  cliffBrush: boolean;
  setCliffBrush: (v: boolean) => void;
  onPatch: (p: Partial<LabConfig>) => void;
}) {
  const paint = (row: number, col: number) => {
    const field = structuredClone(cfg.field);
    const cell = field.cells[(row - 1) * 3 + col];
    if (cliffBrush) cell.cliffBelow = !cell.cliffBelow;
    else if (brush === "grassland") cell.terrain = [];
    else if (cell.terrain.includes(brush)) cell.terrain = cell.terrain.filter((t) => t !== brush);
    else cell.terrain = [...cell.terrain, brush];
    onPatch({ field });
  };
  return (
    <details open className="lab-panel">
      <summary>Field painter</summary>
      <div className="lab-brushes">
        <select value={brush} disabled={busy || cliffBrush} onChange={(e) => setBrush(e.target.value)}>
          {view.registry.terrain
            .filter((t) => t.id !== "cliffs")
            .map((t) => (
              <option key={t.id} value={t.id} title={t.summary}>
                {t.name}
              </option>
            ))}
        </select>
        <label className="lab-check" title="Toggle a cliff boundary below the clicked cell">
          <input type="checkbox" checked={cliffBrush} disabled={busy} onChange={(e) => setCliffBrush(e.target.checked)} />
          Cliff below
        </label>
        <button disabled={busy} onClick={() => onPatch({ field: { ...cfg.field, cells: cfg.field.cells.map(() => ({ terrain: [], cliffBelow: false })) } })}>
          Clear
        </button>
      </div>
      <div className="lab-paint-grid">
        {allCells().map((c) => {
          const cell = cfg.field.cells[(c.row - 1) * 3 + c.col];
          return (
            <button key={cellKey(c)} className={`lab-paint-cell${cell.cliffBelow ? " cliff" : ""}`} disabled={busy} onClick={() => paint(c.row, c.col)} title={`Row ${c.row} / Col ${c.col}`}>
              <span className="lab-paint-rc">{c.row}·{c.col}</span>
              <span>{cell.terrain.length ? cell.terrain.join(" + ") : "—"}</span>
              {cell.cliffBelow && <span className="lab-cliff-mark">▼ cliff</span>}
            </button>
          );
        })}
      </div>
      <p className="tiny muted">Click a cell to toggle the brush terrain. Rows 1–2 are the player's, 4–5 the enemy's. A cliff under a cell blocks movement between that row and the next in that column.</p>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Field view
// ---------------------------------------------------------------------------

function GridView({ battle, selected, onSelect, controlled }: { battle: BattleState; selected: string | null; onSelect: (id: string) => void; controlled: string[] }) {
  const byCell = unitsByCell(battle);
  return (
    <div className="lab-grid-view">
      {allCells().map((c) => {
        const cell = battle.battlefield.cells[(c.row - 1) * 3 + c.col];
        const units = byCell.get(cellKey(c)) ?? [];
        const rowClass = c.row <= 2 ? "own" : c.row === 3 ? "nml" : "foe";
        return (
          <div key={cellKey(c)} className={`lab-cell ${rowClass}`}>
            <div className="lab-cell-head">
              <span>{c.row}·{["L", "C", "R"][c.col]}</span>
              <span className="muted">{cell.terrain.join("+")}{cell.cliffBelow ? " ▼" : ""}</span>
            </div>
            {cell.fortification && (
              <div className="lab-fort-points">
                {cell.fortification.points.map((p) => (
                  <span key={p.id} className={`lab-point${p.breached ? " breached" : ""}`} title={`${p.label}: ${p.hp}/${p.maxHp}, structural DEF ${p.structuralDef}, +${p.defenderDefBonus}`}>
                    {p.label} {p.breached ? "breached" : `${p.hp}/${p.maxHp}`}
                  </span>
                ))}
              </div>
            )}
            {units.map((u) => (
              <button key={u.id} className={`lab-chip ${u.side}${selected === u.id ? " selected" : ""}${controlled.includes(u.id) ? " controlled" : ""}`} onClick={() => onSelect(u.id)} title={u.id}>
                <span className="lab-chip-name">
                  {battle.player.attachedUnitId === u.id ? "♛ " : ""}
                  {shortName(u)}
                  {isEngaged(u) ? " ⚔" : ""}
                  {u.fort ? (u.fort.presented ? " ▣" : " ▢") : ""}
                </span>
                <span className="lab-bar hp">
                  <span style={{ width: `${pct(u.hp, u.maxHp)}%` }} />
                </span>
                <span className="lab-bar morale">
                  <span style={{ width: `${pct(u.morale, u.maxMorale)}%` }} />
                  {u.shield > 0 && <span className="shield" style={{ width: `${pct(u.shield, u.maxMorale)}%` }} />}
                </span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function UnitCard({ battle, unit, controllable, onQueue }: { battle: BattleState; unit: UnitInstance; controllable: boolean; onQueue: (o: Order) => void }) {
  const sheet = sheetFor(unit);
  const orders = availableOrders(battle, unit);
  const [orderType, setOrderType] = useState<string>(orders[0] ?? "hold");
  const [target, setTarget] = useState("");
  const [secondary, setSecondary] = useState("");
  const [amount, setAmount] = useState(10);
  const [shot, setShot] = useState<"solid" | "grape">("solid");
  useEffect(() => {
    setOrderType(orders.includes(orderType) ? orderType : orders[0] ?? "hold");
    setTarget("");
    setSecondary("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit.id, battle.round]);
  const options = targetOptions(battle, unit, orderType);
  const needsSecondary = orderType === "skirmish_and_withdraw";
  const moveOptions = needsSecondary ? targetOptions(battle, unit, "move") : [];
  const defender = isTerrainDefender(battle.units, unit);
  return (
    <div className="lab-unit-card">
      <div className="lab-unit-title">
        <strong>{unit.name}</strong> <span className="muted">[{unit.id}] · {unit.side}/{unit.owner} · {unit.status}</span>
      </div>
      <div className="lab-stats">
        <span>HP {unit.hp}/{unit.maxHp}</span>
        <span>Morale {unit.morale}/{unit.maxMorale}{unit.shield ? ` +${unit.shield} shield` : ""}</span>
        <span>ATK {sheet.atk}</span>
        <span>DEF {sheet.def}</span>
        <span>Dmg {sheet.damage.min}–{sheet.damage.max}</span>
        <span>Range {sheet.range}</span>
        <span>Speed {sheet.speed}</span>
        <span>Men {unit.strength}/{unit.initialStrength}</span>
        {unit.ammo !== undefined && <span>Ammo {unit.ammo}</span>}
        <span>Occupancy {unit.occupancyRounds}{defender ? " (defender)" : ""}</span>
        {unit.engagedWith.length > 0 && <span>Engaged: {unit.engagedWith.join(", ")}</span>}
        {unit.fireTarget && <span>Firing at {unit.fireTarget}</span>}
        {unit.pendingMove && <span>Moving → r{unit.pendingMove.to.row}c{unit.pendingMove.to.col} ({unit.pendingMove.paid}/{unit.pendingMove.cost})</span>}
        {unit.holdFormation && <span>Holding formation</span>}
        {unit.berserk && <span>Berserk</span>}
      </div>
      <div className="lab-tags">
        {unit.tags.map((t) => (
          <span key={t} className="lab-tag">
            {t}
          </span>
        ))}
      </div>
      {controllable ? (
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
          {options.length === 0 && ["engage", "fire", "attack_structure", "skirmish_and_withdraw"].includes(orderType) && <span className="muted">No legal target.</span>}
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
          {orderType === "fire" && unit.tags.includes("dual_shot_type") && (
            <select value={shot} onChange={(e) => setShot(e.target.value as "solid" | "grape")}>
              <option value="solid">Solid shot</option>
              <option value="grape">Grapeshot</option>
            </select>
          )}
          <button
            className="primary"
            onClick={() => {
              const o = buildOrder(unit, orderType, target, { amount, secondary, shot: unit.tags.includes("dual_shot_type") ? shot : undefined });
              if (o) onQueue(o);
            }}
          >
            Queue order
          </button>
        </div>
      ) : (
        <p className="muted tiny">{unit.side === "player" ? "Not under your command at this tier." : "Enemy unit — the script commander gives its orders."}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right column
// ---------------------------------------------------------------------------

function LogPanel({
  battle,
  kinds,
  setKinds,
  search,
  setSearch,
  roundOnly,
  setRoundOnly,
  showData,
  setShowData,
}: {
  battle: BattleState;
  kinds: Set<LogKind>;
  setKinds: (k: Set<LogKind>) => void;
  search: string;
  setSearch: (s: string) => void;
  roundOnly: boolean;
  setRoundOnly: (v: boolean) => void;
  showData: boolean;
  setShowData: (v: boolean) => void;
}) {
  const rows = filterLog(battle.log, { kinds, search, round: roundOnly ? battle.round : undefined });
  const toggle = (k: LogKind) => {
    const next = new Set(kinds);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setKinds(next);
  };
  return (
    <div className="lab-log">
      <div className="lab-log-filters">
        {LOG_KINDS.filter((k) => k !== "ai").map((k) => (
          <label key={k} className={`lab-kind ${k}${kinds.has(k) ? " on" : ""}`}>
            <input type="checkbox" checked={kinds.has(k)} onChange={() => toggle(k)} />
            {LOG_KIND_LABELS[k]}
          </label>
        ))}
      </div>
      <div className="lab-log-tools">
        <input placeholder="Search unit id or text…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="lab-check">
          <input type="checkbox" checked={roundOnly} onChange={(e) => setRoundOnly(e.target.checked)} />
          This round
        </label>
        <label className="lab-check">
          <input type="checkbox" checked={showData} onChange={(e) => setShowData(e.target.checked)} />
          Formula data
        </label>
        <button onClick={() => void navigator.clipboard.writeText(logToText(battle.log))}>Copy all</button>
      </div>
      <div className="lab-log-rows">
        {rows.length === 0 ? <p className="muted">Nothing matches.</p> : rows.map((e) => <LogRow key={e.seq} e={e} showData={showData} />)}
      </div>
    </div>
  );
}

function LogRow({ e, showData }: { e: BattleLogEntry; showData: boolean }) {
  return (
    <div className={`lab-log-row ${e.kind}`}>
      <span className="lab-log-meta">
        d{e.day} r{e.round} · {LOG_KIND_LABELS[e.kind]}
      </span>
      <span className="lab-log-text">{e.text}</span>
      {showData && e.data && <span className="lab-log-data">{formatLogData(e.data)}</span>}
    </div>
  );
}

function ForgePanel({
  view,
  busy,
  text,
  setText,
  onForge,
  onApprove,
  onReject,
  onDiscard,
}: {
  view: LabView;
  busy: boolean;
  text: string;
  setText: (s: string) => void;
  onForge: () => void;
  onApprove: () => void;
  onReject: () => void;
  onDiscard: (id: string) => void;
}) {
  const f = view.forge;
  const p = f.pending;
  return (
    <div className="lab-forge">
      <p className="tiny muted">
        Describe a unit in plain words. The model proposes a stat sheet and tags from the registry — or a new tag written only in the engine's hook vocabulary. Nothing enters the roster until you approve it, and forged units vanish when the lab closes.
      </p>
      <textarea value={text} disabled={busy || f.busy} onChange={(e) => setText(e.target.value)} placeholder="e.g. Saxon axe-men who rush the line and hit hard but panic when their leader falls…" />
      <div className="p-actions">
        <button className="primary" disabled={busy || f.busy || !text.trim()} onClick={onForge}>
          {f.busy ? "Forging…" : "Forge unit"}
        </button>
      </div>
      {f.error && <p className="settings-error">{f.error}</p>}
      {p && (
        <div className="lab-forge-card">
          <h4>
            {p.sheet.name} <span className="muted">[{p.sheet.id}] · {p.sheet.kind}{p.sheet.anachronistic ? " · anachronistic" : ""}</span>
          </h4>
          <div className="lab-stats">
            <span>HP {p.sheet.hp}</span>
            <span>ATK {p.sheet.atk}</span>
            <span>DEF {p.sheet.def}</span>
            <span>Dmg {p.sheet.damage.min}–{p.sheet.damage.max}</span>
            <span>Range {p.sheet.range}</span>
            <span>Speed {p.sheet.speed}</span>
            <span>Morale {p.sheet.morale}</span>
            <span>Men {p.sheet.strength}</span>
          </div>
          <div className="lab-tags">
            {p.sheet.tags.map((t) => (
              <span key={t} className={`lab-tag${p.newTags.some((n) => n.id === t) ? " new" : ""}`}>
                {t}
              </span>
            ))}
          </div>
          {p.newTags.length > 0 && (
            <details>
              <summary>New tag definitions ({p.newTags.length})</summary>
              <pre className="lab-pre">{JSON.stringify(p.newTags, null, 2)}</pre>
            </details>
          )}
          {p.rationale && <p className="lab-rationale">{p.rationale}</p>}
          {p.warnings.length > 0 && (
            <ul className="lab-warnings">
              {p.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <div className="p-actions">
            <button className="primary" disabled={busy} onClick={onApprove}>
              Approve — add to roster
            </button>
            <button disabled={busy} onClick={onReject}>
              Reject
            </button>
          </div>
        </div>
      )}
      {view.registry.customSheetIds.length > 0 && (
        <div className="lab-custom-list">
          <h4>Forged this session</h4>
          {view.registry.sheets
            .filter((s) => view.registry.customSheetIds.includes(s.id))
            .map((s) => (
              <div key={s.id} className="lab-custom-row">
                <span>
                  {s.name} <span className="muted">[{s.id}]</span>
                </span>
                <button className="lab-x" disabled={busy} onClick={() => onDiscard(s.id)} title="Discard">
                  ×
                </button>
              </div>
            ))}
        </div>
      )}
      {f.history.length > 0 && (
        <ul className="tiny muted lab-history">
          {f.history.slice(-8).map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SummaryPanel({ view }: { view: LabView }) {
  const s = view.summary;
  const b = view.battle;
  if (!s || !b) return <p className="muted lab-pad">Build and run a battle to see its ledger.</p>;
  return (
    <div className="lab-summary">
      <h4>
        {s.outcome === "undecided" ? "In progress" : s.outcome} · {s.rounds} rounds · day {s.days}
      </h4>
      <div className="lab-stats">
        <span>Morale dealt {s.moraleDealt}</span>
        <span>Morale taken {s.moraleTaken}</span>
        <span>Renown Δ {s.renownDelta >= 0 ? "+" : ""}{s.renownDelta}</span>
        <span>Prisoners taken {s.prisonersTaken}</span>
        <span>Prisoners lost {s.prisonersLost}</span>
        <span>Levy dead {s.levyDead}</span>
        <span>Pool {b.commandPool.remaining}/{b.commandPool.total}</span>
        <span>Lord: {s.player.fate}{s.player.alive ? "" : " (dead)"}</span>
        <span>Personal {s.player.personalDealt}/{s.player.personalTaken}</span>
        <span>Wounds {s.player.wounds.length}</span>
      </div>
      {view.claim && (
        <p className="tiny muted" title="Command_Claim_score = Renown + Σ(HP+ATK+DEF) of contributed files, vs the allied contingent">
          Command Claim: yours {view.claim.playerScore} vs allies {view.claim.bestAllyScore}
          {view.claim.allyUnits ? ` (${view.claim.allyUnits} allied files) — ${view.claim.playerWins ? "you would hold command" : "the ally would command"}` : " — no allies present, no claim to make"}.
        </p>
      )}
      <table className="lab-table">
        <thead>
          <tr>
            <th>Unit</th>
            <th>Side</th>
            <th>Status</th>
            <th>HP</th>
            <th>Morale</th>
            <th>Men</th>
            <th>Dead</th>
            <th>Captured</th>
            <th>Escaped</th>
            <th>Dealt/Taken</th>
            <th>Vet</th>
          </tr>
        </thead>
        <tbody>
          {s.units.map((u) => (
            <tr key={u.id} className={u.side}>
              <td title={u.id}>{u.name.replace(/\s*\(.*\)$/, "")}</td>
              <td>{u.side === "player" ? u.owner : "enemy"}</td>
              <td>{u.status}</td>
              <td>{u.hp}/{u.maxHp}</td>
              <td>{u.morale}/{u.maxMorale}</td>
              <td>{u.strength}/{u.initialStrength}</td>
              <td>{u.casualties}</td>
              <td>{u.captured}</td>
              <td>{u.escaped}</td>
              <td>{u.moraleDealt}/{u.moraleTaken}</td>
              <td>{u.veteranEarned ? "★" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
