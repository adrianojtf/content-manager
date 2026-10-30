import { formatNumber, t } from './i18n.mjs';

export const CommentAnalysisEnum = Object.freeze({
  sentiment: Object.freeze({
    POSITIVE: 'analysis.sentiment.positive',
    NEUTRAL: 'analysis.sentiment.neutral',
    NEGATIVE: 'analysis.sentiment.negative',
  }),
  emotion: Object.freeze({
    JOY: 'analysis.emotion.joy',
    CURIOSITY: 'analysis.emotion.curiosity',
    FRUSTRATION: 'analysis.emotion.frustration',
    SADNESS: 'analysis.emotion.sadness',
    ANGER: 'analysis.emotion.anger',
    SURPRISE: 'analysis.emotion.surprise',
    NEUTRAL: 'analysis.emotion.neutral',
    OTHER: 'analysis.emotion.other',
  }),
  intent: Object.freeze({
    QUESTION: 'analysis.intent.question',
    PRAISE: 'analysis.intent.praise',
    COMPLAINT: 'analysis.intent.complaint',
    SUGGESTION: 'analysis.intent.suggestion',
    CONTENT_REQUEST: 'analysis.intent.contentRequest',
    REACTION: 'analysis.intent.reaction',
    OTHER: 'analysis.intent.other',
  }),
  topic: Object.freeze({
    CHARACTER: 'analysis.topic.character',
    STORY: 'analysis.topic.story',
    CONTENT: 'analysis.topic.content',
    PRODUCTION: 'analysis.topic.production',
    COMMUNITY: 'analysis.topic.community',
    PLATFORM: 'analysis.topic.platform',
    OTHER: 'analysis.topic.other',
  }),
});

const noulSignals = [
  ['spam', 'comment.scoreSpam', 'risk'],
  ['toxicity', 'comment.scoreToxicity', 'risk'],
  ['needsExternalFacts', 'comment.scoreNeedsExternalFacts', 'risk'],
  ['requestsContinuation', 'comment.scoreContinuationRequest', 'positive'],
];

export function localizedAnalysisEnum(category, value) {
  if (typeof value !== 'string') return value ?? '—';
  const key = CommentAnalysisEnum[category]?.[value];
  return t(key ?? 'analysis.enum.other');
}

export function classifyAnalysisMetric(value, direction = 'likelihood') {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (direction === 'risk') {
    if (value < 0.3) return { status: 'good', labelKey: 'analysis.gauge.lowRisk' };
    if (value < 0.7) return { status: 'caution', labelKey: 'analysis.gauge.moderateRisk' };
    return { status: 'bad', labelKey: 'analysis.gauge.highRisk' };
  }
  if (direction === 'positive') {
    if (value < 0.4) return { status: 'bad', labelKey: 'analysis.gauge.low' };
    if (value < 0.7) return { status: 'caution', labelKey: 'analysis.gauge.moderate' };
    return { status: 'good', labelKey: 'analysis.gauge.good' };
  }
  if (value < 0.4) return { status: 'low', labelKey: 'analysis.gauge.lowLikelihood' };
  if (value < 0.7) return { status: 'moderate', labelKey: 'analysis.gauge.moderateLikelihood' };
  return { status: 'high', labelKey: 'analysis.gauge.highLikelihood' };
}

export function renderAnalysisGauge(value, { label, direction = 'likelihood', compact = false } = {}) {
  const assessment = classifyAnalysisMetric(value, direction);
  if (!assessment || value < 0 || value > 1) return `<span class="analysis-gauge-unavailable">—</span>`;
  const percentage = Math.round(value * 100);
  const displayedValue = `${formatNumber(percentage)}%`;
  const status = t(assessment.labelKey);
  const accessibleValue = t('analysis.gauge.aria', {
    label: label ?? t('analysis.probability'),
    value: displayedValue,
    status,
  });
  const angle = (-90 + value * 180).toFixed(1);
  return `
    <div class="analysis-gauge${compact ? ' is-compact' : ''} is-${direction} is-${assessment.status}"
      role="meter" aria-label="${escapeAttribute(label ?? t('analysis.probability'))}"
      aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percentage}"
      aria-valuetext="${escapeAttribute(accessibleValue)}" data-direction="${direction}" data-status="${assessment.status}">
      <div class="analysis-gauge-dial" aria-hidden="true">
        <span class="analysis-gauge-needle" style="--gauge-angle:${angle}deg"></span>
        <span class="analysis-gauge-hub"></span>
      </div>
      <div class="analysis-gauge-reading"><strong>${escapeAttribute(displayedValue)}</strong><span>${escapeAttribute(status)}</span></div>
    </div>`;
}

