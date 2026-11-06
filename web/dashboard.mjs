import { formatNumber, t, uiLocale } from './i18n.mjs';

const supportedWindows = new Set([7, 30, 90]);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function formatPercent(value) {
  return value === null || value === undefined
    ? t('analytics.unavailable')
    : `${new Intl.NumberFormat(uiLocale, { maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(value)}%`;
}

function formatCurrency(value) {
  return value === null || value === undefined
    ? t('analytics.unavailable')
    : new Intl.NumberFormat(uiLocale, { style: 'currency', currency: 'BRL' }).format(value);
}

function formatMonth(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat(uiLocale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${value}T00:00:00.000Z`));
}

function formatMetric(metric, formatter = formatNumber) {
  if (!metric || metric.status === 'UNAVAILABLE') {
    return `<span class="analytics-unavailable">${t('analytics.unavailable')}</span>`;
  }
  if (metric.status === 'INCOMPLETE') {
    return `<span class="analytics-incomplete">${t('analytics.incomplete')}</span>`;
  }
  return formatter(metric.value);
}

function answerCard(key, value) {
  return `<article class="analytics-dashboard-card analytics-answer-card">
    <h2>${t(`analytics.question.${key}`)}</h2>
    <p class="analytics-answer-value">${value}</p>
  </article>`;
}

function metricCard(key, metric, formatter = formatMetric) {
  return `<article class="analytics-dashboard-card analytics-metric-card">
    <h2>${t(`analytics.metric.${key}`)}</h2>
    <p>${formatter(metric)}</p>
  </article>`;
}

function renderRankings(report, windowDays) {
  const rankings = report.rankings?.[`last${windowDays}Days`];
  const series = rankings?.series ?? [];
  const episodes = rankings?.episodes ?? [];
  const renderItems = (items, formatter) => items.length
    ? `<ol>${items.slice(0, 5).map(formatter).join('')}</ol>`
    : `<p class="analytics-empty">${t('analytics.unavailable')}</p>`;

  return `<section class="analytics-dashboard-card analytics-detail-card analytics-ranking-card">
    <div class="analytics-section-heading">
      <h2>${t('analytics.section.rankings')}</h2>
      <label class="analytics-ranking-window">
        <span>${t('analytics.rankingWindow')}</span>
        <select data-analytics-ranking-window aria-label="${t('analytics.rankingWindow')}">
          ${[7, 30, 90].map((days) => `<option value="${days}"${days === windowDays ? ' selected' : ''}>${t(`analytics.window.${days}`)}</option>`).join('')}
        </select>
      </label>
    </div>
    <div class="analytics-ranking-columns">
      <div><h3>${t('analytics.section.topSeries')}</h3>
        ${renderItems(series, (item) => `<li><strong>${escapeHtml(item.name)}</strong><span>${formatNumber(item.value)}</span></li>`)}
      </div>
      <div><h3>${t('analytics.section.topEpisodes')}</h3>
        ${renderItems(episodes, (item) => `<li><strong>${escapeHtml(item.episodeCode)}</strong><span>${formatNumber(item.value)}</span><small>${escapeHtml(item.seriesName)}</small></li>`)}
      </div>
    </div>
  </section>`;
}

function renderPlatformDetails(report, windowDays) {
  const metricKey = `last${windowDays}Days`;
  return `<section class="analytics-dashboard-card analytics-detail-card">
    <h2>${t('analytics.section.platforms')}</h2>
    <ul class="analytics-platform-list">${(report.platforms ?? []).map((platform) => {
      const growth = platform.monthGrowthPercent === null
        ? t('analytics.unavailable')
        : formatPercent(platform.monthGrowthPercent);
      const rates = platform.rates?.[windowDays];
      return `<li>
        <span class="analytics-platform-name">${t(`analytics.platform.${platform.platform}`)}</span>
        <span>${formatMetric(platform.views?.[metricKey])}</span>
        <small>${t('analytics.platformGrowth')}: ${growth} · ${t('analytics.engagement')}: ${formatMetric(rates?.engagement, formatPercent)}</small>
      </li>`;
    }).join('')}</ul>
    <p class="analytics-detail-caption">${t(`analytics.window.${windowDays}`)}</p>
  </section>`;
}

function renderGoal(title, goal, formatter) {
  const percent = goal?.progressPercent;
  const progress = percent === null || percent === undefined ? 0 : percent;
  return `<div class="analytics-goal">
    <div class="analytics-goal-label"><span>${title}</span><strong>${formatMetric(goal, formatter)}</strong></div>
    <div class="analytics-goal-track" role="progressbar" aria-label="${title}" aria-valuemin="0" aria-valuemax="100"${percent === null ? '' : ` aria-valuenow="${Math.round(percent)}"`}>
      <span style="width:${progress}%"></span>
    </div>
    <p>${goal?.achieved?.length
      ? t('analytics.goal.achieved', { milestones: goal.achieved.map(formatter).join(', ') })
      : t('analytics.goal.noneAchieved')}</p>
    <p>${goal?.next === null || goal?.next === undefined
      ? t('analytics.goal.allAchieved')
      : t('analytics.goal.next', { milestone: formatter(goal.next) })}</p>
  </div>`;
}

function renderGoals(report) {
  return `<section class="analytics-dashboard-card analytics-detail-card">
    <h2>${t('analytics.section.goals')}</h2>
    <div class="analytics-goal-grid">
      ${renderGoal(t('analytics.goal.views'), report.goals?.views, (value) => formatNumber(value))}
      ${renderGoal(t('analytics.goal.revenue'), report.goals?.revenue, (value) => formatCurrency(value))}
    </div>
    <p class="analytics-detail-caption">${t('analytics.monthWindow', { month: formatMonth(report.month?.start) })}</p>
  </section>`;
}

function renderEconomics(report) {
  return `<section class="analytics-dashboard-card analytics-detail-card">
    <h2>${t('analytics.section.economics')}</h2>
    <ul>
      <li><span>${t('analytics.economics.revenue')}</span>${formatMetric(report.month?.revenue, formatCurrency)}</li>
      <li><span>${t('analytics.economics.cost')}</span>${formatMetric(report.month?.productionCost, formatCurrency)}</li>
    </ul>
    <p class="analytics-detail-caption">${t('analytics.monthWindow', { month: formatMonth(report.month?.start) })}</p>
  </section>`;
}

function renderReport(report, windowDays) {
  const topSeries = report.rankings?.[`last${windowDays}Days`]?.series?.[0];
  const topEpisode = report.rankings?.[`last${windowDays}Days`]?.episodes?.[0];
  const growingPlatform = (report.platforms ?? [])
    .filter((platform) => platform.monthGrowthPercent !== null)
    .sort((left, right) => right.monthGrowthPercent - left.monthGrowthPercent)[0];
  const conversion = report.conversion?.status === 'COMPLETE'
    ? formatPercent(report.conversion.value)
    : formatMetric(report.conversion, formatPercent);
  const growthMetric = {
    value: report.month?.growthPercent ?? null,
    status: report.month?.growthPercent !== null && report.month?.growthPercent !== undefined
      ? 'COMPLETE'
      : report.month?.views?.status === 'INCOMPLETE' || report.month?.previousComparableViews?.status === 'INCOMPLETE'
        ? 'INCOMPLETE'
        : 'UNAVAILABLE',
  };
  const revenueGoal = report.goals?.revenue;
  const monetization = `${formatMetric(report.month?.revenue, formatCurrency)} · ${revenueGoal?.progressPercent === null || revenueGoal?.progressPercent === undefined
    ? formatMetric(revenueGoal)
    : `${formatNumber(Math.round(revenueGoal.progressPercent))}%`}`;
  const growth = formatMetric(growthMetric, formatPercent);

  return `<section class="analytics-dashboard" aria-labelledby="analyticsDashboardTitle">
    <header class="analytics-dashboard-heading">
      <div>
        <p class="eyebrow">${t('analytics.eyebrow')}</p>
        <h1 id="analyticsDashboardTitle">${t('analytics.title')}</h1>
        <p class="subtitle">${t('analytics.subtitle')}</p>
      </div>
      <p class="analytics-updated">${t('analytics.updatedAt', { date: new Intl.DateTimeFormat(uiLocale, { dateStyle: 'medium', timeStyle: 'short', timeZone: report.reportingTimezone ?? 'UTC' }).format(new Date(report.generatedAt)) })}</p>
    </header>
    <p class="analytics-source-notice" role="status">${t('analytics.sourceNotice')}</p>
    <section class="analytics-answer-grid" aria-label="${t('analytics.answersLabel')}">
      ${answerCard('growth', growth)}
      ${answerCard('platform', growingPlatform ? `${t(`analytics.platform.${growingPlatform.platform}`)} · ${formatPercent(growingPlatform.monthGrowthPercent)}` : t('analytics.unavailable'))}
      ${answerCard('series', topSeries ? escapeHtml(topSeries.name) : t('analytics.unavailable'))}
      ${answerCard('episode', topEpisode ? `${escapeHtml(topEpisode.episodeCode)} · ${escapeHtml(topEpisode.seriesName)}` : t('analytics.unavailable'))}
      ${answerCard('conversion', conversion)}
      ${answerCard('monetization', monetization)}
    </section>
    <section class="analytics-metric-grid" aria-label="${t('analytics.headlinesLabel')}">
      ${metricCard('views7d', report.views?.last7Days)}
      ${metricCard('views30d', report.views?.last30Days)}
      ${metricCard('views90d', report.views?.last90Days)}
      ${metricCard('monthGrowth', growthMetric, formatPercent)}
      ${metricCard('followersTotal', report.followers?.total)}
      ${metricCard('newFollowers', report.followers?.new)}
    </section>
    <p class="analytics-scope-note">${t('analytics.scopeNote')}</p>
    <div class="analytics-detail-grid">
      ${renderPlatformDetails(report, windowDays)}
      ${renderRankings(report, windowDays)}
      ${renderGoals(report)}
      ${renderEconomics(report)}
    </div>
    <p class="analytics-inventory-note">${t('analytics.inventory', {
      series: formatNumber(report.seriesCount ?? 0),
      episodes: formatNumber(report.episodeCount ?? 0),
      publications: formatNumber(report.linkedPublicationCount ?? 0),
    })}</p>
  </section>`;
}

export function renderAnalyticsDashboard({
  report = null,
  loading = false,
  error = false,
  rankingWindow = 30,
} = {}) {
  const safeWindow = supportedWindows.has(Number(rankingWindow)) ? Number(rankingWindow) : 30;
  if (loading) return `<section class="analytics-dashboard-state" role="status" aria-live="polite">${t('analytics.loading')}</section>`;
  if (error) return `<section class="analytics-dashboard-state" role="alert">
    <p>${t('analytics.loadFailed')}</p>
    <button class="button" type="button" data-action="retry-analytics-dashboard">${t('analytics.retry')}</button>
  </section>`;
  if (!report) return `<section class="analytics-dashboard-state" role="status">${t('analytics.loading')}</section>`;
  return renderReport(report, safeWindow);
}
