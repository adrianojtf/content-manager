# Localization Contract

## Application-owned types

The application boundary represents locale as a BCP 47 tag, timezone as an IANA timezone identifier, currency as an ISO 4217 code, and money as an amount plus currency code. It does not accept preformatted values as domain data.

```typescript
interface LocalePreferences {
  userLocale?: string;
  tenantDefaultLocale?: string;
  acceptLanguage?: string;
}

interface ResolvedLocalizationContext {
  locale: string;
  timezone: string;
}

interface TenantLocalizationPreferences {
  defaultLocale: string | null;
  timezone: string | null;
  currency: string;
}

interface UserLocalizationPreferences {
  locale: string | null;
  timezone: string | null;
}

interface MoneyValue {
  amount: number;
  currency: string;
}

interface LocalizationPort {
  translate(key: string, locale: string, parameters?: Readonly<Record<string, string | number>>): string;
  formatDate(value: Date, locale: string, timezone: string): string;
  formatNumber(value: number, locale: string): string;
  formatCurrency(value: MoneyValue, locale: string): string;
}
```

The runtime adapter may expose plural-message entries, but the port remains storage-agnostic. Validation of user-facing key existence belongs to catalog tests, not business logic.

## Resolution

`resolveLocale(preferences, supportedLocales, systemDefaultLocale)` returns the first supported, well-formed candidate in this order:

1. `userLocale`
2. `tenantDefaultLocale`
3. the first supported locale from anonymous `acceptLanguage` negotiation, only when no user locale is persisted
4. `systemDefaultLocale`

A tenant preference is considered before the request header. The system default must be a supported locale and invalid configuration is rejected. HTTP code will construct this input from authenticated principal/tenant context and the `Accept-Language` header; endpoint handlers do not accept a locale query parameter.

Timezone resolution is `user.timezone`, `tenant.timezone`, `UTC`, with invalid IANA identifiers rejected or skipped according to whether the candidate is persisted user data or required deployment configuration; the final resolved value is validated before formatting. UTC is always the deterministic fallback.

Tenant `defaultLocale` and `timezone` may be unset; writes with non-null values must match a shipped locale or valid IANA identifier. Tenant `currency` is required, must be a supported ISO 4217 code, and has no inferred/default value. User locale and timezone overrides are nullable; User does not store currency. Preference writes reject unsupported values and canonicalize locale/currency codes.

## Translation catalogs

Catalog keys are semantic and namespaced, for example `user.create`, `error.notFound`, and `validation.required`. Strings can contain named placeholders such as `{name}`. Plural values define CLDR categories and must provide `other`, for example:

```json
{
  "items.count": {
    "one": "{count} item",
    "other": "{count} items"
  }
}
```

Catalog resolution looks in the requested locale first, then the configured system locale for that key, then returns the semantic key. Missing runtime locale catalogs resolve to the system catalog. Translation does not make authorization or business decisions.

## Formatting and transport

- `formatDate` requires an explicit timezone and formats a `Date` instant for display.
- `formatNumber` uses locale number conventions.
- `formatCurrency` requires a structured amount/currency value and formats without mutating the value.
- API instants use ISO 8601 with explicit offset, normally UTC `Z`; formatted date strings are presentation output, not canonical transport.
- Date-only values must use a date-only representation and must not be shifted by timezone conversion.

## Catalog file layout

```text
i18n/
├── pt-BR/{common,validation,errors}.json
├── en-US/{common,validation,errors}.json
└── es-ES/{common,validation,errors}.json
```

A catalog adapter can be replaced without changing domain or application business rules.
