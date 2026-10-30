import { apiErrorMessage, formatDateTime, formatNumber, socialSyncFailureMessage, t, uiLocale } from './i18n.mjs';
import { localizedAnalysisEnum, renderAnalysisEvidence, renderAnalysisGauge } from './analysis-visuals.mjs';

export const networkInfo = Object.freeze({
  instagram: { nameKey: 'network.name.instagram', symbol: '◎', className: 'instagram' },
  facebook: { nameKey: 'network.name.facebook', symbol: 'f', className: 'facebook' },
  tiktok: { nameKey: 'network.name.tiktok', symbol: '♪', className: 'tiktok' },
  youtube: { nameKey: 'network.name.youtube', symbol: '▶', className: 'youtube' },
});

function commentAuthorFallback(comment) {
  const info = networkInfo[comment.platform];
  return info ? t('comment.unknownAuthorForNetwork', { network: t(info.nameKey) }) : t('comment.unknownAuthor');
}

const responseEventTypes = new Set([
  'RESPONSE_SUGGESTION_GENERATED',
  'RESPONSE_SUGGESTION_EDITED',
  'MANUAL_RESPONSE_CREATED',
  'MANUAL_RESPONSE_EDITED',
]);
const supportedTimeZoneIds = getSupportedTimeZoneIds();
const timeZoneOptionMarkup = new Map();

const eventLabels = {
  COMMENT_SYNCED: 'event.sync',
  COMMENT_ANALYSIS_CREATED: 'event.analysis',
  COMMENT_ANALYSIS_CORRECTED: 'event.correction',
  RESPONSE_SUGGESTION_GENERATED: 'event.suggestion',
  RESPONSE_SUGGESTION_EDITED: 'event.suggestionEdit',
  MANUAL_RESPONSE_CREATED: 'event.manualResponse',
  MANUAL_RESPONSE_EDITED: 'event.manualEdit',
  RESPONSE_EVALUATED: 'event.responseEvaluation',
  COMMENT_LIKE_CHANGED: 'event.likeAdded',
  MANUAL_REPLY_ATTEMPTED: 'event.sendStarted',
  MANUAL_REPLY_RESULT: 'event.sendFailed',
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

export function formatDate(value) {
  if (!value) return t('date.unavailable');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return t('date.unavailable');
  return formatDateTime(date);
}

export function formatRelative(value, now = Date.now()) {
  if (!value) return t('date.unavailable');
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return t('date.unavailable');
  const minutes = Math.round((timestamp - now) / 60_000);
  const unit = Math.abs(minutes) < 60 ? 'minute' : Math.abs(minutes) < 1440 ? 'hour' : 'day';
  const divisor = unit === 'minute' ? 1 : unit === 'hour' ? 60 : 1440;
  return new Intl.RelativeTimeFormat(uiLocale, { numeric: 'auto' }).format(Math.round(minutes / divisor), unit);
}

export function effectiveAnalysis(events = []) {
  const analysisEvent = [...events].reverse().find((event) => event.eventType === 'COMMENT_ANALYSIS_CREATED' && event.status !== 'FAILED');
  if (!analysisEvent) return null;
  return events
    .filter((event) => event.eventType === 'COMMENT_ANALYSIS_CORRECTED' && event.status !== 'FAILED' && event.parentEventId === analysisEvent.id)
    .reduce((analysis, event) => ({ ...analysis, ...(event.payload.correctedFields ?? {}) }), { ...analysisEvent.payload });
}

export function latestResponseVersion(events = [], language) {
  const usable = events.filter((event) => responseEventTypes.has(event.eventType)
    && event.status !== 'FAILED' && event.status !== 'UNSUPPORTED');
  if (!language) return usable.at(-1) ?? null;

  const selectedRoot = [...usable].reverse().find((event) => event.eventType === 'RESPONSE_SUGGESTION_GENERATED'
    && event.payload.language === language);
  const selectedAi = selectedRoot
    ? [...usable].reverse().find((event) => event.id === selectedRoot.id
      || (event.eventType === 'RESPONSE_SUGGESTION_EDITED' && event.payload.originalSuggestionEventId === selectedRoot.id))
    : null;
  const latestManual = [...usable].reverse().find((event) => (
    event.eventType === 'MANUAL_RESPONSE_CREATED' || event.eventType === 'MANUAL_RESPONSE_EDITED'
  ));
  if (!latestManual) return selectedAi;
  if (!selectedAi) return latestManual;
  return usable.indexOf(latestManual) > usable.indexOf(selectedAi) ? latestManual : selectedAi;
}

export function responseVersionDetails(events = [], language) {
  const version = latestResponseVersion(events, language);
  if (!version) return null;
  const isSuggestion = version.eventType.startsWith('RESPONSE_SUGGESTION');
  const rootId = version.eventType === 'RESPONSE_SUGGESTION_GENERATED' || version.eventType === 'MANUAL_RESPONSE_CREATED'
    ? version.id
    : version.payload.originalSuggestionEventId ?? version.payload.originalManualResponseEventId;
  return {
    version,
    rootId,
    kind: isSuggestion ? 'suggestion' : 'manual',
    isRevision: version.eventType === 'RESPONSE_SUGGESTION_EDITED' || version.eventType === 'MANUAL_RESPONSE_EDITED',
  };
}

export function latestResponseEvaluation(events = [], versionId) {
  if (!versionId) return null;
  return [...events].reverse().find((event) => event.eventType === 'RESPONSE_EVALUATED'
    && event.status !== 'FAILED' && event.parentEventId === versionId) ?? null;
}

export function hasAttemptedVersion(events = [], versionId) {
  return events.some((event) => event.eventType === 'MANUAL_REPLY_ATTEMPTED'
    && (event.parentEventId === versionId || event.payload.revisionEventId === versionId || event.payload.responseVersionEventId === versionId));
}

export function renderSocialTabs(activeNetwork, counts) {
  return Object.entries(networkInfo).map(([platform, info]) => {
    const count = counts[platform] === null || counts[platform] === undefined ? '—' : formatNumber(counts[platform]);
    return `
    <button class="social-tab${platform === activeNetwork ? ' active' : ''}" type="button" role="tab"
      aria-selected="${platform === activeNetwork}" data-network="${platform}">
      <span class="social-logo ${info.className}" aria-hidden="true">${info.symbol}</span>
      ${t(info.nameKey)}<span class="tab-count">${count}</span>
    </button>`;
  }).join('');
}

export function renderAccountOptions(accounts, selectedId) {
  if (!accounts.length) return `<option value="">${t('toolbar.noAccounts')}</option>`;
  return `<option value=""${selectedId ? '' : ' selected'}>${t('toolbar.allAccounts')}</option>${accounts.map((account) => `<option value="${escapeHtml(account.id)}"${account.id === selectedId ? ' selected' : ''}>${escapeHtml(account.displayName || account.externalAccountId)}</option>`).join('')}`;
}

export function renderPublicationPagination(account, model) {
  if (!model.hasPrevious && !model.hasNext && !model.loading) return '';
  const name = account.displayName || account.externalAccountId;
  return `<nav class="publication-pagination" aria-label="${escapeHtml(t('publication.paginationLabel', { name }))}"${model.loading ? ' aria-busy="true"' : ''}>
    <button class="button small" type="button" data-action="publication-page" data-account-id="${escapeHtml(account.id)}" data-direction="previous" ${!model.hasPrevious || model.loading ? 'disabled' : ''}>${t('publication.previousPage')}</button>
    <span>${model.loading ? `<span class="spinner" aria-hidden="true"></span>${t('publication.loadingPage')}` : t('publication.pageNumber', { page: formatNumber(model.pageIndex + 1) })}</span>
    <button class="button small" type="button" data-action="publication-page" data-account-id="${escapeHtml(account.id)}" data-direction="next" ${!model.hasNext || model.loading ? 'disabled' : ''}>${t('publication.nextPageOfVideos')}</button>
  </nav>`;
}

export function renderConnectionSettings(accounts, model) {
  if (model.loading) return `<div class="loading-state"><span class="spinner"></span> ${t('settings.loading')}</div>`;
  if (model.error) {
    return `<div class="error-state">${escapeHtml(model.error)}<button class="button small" type="button" data-action="refresh-connected-accounts">${t('publication.retry')}</button></div>`;
  }
  const cards = Object.entries(networkInfo).map(([platform, info]) => {
    const connected = accounts.filter((account) => account.platform === platform);
    const isConnecting = model.connecting.has(platform);
    const accountList = connected.length
      ? `<ul class="connected-account-list">${connected.map((account) => {
        const name = account.displayName || account.externalAccountId;
        const isDisconnecting = model.disconnectingAccounts?.has(account.id) ?? false;
        return `<li><span class="account-dot"></span><span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(account.externalAccountId)}</small></span><span class="connected-account-actions"><span class="pill done">${t('settings.connected')}</span><button class="button small danger" type="button" data-action="disconnect-social-account" data-account-id="${escapeHtml(account.id)}" aria-label="${escapeHtml(t('settings.disconnectAria', { name }))}" ${isDisconnecting ? 'disabled' : ''}>${isDisconnecting ? t('settings.disconnecting') : t('settings.disconnect')}</button></span></li>`;
      }).join('')}</ul>`
      : `<p class="empty-copy">${t('settings.noAccounts')}</p>`;
    const countKey = connected.length === 1 ? 'settings.connectedCount.one' : 'settings.connectedCount.other';
    const connectButton = `<button class="button small primary" type="button" data-action="connect-social-network" data-platform="${platform}" ${isConnecting ? 'disabled' : ''}>${isConnecting ? t('settings.oauthWaiting') : t('settings.connect')}</button>`;
    const youtubeReplyButton = platform === 'youtube'
      ? `<button class="button small" type="button" data-action="connect-social-network" data-platform="youtube" data-enable-replies="true" ${isConnecting ? 'disabled' : ''}>${t('settings.connectYouTubeReplies')}</button>`
      : '';
    return `<article class="connection-card">
      <div class="connection-card-head">
        <span class="social-logo ${info.className}" aria-hidden="true">${info.symbol}</span>
        <div><h3>${t(info.nameKey)}</h3><p>${t(`network.${platform}Content`)}</p></div>
        <span class="connection-count">${t(countKey, { count: formatNumber(connected.length) })}</span>
      </div>
      ${accountList}
      <div class="connection-actions">${connectButton}${youtubeReplyButton}</div>
    </article>`;
  }).join('');

  const pageSelection = model.facebookSelection
    ? `<section class="facebook-selection">
        <div><h3>${t('settings.facebookSelectionTitle')}</h3><p>${t('settings.facebookSelectionDescription')}</p></div>
        <label class="field"><span>${t('settings.facebookPage')}</span><select id="facebookPageSelect">${model.facebookSelection.pages.map((page) => `<option value="${escapeHtml(page.pageId)}"${page.pageId === model.selectedFacebookPageId ? ' selected' : ''}>${escapeHtml(page.displayName || page.pageId)}</option>`).join('')}</select></label>
        <div class="connection-actions">
          <button class="button primary" type="button" data-action="select-facebook-page" ${model.connecting.has('facebook-select') || !model.facebookSelection.pages.length ? 'disabled' : ''}>${model.connecting.has('facebook-select') ? t('settings.oauthWaiting') : t('settings.facebookSelect')}</button>
          <button class="button" type="button" data-action="cancel-facebook-selection">${t('settings.facebookCancel')}</button>
        </div>
      </section>`
    : '';

  return `<div class="settings-intro">${t('settings.security')}</div>${pageSelection}<div class="connection-grid">${cards}</div><p class="settings-footnote">${t('settings.connectHint')}</p>`;
}

