import { t } from './i18n.mjs';

const unavailable = () => `<span class="analytics-unavailable">${t('analytics.unavailable')}</span>`;

function answerCard(key) {
  return `<article class="analytics-dashboard-card analytics-answer-card">
    <h2>${t(`analytics.question.${key}`)}</h2>
    ${unavailable()}
  </article>`;
}

function metricCard(key) {
  return `<article class="analytics-dashboard-card analytics-metric-card">
    <h2>${t(`analytics.metric.${key}`)}</h2>
    ${unavailable()}
  </article>`;
}

function detailCard(titleKey, itemKeys) {
  return `<section class="analytics-dashboard-card analytics-detail-card">
    <h2>${t(titleKey)}</h2>
    <ul>${itemKeys.map((key) => `<li><span>${t(key)}</span>${unavailable()}</li>`).join('')}</ul>
  </section>`;
}

export function renderAnalyticsDashboard() {
  return `<section class="analytics-dashboard" aria-labelledby="analyticsDashboardTitle">
    <header class="analytics-dashboard-heading">
      <p class="eyebrow">${t('analytics.eyebrow')}</p>
      <h1 id="analyticsDashboardTitle">${t('analytics.title')}</h1>
      <p class="subtitle">${t('analytics.subtitle')}</p>
    </header>
    <p class="analytics-source-notice" role="status">${t('analytics.sourceNotice')}</p>
    <section class="analytics-answer-grid" aria-label="${t('analytics.answersLabel')}">
      ${['growth', 'platform', 'series', 'episode', 'conversion', 'monetization'].map(answerCard).join('')}
    </section>
    <section class="analytics-metric-grid" aria-label="${t('analytics.headlinesLabel')}">
      ${['views7d', 'views30d', 'views90d', 'monthGrowth', 'followersTotal', 'newFollowers'].map(metricCard).join('')}
    </section>
    <p class="analytics-scope-note">${t('analytics.scopeNote')}</p>
    <div class="analytics-detail-grid">
      ${detailCard('analytics.section.platforms', [
        'analytics.platform.tiktok',
        'analytics.platform.instagram',
        'analytics.platform.facebook',
      ])}
      ${detailCard('analytics.section.seriesTrends', ['analytics.section.topSeries', 'analytics.section.topEpisodes'])}
      <section class="analytics-dashboard-card analytics-detail-card">
        <h2>${t('analytics.section.goals')}</h2>
        <ul>
          <li><span>${t('analytics.goal.views')}</span>${unavailable()}</li>
          <li><span>${t('analytics.goal.revenue')}</span>${unavailable()}</li>
        </ul>
      </section>
    </div>
  </section>`;
}
