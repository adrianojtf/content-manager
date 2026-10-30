import {
  publicationEpisodeClassifications,
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

export interface PublicationEpisodeClassifier {
  classify(input: { readonly publication: PublicationEpisodeMetadata }): Promise<PublicationEpisodeClassificationResult>;
}
