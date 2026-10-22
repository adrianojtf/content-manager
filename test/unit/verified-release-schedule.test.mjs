import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  GetTenantVerifiedReleaseSchedule,
  GetVerifiedReleaseSchedule,
  UpdateTenantVerifiedReleaseSchedule,
  UpdateVerifiedReleaseSchedule,
} = require('../../dist/application/social/verified-release-schedule.js');
const {
  EvaluateResponseSuggestion,
  GenerateCommentResponseSuggestion,
} = require('../../dist/application/social/comment-intelligence.usecases.js');
const { SocialAccount } = require('../../dist/domain/social/social-account.js');
const { parseSocialAccountId } = require('../../dist/domain/social/social-account-id.js');

const tenantId = '30000000-0000-4000-8000-000000000001';
const accountId = parseSocialAccountId('5b7f1f84-25a8-4bd8-a7df-680dc4400001');
const account = SocialAccount.create({
  id: accountId,
  tenantId,
  platform: 'youtube',
  externalAccountId: 'UC-channel',
  displayName: 'Creator',
  credentialReference: 'opaque-reference',
});
const comment = {
  platform: 'youtube',
  socialAccountId: accountId,
  externalCommentId: 'comment-1',
  externalThreadId: 'thread-1',
  externalPublicationId: 'video-1',
  authorDisplayName: 'Viewer',
  text: 'When is the next episode?',
  createdAt: '2026-10-13T12:00:00.000Z',
  canReply: true,
  lastSyncedAt: '2026-10-13T12:00:00.000Z',
  expiresAt: '2026-11-12T12:00:00.000Z',
};
const analysis = {
  sentiment: 'NEUTRAL',
  emotion: 'CURIOSITY',
  intent: 'QUESTION',
  topic: 'CONTENT',
  entity: null,
  spamScore: 0,
  toxicityScore: 0,
  engagementValue: 0.5,
  continuationRequestProbability: 0.7,
  confidence: 0.9,
  rationale: null,
  provider: 'JEV',
  model: 'jev-model',
  schemaVersion: 'typesafe-systemone-v1',
  signals: {
    sentiment: { confidence: 0.9, probabilities: { NEUTRAL: 0.9, POSITIVE: 0.05, NEGATIVE: 0.05 } },
    emotion: { confidence: 0.9, probabilities: { CURIOSITY: 0.9, OTHER: 0.1 } },
    intent: { confidence: 0.9, probabilities: { QUESTION: 0.9, OTHER: 0.1 } },
    topic: { confidence: 0.9, probabilities: { CONTENT: 0.9, OTHER: 0.1 } },
    spam: { probability: 0 },
    toxicity: { probability: 0 },
    engagement: {
      rawScore: 2,
      normalizedScore: 0.5,
      confidence: 0.9,
      probabilities: { 0: 0.05, 1: 0.1, 2: 0.7, 3: 0.1, 4: 0.05 },
      legend: { 0: 'low', 1: 'limited', 2: 'medium', 3: 'high', 4: 'very high' },
    },
    needsExternalFacts: { probability: 0.2 },
    requestsContinuation: { probability: 0.7 },
  },
  usage: { inputTokens: 100, outputTokens: 20 },
};
const config = {
  enabled: true,
  daysOfWeek: ['MONDAY', 'WEDNESDAY'],
  localTime: '20:30',
  timeZone: 'America/Sao_Paulo',
};
const storedSchedule = {
  ...config,
  version: 2,
  updatedAt: '2026-10-14T12:00:00.000Z',
  confirmedAt: '2026-10-14T12:00:00.000Z',
};
const activeSnapshot = { status: 'ACTIVE', schedule: storedSchedule, source: 'ACCOUNT' };
const tenantSnapshot = { status: 'ACTIVE', schedule: storedSchedule, source: 'TENANT' };
const activeGenerationContext = {
  status: 'ACTIVE',
  daysOfWeek: config.daysOfWeek,
  localTime: config.localTime,
  timeZone: config.timeZone,
};
const activeEvaluationContext = {
  daysOfWeek: config.daysOfWeek,
  localTime: config.localTime,
  timeZone: config.timeZone,
};
const responseEvaluation = {
  relevance: 0.9,
  tone: 0.9,
  helpfulness: 0.9,
  factualRisk: 0.1,
  toxicityRisk: 0.05,
  hallucinationRisk: 0.1,
  publishRecommendation: 'REVIEW',
  confidence: 0.9,
  rationale: null,
  provider: 'JEV',
  model: 'jev-model',
  schemaVersion: 'typesafe-systemone-v2',
  scheduleConsistency: 0.8,
  signals: { scheduleConsistency: { probability: 0.8 } },
};
const now = () => Date.parse('2026-10-15T12:00:00.000Z');

