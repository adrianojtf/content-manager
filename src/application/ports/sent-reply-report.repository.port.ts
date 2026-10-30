export type SentReplyReportPlatform = 'youtube' | 'instagram' | 'facebook' | 'tiktok';

export interface SentReplyReportCursor {
  readonly sentAt: string;
  readonly id: string;
}

export interface SentReplyReportQuery {
  readonly asOf: string;
  readonly from: string;
  readonly to: string;
  readonly platform: SentReplyReportPlatform | null;
  readonly accountId: string | null;
  readonly search: string | null;
  readonly after: SentReplyReportCursor | null;
  readonly limit: number | null;
}

export interface SentReplyReportAnalysisCorrection {
  readonly actorSource: string;
  readonly recordedAt: string;
  readonly correctedFields: Readonly<Record<string, unknown>>;
  readonly reason: string | null;
}

export interface SentReplyReportRow {
  readonly id: string;
  readonly sentAt: string;
  readonly platform: SentReplyReportPlatform;
  readonly socialAccountId: string;
  readonly accountDisplayName: string | null;
  readonly externalAccountId: string;
  readonly externalPublicationId: string;
  readonly publicationTitle: string | null;
  readonly publicationPermalink: string | null;
  readonly commentText: string | null;
  readonly commentAuthorDisplayName: string | null;
  readonly commentCreatedAt: string | null;
  readonly sentResponse: string;
  readonly jevCommentAnalysis: Readonly<Record<string, unknown>> | null;
  readonly analysisCorrection: SentReplyReportAnalysisCorrection | null;
}

export interface SentReplyReportQueryResult {
  readonly items: readonly SentReplyReportRow[];
  readonly total: number;
  readonly hasMore: boolean;
}

export interface SentReplyReportRepository {
  query(tenantId: string, filters: SentReplyReportQuery): Promise<SentReplyReportQueryResult>;
}
