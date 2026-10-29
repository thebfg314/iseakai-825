import type { ChatMessage, MechanicalProposal, PendingProposal, Project, SeasonEffectLine, WorldState } from "../engine/schema";
import type { DialogueResult, GameView, SeasonResult } from "../shared/types";
import { applyProposal } from "../engine/applyDelta";
import { defaultEventStub, rollSeasonEvents, type RolledEvent } from "../engine/events";
import { applyMerchantRoll, rollMerchantVisit, syncTradeFromFeatures } from "../engine/merchant";
import {
  applyMerchantBasket,
  ensureMerchantVisitShop,
  type MerchantShopBasket,
  shopLogLine,
  quoteMerchantBasket,
} from "../engine/merchantShop";
import { finishSeasonClock, resolveAgricultureAndProjects } from "../engine/season";
import { fadeSponsoredFeastJoy, tickPeopleHappinessFromSeason } from "../engine/peopleHappiness";
import { ARRIVAL_REFUSE_LINE, ABANDONED_GAME_OVER, estateIsAbandoned, markEstateAbandoned, resolvePeopleMovement } from "../engine/peopleMovement";
import { archiveEstateSeason } from "../engine/estateBooks";
import { diffSeasonLedger, snapshotSeasonLedger, writeLastSeasonDeltas } from "../engine/seasonDeltas";
import { appendHistory } from "../engine/history";
import { cloneState, saveWorldState } from "../engine/state";
import { runHistorySeasonPass } from "../history/season";
import { markDeath } from "../history/age";
import { endingFallback, endingSystemPrompt, endingUserPrompt, endingVoice } from "../history/ending";
import type { HistoryBeat } from "../history/deliver";
import type { HistoryApplyResult } from "../history/hooks";
import { applyFlagOp } from "../history/flags";
import { CHURCH_FEATURES, FORGE_FEATURES } from "../engine/projectCatalog";
import {
  labourPool,
  labourRemaining,
  resolveActiveProject,
} from "../engine/labour";
import { newId, nextSeason } from "../engine/util";
import { PORTRAIT_NPCS, type AldricEmotion } from "../engine/emotion";
import path from "node:path";
import fs from "node:fs";
import { parseLlmResponse, playerFacingNpcSpeech, eventEffectHasMechanics } from "../llm/parse";
import * as llm from "../llm";
import type { AppSettings } from "../llm";
import { takeLastCompletion, takeLastReasoning } from "../llm/chat";
import { activeConfig, LlmTimeoutError } from "../llm/types";
import { PlayLog } from "./playLog";
import { fetchProviderBalance } from "../llm/credits";
import { consumeLastLlmCall, LlmMeterStore } from "../llm/usage";
import {
  agreedPlanFollowUp,
  earlierTalkBlock,
  beginFiguresFollowUp,
  npcBooksFollowUp,
  npcFactsFollowUp,
  npcUserPrompt,
  npcSystemPrompt,
  refereeSystemPrompt,
  repairPrompt,
  seasonUserPrompt,
  SPEECH_PASS_HINT,
} from "../llm/prompts";
import { MAX_RESEARCH_QUERIES, ResearchCache, researchDrawer, searchWeb, type ResearchFinding } from "../llm/research";
import {
  baselineDrawersFor,
  collectDrawers,
  hasMalformedToolMarker,
  holdingLineForDrawers,
  missingCitedDrawers,
  parseResearchRequest,
  RESEARCH_HOLDING_LINE,
  parseToolRequest,
  stripToolMarkers,
  type ToolDrawer,
} from "../llm/toolProtocol";
import {
  booksHearFailureLine,
  BOOKS_NOT_TAKEN_LINE,
  HOLD_AT_ONCE_APOLOGY,
  INCOMPLETE_MODEL_JSON,
  isHoldAtOnceFailure,
  isTruncationError,
} from "../llm/providerErrors";
import { introAlreadySpoken, introSpeechFor, markIntroSpoken } from "../engine/intros";
import { recordConfirmedTransaction } from "../engine/memory";
import { augmentOrderProposals, cannotFulfillReason, inferOrderProposals, looksLikeMechanicalOrder } from "../engine/orderIntent";
import { cancelForthcomingOrder as cancelStoredForthcoming } from "../engine/forthcoming";
import { fieldRotation, sownCapacity } from "../engine/agriculture";
import {
  difficultyFromSpeech,
  ensureGerulfInHousehold,
  extractHuntRequest,
  huntFulfillReason,
  huntProposalForAsk,
  isNegotiatorId,
  looksLikeHuntOrder,
  NEGOTIATOR_ID,
  normalizeHuntProposal,
  pendingHuntReports,
  quoteHunt,
  resolveHuntDifficulty,
  seasonsAskedByLord,
  seasonsNamedInText,
  unaffordableHuntSpeech,
  withComputedHuntPrice,
  type HuntDifficulty,
} from "../engine/hunts";
import {
  hireSummary,
  isEstateSmithNpc,
  matchHireableSpecialist,
  newlyUnlockedHires,
  recommendableHires,
  specialistAlreadyPresent,
  specialistById,
  specialistHireBlocked,
  specialistHireGrainRation,
  specialistNpc,
} from "../engine/specialists";
import { askAboutCue, compactOfferLine, isRevisionOf, pendingOfferScrap } from "../engine/askAbout";
import {
  ALDRIC_BLOOMERY_REFERRAL,
  BERNARD_BLOOMERY_MENTION,
  BERNARD_BOG_ORE_SPEECH,
  asksAboutBogOre,
  bernardBloomeryPitch,
  bloomeryNotReadyReason,
  bloomeryStartProposal,
  bloomerySuggestReady,
  isBernardBloomeryPitch,
  isBloomeryStart,
  playerAskedBloomery,
} from "../engine/bloomery";
import { asksBeginAmount, prepareSameSeasonUse, speechDelaysWorkForShortage, withBeginShortfalls } from "../engine/projectBegin";
import {
  claimsBooksWrote,
  looksLikeSpokenAgree,
  pricedWorkFromTalk,
  samePricedOffer,
  unconfirmedWorkSpeech,
} from "../engine/spokenWork";
import { undoPaidProjectResult } from "../engine/projectResult";
import { guardSmithProposals, smithSpeechForOrder } from "../engine/smithing";
import { stampSpeakerTag } from "../engine/speakerTag";
import {
  asksAboutTheHarvest,
  BERNARD_HARVEST_REDIRECT,
  parseSpokenImprovement,
  prepareStewardToolProposals,
  proposalWritesTheFields,
} from "../engine/toolImprovement";
import { playerFacingLogLine, playerFacingReason, playerFacingSummary } from "../ui/ledgerCopy";
import {
  confirmGate,
  dependentDeclineLine,
  dependentSkipLine,
  dependentStart,
  matchingStarts,
  workLabelOf,
} from "../engine/proposalPack";
import {
  completedProjectBeats,
  dismissNewsWantsTalk,
  releaseConfirmWantsTalk,
  setNpcWantsTalk,
} from "../engine/wantsTalk";
import {
  acceptCall,
  addressFile,
  battleChoose,
  battleCommandRound,
  battleContinue,
  beginBattle,
  dayEndChoice,
  deployFile,
  deployRest,
  finishBattle,
  musterAndRide,
  raiseBattleCall,
  raiseCallDirect,
  refuseCall,
  scoutChooseRole,
  scoutFinalize,
  scoutNarrow,
  type BattleDeps,
} from "./battle";
import type { BattleCallKind } from "../engine/schema";
import { ensureCampaignContent, tickMilitary } from "../engine/military";
import { healPersonalFully, tickWounds } from "../engine/wounds";
import { createRng, seedFromString } from "../combat/rng";

export type { DialogueResult, GameView, SeasonResult } from "../shared/types";

/**
 * Token caps per call. Reasoning models spend hidden thinking tokens inside the
 * same cap before any visible text, so these leave generous room; the cap is a
 * ceiling, not a spend. A reply that still hits it is asked again at twice the budget.
 */
export const SPEECH_TOKENS = 2500;
export const BOOKS_TOKENS = 3500;
export const SEASON_TOKENS = 4000;
export const ENDING_TOKENS = 2500;

/** Ledger drawers plus whatever the research tool found this turn, so the books pass prices from the same facts. */
function withResearch(drawers: Record<string, unknown>, research?: Record<string, unknown>): Record<string, unknown> {
  return research ? { ...drawers, research } : drawers;
}

export class GameController {
  state: WorldState;
  pending: PendingProposal[] = [];
  messages: ChatMessage[] = [];
  sceneNpcId = "steward";
  saveDir: string;
  settings: AppSettings;
  historyTail: string[] = [];
  /** In-memory: expansion hires already recommended this session. Does not write world-state. */
  recommendedHireIds = new Set<string>();
  /** In-memory: Bernard has already mentioned a bloomery in his own talk this session. */
  bloomeryMentioned = false;
  /** Speech the lord just heard, so a named figure can be copied onto the card. */
  private turnSpeech = "";
  /** Pending card the lord asked about; next talk with that NPC can revise it. */
  askedAboutId: string | null = null;
  npcEmotions: Record<string, AldricEmotion> = {
    steward: "respectful",
    smith: "neutral",
    chaplain: "neutral",
    negotiator: "neutral",
  };
  meter = new LlmMeterStore("rfab");
  /** Hidden machinery for this play. A new controller writes a new file. */
  readonly playLog: PlayLog;
  /** The NPCs' hidden research tool, remembered per play so a question is bought once. */
  readonly research: ResearchCache;

  constructor(state: WorldState, saveDir: string, settings: AppSettings, opts?: { resetUsage?: boolean }) {
    this.state = state;
    this.saveDir = saveDir;
    this.settings = settings;
    this.research = new ResearchCache((query) => searchWeb(query, this.settings.searchApiKey ?? ""));
    this.playLog = new PlayLog(
      saveDir,
      {
        year: state.meta.year,
        season: state.meta.season,
        turn: state.meta.turn,
        provider: settings.provider,
        model: settings.providers[settings.provider]?.model ?? "",
      },
      [...Object.values(settings.providers).map((p) => p.apiKey), settings.searchApiKey ?? ""],
    );
    this.meter.setProvider(settings.provider);
    if (opts?.resetUsage) this.meter.reset();
    else this.loadUsage();
    if (!this.state.agriculture) {
      this.state.agriculture = { springBarleyShare: 0.6, autumnWheatShare: 0.45, rotation: "two_field" };
    }
    ensureGerulfInHousehold(this.state);
    ensureCampaignContent(this.state);
    if (estateIsAbandoned(this.state)) {
      markEstateAbandoned(this.state);
      return;
    }
    this.speakIntroIfNeeded("steward");
    this.messages.push({
      id: newId("msg"),
      role: "npc",
      npcId: "steward",
      npcName: this.npcName("steward"),
      text: openingSpeech(state),
      emotion: "respectful",
      at: new Date().toISOString(),
    });
  }

  view(): GameView {
    ensureCampaignContent(this.state);
    if (estateIsAbandoned(this.state)) markEstateAbandoned(this.state);
    if (this.sceneNpcId === "merchant" && !this.merchantAvailable()) {
      this.sceneNpcId = "steward";
    }
    if (this.merchantAvailable()) ensureMerchantVisitShop(this.state);
    this.persist();
    return {
      state: this.state,
      pending: this.pending.filter((p) => p.status === "pending" || p.status === "withheld"),
      messages: messagesForScene(this.messages, this.sceneNpcId),
      sceneNpcId: this.sceneNpcId,
      labour: { pool: labourPool(this.state), remaining: labourRemaining(this.state) },
      smithAvailable: this.smithAvailable(),
      chaplainAvailable: this.chaplainAvailable(),
      merchantAvailable: this.merchantAvailable(),
      sceneEmotion: this.npcEmotions[this.sceneNpcId] ?? "neutral",
      historyTail: this.historyTail.slice(-30),
      llmMeter: this.meter.snapshot(),
    };
  }

  persist() {
    try {
      saveWorldState(path.join(this.saveDir, "world-state.json"), this.state);
    } catch {
      /* ignore */
    }
    this.persistUsage();
  }

  private usagePath() {
    return path.join(this.saveDir, "llm-usage.json");
  }

