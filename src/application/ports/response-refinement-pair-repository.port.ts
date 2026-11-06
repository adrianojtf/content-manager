export interface AppendResponseRefinementPairInput {
  readonly tenantId: string;
  readonly socialAccountId: string;
  readonly platform: string;
  readonly language: string;
  readonly aiText: string;
  readonly finalText: string;
  readonly aiProvider: string;
  readonly aiModel: string;
  readonly promptVersion: string | null;
  readonly aiConfidence: number;
  readonly aiRationale: string | null;
  readonly intendedTone: string;
  readonly toneProfile: Readonly<Record<string, unknown>>;
  readonly revisionCount: number;
  readonly lastEditReason: string | null;
  readonly evaluation: Readonly<Record<string, unknown>> | null;
  readonly analysisLabels: Readonly<Record<string, unknown>> | null;
  readonly manualReplyAttemptId: string;
  readonly recordedAt: string;
}

export interface AiResponseEditPair extends AppendResponseRefinementPairInput {
  readonly id: string;
}

export interface ResponseRefinementPairRepository {
  append(input: AppendResponseRefinementPairInput): Promise<AiResponseEditPair>;
}