function accountRepository(found = account) {
  const calls = [];
  return {
    calls,
    findById: async (...args) => {
      calls.push(args);
      return found;
    },
  };
}

function createGeneration({ schedule = storedSchedule, scheduleError, tenantSchedule = null, tenantScheduleError, events, commentFound = comment } = {}) {
  const calls = [];
  const failures = [];
  const accounts = accountRepository();
  const scheduleRepository = {
    get: async (...args) => {
      calls.push(['getSchedule', ...args]);
      if (scheduleError) throw scheduleError;
      return schedule;
    },
  };
  const tenantScheduleRepository = {
    get: async (...args) => {
      calls.push(['getTenantSchedule', ...args]);
      if (tenantScheduleError) throw tenantScheduleError;
      return tenantSchedule;
    },
  };
  const eventRepository = {
    listByComment: async () => events ?? [{
      id: 'analysis-1',
      eventType: 'COMMENT_ANALYSIS_CREATED',
      payload: analysis,
    }],
    append: async (input) => {
      failures.push(input);
      return { ...input, id: `failure-${failures.length}`, expiresAt: commentFound.expiresAt };
    },
  };
  const useCase = new GenerateCommentResponseSuggestion(
    accounts,
    { findByExternalCommentId: async () => commentFound },
    {
      generate: async (input) => {
        calls.push(['generate', input]);
        return {
          text: `Reply ${input.language}`,
          language: input.language,
          intendedTone: 'FRIENDLY',
          confidence: 0.8,
          rationale: null,
          provider: 'GEMINI',
          model: 'gemini-test',
        };
      },
    },
    {
      execute: async (input) => {
        calls.push(['recordSuggestion', input]);
        return {
          id: `suggestion-${input.suggestion.language}`,
          eventType: 'RESPONSE_SUGGESTION_GENERATED',
          payload: { ...input.suggestion, verifiedReleaseScheduleSnapshot: input.verifiedReleaseScheduleSnapshot },
        };
      },
    },
    eventRepository,
    { resolveTenantId: async () => tenantId },
    { get: async () => null },
    { get: async () => null },
    scheduleRepository,
    tenantScheduleRepository,
    now,
  );
  return { useCase, calls, failures, accounts };
}

function createEvaluation({ schedule = storedSchedule, scheduleError, tenantSchedule = null, tenantScheduleError, evaluation = responseEvaluation } = {}) {
  const calls = [];
  const failures = [];
  const revision = {
    id: 'revision-1',
    eventType: 'RESPONSE_SUGGESTION_EDITED',
    payload: { originalSuggestionEventId: 'suggestion-1', text: 'Exact saved response' },
  };
  const events = [
    { id: 'analysis-1', eventType: 'COMMENT_ANALYSIS_CREATED', payload: analysis },
    { id: 'suggestion-1', eventType: 'RESPONSE_SUGGESTION_GENERATED', payload: { language: 'pt-BR', text: 'Generated response' } },
    revision,
  ];
  const useCase = new EvaluateResponseSuggestion(
    accountRepository(),
    { findByExternalCommentId: async () => comment },
    {
      evaluate: async (input) => {
        calls.push(['evaluate', input]);
        return evaluation;
      },
    },
    {
      execute: async (input) => {
        calls.push(['recordEvaluation', input]);
        return { id: 'evaluation-1', parentEventId: input.revisionEventId };
      },
    },
    {
      listByComment: async () => events,
      append: async (input) => {
        failures.push(input);
        return input;
      },
    },
    { resolveTenantId: async () => tenantId },
    { get: async (...args) => {
      calls.push(['getSchedule', ...args]);
      if (scheduleError) throw scheduleError;
      return schedule;
    } },
    { get: async (...args) => {
      calls.push(['getTenantSchedule', ...args]);
      if (tenantScheduleError) throw tenantScheduleError;
      return tenantSchedule;
    } },
    now,
  );
  return { useCase, calls, failures, revision };
}

