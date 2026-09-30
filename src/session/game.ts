import type { ChatMessage, MechanicalProposal, PendingProposal, SeasonEffectLine, WorldState } from "../engine/schema";
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
import { llmChat, type AppSettings } from "../llm";
import { fetchProviderBalance } from "../llm/credits";
import { consumeLastLlmCall, LlmMeterStore } from "../llm/usage";
import {
  npcBooksFollowUp,
  npcFactsFollowUp,
  npcUserPrompt,
  npcSystemPrompt,
  refereeSystemPrompt,
  repairPrompt,
  seasonUserPrompt,
  SPEECH_PASS_HINT,
} from "../llm/prompts";
import {
  collectDrawers,
  holdingLineForDrawers,
  missingCitedDrawers,
  parseToolRequest,
  stripToolMarkers,
  type ToolDrawer,
} from "../llm/toolProtocol";
import {
  booksHearFailureLine,
  HOLD_AT_ONCE_APOLOGY,
  INCOMPLETE_MODEL_JSON,
  isHoldAtOnceFailure,
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
  BERNARD_BLOOMERY_SUGGESTION,
  BERNARD_BOG_ORE_SPEECH,
  asksAboutBogOre,
  bloomeryNotReadyReason,
  bloomeryStartProposal,
  bloomerySuggestReady,
  isBloomeryStart,
} from "../engine/bloomery";
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
  /** In-memory: Bernard has already put a bloomery on the table this session. */
  bloomerySuggested = false;
  /** Pending card the lord asked about; next talk with that NPC can revise it. */
  askedAboutId: string | null = null;
  npcEmotions: Record<string, AldricEmotion> = {
    steward: "respectful",
    smith: "neutral",
    chaplain: "neutral",
    negotiator: "neutral",
  };
  meter = new LlmMeterStore("rfab");

  constructor(state: WorldState, saveDir: string, settings: AppSettings, opts?: { resetUsage?: boolean }) {
    this.state = state;
    this.saveDir = saveDir;
    this.settings = settings;
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
      npcId === "merchant"
        ? "You are visiting only this season. Request the merchant drawer if you need cart stock. Buy only from that stock. Sell any estate resource except denarii."
        : undefined,
      discussed ? pendingOfferScrap(discussed.proposal) : undefined,
    ].filter(Boolean);
    const extra = extraBits.length ? extraBits.join("\n\n") : undefined;
    const scrapUser = npcUserPrompt(this.state, npcId, playerText, extra);
    const order = looksLikeMechanicalOrder(playerText, npcId) || Boolean(discussed) || huntAsk;
    try {
      const spoken = await this.callLlm(
        [{ role: "system", content: speechSystem }, { role: "user", content: `${scrapUser}\n\n${SPEECH_PASS_HINT}` }],
        800,
        { requireProposals: false, allowRepair: false },
      );

      const tool = parseToolRequest(spoken.raw);
      if (tool.malformed) {
        throw new Error(INCOMPLETE_MODEL_JSON);
      }

      let fetched: ToolDrawer[] = [];
      let drawers: Record<string, unknown> | undefined;
      let answer = spoken;

      if (tool.requested) {
        this.pushHoldingLine(npcId, tool.drawers);
        fetched = tool.drawers;
        drawers = collectDrawers(this.state, fetched, npcId);
        try {
          answer = await this.callLlm(
            [
              { role: "system", content: speechSystem },
              { role: "user", content: scrapUser },
              { role: "assistant", content: spoken.raw },
              { role: "user", content: `${npcFactsFollowUp(playerText, drawers)}\n\n${SPEECH_PASS_HINT}` },
            ],
            800,
            { requireProposals: false, allowRepair: false },
          );
          if (parseToolRequest(answer.raw).malformed) {
            throw new Error(INCOMPLETE_MODEL_JSON);
          }
        } catch (err) {
          if (this.recoverHuntOffer(npcId, playerText)) return this.finishTalk();
          this.noteTalkFailure(err, npcId);
          return this.finishTalk();
        }
      }

      if (!order) {
        this.pushNpcSpeech(npcId, answer);
        return this.finishTalk();
      }

      try {
        const booksUser = npcUserPrompt(this.state, npcId, playerText, extra, drawers);
        const booksMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
          { role: "system", content: system },
          { role: "user", content: booksUser },
          { role: "assistant", content: answer.raw },
          { role: "user", content: npcBooksFollowUp(playerText, discussed ? compactOfferLine(discussed.proposal) : undefined) },
        ];
        let books = await this.callLlm(booksMessages, 900, {
          requireProposals: true,
          allowRepair: true,
          repairHint:
            "The lord gave an order that must change the ledger. proposals was empty or invalid. Emit at least one proposal (assign_labour, start_project, adjust_sowing, defer_proposal, transfer_resources, add_modifier, set_standing_order, register_npc, start_hunt, or sponsor_feast) with real numbers. If you promise the change after harvest or later, emit defer_proposal wrapping the inner change.",
        });

        const missing = missingCitedDrawers(books.proposals, fetched);
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
            900,
            { requireProposals: true, allowRepair: false },
          );
        }

        if (huntAsk) {
          const difficulty = this.resolvedHuntDifficulty(playerText, answer.speech, books.proposals);
          const req = extractHuntRequest(playerText);
          if (req && difficulty) {
            const brief = quoteHunt(this.state, { ...req, difficulty });
            if (this.state.resources.denarii < brief.quotedDenarii) {
              this.pushNpcSpeech(npcId, { speech: unaffordableHuntSpeech(brief), emotion: "concerned" });
              return this.finishTalk();
            }
            answer = { ...answer, speech: withComputedHuntPrice(answer.speech, brief) };
            for (const proposal of books.proposals) {
              if (proposal.type === "start_hunt") proposal.difficulty = difficulty;
            }
          }
          this.pushNpcSpeech(npcId, answer);
          this.ingestParsedDialogue(npcId, books, playerText, difficulty);
          return this.finishTalk();
        }

        this.pushNpcSpeech(npcId, answer);
        this.ingestParsedDialogue(npcId, books, playerText);
        return this.finishTalk();
      } catch (err) {
        if (this.recoverHuntOffer(npcId, playerText, answer)) return this.finishTalk();
        this.noteTalkFailure(err, npcId);
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
    const forced = huntProposalForAsk(this.state, playerText, spokenDifficulty);
    if (!forced?.length) {
      const why = huntFulfillReason(this.state, playerText, spokenDifficulty);
      if (!why) return false;
      this.pushNpcSpeech(npcId, { speech: why, emotion: "concerned" });
      return true;
    }
    const playerAt = this.messages.map((m) => m.role).lastIndexOf("player");
    const req = extractHuntRequest(playerText);
    const brief = req
      ? quoteHunt(this.state, { ...req, difficulty: resolveHuntDifficulty(req.resource, spokenDifficulty) })
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
    if (spoken.emotion && PORTRAIT_NPCS.has(npcId)) this.npcEmotions[npcId] = spoken.emotion;
    this.messages.push({
      id: newId("msg"),
      role: "npc",
      npcId,
      npcName: this.npcName(npcId),
      text: stripToolMarkers(spoken.speech),
      chronicle: spoken.chronicle,
      emotion: PORTRAIT_NPCS.has(npcId) ? spoken.emotion ?? this.npcEmotions[npcId] : undefined,
      at: new Date().toISOString(),
    });
    if (npcId === "steward") this.flushHireRecommendations();
  }

  /** Engine string in the NPC's mouth — never a Books line, never a model call. */
  private pushHoldingLine(npcId: string, drawers: readonly ToolDrawer[]) {
    if (PORTRAIT_NPCS.has(npcId)) this.npcEmotions[npcId] = "thoughtful";
    this.messages.push({
      id: newId("msg"),
      role: "npc",
      npcId,
      npcName: this.npcName(npcId),
      text: holdingLineForDrawers(drawers),
      emotion: PORTRAIT_NPCS.has(npcId) ? "thoughtful" : undefined,
      at: new Date().toISOString(),
    });
  }

  /** Engine string only — never call the model to apologize. */
  private noteTalkFailure(err: unknown, npcId: string) {
    if (isHoldAtOnceFailure(err)) {
      this.pushHoldAtOnceApology(npcId);
      return;
    }
    this.ledgerNote(booksHearFailureLine(this.npcName(npcId)), npcId);
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

  /** Testable: parse result → pending queue and ledger notes. Does not call the model. */
  ingestParsedDialogue(
    npcId: string,
    parsed: { proposals: MechanicalProposal[]; parseErrors: string[]; incomplete?: boolean },
    playerText: string,
    huntDifficulty?: HuntDifficulty,
  ) {
    if (parsed.incomplete) return;
    if (npcId === "steward") this.flushHireRecommendations();
    if (npcId === "smith") this.ensureBogOreSpeech(playerText);
    let proposals = dropHuntFeeDuplicates(dropHireFeeDuplicates(parsed.proposals.map(ensureSummary)));
    if (npcId === "smith") proposals = this.dropPrematureBloomery(proposals);
    let huntChoice: unknown;
    let huntSettled = false;
    if (isNegotiatorId(npcId)) {
      const modelHunt = proposals.find((p) => p.type === "start_hunt");
      huntChoice =
        huntDifficulty ?? (modelHunt?.type === "start_hunt" ? modelHunt.difficulty : undefined);
      const forced = huntProposalForAsk(this.state, playerText, huntChoice);
      if (forced !== null) {
        proposals = forced;
        huntSettled = true;
      } else {
        proposals = proposals
          .filter((p) => p.type === "start_hunt")
          .map((p) => (p.type === "start_hunt" ? normalizeHuntProposal(this.state, p) : p));
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
    if (npcId === "smith") {
      const suggested = this.bloomerySuggestionProposal(proposals);
      if (suggested) proposals = [...proposals, suggested];
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
    if (looksLikeMechanicalOrder(playerText, npcId)) {
      const why = cannotFulfillReason(this.state, npcId, playerText);
      this.ledgerNote(
        why
          ? `No change was set down. ${why}`
          : "They answered in speech only. The books are unchanged. Give a clear order — sow, begin a work, give stores, call hands, a blessing, hire a craftsman, or a forthcoming change after harvest — or advance the season.",
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

  /** Drop a bloomery the smith offered before charcoal and the chest allow it. */
  private dropPrematureBloomery(proposals: MechanicalProposal[]): MechanicalProposal[] {
    if (bloomerySuggestReady(this.state)) return proposals;
    let dropped = false;
    const kept = proposals.filter((p) => {
      if (!isBloomeryStart(p)) return true;
      dropped = true;
      return false;
    });
    if (dropped && kept.length) this.ledgerNote(bloomeryNotReadyReason(this.state) ?? "Not yet.", "smith");
    return kept;
  }

  /**
   * Once a session, when charcoal and the chest allow, Bernard puts the bloomery forward.
   * Returns the proposal for the caller to queue; does not write the books.
   */
  private bloomerySuggestionProposal(already: MechanicalProposal[]): MechanicalProposal | null {
    if (this.bloomerySuggested || !bloomerySuggestReady(this.state)) return null;
    if (already.some((p) => isBloomeryStart(p))) {
      this.bloomerySuggested = true;
      return null;
    }
    if (this.pending.some((p) => p.status === "pending" && isBloomeryStart(p.proposal))) {
      this.bloomerySuggested = true;
      return null;
    }
    this.bloomerySuggested = true;
    this.npcEmotions.smith = "pleased";
    this.messages.push({
      id: newId("msg"),
      role: "npc",
      npcId: "smith",
      npcName: this.npcName("smith"),
      text: BERNARD_BLOOMERY_SUGGESTION,
      emotion: "pleased",
      at: new Date().toISOString(),
    });
    return bloomeryStartProposal(this.state);
  }

  /** Season's end: the same offer, queued here because no talk is in flight. */
  private flushBloomerySuggestion() {
    const proposal = this.bloomerySuggestionProposal([]);
    if (proposal) this.queueProposal("smith", proposal);
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
    let error: string | undefined;
    for (const next of batch) {
      if (next.status !== "pending") continue;
      const dep = dependentStart(next, this.pending);
      if (dep && dep.status !== "pending" && dep.status !== "applied") {
        this.withholdFollowOns(dep, noted);
        if (errorOnId && next.id === errorOnId) error = next.rejectReason || dependentSkipLine(workLabelOf(dep));
        continue;
      }
      const result = this.applyOnePending(next);
      if (errorOnId && next.id === errorOnId && result.error) error = result.error;
      if (!result.ok && next.proposal.type === "start_project") this.withholdFollowOns(next, noted);
    }
    this.flushHireRecommendations(newlyUnlockedHires(before, this.state));
    this.flushBloomerySuggestion();
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
    if (this.askedAboutId === item.id) this.askedAboutId = null;
    if (result.ok) {
      recordConfirmedTransaction(this.state, item.npcId, item.proposal, logLine);
      this.flushHireRecommendations(newlyUnlockedHires(beforeNpc, this.state));
      this.flushBloomerySuggestion();
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
      chat: (messages, maxTokens) => this.llmRaw(messages, { maxTokens, temperature: 0.7 }),
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
    if (this.state.player.dead) this.ledgerNote("The lord of Fontenay is dead. The chronicle ends here.", "steward");
    else if (this.state.player.captive) this.ledgerNote("The ransom could not be met. The lord of Fontenay remains in his captors' hands; the chronicle ends here.", "steward");
    return this.view();
  }

  /** Eberhard's door and the test hook: raise a call to arms now. */
  raiseCall(kind: BattleCallKind): GameView & { error?: string } {
    if (this.state.battle_call || this.state.battle_session) return { ...this.view(), error: "A call is already open." };
    raiseCallDirect(this.state, kind);
    return this.view();
  }

  async advanceSeason(): Promise<SeasonResult> {
    if (estateIsAbandoned(this.state) || this.state.estateAbandoned) {
      markEstateAbandoned(this.state);
      return { ...this.view(), effects: [{ kind: "info", text: ABANDONED_GAME_OVER }] };
    }
    if (this.state.battle_session) {
      return { ...this.view(), effects: [], error: "The lord is in the field. The season cannot turn until the battle is done." };
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
    const roll = rollSeasonEvents(this.state);
    const incoming = nextSeason(this.state.meta.year, this.state.meta.season);
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

    const engineLines = effects.map((e) => e.text);
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
        2000,
        {
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
      this.flushBloomerySuggestion();
      this.pushSeasonLedger(effects, parsed.parseErrors);
      this.sceneNpcId = "steward";
      dismissNewsWantsTalk(this.state, "steward", this.pending);
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
      this.flushBloomerySuggestion();
      this.pushSeasonLedger(effects);
      this.sceneNpcId = "steward";
      dismissNewsWantsTalk(this.state, "steward", this.pending);
      await this.refreshCredits();
      return { ...this.view(), effects };
    }
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
    if (movement.gameOverNote) effects.push({ kind: "info", text: movement.gameOverNote });
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
    opts?: { requireProposals?: boolean; repairHint?: string; allowRepair?: boolean },
  ): Promise<{
    speech: string;
    chronicle?: string;
    proposals: MechanicalProposal[];
    raw: string;
    emotion?: AldricEmotion;
    parseErrors: string[];
  }> {
    const raw1 = await this.llmRaw(messages, { maxTokens });
    let parsed = parseLlmResponse(raw1);
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
      const raw2 = await this.llmRaw(
        [...messages, { role: "assistant", content: raw1 }, repairPrompt(raw1, errors, opts?.repairHint)],
        {
          maxTokens,
          temperature: 0.2,
        },
      );
      parsed = parseLlmResponse(raw2);
      if (parsed.incomplete) {
        throw new Error(INCOMPLETE_MODEL_JSON);
      }
      return {
        speech: playerFacingNpcSpeech(raw2, parsed.response.speech),
        chronicle: parsed.response.chronicle,
        proposals: parsed.proposals.map(ensureSummary),
        raw: raw2,
        emotion: parsed.emotion,
        parseErrors: parsed.parseErrors,
      };
    }
    return {
      speech: playerFacingNpcSpeech(raw1, parsed.response.speech),
      chronicle: parsed.response.chronicle,
      proposals: parsed.proposals.map(ensureSummary),
      raw: raw1,
      emotion: parsed.emotion,
      parseErrors: parsed.parseErrors,
    };
  }

  private async llmRaw(
    messages: { role: "system" | "user" | "assistant"; content: string }[],
    opts?: { maxTokens?: number; temperature?: number },
  ): Promise<string> {
    try {
      return await llmChat(this.settings, messages, opts);
    } finally {
      this.noteLlmUsage();
    }
  }
}

/** Full store stays on the controller; the view only shows the active scene. */
export function messagesForScene(messages: ChatMessage[], sceneNpcId: string): ChatMessage[] {
  return messages.filter((m) => m.npcId === sceneNpcId);
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