export function renderAppearanceSettings(theme, locale = uiLocale) {
  const selectedTheme = theme === 'dark' ? 'dark' : 'light';
  return `<section class="appearance-card">
    <div><h3>${t('settings.appearance')}</h3><p>${t('settings.appearanceDescription')}</p></div>
    <div class="appearance-controls">
      <label class="field locale-field" for="uiLocaleSelect"><span>${t('settings.language')}</span>
        <select id="uiLocaleSelect" data-locale-option>
          <option value="pt-BR"${locale === 'pt-BR' ? ' selected' : ''}>Português</option>
          <option value="en-US"${locale === 'en-US' ? ' selected' : ''}>English</option>
          <option value="es-ES"${locale === 'es-ES' ? ' selected' : ''}>Español</option>
        </select>
      </label>
      <fieldset class="appearance-options" aria-label="${t('settings.appearance')}">
        <label><input type="radio" name="themePreference" value="light" data-theme-option="light"${selectedTheme === 'light' ? ' checked' : ''}><span aria-hidden="true">☀</span>${t('settings.themeLight')}</label>
        <label><input type="radio" name="themePreference" value="dark" data-theme-option="dark"${selectedTheme === 'dark' ? ' checked' : ''}><span aria-hidden="true">☾</span>${t('settings.themeDark')}</label>
      </fieldset>
    </div>
  </section>`;
}