test('GetVerifiedReleaseSchedule returns an explicit empty state and reads only the tenant-owned account', async () => {
  const accounts = accountRepository();
  const repositoryCalls = [];
  const tenantRepositoryCalls = [];
  const useCase = new GetVerifiedReleaseSchedule(
    accounts,
    { get: async (...args) => { repositoryCalls.push(args); return null; } },
    { get: async (...args) => { tenantRepositoryCalls.push(args); return null; } },
    { resolveTenantId: async () => tenantId },
  );

  assert.deepEqual(await useCase.execute({ accountId }), { schedule: null, source: 'UNCONFIGURED' });
  assert.deepEqual(accounts.calls, [[tenantId, accountId]]);
  assert.deepEqual(repositoryCalls, [[tenantId, accountId]]);
  assert.deepEqual(tenantRepositoryCalls, [[tenantId]]);
});

test('GetVerifiedReleaseSchedule inherits the tenant schedule when the account has no row', async () => {
  const useCase = new GetVerifiedReleaseSchedule(
    accountRepository(),
    { get: async () => null },
    { get: async () => storedSchedule },
    { resolveTenantId: async () => tenantId },
  );

  const view = await useCase.execute({ accountId });
  assert.equal(view.source, 'TENANT');
  assert.deepEqual(view.schedule, storedSchedule);
});

test('GetVerifiedReleaseSchedule keeps a disabled account schedule instead of the tenant default', async () => {
  const disabledAccount = { ...storedSchedule, enabled: false };
  const tenantCalls = [];
  const useCase = new GetVerifiedReleaseSchedule(
    accountRepository(),
    { get: async () => disabledAccount },
    { get: async (...args) => { tenantCalls.push(args); return storedSchedule; } },
    { resolveTenantId: async () => tenantId },
  );

  const view = await useCase.execute({ accountId });
  assert.equal(view.source, 'ACCOUNT');
  assert.equal(view.schedule.enabled, false);
  assert.equal(tenantCalls.length, 0);
});

test('tenant verified release schedule use cases read and confirm the global default', async () => {
  let stored = null;
  const repository = {
    get: async () => stored,
    save: async (_scope, value) => {
      stored = { ...value, version: (stored?.version ?? 0) + 1, updatedAt: '2026-10-15T12:00:00.000Z', confirmedAt: '2026-10-15T12:00:00.000Z' };
      return stored;
    },
  };
  const tenant = { resolveTenantId: async () => tenantId };
  const get = new GetTenantVerifiedReleaseSchedule(repository, tenant);
  const update = new UpdateTenantVerifiedReleaseSchedule(repository, tenant);

  assert.deepEqual(await get.execute(), { schedule: null, source: 'UNCONFIGURED' });
  const saved = await update.execute({ config });
  assert.equal(saved.source, 'TENANT');
  assert.equal(saved.schedule.version, 1);
  assert.deepEqual(await get.execute(), { schedule: saved.schedule, source: 'TENANT' });

  await assert.rejects(
    update.execute({ config: { ...config, daysOfWeek: ['FUNDAY'] } }),
    (error) => error.code === 'VERIFIED_RELEASE_SCHEDULE_INVALID',
  );
});

test('GetVerifiedReleaseSchedule hides accounts outside the resolved tenant', async () => {
  const useCase = new GetVerifiedReleaseSchedule(
    accountRepository(null),
    { get: async () => { throw new Error('must not query schedule'); } },
    { get: async () => { throw new Error('must not query tenant schedule'); } },
    { resolveTenantId: async () => tenantId },
  );

  await assert.rejects(
    useCase.execute({ accountId }),
    (error) => error.code === 'SOCIAL_ACCOUNT_NOT_FOUND',
  );
});

test('UpdateVerifiedReleaseSchedule validates, saves, and returns creator-confirmed account settings', async () => {
  const saved = { ...config, version: 1, updatedAt: '2026-10-15T12:00:00.000Z', confirmedAt: '2026-10-15T12:00:00.000Z' };
  const accounts = accountRepository();
  const repositoryCalls = [];
  const useCase = new UpdateVerifiedReleaseSchedule(
    accounts,
    { save: async (...args) => { repositoryCalls.push(args); return saved; } },
    { resolveTenantId: async () => tenantId },
  );

  assert.deepEqual(await useCase.execute({ accountId, config }), { schedule: saved, source: 'ACCOUNT' });
  assert.deepEqual(repositoryCalls, [[tenantId, accountId, config]]);
});

