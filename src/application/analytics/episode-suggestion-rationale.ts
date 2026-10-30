import type { LocalizationPort } from '../ports/localization.port';
import type { PublicationEpisodeClassification } from '../../domain/analytics/episode-identity';

const locales = ['pt-BR', 'en-US', 'es-ES'] as const;
type EpisodeSuggestionLocale = typeof locales[number];

const rationaleKeys: Readonly<Record<PublicationEpisodeClassification, string>> = {
  EPISODE: 'analytics.episodeSuggestion.rationale.episode',
  NOT_EPISODE: 'analytics.episodeSuggestion.rationale.notEpisode',
  UNCERTAIN: 'analytics.episodeSuggestion.rationale.uncertain',
};

export interface EpisodeSuggestionRationaleVariants {
  readonly variants: Partial<Readonly<Record<EpisodeSuggestionLocale, string>>>;
  readonly failures: Partial<Readonly<Record<EpisodeSuggestionLocale, 'ANALYTICS_SUGGESTION_RATIONALE_UNAVAILABLE'>>>;
}

export function buildEpisodeSuggestionRationaleVariants(
  localization: Pick<LocalizationPort, 'translate'>,
  classification: PublicationEpisodeClassification,
): EpisodeSuggestionRationaleVariants {
  const variants: Partial<Record<EpisodeSuggestionLocale, string>> = {};
  const failures: Partial<Record<EpisodeSuggestionLocale, 'ANALYTICS_SUGGESTION_RATIONALE_UNAVAILABLE'>> = {};
  const key = rationaleKeys[classification];

  for (const locale of locales) {
    try {
      const value = localization.translate(key, locale);
      if (!value.trim() || value === key) throw new Error('Missing episode suggestion rationale translation.');
      variants[locale] = value;
    } catch {
      failures[locale] = 'ANALYTICS_SUGGESTION_RATIONALE_UNAVAILABLE';
    }
  }

  return { variants, failures };
}