  private loadUsage() {
    try {
      const file = this.usagePath();
      if (!fs.existsSync(file)) return;
      this.meter.loadSave(JSON.parse(fs.readFileSync(file, "utf8")) as unknown);
    } catch {
      /* ignore */
    }
  }

  private persistUsage() {
    try {
      fs.mkdirSync(this.saveDir, { recursive: true });
      fs.writeFileSync(this.usagePath(), JSON.stringify(this.meter.usedThisSave, null, 2), "utf8");
    } catch {
      /* ignore */
    }
  }

  async refreshCredits(): Promise<void> {
    this.meter.setProvider(this.settings.provider);
    const report = await fetchProviderBalance(this.settings);
    this.meter.setProvider(report.provider);
    if (report.skipped || report.failed) return;
    this.meter.applyBalance(report.remainingKnown ? report.remaining : undefined, report.provider);
  }

  private noteLlmUsage() {
    this.meter.setProvider(this.settings.provider);
    this.meter.applyCall(consumeLastLlmCall());
    this.persistUsage();
  }

  private async finishTalk(): Promise<DialogueResult> {
    await this.refreshCredits();
    return this.view();
  }

  smithAvailable(): boolean {
    return (
      this.state.holdings.some((h) => h.features.some((f) => FORGE_FEATURES.has(f))) &&
      this.state.npcs.some((n) => n.role === "smith")
    );
  }

  chaplainAvailable(): boolean {
    return (
      this.state.holdings.some((h) => h.features.some((f) => CHURCH_FEATURES.has(f))) &&
      this.state.npcs.some((n) => n.role === "chaplain" || n.id === "chaplain")
    );
  }

  merchantAvailable(): boolean {
    return this.state.merchant.present && this.state.flags.merchant_present && this.state.npcs.some((n) => n.id === "merchant");
  }

  setScene(npcId: string): GameView {
    if (npcId === "smith" && !this.smithAvailable()) return this.view();
    if (npcId === "chaplain" && !this.chaplainAvailable()) return this.view();
    if (npcId === "merchant" && !this.merchantAvailable()) return this.view();
    if (specialistById(npcId) && !this.state.npcs.some((n) => n.id === npcId)) return this.view();
    if (!this.state.npcs.some((n) => n.id === npcId) && npcId !== "merchant") return this.view();
    this.sceneNpcId = npcId;
    this.speakIntroIfNeeded(npcId);
    dismissNewsWantsTalk(this.state, npcId, this.pending);
    return this.view();
  }

  askAboutProposal(id: string): GameView & { error?: string } {
    const item = this.pending.find((p) => p.id === id && p.status === "pending");
    if (!item) return { ...this.view(), error: playerFacingReason("No such pending proposal.") };
    this.setScene(item.npcId);
    if (this.sceneNpcId !== item.npcId) {
      return { ...this.view(), error: "They are not here to speak with." };
    }
    this.askedAboutId = item.id;
    this.messages.push({
      id: newId("msg"),
      role: "system",
      npcId: item.npcId,
      text: askAboutCue(this.npcName(item.npcId), item.proposal),
      aside: true,
      at: new Date().toISOString(),
    });
    return this.view();
  }

  private discussedPending(npcId: string): PendingProposal | undefined {
    if (!this.askedAboutId) return undefined;
    return this.pending.find((p) => p.id === this.askedAboutId && p.status === "pending" && p.npcId === npcId);
  }

  log(actor: string, kind: "APPLY" | "REJECT" | "EVENT" | "CHAT" | "SEASON", summary: string) {
    const line = appendHistory(this.saveDir, this.state, actor, kind, summary);
    this.historyTail.push(line);
  }

  npcName(id: string): string {
    return this.state.npcs.find((n) => n.id === id)?.name ?? id;
  }

  /** Engine-authored first meeting. Once per save (merchants: once per visitor name). */
  private speakIntroIfNeeded(npcId: string) {
    const text = introSpeechFor(npcId, this.state);
    if (!text || introAlreadySpoken(this.state, npcId)) return;
    markIntroSpoken(this.state, npcId);
    this.messages.push({
      id: newId("msg"),
      role: "npc",
      npcId,
      npcName: this.npcName(npcId),
      text,
      emotion: npcId === "steward" ? "respectful" : (this.npcEmotions[npcId] ?? "neutral"),
      at: new Date().toISOString(),
    });
  }

