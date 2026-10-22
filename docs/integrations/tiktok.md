# TikTok Integration

## Priority

P3

## MVP Target

TikTok Business accounts and comments/replies/likes for owned organic videos through TikTok API for Business. TikTok Research API is not the commercial product integration path. The OAuth connection is implemented but remains inactive until the app-generated authorization URL and runtime credentials are configured.

## Local OAuth Connection

The backend implements the TikTok for Business account-code flow without embedding app-specific values. `GET /social/connections/tiktok/authorize` redirects to the account authorization URL generated in TikTok for Business My Apps, supplied at runtime, and appends a random five-minute anti-CSRF state. The callback accepts `auth_code` and `code` as aliases, validates one-time state, and normalizes the value to `auth_code` for `POST /open_api/v1.3/tt_user/oauth2/token/`, which sends `client_id`, `client_secret`, `grant_type=authorization_code`, `auth_code`, and the registered `redirect_uri`. The documented account-token exchange has no `code_verifier` field; this flow does not send PKCE parameters.

The token response's `open_id` becomes the external account identity. The client requires `video.list`, `comment.list`, and `comment.list.manage`; access/refresh tokens, their expiry values, and granted scopes are stored only in the tenant-scoped encrypted SocialCredentialVault. TikTok access tokens are refreshed using `/tt_user/oauth2/refresh_token/`; tests use deterministic fetch doubles and no provider credentials.

Configure these values only in the runtime secret/configuration store; empty settings do not block API startup:

- `TIKTOK_BUSINESS_CLIENT_ID`
- `TIKTOK_BUSINESS_CLIENT_SECRET`
- `TIKTOK_BUSINESS_REDIRECT_URI`
- `TIKTOK_BUSINESS_AUTHORIZATION_URL` — copy the account-holder authorization URL generated in TikTok for Business My Apps; the code does not guess or construct this app-specific URL.
- `TIKTOK_BUSINESS_STATE_PARAMETER` — defaults to `state`.

TikTok's [official short-term token documentation](https://business-api.tiktok.com/portal/docs/obtain-a-short-term-access-token/v1.3) specifies one-day access-token and one-year refresh-token lifetimes and directs refreshes to `/tt_user/oauth2/refresh_token/`. The [official renewal reference](https://business-api.tiktok.com/portal/docs/renew-a-short-term-access-token/v1.3) describes renewal by refresh token; the local adapter's JSON fields (`client_id`, `client_secret`, `grant_type=refresh_token`, and `refresh_token`) match that contract. Deterministic doubles cover the payload, but verification against an approved TikTok Business app remains pending before live rollout. TikTok also documents a distinct [short-term access-token revocation endpoint](https://business-api.tiktok.com/portal/docs/revoke-a-short-term-access-token/v1.3) at `/tt_user/oauth2/revoke/`; the application does not expose or call it. Do not use advertiser/business-token `/oauth2/revoke_token/` for TikTok account tokens.

The provided `developers.tiktok.com` docs are a separate product family: Display API documents `video.list` for a user's public videos, while its comment query is part of Research API and uses `research.data.basic` for research purposes. Those APIs do not authorize commercial TikTok Business comment management/replies and cannot replace TikTok API for Business.


## References

- [Accounts API — Authorization](https://business-api.tiktok.com/gateway/docs/index?doc_id=1737565048641538)
- [Authorization FAQs](https://business-api.tiktok.com/gateway/docs/index?doc_id=1766037914914818)
- [Manage comments on owned TikTok videos](https://business-api.tiktok.com/gateway/docs/index?doc_id=1752256376677378)
- [TikTok API for Business v1.3](https://business-api.tiktok.com/portal/docs/api-reference/v1.3)
- [Obtain a short-term access token](https://business-api.tiktok.com/portal/docs/obtain-a-short-term-access-token/v1.3) — official code exchange and response example containing `video.list`, `comment.list`, and `comment.list.manage`.
- [Renew a short-term access token](https://business-api.tiktok.com/portal/docs/renew-a-short-term-access-token/v1.3) — TikTok account-token refresh flow.
- [Revoke a short-term access token](https://business-api.tiktok.com/portal/docs/revoke-a-short-term-access-token/v1.3) — TikTok account-token revoke contract; not currently invoked by this application.
- [Business API authentication](https://business-api.tiktok.com/portal/docs/authentication/v1.3)
- [Manage comments on owned TikTok videos](https://business-api.tiktok.com/portal/docs/manage-comments-on-owned-tiktok-videos/v1.3)
- [Like/unlike an owned-video comment](https://business-api.tiktok.com/portal/docs?id=1762228456608770) — `POST /open_api/v1.3/business/comment/like/` accepts `business_id`, `comment_id`, and `action` (`LIKE` or `UNLIKE`); comment-management access is required.
- [TikTok for Developers Login Kit for Web](https://developers.tiktok.com/doc/login-kit-web)
- [TikTok for Developers scopes reference](https://developers.tiktok.com/doc/tiktok-api-scopes)
- [Display API overview](https://developers.tiktok.com/doc/display-api-overview) and [video list endpoint](https://developers.tiktok.com/doc/tiktok-api-v2-video-list) — `video.list` is for public video metadata.
- [Research API video-comment query](https://developers.tiktok.com/doc/research-api-specs-query-video-comments?enter_method=left_navigation) — comments are under the Research API scope `research.data.basic`, not commercial Business API comment management.
- [TikTok for Developers user-token management](https://developers.tiktok.com/doc/oauth-user-access-token-management)
