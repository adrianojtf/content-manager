export const publicationEpisodeClassifications = ['EPISODE', 'NOT_EPISODE', 'UNCERTAIN'] as const;
export type PublicationEpisodeClassification = typeof publicationEpisodeClassifications[number];

export interface ExplicitEpisodeIdentity {
  readonly seriesName: string | null;
  readonly seasonNumber: number | null;
  readonly seasonStatus: 'NUMBERED' | 'NON_SEASONAL' | 'UNKNOWN';
  readonly episodeNumber: number | null;
  readonly episodeCode: string | null;
}

export interface EpisodePublicationSuggestion {
  readonly classification: PublicationEpisodeClassification;
  readonly confidence: number | null;
  readonly id?: string;
  readonly socialAccountId?: string;
  readonly seriesSeasonMode?: 'SEASONAL' | 'NON_SEASONAL';
  readonly publication: {
    readonly platform: string;
    readonly externalPublicationId: string;
    readonly title: string | null;
    readonly description: string | null;
    readonly permalink?: string | null;
    readonly thumbnailUrl?: string | null;
    readonly publishedAt?: string | null;
  };
  readonly identity: ExplicitEpisodeIdentity;
}

export interface EpisodePublicationSuggestionGroup {
  readonly seriesName: string;
  readonly seasonNumber: number | null;
  readonly seasonStatus: 'NUMBERED' | 'NON_SEASONAL';
  readonly episodeNumber: number;
  readonly episodeCode: string | null;
  readonly publications: readonly EpisodePublicationSuggestion[];
}

export interface UnmatchedEpisodePublicationSuggestion extends EpisodePublicationSuggestion {
  readonly unmatchedReason: 'NOT_EPISODE' | 'UNCERTAIN' | 'IDENTITY_INCOMPLETE' | 'SEASON_UNKNOWN' | 'SERIES_SEASON_MODE_CONFLICT' | 'IDENTITY_CONFLICT' | 'IDENTITY_SINGLE';
}