  async sendDialogue(npcId: string, playerText: string): Promise<DialogueResult> {
    if (estateIsAbandoned(this.state) || this.state.estateAbandoned) {
      markEstateAbandoned(this.state);
      return { ...this.view(), error: ABANDONED_GAME_OVER };
    }
    if (npcId === "merchant" && !this.merchantAvailable()) {
      this.sceneNpcId = "steward";
      return { ...this.view(), error: "The merchant has left the district." };
    }
    if (specialistById(npcId) && !this.state.npcs.some((n) => n.id === npcId)) {
      this.sceneNpcId = "steward";
      return { ...this.view(), error: "That craftsman is not of this house." };
    }
    this.sceneNpcId = npcId;
    this.turnSpeech = "";
    this.speakIntroIfNeeded(npcId);
    dismissNewsWantsTalk(this.state, npcId, this.pending);
    this.messages.push({
      id: newId("msg"),
      role: "player",
      npcId,
      text: playerText,
      at: new Date().toISOString(),
    });
    this.log("player", "CHAT", `${npcId}: ${playerText.slice(0, 120)}`);

    const huntAsk = isNegotiatorId(npcId) && looksLikeHuntOrder(playerText);
    if (huntAsk) {
      const blockedAtEasy = huntFulfillReason(this.state, playerText, "easy");
      if (blockedAtEasy) {
        const spoken = huntFulfillReason(this.state, playerText) ?? blockedAtEasy;
        this.pushNpcSpeech(npcId, { speech: spoken, emotion: "concerned" });
        return this.finishTalk();
      }
    }

    const speechSystem = npcSystemPrompt(npcId, this.state, { speechOnly: true });
    const system = npcSystemPrompt(npcId, this.state);
    const discussed = this.discussedPending(npcId);
    const extraBits = [
      earlierTalkForSpeaker(this.messages, npcId, this.npcName(npcId), playerText),
      npcId === "merchant"
        ? "You are visiting only this season. Request the merchant drawer if you need cart stock. Buy only from that stock. Sell any estate resource except denarii."
        : undefined,
      discussed ? pendingOfferScrap(discussed.proposal) : undefined,
    ].filter(Boolean);
    const extra = extraBits.length ? extraBits.join("\n\n") : undefined;
    const scrapUser = npcUserPrompt(this.state, npcId, playerText, extra);
    // Deterministic floor: these always reach the books. The model's hidden
    // [[books:yes]] tag widens the gate for orders the regex never heard of.
    const sureOrder = looksLikeMechanicalOrder(playerText, npcId) || Boolean(discussed) || huntAsk;
    try {
      const spoken = await this.callLlm(
        [{ role: "system", content: speechSystem }, { role: "user", content: `${scrapUser}\n\n${SPEECH_PASS_HINT}` }],
        SPEECH_TOKENS,
        { requireProposals: false, allowRepair: false, purpose: "speech" },
      );

      const tool = parseToolRequest(spoken.raw);
      const research = parseResearchRequest(spoken.raw);
      if (tool.malformed || research.malformed) {
        throw new Error(INCOMPLETE_MODEL_JSON);
      }

      let fetched: ToolDrawer[] = [];
      let drawers: Record<string, unknown> | undefined;
      let researchPack: Record<string, unknown> | undefined;
      let answer = spoken;

      if (tool.requested || research.requested) {
        if (tool.requested) this.pushHoldingLine(npcId, tool.drawers);
        else this.pushResearchHoldingLine(npcId);
        fetched = tool.drawers;
        drawers = tool.requested ? collectDrawers(this.state, fetched, npcId) : {};
        if (tool.requested) {
          this.playLog.note(
            "Tool call",
            [
              `The model asked the game for these drawers: ${fetched.join(", ") || "(none)"}.`,
              tool.unknown.length ? `Unknown names: ${tool.unknown.join(", ")}.` : "",
              "",
              "World-state pack the game handed back:",
              JSON.stringify(drawers, null, 2),
            ]
              .filter(Boolean)
              .join("\n"),
          );
        }
        if (research.requested) {
          researchPack = await this.runResearch(research.queries);
          drawers = { ...drawers, research: researchPack };
        }
        try {
          answer = await this.callLlm(
            [
              { role: "system", content: speechSystem },
              { role: "user", content: scrapUser },
              { role: "assistant", content: spoken.raw },
              { role: "user", content: `${npcFactsFollowUp(playerText, drawers)}\n\n${SPEECH_PASS_HINT}` },
            ],
            SPEECH_TOKENS,
            {
              requireProposals: false,
              allowRepair: false,
              purpose: tool.requested ? (research.requested ? "speech after a tool call and research" : "speech after a tool call") : "speech after research",
            },
          );
          if (hasMalformedToolMarker(answer.raw)) {
            throw new Error(INCOMPLETE_MODEL_JSON);
          }
        } catch (err) {
          if (this.recoverHuntOffer(npcId, playerText)) return this.finishTalk();
          this.noteTalkFailure(err, npcId);
          return this.finishTalk();
        }
      }

      if (looksLikeSpokenAgree(playerText)) {
        const priorTurns = this.messages.filter((m) => m.role === "npc" && m.npcId === npcId).map((m) => m.text);
        const prior = priorTurns.join("\n");
        const holdingId = this.state.holdings[0]?.id ?? "fontenay";
        const priced = pricedWorkFromTalk(`${prior}\n${answer.speech}`, holdingId);
        if (priced || claimsBooksWrote(answer.speech)) {
          const speech = claimsBooksWrote(answer.speech) ? unconfirmedWorkSpeech(priced) : answer.speech;
          this.pushNpcSpeech(npcId, { ...answer, speech });
          if (priced && !this.pending.some((p) => p.status === "pending" && samePricedOffer(p.proposal, priced))) {
            this.queueProposal(npcId, priced);
            this.ledgerNote("1 proposed change awaits Confirm. Nothing is written to the books until then.", npcId);
          }
          return this.finishTalk();
        }
        // The lord said yes to a plan spoken in talk that the engine could not price
        // itself. Let the speaker set that plan down as proposals.
        const spokenPlan = priorTurns.filter((t) => t.trim() && t.trim() !== HOLD_AT_ONCE_APOLOGY).at(-1)?.trim() ?? "";
        if (spokenPlan && !discussed && !huntAsk && answer.books !== false) {
          const agreedFetched = [...new Set<ToolDrawer>([...fetched, ...baselineDrawersFor(npcId)])];
          const agreedDrawers = withResearch(collectDrawers(this.state, agreedFetched, npcId), researchPack);
          try {
            const books = await this.callLlm(
              [
                { role: "system", content: system },
                { role: "user", content: npcUserPrompt(this.state, npcId, playerText, extra, agreedDrawers) },
                { role: "assistant", content: answer.raw },
                { role: "user", content: agreedPlanFollowUp(playerText, spokenPlan) },
              ],
              BOOKS_TOKENS,
              { requireProposals: false, allowRepair: true, purpose: "books, agreed plan" },
            );
            this.speakWithBeginFigures(npcId, answer, books.proposals, playerText);
            this.ingestParsedDialogue(npcId, books, playerText, undefined, undefined, true);
          } catch (err) {
            this.keepSpeechAfterBooksFailure(err, npcId, answer);
          }
          return this.finishTalk();
        }
      }

      // The books pass sees what the speech pass fetched plus this speaker's baseline
      // drawers, so proposals citing land, projects, labour, customs, or the chest
      // need no second fetch and no second writing of the same proposals.
      const booksFetched = [...new Set<ToolDrawer>([...fetched, ...baselineDrawersFor(npcId)])];
      const booksDrawers = withResearch(collectDrawers(this.state, booksFetched, npcId), researchPack);

      const order = sureOrder || answer.books === true;
      if (answer.books != null) {
        this.playLog.note(
          "Books tag",
          `The speech pass tagged this turn [[books:${answer.books ? "yes" : "no"}]]. ${
            sureOrder ? "The engine already counted it an order." : order ? "The books pass runs on the model's word alone." : "No books pass."
          }`,
        );
      }

      if (!order) {
        if (!speechDelaysWorkForShortage(answer.speech) && !asksBeginAmount(playerText)) {
          this.pushNpcSpeech(npcId, answer);
          if (npcId === "smith" && playerAskedBloomery(playerText, this.bloomeryMentioned)) {
            this.ingestParsedDialogue(npcId, { proposals: [], parseErrors: [] }, playerText);
          }
          return this.finishTalk();
        }
        const booksUser = npcUserPrompt(this.state, npcId, playerText, extra, booksDrawers);
        let books: Awaited<ReturnType<GameController["callLlm"]>>;
        try {
          books = await this.callLlm(
            [
              { role: "system", content: system },
              { role: "user", content: booksUser },
              { role: "assistant", content: answer.raw },
              { role: "user", content: beginFiguresFollowUp(playerText) },
            ],
            BOOKS_TOKENS,
            { requireProposals: false, allowRepair: false, purpose: "books, figures for a short work" },
          );
        } catch (err) {
          this.keepSpeechAfterBooksFailure(err, npcId, answer);
          return this.finishTalk();
        }
        this.speakWithBeginFigures(npcId, answer, books.proposals, playerText);
        this.ingestParsedDialogue(npcId, books, playerText);
        return this.finishTalk();
      }

      try {
        const booksUser = npcUserPrompt(this.state, npcId, playerText, extra, booksDrawers);
        const booksMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
          { role: "system", content: system },
          { role: "user", content: booksUser },
          { role: "assistant", content: answer.raw },
          { role: "user", content: npcBooksFollowUp(playerText, discussed ? compactOfferLine(discussed.proposal) : undefined) },
        ];
        let books = await this.callLlm(booksMessages, BOOKS_TOKENS, {
          purpose: "books",
          // When only the model's tag opened the gate, an empty proposals list
          // is its own answer; do not spend a repair call forcing one.
          requireProposals: sureOrder,
          allowRepair: true,
          repairHint:
            "The lord gave an order that must change the ledger. proposals was empty or invalid. Emit at least one proposal (assign_labour, start_project, adjust_sowing, defer_proposal, transfer_resources, add_modifier, set_standing_order, register_npc, start_hunt, or sponsor_feast) with real numbers. If you promise the change after harvest or later, emit defer_proposal wrapping the inner change.",
        });

        const missing = missingCitedDrawers(books.proposals, booksFetched);
        if (missing.length) {
          const repairFacts = collectDrawers(this.state, missing, npcId);
          books = await this.callLlm(
            [
              ...booksMessages,
              { role: "assistant", content: books.raw },
              repairPrompt(
                books.raw,
                ["Proposals cited stores or land that were not in the facts you were given."],
                `The engine fetched these missing drawers. Use only these numbers. Do not emit tool markers.\n${JSON.stringify(repairFacts)}`,
              ),
            ],
            BOOKS_TOKENS,
            { requireProposals: true, allowRepair: false, purpose: "books, missing drawers" },
          );
        }

        if (isNegotiatorId(npcId)) {
          const modelHunt = books.proposals.find((p) => p.type === "start_hunt");
          const judged =
            modelHunt?.type === "start_hunt" ? modelHunt.durationSeasons : seasonsNamedInText(answer.speech);
          if (huntAsk) {
            const difficulty = this.resolvedHuntDifficulty(playerText, answer.speech, books.proposals);
            const req = extractHuntRequest(playerText);
            if (req && difficulty) {
              const brief = quoteHunt(
                this.state,
                { ...req, difficulty },
                { judged, asked: seasonsAskedByLord(playerText) },
              );
              if (this.state.resources.denarii < brief.quotedDenarii) {
                this.pushNpcSpeech(npcId, { speech: unaffordableHuntSpeech(brief), emotion: "concerned" });
                return this.finishTalk();
              }
              answer = { ...answer, speech: withComputedHuntPrice(answer.speech, brief) };
              for (const proposal of books.proposals) {
                if (proposal.type === "start_hunt") proposal.difficulty = difficulty;
              }
            }
            this.speakWithBeginFigures(npcId, answer, books.proposals, playerText);
            this.ingestParsedDialogue(npcId, books, playerText, difficulty, judged, order);
            return this.finishTalk();
          }
          if (modelHunt?.type === "start_hunt") {
            const brief = quoteHunt(
              this.state,
              {
                goods: modelHunt.goods,
                resource: modelHunt.resource,
                amount: modelHunt.amount,
                difficulty: modelHunt.difficulty,
              },
              { judged: modelHunt.durationSeasons, asked: seasonsAskedByLord(playerText) },
            );
            answer = { ...answer, speech: withComputedHuntPrice(answer.speech, brief) };
          }
        }

        this.speakWithBeginFigures(npcId, answer, books.proposals, playerText);
        this.ingestParsedDialogue(npcId, books, playerText, undefined, undefined, order);
        return this.finishTalk();
      } catch (err) {
        if (this.recoverHuntOffer(npcId, playerText, answer)) return this.finishTalk();
        this.keepSpeechAfterBooksFailure(err, npcId, answer);
        return this.finishTalk();
      }
    } catch (err) {
      if (this.recoverHuntOffer(npcId, playerText)) return this.finishTalk();
      this.noteTalkFailure(err, npcId);
      return this.finishTalk();
    }
  }

  /** Books difficulty wins. Otherwise the last difficulty word in his speech. Staples default easy. */
  private resolvedHuntDifficulty(
    playerText: string,
    speech: string,
    proposals: MechanicalProposal[],
  ): HuntDifficulty | undefined {
    const req = extractHuntRequest(playerText);
    if (!req) return undefined;
    const fromBooks = proposals.find((p) => p.type === "start_hunt");
    const chosen =
      fromBooks?.type === "start_hunt" && fromBooks.difficulty
        ? fromBooks.difficulty
        : difficultyFromSpeech(speech);
    return resolveHuntDifficulty(req.resource, chosen);
  }

  /**
   * Books pass failed, or never ran. The purse is still the engine's figure.
   * Queue Confirm if this ask can be paid; do not invent a second card.
   */
  private recoverHuntOffer(
    npcId: string,
    playerText: string,
    spoken?: { speech: string; emotion?: AldricEmotion },
  ): boolean {
    if (!isNegotiatorId(npcId)) return false;
    const spokenDifficulty = difficultyFromSpeech(spoken?.speech ?? "");
    const judged = seasonsNamedInText(spoken?.speech ?? "");
    const forced = huntProposalForAsk(this.state, playerText, spokenDifficulty, judged);
    if (!forced?.length) {
      const why = huntFulfillReason(this.state, playerText, spokenDifficulty);
      if (!why) return false;
      this.pushNpcSpeech(npcId, { speech: why, emotion: "concerned" });
      return true;
    }
    const playerAt = this.messages.map((m) => m.role).lastIndexOf("player");
    const req = extractHuntRequest(playerText);
    const brief = req
      ? quoteHunt(
          this.state,
          { ...req, difficulty: resolveHuntDifficulty(req.resource, spokenDifficulty) },
          { judged, asked: seasonsAskedByLord(playerText) },
        )
      : null;
    const speech = brief ? withComputedHuntPrice(spoken?.speech ?? "", brief) : (spoken?.speech ?? "");
    const priced =
      brief != null &&
      this.messages.slice(playerAt + 1).some((m) => m.role === "npc" && m.text.includes(`${brief.quotedDenarii} denarii`));
    if (!priced && speech) {
      this.pushNpcSpeech(npcId, { speech, emotion: spoken?.emotion ?? "pleased" });
    }
    if (!this.pending.some((p) => p.status === "pending" && p.proposal.type === "start_hunt")) {
      for (const proposal of forced) this.queueProposal(npcId, proposal);
      this.ledgerNote("1 proposed change awaits Confirm. Nothing is written to the books until then.", npcId);
    }
    return true;
  }

  private pushNpcSpeech(
    npcId: string,
    spoken: { speech: string; chronicle?: string; emotion?: AldricEmotion },
  ) {
    if (npcId === "steward" && isBernardBloomeryPitch(spoken.speech)) {
      spoken = { ...spoken, speech: ALDRIC_BLOOMERY_REFERRAL };
    }
    if (npcId === "smith" && isBernardBloomeryPitch(spoken.speech)) {
      const asked = playerAskedBloomery(this.lastPlayerText("smith"), this.bloomeryMentioned);
      if (!asked || !bloomerySuggestReady(this.state)) {
        if (bloomerySuggestReady(this.state)) {
          spoken = { ...spoken, speech: BERNARD_BLOOMERY_MENTION };
          this.bloomeryMentioned = true;
        } else {
          spoken = { ...spoken, speech: bloomeryNotReadyReason(this.state) ?? "Not yet." };
        }
      }
    }
    if (spoken.emotion && PORTRAIT_NPCS.has(npcId)) this.npcEmotions[npcId] = spoken.emotion;
    const spokenText = stripToolMarkers(spoken.speech);
    this.turnSpeech = spokenText;
    this.messages.push({
      id: newId("msg"),
      role: "npc",
      npcId,
      npcName: this.npcName(npcId),
      text: spokenText,
      chronicle: spoken.chronicle,
      emotion: PORTRAIT_NPCS.has(npcId) ? spoken.emotion ?? this.npcEmotions[npcId] : undefined,
      at: new Date().toISOString(),
    });
    if (npcId === "smith") this.ensureBloomeryWord(this.lastPlayerText("smith"));
    if (npcId === "smith" && asksAboutTheHarvest(this.lastPlayerText("smith"))) this.referHarvestToAldric();
    if (npcId === "steward" && playerAskedBloomery(this.lastPlayerText("steward"))) this.referBloomeryToBernard();
    if (npcId === "steward") this.flushHireRecommendations();
  }

  /** Engine string in the NPC's mouth — never a Books line, never a model call. */
  private pushHoldingLine(npcId: string, drawers: readonly ToolDrawer[]) {
    this.pushEngineNpcLine(npcId, holdingLineForDrawers(drawers));
  }

  private pushResearchHoldingLine(npcId: string) {
    this.pushEngineNpcLine(npcId, RESEARCH_HOLDING_LINE);
  }

  private pushEngineNpcLine(npcId: string, text: string) {
    if (PORTRAIT_NPCS.has(npcId)) this.npcEmotions[npcId] = "thoughtful";
    this.messages.push({
      id: newId("msg"),
      role: "npc",
      npcId,
      npcName: this.npcName(npcId),
      text,
      emotion: PORTRAIT_NPCS.has(npcId) ? "thoughtful" : undefined,
      at: new Date().toISOString(),
    });
  }

  /**
   * The hidden research tool: look up the speaker's questions (at most two)
   * and build the drawer the model reads. Never throws; a missing key or a
   * failed search comes back as a drawer that says so.
   */
  private async runResearch(queries: string[]): Promise<Record<string, unknown>> {
    const asked = queries.slice(0, MAX_RESEARCH_QUERIES);
    const findings: ResearchFinding[] = [];
    for (const q of asked) findings.push(await this.research.lookup(q));
    this.playLog.note(
      "Research",
      [
        `The model asked the game to look up: ${asked.map((q) => `"${q}"`).join("; ")}.`,
        queries.length > asked.length ? `${queries.length - asked.length} further question(s) were dropped (two per reply).` : "",
        this.settings.searchApiKey ? "" : "No research key is set; the drawer tells the model to judge for itself.",
        "",
        "Findings handed back:",
        JSON.stringify(findings, null, 2),
      ]
        .filter(Boolean)
        .join("\n"),
    );
    return researchDrawer(findings);
  }

  /** Engine string only — never call the model to apologize. */
  private noteTalkFailure(err: unknown, npcId: string) {
    if (isHoldAtOnceFailure(err)) {
      this.pushHoldAtOnceApology(npcId);
      return;
    }
    this.ledgerNote(booksHearFailureLine(this.npcName(npcId)), npcId);
  }

  /**
   * The speech pass already answered; only the books pass failed. The lord keeps
   * the words he was given and a ledger line says nothing was written. If the
   * speech itself was unusable, fall back to the ordinary failure line.
   */
  private keepSpeechAfterBooksFailure(
    err: unknown,
    npcId: string,
    spoken: { speech: string; chronicle?: string; emotion?: AldricEmotion },
  ) {
    const speech = stripToolMarkers(spoken.speech).trim();
    if (!speech || speech === HOLD_AT_ONCE_APOLOGY) {
      this.noteTalkFailure(err, npcId);
      return;
    }
    this.pushNpcSpeech(npcId, spoken);
    this.ledgerNote(BOOKS_NOT_TAKEN_LINE, npcId);
  }

  /** Spoken by the NPC they were talking to — not a Books line. */
  private pushHoldAtOnceApology(npcId: string) {
    this.messages.push({
      id: newId("msg"),
      role: "npc",
      npcId,
      npcName: this.npcName(npcId),
      text: HOLD_AT_ONCE_APOLOGY,
      emotion: PORTRAIT_NPCS.has(npcId) ? this.npcEmotions[npcId] : undefined,
      at: new Date().toISOString(),
    });
  }

  queueProposal(npcId: string, proposal: MechanicalProposal, replaceId?: string): PendingProposal {
    const filled = fillProposalDefaults(this.state, proposal);
    const item: PendingProposal = {
      id: filled.id && filled.id !== replaceId ? filled.id : newId("prop"),
      npcId,
      proposal: { ...filled, id: filled.id },
      status: "pending",
    };
    if (replaceId) {
      const idx = this.pending.findIndex((p) => p.id === replaceId && p.status === "pending");
      if (idx >= 0) {
        this.pending[idx] = item;
        if (this.askedAboutId === replaceId) this.askedAboutId = item.id;
        setNpcWantsTalk(this.state, npcId, true);
        return item;
      }
    }
    this.pending.push(item);
    setNpcWantsTalk(this.state, npcId, true);
    return item;
  }

  /** Speech the lord hears uses the begin-cost the card will take. */
  private speakWithBeginFigures(
    npcId: string,
    spoken: { speech: string; chronicle?: string; emotion?: AldricEmotion },
    proposals: MechanicalProposal[],
    playerText: string,
  ) {
    let next = proposals;
    let speechIn = spoken.speech;
    if (npcId === "smith") {
      const guarded = guardSmithProposals(this.state, proposals);
      next = guarded.proposals;
      speechIn = guarded.speech ?? smithSpeechForOrder(this.state, playerText) ?? speechIn;
    }
    const pending = this.pending.filter((p) => p.status === "pending" && p.npcId === npcId).map((p) => p.proposal);
    const speech = withBeginShortfalls(speechIn, this.state, next, { pending, playerText });
    this.pushNpcSpeech(npcId, { ...spoken, speech });
  }

  /** Testable: parse result → pending queue and ledger notes. Does not call the model. */
  ingestParsedDialogue(
    npcId: string,
    parsed: { proposals: MechanicalProposal[]; parseErrors: string[]; incomplete?: boolean; response?: { speech?: string } },
    playerText: string,
    huntDifficulty?: HuntDifficulty,
    huntJudged?: number,
    /** Whether this turn was treated as an order (regex floor or the model's books tag). Defaults to the regex. */
    order?: boolean,
  ) {
    if (parsed.incomplete) return;
    if (npcId === "steward") this.flushHireRecommendations();
    if (npcId === "smith") this.ensureBogOreSpeech(playerText);
    let proposals = dropHuntFeeDuplicates(dropHireFeeDuplicates(parsed.proposals.map(ensureSummary)));
    proposals = proposals.map((p) => stampSpeakerTag(npcId, p));
    if (npcId !== "smith") proposals = proposals.filter((p) => !isBloomeryStart(p));
    const askedBloomery = npcId === "smith" && playerAskedBloomery(playerText, this.bloomeryMentioned);
    if (npcId === "smith") proposals = this.dropUnaskedBloomery(proposals, playerText);
    let huntChoice: unknown;
    let huntSettled = false;
    if (isNegotiatorId(npcId)) {
      const modelHunt = proposals.find((p) => p.type === "start_hunt");
      huntChoice =
        huntDifficulty ?? (modelHunt?.type === "start_hunt" ? modelHunt.difficulty : undefined);
      const judged =
        huntJudged ?? (modelHunt?.type === "start_hunt" ? modelHunt.durationSeasons : undefined);
      const forced = huntProposalForAsk(this.state, playerText, huntChoice, judged);
      if (forced !== null) {
        proposals = forced;
        huntSettled = true;
      } else {
        const asked = seasonsAskedByLord(playerText);
        proposals = proposals
          .filter((p) => p.type === "start_hunt")
          .map((p) => (p.type === "start_hunt" ? normalizeHuntProposal(this.state, p, asked) : p));
      }
    }
    proposals = this.dropLockedOrUnauthorizedHires(npcId, proposals);
    proposals = augmentOrderProposals(this.state, npcId, playerText, proposals);
    let fromEngine = false;
    if (!proposals.length && !huntSettled) {
      const inferred = inferOrderProposals(this.state, npcId, playerText);
      if (inferred.length) {
        proposals = inferred;
        fromEngine = true;
      }
    }
    if (
      askedBloomery &&
      bloomerySuggestReady(this.state) &&
      !proposals.some((p) => isBloomeryStart(p)) &&
      !this.pending.some((p) => p.status === "pending" && isBloomeryStart(p.proposal))
    ) {
      proposals = [...proposals, bloomeryStartProposal(this.state)];
      fromEngine = false;
    }
    if (fromEngine && proposals.length > 0 && proposals.every((p) => isBloomeryStart(p))) fromEngine = false;
    if (npcId === "smith") this.ensureBloomeryWord(playerText);
    if (npcId === "steward" && playerAskedBloomery(playerText)) this.referBloomeryToBernard();
    if (npcId === "steward") {
      const fromTurn = this.turnSpeech.trim();
      const fromParsed = parsed.response?.speech ?? "";
      const speech =
        parseSpokenImprovement(fromTurn) != null
          ? fromTurn
          : parseSpokenImprovement(fromParsed) != null
            ? fromParsed
            : fromTurn || fromParsed;
      const pendingMods = this.pending.filter((p) => p.status === "pending").map((p) => p.proposal);
      const prepared = prepareStewardToolProposals(this.state, playerText, proposals, speech, pendingMods);
      proposals = prepared.proposals;
      if (prepared.note) this.ledgerNote(prepared.note, npcId);
    }
    if (npcId === "smith") {
      proposals = proposals.filter((p) => !proposalWritesTheFields(p));
      proposals = guardSmithProposals(this.state, proposals).proposals;
      if (asksAboutTheHarvest(playerText)) this.referHarvestToAldric();
    }
    const asked = this.discussedPending(npcId);
    let replaceId = asked?.id;
    let askedProposal = asked?.proposal;
    for (const p of proposals) {
      if (replaceId && askedProposal && isRevisionOf(askedProposal, p)) {
        const queued = this.queueProposal(npcId, p, replaceId);
        replaceId = queued.id;
        askedProposal = queued.proposal;
      } else {
        this.queueProposal(npcId, p);
      }
    }
    if (proposals.length) {
      const n = proposals.length;
      this.ledgerNote(
        fromEngine
          ? `The chronicler could not set the figures. ${n} change${n === 1 ? " was" : "s were"} drafted from your order — Confirm writes ${n === 1 ? "it" : "them"} in the books.`
          : `${n} proposed change${n === 1 ? "" : "s"} await Confirm. Nothing is written to the books until then.`,
        npcId,
      );
      return;
    }
    if (askedBloomery && !bloomerySuggestReady(this.state)) {
      const why = bloomeryNotReadyReason(this.state);
      const already = why != null && this.messages.some((m) => m.npcId === "smith" && m.text.includes(why));
      if (why && !already) this.ledgerNote(why, "smith");
      return;
    }
    if (npcId === "steward" && playerAskedBloomery(playerText)) return;
    if (huntSettled) {
      const why = huntFulfillReason(this.state, playerText, huntChoice);
      this.ledgerNote(
        why
          ? `No change was set down. ${why}`
          : "They answered in speech only. The books are unchanged. Give a clear order — sow, begin a work, give stores, call hands, a blessing, hire a craftsman, or a forthcoming change after harvest — or advance the season.",
        npcId,
      );
      return;
    }
    if (parsed.parseErrors.length) {
      this.ledgerNote("Nothing was written to the books. They remain unchanged.", npcId);
      return;
    }
    const regexOrder = looksLikeMechanicalOrder(playerText, npcId);
    if (order ?? regexOrder) {
      const why = cannotFulfillReason(this.state, npcId, playerText);
      this.ledgerNote(
        why
          ? `No change was set down. ${why}`
          : regexOrder
            ? "They answered in speech only. The books are unchanged. Give a clear order — sow, begin a work, give stores, call hands, a blessing, hire a craftsman, or a forthcoming change after harvest — or advance the season."
            : "They answered in speech only; nothing was set down in the books. Say it again as a plain order — what is to be done, by whom, and when — and it will be written.",
        npcId,
      );
    }
  }

  /** Bernard names bog ore in plain words when the lord asks. Skips if he just said it. */
  private ensureBogOreSpeech(playerText: string) {
    if (!asksAboutBogOre(playerText)) return;
    const recent = [...this.messages].reverse().find((m) => m.role === "npc" && m.npcId === "smith");
    if (recent && /bog ore|rusty mud|wet ground/i.test(recent.text)) return;
    this.npcEmotions.smith = "thoughtful";
    this.messages.push({
      id: newId("msg"),
      role: "npc",
      npcId: "smith",
      npcName: this.npcName("smith"),
      text: BERNARD_BOG_ORE_SPEECH,
      emotion: "thoughtful",
      at: new Date().toISOString(),
    });
  }

  /** A bloomery card stays only when Bernard was asked and the stores can bear it. */
  private dropUnaskedBloomery(proposals: MechanicalProposal[], playerText: string): MechanicalProposal[] {
    const asked = playerAskedBloomery(playerText, this.bloomeryMentioned);
    if (asked && bloomerySuggestReady(this.state)) return proposals;
    let dropped = false;
    const kept = proposals.filter((p) => {
      if (!isBloomeryStart(p)) return true;
      dropped = true;
      return false;
    });
    if (dropped && asked && kept.length) this.ledgerNote(bloomeryNotReadyReason(this.state) ?? "Not yet.", "smith");
    return kept;
  }

  private lastPlayerText(npcId: string): string {
    const line = [...this.messages].reverse().find((m) => m.role === "player" && m.npcId === npcId);
    return line?.text ?? "";
  }

  private pushSmithLine(text: string) {
    this.npcEmotions.smith = "thoughtful";
    this.messages.push({
      id: newId("msg"),
      role: "npc",
      npcId: "smith",
      npcName: this.npcName("smith"),
      text,
      emotion: "thoughtful",
      at: new Date().toISOString(),
    });
  }

  /**
   * Mention only in Bernard's own talk, and only when Confirm could begin the work.
   * The card waits until the lord asks. Then he explains, at the costs the books take.
   */
  private ensureBloomeryWord(playerText: string) {
    const asked = playerAskedBloomery(playerText, this.bloomeryMentioned);
    if (asked) {
      if (!bloomerySuggestReady(this.state)) return;
      this.bloomeryMentioned = true;
      const pitched = this.messages.some(
        (m) => m.role === "npc" && m.npcId === "smith" && /4 cart-loads of timber/.test(m.text) && /bog ore/i.test(m.text),
      );
      if (!pitched) this.pushSmithLine(bernardBloomeryPitch());
      return;
    }
    if (this.bloomeryMentioned || !bloomerySuggestReady(this.state)) return;
    if (this.pending.some((p) => p.status === "pending" && isBloomeryStart(p.proposal))) return;
    this.bloomeryMentioned = true;
    this.pushSmithLine(BERNARD_BLOOMERY_MENTION);
  }

  /** Bernard forges. The harvest is Aldric's to write. */
  private referHarvestToAldric() {
    const lastPlayer = this.messages.map((m) => m.role).lastIndexOf("player");
    const since = lastPlayer >= 0 ? this.messages.slice(lastPlayer + 1) : this.messages;
    if (since.some((m) => m.npcId === "smith" && m.role === "npc" && /aldric/i.test(m.text) && /harvest/i.test(m.text))) {
      return;
    }
    this.npcEmotions.smith = "thoughtful";
    this.messages.push({
      id: newId("msg"),
      role: "npc",
      npcId: "smith",
      npcName: this.npcName("smith"),
      text: BERNARD_HARVEST_REDIRECT,
      emotion: "thoughtful",
      at: new Date().toISOString(),
    });
  }

  /** Aldric names Bernard. He does not queue the work or speak the smith's lines. */
  private referBloomeryToBernard() {
    const lastPlayer = this.messages.map((m) => m.role).lastIndexOf("player");
    const since = lastPlayer >= 0 ? this.messages.slice(lastPlayer + 1) : this.messages;
    if (since.some((m) => m.npcId === "steward" && m.role === "npc" && /speak to him/i.test(m.text) && /bernard/i.test(m.text))) {
      return;
    }
    this.npcEmotions.steward = "thoughtful";
    this.messages.push({
      id: newId("msg"),
      role: "npc",
      npcId: "steward",
      npcName: this.npcName("steward"),
      text: ALDRIC_BLOOMERY_REFERRAL,
      emotion: "thoughtful",
      at: new Date().toISOString(),
    });
  }

  /** Engine-authored Aldric lines when an expansion hire first unlocks. Chat only; does not write the ledger. */
  flushHireRecommendations(fresh?: ReturnType<typeof recommendableHires>) {
    const toSpeak = (fresh ?? recommendableHires(this.state)).filter(
      (s) => !this.recommendedHireIds.has(s.id) && !specialistAlreadyPresent(this.state, s),
    );
    for (const spec of toSpeak) {
      if (this.recommendedHireIds.has(spec.id)) continue;
      this.recommendedHireIds.add(spec.id);
      this.npcEmotions.steward = "thoughtful";
      this.messages.push({
        id: newId("msg"),
        role: "npc",
        npcId: "steward",
        npcName: this.npcName("steward"),
        text: spec.recommendSpeech,
        emotion: "thoughtful",
        at: new Date().toISOString(),
      });
    }
  }

  private dropLockedOrUnauthorizedHires(npcId: string, proposals: MechanicalProposal[]): MechanicalProposal[] {
    const kept: MechanicalProposal[] = [];
    for (const p of proposals) {
      if (p.type !== "register_npc") {
        kept.push(p);
        continue;
      }
      if (isEstateSmithNpc(p.npc)) {
        this.ledgerNote("Bernard already keeps the forge. He is not for hire.", npcId);
        continue;
      }
      const spec = matchHireableSpecialist(p.npc);
      if (!spec) {
        kept.push(p);
        continue;
      }
      if (npcId !== "steward") {
        this.ledgerNote("Aldric the steward keeps the household books and seeks craftsmen. Speak to him of hiring.", npcId);
        continue;
      }
      const blocked = specialistHireBlocked(this.state, spec);
      if (blocked) {
        this.ledgerNote(blocked, npcId);
        continue;
      }
      kept.push(p);
    }
    return kept;
  }

  private ledgerNote(text: string, npcId: string) {
    this.messages.push({
      id: newId("msg"),
      role: "system",
      npcId,
      text,
      at: new Date().toISOString(),
    });
  }

  confirmProposal(id: string): GameView & { error?: string } {
    if (estateIsAbandoned(this.state) || this.state.estateAbandoned) {
      markEstateAbandoned(this.state);
      return { ...this.view(), error: ABANDONED_GAME_OVER };
    }
    const item = this.pending.find((p) => p.id === id && (p.status === "pending" || p.status === "withheld"));
    if (!item || item.status !== "pending") {
      if (item?.status === "withheld") {
        return { ...this.view(), error: item.rejectReason || "That change is set aside." };
      }
      return { ...this.view(), error: playerFacingReason("No such pending proposal.") };
    }
    const gate = confirmGate(item, this.pending);
    if (gate.blocked) return { ...this.view(), error: gate.note ?? "That change is set aside." };
    return this.finishConfirm([item], item.id);
  }

  confirmAllProposals(): GameView & { error?: string } {
    if (estateIsAbandoned(this.state) || this.state.estateAbandoned) {
      markEstateAbandoned(this.state);
      return { ...this.view(), error: ABANDONED_GAME_OVER };
    }
    const batch = sortPendingForApply(this.pending.filter((p) => p.status === "pending"));
    if (!batch.length) return { ...this.view(), error: playerFacingReason("No such pending proposal.") };
    return this.finishConfirm(batch);
  }

  private finishConfirm(batch: PendingProposal[], errorOnId?: string): GameView & { error?: string } {
    const before = cloneState(this.state);
    const noted = new Set<string>();
    const startedThisPack: Project[] = [];
    let error: string | undefined;
    for (const next of batch) {
      if (next.status !== "pending") continue;
      const dep = dependentStart(next, this.pending);
      if (dep && dep.status !== "pending" && dep.status !== "applied") {
        this.withholdFollowOns(dep, noted);
        if (errorOnId && next.id === errorOnId) error = next.rejectReason || dependentSkipLine(workLabelOf(dep));
        continue;
      }
      let credited: Project[] = [];
      if (next.proposal.type === "start_project" && startedThisPack.length) {
        const step = prepareSameSeasonUse(this.state, next.proposal, startedThisPack);
        if (step.block) {
          next.status = "rejected";
          next.rejectReason = step.block;
          this.log(next.npcId, "REJECT", step.block);
          this.ledgerNote(`It cannot be made so. ${playerFacingReason(step.block)}`, next.npcId);
          this.withholdFollowOns(next, noted);
          if (this.askedAboutId === next.id) this.askedAboutId = null;
          if (errorOnId && next.id === errorOnId) error = playerFacingReason(step.block);
          continue;
        }
        credited = step.credited;
      }
      const beforeIds = new Set(this.state.projects.map((p) => p.id));
      const result = this.applyOnePending(next);
      if (!result.ok && credited.length) {
        for (const project of credited) undoPaidProjectResult(this.state, project);
      }
      if (result.ok && next.proposal.type === "start_project") {
        const created = this.state.projects.find((p) => !beforeIds.has(p.id));
        if (created) startedThisPack.push(created);
      }
      if (errorOnId && next.id === errorOnId && result.error) error = result.error;
      if (!result.ok && next.proposal.type === "start_project") this.withholdFollowOns(next, noted);
    }
    this.flushHireRecommendations(newlyUnlockedHires(before, this.state));
    for (const npcId of new Set(batch.map((p) => p.npcId))) {
      releaseConfirmWantsTalk(this.state, npcId, this.pending);
    }
    return error ? { ...this.view(), error } : this.view();
  }

  confirmMerchantShop(basket: MerchantShopBasket): GameView & { error?: string } {
    if (estateIsAbandoned(this.state) || this.state.estateAbandoned) {
      markEstateAbandoned(this.state);
      return { ...this.view(), error: ABANDONED_GAME_OVER };
    }
    if (!this.merchantAvailable()) {
      return { ...this.view(), error: playerFacingReason("The merchant has already left the district.") };
    }
    ensureMerchantVisitShop(this.state);
    const quote = quoteMerchantBasket(this.state, basket);
    if (!quote.canConfirm) {
      return { ...this.view(), error: playerFacingReason(quote.reason ?? "The stall cannot be settled.") };
    }
    const result = applyMerchantBasket(this.state, basket);
    this.state = result.state;
    const logLine = result.ok ? result.logLine : result.reason ?? result.logLine;
    this.log("merchant", result.ok ? "APPLY" : "REJECT", logLine);
    if (!result.ok) {
      this.playLog.note("Refusal", `The stall was refused.\n\nReason: ${result.reason ?? result.logLine}`);
    }
    this.ledgerNote(
      result.ok
        ? playerFacingLogLine(logLine)
        : `It cannot be made so. ${playerFacingReason(result.reason ?? logLine)}`,
      "merchant",
    );
    if (result.ok) {
      recordConfirmedTransaction(this.state, "merchant", {
        type: "transfer_resources",
        summary: shopLogLine(this.state, quote),
        resource: quote.buyLines[0]?.resource ?? quote.sellLines[0]?.resource ?? "denarii",
        amount: quote.buyLines[0]?.amount ?? quote.sellLines[0]?.amount ?? 0,
        direction: quote.sellProceeds >= quote.buyCost ? "sell" : "buy",
      }, logLine);
    }
    return result.ok ? this.view() : { ...this.view(), error: playerFacingReason(result.reason ?? logLine) };
  }

  private applyOnePending(item: PendingProposal): { ok: boolean; error?: string } {
    if (item.status !== "pending") return { ok: false };
    const beforeIds = new Set(this.state.projects.map((p) => p.id));
    const beforeNpc = cloneState(this.state);
    const result = applyProposal(this.state, item.proposal, item.npcId);
    this.state = result.state;
    item.status = result.ok ? "applied" : "rejected";
    item.rejectReason = result.reason;
    if (!result.ok) {
      this.playLog.note(
        "Refusal",
        `The books refused this proposal.\n\n${JSON.stringify(item.proposal, null, 2)}\n\nReason: ${result.reason ?? result.logLine}`,
      );
    }
    const logLine = result.ok ? result.logLine : result.reason ?? result.logLine;
    if (result.ok && item.proposal.type === "start_project") {
      const created = this.state.projects.find((p) => !beforeIds.has(p.id));
      if (created) this.retargetFollowOns(item, created.id);
    }
    if (result.ok && item.proposal.type === "register_npc") {
      const spec = matchHireableSpecialist(item.proposal.npc);
      if (spec) this.npcEmotions[spec.id] = this.npcEmotions[spec.id] ?? "neutral";
    }
    this.log(item.npcId, result.ok ? "APPLY" : "REJECT", logLine);
    this.ledgerNote(
      result.ok
        ? playerFacingLogLine(logLine)
        : `It cannot be made so. ${playerFacingReason(result.reason ?? logLine)}`,
      item.npcId,
    );
    // A scene that moved on with the lord's words speaks its next stage at once.
    const beats = (result as HistoryApplyResult).beats;
    if (result.ok && beats?.length) this.postHistoryBeats(beats);
    if (this.askedAboutId === item.id) this.askedAboutId = null;
    if (result.ok) {
      recordConfirmedTransaction(this.state, item.npcId, item.proposal, logLine);
      this.flushHireRecommendations(newlyUnlockedHires(beforeNpc, this.state));
    }
    return result.ok ? { ok: true } : { ok: false, error: playerFacingReason(result.reason ?? logLine) };
  }

  /** Point hands at the work just begun, and only when they named that work. */
  private retargetFollowOns(start: PendingProposal, projectId: string) {
    for (const item of this.pending) {
      if (item.status !== "pending") continue;
      if (item.proposal.type !== "assign_labour" && item.proposal.type !== "adjust_project") continue;
      if (item.proposal.projectId === "unassigned") continue;
      const matches = matchingStarts(item.proposal.projectId, this.pending);
      if (matches.length === 1 && matches[0].id === start.id) item.proposal.projectId = projectId;
    }
  }

  private withholdFollowOns(start: PendingProposal, noted: Set<string>) {
    if (start.proposal.type !== "start_project") return;
    const deps = this.pending.filter((p) => p.status === "pending" && dependentStart(p, this.pending)?.id === start.id);
    if (!deps.length) return;
    const line = dependentSkipLine(workLabelOf(start));
    for (const dep of deps) {
      dep.status = "withheld";
      dep.rejectReason = line;
    }
    if (!noted.has(start.id)) {
      noted.add(start.id);
      this.ledgerNote(line, start.npcId);
    }
  }

  rejectProposal(id: string): GameView {
    if (estateIsAbandoned(this.state) || this.state.estateAbandoned) {
      markEstateAbandoned(this.state);
      return this.view();
    }
    const item = this.pending.find((p) => p.id === id && p.status === "pending");
    if (item) {
      item.status = "rejected";
      item.rejectReason = "Player rejected";
      this.playLog.note(
        "Player refused a proposal",
        `${JSON.stringify(item.proposal, null, 2)}\n\nConfirm was not pressed. The books were left unchanged.`,
      );
      this.log(item.npcId, "REJECT", item.proposal.summary);
      const followOns =
        item.proposal.type === "start_project"
          ? this.pending.filter((p) => p.status === "pending" && dependentStart(p, this.pending)?.id === item.id)
          : [];
      if (item.proposal.type === "start_project" && followOns.length) {
        const line = dependentDeclineLine(workLabelOf(item));
        for (const dep of followOns) {
          dep.status = "withheld";
          dep.rejectReason = line;
        }
        this.ledgerNote(line, item.npcId);
      } else {
        this.ledgerNote(
          item.proposal.type === "settle_households"
            ? ARRIVAL_REFUSE_LINE
            : `You declined: ${playerFacingSummary(item.proposal) || "that change"}.`,
          item.npcId,
        );
      }
      if (this.askedAboutId === id) this.askedAboutId = null;
      releaseConfirmWantsTalk(this.state, item.npcId, this.pending);
    }
    return this.view();
  }

  cancelForthcomingOrder(id: string): GameView & { error?: string } {
    if (estateIsAbandoned(this.state) || this.state.estateAbandoned) {
      markEstateAbandoned(this.state);
      return { ...this.view(), error: ABANDONED_GAME_OVER };
    }
    const result = cancelStoredForthcoming(this.state, id);
    this.state = result.state;
    this.log("steward", result.ok ? "REJECT" : "REJECT", result.logLine);
    this.ledgerNote(result.ok ? playerFacingLogLine(result.logLine) : playerFacingReason(result.reason ?? result.logLine), "steward");
    return result.ok ? this.view() : { ...this.view(), error: playerFacingReason(result.reason ?? result.logLine) };
  }

  // ---- Battles (Phase 3) -----------------------------------------------------

  private battleDeps(): BattleDeps {
    return {
      chat: (messages, maxTokens) => this.llmRaw(messages, { maxTokens, temperature: 0.7, purpose: "battle" }),
      log: (actor, kind, summary) => this.log(actor, kind, summary),
    };
  }

  /** Answer or refuse an open call to arms. */
  answerCall(accept: boolean): GameView & { error?: string } {
    if (!this.state.battle_call) return { ...this.view(), error: "There is no call to answer." };
    if (!accept) {
      const text = refuseCall(this.state, this.battleDeps());
      this.ledgerNote(text, "steward");
      return this.view();
    }
    const result = acceptCall(this.state, this.battleDeps());
    if (!result.started) this.ledgerNote(result.text, "steward");
    return this.view();
  }

  /** Muster panel confirmed: ride out with the chosen units. */
  async musterAndRide(bringIds: string[]): Promise<GameView & { error?: string }> {
    const err = musterAndRide(this.state, this.battleDeps(), bringIds);
    if (err) return { ...this.view(), error: err };
    if (this.state.battle_session?.phase !== "fighting") return this.view(); // Full Command scouts and deploys first
    const cont = await battleContinue(this.state, this.battleDeps());
    await this.refreshCredits();
    return cont ? { ...this.view(), error: cont } : this.view();
  }

  // Full Command: scouting duel, deployment, nightfall.
  scoutRole(role: "narrower" | "finalizer"): GameView & { error?: string } {
    const err = scoutChooseRole(this.state, role);
    return err ? { ...this.view(), error: err } : this.view();
  }
  scoutNarrow(keep: number[]): GameView & { error?: string } {
    const err = scoutNarrow(this.state, keep);
    return err ? { ...this.view(), error: err } : this.view();
  }
  scoutFinalize(pick: number): GameView & { error?: string } {
    const err = scoutFinalize(this.state, pick);
    return err ? { ...this.view(), error: err } : this.view();
  }
  deployFile(unitId: string, cell: { row: number; col: number }): GameView & { error?: string } {
    const err = deployFile(this.state, unitId, cell);
    return err ? { ...this.view(), error: err } : this.view();
  }
  deployRest(): GameView & { error?: string } {
    const err = deployRest(this.state);
    return err ? { ...this.view(), error: err } : this.view();
  }
  addressFile(unitId: string, amount: number): GameView & { error?: string } {
    const err = addressFile(this.state, unitId, amount);
    return err ? { ...this.view(), error: err } : this.view();
  }
  async beginBattle(): Promise<GameView & { error?: string }> {
    const err = beginBattle(this.state);
    if (err) return { ...this.view(), error: err };
    const cont = await battleContinue(this.state, this.battleDeps());
    await this.refreshCredits();
    return cont ? { ...this.view(), error: cont } : this.view();
  }
  async dayEnd(choice: "hold" | "reposition" | "withdraw", pick?: number): Promise<GameView & { error?: string }> {
    const err = await dayEndChoice(this.state, this.battleDeps(), choice, pick);
    return err ? { ...this.view(), error: err } : this.view();
  }
  /** Test hook until the Command Claim narrative exists: grant or revoke Full Command. */
  grantFullCommand(on: boolean): GameView {
    this.state.player.fullCommandGranted = on;
    this.log("player", "APPLY", `Full Command ${on ? "granted" : "revoked"} (test hook).`);
    return this.view();
  }

  /** Opening tutorial progress, kept in the save so a load resumes where the lord left off. */
  setTutorial(patch: Partial<WorldState["tutorial"]>): WorldState["tutorial"] {
    const current = this.state.tutorial;
    const status = patch.status ?? current.status;
    const step = Number.isFinite(patch.step) ? Math.max(0, Math.floor(patch.step as number)) : current.step;
    this.state.tutorial = { status, step };
    this.persist();
    return this.state.tutorial;
  }

  async battleContinue(): Promise<GameView & { error?: string }> {
    const err = await battleContinue(this.state, this.battleDeps());
    await this.refreshCredits();
    return err ? { ...this.view(), error: err } : this.view();
  }

  /** Sub-/Full Command: the lord's orders for one round. */
  async battleRound(orders: unknown[]): Promise<GameView & { error?: string }> {
    const err = await battleCommandRound(this.state, this.battleDeps(), orders ?? []);
    await this.refreshCredits();
    return err ? { ...this.view(), error: err } : this.view();
  }

  async battleChoose(key: "A" | "B"): Promise<GameView & { error?: string }> {
    const err = await battleChoose(this.state, this.battleDeps(), key);
    return err ? { ...this.view(), error: err } : this.view();
  }

  battleFinish(disposition?: "settle" | "sell"): GameView & { error?: string } {
    const err = finishBattle(this.state, disposition);
    const record = this.state.battle_history.at(-1);
    if (err) return { ...this.view(), error: err };
    if (record) this.ledgerNote(`Written in the chronicle: ${record.summary}`, "steward");
    if (this.state.player.dead) {
      markDeath(this.state, "battle");
      this.ledgerNote("The lord of Fontenay is dead. The chronicle ends here.", "steward");
    } else if (this.state.player.captive) {
      markDeath(this.state, "captivity");
      this.ledgerNote("The ransom could not be met. The lord of Fontenay remains in his captors' hands; the chronicle ends here.", "steward");
    }
    return this.view();
  }

  /** Eberhard's door and the test hook: raise a call to arms now. */
  raiseCall(kind: BattleCallKind): GameView & { error?: string } {
    if (this.state.battle_call || this.state.battle_session) return { ...this.view(), error: "A call is already open." };
    if (kind === "history") return { ...this.view(), error: "History battles are raised by the calendar, not at the door." };
    raiseCallDirect(this.state, kind);
    return this.view();
  }

  async advanceSeason(): Promise<SeasonResult> {
    if (estateIsAbandoned(this.state) || this.state.estateAbandoned) {
      markEstateAbandoned(this.state);
      return { ...this.view(), effects: [{ kind: "info", text: ABANDONED_GAME_OVER }] };
    }
    if (this.state.history.dead) {
      return { ...this.view(), effects: [], error: "The lord of Fontenay is dead. The chronicle of this house is closed." };
    }
    if (this.state.battle_session) {
      return { ...this.view(), effects: [], error: "The lord is in the field. The season cannot turn until the battle is done." };
    }
    if (this.state.battle_call?.kind === "history") {
      // 03_HISTORY §9: a history battle holds the season until the lord rides out or turns back.
      return { ...this.view(), effects: [], error: "The host is waiting on your answer. Ride out or turn back before the season turns." };
    }
    if (this.state.battle_call) {
      // An unanswered call lapses when the season turns, as if refused.
      const text = refuseCall(this.state, this.battleDeps());
      this.ledgerNote(text, "steward");
    }
    healPersonalFully(this.state);
    const effects: SeasonEffectLine[] = [];
    effects.push(...tickWounds(this.state, createRng(seedFromString(`wounds:${this.state.meta.year}:${this.state.meta.season}:${this.state.meta.turn}`))));
    const lapsing = this.pending.filter((p) => p.status === "pending" || p.status === "withheld");
    this.pending = this.pending.map((p) =>
      p.status === "pending" || p.status === "withheld"
        ? { ...p, status: "rejected" as const, rejectReason: p.status === "withheld" ? p.rejectReason ?? "Season advanced" : "Season advanced" }
        : p,
    );
    this.askedAboutId = null;
    for (const npcId of new Set(lapsing.map((p) => p.npcId))) {
      releaseConfirmWantsTalk(this.state, npcId, this.pending);
    }

    const beforeSeason = cloneState(this.state);
    const ledgerBefore = snapshotSeasonLedger(beforeSeason);
    archiveEstateSeason(this.state, beforeSeason);
    effects.push(...resolveAgricultureAndProjects(this.state));
    effects.push(...tickMilitary(this.state));
    this.speakCompletedProjects(beforeSeason);
    this.speakHuntReturns();
    syncTradeFromFeatures(this.state);
    const incoming = nextSeason(this.state.meta.year, this.state.meta.season);
    // The dated calendar (03_HISTORY §5): what fires at the start of the incoming season.
    const history = runHistorySeasonPass(this.state, incoming, this.state.meta.turn + 1);
    for (const line of history.effects) effects.push({ kind: "info", text: line });
    for (const id of history.fired) this.log("engine", "EVENT", `History: ${id} delivered.`);
    const roll = rollSeasonEvents(this.state, { suppressOther: history.suppressOther, forcedWeatherId: history.forcedWeatherId, forcedSeverity: history.forcedSeverity });
    const merchantResult = rollMerchantVisit(this.state, incoming.season);
    const merchantNote = applyMerchantRoll(this.state, merchantResult);
    effects.push({ kind: "info", text: merchantNote });
    this.log("engine", "EVENT", merchantNote);
    const rolled: RolledEvent[] = [roll.weather, ...(roll.other ? [roll.other] : [])];
    for (const ev of rolled) {
      effects.push({ kind: "event", text: ev.resolvedText });
      this.log("referee", "EVENT", `${ev.id}: ${ev.resolvedText}`);
    }
    const call = raiseBattleCall(this.state, rolled.map((e) => e.id));
    if (call) {
      effects.push({ kind: "info", text: `A call to arms: ${call.text}` });
      this.log("engine", "EVENT", `Call to arms raised (${call.kind}).`);
    }

    const engineLines = [...effects.map((e) => e.text), ...history.refereeLines];
    const hireNote = hireRecommendationNote(newlyUnlockedHires(beforeSeason, this.state));
    try {
      const parsed = await this.callLlm(
        [
          { role: "system", content: refereeSystemPrompt() },
          {
            role: "user",
            content: seasonUserPrompt(
              this.state,
              rolled.map((e) => ({ id: e.id, resolvedText: e.resolvedText, polarity: e.polarity, category: e.category })),
              engineLines,
              merchantNote,
              hireNote,
              diffSeasonLedger(ledgerBefore, this.state),
            ),
          },
        ],
        SEASON_TOKENS,
        {
          purpose: "season report",
          requireProposals: true,
          repairHint:
            "Each rolled event MUST have an event_effect that changes numbers (resource+amount+direction, moodDelta, or nested proposals). Flavour-only event_effect is not enough.",
        },
      );
      this.applySeasonProposals(parsed.proposals, rolled, effects);
      this.noteFeastCooling(effects);
      tickPeopleHappinessFromSeason(
        this.state,
        effects.map((e) => e.text),
        rolled,
      );
      this.resolveHappinessMovement(effects);

      const clock = finishSeasonClock(this.state);
      effects.push(...clock);
      writeLastSeasonDeltas(this.state, ledgerBefore);
      this.log("engine", "SEASON", `Now ${this.state.meta.season} ${this.state.meta.year}`);
      if (parsed.emotion) this.npcEmotions.steward = parsed.emotion;
      this.messages.push({
        id: newId("msg"),
        role: "npc",
        npcId: "steward",
        npcName: this.npcName("steward"),
        text: parsed.speech,
        chronicle: parsed.chronicle,
        emotion: parsed.emotion ?? this.npcEmotions.steward,
        at: new Date().toISOString(),
      });
      this.flushHireRecommendations(newlyUnlockedHires(beforeSeason, this.state));
      this.pushSeasonLedger(effects, parsed.parseErrors);
      this.sceneNpcId = "steward";
      dismissNewsWantsTalk(this.state, "steward", this.pending);
      this.postHistoryBeats(history.beats);
      if (history.died) await this.writeEnding();
      await this.refreshCredits();
      return { ...this.view(), effects };
    } catch (err) {
      for (const ev of rolled) this.applyEventStub(ev, effects, "The usual change");
      this.noteFeastCooling(effects);
      tickPeopleHappinessFromSeason(
        this.state,
        effects.map((e) => e.text),
        rolled,
      );
      this.resolveHappinessMovement(effects);
      effects.push(...finishSeasonClock(this.state));
      writeLastSeasonDeltas(this.state, ledgerBefore);
      if (isHoldAtOnceFailure(err)) {
        this.pushHoldAtOnceApology("steward");
      } else {
        this.messages.push({
          id: newId("msg"),
          role: "system",
          npcId: "steward",
          text: "The season turned on the estate's own figures. The chronicler could not be heard.",
          chronicle: effects.map((e) => e.text).join("\n"),
          at: new Date().toISOString(),
        });
      }
      this.flushHireRecommendations(newlyUnlockedHires(beforeSeason, this.state));
      this.pushSeasonLedger(effects);
      this.sceneNpcId = "steward";
      dismissNewsWantsTalk(this.state, "steward", this.pending);
      this.postHistoryBeats(history.beats);
      if (history.died) await this.writeEnding();
      await this.refreshCredits();
      return { ...this.view(), effects };
    }
  }

  /**
   * The closing page (03_HISTORY §13): the death, then the life, written by the
   * model from the record. Written once; the chronicle entry stands in when the
   * model cannot be heard. Also called by the hall for a death in the field.
   */
  async writeEnding(): Promise<GameView> {
    if (!this.state.history.dead) {
      if (this.state.player.dead) markDeath(this.state, "battle");
      else if (this.state.player.captive) markDeath(this.state, "captivity");
      else return this.view();
    }
    if (this.state.history.ending) return this.view();
    const fallback = endingFallback(this.state);
    const voice = endingVoice(this.state);
    this.state.history.ending = { death: fallback.death, summary: fallback.summary, voice, byModel: false };
    try {
      const parsed = await this.callLlm(
        [
          { role: "system", content: endingSystemPrompt() },
          { role: "user", content: endingUserPrompt(this.state) },
        ],
        ENDING_TOKENS,
        { purpose: "the last page", allowRepair: false },
      );
      const text = parsed.speech.trim();
      const gap = text.search(/\n\s*\n/);
      if (text.length > 200) {
        this.state.history.ending = gap > 0 ? { death: text.slice(0, gap).trim(), summary: text.slice(gap).trim(), voice, byModel: true } : { death: fallback.death, summary: text, voice, byModel: true };
      }
    } catch (err) {
      this.log("engine", "EVENT", `The last page could not be written by the model: ${(err as Error).message}`);
    }
    this.log("engine", "SEASON", `The chronicle closes: ${this.state.history.dead?.cause} in ${this.state.history.dead?.year}.`);
    this.finishPlay(`The lord died (${this.state.history.dead?.cause}). This play is over.`);
    return this.view();
  }

  /** Verbatim calendar lines land on their speaker's tab; the tab badge says there is news. */
  postHistoryBeats(beats: HistoryBeat[]) {
    for (const beat of beats) {
      if (!this.state.npcs.some((n) => n.id === beat.npcId)) continue;
      this.messages.push({
        id: newId("msg"),
        role: "npc",
        npcId: beat.npcId,
        npcName: this.npcName(beat.npcId),
        text: beat.text,
        emotion: beat.emotion ?? this.npcEmotions[beat.npcId] ?? "neutral",
        at: new Date().toISOString(),
      });
      if (beat.npcId !== this.sceneNpcId) setNpcWantsTalk(this.state, beat.npcId, true);
      this.log(beat.npcId, "EVENT", `${beat.eventId}: ${beat.text.slice(0, 120)}`);
    }
  }

  /** Dev and tests: run the calendar forward to a season without playing it. Events on the way are dropped, not delivered. */
  historyJumpTo(year: number, season: WorldState["meta"]["season"]): GameView {
    this.state.meta.year = year;
    this.state.meta.season = season;
    this.state.meta.turn = Math.max(1, (year - 825) * 4 + ["spring", "summer", "autumn", "winter"].indexOf(season) + 1);
    return this.view();
  }

  /** Dev and tests: write registered flags directly. */
  historySetFlags(flags: Record<string, boolean | number | string>): GameView {
    for (const [id, value] of Object.entries(flags)) {
      const err = applyFlagOp(this.state, id, value);
      if (err) throw new Error(err);
    }
    return this.view();
  }

  private noteFeastCooling(effects: SeasonEffectLine[]) {
    const faded = fadeSponsoredFeastJoy(this.state);
    if (faded > 0) {
      effects.push({
        kind: "info",
        text: "The feast's first gladness cools; half of it remains with the people.",
      });
    }
  }

  private resolveHappinessMovement(effects: SeasonEffectLine[]) {
    const movement = resolvePeopleMovement(this.state);
    if (movement.departureNote) effects.push({ kind: "info", text: movement.departureNote });
    if (movement.gameOverNote) {
      effects.push({ kind: "info", text: movement.gameOverNote });
      this.finishPlay("The estate was abandoned. This play is over.");
    }
    if (movement.arrivalNote) effects.push({ kind: "info", text: movement.arrivalNote });
    if (
      movement.arrival &&
      !this.state.estateAbandoned &&
      !this.pending.some((p) => p.status === "pending" && p.proposal.type === "settle_households")
    ) {
      this.queueProposal("steward", movement.arrival);
    }
  }

  /** Testable: referee JSON → auto-applied event effects + stubs for anything without numbers. */
  applySeasonProposals(proposals: MechanicalProposal[], rolled: RolledEvent[], effects: SeasonEffectLine[]) {
    const covered = new Set<string>();
    for (const raw of proposals.map(ensureSummary)) {
      const p = stripSeasonHires(raw, effects);
      if (!p) continue;
      if (p.type !== "event_effect") {
        const wrapped: MechanicalProposal = {
          type: "event_effect",
          eventId: rolled[0]?.id ?? "season",
          summary: p.summary,
          nested: [p],
        };
        const r = applyProposal(this.state, wrapped, "referee");
        this.state = r.state;
        effects.push({
          kind: r.ok ? "apply" : "reject",
          text: r.ok ? playerFacingLogLine(r.logLine) : playerFacingReason(r.reason ?? r.logLine),
        });
        this.log("referee", r.ok ? "APPLY" : "REJECT", r.logLine);
        if (!r.ok) this.playLog.note("Refusal", `A season change was refused.\n\n${JSON.stringify(p, null, 2)}\n\nReason: ${r.reason ?? r.logLine}`);
        continue;
      }
      if (!eventEffectHasMechanics(p)) {
        effects.push({ kind: "info", text: "The season's tale had no figures; I have written the usual change." });
        continue;
      }
      covered.add(p.eventId);
      const r = applyProposal(this.state, p, "referee");
      this.state = r.state;
      effects.push({
        kind: r.ok ? "apply" : "reject",
        text: r.ok ? playerFacingLogLine(r.logLine) : playerFacingReason(r.reason ?? r.logLine),
      });
      this.log("referee", r.ok ? "APPLY" : "REJECT", r.logLine);
      if (!r.ok) this.playLog.note("Refusal", `A season change was refused.\n\n${JSON.stringify(p, null, 2)}\n\nReason: ${r.reason ?? r.logLine}`);
    }
    for (const ev of rolled) {
      if (covered.has(ev.id)) continue;
      this.applyEventStub(ev, effects, "The usual change");
    }
  }

  private speakCompletedProjects(before: WorldState) {
    for (const beat of completedProjectBeats(before, this.state)) {
      this.npcEmotions[beat.npcId] = "pleased";
      this.messages.push({
        id: newId("msg"),
        role: "npc",
        npcId: beat.npcId,
        npcName: this.npcName(beat.npcId),
        text: beat.text,
        emotion: "pleased",
        at: new Date().toISOString(),
      });
    }
  }

  private speakHuntReturns() {
    for (const report of pendingHuntReports(this.state)) {
      this.npcEmotions[NEGOTIATOR_ID] = report.emotion;
      this.messages.push({
        id: newId("msg"),
        role: "npc",
        npcId: NEGOTIATOR_ID,
        npcName: this.npcName(NEGOTIATOR_ID),
        text: report.text,
        emotion: report.emotion,
        at: new Date().toISOString(),
      });
    }
  }

  private applyEventStub(ev: RolledEvent, effects: SeasonEffectLine[], label: string) {
    const stub = defaultEventStub(ev, this.state);
    const r = applyProposal(
      this.state,
      {
        type: "event_effect",
        eventId: ev.id,
        summary: ev.resolvedText || "A season's change",
        resource: stub.resource,
        amount: stub.amount,
        direction: stub.direction,
        moodDelta: stub.moodDelta,
      },
      "referee",
    );
    this.state = r.state;
    const text = r.ok ? playerFacingLogLine(r.logLine) : playerFacingReason(r.reason ?? r.logLine);
    effects.push({ kind: r.ok ? "apply" : "reject", text: label ? `${label}. ${text}` : text });
    this.log("referee", r.ok ? "APPLY" : "REJECT", r.logLine);
  }

  private pushSeasonLedger(effects: SeasonEffectLine[], _parseErrors?: string[]) {
    const lines = effects
      .filter((e) => e.kind === "apply" || e.kind === "info" || e.kind === "event")
      .map((e) => playerFacingLogLine(e.text));
    this.ledgerNote(`Season written to the books:\n${lines.join("\n")}`, "steward");
  }

  private async callLlm(
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    maxTokens: number,
    opts?: { requireProposals?: boolean; repairHint?: string; allowRepair?: boolean; purpose?: string },
  ): Promise<{
    speech: string;
    chronicle?: string;
    proposals: MechanicalProposal[];
    raw: string;
    emotion?: AldricEmotion;
    parseErrors: string[];
    /** Hidden speech-pass tag: the model's own judgement that the ledger should change. */
    books?: boolean;
  }> {
    const purpose = opts?.purpose ?? "dialogue";
    const first = await this.llmParsedWithRetry(messages, { maxTokens, purpose });
    const raw1 = first.raw;
    let parsed = first.parsed;
    if (parsed.incomplete) {
      throw new Error(INCOMPLETE_MODEL_JSON);
    }
    const allowRepair = opts?.allowRepair !== false;
    const needsRepair =
      allowRepair &&
      ((parsed.parseErrors.length > 0 && parsed.proposals.length === 0) ||
        (Boolean(opts?.requireProposals) && parsed.proposals.length === 0));
    if (needsRepair) {
      const errors = parsed.parseErrors.length
        ? parsed.parseErrors
        : ["proposals was empty but this turn must change the ledger."];
      const second = await this.llmParsedWithRetry(
        [...messages, { role: "assistant", content: raw1 }, repairPrompt(raw1, errors, opts?.repairHint)],
        {
          maxTokens,
          temperature: 0.2,
          purpose: `${purpose} repair`,
        },
      );
      const raw2 = second.raw;
      parsed = second.parsed;
      if (parsed.incomplete) {
        throw new Error(INCOMPLETE_MODEL_JSON);
      }
      const speech = playerFacingNpcSpeech(raw2, parsed.response.speech);
      const proposals = parsed.proposals.map(ensureSummary);
      this.noteParsedReply(proposals, parsed.parseErrors, speech);
      return {
        speech,
        chronicle: parsed.response.chronicle,
        proposals,
        raw: raw2,
        emotion: parsed.emotion,
        parseErrors: parsed.parseErrors,
        books: parsed.books,
      };
    }
    const speech = playerFacingNpcSpeech(raw1, parsed.response.speech);
    const proposals = parsed.proposals.map(ensureSummary);
    this.noteParsedReply(proposals, parsed.parseErrors, speech);
    return {
      speech,
      chronicle: parsed.response.chronicle,
      proposals,
      raw: raw1,
      emotion: parsed.emotion,
      parseErrors: parsed.parseErrors,
      books: parsed.books,
    };
  }

  /** Seal this play's machinery file. A second call leaves the file as it is. */
  finishPlay(reason: string): string {
    return this.playLog.finish(reason);
  }

  private noteParsedReply(proposals: MechanicalProposal[], parseErrors: string[], hallSpeech: string) {
    const lines = [
      "Proposals the books took from that reply:",
      proposals.length ? JSON.stringify(proposals, null, 2) : "(none)",
      "",
      "Parse notes and dropped proposals:",
      parseErrors.length ? parseErrors.join("\n") : "(none)",
      "",
      "Speech the hall was allowed to show:",
      hallSpeech || "(none)",
    ];
    this.playLog.note("What the books made of that reply", lines.join("\n"));
  }

  /**
   * One model call, parsed. If the provider cut the reply at the token cap, or
   * the JSON never closed, ask once more with twice the budget before giving up.
   * A real network failure or timeout is not retried.
   */
  private async llmParsedWithRetry(
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    opts: { maxTokens: number; temperature?: number; purpose: string },
  ): Promise<{ raw: string; parsed: ReturnType<typeof parseLlmResponse> }> {
    const attempt = async (maxTokens: number, purpose: string) => {
      let raw = "";
      let truncated = false;
      try {
        const done = await this.llmCall(messages, { ...opts, maxTokens, purpose });
        raw = done.content;
        truncated = done.truncated;
      } catch (err) {
        if (!isTruncationError(err)) throw err;
        truncated = true;
      }
      const parsed = parseLlmResponse(raw);
      return { raw, parsed, cut: truncated || Boolean(parsed.incomplete) };
    };
    let result = await attempt(opts.maxTokens, opts.purpose);
    if (result.cut) {
      const larger = opts.maxTokens * 2;
      this.playLog.note(
        `Reply cut short (${opts.purpose})`,
        `The model's reply ended before it was whole: it ran out of tokens, or its JSON never closed. Asking once more with a budget of ${larger} tokens.`,
      );
      result = await attempt(larger, `${opts.purpose}, larger budget`);
    }
    return { raw: result.raw, parsed: result.parsed };
  }

  /** Reply text only; battle narration and other callers that do not parse the contract. */
  private async llmRaw(
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    opts?: { maxTokens?: number; temperature?: number; purpose?: string },
  ): Promise<string> {
    const done = await this.llmCall(messages, opts);
    return done.content;
  }

  /** One model call, written to the play log with its finish reason, token counts, and timing. */
  private async llmCall(
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    opts?: { maxTokens?: number; temperature?: number; purpose?: string },
  ): Promise<{ content: string; truncated: boolean; finishReason?: string }> {
    const purpose = opts?.purpose ?? "model";
    const config = activeConfig(this.settings);
    const started = Date.now();
    try {
      const content = await llm.llmChat(this.settings, messages, opts);
      const reasoning = takeLastReasoning();
      const done = takeLastCompletion();
      const elapsedMs = done?.elapsedMs ?? Date.now() - started;
      this.playLog.recordModel({
        purpose,
        provider: this.settings.provider,
        model: config.model,
        messages,
        content,
        reasoning,
        finishReason: done?.finishReason,
        usage: done?.usage,
        elapsedMs,
        maxTokens: opts?.maxTokens,
      });
      return { content, truncated: Boolean(done?.truncated), finishReason: done?.finishReason };
    } catch (err) {
      const systems = messages.filter((m) => m.role === "system").map((m) => m.content);
      const elapsedMs = err instanceof LlmTimeoutError ? err.elapsedMs : Date.now() - started;
      const partial = err instanceof LlmTimeoutError ? err.partialContent : "";
      this.playLog.note(
        `Model call failed (${purpose})`,
        [
          `Provider: ${this.settings.provider}`,
          `Model: ${config.model || "(none selected)"}`,
          `Elapsed: ${(elapsedMs / 1000).toFixed(1)}s`,
          `Token budget: ${opts?.maxTokens ?? "(adapter default)"}`,
          "",
          "System information given to the model",
          systems.join("\n\n") || "(none)",
          "",
          `Error: ${err instanceof Error ? err.message : String(err)}`,
          ...(partial ? ["", "Partial text that had arrived before the cut:", partial] : []),
        ].join("\n"),
      );
      throw err;
    } finally {
      this.noteLlmUsage();
    }
  }
}

