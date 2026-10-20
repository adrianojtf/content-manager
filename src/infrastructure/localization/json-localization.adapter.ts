import type { LocalizationPort, MoneyValue } from '../../application/ports/localization.port';
import { canonicalSupportedLocale } from '../../application/localization/locale-resolution';
import enCommon from './i18n/en-US/common.json';
import enErrors from './i18n/en-US/errors.json';
import enValidation from './i18n/en-US/validation.json';
import esCommon from './i18n/es-ES/common.json';
import esErrors from './i18n/es-ES/errors.json';
import esValidation from './i18n/es-ES/validation.json';
import ptCommon from './i18n/pt-BR/common.json';
import ptErrors from './i18n/pt-BR/errors.json';
import ptValidation from './i18n/pt-BR/validation.json';

type TranslationValue = string | Readonly<Record<string, string>>;
type Catalog = Readonly<Record<string, TranslationValue>>;

const catalogs: Readonly<Record<string, Catalog>> = {
  'pt-BR': { ...ptCommon, ...ptValidation, ...ptErrors },
  'en-US': { ...enCommon, ...enValidation, ...enErrors },
  'es-ES': { ...esCommon, ...esValidation, ...esErrors },
};

const supportedLocales = Object.keys(catalogs);

export class JsonLocalizationAdapter implements LocalizationPort {
  private readonly systemDefaultLocale: string;

  constructor(systemDefaultLocale = 'pt-BR') {
    const locale = canonicalSupportedLocale(systemDefaultLocale, supportedLocales);
    if (!locale) {
      throw new RangeError(`Invalid system default locale: ${systemDefaultLocale}`);
    }
    this.systemDefaultLocale = locale;
  }

  getSupportedLocales(): readonly string[] {
    return supportedLocales;
  }

  translate(key: string, locale: string, parameters: Readonly<Record<string, string | number>> = {}): string {
    const requestedLocale = canonicalSupportedLocale(locale, supportedLocales) ?? this.systemDefaultLocale;
    const requestedMessage = catalogs[requestedLocale][key];
    const sourceLocale = requestedMessage === undefined ? this.systemDefaultLocale : requestedLocale;
    const message = requestedMessage ?? catalogs[sourceLocale][key];

    if (message === undefined) {
      return key;
    }

    if (typeof message === 'string') {
      return this.interpolate(message, parameters);
    }

    const count = parameters.count;
    if (typeof count !== 'number') {
      return key;
    }

    const category = new Intl.PluralRules(sourceLocale).select(count);
    const pluralMessage = message[category] ?? message.other;
    return this.interpolate(pluralMessage, parameters);
  }

  formatDate(value: Date, locale: string, timezone: string): string {
    return new Intl.DateTimeFormat(this.resolveLocale(locale), {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: timezone,
    }).format(value);
  }

  formatNumber(value: number, locale: string): string {
    return new Intl.NumberFormat(this.resolveLocale(locale)).format(value);
  }

  formatCurrency(value: MoneyValue, locale: string): string {
    return new Intl.NumberFormat(this.resolveLocale(locale), {
      style: 'currency',
      currency: value.currency,
    }).format(value.amount);
  }

  private resolveLocale(locale: string): string {
    return canonicalSupportedLocale(locale, supportedLocales) ?? this.systemDefaultLocale;
  }

  private interpolate(message: string, parameters: Readonly<Record<string, string | number>>): string {
    return message.replace(/\{([\w.-]+)\}/g, (placeholder, name: string) => (
      Object.hasOwn(parameters, name) ? String(parameters[name]) : placeholder
    ));
  }
}