export function renderAnalysisEvidence(signals) {
  if (!isRecord(signals)) return '';
  const questions = [
    ['sentiment', 'comment.scoreSentiment'],
    ['emotion', 'comment.scoreEmotion'],
    ['intent', 'comment.scoreIntent'],
    ['topic', 'comment.scoreTopic'],
  ].filter(([key]) => isRecord(signals[key]));
  const categoricalEvidence = questions.map(([key, labelKey]) => {
    const signal = signals[key];
    const confidence = renderAnalysisGauge(signal.confidence, {
      label: t('analysis.questionConfidence'),
      direction: 'positive',
      compact: true,
    });
    const probabilities = renderProbabilities(key, signal.probabilities);
    return `<section class="analysis-evidence-question"><h4>${t(labelKey)}</h4><div class="analysis-evidence-confidence">${confidence}</div><div class="analysis-evidence-options">${probabilities}</div></section>`;
  }).join('');
  const noulEvidence = noulSignals
    .filter(([key]) => isRecord(signals[key]))
    .map(([key, labelKey, direction]) => `<section class="analysis-evidence-question"><h4>${t(labelKey)}</h4>${renderAnalysisGauge(signals[key].probability, { label: t(labelKey), direction, compact: true })}</section>`)
    .join('');
  const engagement = isRecord(signals.engagement) ? renderEngagementEvidence(signals.engagement) : '';
  const content = `${categoricalEvidence}${noulEvidence}${engagement}`;
  if (!content) return '';
  return `<details class="analysis-evidence"><summary>${t('analysis.evidence')}</summary><div class="analysis-evidence-grid">${content}</div></details>`;
}

function renderProbabilities(category, probabilities) {
  if (!isRecord(probabilities)) return '';
  return Object.entries(probabilities).map(([option, probability]) => {
    const localizedOption = localizedAnalysisEnum(category, option);
    return `<div class="analysis-evidence-option"><span>${escapeAttribute(localizedOption)}</span>${renderAnalysisGauge(probability, {
      label: t('analysis.probabilityForOption', { option: localizedOption }),
      direction: probabilityDirection(category, option),
      compact: true,
    })}</div>`;
  }).join('');
}

function probabilityDirection(category, option) {
  if (category === 'sentiment') {
    if (option === 'NEGATIVE') return 'risk';
    return option === 'POSITIVE' ? 'positive' : 'likelihood';
  }
  if (category === 'emotion') {
    if (['ANGER', 'FRUSTRATION', 'SADNESS'].includes(option)) return 'risk';
    return ['JOY', 'CURIOSITY', 'SURPRISE'].includes(option) ? 'positive' : 'likelihood';
  }
  if (category === 'intent') {
    if (option === 'COMPLAINT') return 'risk';
    return ['PRAISE', 'CONTENT_REQUEST'].includes(option) ? 'positive' : 'likelihood';
  }
  return 'likelihood';
}

function renderEngagementEvidence(signal) {
  const score = renderAnalysisGauge(signal.normalizedScore, {
    label: t('comment.scoreEngagement'),
    direction: 'positive',
    compact: true,
  });
  const confidence = renderAnalysisGauge(signal.confidence, {
    label: t('analysis.questionConfidence'),
    direction: 'positive',
    compact: true,
  });
  const probabilities = isRecord(signal.probabilities)
    ? Object.entries(signal.probabilities).map(([level, value]) => {
      const option = t('analysis.level', { level });
      return `<div class="analysis-evidence-option"><span>${escapeAttribute(option)}</span>${renderAnalysisGauge(value, {
        label: t('analysis.probabilityForOption', { option }),
        direction: 'likelihood',
        compact: true,
      })}</div>`;
    }).join('')
    : '';
  return `<section class="analysis-evidence-question"><h4>${t('comment.scoreEngagement')}</h4><div class="analysis-evidence-confidence">${score}${confidence}</div><div class="analysis-evidence-options">${probabilities}</div></section>`;
}

function escapeAttribute(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