/** Full store stays on the controller; the view only shows the active scene. */
export function messagesForScene(messages: ChatMessage[], sceneNpcId: string): ChatMessage[] {
  return messages.filter((m) => m.npcId === sceneNpcId);
}

/** This speaker's own recent lines, not the line the lord just sent, and not anyone else's talk. */
function earlierTalkForSpeaker(
  messages: ChatMessage[],
  npcId: string,
  npcName: string,
  currentPlayerText: string,
): string {
  const lines = messages.filter((m) => m.npcId === npcId && (m.role === "player" || m.role === "npc"));
  const prior = [...lines];
  const last = prior[prior.length - 1];
  if (last?.role === "player" && last.text === currentPlayerText) prior.pop();
  return earlierTalkBlock(
    prior.map((m) => ({
      speaker: m.role === "player" ? "The lord" : m.npcName || npcName,
      text: m.text,
    })),
  );
}

function ensureSummary(p: MechanicalProposal): MechanicalProposal {
  if (p.summary) return p;
  return { ...p, summary: p.type };
}

const REGISTER_TYPES = new Set(["register_resource", "register_feature", "register_npc"]);

/** start_project and register_* first so assign_labour can resolve the new work. */
export function sortPendingForApply<T extends { proposal: { type: string } }>(items: T[]): T[] {
  const rank = (type: string) => {
    if (type === "start_project") return 0;
    if (REGISTER_TYPES.has(type)) return 1;
    if (type === "assign_labour" || type === "adjust_project") return 3;
    return 2;
  };
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const diff = rank(a.item.proposal.type) - rank(b.item.proposal.type);
      return diff !== 0 ? diff : a.index - b.index;
    })
    .map((row) => row.item);
}

