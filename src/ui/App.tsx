import { useEffect, useMemo, useRef, useState } from "react";
import type { GameView } from "../shared/types";
import type { ChatMessage, PendingProposal } from "../engine/schema";
import { CANONICAL_RESOURCES, RESOURCE_UNITS } from "../engine/schema";
import { PROJECT_CATALOG } from "../engine/projectCatalog";
import { isCoreHouseholdId, matchHireableSpecialist } from "../engine/specialists";
import type { AldricEmotion } from "../engine/emotion";
import { normalizeEmotion } from "../engine/emotion";
import { BUTTON_CLICK, GAME_THEMES, TITLE_MENU_BACKGROUND, TITLE_SCREEN, TITLE_THEME, npcPortrait } from "./art";
import { DEFAULT_MODELS, LLM_PROVIDERS, PROVIDER_META, type AppSettings, type LlmProvider } from "../llm/types";
import { defaultAppSettings } from "../llm/settings";

function musicGain(s: Pick<AppSettings, "masterVolume" | "musicVolume">): number {
  return Math.min(1, Math.max(0, (s.masterVolume ?? 1) * (s.musicVolume ?? 0.55)));
}
type Screen = "title" | "game";

export function App() {
  const [screen, setScreen] = useState<Screen>("title");
  const [view, setView] = useState<GameView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(defaultAppSettings);
  const [models, setModels] = useState<{ id: string }[]>([]);
  const [displayEmotion, setDisplayEmotion] = useState<AldricEmotion>("neutral");
  const scroller = useRef<HTMLDivElement>(null);

  const poseCue = view
    ? ([...view.messages].reverse().find((m) => m.role === "npc" && m.npcId === view.sceneNpcId)?.id ?? `${view.sceneNpcId}:${view.sceneEmotion}`)
    : "";

  useEffect(() => {
    if (!view) return;
    const next = normalizeEmotion(view.sceneEmotion) ?? "neutral";
    setDisplayEmotion(next);
    if (next === "neutral") return;
    const timer = window.setTimeout(() => setDisplayEmotion("neutral"), 5000);
    return () => window.clearTimeout(timer);
    // Restart only when the speaking NPC actually changes pose.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- poseCue captures the new line
  }, [poseCue]);

  async function refresh() {
    const v = (await window.api.getView()) as GameView;
    setView(v);
  }

  useEffect(() => {
    void (async () => {
      try {
        setSettings((await window.api.getSettings()) as AppSettings);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [view?.messages.length, view?.sceneNpcId]);

  useEffect(() => {
    if (!view?.pending.length) return;
    document.getElementById("pending-proposals")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [view?.pending.length]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const volumeRef = useRef(musicGain(settings));
  const masterRef = useRef(settings.masterVolume ?? 1);
  volumeRef.current = musicGain(settings);
  masterRef.current = settings.masterVolume ?? 1;

  useEffect(() => {
    const audio = new Audio();
    audio.volume = volumeRef.current;
    audioRef.current = audio;
    let lastGameSrc = "";

    const playRandomGameTrack = () => {
      const pool = GAME_THEMES.filter((src) => src !== lastGameSrc);
      const choices = pool.length ? pool : GAME_THEMES;
      lastGameSrc = choices[Math.floor(Math.random() * choices.length)];
      audio.loop = false;
      audio.src = lastGameSrc;
      audio.volume = volumeRef.current;
      void audio.play().catch(() => {
        /* autoplay may wait for a click */
      });
    };

    const onEnded = () => {
      if (screen === "game") playRandomGameTrack();
    };
    audio.addEventListener("ended", onEnded);

    if (screen === "title") {
      audio.loop = true;
      audio.src = TITLE_THEME;
      void audio.play().catch(() => {
        /* autoplay may wait for a click */
      });
    } else {
      playRandomGameTrack();
    }

    const tryPlay = () => {
      if (audio.paused) {
        void audio.play().catch(() => {
          /* still blocked */
        });
      }
    };
    window.addEventListener("pointerdown", tryPlay);
    return () => {
      window.removeEventListener("pointerdown", tryPlay);
      audio.removeEventListener("ended", onEnded);
      audio.pause();
      audio.src = "";
      if (audioRef.current === audio) audioRef.current = null;
    };
  }, [screen]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volumeRef.current;
  }, [settings.masterVolume, settings.musicVolume]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest("button");
      if (!(button instanceof HTMLButtonElement) || button.disabled) return;
      const fx = new Audio(BUTTON_CLICK);
      fx.volume = Math.min(1, Math.max(0, masterRef.current * 0.6));
      void fx.play().catch(() => {
        /* click may be blocked until a gesture */
      });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  const npc = view?.state.npcs.find((n) => n.id === view.sceneNpcId);

  async function withBusy(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      const result = (await fn()) as GameView & { error?: string };
      if (result && "state" in result) setView(result);
      if (result && "error" in result && result.error) setError(result.error);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function startNew() {
    const result = await withBusy(() => window.api.newGame());
    if (result && "state" in result) setScreen("game");
  }

  async function startLoad() {
    setBusy(true);
    setError(null);
    try {
      const result = (await window.api.loadGame()) as GameView | null;
      if (result && "state" in result) {
        setView(result);
        setScreen("game");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!view || !draft.trim()) return;
    const text = draft.trim();
    setDraft("");
    await withBusy(() => window.api.sendDialogue(view.sceneNpcId, text));
  }

  const settingsModal = settingsOpen && (
    <SettingsModal
      settings={settings}
      models={models}
      onClose={() => setSettingsOpen(false)}
      onLoadModels={async () => {
        const list = (await window.api.listModels()) as { id: string }[];
        setModels(list);
      }}
      onSave={async (s) => {
        setSettings((await window.api.setSettings(s)) as AppSettings);
        setSettingsOpen(false);
      }}
      onVolume={async (patch) => {
        setSettings((await window.api.setSettings(patch)) as AppSettings);
      }}
    />
  );

  if (screen === "title") {
    return (
      <div
        className="title-screen"
        style={{ backgroundImage: `url(${TITLE_MENU_BACKGROUND})` }}
      >
        <img className="title-art" src={TITLE_SCREEN} alt="Isekai in the year of our lord 825" />
        <nav className="title-menu">
          <button className="primary" disabled={busy} onClick={() => void startNew()}>
            New Game
          </button>
          <button disabled={busy} onClick={() => void startLoad()}>
            Load Game
          </button>
          <button disabled={busy} onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
          <button disabled={busy} onClick={() => void window.api.quit()}>
            Exit
          </button>
        </nav>
        {busy && <p className="title-status">Opening the estate books…</p>}
        {error && <p className="error">{error}</p>}
        {settingsModal}
      </div>
    );
  }

  if (!view) {
    return (
      <div className="boot">
        <p>Opening the estate books…</p>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  const portraitSrc = npcPortrait(view.sceneNpcId, displayEmotion, view.state.merchant.face);

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <div className="title">Villa of Fontenay</div>
          <div className="sub">
            {cap(view.state.meta.season)} {view.state.meta.year} · turn {view.state.meta.turn} · {view.state.player.name}
          </div>
        </div>
        <div className="top-actions">
          <button onClick={() => setScreen("title")} disabled={busy}>
            Title
          </button>
          <button onClick={() => window.api.saveGame()} disabled={busy}>
            Save
          </button>
          <button onClick={() => setSettingsOpen(true)}>Settings</button>
          <button
            className="primary"
            onClick={() => withBusy(() => window.api.advanceSeason())}
            disabled={busy}
            title={view.pending.length ? "Unconfirmed orders will lapse if you advance." : "Resolve the season and write events to the ledger"}
          >
            Advance season
          </button>
        </div>
      </header>

      {error && <div className="banner">{error}</div>}
      {busy && <div className="banner muted">Waiting on the court…</div>}
      {view.pending.length > 0 && (
        <div className="banner pending">
          {view.pending.length} proposed ledger change{view.pending.length === 1 ? "" : "s"} — Confirm writes world-state.json.
          Advancing the season will lapse unconfirmed orders.
        </div>
      )}

      <div className="layout">
        <section className="dialogue">
          <div className="scene-tabs">
            <button
              className={view.sceneNpcId === "steward" ? "active" : ""}
              onClick={() => withBusy(() => window.api.setScene("steward"))}
            >
              Steward · Aldric
            </button>
            <button
              className={view.sceneNpcId === "smith" ? "active" : ""}
              disabled={!view.smithAvailable}
              title={view.smithAvailable ? "Speak with the smith" : "Requires a forge on the estate"}
              onClick={() => view.smithAvailable && withBusy(() => window.api.setScene("smith"))}
            >
              Smith · Bernard
            </button>
            <button
              className={view.sceneNpcId === "chaplain" ? "active" : ""}
              disabled={!view.chaplainAvailable}
              title={view.chaplainAvailable ? "Speak with the chaplain" : "Requires a chapel or cell on the estate"}
              onClick={() => view.chaplainAvailable && withBusy(() => window.api.setScene("chaplain"))}
            >
              Chaplain · Ermenald
            </button>
            {view.state.npcs
              .filter((n) => !isCoreHouseholdId(n.id))
              .map((n) => (
                <button
                  key={n.id}
                  className={view.sceneNpcId === n.id ? "active" : ""}
                  title={`Speak with ${n.name}`}
                  onClick={() => withBusy(() => window.api.setScene(n.id))}
                >
                  {cap(n.role.replaceAll("_", " "))} · {n.name}
                </button>
              ))}
            <button
              className={view.sceneNpcId === "merchant" ? "active" : ""}
              disabled={!view.merchantAvailable}
              title={
                view.merchantAvailable
                  ? `Speak with ${view.state.merchant.name ?? "the merchant"}`
                  : "No merchant is in the district this season"
              }
              onClick={() => view.merchantAvailable && withBusy(() => window.api.setScene("merchant"))}
            >
              Merchant{view.state.merchant.name ? ` · ${view.state.merchant.name}` : ""}
            </button>
          </div>

          <div className="talk">
            {portraitSrc && (
              <aside className={`portrait ${view.sceneNpcId}`}>
                <img src={portraitSrc} alt={npc?.name ?? "Speaker"} />
              </aside>
            )}
            <div className="log" ref={scroller}>
              {view.messages.length === 0 ? (
                <p className="muted empty-log">
                  {view.sceneNpcId === "merchant" && !view.merchantAvailable ? "No one here." : "No words yet."}
                </p>
              ) : (
                view.messages.map((m) => <MessageBubble key={m.id} m={m} />)
              )}
            </div>
          </div>

          {view.pending.length > 0 && (
            <div className="proposals" id="pending-proposals">
              <h3>Proposed changes — Confirm writes the ledger</h3>
              <p className="proposal-help">Speech does not change stores. Only Confirm applies numbers to world-state.json.</p>
              {view.pending.map((p) => (
                <ProposalCard
                  key={p.id}
                  p={p}
                  busy={busy}
                  onConfirm={() => withBusy(() => window.api.confirmProposal(p.id))}
                  onReject={() => withBusy(() => window.api.rejectProposal(p.id))}
                />
              ))}
            </div>
          )}

          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <textarea
              value={draft}
              disabled={busy}
              placeholder={composerPlaceholder(view)}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button type="submit" className="primary" disabled={busy || !draft.trim()}>
              Speak to {npc?.name ?? "them"}
            </button>
          </form>
        </section>

        <Ledger view={view} />
      </div>

      {settingsModal}
    </div>
  );
}

function MessageBubble({ m }: { m: ChatMessage }) {
  const who =
    m.role === "player" ? "You" : m.role === "system" ? "Ledger" : m.npcName ?? "Voice";
  return (
    <article className={`bubble ${m.role}`}>
      <div className="who">{who}</div>
      <div className="text">{m.text}</div>
      {m.chronicle && <div className="chronicle">{m.chronicle}</div>}
    </article>
  );
}

function ProposalCard({
  p,
  busy,
  onConfirm,
  onReject,
}: {
  p: PendingProposal;
  busy: boolean;
  onConfirm: () => void;
  onReject: () => void;
}) {
  return (
    <div className="proposal">
      <div className="p-type">{p.proposal.type.replaceAll("_", " ")}</div>
      <div className="p-sum">{p.proposal.summary}</div>
      <div className="p-blurb">{proposalBlurb(p.proposal)}</div>
      <details>
        <summary>Ledger delta</summary>
        <pre className="p-json">{JSON.stringify(p.proposal, null, 2)}</pre>
      </details>
      <div className="p-actions">
        <button className="primary" disabled={busy} onClick={onConfirm}>
          Confirm
        </button>
        <button disabled={busy} onClick={onReject}>
          Reject
        </button>
      </div>
    </div>
  );
}

function proposalBlurb(p: PendingProposal["proposal"]): string {
  switch (p.type) {
    case "adjust_sowing": {
      const bits = [];
      if (p.springBarleyShare != null) bits.push(`spring barley ${Math.round(p.springBarleyShare * 100)}% of remaining`);
      if (p.autumnWheatShare != null) bits.push(`autumn wheat ${Math.round(p.autumnWheatShare * 100)}%`);
      if (p.barley != null) bits.push(`${p.barley} acres barley`);
      return bits.join(" · ") || "Change the sowing mix";
    }
    case "start_project":
      return `Start ${p.name ?? p.projectKey} on ${p.holdingId ?? "the holding"}`;
    case "transfer_resources":
      return `${p.direction} ${p.amount} ${p.resource}${p.reason ? ` (${p.reason})` : ""}`;
    case "add_modifier":
      return `${p.target} ${p.effect.op} ${p.effect.value} · ${p.kind}${p.seasonsRemaining != null ? ` · ${p.seasonsRemaining} seasons` : ""}`;
    case "assign_labour":
      return `${p.men} men, ${p.women} women, ${p.youths} youths → ${p.projectId}`;
    case "set_standing_order":
      return p.text;
    case "register_npc": {
      const spec = matchHireableSpecialist(p.npc);
      const gift = spec
        ? spec.hireGrainRation
          ? ` · ${spec.hireCostDenarii} denarii and a household grain ration`
          : ` · ${spec.hireCostDenarii} denarii hiring gift`
        : "";
      return `Record ${p.npc.name} as ${p.npc.role.replaceAll("_", " ")}${gift}`;
    }
    case "event_effect":
      return `${p.eventId}${p.resource ? ` · ${p.direction} ${p.amount} ${p.resource}` : ""}${p.moodDelta ? ` · mood ${p.moodDelta}` : ""}`;
    default:
      return p.summary;
  }
}

function Ledger({ view }: { view: GameView }) {
  const s = view.state;
  const holding = s.holdings[0];
  return (
    <aside className="ledger">
      <h2>Estate ledger</h2>
      <p className="muted">{s.meta.region}</p>
      {s.flags.merchant_present && s.merchant.present && (
        <p className="flag">
          Merchant {s.merchant.name ?? "unknown"} is in the district
          {s.merchant.last_chance != null ? ` (rolled ${Math.round(s.merchant.last_chance * 100)}%).` : "."}
        </p>
      )}
      {s.flags.hunger && <p className="flag warn">Hunger on the estate.</p>}
      {s.labour.harvest_risk && <p className="flag warn">Harvest at risk — too much male labour drawn off.</p>}

      <h3>Coin & people</h3>
      <Row k="Denarii" v={fmt(s.resources.denarii)} />
      <Row k="Households / manses" v={String(s.population.households)} />
      <Row k="Adult men / women / youths" v={`${s.population.adult_men} / ${s.population.adult_women} / ${s.population.youths}`} />
      <Row
        k="Callable labour left (days)"
        v={`m ${view.labour.remaining.men}/${view.labour.pool.men} · w ${view.labour.remaining.women}/${view.labour.pool.women} · y ${view.labour.remaining.youths}/${view.labour.pool.youths}`}
      />
      {s.npcs
        .filter((n) => n.id !== "merchant")
        .map((n) => (
          <Row key={n.id} k={n.name} v={label(n.role)} />
        ))}

      <h3>Land — {holding?.name}</h3>
      {holding &&
        Object.entries(holding.land).map(([k, v]) => <Row key={k} k={label(k)} v={`${v} acres`} />)}
      {holding && (
        <>
          <h3>Sown</h3>
          {Object.entries(holding.sown).map(([k, v]) => (
            <Row key={k} k={label(k)} v={`${v} acres`} />
          ))}
          <Row
            k="Spring barley share"
            v={`${Math.round((s.agriculture?.springBarleyShare ?? 0.6) * 100)}% of remaining (rest oats)`}
          />
          <Row k="Autumn wheat share" v={`${Math.round((s.agriculture?.autumnWheatShare ?? 0.45) * 100)}% (rest rye)`} />
          <h3>Features</h3>
          <p>{holding.features.map(label).join(", ") || "none"}</p>
        </>
      )}

      {s.merchant.present && (
        <>
          <h3>Merchant stall · {s.merchant.name ?? "Peddler"}</h3>
          {s.merchant.stock.length === 0 && <p className="muted">The carts are empty.</p>}
          {s.merchant.stock.map((w) => {
            const range = s.market[w.resource];
            const price = range ? `${range.min}–${range.max} d.` : "price unset";
            return <Row key={w.resource} k={label(w.resource)} v={`${w.amount} on the carts · ${price}`} />;
          })}
        </>
      )}

      <h3>Stores</h3>
      {CANONICAL_RESOURCES.filter((r) => r !== "denarii").map((r) => (
        <Row key={r} k={label(r)} v={`${fmt(s.resources[r])} ${RESOURCE_UNITS[r]}`} hideZero={s.resources[r] === 0} />
      ))}
      {s.custom_resources.map((c) => (
        <Row key={c.id} k={c.name} v={`${fmt(c.amount)} ${c.unit}`} />
      ))}

      <h3>Market (denarii)</h3>
      {Object.entries(s.market)
        .slice(0, 16)
        .map(([k, p]) => (
          <Row key={k} k={label(k)} v={`${p.min}–${p.max}`} />
        ))}

      <h3>Projects</h3>
      {s.projects.filter((p) => p.status === "active").length === 0 && <p className="muted">None underway.</p>}
      {s.projects
        .filter((p) => p.status === "active")
        .map((p) => (
          <Row key={p.id} k={p.name} v={`${p.labourDaysDone}/${p.labourDaysRequired} days`} />
        ))}
      <details>
        <summary>Known works (catalogue)</summary>
        <ul className="tiny">
          {PROJECT_CATALOG.map((p) => (
            <li key={p.key}>
              {p.name} — {p.labourDays} days, {p.lumber} timber, {p.iron} iron, {p.stone} stone
            </li>
          ))}
        </ul>
      </details>

      <h3>Modifiers</h3>
      {s.modifiers.length === 0 && <p className="muted">No special techniques or buffs.</p>}
      {s.modifiers.map((m) => (
        <Row
          key={m.id}
          k={m.source}
          v={`${m.target} ${m.effect.op} ${m.effect.value} (${m.kind}${m.seasons_remaining != null ? `, ${m.seasons_remaining} seasons` : ""})`}
        />
      ))}

      <h3>Standing orders</h3>
      {s.standing_orders
        .filter((o) => o.active)
        .map((o) => (
          <p key={o.id} className="order">
            {o.text}
          </p>
        ))}

      <h3>Techniques</h3>
      {s.known_techniques.length === 0 && <p className="muted">None recorded.</p>}
      {s.known_techniques.map((t) => (
        <Row key={t.id} k={t.name} v={`turn ${t.discoveredTurn}`} />
      ))}
    </aside>
  );
}

function Row({ k, v, hideZero }: { k: string; v: string; hideZero?: boolean }) {
  if (hideZero) return null;
  return (
    <div className="row">
      <span>{k}</span>
      <span>{v}</span>
    </div>
  );
}

function SettingsModal({
  settings,
  models,
  onClose,
  onSave,
  onLoadModels,
  onVolume,
}: {
  settings: AppSettings;
  models: { id: string }[];
  onClose: () => void;
  onSave: (s: AppSettings) => Promise<void>;
  onLoadModels: () => Promise<void>;
  onVolume: (patch: { masterVolume?: number; musicVolume?: number }) => Promise<void>;
}) {
  const [provider, setProvider] = useState<LlmProvider>(settings.provider);
  const [providers, setProviders] = useState(settings.providers);
  const [masterVolume, setMasterVolume] = useState(settings.masterVolume);
  const [musicVolume, setMusicVolume] = useState(settings.musicVolume);
  const [catalogProvider, setCatalogProvider] = useState<LlmProvider | null>(null);
  const [listing, setListing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const current = providers[provider];
  const meta = PROVIDER_META[provider];
  const uniqueModels = useMemo(() => {
    if (catalogProvider !== provider) return current.model ? [current.model] : [];
    const ids = new Set(models.map((m) => m.id));
    if (current.model) ids.add(current.model);
    return [...ids];
  }, [models, current.model, catalogProvider, provider]);

  function patchActive(next: Partial<{ apiKey: string; model: string }>) {
    setProviders((prev) => ({
      ...prev,
      [provider]: { ...prev[provider], ...next },
    }));
  }

  function snapshot(): AppSettings {
    return { provider, providers, masterVolume, musicVolume };
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <label>
          Provider
          <select
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value as LlmProvider);
              setListError(null);
            }}
          >
            {LLM_PROVIDERS.map((id) => (
              <option key={id} value={id}>
                {PROVIDER_META[id].label}
              </option>
            ))}
          </select>
        </label>
        <p className="settings-help">{meta.help}</p>
        <label>
          Master volume
          <span className="volume-row">{Math.round(masterVolume * 100)}%</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(masterVolume * 100)}
            onChange={(e) => {
              const value = Number(e.target.value) / 100;
              setMasterVolume(value);
              void onVolume({ masterVolume: value });
            }}
          />
        </label>
        <label>
          Music volume
          <span className="volume-row">{Math.round(musicVolume * 100)}%</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(musicVolume * 100)}
            onChange={(e) => {
              const value = Number(e.target.value) / 100;
              setMusicVolume(value);
              void onVolume({ musicVolume: value });
            }}
          />
        </label>
        <label>
          API key
          <input
            type="password"
            value={current.apiKey}
            onChange={(e) => patchActive({ apiKey: e.target.value })}
            placeholder={meta.keyPlaceholder}
          />
        </label>
        <label>
          Model id
          <input
            value={current.model}
            onChange={(e) => patchActive({ model: e.target.value })}
            placeholder={DEFAULT_MODELS[provider]}
          />
        </label>
        <div className="p-actions">
          <button
            disabled={listing || !current.apiKey}
            onClick={async () => {
              setListing(true);
              setListError(null);
              try {
                await window.api.setSettings(snapshot());
                await onLoadModels();
                setCatalogProvider(provider);
              } catch (e) {
                setListError(e instanceof Error ? e.message : String(e));
              } finally {
                setListing(false);
              }
            }}
          >
            {listing ? "Listing…" : "List models"}
          </button>
        </div>
        {listError && <p className="settings-error">{listError}</p>}
        {uniqueModels.length > 0 && catalogProvider === provider && (
          <label>
            Catalog
            <select value={current.model} onChange={(e) => patchActive({ model: e.target.value })}>
              {uniqueModels.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="p-actions">
          <button className="primary" onClick={() => onSave(snapshot())}>
            Save
          </button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function composerPlaceholder(view: GameView): string {
  switch (view.sceneNpcId) {
    case "smith":
      return "Tell Bernard what you want of the forge…";
    case "chaplain":
      return "Speak with Father Ermenald of the cell…";
    case "merchant":
      return `Haggle with ${view.state.merchant.name ?? "the merchant"} over the carts…`;
    case "quarry_master":
      return "Speak with Colman of the stone…";
    case "carpenter":
      return "Speak with Haimo of the timber…";
    case "mason":
      return "Speak with Gerold of the masonry…";
    case "potter":
      return "Speak with Hugo of the kiln…";
    case "village_reeve":
      return "Speak with Otto of the village…";
    case "vinedresser":
      return "Speak with Ambrosius of the vines…";
    case "head_seamstress":
      return "Speak with Hildegard of the cloth…";
    case "copper_smith":
      return "Speak with Lorenzo of the copper…";
    case "captain":
      return "Speak with Eberhard of the watch…";
    default:
      return "Tell Aldric how the land and stores should be kept…";
  }
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function label(s: string) {
  return s.replaceAll("_", " ");
}

function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
