export interface LocalePreferences {
  readonly userLocale?: string | null;
  readonly tenantDefaultLocale?: string | null;
  readonly acceptLanguage?: string | null;
}

export function canonicalSupportedLocale(candidate: string | null | undefined, supportedLocales: readonly string[]): string | undefined {
  if (!candidate?.trim()) {
    return undefined;
  }

  try {
    const canonicalCandidate = Intl.getCanonicalLocales(candidate.trim())[0];
    return supportedLocales.find((locale) => Intl.getCanonicalLocales(locale)[0] === canonicalCandidate);
  } catch {
    return undefined;
  }
}

function preferredHeaderLocales(header: string): string[] {
  return header.split(',')
    .map((entry, index) => {
      const [tag, ...parameters] = entry.trim().split(';');
      const qualityParameter = parameters.find((parameter) => /^q=/i.test(parameter.trim()));
      const quality = qualityParameter ? Number(qualityParameter.trim().slice(2)) : 1;

      return { tag: tag.trim(), quality, index };
    })
    .filter(({ tag, quality }) => tag && !Number.isNaN(quality) && quality > 0 && quality <= 1)
    .sort((left, right) => right.quality - left.quality || left.index - right.index)
    .map(({ tag }) => tag);
}

function hasPreference(candidate: string | null | undefined): boolean {
  return Boolean(candidate?.trim());
}

export function resolveLocale(
  preferences: LocalePreferences,
  supportedLocales: readonly string[],
  systemDefaultLocale: string,
): string {
  const systemLocale = canonicalSupportedLocale(systemDefaultLocale, supportedLocales);
  if (!systemLocale) {
    throw new RangeError(`Invalid system default locale: ${systemDefaultLocale}`);
  }

  const userLocale = canonicalSupportedLocale(preferences.userLocale, supportedLocales);
  if (userLocale) {
    return userLocale;
  }

  const tenantLocale = canonicalSupportedLocale(preferences.tenantDefaultLocale, supportedLocales);
  if (tenantLocale) {
    return tenantLocale;
  }

  if (!hasPreference(preferences.userLocale) && !hasPreference(preferences.tenantDefaultLocale)) {
    for (const candidate of preferredHeaderLocales(preferences.acceptLanguage ?? '')) {
      const locale = canonicalSupportedLocale(candidate, supportedLocales);
      if (locale) {
        return locale;
      }
    }
  }

  return systemLocale;
}

export function isValidTimezone(timezone: string | null | undefined): timezone is string {
  if (!timezone?.trim()) {
    return false;
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export function resolveTimezone(userTimezone?: string | null, tenantTimezone?: string | null): string {
  if (isValidTimezone(userTimezone)) {
    return userTimezone;
  }

  if (isValidTimezone(tenantTimezone)) {
    return tenantTimezone;
  }

  return 'UTC';
}