test('UpdateVerifiedReleaseSchedule permits an empty day list only for a disabled schedule', async () => {
  const disabled = {
    enabled: false,
    daysOfWeek: [],
    localTime: '20:30',
    timeZone: 'America/Sao_Paulo',
  };
  let saved;
  const useCase = new UpdateVerifiedReleaseSchedule(
    accountRepository(),
    { save: async (_tenantId, _accountId, configValue) => {
      saved = configValue;
      return { ...configValue, version: 1, updatedAt: '2026-10-15T12:00:00.000Z', confirmedAt: '2026-10-15T12:00:00.000Z' };
    } },
    { resolveTenantId: async () => tenantId },
  );

  const result = await useCase.execute({ accountId, config: disabled });

  assert.deepEqual(saved, disabled);
  assert.deepEqual(result.schedule.daysOfWeek, []);
  assert.equal(result.schedule.enabled, false);
});

test('UpdateVerifiedReleaseSchedule rejects malformed weekdays, local times, IANA zones, and empty enabled schedules', async () => {
  const useCase = new UpdateVerifiedReleaseSchedule(
    accountRepository(),
    { save: async () => { throw new Error('invalid data must not be saved'); } },
    { resolveTenantId: async () => tenantId },
  );
  const invalidConfigs = [
    { ...config, daysOfWeek: ['MONDAY', 'MONDAY'] },
    { ...config, daysOfWeek: ['FUNDAY'] },
    { ...config, daysOfWeek: [] },
    { ...config, localTime: '24:00' },
    { ...config, localTime: '9:30' },
    { ...config, timeZone: 'Mars/Olympus_Mons' },
  ];

  for (const invalid of invalidConfigs) {
    await assert.rejects(
      useCase.execute({ accountId, config: invalid }),
      (error) => error.code === 'VERIFIED_RELEASE_SCHEDULE_INVALID',
    );
  }
});

test('GenerateCommentResponseSuggestion resolves one active account schedule and snapshots it per language', async () => {
  const { useCase, calls } = createGeneration();

  const result = await useCase.execute({ accountId, externalCommentId: comment.externalCommentId });

  const generated = calls.filter(([kind]) => kind === 'generate').map(([, input]) => input);
  const recorded = calls.filter(([kind]) => kind === 'recordSuggestion').map(([, input]) => input);
  assert.deepEqual(calls.find(([kind]) => kind === 'getSchedule'), ['getSchedule', tenantId, accountId]);
  assert.deepEqual(generated.map((input) => input.language), ['pt-BR', 'en-US', 'es-ES']);
  assert.ok(generated.every((input) => JSON.stringify(input.verifiedReleaseSchedule) === JSON.stringify(activeGenerationContext)));
  assert.equal(recorded.length, 3);
  assert.ok(recorded.every((input) => JSON.stringify(input.verifiedReleaseScheduleSnapshot) === JSON.stringify(activeSnapshot)));
  assert.notEqual(recorded[0].verifiedReleaseScheduleSnapshot, recorded[1].verifiedReleaseScheduleSnapshot);
  assert.notEqual(recorded[0].verifiedReleaseScheduleSnapshot.schedule, recorded[1].verifiedReleaseScheduleSnapshot.schedule);
  assert.ok(result.variants.every((event) => event.payload.verifiedReleaseScheduleSnapshot.status === 'ACTIVE'));
});

test('generation with no saved schedule sends no day/time facts and records UNCONFIGURED per variant', async () => {
  const { useCase, calls } = createGeneration({ schedule: null });

  const result = await useCase.execute({ accountId, externalCommentId: comment.externalCommentId });

  const generated = calls.filter(([kind]) => kind === 'generate').map(([, input]) => input);
  const recorded = calls.filter(([kind]) => kind === 'recordSuggestion').map(([, input]) => input);
  assert.ok(generated.every((input) => JSON.stringify(input.verifiedReleaseSchedule) === '{"status":"UNCONFIGURED"}'));
  assert.ok(recorded.every((input) => input.verifiedReleaseScheduleSnapshot.status === 'UNCONFIGURED'
    && input.verifiedReleaseScheduleSnapshot.schedule === null));
  assert.equal(result.variants.length, 3);
});