function fillProposalDefaults(state: WorldState, p: MechanicalProposal): MechanicalProposal {
  if (p.type === "defer_proposal") {
    const inner = fillProposalDefaults(state, p.proposal) as typeof p.proposal;
    return { ...p, proposal: inner };
  }
  if ((p.type === "start_project" || p.type === "adjust_sowing") && !p.holdingId) {
    return { ...p, holdingId: state.holdings[0]?.id };
  }
  if ((p.type === "assign_labour" || p.type === "adjust_project") && p.projectId !== "unassigned") {
    const resolved = resolveActiveProject(state, p.projectId, p.summary);
    if (resolved) return { ...p, projectId: resolved.id };
  }
  if (p.type === "register_npc") {
    const spec = matchHireableSpecialist(p.npc);
    if (spec) {
      return {
        ...p,
        npc: specialistNpc(spec, p.npc.location || state.holdings[0]?.id || "fontenay"),
        summary: p.summary && p.summary !== p.type ? p.summary : hireSummary(spec),
      };
    }
  }
  if (p.type === "start_hunt") {
    return normalizeHuntProposal(state, p);
  }
  return p;
}

function isSpecialistHireProposal(p: MechanicalProposal | unknown): boolean {
  if (!p || typeof p !== "object") return false;
  const rec = p as { type?: string; npc?: { id?: string; name?: string; role?: string } };
  return rec.type === "register_npc" && Boolean(matchHireableSpecialist(rec.npc ?? {}));
}

