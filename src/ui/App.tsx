import { memo, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { GameView } from "../shared/types";
import type { ChatMessage, PendingProposal, Season } from "../engine/schema";
import { isCoreHouseholdId } from "../engine/specialists";
import { normalizeEmotion, type AldricEmotion } from "../engine/emotion";
import { BooksPanel } from "./BooksPanel";
import { PeopleHappinessMeter } from "./PeopleHappinessMeter";
import { VassalRow } from "./VassalRow";
import {
  BUTTON_CLICK,
  COINS,
  GAME_OVER_THEME,
  GAME_THEMES,
  HALL_HORN,
  NPC_WANTS_TALK,
  PEN_CONFIRM,
  SEASON_FANFARE,
  TITLE_MENU_BACKGROUND,
  TITLE_SCREEN,
  TITLE_THEME,
  npcPortrait,
} from "./art";
import {
  confirmSfx,
  hallHornDue,
  musicBedFor,
  musicGain,
  seasonAdvanceSfx,
  seasonFanfareOnAdvancePress,
  seasonKey,
  sfxGain,
  uiClickFromEvent,
  uiClickOnEnabledButton,
} from "./sfx";
import { createSfxPlayer, type SfxPlayer } from "./sfxPlayback";
import {
  SEASON_IDLE_FRAME_MS,
  SEASON_TIMBER_FRAME,
  SEASON_TRANSITION_FRAME_MS,
  beginSeasonTransition,
  nextIdleFrameIndex,
  preloadSeasonImages,
  seasonFrameIdleBoxStyle,
  seasonHeaderSrc,
  seasonIdleFrames,
  seasonTransitionFrames,
  transitionReelFor,
  type SeasonTransitionPlay,
} from "./seasonAnim";
import {
  nextWaitingFrameIndex,
  preloadWaitingImages,
  waitingFrame,
  waitingFrameDurationMs,
  waitingFrames,
} from "./waitingAnim";
import { DEFAULT_MODELS, LLM_PROVIDERS, PROVIDER_META, type AppSettings, type LlmProvider } from "../llm/types";
import { defaultAppSettings } from "../llm/settings";
import { emptyMeter, type LlmMeter } from "../llm/usage";
import { applyServerDialogueView, viewWithOptimisticPlayer } from "./chatSend";
import { hudInkLine, hudInkTitle, settingsInkLines } from "./scribeInk";
import { confirmBanner, playerFacingReason, roleName } from "./ledgerCopy";
import { ProposalsPanel } from "./ProposalsPanel";
import { GlossaryProvider, GlossaryText } from "./GlossaryText";
import { ShopPanel } from "./ShopPanel";
import { BattleLab } from "./lab/BattleLab";
import { BattleScreen } from "./battle/BattleScreen";
import { TutorialOverlay } from "./TutorialOverlay";
import type { TutorialState } from "../engine/tutorial";

type Screen = "title" | "game" | "lab";

export function App() {
  const [screen, setScreen] = useState<Screen>("title");
  const [view, setView] = useState<GameView | null>(null);
  const [busy, setBusy] = useState(false);
  const [speakWaiting, setSpeakWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(defaultAppSettings);
  const [models, setModels] = useState<{ id: string }[]>([]);
  const [displayEmotion, setDisplayEmotion] = useState<AldricEmotion>("neutral");
  const [loopingSeason, setLoopingSeason] = useState<Season | null>(null);
  const [seasonTransitionPlay, setSeasonTransitionPlay] = useState<SeasonTransitionPlay | null>(null);
  /** The main screen pans right to the field while a battle session is open. */
  const [onField, setOnField] = useState(false);
  const inBattle = Boolean(view?.state.battle_session);
  useEffect(() => {
    if (inBattle) {
      setOnField(true);
      playSfx(HALL_HORN, true);
    } else {
      setOnField(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pan follows the session opening/closing only
  }, [inBattle]);
  const scroller = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const focusComposer = useRef(false);
  const sendLock = useRef(false);
  /**
   * Opening tutorial. The renderer holds the truth for the session so a view
   * from an in-flight call cannot step it backwards; the save mirrors it.
   */
  const [tutorial, setTutorial] = useState<TutorialState | null>(null);
  const [composerPrefill, setComposerPrefill] = useState<{ text: string; nonce: number } | null>(null);

  function changeTutorial(next: TutorialState) {
    setTutorial(next);
    void Promise.resolve()
      .then(() => window.api.setTutorial?.(next))
      .catch(() => {
        /* progress still lives in this session */
      });
  }

  function adoptTutorial(next: GameView) {
    setTutorial(next.state.tutorial ?? { status: "declined", step: 0 });
  }

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

  // The chronicle's last page (03_HISTORY §13): written once, when the lord is dead and no page exists yet.
  const gameOver = Boolean(
    view && (view.state.history?.dead || view.state.player.dead || view.state.player.captive || view.state.player.maimed || view.state.estateAbandoned),
  );
  const needsEnding = Boolean(gameOver && !view?.state.battle_session && !view?.state.history?.ending);
  useEffect(() => {
    if (!needsEnding || busy || !window.api.writeEnding) return;
    void (async () => {
      try {
        const result = (await window.api.writeEnding()) as GameView;
        if (result && "state" in result) setView(result);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per death
  }, [needsEnding]);

  useEffect(() => {
    if (!focusComposer.current || busy) return;
    focusComposer.current = false;
    document.getElementById("talk-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    composerRef.current?.focus();
    document.getElementById("talk-composer")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [busy, view?.sceneNpcId, view?.messages.length]);

  useEffect(() => {
    if (!view?.pending.length) return;
    document.getElementById("pending-proposals")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [view?.pending.length]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const volumeRef = useRef(musicGain(settings));
  const masterRef = useRef(settings.masterVolume ?? 1);
  const hornSeasonRef = useRef<string | null>(null);
  const advancingRef = useRef(false);
  const sfxPlayerRef = useRef<SfxPlayer | null>(null);
  if (sfxPlayerRef.current == null) {
    sfxPlayerRef.current = createSfxPlayer({ getMusic: () => audioRef.current });
  }
  volumeRef.current = musicGain(settings);
  masterRef.current = settings.masterVolume ?? 1;
  const musicBed = musicBedFor(screen, Boolean(view?.state.estateAbandoned));

  function playSfx(src: string, duckMusic = false) {
    sfxPlayerRef.current?.play(src, sfxGain(masterRef.current), { duckMusic });
  }

  function considerHallHorn(next: GameView) {
    const key = seasonKey(next.state.meta);
    if (hornSeasonRef.current === key) return;
    hornSeasonRef.current = key;
    if (hallHornDue(next)) playSfx(HALL_HORN, true);
  }

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
      if (musicBed === "game") playRandomGameTrack();
    };
    audio.addEventListener("ended", onEnded);

    if (musicBed === "title") {
      audio.loop = true;
      audio.src = TITLE_THEME;
      void audio.play().catch(() => {
        /* autoplay may wait for a click */
      });
    } else if (musicBed === "gameOver") {
      audio.loop = true;
      audio.src = GAME_OVER_THEME;
      audio.volume = volumeRef.current;
      void audio.play().catch(() => {
        /* autoplay may wait for a click */
      });
    } else {
      playRandomGameTrack();
    }

    const tryPlay = () => {
      sfxPlayerRef.current?.unlock();
      if (audio.paused && !sfxPlayerRef.current?.holdingMusic) {
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
  }, [musicBed]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volumeRef.current;
  }, [settings.masterVolume, settings.musicVolume]);

  useEffect(() => {
    const player = sfxPlayerRef.current;
    player?.preload([BUTTON_CLICK, PEN_CONFIRM, SEASON_FANFARE, HALL_HORN, COINS]);
    const onUiClick = (event: Event) => {
      if (!uiClickOnEnabledButton(event as { type: string; button?: number; detail?: number; target?: HTMLElement | null })) return;
      player?.play(BUTTON_CLICK, sfxGain(masterRef.current));
    };
    document.addEventListener("pointerdown", onUiClick, true);
    document.addEventListener("click", onUiClick, true);
    return () => {
      document.removeEventListener("pointerdown", onUiClick, true);
      document.removeEventListener("click", onUiClick, true);
    };
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
    hornSeasonRef.current = null;
    const result = await withBusy(() => window.api.newGame());
    if (result && "state" in result) {
      adoptTutorial(result);
      setScreen("game");
      considerHallHorn(result);
    }
  }

  async function startLoad() {
    setBusy(true);
    setError(null);
    try {
      const result = (await window.api.loadGame()) as GameView | null;
      if (result && "state" in result) {
        setView(result);
        adoptTutorial(result);
        setScreen("game");
        considerHallHorn(result);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function advanceSeason() {
    if (!view || advancingRef.current) return;
    advancingRef.current = true;
    if (seasonFanfareOnAdvancePress()) playSfx(SEASON_FANFARE, true);
    const from = view.state.meta.season;
    setSeasonTransitionPlay(null);
    setLoopingSeason(from);
    try {
      const result = await withBusy(() => window.api.advanceSeason());
      const landed = result && "state" in result ? result : null;
      const to = landed?.state.meta.season;
      if (to) setSeasonTransitionPlay(beginSeasonTransition(from, to));
      seasonAdvanceSfx(from, landed);
      if (landed && !landed.state.estateAbandoned) considerHallHorn(landed);
    } finally {
      setLoopingSeason(null);
      advancingRef.current = false;
    }
  }

  function onAdvanceSeasonActivate(event: { type: string; button?: number; detail?: number }) {
    if (!uiClickFromEvent(event)) return;
    void advanceSeason();
  }

  async function confirmPending(p: PendingProposal) {
    const result = await withBusy(() => window.api.confirmProposal(p.id));
    const cues = confirmSfx(p.proposal, result && "state" in result ? result : null);
    if (cues.pen) playSfx(PEN_CONFIRM);
    if (cues.coins) playSfx(COINS);
  }

  async function confirmAllPending() {
    const result = await withBusy(() => window.api.confirmAllProposals());
    if (result && "state" in result) playSfx(PEN_CONFIRM);
  }

  async function confirmShop(basket: {
    buyStall: Record<string, number>;
    buyBack: Record<string, number>;
    sell: Record<string, number>;
  }) {
    const result = await withBusy(() => window.api.confirmMerchantShop(basket));
    const cues = confirmSfx({ type: "merchant_shop" }, result && "state" in result ? result : null);
    if (cues.pen) playSfx(PEN_CONFIRM);
    if (cues.coins) playSfx(COINS);
  }

  function answerCall(accept: boolean) {
    void withBusy(() => window.api.answerCall(accept));
  }

  function musterRide(bringIds: string[]) {
    void withBusy(() => window.api.musterAndRide(bringIds));
  }

  function battleContinue() {
    void withBusy(() => window.api.battleContinue());
  }

  function battleChoose(key: "A" | "B") {
    void withBusy(() => window.api.battleChoose(key));
  }

  function battleRound(orders: unknown[]) {
    void withBusy(() => window.api.battleRound(orders));
  }

  function battleFinish(disposition?: "settle" | "sell") {
    void withBusy(() => window.api.battleFinish(disposition));
  }

  /** Tutorial: open the right speaker if needed, then put the line in the composer for the lord to send. */
  async function sayTutorialLine(npcId: string, text: string) {
    if (!view || busy) return;
    if (view.sceneNpcId !== npcId) {
      const result = await withBusy(() => window.api.setScene(npcId));
      if (!result || !("state" in result) || result.sceneNpcId !== npcId) return;
    }
    focusComposer.current = true;
    setComposerPrefill((prev) => ({ text, nonce: (prev?.nonce ?? 0) + 1 }));
  }

  /** Returns false when nothing was sent, so the composer keeps the draft. */
  function send(draft: string): boolean {
    if (!view || !draft.trim() || busy || sendLock.current) return false;
    void deliver(view, draft.trim());
    return true;
  }

  async function deliver(current: GameView, text: string) {
    const npcId = current.sceneNpcId;
    sendLock.current = true;
    const optimistic = viewWithOptimisticPlayer(current, text);
    setView(optimistic);
    setBusy(true);
    setSpeakWaiting(true);
    setError(null);
    try {
      const result = (await window.api.sendDialogue(npcId, text)) as GameView & { error?: string };
      if (result && "state" in result) setView(applyServerDialogueView(optimistic, result));
      if (result && "error" in result && result.error) setError(result.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setSpeakWaiting(false);
      sendLock.current = false;
    }
  }

  const settingsModal = settingsOpen && (
    <SettingsModal
      settings={settings}
      models={models}
      meter={view?.llmMeter}
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
      onRaiseCall={
        screen === "game" && view && !view.state.battle_session
          ? (kind) => {
              setSettingsOpen(false);
              void withBusy(() => window.api.raiseCall(kind));
            }
          : undefined
      }
      fullCommandGranted={view?.state.player.fullCommandGranted}
      onGrantFullCommand={screen === "game" && view ? (on) => void withBusy(() => window.api.grantFullCommand(on)) : undefined}
    />
  );

  if (screen === "lab") {
    return (
      <>
        <BattleLab onExit={() => setScreen("title")} />
        {settingsModal}
      </>
    );
  }

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
          <button disabled={busy} onClick={() => setScreen("lab")} title="Jump straight into a battle to test the combat system">
            Battle Lab
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

  if ((view.state.history?.dead || view.state.player.dead || view.state.player.maimed || view.state.player.captive || view.state.estateAbandoned) && !view.state.battle_session) {
    const ending = view.state.history?.ending ?? null;
    return (
      <>
        <div className="title-screen empty-villa" role="dialog" aria-label={view.state.history?.dead || view.state.player.dead ? "The lord is dead" : view.state.player.captive ? "The lord is a captive" : "The lord is maimed"} style={{ backgroundImage: `url(${TITLE_MENU_BACKGROUND})` }}>
          {ending ? (
            <div className="empty-villa-words ending-page" aria-label="The last page of the chronicle">
              <p className="ending-death">{ending.death}</p>
              {ending.summary.split(/\n\s*\n/).map((para, i) => (
                <p key={i}>{para}</p>
              ))}
              <p className="ending-voice">— {ending.voice}</p>
            </div>
          ) : (
            <p className="empty-villa-words">
              {needsEnding
                ? "The household gathers to say what he was, and what the world is now that he is gone…"
                : view.state.estateAbandoned
                  ? "The demesne people are gone. The villa stands empty, and the chronicle of this house ends here."
                  : view.state.player.captive
                    ? "Taken in battle, and the chest could not meet the ransom. The lord of Fontenay stays in his captors' hands, and the chronicle of this house ends here."
                    : view.state.history?.dead?.cause === "execution"
                      ? "The lord of Fontenay was put to death as a traitor. There was no kin to speak for him."
                      : view.state.player.maimed
                        ? "Two wounds that never healed. The lord of Fontenay can no longer sit a horse nor hold a court."
                        : "The lord of Fontenay is dead. The chronicle of this house ends here."}
            </p>
          )}
          <nav className="title-menu">
            <button className="primary" disabled={busy} onClick={() => setScreen("title")}>
              Title
            </button>
            <button disabled={busy} onClick={() => void startNew()}>
              New Game
            </button>
          </nav>
        </div>
        {error && <p className="error">{error}</p>}
        {settingsModal}
      </>
    );
  }

  const questGuest = view.state.history?.quest?.meeting ?? null;
  const portraitSrc = npcPortrait(
    view.sceneNpcId,
    displayEmotion,
    view.state.merchant.face,
    view.state.history?.marriage?.archetype ?? null,
    view.sceneNpcId === "audience" ? questGuest?.motive : undefined,
  );
  const speakerName = view.sceneNpcId === "audience" ? questGuest?.name : npc?.name;

  return (
    <GlossaryProvider>
    <div className="stage-wrap">
    <div className={onField ? "stage on-field" : "stage"}>
    <div className="stage-panel">
    <div className="app">
      <header className="topbar">
        <div className="topbar-title">
          <div className="title">
            <GlossaryText text="Villa of Fontenay" />
          </div>
          <div className="sub">
            {cap(view.state.meta.season)} {view.state.meta.year} · turn {view.state.meta.turn} · {view.state.player.name}
          </div>
          <div className="ink-meter" title={hudInkTitle(view.llmMeter)}>
            {hudInkLine(view.llmMeter)}
          </div>
        </div>
        <div className="happiness-block">
          <PeopleHappinessMeter value={view.state.peopleHappiness} />
          <VassalRow state={view.state} />
        </div>
        <SeasonHeaderArt
          season={view.state.meta.season}
          loopingSeason={loopingSeason}
          transition={seasonTransitionPlay}
          onTransitionEnd={() => setSeasonTransitionPlay(null)}
        />
        <div className="top-actions">
          {inBattle && (
            <button className="primary to-field" onClick={() => setOnField(true)} disabled={busy}>
              To the field
            </button>
          )}
          <button onClick={() => setScreen("title")} disabled={busy}>
            Title
          </button>
          <button onClick={() => window.api.saveGame()} disabled={busy}>
            Save
          </button>
          <button onClick={() => setSettingsOpen(true)}>Settings</button>
          <button
            id="advance-season"
            className="primary"
            onPointerDown={onAdvanceSeasonActivate}
            onClick={onAdvanceSeasonActivate}
            disabled={busy || Boolean(seasonTransitionPlay)}
            title={view.pending.length ? "Unconfirmed orders will lapse if you advance." : "Resolve the season and write events to the ledger"}
          >
            Advance season
          </button>
        </div>
      </header>

      {error && (
        <div className="banner">
          <GlossaryText text={playerFacingReason(error)} />
        </div>
      )}
      {busy && <div className="banner muted">Waiting on the court…</div>}
      {view.state.battle_call && !inBattle && (
        <div className="banner call-to-arms">
          <span className="call-text">
            <strong>{view.state.battle_call.kind === "history" ? (view.state.battle_call.supply ? "At the gate." : "The host musters.") : "A call to arms."}</strong> {view.state.battle_call.text}
          </span>
          <span className="call-actions">
            <button className="primary" disabled={busy} onClick={() => answerCall(true)}>
              {view.state.battle_call.kind === "history" ? "Ride out" : "Answer the call"}
            </button>
            <button disabled={busy} onClick={() => answerCall(false)}>
              {view.state.battle_call.kind === "history" ? (view.state.battle_call.supply ? "Bar the hall" : "Turn back") : "Refuse"}
            </button>
          </span>
        </div>
      )}
      {view.pending.length > 0 && (
        <div className="banner pending">
          <GlossaryText text={confirmBanner(view.pending.length)} />
        </div>
      )}

      <div className="layout">
        <section className="dialogue">
          <div className="scene-tabs">
            <SceneTab
              id="scene-tab-steward"
              active={view.sceneNpcId === "steward"}
              wantsTalk={npcWantsTalk(view, "steward")}
              onClick={() => withBusy(() => window.api.setScene("steward"))}
            >
              Steward · Aldric
            </SceneTab>
            {questGuest && (
              <SceneTab
                id="scene-tab-audience"
                active={view.sceneNpcId === "audience"}
                wantsTalk={questGuest.wantsTalk}
                title={`Speak with ${questGuest.name}`}
                onClick={() => withBusy(() => window.api.setScene("audience"))}
              >
                {questGuest.name}
              </SceneTab>
            )}
            <SceneTab
              id="scene-tab-smith"
              active={view.sceneNpcId === "smith"}
              wantsTalk={npcWantsTalk(view, "smith")}
              disabled={!view.smithAvailable}
              title={view.smithAvailable ? "Speak with the smith" : "Requires a forge on the estate"}
              onClick={() => view.smithAvailable && withBusy(() => window.api.setScene("smith"))}
            >
              Smith · Bernard
            </SceneTab>
            <SceneTab
              id="scene-tab-chaplain"
              active={view.sceneNpcId === "chaplain"}
              wantsTalk={npcWantsTalk(view, "chaplain")}
              disabled={!view.chaplainAvailable}
              title={view.chaplainAvailable ? "Speak with the chaplain" : "Requires a chapel or cell on the estate"}
              onClick={() => view.chaplainAvailable && withBusy(() => window.api.setScene("chaplain"))}
            >
              Chaplain · Ermenald
            </SceneTab>
            {view.state.npcs.some((n) => n.id === "negotiator") && (
              <SceneTab
                id="scene-tab-negotiator"
                active={view.sceneNpcId === "negotiator"}
                wantsTalk={npcWantsTalk(view, "negotiator")}
                title="Speak with Gerulf"
                onClick={() => withBusy(() => window.api.setScene("negotiator"))}
              >
                Negotiator · Gerulf
              </SceneTab>
            )}
            {view.state.npcs
              .filter((n) => !isCoreHouseholdId(n.id))
              .map((n) => (
                <SceneTab
                  key={n.id}
                  active={view.sceneNpcId === n.id}
                  wantsTalk={n.wantsTalk}
                  title={`Speak with ${n.name}`}
                  onClick={() => withBusy(() => window.api.setScene(n.id))}
                >
                  {cap(roleName(n.role))} · {n.name}
                </SceneTab>
              ))}
            <SceneTab
              active={view.sceneNpcId === "merchant"}
              wantsTalk={npcWantsTalk(view, "merchant")}
              disabled={!view.merchantAvailable}
              title={
                view.merchantAvailable
                  ? `Speak with ${view.state.merchant.name ?? "the merchant"}`
                  : "No merchant is in the district this season"
              }
              onClick={() => view.merchantAvailable && withBusy(() => window.api.setScene("merchant"))}
            >
              Merchant{view.state.merchant.name ? ` · ${view.state.merchant.name}` : ""}
            </SceneTab>
          </div>

          <div className="talk" id="talk-panel">
            {portraitSrc && (
              <aside className={`portrait ${view.sceneNpcId}`}>
                <img src={portraitSrc} alt={speakerName ?? "Speaker"} />
              </aside>
            )}
            <div className={view.sceneNpcId === "merchant" && view.merchantAvailable ? "merchant-scene" : "log"} ref={view.sceneNpcId === "merchant" && view.merchantAvailable ? undefined : scroller}>
              {view.sceneNpcId === "merchant" && view.merchantAvailable ? (
                <>
                  <ShopPanel
                    key={`${view.state.merchant.name ?? "merchant"}:${view.state.meta.turn}:${view.state.resources.denarii}:${view.state.merchant.purse ?? 0}:${view.state.merchant.stock.map((s) => `${s.resource}:${s.amount}`).join(",")}`}
                    view={view}
                    busy={busy}
                    onConfirm={(basket) => void confirmShop(basket)}
                    onSpeak={() => {
                      focusComposer.current = true;
                      document.getElementById("talk-composer")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                      composerRef.current?.focus();
                    }}
                  />
                  <div className="log shop-log" ref={scroller}>
                    {view.messages.length === 0 ? (
                      <p className="muted empty-log">Gossip of the roads, if you want it.</p>
                    ) : (
                      view.messages.map((m) => <MessageBubble key={m.id} m={m} />)
                    )}
                  </div>
                </>
              ) : view.messages.length === 0 ? (
                <p className="muted empty-log">
                  {view.sceneNpcId === "merchant" && !view.merchantAvailable ? "No one here." : "No words yet."}
                </p>
              ) : (
                view.messages.map((m) => <MessageBubble key={m.id} m={m} />)
              )}
            </div>
          </div>

          <ProposalsPanel
            pending={view.pending}
            state={view.state}
            busy={busy}
            onConfirm={(p) => void confirmPending(p)}
            onConfirmAll={() => void confirmAllPending()}
            onDeny={(p) => withBusy(() => window.api.rejectProposal(p.id))}
            onAskAbout={(p) => {
              focusComposer.current = true;
              return withBusy(() => window.api.askAboutProposal(p.id));
            }}
          />

          <Composer
            composerRef={composerRef}
            busy={busy}
            speakWaiting={speakWaiting}
            placeholder={composerPlaceholder(view)}
            npcName={npc?.name ?? "them"}
            prefill={composerPrefill}
            onSend={send}
          />
        </section>

        <BooksPanel
          view={view}
          onCancelForthcoming={(id) => {
            void withBusy(() => window.api.cancelForthcomingOrder(id));
          }}
        />
      </div>
    </div>
    </div>
    <div className="stage-panel field-panel" aria-hidden={!onField}>
      {inBattle && (
        <BattleScreen
          view={view}
          busy={busy}
          onReturn={() => setOnField(false)}
          onMuster={musterRide}
          onContinue={battleContinue}
          onChoose={battleChoose}
          onRound={battleRound}
          onFinish={battleFinish}
          full={{
            onScoutRole: (role) => void withBusy(() => window.api.scoutRole(role)),
            onScoutNarrow: (keep) => void withBusy(() => window.api.scoutNarrow(keep)),
            onScoutFinalize: (pick) => void withBusy(() => window.api.scoutFinalize(pick)),
            onDeploy: (unitId, cell) => void withBusy(() => window.api.deployFile(unitId, cell)),
            onDeployRest: () => void withBusy(() => window.api.deployRest()),
            onAddress: (unitId, amount) => void withBusy(() => window.api.addressFile(unitId, amount)),
            onBegin: () => void withBusy(() => window.api.beginBattle()),
            onDayEnd: (choice, pick) => void withBusy(() => window.api.dayEnd(choice, pick)),
          }}
        />
      )}
    </div>
    </div>
    </div>
    {tutorial && !inBattle && (
      <TutorialOverlay
        tutorial={tutorial}
        watch={{
          sceneNpcId: view.sceneNpcId,
          messages: view.messages,
          pendingCount: view.pending.length,
          turn: view.state.meta.turn,
          busy,
        }}
        onChange={changeTutorial}
        onSay={(npcId, text) => void sayTutorialLine(npcId, text)}
      />
    )}
    {settingsModal}
    </GlossaryProvider>
  );
}

function SpeakWaitingReel({ active }: { active: boolean }) {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    void preloadWaitingImages(waitingFrames());
  }, []);

  useEffect(() => {
    if (!active) {
      setFrameIndex(0);
      return;
    }
    void preloadWaitingImages(waitingFrames());
    let cancelled = false;
    let timeoutId: number | undefined;
    setFrameIndex(0);
    const schedule = (current: number) => {
      timeoutId = window.setTimeout(() => {
        if (cancelled) return;
        const next = nextWaitingFrameIndex(current);
        setFrameIndex(next);
        schedule(next);
      }, waitingFrameDurationMs(current));
    };
    schedule(0);
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [active]);

  if (!active) return null;
  return (
    <img
      className="speak-waiting-reel"
      src={waitingFrame(frameIndex)}
      alt=""
      draggable={false}
      aria-hidden="true"
    />
  );
}

function SeasonHeaderArt({
  season,
  loopingSeason,
  transition,
  onTransitionEnd,
}: {
  season: Season;
  loopingSeason: Season | null;
  transition: SeasonTransitionPlay | null;
  onTransitionEnd: () => void;
}) {
  const [idleFrameIndex, setIdleFrameIndex] = useState(0);
  const [transitionFrameIndex, setTransitionFrameIndex] = useState(0);
  const [transitionReady, setTransitionReady] = useState(false);
  const onEndRef = useRef(onTransitionEnd);
  onEndRef.current = onTransitionEnd;
  const preloadRef = useRef<{ key: string; done: Promise<void> } | null>(null);

  useEffect(() => {
    const idleSeasons = new Set<Season>([season]);
    if (loopingSeason) idleSeasons.add(loopingSeason);
    if (transition) idleSeasons.add(transition.to);
    const idleSrcs = [...idleSeasons].flatMap((s) => [...seasonIdleFrames(s)]);

    const reel = loopingSeason
      ? transitionReelFor(loopingSeason)
      : transition
        ? { from: transition.from, to: transition.to }
        : null;
    const reelSrcs = reel ? [...seasonTransitionFrames(reel.from, reel.to)] : [];
    if (reel) idleSrcs.push(...seasonIdleFrames(reel.to));

    const done = preloadSeasonImages([...idleSrcs, ...reelSrcs]);
    if (reel) preloadRef.current = { key: `${reel.from}:${reel.to}`, done };
  }, [season, loopingSeason, transition]);

  useEffect(() => {
    if (loopingSeason) {
      setTransitionReady(false);
      setTransitionFrameIndex(0);
      setIdleFrameIndex(0);
      const id = window.setInterval(() => {
        setIdleFrameIndex((i) => nextIdleFrameIndex(i));
      }, SEASON_IDLE_FRAME_MS);
      return () => window.clearInterval(id);
    }

    if (!transition) {
      setTransitionReady(false);
      setTransitionFrameIndex(0);
      setIdleFrameIndex(0);
      return;
    }

    const frames = seasonTransitionFrames(transition.from, transition.to);
    setTransitionFrameIndex(0);
    setTransitionReady(false);
    if (frames.length === 0) {
      onEndRef.current();
      return;
    }

    const key = `${transition.from}:${transition.to}`;
    const wait = preloadRef.current?.key === key ? preloadRef.current.done : preloadSeasonImages(frames);

    let cancelled = false;
    let intervalId: number | undefined;
    void wait.then(() => {
      if (cancelled) return;
      setTransitionFrameIndex(0);
      setTransitionReady(true);
      let index = 0;
      intervalId = window.setInterval(() => {
        index += 1;
        if (index >= frames.length) {
          window.clearInterval(intervalId);
          onEndRef.current();
        } else {
          setTransitionFrameIndex(index);
        }
      }, SEASON_TRANSITION_FRAME_MS);
      if (cancelled) window.clearInterval(intervalId);
    });

    return () => {
      cancelled = true;
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, [loopingSeason, transition]);

  return (
    <div className="season-art" aria-hidden="true">
      <div className="season-art-stack">
        <img
          className="season-art-idle"
          src={seasonHeaderSrc(
            season,
            loopingSeason,
            idleFrameIndex,
            transition,
            transitionFrameIndex,
            transitionReady,
          )}
          alt=""
          draggable={false}
          style={seasonFrameIdleBoxStyle()}
        />
        <img className="season-art-frame" src={SEASON_TIMBER_FRAME} alt="" draggable={false} />
      </div>
    </div>
  );
}

/**
 * The draft lives here, not in App, so a keystroke re-renders one textarea and
 * not every bubble, card, and ledger page on the screen.
 */
function Composer({
  composerRef,
  busy,
  speakWaiting,
  placeholder,
  npcName,
  prefill,
  onSend,
}: {
  composerRef: RefObject<HTMLTextAreaElement>;
  busy: boolean;
  speakWaiting: boolean;
  placeholder: string;
  npcName: string;
  /** Words put in the lord's mouth (tutorial). A new nonce replaces the draft. */
  prefill?: { text: string; nonce: number } | null;
  onSend: (text: string) => boolean;
}) {
  const [draft, setDraft] = useState("");
  useEffect(() => {
    if (!prefill) return;
    setDraft(prefill.text);
    composerRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new nonce is the signal
  }, [prefill?.nonce]);
  const submit = () => {
    if (!draft.trim() || busy) return;
    if (onSend(draft)) setDraft("");
  };
  return (
    <form
      id="talk-composer"
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={composerRef}
        value={draft}
        disabled={busy}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button
        type="submit"
        className={speakWaiting ? "primary speak-submit speak-waiting" : "primary speak-submit"}
        disabled={busy || !draft.trim()}
        aria-label={`Speak to ${npcName}`}
        aria-busy={speakWaiting}
      >
        <span className="speak-label">Speak to {npcName}</span>
        <SpeakWaitingReel active={speakWaiting} />
      </button>
    </form>
  );
}

/** A spoken line never changes once written, so a bubble renders once per message. */
const MessageBubble = memo(function MessageBubble({ m }: { m: ChatMessage }) {
  const who =
    m.role === "player" ? "You" : m.role === "system" ? (m.aside ? "A pause" : "The books") : m.npcName ?? "Voice";
  const linkSpeech = m.role !== "player";
  const hunt = m.npcId === "negotiator" ? { hunt: true as const } : undefined;
  return (
    <article className={`bubble ${m.role}`}>
      <div className="who">{who}</div>
      <div className="text">{linkSpeech ? <GlossaryText text={m.text} context={hunt} /> : m.text}</div>
      {m.chronicle && (
        <div className="chronicle">
          <GlossaryText text={m.chronicle} context={hunt} />
        </div>
      )}
    </article>
  );
}, (a, b) => a.m.id === b.m.id && a.m.text === b.m.text && a.m.chronicle === b.m.chronicle && a.m.role === b.m.role);

function SettingsModal({
  settings,
  models,
  meter,
  onClose,
  onSave,
  onLoadModels,
  onVolume,
  onRaiseCall,
  fullCommandGranted,
  onGrantFullCommand,
}: {
  settings: AppSettings;
  models: { id: string }[];
  meter?: LlmMeter;
  onClose: () => void;
  onSave: (s: AppSettings) => Promise<void>;
  onLoadModels: () => Promise<void>;
  onVolume: (patch: { masterVolume?: number; musicVolume?: number }) => Promise<void>;
  /** Testing hook: raise a call to arms in the running game. */
  onRaiseCall?: (kind: "summons" | "raid" | "bandits") => void;
  /** Testing hook until the Command Claim narrative exists. */
  fullCommandGranted?: boolean;
  onGrantFullCommand?: (on: boolean) => void;
}) {
  const [provider, setProvider] = useState<LlmProvider>(settings.provider);
  const [providers, setProviders] = useState(settings.providers);
  const [masterVolume, setMasterVolume] = useState(settings.masterVolume);
  const [musicVolume, setMusicVolume] = useState(settings.musicVolume);
  const [searchApiKey, setSearchApiKey] = useState(settings.searchApiKey ?? "");
  const [catalogProvider, setCatalogProvider] = useState<LlmProvider | null>(null);
  const [listing, setListing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [ink, setInk] = useState<LlmMeter>(meter ?? emptyMeter(settings.provider));
  const current = providers[provider];
  const meta = PROVIDER_META[provider];
  const uniqueModels = useMemo(() => {
    if (catalogProvider !== provider) return current.model ? [current.model] : [];
    const ids = new Set(models.map((m) => m.id));
    if (current.model) ids.add(current.model);
    return [...ids];
  }, [models, current.model, catalogProvider, provider]);

  useEffect(() => {
    if (meter) setInk(meter);
  }, [meter]);

  useEffect(() => {
    void (async () => {
      try {
        const next = (await window.api.getLlmMeter()) as LlmMeter;
        if (next) setInk(next);
      } catch {
        /* meter is optional on the title screen */
      }
    })();
  }, [provider]);

  function patchActive(next: Partial<{ apiKey: string; model: string }>) {
    setProviders((prev) => ({
      ...prev,
      [provider]: { ...prev[provider], ...next },
    }));
  }

  function snapshot(): AppSettings {
    return { provider, providers, masterVolume, musicVolume, searchApiKey };
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
        <p className="settings-help">
          When a play ends — you quit, start a new estate, or load another save — the game writes a text file of the
          hidden machinery: the model’s reasoning, the system pack, tool calls, proposals, and refusals. Look in the
          play-logs folder next to the save. A new play does not delete the older files.
        </p>
        <div className="settings-ink" title={hudInkTitle({ ...ink, provider })}>
          {settingsInkLines({ ...ink, provider }, provider).map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
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
        <label>
          Research key (Tavily)
          <input
            type="password"
            value={searchApiKey}
            onChange={(e) => setSearchApiKey(e.target.value)}
            placeholder="tvly-…"
          />
        </label>
        <p className="settings-help">
          Optional, any provider. When a speaker is unsure of a real figure — the iron in a plough share, the days to
          burn a charcoal mound — the game searches the web for them and hands back what it finds. Create a free key at
          tavily.com. Leave it empty and they judge from their own knowledge.
        </p>
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
        {onRaiseCall && (
          <div className="settings-testing">
            <p className="settings-help">Testing the field: raise a call to arms now instead of waiting for the season to bring one.</p>
            <div className="p-actions">
              <button onClick={() => onRaiseCall("summons")}>Summons from the count</button>
              <button onClick={() => onRaiseCall("raid")}>Northmen on the river</button>
              <button onClick={() => onRaiseCall("bandits")}>Outlaws on the road</button>
            </div>
          </div>
        )}
        {onGrantFullCommand && (
          <label className="lab-check settings-testing">
            <input type="checkbox" checked={Boolean(fullCommandGranted)} onChange={(e) => onGrantFullCommand(e.target.checked)} />
            Full Command granted (test hook; the Command Claim narrative will set this later)
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
    case "negotiator": {
      const away = view.state.projects.some((p) => p.status === "active" && Boolean(p.hunt));
      return away
        ? "Gerulf is on the road — check in, or wait until he returns…"
        : "Name a scarce thing; Gerulf will quote the purse and the time…";
    }
    case "merchant":
      return `Speak with ${view.state.merchant.name ?? "the merchant"} of the roads…`;
    case "audience":
      return `Speak with ${view.state.history?.quest?.meeting?.name ?? "him"}…`;
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

function npcWantsTalk(view: GameView, npcId: string): boolean {
  return view.state.npcs.find((n) => n.id === npcId)?.wantsTalk === true;
}

function SceneTab({
  id,
  active,
  wantsTalk,
  disabled,
  title,
  onClick,
  children,
}: {
  id?: string;
  active: boolean;
  wantsTalk: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      id={id}
      className={active ? "active" : ""}
      disabled={disabled}
      title={wantsTalk && !disabled ? "They have something to say" : title}
      onClick={onClick}
    >
      {children}
      {wantsTalk ? (
        <img src={NPC_WANTS_TALK} className="wants-talk-badge" alt="" title="They have something to say" />
      ) : null}
    </button>
  );
}