test('a continuation request and old replies never create or confirm a release schedule', async () => {
  const history = [
    { id: 'analysis-1', eventType: 'COMMENT_ANALYSIS_CREATED', payload: analysis },
    { id: 'old-manual', eventType: 'MANUAL_RESPONSE_CREATED', payload: { text: 'We post every Wednesday at 8:30.' } },
    { id: 'old-suggestion', eventType: 'RESPONSE_SUGGESTION_GENERATED', payload: { text: 'New episodes are out on Wednesdays.' } },
  ];
  const continuationComment = { ...comment, text: 'Continuação parte 2' };
  const { useCase, calls } = createGeneration({ schedule: null, events: history, commentFound: continuationComment });

  await useCase.execute({ accountId, externalCommentId: comment.externalCommentId });

  const generated = calls.filter(([kind]) => kind === 'generate').map(([, input]) => input);
  assert.ok(generated.every((input) => input.comment.text === 'Continuação parte 2'));
  assert.ok(generated.every((input) => JSON.stringify(input.verifiedReleaseSchedule) === '{"status":"UNCONFIGURED"}'));
});

test('generation with a disabled schedule preserves its audit snapshot but sends no disabled time facts', async () => {
  const disabled = { ...storedSchedule, enabled: false };
  const { useCase, calls } = createGeneration({ schedule: disabled });

  await useCase.execute({ accountId, externalCommentId: comment.externalCommentId });

  const generated = calls.filter(([kind]) => kind === 'generate').map(([, input]) => input);
  const recorded = calls.filter(([kind]) => kind === 'recordSuggestion').map(([, input]) => input);
  assert.ok(generated.every((input) => JSON.stringify(input.verifiedReleaseSchedule) === '{"status":"DISABLED"}'));
  assert.ok(recorded.every((input) => input.verifiedReleaseScheduleSnapshot.status === 'DISABLED'
    && input.verifiedReleaseScheduleSnapshot.schedule.enabled === false));
});

test('a schedule update affects new suggestions only and leaves prior language snapshots unchanged', async () => {
  const history = [{ id: 'analysis-1', eventType: 'COMMENT_ANALYSIS_CREATED', payload: analysis }];
  const suggestionInputs = [];
  let currentSchedule = { ...storedSchedule, version: 1 };
  let nextSuggestionId = 0;
  const workflowEvents = {
    listByComment: async () => history,
    append: async (input) => ({ ...input, id: `failure-${history.length}`, expiresAt: comment.expiresAt }),
  };
  const useCase = new GenerateCommentResponseSuggestion(
    accountRepository(),
    { findByExternalCommentId: async () => comment },
    {
      generate: async (input) => ({
        text: `Reply ${input.language}`,
        language: input.language,
        intendedTone: 'FRIENDLY',
        confidence: 0.8,
        rationale: null,
        provider: 'GEMINI',
        model: 'gemini-test',
      }),
    },
    {
      execute: async (input) => {
        suggestionInputs.push(input);
        const event = {
          id: `suggestion-${++nextSuggestionId}`,
          eventType: 'RESPONSE_SUGGESTION_GENERATED',
          status: 'SUCCEEDED',
          payload: { ...input.suggestion, verifiedReleaseScheduleSnapshot: input.verifiedReleaseScheduleSnapshot },
        };
        history.push(event);
        return event;
      },
    },
    workflowEvents,
    { resolveTenantId: async () => tenantId },
    { get: async () => null },
    { get: async () => null },
    { get: async () => currentSchedule },
    { get: async () => null },
    now,
  );

  const firstRun = await useCase.execute({ accountId, externalCommentId: comment.externalCommentId });
  const originalSnapshot = firstRun.variants[0].payload.verifiedReleaseScheduleSnapshot;
  currentSchedule = {
    ...storedSchedule,
    localTime: '21:15',
    version: 2,
    updatedAt: '2026-10-16T12:00:00.000Z',
    confirmedAt: '2026-10-16T12:00:00.000Z',
  };
  const secondRun = await useCase.execute({ accountId, externalCommentId: comment.externalCommentId });

  assert.equal(originalSnapshot.schedule.version, 1);
  assert.equal(firstRun.variants[0].payload.verifiedReleaseScheduleSnapshot.schedule.localTime, '20:30');
  assert.equal(secondRun.variants[0].payload.verifiedReleaseScheduleSnapshot.schedule.version, 2);
  assert.equal(secondRun.variants[0].payload.verifiedReleaseScheduleSnapshot.schedule.localTime, '21:15');
  assert.equal(firstRun.variants[0].payload.text, 'Reply pt-BR');
  assert.equal(suggestionInputs.length, 6);
});