export function renderVerifiedReleaseSchedulePanel(model) {
  const days = [
    ['MONDAY', 'schedule.day.monday'],
    ['TUESDAY', 'schedule.day.tuesday'],
    ['WEDNESDAY', 'schedule.day.wednesday'],
    ['THURSDAY', 'schedule.day.thursday'],
    ['FRIDAY', 'schedule.day.friday'],
    ['SATURDAY', 'schedule.day.saturday'],
    ['SUNDAY', 'schedule.day.sunday'],
  ];
  const draft = model.draft ?? { enabled: false, daysOfWeek: [], localTime: '', timeZone: 'America/Sao_Paulo' };
  const globalScope = model.scope === 'GLOBAL';
  const disabled = (!globalScope && !model.accountSelected) || model.loading || model.saving || model.error?.kind === 'load';
  const validationError = model.error?.kind === 'validation'
    || model.error?.code === 'VERIFIED_RELEASE_SCHEDULE_INVALID';
  const selectedDays = new Set(draft.daysOfWeek ?? []);
  const errorMessage = model.error?.code
    ? apiErrorMessage(model.error.code)
    : model.error?.key
      ? t(model.error.key)
    : model.error?.message;
  const selectedTimeZone = String(draft.timeZone ?? '');
  const configuredStatus = () => {
    if (!model.schedule) return t(globalScope ? 'schedule.unconfiguredGlobal' : 'schedule.unconfigured');
    const enabledKey = model.schedule.enabled ? 'schedule.confirmedActive' : 'schedule.confirmedDisabled';
    const inheritedKey = model.schedule.enabled ? 'schedule.inheritedActive' : 'schedule.inheritedDisabled';
    const key = !globalScope && model.source === 'TENANT' ? inheritedKey : enabledKey;
    return t(key, { version: formatNumber(model.schedule.version) });
  };
  const status = !globalScope && !model.accountSelected
    ? t('schedule.selectAccount')
    : model.loading
      ? t('schedule.loading')
      : model.saving
        ? t('schedule.saving')
        : model.error
        ? model.error.kind === 'validation'
          ? errorMessage
          : t(model.error.kind === 'load' ? 'schedule.loadFailed' : 'schedule.saveFailed', { message: errorMessage })
        : model.dirty
          ? t(model.schedule ? 'schedule.unsavedWithSaved' : 'schedule.unsaved')
          : configuredStatus();

  return `<div class="verified-schedule-content">
    <div class="verified-schedule-heading">
      <div>
        <h3 id="verifiedReleaseScheduleHeading">${t(globalScope ? 'schedule.headingGlobal' : 'schedule.heading')}</h3>
        <p>${t(globalScope ? 'schedule.descriptionGlobal' : 'schedule.description')}</p>
      </div>
      <div class="settings-scope" role="group" aria-label="${escapeHtml(t('schedule.scopeLabel'))}">
        <button class="scope-option${globalScope ? '' : ' is-active'}" type="button" data-action="verified-schedule-scope" data-scope="ACCOUNT" aria-pressed="${String(!globalScope)}">${t('schedule.scopeAccount')}</button>
        <button class="scope-option${globalScope ? ' is-active' : ''}" type="button" data-action="verified-schedule-scope" data-scope="GLOBAL" aria-pressed="${String(globalScope)}">${t('schedule.scopeGlobal')}</button>
      </div>
    </div>
    <p class="verified-schedule-status${model.error ? ' has-error' : ''}" role="status" aria-live="polite">${escapeHtml(status)}</p>
    <form id="verifiedReleaseScheduleForm" novalidate>
      <div class="verified-schedule-fields">
        <label class="verified-schedule-enabled">
          <input type="checkbox" name="enabled" data-role="verified-schedule-enabled" ${draft.enabled ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
          <span>${t('schedule.enabled')}</span>
        </label>
        <fieldset class="field verified-schedule-days" aria-invalid="${validationError}" ${disabled ? 'disabled' : ''}>
          <legend>${t('schedule.days')}</legend>
          <div class="verified-schedule-day-options">
            ${days.map(([day, key]) => `<label><input type="checkbox" name="daysOfWeek" data-day-of-week="${day}" value="${day}" ${selectedDays.has(day) ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span>${t(key)}</span></label>`).join('')}
          </div>
        </fieldset>
        <label class="field">
          <span>${t('schedule.localTime')}</span>
          <input id="verifiedScheduleLocalTime" name="localTime" type="time" required aria-invalid="${validationError}" aria-describedby="verifiedScheduleLocalTimeHelp" value="${escapeHtml(draft.localTime ?? '')}" ${disabled ? 'disabled' : ''}>
          <small id="verifiedScheduleLocalTimeHelp">${t('schedule.localTimeHelp')}</small>
        </label>
        <label class="field">
          <span>${t('schedule.timeZone')}</span>
          <select id="verifiedScheduleTimeZone" name="timeZone" required aria-invalid="${validationError}" aria-describedby="verifiedScheduleTimeZoneHelp" ${disabled ? 'disabled' : ''}>
            ${renderTimeZoneOptions(selectedTimeZone)}
          </select>
          <small id="verifiedScheduleTimeZoneHelp">${t('schedule.timeZoneHelp')}</small>
        </label>
      </div>
      <div class="verified-schedule-actions">
        <button class="button primary" id="saveVerifiedReleaseSchedule" type="submit" data-role="verified-schedule-save" ${disabled || model.canSave === false ? 'disabled' : ''}>${model.saving ? t('schedule.saving') : t('schedule.save')}</button>
        <button class="button small" type="button" data-action="retry-verified-schedule" ${model.error?.kind === 'load' ? '' : 'hidden'}>${t('schedule.retry')}</button>
      </div>
    </form>
  </div>`;
}

function getSupportedTimeZoneIds() {
  let identifiers;
  try {
    identifiers = typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : [];
  } catch {
    identifiers = [];
  }
  return [...new Set(['America/Sao_Paulo', 'UTC', ...identifiers])].sort((left, right) => left.localeCompare(right, 'en-US'));
}

function renderTimeZoneOptions(selectedTimeZone) {
  if (timeZoneOptionMarkup.has(selectedTimeZone)) return timeZoneOptionMarkup.get(selectedTimeZone);
  const identifiers = new Set(supportedTimeZoneIds);
  if (selectedTimeZone) identifiers.add(selectedTimeZone);
  const markup = [...identifiers]
    .sort((left, right) => left.localeCompare(right, 'en-US'))
    .map((timeZone) => `<option value="${escapeHtml(timeZone)}"${timeZone === selectedTimeZone ? ' selected' : ''}>${escapeHtml(timeZone)}</option>`)
    .join('');
  timeZoneOptionMarkup.set(selectedTimeZone, markup);
  return markup;
}

function renderSettingStatus(configured) {
  const label = configured ? t('aiSettings.configured') : t('aiSettings.notConfigured');
  return `<span class="setting-status ${configured ? 'configured' : 'not-configured'}">${label}</span>`;
}

function renderSecretField({ id, name, label, helper, configured, clearable = true }) {
  return `<div class="field secret-setting-field">
    <label for="${id}"><span>${t(label)} ${renderSettingStatus(configured)}</span></label>
    <input id="${id}" name="${name}" type="password" autocomplete="new-password" placeholder="••••••••" value="" aria-describedby="${id}Help ${id}WriteOnly" />
    <small id="${id}Help" class="field-help">${t(helper)}</small>
    <small id="${id}WriteOnly">${t('aiSettings.writeOnlyHint')}</small>
    ${clearable ? `<label class="clear-secret-option"><input type="checkbox" name="clear${id[0].toUpperCase()}${id.slice(1)}" value="true" ${configured ? '' : 'disabled'} />${t('aiSettings.clearSavedKey')}</label>` : ''}
  </div>`;
}

export function renderAIProviderSettings(model) {
  if (model.loading) return `<div class="loading-state"><span class="spinner"></span> ${t('aiSettings.loading')}</div>`;
  if (model.error) {
    return `<div class="error-state">${escapeHtml(model.error)}<button class="button small" type="button" data-action="reload-ai-settings">${t('publication.retry')}</button></div>`;
  }

  const jev = model.access?.jev ?? {};
  const providers = model.access?.textGeneration ?? {};
  const options = (model.models ?? []).map((option) => {
    const value = `${option.provider}/${option.model}`;
    const selected = model.active?.provider === option.provider && model.active?.model === option.model;
    return `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(option.displayName)}</option>`;
  }).join('');
  const saveLabel = model.saving ? t('aiSettings.saving') : t('aiSettings.save');
  const accessSaveLabel = model.accessSaving ? t('aiSettings.savingAccess') : t('aiSettings.saveAccess');
  const accessReady = model.access?.storageReady === true;

  return `<section class="ai-settings-grid" aria-label="${t('aiSettings.heading')}">
    <form class="ai-access-form" id="aiProviderAccessForm">
      <article class="ai-settings-card">
        <div class="ai-settings-card-heading"><span class="provider-mark jev-mark" aria-hidden="true">J</span><div><h3>TypeSafe · Jev</h3><p>${t('aiSettings.jevDescription')}</p></div></div>
        <div class="ai-access-fields">
          <p class="field-help">${t('aiSettings.jevEndpointInfo')}</p>
          ${renderSecretField({ id: 'jevApiKey', name: 'jevApiKey', label: 'aiSettings.jevApiKey', helper: 'aiSettings.jevApiKeyHelp', configured: jev.apiKeyConfigured })}
        </div>
      </article>
      <article class="ai-settings-card">
        <div class="ai-settings-card-heading"><span class="provider-mark llm-mark" aria-hidden="true">AI</span><div><h3>${t('aiSettings.textGeneration')}</h3><p>${t('aiSettings.textGenerationDescription')}</p></div></div>
        <div class="ai-access-fields">
          ${renderSecretField({ id: 'geminiApiKey', name: 'geminiApiKey', label: 'aiSettings.geminiApiKey', helper: 'aiSettings.geminiApiKeyHelp', configured: providers.google?.credentialsConfigured })}
          <label class="field" for="geminiDataUsePolicy"><span>${t('aiSettings.geminiDataPolicy')}</span>
            <select id="geminiDataUsePolicy" name="geminiDataUsePolicy" aria-describedby="geminiDataUsePolicyHelp">
              <option value=""${providers.google?.dataUsePolicy ? '' : ' selected'}>${t('aiSettings.selectDataPolicy')}</option>
              <option value="free-tier-acknowledged"${providers.google?.dataUsePolicy === 'free-tier-acknowledged' ? ' selected' : ''}>${t('aiSettings.geminiFreeTier')}</option>
              <option value="paid-tier"${providers.google?.dataUsePolicy === 'paid-tier' ? ' selected' : ''}>${t('aiSettings.geminiPaidTier')}</option>
            </select>
            <small id="geminiDataUsePolicyHelp" class="field-help">${t('aiSettings.geminiDataPolicyHelp')}</small>
          </label>
          ${renderSecretField({ id: 'openaiApiKey', name: 'openaiApiKey', label: 'aiSettings.openaiApiKey', helper: 'aiSettings.openaiApiKeyHelp', configured: providers.openai?.credentialsConfigured })}
        </div>
      </article>
      <div class="ai-access-save">
        <p class="ai-settings-note">${accessReady ? t('aiSettings.encryptedStorageReady') : t('aiSettings.encryptionKeyRequired')}</p>
        <button class="button primary" type="submit" ${!accessReady || model.accessSaving ? 'disabled' : ''}>${accessSaveLabel}</button>
      </div>
    </form>
    <form class="ai-model-form" id="responseGenerationSettingsForm">
      <div><h3>${t('aiSettings.modelHeading')}</h3><p>${t('aiSettings.modelDescription')}</p></div>
      <label class="field" for="responseGenerationModel"><span>${t('aiSettings.modelLabel')}</span>
        <select id="responseGenerationModel" name="model" required ${model.saving || !options ? 'disabled' : ''}>${options}</select>
      </label>
      <button class="button primary" type="submit" ${model.saving || !options ? 'disabled' : ''}>${saveLabel}</button>
      <p class="ai-settings-note" role="status" aria-live="polite">${t('aiSettings.modelNotice')}</p>
    </form>
  </section>`;
}

export function renderStats({ summary = null, unavailable = false } = {}) {
  if (unavailable || !summary) {
    return [
      stat(t('stats.comments'), '—', t('stats.unavailable'), '☷'),
      stat(t('stats.pending'), '—', t('stats.unavailable'), '◷'),
      stat(t('stats.evaluationsPending'), '—', t('stats.unavailable'), '✳'),
      stat(t('stats.sent'), '—', t('stats.unavailable'), '↗'),
    ].join('');
  }
  return [
    stat(t('stats.comments'), formatNumber(summary.totalComments), t('stats.commentsNote'), '☷'),
    stat(t('stats.pending'), formatNumber(summary.unansweredComments), t('stats.pendingNote'), '◷'),
    stat(t('stats.evaluationsPending'), formatNumber(summary.unevaluatedComments), t('stats.evaluationsNote'), '✳'),
    stat(t('stats.sent'), formatNumber(summary.sentRepliesToday), t('stats.sentNote'), '↗'),
  ].join('');
}

export function commentKey(accountId, externalCommentId) {
  return `${accountId}\u0000${externalCommentId}`;
}

export function publicationKey(accountId, publicationId) {
  return `${accountId}\u0000${publicationId}`;
}

export function renderPublicationCard(publication, model) {
  const { account, item } = publication;
  const key = publicationKey(account.id, item.externalPublicationId);
  const commentsState = model.comments.get(key);
  const expanded = model.expandedPublications.has(key);
  const comments = commentsState?.items ?? [];
  const repliedCount = comments.filter((comment) => comment.appReplied || comment.externalReplyStatus === 'REPLIED').length;
  const failed = model.accountResults.get(account.id);
  const syncFailure = commentsState?.syncErrorCode
    ? socialSyncFailureMessage(account.platform, commentsState.syncErrorCode)
    : null;
  const loadFailure = commentsState?.loadErrorCode
    ? socialSyncFailureMessage(account.platform, commentsState.loadErrorCode)
    : null;
  const failureMessage = syncFailure ?? loadFailure;
  const failureLabel = syncFailure ? t('publication.syncFailed') : loadFailure ? t('publication.loadFailed') : null;
  const image = item.thumbnailUrl && /^https?:\/\//i.test(item.thumbnailUrl) ? item.thumbnailUrl : '';
  const card = `
    <article class="video-card">
      <div class="video-head">
        ${image ? `<img class="cover" src="${escapeHtml(image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<div class="cover cover-fallback" aria-hidden="true">${networkInfo[account.platform]?.symbol ?? '▣'}</div>`}
        <div class="video-info">
          <h3 class="video-title">${escapeHtml(item.title || t('publication.untitled'))}</h3>
          <p class="video-desc">${escapeHtml(item.description || t('publication.noDescription'))}</p>
          <div class="video-meta">
            <span>${escapeHtml(account.displayName || account.externalAccountId)}</span>
            <span>${escapeHtml(formatDate(item.publishedAt))}</span>
            ${item.permalink && /^https?:\/\//i.test(item.permalink) ? `<a class="meta-link" href="${escapeHtml(item.permalink)}" target="_blank" rel="noopener noreferrer">${t('publication.open')}</a>` : ''}
          </div>
        </div>
        <div class="video-actions">
          <button class="button small" type="button" data-action="sync-publication" data-account-id="${escapeHtml(account.id)}" data-publication-id="${escapeHtml(item.externalPublicationId)}" ${commentsState?.syncing || model.busy.has('page-sync') || model.loadingPublications || model.publicationLoadingAccounts?.has(account.id) ? 'disabled' : ''}>
            ${commentsState?.syncing ? `<span class="spinner"></span> ${t('publication.syncing')}` : t('publication.sync')}
          </button>
          <button class="button primary small" type="button" data-action="bulk-reply" data-account-id="${escapeHtml(account.id)}" data-publication-id="${escapeHtml(item.externalPublicationId)}" ${commentsState?.syncing || model.busy.has('page-sync') || model.loadingPublications || model.searchLoading || model.publicationLoadingAccounts?.has(account.id) ? 'disabled' : ''}>
            ${t('bulkReplies.button')}
          </button>
        </div>
      </div>
      <div class="comment-summary">
        <div class="summary-left">
          <span>${commentsState?.loading ? t('publication.commentsLoading') : commentsState ? t(comments.length === 1 ? 'publication.loadedComment.one' : 'publication.loadedComment.other', { count: formatNumber(comments.length) }) : t('publication.commentsNotLoaded')}</span>
          ${commentsState && comments.length ? `<span class="pill neutral">${t('publication.respondedCount', { count: formatNumber(repliedCount) })}</span>` : ''}
          ${failureLabel ? `<span class="pill error">${failureLabel}</span>` : ''}
          ${failureMessage ? `<span class="sync-error-detail" role="status" aria-live="polite">${escapeHtml(failureMessage)}</span>` : ''}
          ${commentsState?.nextSyncCursor ? `<span class="pill pending">${t('publication.moreComments')}</span>` : ''}
        </div>
        <button class="content-toggle" type="button" data-action="toggle-publication" data-account-id="${escapeHtml(account.id)}" data-publication-id="${escapeHtml(item.externalPublicationId)}" aria-expanded="${expanded}">
          ${t(expanded ? 'publication.hideComments' : 'publication.showComments')}
        </button>
      </div>
      <div class="content-body"${expanded ? '' : ' hidden'}>
        ${failureMessage ? `<div class="error-state">${escapeHtml(failureMessage)}<p class="error-message">${t('publication.retryHint')}</p></div>` : ''}
        ${commentsState?.loading ? `<div class="loading-state"><span class="spinner"></span> ${t('publication.commentsLoading')}</div>` : ''}
        ${commentsState && !commentsState.loading && !failureMessage && comments.length === 0 ? `<div class="empty-state">${t('publication.empty')}</div>` : ''}
        <div class="comment-list">${comments.map((comment) => renderComment(comment, model)).join('')}</div>
        ${commentsState?.nextSyncCursor ? `<div class="load-more"><button class="button small" type="button" data-action="sync-publication-next" data-account-id="${escapeHtml(account.id)}" data-publication-id="${escapeHtml(item.externalPublicationId)}">${t('publication.nextPage')}</button></div>` : ''}
      </div>
      ${failed && failed.status !== 'available' ? `<p class="error-message">${apiErrorMessage(failed.errorCode ?? 'SOCIAL_PROVIDER_UNAVAILABLE')}</p>` : ''}
    </article>`;
  return card;
}

export function renderBulkReplyDialog(model) {
  if (!model?.open) return '';
  const rows = model.rows ?? [];
  const selectedIds = model.selectedIds ?? new Set();
  const busy = Boolean(model.busy);
  const sendableCount = Math.max(0, Number(model.sendableCount) || 0);
  const approvable = rows.filter((row) => canApproveBulkRow(row));
  const selectable = approvable.filter((row) => !row.approved);
  const selectedCount = selectable.filter((row) => selectedIds.has(row.comment.externalCommentId)).length;
  const allSelected = selectable.length > 0 && selectedCount === selectable.length;
  const dialogTitle = model.videoTitle || t('publication.untitled');
  const progress = model.progress
    ? t(model.status === 'sending' ? 'bulkReplies.sendingProgress' : 'bulkReplies.progress', {
      current: formatNumber(model.progress.current),
      total: formatNumber(model.progress.total),
      comment: model.progress.commentName ?? '',
    })
    : '';
  let content = '';

  if (model.status === 'syncing') {
    content = `<div class="bulk-loading-state" role="status" aria-live="polite"><span class="spinner"></span><span>${t('bulkReplies.loading')}</span></div>`;
  } else if (model.status === 'error') {
    content = `<div class="bulk-error-state" role="alert"><strong>${t('bulkReplies.errorTitle')}</strong><p>${escapeHtml(apiErrorMessage(model.errorCode ?? 'COMMENT_WORKFLOW_BATCH_FAILED'))}</p></div>`;
  } else if (rows.length === 0 && model.status !== 'processing') {
    content = `${model.syncWarning ? `<p class="bulk-warning" role="status">${t('bulkReplies.syncWarning')}</p>` : ''}
      <div class="bulk-empty-state"><span class="bulk-empty-mark" aria-hidden="true">✓</span><h3>${t('bulkReplies.emptyTitle')}</h3><p>${t('bulkReplies.emptyDescription')}</p></div>`;
  } else {
    const actionBar = model.status === 'ready'
      ? `<div class="bulk-action-bar">
          <div><strong>${t(rows.length === 1 ? 'bulkReplies.count.one' : 'bulkReplies.count.other', { count: formatNumber(rows.length) })}</strong><p>${t('bulkReplies.generateHint')}</p></div>
          <button class="button primary" type="button" data-action="generate-bulk-replies" ${busy || rows.length === 0 ? 'disabled' : ''}>${busy ? t('bulkReplies.generating') : t('bulkReplies.generate')}</button>
        </div>`
      : model.status === 'review'
        ? `<div class="bulk-action-bar bulk-review-toolbar">
            <div class="bulk-selection-tools">
              <label class="bulk-select-all"><input type="checkbox" data-role="bulk-select-all" ${allSelected ? 'checked' : ''} ${busy || selectable.length === 0 ? 'disabled' : ''}><span>${t(allSelected ? 'bulkReplies.unmarkAll' : 'bulkReplies.markAll')}</span></label>
              <strong>${t('bulkReplies.selectedCount', { count: formatNumber(selectedCount) })}</strong>
            </div>
            <div class="bulk-approval-actions">
              <button class="button" type="button" data-action="approve-selected" ${busy || selectedCount === 0 ? 'disabled' : ''}>${t('bulkReplies.approveSelected', { count: formatNumber(selectedCount) })}</button>
              <button class="button primary" type="button" data-action="approve-all" ${busy || selectable.length === 0 ? 'disabled' : ''}>${t('bulkReplies.approveAll')}</button>
              <button class="button send-approved" type="button" data-action="send-all-approved" ${busy || sendableCount === 0 ? 'disabled' : ''}>${t('bulkReplies.sendAll', { count: formatNumber(sendableCount) })}</button>
            </div>
          </div>`
        : `<div class="bulk-action-bar bulk-progress-bar" role="status" aria-live="polite"><span class="spinner"></span><span>${escapeHtml(progress || t(model.status === 'sending' ? 'bulkReplies.sending' : 'bulkReplies.generating'))}</span></div>`;

    content = `${model.syncWarning ? `<p class="bulk-warning" role="status">${t('bulkReplies.syncWarning')}</p>` : ''}
      <p class="bulk-boundary-note">${t('bulkReplies.reviewOnly')}</p>
      ${model.status === 'review' ? `<p class="bulk-send-hint">${t('bulkReplies.sendHint')}</p>` : ''}
      ${actionBar}
      <div class="bulk-reply-list">${rows.map((row) => renderBulkReplyRow(row, model)).join('')}</div>`;
  }

  return `<div class="bulk-reply-backdrop" data-bulk-backdrop>
    <section class="bulk-reply-dialog" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="bulkReplyHeading" aria-describedby="bulkReplyDescription" aria-busy="${busy}">
      <header class="bulk-dialog-header">
        <div class="bulk-dialog-heading">
          <p class="eyebrow">${t('bulkReplies.eyebrow')}</p>
          <h2 id="bulkReplyHeading">${escapeHtml(dialogTitle)}</h2>
          <p id="bulkReplyDescription">${t('bulkReplies.dialogDescription', { account: escapeHtml(model.accountName || t('toolbar.noAccounts')) })}</p>
        </div>
        <button class="bulk-dialog-close" type="button" data-action="close-bulk-reply" aria-label="${t('bulkReplies.closeAria')}" ${busy ? 'disabled' : ''}>×</button>
      </header>
      <div class="bulk-dialog-content">${content}</div>
      <footer class="bulk-dialog-footer">
        <span>${t('bulkReplies.unknownExcluded')}</span>
        <button class="button" type="button" data-action="close-bulk-reply" ${busy ? 'disabled' : ''}>${t('bulkReplies.close')}</button>
      </footer>
    </section>
  </div>`;
}

export function renderComment(comment, model) {
  const key = commentKey(comment.socialAccountId, comment.externalCommentId);
  const events = model.workflows.get(key) ?? [];
  const analysis = effectiveAnalysis(events);
  const response = responseVersionDetails(events, model.language);
  const variantFailed = events.some((event) => event.eventType === 'RESPONSE_SUGGESTION_GENERATED'
    && event.status === 'FAILED' && event.payload.language === model.language);
  const variantUnavailable = !response && !variantFailed && events.some((event) => (
    event.eventType === 'RESPONSE_SUGGESTION_GENERATED' && event.status === 'SUCCEEDED'
  ));
  const evaluation = latestResponseEvaluation(events, response?.version.id);
  const expanded = model.expandedComments.has(key);
  const draft = model.drafts.has(key) ? model.drafts.get(key) : response?.version.payload.text ?? '';
  const attemptRecorded = response ? hasAttemptedVersion(events, response.version.id) : false;
  const appSentReplyIds = new Set(events
    .filter((event) => event.eventType === 'MANUAL_REPLY_RESULT' && event.status === 'SUCCEEDED')
    .map((event) => event.payload.externalReplyId)
    .filter((externalReplyId) => typeof externalReplyId === 'string'));
  const creatorReplies = (comment.creatorReplies ?? [])
    .filter((reply) => typeof reply.text === 'string' && reply.text.trim() && !appSentReplyIds.has(reply.externalReplyId));
  const creatorRepliesMarkup = creatorReplies.length
    ? `<div class="creator-replies">${creatorReplies.map((reply) => `
        <article class="creator-reply">
          <div class="creator-reply-top">
            <span class="creator-reply-label">${t('comment.creatorReply')}</span>
            ${reply.createdAt ? `<time datetime="${escapeHtml(reply.createdAt)}">${escapeHtml(formatRelative(reply.createdAt))}</time>` : ''}
          </div>
          <p class="creator-reply-text">${escapeHtml(reply.text)}</p>
        </article>`).join('')}
      </div>`
    : '';
  const replied = Boolean(comment.appReplied || comment.externalReplyStatus === 'REPLIED');
  const replyStateLabel = comment.appReplied
    ? t('comment.replyByApp')
    : comment.externalReplyStatus === 'REPLIED'
      ? t('comment.replyOnPlatform')
      : comment.externalReplyStatus === 'NOT_REPLIED'
        ? t('comment.notReplied')
        : t('comment.replyUnknown');
  const author = comment.authorDisplayName?.trim() || commentAuthorFallback(comment);
  const initials = author.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
  const isDirty = draft.trim() !== (response?.version.payload.text ?? '').trim();
  const error = model.workflowErrors.get(key);
  const variantHelpId = `responseVariantHelp-${escapeHtml(comment.socialAccountId)}-${escapeHtml(comment.externalCommentId)}`;
  const sendDisabled = !comment.canReply || !draft.trim() || attemptRecorded || model.busy.has(`send:${key}`);
  const sendHint = attemptRecorded
    ? t('comment.attemptExists')
    : !comment.canReply
      ? t('comment.cannotReply')
      : '';
  const sendDisabledAttribute = sendDisabled
    ? `disabled${sendHint ? ` title="${escapeHtml(sendHint)}"` : ''}`
    : '';

  return `
    <article class="comment${expanded ? ' expanded' : ''}">
      <div class="comment-main">
        <span class="comment-avatar" aria-hidden="true">${escapeHtml(initials)}</span>
        <div class="comment-body">
          <div class="comment-top">
            <span class="comment-author">${escapeHtml(author)}</span>
            <time class="comment-time" datetime="${escapeHtml(comment.createdAt ?? '')}">${escapeHtml(formatRelative(comment.createdAt))}</time>
            ${analysis ? `<span class="pill ai">${t('comment.evaluated')}</span>` : ''}
          </div>
          <p class="comment-text">${escapeHtml(comment.text || t('comment.unavailableText'))}</p>
          ${creatorRepliesMarkup}
          ${analysis ? renderAnalysisSummary(analysis) : ''}
          <div class="comment-controls">
            <span class="status${replied ? ' replied' : ''}"><span class="status-dot"></span>${escapeHtml(replyStateLabel)}</span>
            ${comment.canLike ? renderCommentLikeButton(comment, model) : ''}
            ${comment.canReply ? '' : `<span class="pill pending">${t('comment.replyUnsupported')}</span>`}
            <button class="expand-button" type="button" data-action="toggle-comment" data-account-id="${escapeHtml(comment.socialAccountId)}" data-comment-id="${escapeHtml(comment.externalCommentId)}" aria-expanded="${expanded}">
              ${t(expanded ? 'comment.collapse' : 'comment.expand')}
            </button>
          </div>
        </div>
      </div>
      ${expanded ? `
        <section class="comment-detail" aria-label="${t('comment.detailLabel')}">
          <div class="detail-top">
            <span class="detail-title">${t('comment.analysisTitle')}</span>
            <span class="pill ${analysis ? 'done' : 'pending'}">${t(analysis ? 'comment.analysisAvailable' : 'comment.analysisPending')}</span>
          </div>
          ${error ? `<p class="error-message">${escapeHtml(error)}</p>` : ''}
          ${model.workflowLoading.has(key) ? `<p class="loading-state"><span class="spinner"></span> ${t('comment.historyLoading')}</p>` : ''}
          ${analysis ? renderAnalysis(analysis) : `<p class="empty-copy">${t('comment.analysisHelp')}</p>`}
          <div class="reply-label">
            <span>${t('comment.replyTitle')}</span>
            <span class="status${replied ? ' replied' : ''}"><span class="status-dot"></span>${escapeHtml(replied ? t('comment.alreadyReplied') : t('comment.draftNotSent'))}</span>
          </div>
          <label class="response-language-field">
            <span>${t('toolbar.responseLanguage')}</span>
            <select data-role="response-language" data-account-id="${escapeHtml(comment.socialAccountId)}" data-comment-id="${escapeHtml(comment.externalCommentId)}" aria-label="${t('toolbar.responseLanguage')}" aria-describedby="${variantHelpId}">
              ${renderLanguageOptions(model.language)}
            </select>
          </label>
          <p id="${variantHelpId}" class="advisory-note">${t('comment.threeLanguageNotice')}</p>
          ${variantFailed && !response ? `<p class="error-message">${t('comment.variantFailed', { language: model.language })}</p>` : ''}
          ${variantUnavailable ? `<p class="advisory-note">${t('comment.variantUnavailable', { language: model.language })}</p>` : ''}
          <textarea class="reply-box" data-role="response-draft" data-account-id="${escapeHtml(comment.socialAccountId)}" data-comment-id="${escapeHtml(comment.externalCommentId)}" aria-label="${t('comment.replyTextLabel')}" placeholder="${t('comment.replyPlaceholder')}">${escapeHtml(draft)}</textarea>
          <div class="reply-actions">
            <button class="button small" type="button" data-action="classify" data-account-id="${escapeHtml(comment.socialAccountId)}" data-comment-id="${escapeHtml(comment.externalCommentId)}" ${model.busy.has(`classify:${key}`) ? 'disabled' : ''}>✳ ${model.busy.has(`classify:${key}`) ? t('comment.classifying') : t(analysis ? 'comment.reclassify' : 'comment.classify')}</button>
            <button class="button small" type="button" data-action="generate" data-account-id="${escapeHtml(comment.socialAccountId)}" data-comment-id="${escapeHtml(comment.externalCommentId)}" ${!analysis || model.busy.has(`generate:${key}`) ? `disabled title="${t('comment.generateNeedsAnalysis')}"` : ''}>✧ ${model.busy.has(`generate:${key}`) ? t('comment.generating') : t('comment.generate')}</button>
            <button class="button small" type="button" data-action="save-response" data-account-id="${escapeHtml(comment.socialAccountId)}" data-comment-id="${escapeHtml(comment.externalCommentId)}" ${!draft.trim() || !isDirty || model.busy.has(`save:${key}`) ? 'disabled' : ''}>${model.busy.has(`save:${key}`) ? t('comment.saving') : t('comment.saveDraft')}</button>
            <span class="spacer"></span>
            <button class="button small" type="button" data-action="evaluate-response" data-account-id="${escapeHtml(comment.socialAccountId)}" data-comment-id="${escapeHtml(comment.externalCommentId)}" ${!analysis || !response || model.busy.has(`evaluate:${key}`) ? `disabled title="${t('comment.evaluateNeedsSaved')}"` : ''}>◇ ${t('comment.evaluateResponse')}</button>
            <button class="button primary small" type="button" data-action="send-response" data-account-id="${escapeHtml(comment.socialAccountId)}" data-comment-id="${escapeHtml(comment.externalCommentId)}" ${sendDisabledAttribute}>${model.busy.has(`send:${key}`) ? t('comment.sending') : t('comment.send')}</button>
          </div>
          ${evaluation ? renderResponseEvaluation(evaluation) : ''}
          ${response && !evaluation ? `<p class="advisory-note">${t('comment.optionalEvaluation')}</p>` : ''}
          ${response && attemptRecorded ? `<p class="advisory-note">${t('comment.attemptRecorded')}</p>` : ''}
          ${events.length ? renderHistory(events) : `<div class="history"><p class="history-title">${t('comment.historyTitle')}</p><p class="empty-copy">${t('comment.noHistory')}</p></div>`}
        </section>` : ''}
    </article>`;
}

function renderCommentLikeButton(comment, model) {
  const key = commentKey(comment.socialAccountId, comment.externalCommentId);
  const liked = comment.appLiked === true;
  const busy = model.busy.has(`like:${key}`);
  const label = t(liked ? 'comment.unlike' : 'comment.like');
  const heartFill = liked ? 'currentColor' : 'none';
  return `<button class="comment-like-button${liked ? ' is-liked' : ''}" type="button" data-action="toggle-comment-like" data-account-id="${escapeHtml(comment.socialAccountId)}" data-comment-id="${escapeHtml(comment.externalCommentId)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" aria-pressed="${liked}" ${busy ? 'disabled' : ''}>
    <svg class="comment-like-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z" fill="${heartFill}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>`;
}

function renderBulkReplyRow(row, model) {
  const comment = row.comment;
  const author = comment.authorDisplayName?.trim() || commentAuthorFallback(comment);
  const initials = author.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
  const response = responseVersionDetails(row.events ?? [], row.language);
  const generatedRoot = response?.rootId
    ? (row.events ?? []).find((event) => event.id === response.rootId)
    : null;
  const originalText = generatedRoot?.payload?.text ?? response?.version?.payload?.text ?? '';
  const draft = row.drafts?.has(row.language)
    ? row.drafts.get(row.language)
    : row.draft ?? response?.version?.payload?.text ?? '';
  const analysis = effectiveAnalysis(row.events ?? []);
  const tone = row.toneProfile?.primaryTone ?? 'FRIENDLY';
  const generatedTone = response?.version?.payload?.toneProfile?.primaryTone
    ?? generatedRoot?.payload?.toneProfile?.primaryTone
    ?? 'FRIENDLY';
  const toneChanged = Boolean(response) && tone !== generatedTone;
  const canApprove = canApproveBulkRow(row);
  const approved = Boolean(row.approved);
  const busy = model.busy || row.status === 'saving';
  const draftChanged = response && draft.trim() !== (response.version.payload.text ?? '').trim();
  const hasHumanRevision = Boolean(response?.isRevision || response?.kind === 'manual' || draftChanged);
  const responseLabel = t(hasHumanRevision ? 'bulkReplies.userEdit' : 'bulkReplies.reply');
  const replyMarkup = response
    ? `<label class="bulk-field">
        <span>${responseLabel}</span>
        <textarea class="bulk-response-editor" data-role="bulk-response-draft" data-comment-id="${escapeHtml(comment.externalCommentId)}" aria-label="${escapeHtml(t('bulkReplies.replyFor', { author }))}" ${busy || approved ? 'disabled' : ''}>${escapeHtml(draft)}</textarea>
      </label>
      <div class="bulk-response-meta">
        <label class="bulk-field bulk-select-field">
          <span>${t('bulkReplies.language')}</span>
          <select data-role="bulk-response-language" data-comment-id="${escapeHtml(comment.externalCommentId)}" ${busy || approved ? 'disabled' : ''}>${renderLanguageOptions(row.language)}</select>
        </label>
        <label class="bulk-field bulk-select-field">
          <span>${t('bulkReplies.tone')}</span>
          <select data-role="bulk-response-tone" data-comment-id="${escapeHtml(comment.externalCommentId)}" ${busy || approved ? 'disabled' : ''}>${renderBulkToneOptions(tone)}</select>
        </label>
      </div>
      ${toneChanged && !approved ? `<p class="bulk-tone-note">${t('bulkReplies.toneOnly')}</p><button class="button small" type="button" data-action="regenerate-bulk-row" data-comment-id="${escapeHtml(comment.externalCommentId)}" ${busy ? 'disabled' : ''}>${t('bulkReplies.regenerate')}</button>` : ''}
      <details class="bulk-original-response"><summary>${t('bulkReplies.originalAi')}</summary><p>${escapeHtml(originalText)}</p></details>`
    : `<div class="bulk-response-placeholder">${t(bulkRowStatusKey(row.status))}</div>`;
  const sendStatus = ['sending', 'sent', 'send-failed', 'send-ambiguous'].includes(row.status);
  const statusKey = sendStatus ? bulkRowStatusKey(row.status) : approved ? 'bulkReplies.approved' : bulkRowStatusKey(row.status);
  const statusClass = sendStatus ? row.status : approved ? 'approved' : row.status;
  const rowError = row.errorCode
    ? `<p class="bulk-row-error" role="status">${escapeHtml(apiErrorMessage(row.errorCode))}</p>`
    : '';
  const partialFailure = row.failures?.length
    ? `<p class="bulk-row-error" role="status">${t('bulkReplies.partial', { languages: escapeHtml(row.failures.map((failure) => failure.language).join(', ')) })}</p>`
    : '';
  const historyWarning = row.historyWarning
    ? `<p class="bulk-row-error" role="status">${t('bulkReplies.historyUnavailable')}</p>`
    : '';
  const checkboxDisabled = !canApprove || approved || busy;
  return `<article class="bulk-reply-row${approved ? ' is-approved' : ''}" data-comment-id="${escapeHtml(comment.externalCommentId)}" tabindex="-1">
    <section class="bulk-comment-pane" aria-label="${t('bulkReplies.comment')}">
      <div class="bulk-row-heading">
        <label class="bulk-row-select" aria-label="${escapeHtml(t('bulkReplies.selectComment', { author }))}">
          <input type="checkbox" data-role="bulk-selection" data-comment-id="${escapeHtml(comment.externalCommentId)}" ${model.selectedIds?.has(comment.externalCommentId) ? 'checked' : ''} ${checkboxDisabled ? 'disabled' : ''}>
        </label>
        <span class="comment-avatar" aria-hidden="true">${escapeHtml(initials)}</span>
        <div class="bulk-author-info"><strong>${escapeHtml(author)}</strong><time datetime="${escapeHtml(comment.createdAt ?? '')}">${escapeHtml(formatRelative(comment.createdAt))}</time></div>
        <span class="bulk-row-status ${statusClass}">${t(statusKey)}</span>
      </div>
      <p class="bulk-comment-text">${escapeHtml(comment.text || t('comment.unavailableText'))}</p>
      ${comment.canReply ? '' : `<p class="bulk-unsupported-note">${t('comment.replyUnsupported')}</p>`}
      ${analysis ? renderAnalysis(analysis) : ''}
    </section>
    <section class="bulk-response-pane" aria-label="${t('bulkReplies.reply')}">
      <div class="bulk-pane-heading"><span class="bulk-ai-mark" aria-hidden="true">AI</span><strong>${responseLabel}</strong>${response ? `<span class="pill ai">${t('comment.generate')}</span>` : ''}</div>
      ${replyMarkup}
      ${rowError}${partialFailure}${historyWarning}
      <div class="bulk-row-actions">
        <button class="button small primary" type="button" data-action="approve-bulk-row" data-comment-id="${escapeHtml(comment.externalCommentId)}" ${!canApprove || approved || busy || !draft.trim() ? 'disabled' : ''}>${busy && row.status === 'saving' ? t('bulkReplies.saving') : approved ? t('bulkReplies.approved') : t('bulkReplies.approve')}</button>
        ${draftChanged ? `<span class="bulk-edited-indicator">${t('bulkReplies.userEdit')}</span>` : ''}
      </div>
    </section>
  </article>`;
}

function canApproveBulkRow(row) {
  return ['ready', 'partial', 'approved'].includes(row.status)
    && Boolean(responseVersionDetails(row.events ?? [], row.language));
}

function bulkRowStatusKey(status) {
  const keys = {
    pending: 'bulkReplies.pending',
    evaluating: 'bulkReplies.evaluating',
    generating: 'bulkReplies.generatingRow',
    partial: 'bulkReplies.partialStatus',
    failed: 'bulkReplies.failed',
    saving: 'bulkReplies.saving',
    ready: 'bulkReplies.ready',
    approved: 'bulkReplies.approved',
    sending: 'bulkReplies.sendingRow',
    sent: 'bulkReplies.sent',
    'send-failed': 'bulkReplies.sendFailed',
    'send-ambiguous': 'bulkReplies.sendAmbiguous',
  };
  return keys[status] ?? 'bulkReplies.pending';
}

function renderBulkToneOptions(selected) {
  const values = [
    ['FRIENDLY', 'tone.friendly'],
    ['PROFESSIONAL', 'tone.professional'],
    ['CASUAL', 'tone.casual'],
    ['EMPATHETIC', 'tone.empathic'],
  ];
  return values.map(([value, key]) => `<option value="${value}"${selected === value ? ' selected' : ''}>${t(key)}</option>`).join('');
}

export function renderEmptyState(title, description, actionLabel = '', action = '') {
  return `<div class="empty-state"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p>${actionLabel ? `<button class="button small" type="button" data-action="${escapeHtml(action)}">${escapeHtml(actionLabel)}</button>` : ''}</div>`;
}

export function eventLabel(event) {
  const labelKey = eventLabels[event.eventType] ?? 'event.unknown';
  if (event.eventType === 'COMMENT_LIKE_CHANGED') {
    const label = t(event.payload.action === 'UNLIKE' ? 'event.likeRemoved' : 'event.likeAdded');
    return event.status === 'FAILED' ? t('event.failed', { label }) : label;
  }
  if (event.eventType === 'MANUAL_REPLY_RESULT') {
    const result = event.payload.outcome;
    return t(result === 'AMBIGUOUS' ? 'event.sendAmbiguous' : result === 'SUCCEEDED' ? 'event.sendSucceeded' : 'event.sendFailed');
  }
  if (event.status === 'FAILED') return t('event.failed', { label: t(labelKey) });
  if (event.status === 'UNSUPPORTED') return t('event.unsupported', { label: t(labelKey) });
  return t(labelKey);
}

function stat(label, value, note, icon) {
  return `<article class="stat-card"><div class="stat-heading">${escapeHtml(label)}<span class="stat-icon" aria-hidden="true">${icon}</span></div><div class="stat-value">${escapeHtml(value)}</div><div class="stat-foot">${escapeHtml(note)}</div></article>`;
}

function renderAnalysisSummary(analysis) {
  return `<div class="analysis-summary">
    <span class="analysis-chip"><strong>${t('comment.scoreSentiment')}</strong> ${escapeHtml(localizedAnalysisEnum('sentiment', analysis.sentiment))}</span>
    <span class="analysis-chip"><strong>${t('comment.scoreIntent')}</strong> ${escapeHtml(localizedAnalysisEnum('intent', analysis.intent))}</span>
    <span class="analysis-summary-gauge"><strong>${t('comment.scoreConfidence')}</strong>${renderAnalysisGauge(analysis.confidence, { label: t('comment.scoreConfidence'), direction: 'positive', compact: true })}</span>
  </div>`;
}

function renderAnalysis(analysis) {
  const categoricalMetrics = [
    [t('comment.scoreSentiment'), localizedAnalysisEnum('sentiment', analysis.sentiment)],
    [t('comment.scoreEmotion'), localizedAnalysisEnum('emotion', analysis.emotion)],
    [t('comment.scoreIntent'), localizedAnalysisEnum('intent', analysis.intent)],
    [t('comment.scoreTopic'), localizedAnalysisEnum('topic', analysis.topic)],
    [t('comment.scoreEntity'), analysis.entity ?? t('comment.entityUnknown')],
  ];
  const numericMetrics = [
    [t('comment.scoreSpam'), analysis.spamScore, 'risk'],
    [t('comment.scoreToxicity'), analysis.toxicityScore, 'risk'],
    [t('comment.scoreEngagement'), analysis.engagementValue, 'positive'],
    [t('comment.scoreConfidence'), analysis.confidence, 'positive'],
  ];
  if (typeof analysis.signals?.needsExternalFacts?.probability === 'number') {
    numericMetrics.push([t('comment.scoreNeedsExternalFacts'), analysis.signals.needsExternalFacts.probability, 'risk']);
  }
  if (typeof analysis.continuationRequestProbability === 'number') {
    numericMetrics.push([t('comment.scoreContinuationRequest'), analysis.continuationRequestProbability, 'positive']);
  }
  return `<div class="analysis-grid">${categoricalMetrics.map(([name, value]) => `<div class="analysis-metric analysis-enum-metric"><span>${escapeHtml(name)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}</div>
    <div class="analysis-gauge-grid">${numericMetrics.map(([name, value, direction]) => `<div class="analysis-metric analysis-score-metric"><span>${escapeHtml(name)}</span>${renderAnalysisGauge(value, { label: name, direction })}</div>`).join('')}</div>
    ${renderAnalysisEvidence(analysis.signals)}
    ${analysis.rationale ? `<p class="analysis-note">${escapeHtml(analysis.rationale)}</p>` : ''}
    <div class="analysis-meta"><span class="pill neutral">${escapeHtml(analysis.provider)} · ${escapeHtml(analysis.model)}</span><span class="pill neutral">${t('comment.analysisVersion', { version: escapeHtml(analysis.schemaVersion) })}</span></div>`;
}

function renderResponseEvaluation(event) {
  const evaluation = event.payload.evaluation ?? {};
  const scheduleSnapshot = event.payload.verifiedReleaseScheduleSnapshot;
  const recommendation = evaluation.publishRecommendation ?? 'REVIEW';
  const cls = recommendation === 'REJECT' ? 'reject' : '';
  const scheduleMarkup = typeof evaluation.scheduleConsistency === 'number'
    ? `<p class="schedule-consistency-note">${t('comment.scheduleConsistency', { score: escapeHtml(formatScore(evaluation.scheduleConsistency)) })}</p>`
    : ['UNCONFIGURED', 'DISABLED'].includes(scheduleSnapshot?.status)
      ? `<p class="schedule-consistency-note">${t('comment.scheduleNotEvaluated')}</p>`
      : '';
  return `<div class="response-review ${cls}">
    <strong>${t('comment.responseRecommendation', { recommendation: escapeHtml(label(recommendation)) })}</strong>
    <span>${t('comment.responseScores', {
      relevance: escapeHtml(formatScore(evaluation.relevance)),
      tone: escapeHtml(formatScore(evaluation.tone)),
      helpfulness: escapeHtml(formatScore(evaluation.helpfulness)),
      factualRisk: escapeHtml(formatScore(evaluation.factualRisk)),
      toxicityRisk: escapeHtml(formatScore(evaluation.toxicityRisk)),
      hallucinationRisk: escapeHtml(formatScore(evaluation.hallucinationRisk)),
    })}</span>
    ${scheduleMarkup}
    ${evaluation.rationale ? `<p>${escapeHtml(evaluation.rationale)}</p>` : ''}
    <p>${t('comment.advisoryResult')}</p>
  </div>`;
}

function renderHistory(events) {
  return `<div class="history"><p class="history-title">${t('comment.historyTitle')}</p>${events.slice().reverse().map((event) => `
    <div class="history-item"><strong>${escapeHtml(eventLabel(event))}</strong><span>${escapeHtml(formatDate(event.recordedAt))}${event.errorCode ? ` · ${escapeHtml(event.errorCode)}` : ''}</span></div>`).join('')}</div>`;
}

function renderLanguageOptions(selected) {
  const values = [['pt-BR', 'toolbar.portuguese'], ['en-US', 'toolbar.english'], ['es-ES', 'toolbar.spanish']];
  return values.map(([code, key]) => `<option value="${code}"${selected === code ? ' selected' : ''}>${t(key)}</option>`).join('');
}

function formatScore(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(uiLocale, { style: 'percent', maximumFractionDigits: 0 }).format(value);
}

function label(value) {
  if (typeof value !== 'string') return value ?? '—';
  const keys = {
    POSITIVE: 'analysis.positive',
    NEGATIVE: 'analysis.negative',
    NEUTRAL: 'analysis.neutral',
    APPROVE: 'analysis.approve',
    REVIEW: 'analysis.review',
    REJECT: 'analysis.reject',
    QUESTION: 'analysis.question',
    COMPLAINT: 'analysis.complaint',
    PRAISE: 'analysis.praise',
    CONTENT_REQUEST: 'analysis.contentRequest',
  };
  return keys[value] ? t(keys[value]) : value.replaceAll('_', ' ').toLocaleLowerCase(uiLocale).replace(/(^|\s)\p{L}/gu, (letter) => letter.toLocaleUpperCase(uiLocale));
}
