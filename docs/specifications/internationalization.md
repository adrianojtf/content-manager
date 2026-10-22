# Internationalization and Localization — Feature Specification

## Status

Accepted for the MVP foundation. See [architecture](../architecture/internationalization.md), [ADR-005](../architecture/decisions/ADR-005-internationalization.md), and [localization contract](../contracts/localization.md).

## Context

This specification established the localization foundation before the IAM work. IAM-02 now provides persisted identity and OIDC authentication, and IAM-03 adds tenant/user preference persistence. The CreatorDesk comments frontend uses semantic localization keys and ships catalogs for `pt-BR`, `en-US`, and `es-ES`; its local-pilot language selector persists the selected UI locale in the browser until authenticated locale-context wiring is available.

## Scope

- Resolve a supported locale centrally from user, tenant, request negotiation (anonymous only), and system configuration.
- Provide application-owned translation and formatting contracts, implemented with versioned locale catalogs and Node.js `Intl` for formatting.
- Support locale-specific message lookup, named interpolation, plural forms, dates, numbers, and currency presentation.
- Define tenant/user preference ownership and UTC/API behavior; IAM-03 persists preferences, while FND-04 wires them into request context.

## Out of scope

- Implementing tenant/user CRUD or authentication as part of the localization foundation; these are owned by IAM. Per-request NestJS localization middleware remains FND-04.
- Authenticated frontend locale resolution; the local-pilot UI selector is browser-local until FND-04 integrates persisted user/tenant preferences.
- Runtime catalog editing, external translation services, translation management UI, automatic currency conversion, or business-specific money rounding.
- Translating technical logs, provider errors, or domain rules.

## Functional requirements

1. Locale is a BCP 47 language-region value such as `pt-BR`, distinct from the language-only value `pt`.
2. Authenticated locale precedence is user locale, tenant default locale, then configured system default locale.
3. Invalid or unsupported user/tenant candidates are skipped. The configured system locale must be supported; invalid configuration fails clearly instead of consulting host locale.
4. For anonymous requests only, supported `Accept-Language` negotiation is used after any available tenant preference and before system fallback. A persisted user preference always overrides the header.
5. Locale resolution is centralized; application/domain behavior must not branch on particular locales.
6. Translation catalogs use semantic keys. Server catalogs use JSON; the static browser frontend may use versioned ES-module catalogs. Missing keys fall back to the same key in the system catalog and then to the key itself. A missing/unsupported locale uses the system catalog.
7. Translation supports named parameters and plural categories, with a required `other` form. Plural selection is based on locale rules, not business logic.
8. Date formatting accepts an instant, locale, and explicit timezone. Timezone selection is user timezone, tenant timezone, then UTC. No server-local timezone is used.
9. Number and currency formatting use locale conventions. Currency is an explicit ISO 4217 code owned by the tenant and is never inferred from locale.
10. Persisted monetary values and API data remain structured; formatting is presentation-only.
11. Dates representing instants are stored as UTC and transported as ISO 8601 with an offset. Calendar dates are not converted as instants.
12. Translation/formatting policy is available through an application-owned port and does not introduce a domain dependency on JSON, `Intl`, a database, or a web framework.

## Acceptance criteria

- Tests prove user > tenant > system locale resolution and skip invalid/unsupported user or tenant locales.
- Anonymous header negotiation cannot override persisted preferences and falls back to system locale.
- Tests verify supported-key translation, interpolation, plural selection, missing-key fallback, and unsupported-locale fallback.
- Fixed-date tests verify explicit timezone conversion; number and currency tests verify locale-specific output.
- The application port contains no infrastructure imports; architecture tests enforce existing layer boundaries.
- Versioned catalogs exist for `pt-BR`, `en-US`, and `es-ES` with semantic keys.
- No tenant/user persistence, unrelated business behavior, or frontend implementation is introduced in this slice.

## Initial configuration assumptions

- System default locale: `pt-BR`, overridable only by a locale present in the shipped catalogs.
- System timezone fallback: `UTC`.
- Tenant `defaultLocale` and `timezone` may be unset and use the system-locale/UTC fallbacks. Tenant currency is a required supported ISO 4217 code with no inferred/default value; User has no currency preference.
- Request locale header is `Accept-Language`; endpoint-specific locale query parameters are not part of the contract.

## Verification

Use deterministic unit and adapter integration tests with fixed locales, dates, and timezone identifiers. The full `npm test` suite remains the regression gate. No tests may depend on host timezone, production services, or remote translation providers.
