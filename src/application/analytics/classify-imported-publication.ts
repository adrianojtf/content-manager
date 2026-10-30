import type {
  PublicationEpisodeClassificationResult,
  PublicationEpisodeClassifier,
  PublicationEpisodeMetadata,
} from '../ports/publication-episode-classifier.port';
import type { LocalizationPort } from '../ports/localization.port';
import { buildEpisodeSuggestionRationaleVariants } from './episode-suggestion-rationale';
import { extractExplicitEpisodeIdentity } from '../../domain/analytics/episode-identity';

export interface ClassifiedPublicationEpisodeSuggestion extends PublicationEpisodeClassificationResult {
  readonly publication: PublicationEpisodeMetadata;
  readonly identity: ReturnType<typeof extractExplicitEpisodeIdentity>;
  readonly rationaleVariants: ReturnType<typeof buildEpisodeSuggestionRationaleVariants>['variants'];
  readonly rationaleFailures: ReturnType<typeof buildEpisodeSuggestionRationaleVariants>['failures'];
}

export class ClassifyImportedPublication {
  constructor(
    private readonly classifier: PublicationEpisodeClassifier,
    private readonly localization: LocalizationPort,
  ) {}

  async execute(input: { readonly publication: PublicationEpisodeMetadata }): Promise<ClassifiedPublicationEpisodeSuggestion> {
    const classification = await this.classifier.classify(input);
    const rationale = buildEpisodeSuggestionRationaleVariants(this.localization, classification.classification);

    return {
      ...classification,
      publication: input.publication,
      identity: extractExplicitEpisodeIdentity(input.publication.title, input.publication.description),
      rationaleVariants: rationale.variants,
      rationaleFailures: rationale.failures,
    };
  }
}
