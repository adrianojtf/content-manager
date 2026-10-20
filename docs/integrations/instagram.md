# Instagram Integration

## Priority

P1

## Phase 1 Account Connection

Local OAuth connection uses the official Instagram Login flow for professional Business/Creator accounts. It requests only `instagram_business_basic` and `instagram_business_manage_comments`, sets anti-CSRF `state`, and disables the Facebook Login option. The official Business Login parameters reviewed here do not document PKCE; this adapter does not add Google/YouTube PKCE parameters.

The callback exchanges the code for a short-lived token, verifies the exact required grants, upgrades to a 60-day long-lived token, and verifies the app-scoped account ID with `/me?fields=id,username`. The API Login contract is professional-only; consumer accounts are not supported. Tokens and granted scopes are encrypted in the SocialCredentialVault, never returned by the API.

Long-lived tokens are proactively refreshed through the Instagram refresh endpoint within seven days of expiry while still valid. A rejected/expired token requires reauthorization. OAuth settings are lazy and do not block startup:

- `INSTAGRAM_OAUTH_CLIENT_ID`
- `INSTAGRAM_OAUTH_CLIENT_SECRET`
- `INSTAGRAM_OAUTH_REDIRECT_URI`
- `META_GRAPH_API_VERSION`

Local implementation is covered with deterministic fetch doubles. Live Meta app access, Standard/Advanced Access, and App Review are not verified by these tests and remain prerequisites for production accounts.

## Capabilities

Phase 1 target: professional Business/Creator accounts, their own media, and supported comment read/reply operations. Phase 4 Reel publishing and insights are separate capability checks and are not enabled by this connection flow.

## AI Flow

Instagram comments are normalized into the common Comment model before JEV evaluation.
