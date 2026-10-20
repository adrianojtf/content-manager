# ADR-005 — Internationalization and Localization Foundation

## Status

Accepted

## Context

The project uses a TypeScript modular monolith with Hexagonal Architecture. The initial localization foundation preceded IAM; IAM-02/03 now persist identity and preference data, but authenticated request-context wiring, product endpoints, and the frontend are still being implemented. The MVP needs locale, timezone, translation, and formatting support without coupling business logic to a translation provider or creating premature operations infrastructure.

## Decision

- Define localization contracts and locale/timezone resolution in the application layer; keep domain rules language-independent.
- Start with semantic-key JSON catalogs versioned with the application and the platform `Intl` APIs for plural, date, number, and currency formatting.
- Ship `pt-BR`, `en-US`, and `es-ES` catalogs. Configure `pt-BR` as the initial system locale (deployment-overridable to a shipped locale) and `UTC` as the system timezone fallback.
- Resolve authenticated locale as `User.locale` > `Tenant.defaultLocale` > `System.defaultLocale`; for anonymous contexts only, use a supported `Accept-Language` candidate after any tenant preference and before the system fallback.
- Assign nullable `defaultLocale` and `timezone` to Tenant; assign nullable locale/timezone overrides to User. Tenant `currency` is required as a supported ISO 4217 code with no inferred/default value. Do not infer currency from locale or duplicate currency on users.
- Persist instants in UTC and transport them as ISO 8601 timestamps with explicit offsets. Localize presentation only with an explicit resolved timezone.
- Keep the localization resolver stateless. IAM-02/03 provide identity and preference persistence; FND-04 and IAM-06 wire preferences into request/frontend presentation using these existing boundaries.

## Translation storage alternatives

| Alternative | Advantages | Disadvantages | Assessment |
|---|---|---|---|
| Versioned JSON/YAML in source | Small, reviewable, deterministic, deploys with code, easy offline tests | Catalog changes require deployment; no non-engineer editing workflow | Selected for the MVP; JSON needs no added dependency |
| Database catalogs | Runtime edits, tenant-specific content, central management | Schema, cache invalidation, permissions, migrations, operational consistency | Defer until runtime editing or tenant-specific translations are a requirement |
| External translation/localization service | Managed workflows, translator collaboration, delivery integrations | Provider coupling, network/runtime dependency, cost, secrets, outage behavior | Defer until catalog scale/workflow justifies it |
| Hybrid file seed plus database/service override | Migration path and operational flexibility | Precedence, caching, synchronization, and failure complexity now | Future option, not justified for current MVP |

## Consequences

### Benefits

- Domain and application business behavior remain independent of locale-specific strings and formatting libraries.
- Deterministic local catalogs support stable tests and deployments.
- Tenant defaults and user overrides have explicit ownership and a central resolution policy.
- Standard runtime `Intl` APIs avoid unnecessary dependencies while supporting CLDR locale rules and timezone-aware presentation.

### Costs and limitations

- Catalog updates require a code deployment.
- The initial supported locale set is finite and missing catalog entries must be caught in review/tests.
- Tenant/user preference persistence is implemented in IAM-03; authenticated request and frontend propagation remain pending FND-04/IAM-06.
- `Intl.NumberFormat` provides display formatting only; it does not define financial storage precision, rounding, or conversion rules.

## Migration path

Implement a database or external catalog adapter behind the same application port when runtime editing, tenant-specific translations, or translation workflow becomes necessary. Preserve semantic keys, plural categories, locale-resolution policy, and deterministic tests. Migration of catalog storage must not alter domain APIs. Add a cache/refresh policy only with a concrete runtime-update requirement.

## Open decisions

- Monetary storage precision and rounding must be specified with the first financial use case.
- Determine whether any HTTP use case needs localized user-facing message text in its response; APIs should otherwise return structured data and stable error codes.
- Review whether database constraints should supplement application validation for supported locales, IANA timezones, and ISO 4217 currencies; IAM-03 currently constrains currency length in SQL and validates supported codes in the application.
