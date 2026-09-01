import type { ChatMessage, PendingProposal, SeasonEffectLine, WorldState } from "../engine/schema";
import type { LlmMeter } from "../llm/usage";

export type LabourView = { men: number; women: number; youths: number };

export type GameView = {
  state: WorldState;
  pending: PendingProposal[];
  messages: ChatMessage[];
  sceneNpcId: string;
  labour: { pool: LabourView; remaining: LabourView };
  smithAvailable: boolean;
  chaplainAvailable: boolean;
  merchantAvailable: boolean;
  sceneEmotion: string;
  historyTail: string[];
  llmMeter: LlmMeter;
};

export type DialogueResult = GameView & { error?: string };
export type SeasonResult = GameView & { effects: SeasonEffectLine[]; error?: string };
