import type { ChatMessage, PendingProposal, SeasonEffectLine, WorldState } from "../engine/schema";

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
};

export type DialogueResult = GameView & { error?: string };
export type SeasonResult = GameView & { effects: SeasonEffectLine[]; error?: string };
