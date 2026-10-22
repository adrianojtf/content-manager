# Instagram Integration

## Priority

P1

## Phase 1 Account Connection

Local OAuth connection uses the official Instagram Login flow for professional Business/Creator accounts. It requests only `instagram_business_basic` and `instagram_business_manage_comments`, sets anti-CSRF `state`, and disables the Facebook Login option. The official Business Login parameters reviewed here do not document PKCE; this adapter does not add Google/YouTube PKCE parameters.

The callback exchanges the code for a short-lived token, accepting either the flat response or exactly one wrapped `data` entry and requiring explicit granted permissions. It verifies the exact required grants, upgrades to a 60-day long-lived token, and reads `/me?fields=id,user_id,username` (flat or `data`-wrapped). The token-exchange `user_id` must match either the app-scoped `id` or the professional-account `user_id`; numeric IDs are parsed without JSON precision loss. The professional `user_id` is stored as the external account ID used by `/{ig-id}/media` and webhook notifications. The API Login contract is professional-only; consumer accounts are not supported. Tokens and granted scopes are encrypted in the SocialCredentialVault, never returned by the API.

Comment sync reads `/{ig-media-id}/comments` with the documented field set (`id,text,timestamp,username,hidden,parent_id,from{id,username}`) plus the inline `replies{id,text,timestamp,username,from{id,username}}` edge. Comment authors resolve from `username` with `from.username` as fallback, because Instagram Login omits `username` for non-app commenters. A reply is stored as creator-authored only when its `from.id` equals the connected professional account ID; comments are `REPLIED` only on that match; `NOT_REPLIED` when the reply list is complete without one or when the `replies` edge is omitted entirely with no nested replies in the same page — Instagram omits the edge for comments without replies; and `UNKNOWN` when the `replies` edge is present but malformed/paginated, or omitted while a nested reply referencing the comment exists in the stream.

Long-lived tokens are proactively refreshed through the Instagram refresh endpoint within seven days of expiry while still valid. A rejected/expired token requires reauthorization. OAuth settings are lazy and do not block startup:

- `INSTAGRAM_OAUTH_CLIENT_ID`
- `INSTAGRAM_OAUTH_CLIENT_SECRET`
- `INSTAGRAM_OAUTH_REDIRECT_URI`
- `META_GRAPH_API_VERSION`

Local implementation is covered with deterministic fetch doubles. Live Meta app access, Standard/Advanced Access, and App Review are not verified by these tests and remain prerequisites for production accounts.

## Capabilities

Phase 1 target: professional Business/Creator accounts, their own media, and supported comment read/reply operations. The Meta Like Media and Comments API can like/unlike comments and replies with Facebook Login and `instagram_manage_engagement`, but this integration uses Instagram Login and `instagram_business_*` permissions. Do not expose the like control for these accounts until a Facebook Login/Page-linked account flow obtains and stores the required permission. Stories and private-account content are not supported. Phase 4 Reel publishing and insights are separate capability checks and are not enabled by this connection flow.

## AI Flow

Instagram comments are normalized into the common Comment model before JEV evaluation.
