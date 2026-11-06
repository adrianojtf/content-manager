import {
  publicationEpisodeClassifications,
  type ExplicitEpisodeIdentity,
  type PublicationEpisodeClassification,
} from '../../domain/analytics/episode-identity';
import type { SocialPlatform } from '../../domain/social/social-account';

export { publicationEpisodeClassifications, type PublicationEpisodeClassification };

export interface PublicationEpisodeMetadata {
  readonly platform: SocialPlatform;
  readonly externalPublicationId: string;
  readonly title: string | null;
  readonly description: string | null;
}

export interface PublicationEpisodeClassificationResult {
  readonly classification: PublicationEpisodeClassification;
  readonly confidence: number | null;
  readonly probabilities: Readonly<Record<PublicationEpisodeClassification, number>> | null;
  readonly evidence: PublicationEpisodeMetadata | null;
  readonly provider: 'JEV' | 'RULES';
  readonly model: string | null;
  readonly schemaVersion: string;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number } | null;
}

export const episodeIdentityVerifications = ['VALID', 'INVALID', 'UNCERTAIN'] as const;
export type EpisodeIdentityVerification = typeof episodeIdentityVerifications[number];

export interface EpisodeIdentityVerificationResult {
  readonly verdict: EpisodeIdentityVerification;
  readonly confidence: number | null;
  readonly model: string | null;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number } | null;
}

export interface EpisodeIdentitySeriesCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly seasonMode: 'SEASONAL' | 'NON_SEASONAL';
  readonly knownSeasonNumbers: readonly number[];
}

export type EpisodeIdentityExtractionSeriesRef =
  | { readonly type: 'existing'; readonly seriesId: string }
  | { readonly type: 'new'; readonly name: string }
  | null;

export interface EpisodeIdentityExtractionResult {
  readonly seriesRef: EpisodeIdentityExtractionSeriesRef;
  readonly seasonNumber: number | null;
  readonly episodeNumber: number | null;
  readonly episodeCode: string | null;
  readonly confidence: number | null;
  readonly model: string | null;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number } | null;
}

export interface PublicationEpisodeClassifier {
  classify(input: { readonly publication: PublicationEpisodeMetadata }): Promise<PublicationEpisodeClassificationResult>;
  verifyEpisodeIdentity(input: {
    readonly publication: PublicationEpisodeMetadata;
    readonly identity: ExplicitEpisodeIdentity;
  }): Promise<EpisodeIdentityVerificationResult>;
  extractEpisodeIdentity(input: {
    readonly publication: PublicationEpisodeMetadata;
    readonly seriesCatalog: readonly EpisodeIdentitySeriesCatalogEntry[];
  }): Promise<EpisodeIdentityExtractionResult>;
}
