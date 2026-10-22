const oauthPlatforms = new Set(['youtube', 'instagram', 'facebook', 'tiktok']);

export class OAuthFlowError extends Error {
  constructor(code) {
    super(code);
    this.name = 'OAuthFlowError';
    this.code = code;
  }
}

export function buildOAuthAuthorizePath(platform, { enableReplies = false } = {}) {
  if (!oauthPlatforms.has(platform)) throw new OAuthFlowError('SOCIAL_ACCOUNT_PLATFORM_UNSUPPORTED');
  const suffix = platform === 'youtube' && enableReplies ? '?enableReplies=true' : '';
  return `/social/connections/${platform}/authorize${suffix}`;
}

export function normalizeOAuthCallbackResult(platform, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new OAuthFlowError('OAUTH_CALLBACK_INVALID');
  }
  if (typeof payload.code === 'string') throw new OAuthFlowError(payload.code);
  if (platform === 'facebook' && typeof payload.selectionId === 'string' && Array.isArray(payload.pages)) {
    return {
      type: 'facebook-pages',
      selectionId: payload.selectionId,
      pages: payload.pages
        .filter((page) => typeof page?.externalAccountId === 'string')
        .map((page) => ({ pageId: page.externalAccountId, displayName: page.displayName ?? null })),
    };
  }
  if (payload.platform === platform && typeof payload.id === 'string' && typeof payload.externalAccountId === 'string') {
    return {
      type: 'connected',
      account: {
        id: payload.id,
        platform: payload.platform,
        externalAccountId: payload.externalAccountId,
        displayName: typeof payload.displayName === 'string' ? payload.displayName : null,
      },
    };
  }
  throw new OAuthFlowError('OAUTH_CALLBACK_INVALID');
}

export function openOAuthPopup(platform, {
  enableReplies = false,
  windowRef = window,
  pollIntervalMs = 350,
  timeoutMs = 240_000,
} = {}) {
  const popup = windowRef.open(
    buildOAuthAuthorizePath(platform, { enableReplies }),
    `creator-oauth-${platform}`,
    'popup,width=640,height=760',
  );
  if (!popup) return Promise.reject(new OAuthFlowError('OAUTH_POPUP_BLOCKED'));

  return new Promise((resolve, reject) => {
    let settled = false;
    const interval = windowRef.setInterval(checkCallback, pollIntervalMs);
    const timeout = windowRef.setTimeout(() => finish(new OAuthFlowError('OAUTH_POPUP_TIMEOUT')), timeoutMs);

    function finish(error, result) {
      if (settled) return;
      settled = true;
      windowRef.clearInterval(interval);
      windowRef.clearTimeout(timeout);
      try { popup.close(); } catch {}
      if (error) reject(error);
      else resolve(result);
    }

    function checkCallback() {
      if (popup.closed) {
        finish(new OAuthFlowError('OAUTH_POPUP_CLOSED'));
        return;
      }
      try {
        const callbackUrl = new URL(popup.location.href);
        if (callbackUrl.origin !== windowRef.location.origin
          || (!callbackUrl.pathname.endsWith('/callback') && !callbackUrl.pathname.endsWith('/authorize'))) return;
        const body = popup.document.body?.innerText?.trim();
        if (!body) return;
        const result = normalizeOAuthCallbackResult(platform, JSON.parse(body));
        finish(null, result);
      } catch (error) {
        if (error instanceof OAuthFlowError) finish(error);
      }
    }
  });
}
