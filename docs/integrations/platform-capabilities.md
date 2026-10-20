# Platform Capability Matrix

Statuses:

- AVAILABLE — the API documents the operation; account authorization and operation-specific eligibility still apply.
- LIMITED — the operation is available only for specified account types or content.
- REQUIRES_APPROVAL — app review/advanced access or provider OAuth verification may be required for accounts outside the app's own test roles.
- UNAVAILABLE
- UNKNOWN — not verified; do not dispatch.

Capability reference baseline reviewed against official provider documentation on 2026-10-14. Active MVP target scope is YouTube, Instagram professional Business/Creator accounts, managed Facebook Pages, and TikTok Business accounts for owned organic videos. Local OAuth connection is implemented for YouTube, Instagram, Facebook Pages, and TikTok Business using the app-generated TikTok authorization URL as runtime configuration. Local tests do not prove provider credentials, app approvals, live access, or refresh behavior. Verify current API versions, account eligibility, scopes, access tiers, and error/rate limits independently before production release.

| Capability reference | YouTube | Instagram | Facebook Pages | TikTok |
|---|---|---|---|---|
| Supported account/content | Authorized creator channel | Professional Business or Creator account; only media owned/managed by the connected account | Pages the authorizing user manages | TikTok Business account; owned organic videos only |
| List existing publications | AVAILABLE — resolve the authenticated channel's uploads playlist, then list playlist items | AVAILABLE — list connected account media | AVAILABLE — list posts for an authorized Page | AVAILABLE — Business API lists owned-account videos; account/app access must be verified |
| Read comments | AVAILABLE — list comment threads on videos; comments may be disabled or inaccessible | AVAILABLE — list comments on the connected account's media | AVAILABLE — Page post comments, subject to Page access and permissions for user-generated content | AVAILABLE — Business API lists comments on owned organic videos; live access/permissions unverified |
| Send manual reply | AVAILABLE — reply to a replyable comment; OAuth write scope required | AVAILABLE — public reply on eligible comments on owned media; comment-management permission required | AVAILABLE — create a reply to a Page post comment; Page access and comment-management permissions required | AVAILABLE — Business API supports reply creation on owned organic videos; exact app permission/access must be verified |
| Account authorization / access | OAuth 2.0; `youtube.readonly` for reads, `youtube.force-ssl` for replies. The reply scope is broad; assess Google OAuth verification before public use. | Instagram Login for Business/Creator accounts; `instagram_business_basic` to identify/list media and `instagram_business_manage_comments` for comment operations. Standard/Advanced Access depends on app-user relationship. | Facebook Login; list managed Pages with `pages_show_list`, read Page content with `pages_read_engagement`, read user-generated Page content with `pages_read_user_content`, and reply/manage comments with `pages_manage_engagement`. Advanced access/app review may be needed beyond app-role test accounts. | TikTok for Business account-token example includes `video.list`, `comment.list`, and `comment.list.manage`; per-endpoint grants and app access still require confirmation. |
| Local OAuth implementation | Implemented with state/PKCE; live Google verification/test-client approval pending. | Implemented using Instagram Login, state, exact grants, long-lived token upgrade/refresh; live Meta access/App Review pending. | Implemented using state, permission validation, Page-scoped token, and explicit Page selection; live Meta access/App Review pending. | Implemented using configured app URL, state, `auth_code`/`code` callback, token exchange, and encrypted scope/token persistence; live access/refresh verification pending; official account-token revoke endpoint documented but not exposed by the app. |

Phase 4 video publishing remains out of this matrix's verified scope. Scheduling, retry semantics, media limits, and platform-specific publishing permissions must be verified before that phase ships.

## Provider references

### YouTube Data API

- [Retrieve a channel's uploaded videos](https://developers.google.com/youtube/v3/guides/implementation/videos) — use `channels.list(mine=true)` to find the uploads playlist, then `playlistItems.list`; pagination is provider-owned.
- [CommentThreads: list](https://developers.google.com/youtube/v3/docs/commentThreads/list) — list comments; `maxResults` is at most 100, use `nextPageToken`; quota cost is 1 unit per call.
- [Comments: list](https://developers.google.com/youtube/v3/docs/comments/list) — retrieve replies when the thread response does not include them all.
- [Comments: insert](https://developers.google.com/youtube/v3/docs/comments/insert) — create a reply with the parent comment ID; requires `youtube.force-ssl`, costs 50 quota units, and fails when replying is unsupported for the comment.
- [YouTube Data API quota overview](https://developers.google.com/youtube/v3/getting-started) — default quota allocation and extension process.
- [Google sensitive-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification) — public OAuth use may require verification; request the narrowest possible scope.

### Instagram

- [Business Login for Instagram](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login) — Instagram Login endpoints, state, professional-account access level, and current `instagram_business_*` scopes.
- [Long-Lived Access Tokens](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/long-lived-access-tokens) — token exchange, 60-day lifetime, refresh conditions, and refresh endpoint.
- [IG User reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user) — professional Business/Creator identity and supported profile fields.
- [Meta Instagram API collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api) — official Meta API collection for Instagram Login and Facebook Login; select one login path and request only its required permissions.
- [Comment Moderation](https://www.postman.com/meta/instagram/folder/23987686-b2d826e8-2090-4859-a3b2-ab1ce4308bc1) — documents comment listing, replies, and reply creation on media owned by app users.

### Facebook Pages

- [Manually Build a Facebook Login Flow](https://developers.facebook.com/documentation/facebook-login/guides/advanced/manual-flow) — server-side code flow, redirect URI, `state`, scopes, and authorization-code exchange.
- [Access Tokens for Meta Technologies](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/) — Page access tokens are derived from a user access token and `/me/accounts` returns Page IDs, tokens, and tasks.
- [Get Started with the Pages API](https://developers.facebook.com/docs/pages-api/getting-started/) — Page-scoped token and Page-task requirements.
- [Meta Facebook API collection](https://www.postman.com/meta/facebook/documentation/r56bjfd/facebook-api) — official Meta collection for Pages and Graph API operations.
- [Meta Permissions Reference](https://developers.facebook.com/docs/permissions/) — source of truth for permission descriptions, dependencies, and access requirements.

### TikTok Business

- [TikTok API for Business v1.3 reference](https://business-api.tiktok.com/portal/docs/api-reference/v1.3) — lists `/business/video/list/`, `/business/comment/list/`, `/business/comment/reply/create/`, and the TikTok-account token endpoints.
- [TikTok for Business authentication API](https://business-api.tiktok.com/portal/docs/authentication/v1.3) — distinguishes long-lived advertiser/business-center tokens from short-term TikTok-account tokens and lists refresh/revoke operations.
- [Obtain a short-term TikTok account access token](https://business-api.tiktok.com/portal/docs/obtain-a-short-term-access-token/v1.3) — documents the code-exchange request/response, token lifetimes, and example TikTok Accounts scopes.
- [Manage comments on owned TikTok videos](https://business-api.tiktok.com/portal/docs/manage-comments-on-owned-tiktok-videos/v1.3) — documents the organic owned-video comment-management capability.
- [TikTok for Developers Login Kit for Web](https://developers.tiktok.com/doc/login-kit-web) and [user-token management](https://developers.tiktok.com/doc/oauth-user-access-token-management) — document a separate developer OAuth/API scope family; these do not verify Business API scope names.
- [TikTok Research API eligibility](https://developers.tiktok.com/products/research-api/) — Research API use is limited to approved non-commercial research and is not the MVP integration path.

The application must never assume capability parity between platforms. Unsupported, unauthorized, or rate-limited operations must return explicit per-platform outcomes and must not suppress successes from other accounts.