test('generation fails closed when the account schedule cannot be read and records each failed variant', async () => {
  const { useCase, calls, failures } = createGeneration({ scheduleError: new Error('database details') });

  await assert.rejects(
    useCase.execute({ accountId, externalCommentId: comment.externalCommentId }),
    (error) => error.code === 'VERIFIED_RELEASE_SCHEDULE_UNAVAILABLE',
  );

  assert.equal(calls.some(([kind]) => kind === 'generate'), false);
  assert.equal(failures.length, 3);
  assert.ok(failures.every((event) => event.payload.errorCode === 'VERIFIED_RELEASE_SCHEDULE_UNAVAILABLE'
    && event.payload.verifiedReleaseScheduleSnapshot === null));
});

test('EvaluateResponseSuggestion sends the active account schedule and records the evaluation snapshot', async () => {
  const { useCase, calls, revision } = createEvaluation();

  await useCase.execute({ accountId, externalCommentId: comment.externalCommentId, revisionEventId: revision.id });

  const evaluated = calls.find(([kind]) => kind === 'evaluate')[1];
  const recorded = calls.find(([kind]) => kind === 'recordEvaluation')[1];
  assert.deepEqual(evaluated, {
    comment,
    analysis,
    responseText: revision.payload.text,
    verifiedReleaseSchedule: activeEvaluationContext,
  });
  assert.deepEqual(recorded.verifiedReleaseScheduleSnapshot, activeSnapshot);
});

test('EvaluateResponseSuggestion omits schedule context and signal when no schedule is configured', async () => {
  const noScheduleEvaluation = { ...responseEvaluation };
  delete noScheduleEvaluation.scheduleConsistency;
  delete noScheduleEvaluation.signals;
  const { useCase, calls, revision } = createEvaluation({ schedule: null, evaluation: noScheduleEvaluation });
  const output = await useCase.execute({ accountId, externalCommentId: comment.externalCommentId, revisionEventId: revision.id });

  assert.deepEqual(calls.find(([kind]) => kind === 'evaluate')[1], {
    comment,
    analysis,
    responseText: revision.payload.text,
  });
  assert.equal(calls.find(([kind]) => kind === 'recordEvaluation')[1].verifiedReleaseScheduleSnapshot.status, 'UNCONFIGURED');
  assert.equal(output.id, 'evaluation-1');
  assert.equal(calls.find(([kind]) => kind === 'recordEvaluation')[1].evaluation.scheduleConsistency, undefined);
});

test('EvaluateResponseSuggestion omits inactive schedule facts and consistency signal for a disabled schedule', async () => {
  const disabledEvaluation = { ...responseEvaluation };
  delete disabledEvaluation.scheduleConsistency;
  delete disabledEvaluation.signals;
  const { useCase, calls, revision } = createEvaluation({
    schedule: { ...storedSchedule, enabled: false },
    evaluation: disabledEvaluation,
  });

  await useCase.execute({ accountId, externalCommentId: comment.externalCommentId, revisionEventId: revision.id });

  assert.deepEqual(calls.find(([kind]) => kind === 'evaluate')[1], {
    comment,
    analysis,
    responseText: revision.payload.text,
  });
  const recorded = calls.find(([kind]) => kind === 'recordEvaluation')[1];
  assert.equal(recorded.verifiedReleaseScheduleSnapshot.status, 'DISABLED');
  assert.equal(recorded.evaluation.scheduleConsistency, undefined);
});