function isSettleHouseholdsProposal(p: MechanicalProposal | unknown): boolean {
  return Boolean(p && typeof p === "object" && (p as { type?: string }).type === "settle_households");
}

function stripSeasonHires(p: MechanicalProposal, effects: SeasonEffectLine[]): MechanicalProposal | null {
  if (p.type === "settle_households") {
    effects.push({
      kind: "info",
      text: "Taking a household onto the demesne waits on Confirm.",
    });
    return null;
  }
  if (isSpecialistHireProposal(p)) {
    effects.push({
      kind: "info",
      text: "Hiring waits on Confirm with Aldric; the season report cannot take a person into the household.",
    });
    return null;
  }
  if (p.type === "event_effect" && p.nested?.some((n) => isSpecialistHireProposal(n) || isSettleHouseholdsProposal(n))) {
    const nested = p.nested.filter((n) => !isSpecialistHireProposal(n) && !isSettleHouseholdsProposal(n));
    if (p.nested.some(isSpecialistHireProposal)) {
      effects.push({
        kind: "info",
        text: "Hiring waits on Confirm with Aldric; the season report cannot take a person into the household.",
      });
    }
    if (p.nested.some(isSettleHouseholdsProposal)) {
      effects.push({
        kind: "info",
        text: "Taking a household onto the demesne waits on Confirm.",
      });
    }
    return { ...p, nested };
  }
  return p;
}

