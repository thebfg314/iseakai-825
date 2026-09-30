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
