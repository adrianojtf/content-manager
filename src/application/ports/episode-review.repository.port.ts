import type {
  ClassifiedPublicationEpisodeSuggestion,
} from '../analytics/classify-imported-publication';
import type { SocialAccountId } from '../../domain/social/social-account-id';
import type { SocialPlatform } from '../../domain/social/social-account';
import type { ExplicitEpisodeIdentity } from '../../domain/analytics/episode-identity';

export type EpisodeReviewSeasonMode = 'SEASONAL' | 'NON_SEASONAL';
export type EpisodeSuggestionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'DEFERRED' | 'SUPERSEDED' | 'NOT_EPISODE';

export interface EpisodeReviewPublication {
  readonly platform: SocialPlatform;
  readonly externalPublicationId: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly permalink: string | null;
  readonly thumbnailUrl: string | null;
  readonly publishedAt: string | null;
}

export interface EpisodeReviewSuggestion extends Omit<ClassifiedPublicationEpisodeSuggestion, 'publication'> {
  readonly id: string;
  readonly socialAccountId: SocialAccountId;
  readonly socialAccountName: string | null;
  readonly sourceFingerprint: string;
  readonly publication: EpisodeReviewPublication;
  readonly status: EpisodeSuggestionStatus;
  readonly createdAt: string;
  readonly decidedAt: string | null;
  readonly decisionActorId: string | null;
  readonly decisionReason: string | null;
  readonly setupSeriesId: string | null;
  readonly setupSeriesConfirmedAt: string | null;
  readonly setupSeasonNumber: number | null;
  readonly setupSeasonConfirmedAt: string | null;
}

export interface EpisodeReviewSourceState {
  readonly socialAccountId: SocialAccountId;
  readonly externalPublicationId: string;
  readonly sourceFingerprint: string;
  readonly linkedEpisodeId: string | null;
}

export interface EpisodeReviewSeries {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly seasonMode: EpisodeReviewSeasonMode;
}

export interface EpisodeReviewEpisode {
  readonly id: string;
  readonly seriesId: string;
  readonly seasonNumber: number | null;
  readonly episodeNumber: number;
  readonly episodeCode: string;
}

export interface EpisodeReviewApprovalCommand {
  readonly suggestionIds: readonly string[];
  readonly series: {
    readonly id?: string;
    readonly name?: string;
    readonly aliases?: readonly string[];
    readonly seasonMode?: EpisodeReviewSeasonMode;
  };
  readonly seasonNumber: number | null;
  readonly episodeNumber: number;
  readonly episodeCode: string;
  readonly actorId: string;
  readonly decidedAt: string;
}

export interface EpisodeReviewApprovalResult {
  readonly series: EpisodeReviewSeries;
  readonly episode: EpisodeReviewEpisode;
  readonly linkedPublicationCount: number;
}

export interface EpisodeReviewRepository {
  listSourceStates(tenantId: string): Promise<readonly EpisodeReviewSourceState[]>;
  saveSuggestion(
    tenantId: string,
    suggestion: ClassifiedPublicationEpisodeSuggestion & {
      readonly socialAccountId: SocialAccountId;
      readonly sourceFingerprint: string;
      readonly publication: EpisodeReviewPublication;
      readonly createdAt: string;
    },
  ): Promise<void>;
  listPendingSuggestions(tenantId: string): Promise<readonly EpisodeReviewSuggestion[]>;
  listSeries(tenantId: string): Promise<readonly EpisodeReviewSeries[]>;
  findSeriesById(tenantId: string, seriesId: string): Promise<EpisodeReviewSeries | null>;
  confirmSetupSeries(
    tenantId: string,
    suggestionIds: readonly string[],
    series: EpisodeReviewApprovalCommand['series'],
    actorId: string,
    decidedAt: string,
  ): Promise<EpisodeReviewSeries>;
  confirmSetupSeason(
    tenantId: string,
    suggestionIds: readonly string[],
    seasonNumber: number,
    actorId: string,
    decidedAt: string,
  ): Promise<number>;
  approveGroup(tenantId: string, input: EpisodeReviewApprovalCommand): Promise<EpisodeReviewApprovalResult>;
  decideSuggestions(
    tenantId: string,
    suggestionIds: readonly string[],
    decision: 'REJECTED' | 'DEFERRED',
    actorId: string,
    decidedAt: string,
  ): Promise<number>;
}