function hireRecommendationNote(fresh: ReturnType<typeof newlyUnlockedHires>): string | undefined {
  if (!fresh.length) return undefined;
  const names = fresh.map((s) => `${s.name} the ${s.role.replaceAll("_", " ")}`).join("; ");
  return `HIRE RECOMMENDATION (speech only; do NOT emit register_npc): ${names}. The lord must ask Aldric and Confirm.`;
}

function dropHireFeeDuplicates(proposals: MechanicalProposal[]): MechanicalProposal[] {
  const hires = proposals.filter((p) => p.type === "register_npc" && matchHireableSpecialist(p.npc));
  if (!hires.length) return proposals;
  const grainHire = hires.some((p) => {
    if (p.type !== "register_npc") return false;
    const spec = matchHireableSpecialist(p.npc);
    return Boolean(spec && specialistHireGrainRation(spec) > 0);
  });
  return proposals.filter((p) => {
    if (
      p.type === "transfer_resources" &&
      p.resource === "denarii" &&
      (p.direction === "consume" || p.direction === "buy")
    ) {
      return false;
    }
    if (
      grainHire &&
      p.type === "transfer_resources" &&
      (p.resource === "rye" || p.resource === "wheat" || p.resource === "barley" || p.resource === "oats") &&
      p.direction === "consume"
    ) {
      return false;
    }
    return true;
  });
}

