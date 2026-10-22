# Facebook Integration

## Priority

P2

## Scope

Phase 1 connects only managed Facebook Pages. Personal profile timelines are unsupported.

## Phase 1 Account Connection

Local connection uses Facebook Login authorization code with single-use anti-CSRF `state`. It requests `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`, and `pages_manage_engagement`, exchanges the user token for a long-lived token, and verifies granted permissions before listing Pages. When the Meta app only offers Facebook Login for Business, set `FACEBOOK_OAUTH_CONFIG_ID` to the login configuration created in the dashboard; the authorization then sends `config_id` instead of `scope` and the configuration must enable the same four permissions.

Meta token responses may omit `expires_in` when the token has no reported expiry; the adapter accepts that while still requiring `access_token` and `token_type=bearer`, and the temporary user credential is still capped at five minutes.

The callback returns Page IDs/names and a short-lived selection ID, not tokens. The creator must explicitly choose one Page, even when multiple Pages are returned. The server revalidates that choice and stores only its Page-scoped token in the encrypted SocialCredentialVault. Page access requires the `MODERATE` task for the comment workflow. Page tokens are not refreshed using YouTube behavior; revoked/invalid Page authorization requires reconnection.

Runtime configuration is read only when an OAuth request runs:

- `FACEBOOK_OAUTH_CLIENT_ID`
- `FACEBOOK_OAUTH_CLIENT_SECRET`
- `FACEBOOK_OAUTH_REDIRECT_URI`
- `FACEBOOK_OAUTH_CONFIG_ID` (optional; required for Facebook Login for Business)
- `META_GRAPH_API_VERSION`

Local OAuth tests use deterministic fetch/HTTP doubles. Live Meta access and App Review are still pending. Connection performs no replies, likes, or other Page writes; each supported action requires a separate creator click.

## Capabilities

- Page connection and selection;
- existing Page publication listing;
- supported comment read/reply and like/unlike via the Comment `/likes` edge with `pages_manage_engagement`;
- Phase 4 Page video publication and metrics remain separate capability checks.
