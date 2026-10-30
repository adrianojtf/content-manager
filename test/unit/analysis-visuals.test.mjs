import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  classifyAnalysisMetric,
  localizedAnalysisEnum,
  renderAnalysisEvidence,
  renderAnalysisGauge,
} from '../../web/analysis-visuals.mjs';
import { setUiLocale } from '../../web/i18n.mjs';

test('JEV enum values resolve to localized semantic labels', () => {
  const translations = [
    ['pt-BR', 'Neutro', 'Solicitação de conteúdo', 'Outro'],
    ['en-US', 'Neutral', 'Content request', 'Other'],
    ['es-ES', 'Neutral', 'Solicitud de contenido', 'Otro'],
  ];

  for (const [locale, neutral, contentRequest, other] of translations) {
    setUiLocale(locale);
    assert.equal(localizedAnalysisEnum('sentiment', 'NEUTRAL'), neutral);
    assert.equal(localizedAnalysisEnum('intent', 'CONTENT_REQUEST'), contentRequest);
    assert.equal(localizedAnalysisEnum('topic', 'UNRECOGNIZED_TOPIC'), other);
  }
  setUiLocale('pt-BR');
});

test('gauge assessment applies inverse risk thresholds and positive thresholds', () => {
  assert.equal(classifyAnalysisMetric(0.299, 'risk').status, 'good');
  assert.equal(classifyAnalysisMetric(0.3, 'risk').status, 'caution');
  assert.equal(classifyAnalysisMetric(0.699, 'risk').status, 'caution');
  assert.equal(classifyAnalysisMetric(0.7, 'risk').status, 'bad');
  assert.equal(classifyAnalysisMetric(0.399, 'positive').status, 'bad');
  assert.equal(classifyAnalysisMetric(0.4, 'positive').status, 'caution');
  assert.equal(classifyAnalysisMetric(0.7, 'positive').status, 'good');
});

test('accessible speedometer exposes normalized value and localized severity without deciding actions', () => {
  setUiLocale('pt-BR');
  const markup = renderAnalysisGauge(0.82, { label: 'Confiança', direction: 'positive' });
  assert.match(markup, /role="meter"/);
  assert.match(markup, /aria-valuenow="82"/);
  assert.match(markup, /aria-valuemin="0"/);
  assert.match(markup, /aria-valuemax="100"/);
  assert.match(markup, /data-direction="positive"/);
  assert.match(markup, /data-status="good"/);
  assert.match(markup, /Bom/);
});

test('question evidence uses localized enum labels and meters instead of raw numeric JSON', () => {
  setUiLocale('pt-BR');
  const markup = renderAnalysisEvidence({
    sentiment: { confidence: 0.91, probabilities: { POSITIVE: 0.03, NEUTRAL: 0.91, NEGATIVE: 0.06 } },
    intent: { confidence: 0.88, probabilities: { CONTENT_REQUEST: 0.88, REACTION: 0.12 } },
    spam: { probability: 0.02 },
    toxicity: { probability: 0.14 },
    engagement: { normalizedScore: 0.8, confidence: 0.9, probabilities: { 0: 0.01, 1: 0.02, 2: 0.07, 3: 0.3, 4: 0.6 } },
    needsExternalFacts: { probability: 0.76 },
    requestsContinuation: { probability: 0.8 },
  });

  assert.match(markup, /Neutro/);
  assert.match(markup, /Solicitação de conteúdo/);
  assert.match(markup, /role="meter"/);
  assert.doesNotMatch(markup, /<pre>|0\.91/);
  assert.match(markup, /aria-valuenow="91"/);
});

test('meter colors and surfaces use light/dark theme tokens', () => {
  const styles = readFileSync(new URL('../../web/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.analysis-gauge \{[^}]*--gauge-low: var\(--red\)/);
  assert.match(styles, /\.analysis-gauge\.is-risk \{[^}]*--gauge-low: var\(--green\)[^}]*--gauge-high: var\(--red\)/);
  assert.match(styles, /\.analysis-gauge-dial::after \{[^}]*background: var\(--surface-soft\)/);
});