function dropHuntFeeDuplicates(proposals: MechanicalProposal[]): MechanicalProposal[] {
  if (!proposals.some((p) => p.type === "start_hunt")) return proposals;
  return proposals.filter((p) => {
    if (
      p.type === "transfer_resources" &&
      p.resource === "denarii" &&
      (p.direction === "consume" || p.direction === "buy")
    ) {
      return false;
    }
    return true;
  });
}

function openingSpeech(state: WorldState): string {
  const h = state.holdings[0];
  const land = h?.land;
  const features = h?.features ?? [];
  const overgrown = (land?.scrub ?? 0) + (land?.waste ?? 0) + (land?.swamp ?? 0);
  const sownCap = sownCapacity(land?.fertile_arable ?? 0, fieldRotation(state));
  const sownNow = h ? h.sown.wheat + h.sown.rye + h.sown.barley + h.sown.oats : 0;
  const sowing =
    sownNow + 0.05 < sownCap
      ? "Wheat and rye already stand from last autumn's sowing, though the sown share is not full."
      : "Wheat and rye already stand from last autumn's sowing.";
  const forge = features.some((f) => f === "forge" || f === "mill_forge" || f === "bloomery")
    ? ` Bernard keeps a forge, but charcoal is down to ${state.resources.charcoal} cart-load${state.resources.charcoal === 1 ? "" : "s"} and iron to ${state.resources.iron} pounds.`
    : "";
  const church = features.includes("monastery")
    ? " A small cell of Saint-Martin stands by the hall — four monks and an oratory — and Father Ermenald serves as your chaplain."
    : features.includes("chapel")
      ? " Father Ermenald serves as your chaplain at a small timber oratory. There is no monastic house on the villa."
      : "";
  return `My lord. It is ${state.meta.season} in the year ${state.meta.year}, at ${state.meta.region}. The villa holds ${land?.fertile_arable ?? 0} acres of arable — and ${overgrown} acres of scrub, waste, and swamp beside it, still yours to clear — ${state.population.households} households, and ${state.resources.denarii} denarii in the chest. ${sowing} The hall is timber, and tired; the barn beside it is sound enough.${forge}${church} I am Aldric, your steward. Say how you would have the land kept, or I will keep it as custom requires. When you wish the season to turn, give the word.`;
}

export function snapshotState(controller: GameController): WorldState {
  return cloneState(controller.state);
}
