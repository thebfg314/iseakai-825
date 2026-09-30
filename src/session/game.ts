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
  earlierTalkBlock,
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
      earlierTalkForSpeaker(this.messages, npcId, this.npcName(npcId), playerText),
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
            this.pushNpcSpeech(npcId, answer);
            this.ingestParsedDialogue(npcId, books, playerText, difficulty, judged);
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