test('EvaluateResponseSuggestion fails closed on a schedule-store outage without calling TypeSafe', async () => {
  const { useCase, calls, failures, revision } = createEvaluation({ scheduleError: new Error('database details') });

  await assert.rejects(
    useCase.execute({ accountId, externalCommentId: comment.externalCommentId, revisionEventId: revision.id }),
    (error) => error.code === 'VERIFIED_RELEASE_SCHEDULE_UNAVAILABLE',
  );

  assert.equal(calls.some(([kind]) => kind === 'evaluate'), false);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].payload.errorCode, 'VERIFIED_RELEASE_SCHEDULE_UNAVAILABLE');
  assert.equal(failures[0].payload.verifiedReleaseScheduleSnapshot, null);
});

test('GenerateCommentResponseSuggestion inherits the tenant schedule when the account has none', async () => {
  const { useCase, calls } = createGeneration({ schedule: null, tenantSchedule: storedSchedule });

  await useCase.execute({ accountId, externalCommentId: comment.externalCommentId });

  assert.deepEqual(calls.find(([kind]) => kind === 'getTenantSchedule'), ['getTenantSchedule', tenantId]);
  const generated = calls.filter(([kind]) => kind === 'generate').map(([, input]) => input);
  const recorded = calls.filter(([kind]) => kind === 'recordSuggestion').map(([, input]) => input);
  assert.ok(generated.every((input) => JSON.stringify(input.verifiedReleaseSchedule) === JSON.stringify(activeGenerationContext)));
  assert.ok(recorded.every((input) => JSON.stringify(input.verifiedReleaseScheduleSnapshot) === JSON.stringify(tenantSnapshot)));
});

test('a disabled account schedule overrides an active tenant schedule for generation and evaluation', async () => {
  const disabled = { ...storedSchedule, enabled: false };
  const { useCase, calls } = createGeneration({ schedule: disabled, tenantSchedule: storedSchedule });

  await useCase.execute({ accountId, externalCommentId: comment.externalCommentId });

  assert.equal(calls.some(([kind]) => kind === 'getTenantSchedule'), false);
  const generated = calls.filter(([kind]) => kind === 'generate').map(([, input]) => input);
  assert.ok(generated.every((input) => JSON.stringify(input.verifiedReleaseSchedule) === '{"status":"DISABLED"}'));
  const recorded = calls.filter(([kind]) => kind === 'recordSuggestion').map(([, input]) => input);
  assert.ok(recorded.every((input) => input.verifiedReleaseScheduleSnapshot.source === 'ACCOUNT'
    && input.verifiedReleaseScheduleSnapshot.status === 'DISABLED'));

  const evaluation = { ...responseEvaluation };
  delete evaluation.scheduleConsistency;
  delete evaluation.signals;
  const evaluationContext = createEvaluation({ schedule: disabled, tenantSchedule: storedSchedule, evaluation });
  await evaluationContext.useCase.execute({ accountId, externalCommentId: comment.externalCommentId, revisionEventId: evaluationContext.revision.id });

  assert.equal(evaluationContext.calls.some(([kind]) => kind === 'getTenantSchedule'), false);
  assert.deepEqual(evaluationContext.calls.find(([kind]) => kind === 'evaluate')[1], {
    comment,
    analysis,
    responseText: evaluationContext.revision.payload.text,
  });
  const recordedEvaluation = evaluationContext.calls.find(([kind]) => kind === 'recordEvaluation')[1];
  assert.equal(recordedEvaluation.verifiedReleaseScheduleSnapshot.source, 'ACCOUNT');
  assert.equal(recordedEvaluation.verifiedReleaseScheduleSnapshot.status, 'DISABLED');
});

test('EvaluateResponseSuggestion inherits the tenant schedule when the account has none', async () => {
  const { useCase, calls, revision } = createEvaluation({ schedule: null, tenantSchedule: storedSchedule });

  await useCase.execute({ accountId, externalCommentId: comment.externalCommentId, revisionEventId: revision.id });

  assert.deepEqual(calls.find(([kind]) => kind === 'getTenantSchedule'), ['getTenantSchedule', tenantId]);
  assert.deepEqual(calls.find(([kind]) => kind === 'evaluate')[1], {
    comment,
    analysis,
    responseText: revision.payload.text,
    verifiedReleaseSchedule: activeEvaluationContext,
  });
  assert.deepEqual(calls.find(([kind]) => kind === 'recordEvaluation')[1].verifiedReleaseScheduleSnapshot, tenantSnapshot);
});
