# Facebook Integration

## Priority

P2

## Scope

Phase 1 connects only managed Facebook Pages. Personal profile timelines are unsupported.

## Phase 1 Account Connection

Local connection uses Facebook Login authorization code with single-use anti-CSRF `state`. It requests `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`, and `pages_manage_engagement`, exchanges the user token for a long-lived token, and verifies granted permissions before listing Pages.

The callback returns Page IDs/names and a short-lived selection ID, not tokens. The creator must explicitly choose one Page, even when multiple Pages are returned. The server revalidates that choice and stores only its Page-scoped token in the encrypted SocialCredentialVault. Page access requires the `MODERATE` task for the comment workflow. Page tokens are not refreshed using YouTube behavior; revoked/invalid Page authorization requires reconnection.

Runtime configuration is read only when an OAuth request runs:

- `FACEBOOK_OAUTH_CLIENT_ID`
- `FACEBOOK_OAUTH_CLIENT_SECRET`
- `FACEBOOK_OAUTH_REDIRECT_URI`
- `META_GRAPH_API_VERSION`

Local OAuth tests use deterministic fetch/HTTP doubles. Live Meta access and App Review are still pending. Connection performs no replies or other Page writes.

## Capabilities

- Page connection and selection;
- existing Page publication listing;
- supported comment read/reply;
- Phase 4 Page video publication and metrics remain separate capability checks.
