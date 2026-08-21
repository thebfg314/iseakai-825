import { LlmResponseSchema, MechanicalProposalSchema, type LlmResponse, type MechanicalProposal } from "../engine/schema";
import { stripEmotionCommands, normalizeEmotion, type AldricEmotion } from "../engine/emotion";

export function extractJsonObject(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

export function parseLlmResponse(raw: string): {
  response: LlmResponse;
  proposals: MechanicalProposal[];
  parseErrors: string[];
  emotion?: AldricEmotion;
} {
  const jsonText = extractJsonObject(raw);
  const parseErrors: string[] = [];
  if (!jsonText) {
    const stripped = stripEmotionCommands(raw.trim() || "(The steward is silent.)");
    return {
      response: { speech: stripped.speech, proposals: [] },
      proposals: [],
      parseErrors: ["No JSON object in model output."],
      emotion: stripped.emotion,
    };
  }
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch (err) {
    const stripped = stripEmotionCommands(raw.trim());
    return {
      response: { speech: stripped.speech, proposals: [] },
      proposals: [],
      parseErrors: [`JSON.parse failed: ${(err as Error).message}`],
      emotion: stripped.emotion,
    };
  }
  const wrapped = LlmResponseSchema.safeParse(data);
  if (!wrapped.success) {
    const obj = data as { speech?: unknown; chronicle?: unknown; emotion?: unknown; proposals?: unknown };
    const speech = typeof obj.speech === "string" ? obj.speech : raw.trim();
    const stripped = stripEmotionCommands(speech);
    return {
      response: { speech: stripped.speech, chronicle: typeof obj.chronicle === "string" ? obj.chronicle : undefined, proposals: [] },
      proposals: [],
      parseErrors: wrapped.error.issues.map((i) => i.message),
      emotion: stripped.emotion ?? normalizeEmotion(typeof obj.emotion === "string" ? obj.emotion : undefined),
    };
  }
  const proposals: MechanicalProposal[] = [];
  for (const item of wrapped.data.proposals) {
    const parsed = MechanicalProposalSchema.safeParse(item);
    if (parsed.success) proposals.push(parsed.data);
    else parseErrors.push(`Dropped proposal: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  }
  const stripped = stripEmotionCommands(wrapped.data.speech);
  return {
    response: { ...wrapped.data, speech: stripped.speech },
    proposals,
    parseErrors,
    emotion: stripped.emotion ?? normalizeEmotion(wrapped.data.emotion),
  };
}
