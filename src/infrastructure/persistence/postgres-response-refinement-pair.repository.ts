import { randomUUID } from 'node:crypto';
import type {
  AiResponseEditPair,
  AppendResponseRefinementPairInput,
  ResponseRefinementPairRepository,
} from '../../application/ports/response-refinement-pair-repository.port';
import type { RelationalDatabase } from '../../application/ports/relational-database.port';
import { ResponseRefinementPairError } from '../../application/social/response-refinement-pair-error';

interface AiResponseEditPairRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  social_account_id: string;
  platform: string;
  language: string;
  ai_text: string;
  final_text: string;
  ai_provider: string;
  ai_model: string;
  prompt_version: string | null;
  ai_confidence: number;
  ai_rationale: string | null;
  intended_tone: string;
  tone_profile_json: string;
  revision_count: number;
  last_edit_reason: string | null;
  evaluation_json: string | null;
  analysis_labels_json: string | null;
  manual_reply_attempt_id: string;
  recorded_at: Date | string;
}

export class PostgresResponseRefinementPairRepository implements ResponseRefinementPairRepository {
  constructor(private readonly database: RelationalDatabase) {}

  async append(input: AppendResponseRefinementPairInput): Promise<AiResponseEditPair> {
    if (!input.tenantId.trim() || !input.socialAccountId.trim() || !input.manualReplyAttemptId.trim()
      || !/^[0-9a-f-]{36}$/i.test(input.manualReplyAttemptId) || !this.isValidDate(input.recordedAt)
      || !Number.isInteger(input.revisionCount) || input.revisionCount < 0) {
      throw new ResponseRefinementPairError('RESPONSE_REFINEMENT_PAIR_INVALID');
    }
    const toneProfile = this.serializeJson(input.toneProfile);
    const evaluation = input.evaluation === null ? null : this.serializeJson(input.evaluation);
    const analysisLabels = input.analysisLabels === null ? null : this.serializeJson(input.analysisLabels);
    await this.database.query(
      `INSERT INTO ai_response_edit_pairs (
         id, tenant_id, social_account_id, platform, language, ai_text, final_text,
         ai_provider, ai_model, prompt_version, ai_confidence, ai_rationale, intended_tone, tone_profile_json,
         revision_count, last_edit_reason, evaluation_json, analysis_labels_json,
         manual_reply_attempt_id, recorded_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       ON CONFLICT (manual_reply_attempt_id) DO NOTHING`,
      [randomUUID(), input.tenantId, input.socialAccountId, input.platform, input.language,
        input.aiText, input.finalText, input.aiProvider, input.aiModel, input.promptVersion, input.aiConfidence,
        input.aiRationale, input.intendedTone, toneProfile, input.revisionCount, input.lastEditReason,
        evaluation, analysisLabels, input.manualReplyAttemptId, input.recordedAt],
    );
    const { rows } = await this.database.query<AiResponseEditPairRow>(
      `SELECT id, tenant_id, social_account_id, platform, language, ai_text, final_text,
              ai_provider, ai_model, prompt_version, ai_confidence, ai_rationale, intended_tone, tone_profile_json,
              revision_count, last_edit_reason, evaluation_json, analysis_labels_json,
              manual_reply_attempt_id, recorded_at
       FROM ai_response_edit_pairs WHERE manual_reply_attempt_id = $1`,
      [input.manualReplyAttemptId],
    );
    if (!rows.length) {
      throw new ResponseRefinementPairError('RESPONSE_REFINEMENT_PAIR_DATA_INVALID');
    }
    return this.restore(rows[0]);
  }

  private serializeJson(value: Readonly<Record<string, unknown>>): string {
    try {
      const serialized = JSON.stringify(value);
      if (!serialized || serialized === '{}') {
        throw new Error();
      }
      return serialized;
    } catch {
      throw new ResponseRefinementPairError('RESPONSE_REFINEMENT_PAIR_DATA_INVALID');
    }
  }

  private restore(row: AiResponseEditPairRow): AiResponseEditPair {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      socialAccountId: row.social_account_id,
      platform: row.platform,
      language: row.language,
      aiText: row.ai_text,
      finalText: row.final_text,
      aiProvider: row.ai_provider,
      aiModel: row.ai_model,
      promptVersion: row.prompt_version,
      aiConfidence: row.ai_confidence,
      aiRationale: row.ai_rationale,
      intendedTone: row.intended_tone,
      toneProfile: this.parseJson(row.tone_profile_json),
      revisionCount: row.revision_count,
      lastEditReason: row.last_edit_reason,
      evaluation: row.evaluation_json === null ? null : this.parseJson(row.evaluation_json),
      analysisLabels: row.analysis_labels_json === null ? null : this.parseJson(row.analysis_labels_json),
      manualReplyAttemptId: row.manual_reply_attempt_id,
      recordedAt: this.toIsoString(row.recorded_at),
    };
  }

  private parseJson(value: string): Record<string, unknown> {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      throw new ResponseRefinementPairError('RESPONSE_REFINEMENT_PAIR_DATA_INVALID');
    }
  }

  private isValidDate(value: string): boolean {
    return Number.isFinite(Date.parse(value));
  }

  private toIsoString(value: Date | string): string {
    return (value instanceof Date ? value : new Date(value)).toISOString();
  }
}
