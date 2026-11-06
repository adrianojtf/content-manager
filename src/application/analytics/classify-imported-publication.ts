import type {
  EpisodeIdentityExtractionResult,
  EpisodeIdentitySeriesCatalogEntry,
  EpisodeIdentityVerificationResult,
  PublicationEpisodeClassificationResult,
  PublicationEpisodeClassifier,
  PublicationEpisodeMetadata,
} from '../ports/publication-episode-classifier.port';
import type { LocalizationPort } from '../ports/localization.port';
import { buildEpisodeSuggestionRationaleVariants } from './episode-suggestion-rationale';
import { EpisodeReviewError } from './episode-review-error';
import {
  extractExplicitEpisodeIdentity,
  hasExplicitEpisodeIdentity,
  type EpisodeIdentitySource,
  type ExplicitEpisodeIdentity,
} from '../../domain/analytics/episode-identity';

const uncertainVerificationConfidenceThreshold = 0.6;

export interface EpisodeIdentityAudit {
  readonly catalogSize: number;
  readonly verification?: EpisodeIdentityVerificationResult | { readonly failure: string };
  readonly extraction?: EpisodeIdentityExtractionResult | { readonly failure: string };
}

export interface ClassifiedPublicationEpisodeSuggestion extends PublicationEpisodeClassificationResult {
  readonly publication: PublicationEpisodeMetadata;
  readonly identity: ExplicitEpisodeIdentity;
  readonly identitySource: EpisodeIdentitySource | null;
  readonly identityAudit: EpisodeIdentityAudit;
  readonly rationaleVariants: ReturnType<typeof buildEpisodeSuggestionRationaleVariants>['variants'];
  readonly rationaleFailures: ReturnType<typeof buildEpisodeSuggestionRationaleVariants>['failures'];
}

export class ClassifyImportedPublication {
  constructor(
    private readonly classifier: PublicationEpisodeClassifier,
    private readonly localization: LocalizationPort,
  ) {}

  async execute(input: {
    readonly publication: PublicationEpisodeMetadata;
    readonly seriesCatalog?: readonly EpisodeIdentitySeriesCatalogEntry[];
  }): Promise<ClassifiedPublicationEpisodeSuggestion> {
    const seriesCatalog = input.seriesCatalog ?? [];
    const classification = await this.classifier.classify(input);
    const rationale = buildEpisodeSuggestionRationaleVariants(this.localization, classification.classification);

    const deterministic = extractExplicitEpisodeIdentity(input.publication.title, input.publication.description);
    const audit: {
      catalogSize: number;
      verification?: EpisodeIdentityVerificationResult | { failure: string };
      extraction?: EpisodeIdentityExtractionResult | { failure: string };
    } = { catalogSize: seriesCatalog.length };
    let identity = deterministic;
    let identitySource: EpisodeIdentitySource | null = hasExplicitEpisodeIdentity(deterministic) ? 'RULES' : null;
    let escalate = classification.classification !== 'NOT_EPISODE' && identitySource === null;

    if (identitySource === 'RULES' && classification.classification !== 'NOT_EPISODE') {
      try {
        const verification = await this.classifier.verifyEpisodeIdentity({
          publication: input.publication,
          identity: deterministic,
        });
        audit.verification = verification;
        if (verification.verdict === 'VALID') {
          identitySource = 'JEV_VERIFIED';
        } else if (verification.verdict === 'INVALID'
          || (verification.confidence ?? 0) < uncertainVerificationConfidenceThreshold) {
          escalate = true;
        }
      } catch (error) {
        audit.verification = { failure: failureCode(error) };
      }
    }

    if (escalate) {
      try {
        const extraction = await this.classifier.extractEpisodeIdentity({
          publication: input.publication,
          seriesCatalog,
        });
        const extracted = identityFromExtraction(extraction, seriesCatalog);
        audit.extraction = extraction;
        identity = extracted;
        identitySource = 'JEV_EXTRACTED';
      } catch (error) {
        audit.extraction = { failure: failureCode(error) };
      }
    }

    return {
      ...classification,
      publication: input.publication,
      identity,
      identitySource,
      identityAudit: audit,
      rationaleVariants: rationale.variants,
      rationaleFailures: rationale.failures,
    };
  }
}

function identityFromExtraction(
  result: EpisodeIdentityExtractionResult,
  seriesCatalog: readonly EpisodeIdentitySeriesCatalogEntry[],
): ExplicitEpisodeIdentity {
  const episodeNumber = Number.isSafeInteger(result.episodeNumber) && (result.episodeNumber as number) >= 1
    ? result.episodeNumber
    : null;
  const seasonNumber = Number.isSafeInteger(result.seasonNumber) && (result.seasonNumber as number) >= 1
    ? result.seasonNumber
    : null;
  const episodeCode = typeof result.episodeCode === 'string' && result.episodeCode.trim()
    ? result.episodeCode.trim()
    : null;
  const seriesRef = result.seriesRef;

  if (seriesRef?.type === 'existing') {
    const series = seriesCatalog.find((entry) => entry.id === seriesRef.seriesId);
    if (!series || (series.seasonMode === 'NON_SEASONAL' && seasonNumber !== null)) {
      throw new EpisodeReviewError('ANALYTICS_EPISODE_IDENTITY_EXTRACTION_INVALID');
    }
    return {
      seriesName: series.name,
      seasonNumber: series.seasonMode === 'NON_SEASONAL' ? null : seasonNumber,
      seasonStatus: series.seasonMode === 'NON_SEASONAL'
        ? 'NON_SEASONAL'
        : seasonNumber !== null ? 'NUMBERED' : 'UNKNOWN',
      episodeNumber,
      episodeCode,
    };
  }

  if (seriesRef?.type === 'new') {
    const name = seriesRef.name.trim();
    if (!name || name.length > 200) {
      throw new EpisodeReviewError('ANALYTICS_EPISODE_IDENTITY_EXTRACTION_INVALID');
    }
    return {
      seriesName: name,
      seasonNumber,
      seasonStatus: seasonNumber !== null ? 'NUMBERED' : 'UNKNOWN',
      episodeNumber,
      episodeCode,
    };
  }

  return {
    seriesName: null,
    seasonNumber,
    seasonStatus: seasonNumber !== null ? 'NUMBERED' : 'UNKNOWN',
    episodeNumber,
    episodeCode,
  };
}

function failureCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'ANALYTICS_EPISODE_IDENTITY_CASCADE_FAILED';
}
