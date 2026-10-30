import type { SentReplyReportRow } from '../ports/sent-reply-report.repository.port';

const columns = [
  'sent_at',
  'platform',
  'account_name',
  'account_external_id',
  'publication_id',
  'publication_title',
  'publication_permalink',
  'commenter_name',
  'comment',
  'comment_created_at',
  'sent_response',
  'jev_analysis_status',
  'jev_evaluated_at',
  'jev_provider',
  'jev_model',
  'jev_schema_version',
  'jev_sentiment',
  'jev_emotion',
  'jev_intent',
  'jev_topic',
  'jev_entity',
  'jev_spam_score',
  'jev_toxicity_score',
  'jev_engagement_estimate',
  'jev_needs_external_facts_probability',
  'jev_continuation_request_probability',
  'jev_confidence',
  'jev_signals',
  'jev_usage',
  'human_correction_recorded_at',
  'human_correction_actor_source',
  'human_correction_fields',
  'human_correction_reason',
] as const;

export function renderSentRepliesReportCsv(rows: readonly SentReplyReportRow[]): string {
  const records = rows.map((row) => {
    const analysis = row.jevCommentAnalysis;
    const signals = isRecord(analysis?.signals) ? analysis.signals : null;
    const usage = isRecord(analysis?.usage) ? analysis.usage : null;
    const correction = row.analysisCorrection;
    return [
      row.sentAt,
      row.platform,
      row.accountDisplayName,
      row.externalAccountId,
      row.externalPublicationId,
      row.publicationTitle,
      row.publicationPermalink,
      row.commentAuthorDisplayName,
      row.commentText,
      row.commentCreatedAt,
      row.sentResponse,
      analysis ? 'EVALUATED' : 'NOT_EVALUATED',
      analysis?.evaluatedAt,
      analysis?.provider,
      analysis?.model,
      analysis?.schemaVersion,
      analysis?.sentiment,
      analysis?.emotion,
      analysis?.intent,
      analysis?.topic,
      analysis?.entity,
      analysis?.spamScore,
      analysis?.toxicityScore,
      analysis?.engagementValue,
      getProbability(signals, 'needsExternalFacts'),
      getProbability(signals, 'requestsContinuation'),
      analysis?.confidence,
      signals ? JSON.stringify(signals) : null,
      usage ? JSON.stringify(usage) : null,
      correction?.recordedAt,
      correction?.actorSource,
      correction ? JSON.stringify(correction.correctedFields) : null,
      correction?.reason,
    ].map(csvCell).join(',');
  });
  return [columns.join(','), ...records].join('\r\n');
}

function getProbability(signals: Record<string, unknown> | null, key: string): unknown {
  const signal = signals?.[key];
  return isRecord(signal) ? signal.probability : null;
}

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : typeof value === 'string' ? value : String(value);
  if (/^[\t\r\n ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