function cleanSeriesNameCandidate(value: string): string | null {
  const candidate = value
    .replace(/^[\p{P}\p{S}\p{M}\p{Cf}\s]+/gu, '')
    .replace(/[\p{P}\p{S}\p{M}\p{Cf}\s]+$/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const normalized = normalizeSeriesIdentity(candidate);
  const firstWord = normalized.split(' ')[0];
  if (!candidate || !normalized
    || /^(?:episode|episodio|chapter|capitulo|part|parte|ep)\s*\d+$/.test(normalized)
    || ['no', 'em', 'episodio', 'episode', 'capitulo', 'chapter', 'ep', 'pov', 'que', 'mas', 'ele', 'ela'].includes(firstWord)) {
    return null;
  }
  return candidate;
}

function seriesNameAroundEpisodeMarker(text: string, start: number, end: number): { readonly name: string | null; readonly confidence: number } {
  const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const lineEndIndex = text.indexOf('\n', end);
  const lineEnd = lineEndIndex < 0 ? text.length : lineEndIndex;
  const before = text.slice(lineStart, start);
  const after = text.slice(end, lineEnd);
  const candidates: { readonly name: string; readonly confidence: number }[] = [];
  const add = (value: string | undefined, confidence: number) => {
    const name = value ? cleanSeriesNameCandidate(value) : null;
    if (name) candidates.push({ name, confidence });
  };

  const trailingSeries = after.match(/^\s*(?:[|—–:]\s*)?(?:da série|de série|da novela|de novela|de)\s+(.+?)(?=\s*(?:,|[.!?;:\n#]|e me conta\b|e me diz\b|acompanhe\b|assista\b|dispon[ií]vel\b|$))/i);
  if (trailingSeries) add(trailingSeries[1], 6);

  const pipedFollowingName = after.match(/^\s*\|\s*(.+?)(?=\s*(?:[,.;!?]|\n|#|$))/);
  if (pipedFollowingName && !/[-–—]/.test(pipedFollowingName[1])) add(pipedFollowingName[1], 6);

  const beforeHasSeriesDelimiter = /[|—–:]/.test(before);
  add(before.replace(/[|—–:]+$/g, ''), beforeHasSeriesDelimiter ? 5 : 3);

  const previousLineStartIndex = text.lastIndexOf('\n', Math.max(0, lineStart - 2));
  if (previousLineStartIndex >= 0) {
    const previousLine = text.slice(previousLineStartIndex + 1, lineStart - 1).trim();
    if (previousLine.length <= 100) add(previousLine, 2);
  }

  candidates.sort((left, right) => right.confidence - left.confidence || left.name.length - right.name.length);
  return candidates[0] ?? { name: null, confidence: 0 };
}

function standaloneSeriesName(texts: readonly string[]): string | null {
  const candidates: { readonly name: string; readonly confidence: number }[] = [];
  const add = (value: string | undefined, confidence: number) => {
    const name = value ? cleanSeriesNameCandidate(value) : null;
    if (name && normalizeSeriesIdentity(name).split(' ').length >= 2) candidates.push({ name, confidence });
  };
  const genericTagWords = new Set([
    'novelaria', 'novela', 'novelaia', 'romance', 'romantica', 'romantico', 'comedia',
    'serie', 'series', 'vertical', 'microdrama', 'agegap', 'fakedating', 'de', 'do', 'da',
  ]);

  for (const text of texts) {
    for (const line of text.split(/\r?\n/)) {
      const searchableLine = line.replace(/#[\p{L}\p{N}_]+/gu, ' ');
      const namedSeries = searchableLine.match(/(?:bastidores de|acompanhe|assista ao|vem conhecer|conhecer|estreia(?:\s+hoje)?\s*[:\-]?|reta final de|s[eé]rie\s*:\s*|novela\s*:\s*|cap[ií]tulos? de|epis[oó]dios? de)\s+(.+?)(?=\s*(?:[,.;!?*]|#|às?\s+\d{1,2}|todos os epis[oó]dios|todos os cap[ií]tulos|a novelinha|a novela|aqui na|$))/i);
      if (namedSeries) add(namedSeries[1], 9);

      const beforePipe = line.match(/^\s*[\p{P}\p{S}\s]*?(.+?)\s*\|\s*.+$/u);
      if (beforePipe) add(beforePipe[1], 7);

      for (const [, tag] of line.matchAll(/#([\p{L}\p{N}_]+)/gu)) {
        const spaced = tag
          .replace(/([a-zà-öø-ÿ])([A-Z])/g, '$1 $2')
          .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
        const words = spaced.split(/\s+/).filter(Boolean);
        const normalizedWords = words.map((word) => normalizeSeriesIdentity(word));
        if (words.length >= 3 && !normalizedWords.every((word) => genericTagWords.has(word))) {
          add(spaced, 8 + words.length / 100);
        }
      }
    }
  }

  candidates.sort((left, right) => right.confidence - left.confidence || right.name.length - left.name.length);
  return candidates[0]?.name ?? null;
}

function namedObsidianaSeason(texts: readonly string[]): number | null {
  const hasNamedArc = texts.some((text) => (
    /\bobsidiana\s*[:|—–-]\s*o\s+legado\b/i.test(text)
    || /#obsidianaolegado\b/i.test(text)
    || text.split(/\r?\n/).some((line) => (
      /^[\p{P}\p{S}\p{M}\p{Cf}\s]*obsidiana\s+o\s+legado\b/iu.test(line)
    ))
  ));
  const hasSeparateArcTags = texts.some((text) => /#obsidiana\b/i.test(text))
    && texts.some((text) => /#olegado\b/i.test(text));
  if (hasNamedArc || hasSeparateArcTags) return 2;
  if (texts.some((text) => /\b1[ªa]\s*temporada\s*[—–:|]\s*obsidiana\b/i.test(text))) return 1;
  return null;
}

function hasObsidianaSeriesIdentity(texts: readonly string[]): boolean {
  if (texts.some((text) => /#obsidiana(?:\b|olegado\b)/i.test(text))) return true;
  return texts.some((text) => text.split(/\r?\n/).some((line) => {
    const normalizedLine = line.trim();
    const root = normalizedLine.match(/^[\p{P}\p{S}\p{M}\p{Cf}\s]*obsidiana\b/iu);
    if (!root) return false;
    const remainder = normalizedLine.slice(root[0].length).trimStart();
    return !remainder || /^[|:—–-]/.test(remainder) || /^\p{Lu}/u.test(remainder);
  }));
}

export function extractExplicitEpisodeIdentity(
  title: string | null,
  description: string | null = null,
): ExplicitEpisodeIdentity {
  const texts = [title, description].filter((value): value is string => Boolean(value?.trim()));
  const identity = extractEpisodeIdentityFromText(title, description);
  const namedSeasonNumber = namedObsidianaSeason(texts);
  if (namedSeasonNumber !== null) {
    return {
      ...identity,
      seriesName: 'Obsidiana',
      seasonNumber: identity.seasonStatus === 'NUMBERED' && identity.seasonNumber !== null
        ? identity.seasonNumber
        : namedSeasonNumber,
      seasonStatus: 'NUMBERED',
    };
  }
  if (hasObsidianaSeriesIdentity(texts)) {
    return { ...identity, seriesName: 'Obsidiana' };
  }
  return identity;
}

function extractEpisodeIdentityFromText(
  title: string | null,
  description: string | null = null,
): ExplicitEpisodeIdentity {
  const texts = [title, description].filter((value): value is string => Boolean(value?.trim()));
  for (const text of texts) {
    const seasonalCodeMatch = text.match(/\b([A-Z][A-Z0-9]{1,7})[-_ ]S0*(\d{1,3})[-_ ]E(?:P)?[-_ ]?0*(\d{1,4})\b/i);
    if (seasonalCodeMatch) {
      return {
        seriesName: seasonalCodeMatch[1].toUpperCase(),
        seasonNumber: Number(seasonalCodeMatch[2]),
        seasonStatus: 'NUMBERED',
        episodeNumber: Number(seasonalCodeMatch[3]),
        episodeCode: seasonalCodeMatch[0].toUpperCase().replace(/[_ ]+/g, '-'),
      };
    }

    const codeMatch = text.match(/\b([A-Z][A-Z0-9]{1,7})[-_ ]E(?:P)?[-_ ]?0*(\d{1,4})\b/i);
    if (codeMatch) {
      return {
        seriesName: codeMatch[1].toUpperCase(),
        seasonNumber: null,
        seasonStatus: 'UNKNOWN',
        episodeNumber: Number(codeMatch[2]),
        episodeCode: codeMatch[0].toUpperCase().replace(/[_ ]+/g, '-'),
      };
    }
  }

  const compactSeasonEpisode = /\b[ST]0*(\d{1,3})[-_ ]?E(?:P)?[-_ ]?0*(\d{1,4})\b/i;
  for (const text of texts) {
    const match = compactSeasonEpisode.exec(text);
    if (!match) continue;
    const seriesName = seriesNameAroundEpisodeMarker(text, match.index, match.index + match[0].length).name;
    return {
      seriesName,
      seasonNumber: Number(match[1]),
      seasonStatus: 'NUMBERED',
      episodeNumber: Number(match[2]),
      episodeCode: null,
    };
  }

  const namedSeasonEpisode = /\b(?:season|temporada)\s*#?\s*0*(\d{1,3})\s*[-,:| ]+\s*(?:episode|epis[oó]dio|episodio|ep)\s*#?\s*0*(\d{1,4})\b/i;
  for (const text of texts) {
    const match = namedSeasonEpisode.exec(text);
    if (!match) continue;
    const seriesName = seriesNameAroundEpisodeMarker(text, match.index, match.index + match[0].length).name;
    return {
      seriesName,
      seasonNumber: Number(match[1]),
      seasonStatus: 'NUMBERED',
      episodeNumber: Number(match[2]),
      episodeCode: null,
    };
  }

  const episodeLabel = /\b(?:episode|epis[oó]dio|episodio|chapter|cap[ií]tulo|capitulo|part|parte|ep)\.?\s*[#№-]?\s*0*(\d{1,4})\b/gi;
  const episodeMatches = texts.flatMap((text, textIndex) => [...text.matchAll(episodeLabel)].map((match) => {
    const markerIndex = match.index ?? 0;
    const series = seriesNameAroundEpisodeMarker(text, markerIndex, markerIndex + match[0].length);
    return {
      seriesName: series.name,
      confidence: series.confidence,
      episodeNumber: Number(match[1]),
      textIndex,
      markerIndex,
    };
  }));
  episodeMatches.sort((left, right) => (
    right.confidence - left.confidence
    || left.textIndex - right.textIndex
    || left.markerIndex - right.markerIndex
  ));
  const episodeMatch = episodeMatches[0];
  if (episodeMatch) {
    return {
      seriesName: episodeMatch.seriesName ?? standaloneSeriesName(texts),
      seasonNumber: null,
      seasonStatus: 'UNKNOWN',
      episodeNumber: episodeMatch.episodeNumber,
      episodeCode: null,
    };
  }

  return {
    seriesName: standaloneSeriesName(texts),
    seasonNumber: null,
    seasonStatus: 'UNKNOWN',
    episodeNumber: null,
    episodeCode: null,
  };
}

export function normalizeSeriesIdentity(value: string): string {
  return value.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function groupEpisodePublicationSuggestions(
  suggestions: readonly EpisodePublicationSuggestion[],
): {
  readonly groups: readonly EpisodePublicationSuggestionGroup[];
  readonly unmatched: readonly UnmatchedEpisodePublicationSuggestion[];
} {
  const buckets = new Map<string, { readonly index: number; readonly suggestion: EpisodePublicationSuggestion }[]>();
  const unmatched: { readonly index: number; readonly suggestion: UnmatchedEpisodePublicationSuggestion }[] = [];

  for (const [index, suggestion] of suggestions.entries()) {
    if (suggestion.classification !== 'EPISODE') {
      unmatched.push({
        index,
        suggestion: {
          ...suggestion,
          unmatchedReason: suggestion.classification === 'NOT_EPISODE' ? 'NOT_EPISODE' : 'UNCERTAIN',
        },
      });
      continue;
    }

    const { seriesName, seasonNumber, seasonStatus, episodeNumber } = suggestion.identity;
    if (!seriesName || episodeNumber === null || !Number.isInteger(episodeNumber) || episodeNumber < 1) {
      unmatched.push({ index, suggestion: { ...suggestion, unmatchedReason: 'IDENTITY_INCOMPLETE' } });
      continue;
    }
    if (seasonStatus === 'UNKNOWN') {
      unmatched.push({ index, suggestion: { ...suggestion, unmatchedReason: 'SEASON_UNKNOWN' } });
      continue;
    }
    if ((suggestion.seriesSeasonMode === 'NON_SEASONAL' && seasonStatus === 'NUMBERED')
      || (suggestion.seriesSeasonMode === 'SEASONAL' && seasonStatus === 'NON_SEASONAL')) {
      unmatched.push({ index, suggestion: { ...suggestion, unmatchedReason: 'SERIES_SEASON_MODE_CONFLICT' } });
      continue;
    }
    if ((seasonStatus === 'NUMBERED' && (seasonNumber === null || !Number.isInteger(seasonNumber) || seasonNumber < 1))
      || (seasonStatus === 'NON_SEASONAL' && seasonNumber !== null)) {
      unmatched.push({ index, suggestion: { ...suggestion, unmatchedReason: 'IDENTITY_INCOMPLETE' } });
      continue;
    }
    const seasonKey = seasonStatus === 'NUMBERED' ? `season:${seasonNumber}` : 'seasonless';
    const key = `${normalizeSeriesIdentity(seriesName)}:${seasonKey}:${episodeNumber}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push({ index, suggestion });
    buckets.set(key, bucket);
  }

  const groups: EpisodePublicationSuggestionGroup[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.length === 1) {
      unmatched.push({
        index: bucket[0].index,
        suggestion: { ...bucket[0].suggestion, unmatchedReason: 'IDENTITY_SINGLE' },
      });
      continue;
    }
    const codes = new Set(bucket.map(({ suggestion }) => suggestion.identity.episodeCode).filter((code): code is string => Boolean(code)));
    if (codes.size > 1) {
      unmatched.push(...bucket.map(({ index, suggestion }) => ({
        index,
        suggestion: { ...suggestion, unmatchedReason: 'IDENTITY_CONFLICT' as const },
      })));
      continue;
    }
    groups.push({
      seriesName: bucket[0].suggestion.identity.seriesName as string,
      seasonNumber: bucket[0].suggestion.identity.seasonNumber,
      seasonStatus: bucket[0].suggestion.identity.seasonStatus as 'NUMBERED' | 'NON_SEASONAL',
      episodeNumber: bucket[0].suggestion.identity.episodeNumber as number,
      episodeCode: codes.values().next().value ?? null,
      publications: bucket.map(({ suggestion }) => suggestion),
    });
  }

  return {
    groups,
    unmatched: unmatched.sort((left, right) => left.index - right.index).map(({ suggestion }) => suggestion),
  };
}
