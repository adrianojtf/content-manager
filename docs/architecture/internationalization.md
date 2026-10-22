# Internationalization and Localization Architecture

## Objective

Provide a small, replaceable foundation for internationalized user-facing messages and localized presentation in a multi-tenant SaaS. Locale and timezone policy must be resolved centrally; domain decisions must remain independent of language and display formatting.

## Context

The project is a TypeScript/NestJS modular monolith using Hexagonal Architecture. The localization foundation was established before IAM; IAM-02 now provides tenant/user identity persistence and OIDC authentication, and IAM-03 persists localization preferences. Authenticated HTTP request-context wiring, product routes, and the Next.js console are still pending.

## Principles

- A locale (for example `pt-BR` or `en-GB`) identifies language and regional conventions; it is not interchangeable with a language code.
- The domain does not depend on translation files, databases, web frameworks, or i18n libraries.
- Application code depends on an application-owned localization port. Infrastructure supplies file-backed messages and platform formatting.
- Translation, regional formatting, and business rules are separate concerns.
- User-facing messages use semantic keys; technical logs and internal exceptions remain technical.
- Business values remain structured. Monetary amounts are never persisted or transported as formatted strings.
- Locale/timezone resolution occurs once at a presentation/application boundary, not through scattered locale conditionals.

## Responsibilities and boundaries

- **Domain:** language-independent business rules and structured facts. No translation or display-formatting dependency.
- **Application:** localization port, locale/timezone resolution policy and structured input/output contracts. Use cases may refer to stable message keys where a user-facing message is needed.
- **Infrastructure:** versioned JSON catalogs and an adapter implementing translations and formatting using the Node.js `Intl` APIs. It may later be replaced by database or external catalog adapters.
- **HTTP presentation:** derive a localization context once per request from authenticated user/tenant preferences and `Accept-Language`; do not require locale query parameters on each endpoint. This wiring is deferred until authentication and product endpoints exist.
- **Frontend:** when introduced, use its own presentation-level `t(key)`/formatting facade backed by the same locale policy and catalog contract; components must not contain locale conditionals.

## Locale resolution

For an authenticated context, resolve the first supported, valid BCP 47 locale in this order:

1. `User.locale`
2. `Tenant.defaultLocale`
3. `System.defaultLocale`

`Accept-Language` is only a negotiation candidate for contexts without a persisted user or tenant preference; it cannot override either persisted preference. It is considered before the configured system fallback in such anonymous contexts. Unsupported or malformed candidates are skipped. The configured system default must be among the shipped catalogs; invalid system configuration is a startup/configuration error, not an implicit server-locale fallback.

The initial catalog locales are `pt-BR`, `en-US`, and `es-ES`. Adding a locale requires a catalog and tests; no product logic may branch on a locale identifier.

## Timezone policy

- Persist instants as UTC timestamps (database `timestamptz` when a schema is introduced) and transport instants as ISO 8601 timestamps with an explicit offset, normally `Z`.
- Convert for display only, at the presentation boundary, using `User.timezone`, then `Tenant.timezone`, then `UTC`.
- Validate IANA timezone identifiers at configuration boundaries. Never use the server's local timezone as a business default.
- Calendar dates without a time are distinct from instants and must not be shifted through timezone conversion.

## Currency policy

`Tenant.currency` is a required, supported ISO 4217 currency with no inferred/default value; it is not inferred from locale. Tenant locale and timezone preferences may be unset and then resolve to the system locale and UTC. A user does not own a duplicate currency setting in this MVP. Applications exchange monetary amounts as structured values containing amount and currency code, and format only at presentation using both the selected currency and locale. Currency precision/rounding and storage representation for future financial business operations remain product decisions; do not use formatted strings as stored values.

## Translation and formatting strategy

- Store semantic-key catalogs versioned with the application, separated by locale and namespace (`common`, `validation`, `errors`). The static browser frontend may ship equivalent catalogs as ES modules.
- Translate a missing key using the configured system catalog; if still missing, return the semantic key so missing catalog entries remain detectable without exposing arbitrary English text.
- For unsupported runtime locales, formatting and translation use the resolved system locale; no request-level locale conditionals.
- Interpolation uses named parameters. Plural messages use catalog plural categories selected with `Intl.PluralRules`, including an `other` form; business rules do not live in catalog entries.
- Use built-in `Intl.DateTimeFormat`, `Intl.NumberFormat`, and `Intl.PluralRules`; do not add an i18n dependency until needs justify it.

## Extensibility

A catalog adapter may evolve from versioned JSON to database-backed or external translation management while preserving the application port. The port deliberately excludes storage operations and provider-specific DTOs. Locale resolution and timezone/currency ownership remain application policy and do not move into a translation provider.

## Persistence impact

The original localization foundation did not introduce tenant/user tables. IAM-02 creates the identity tables; IAM-03 adds nullable `Tenant.defaultLocale` and `Tenant.timezone`, required `Tenant.currency`, and nullable `User.locale` and `User.timezone`. Writes canonicalize locale against shipped catalogs, validate IANA timezone identifiers, and validate currency against supported ISO 4217 codes in the application boundary. Tenant currency has no inferred/default value and is never duplicated on User.

## API and frontend impact

HTTP APIs accept `Accept-Language` for anonymous negotiation, while authenticated persisted preferences take precedence. API timestamps remain ISO 8601 instants; localized display is not returned in place of structured data unless an endpoint is explicitly presentation-oriented. No `?locale=` parameter is required. The prototype-based comments frontend uses a semantic `t(key)` facade with `pt-BR`, `en-US`, and `es-ES` catalogs and a browser-local locale selector. Authenticated locale-context integration remains deferred to FND-04; components must continue using semantic keys and formatting helpers rather than locale conditionals.

## Test impact

Cover preference precedence, malformed/unsupported candidates, configured system fallback, catalog lookup and missing-key fallback, missing-locale fallback, named interpolation, plural categories, date/timezone formatting, number formatting, currency formatting, invalid timezone/configuration, and independence of business rules from locale. Tests use fixed dates and deterministic local catalogs; no external translation service or server timezone is an oracle.

## Assumptions and open decisions

- Initial shipped catalogs: `pt-BR`, `en-US`, and `es-ES`.
- Initial configured system locale: `pt-BR`; deployments may override it with a shipped locale.
- UTC is the system timezone fallback.
- Authenticated HTTP locale-context wiring and additional frontend locale catalogs remain deferred to FND-04; the current comments frontend uses the semantic `pt-BR` catalog until that integration is available.
- Exact monetary precision/rounding and whether API responses should ever include translated message text are open until a concrete financial or HTTP use case is specified.
