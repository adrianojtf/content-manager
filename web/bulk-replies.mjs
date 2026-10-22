import { hasAttemptedVersion, responseVersionDetails } from './view.mjs';

export function isConfirmedUnanswered(comment) {
  return comment?.appReplied === false && comment?.externalReplyStatus === 'NOT_REPLIED';
}

export async function loadSemiAutomaticReplyComments(api, accountId, publicationId) {
  const syncResult = await api.runWorkflowBatch({
    operation: 'sync',
    scope: 'publication',
    accountId,
    publicationId,
  });
  const allComments = await api.listComments(accountId, publicationId);
  const synchronizedCommentIds = new Set((syncResult.results ?? [])
    .filter((result) => typeof result.externalCommentId === 'string'
      && ['SUCCEEDED', 'PARTIAL'].includes(result.status))
    .map((result) => result.externalCommentId));
  return {
    syncResult,
    allComments,
    comments: allComments.filter((comment) => (
      synchronizedCommentIds.has(comment.externalCommentId) && isConfirmedUnanswered(comment)
    )),
  };
}

export async function generateSemiAutomaticReplies(api, {
  accountId,
  comments,
  toneProfile,
  toneProfileForComment,
  languageForComment,
  onProgress = () => {},
}) {
  const rows = [];

  for (const [index, comment] of comments.entries()) {
    const row = {
      comment,
      status: 'pending',
      language: languageForComment?.(comment) ?? 'pt-BR',
      toneProfile: copyToneProfile(toneProfileForComment?.(comment) ?? toneProfile),
      events: [],
      failures: [],
      errorCode: null,
      approved: false,
    };
    rows.push(row);

    const report = (phase) => onProgress({
      commentId: comment.externalCommentId,
      index: index + 1,
      total: comments.length,
      phase,
      row,
      rows,
    });

    try {
      report('loading-history');
      row.events = await api.getWorkflow(accountId, comment.externalCommentId);
      let analysisEvent = latestSuccessfulAnalysis(row.events);

      if (!analysisEvent) {
        row.status = 'evaluating';
        report('evaluating');
        const createdAnalysis = await api.classify(accountId, comment.externalCommentId);
        try {
          row.events = await api.getWorkflow(accountId, comment.externalCommentId);
          row.historyWarning = false;
        } catch {
          row.events = mergeEvents(row.events, [createdAnalysis]);
          row.historyWarning = true;
        }
        analysisEvent = latestSuccessfulAnalysis(row.events);
        analysisEvent ??= createdAnalysis?.eventType === 'COMMENT_ANALYSIS_CREATED' ? createdAnalysis : null;
        if (!analysisEvent) {
          throw Object.assign(new Error('COMMENT_ANALYSIS_NOT_FOUND'), { code: 'COMMENT_ANALYSIS_NOT_FOUND' });
        }
      }

      row.status = 'generating';
      report('generating');
      const toneOverride = row.toneProfile?.primaryTone ?? toneProfile?.primaryTone;
      const generation = await api.generateResponse(accountId, comment.externalCommentId, {
        analysisEventId: analysisEvent.id,
        ...(toneOverride ? { toneOverride } : {}),
      });
      row.failures = generation.failures ?? [];
      try {
        row.events = await api.getWorkflow(accountId, comment.externalCommentId);
        row.historyWarning = false;
      } catch {
        row.events = mergeEvents(row.events, generation.variants ?? []);
        row.historyWarning = true;
      }
      row.errorCode = row.failures[0]?.errorCode ?? null;
      row.status = row.failures.length > 0 ? 'partial' : 'ready';
      if (!generation.variants?.length) {
        row.status = 'failed';
        row.errorCode ??= 'INTELLIGENCE_PROVIDER_RESPONSE_INVALID';
      }
    } catch (error) {
      try {
        row.events = await api.getWorkflow(accountId, comment.externalCommentId);
      } catch {
        row.events = row.events ?? [];
      }
      row.status = 'failed';
      row.errorCode = typeof error?.code === 'string' ? error.code : 'COMMENT_WORKFLOW_FAILED';
    }

    report('completed');
  }

  return rows;
}

export async function approveSemiAutomaticReplies(api, {
  accountId,
  rows,
  commentIds,
  onProgress = () => {},
}) {
  const selected = new Set(commentIds);
  let approved = 0;
  let failed = 0;

  for (const row of rows) {
    const commentId = row.comment.externalCommentId;
    if (!selected.has(commentId) || row.approved || !['ready', 'partial'].includes(row.status)) continue;

    const previousStatus = row.status;
    const response = responseVersionDetails(row.events ?? [], row.language);
    const text = row.drafts?.get(row.language) ?? row.draft ?? response?.version.payload.text ?? '';
    row.status = 'saving';
    onProgress({ phase: 'saving', row });

    try {
      if (!response || !text.trim()) {
        throw Object.assign(new Error('RESPONSE_SUGGESTION_INVALID'), { code: 'RESPONSE_SUGGESTION_INVALID' });
      }

      const languages = new Set([...(row.drafts?.keys() ?? []), row.language]);
      for (const language of languages) {
        const version = responseVersionDetails(row.events ?? [], language);
        if (!version) continue;
        const variantText = row.drafts?.has(language)
          ? row.drafts.get(language)
          : language === row.language
            ? row.draft
            : version.version.payload.text;
        if (!variantText.trim()) {
          throw Object.assign(new Error('RESPONSE_SUGGESTION_INVALID'), { code: 'RESPONSE_SUGGESTION_INVALID' });
        }

        let savedVersion = version.version;
        if (variantText.trim() !== (version.version.payload.text ?? '').trim()) {
          const revisionInput = {
            text: variantText.trim(),
            ...(version.isRevision ? { previousRevisionId: version.version.id } : {}),
          };
          savedVersion = version.kind === 'suggestion'
            ? await api.reviseSuggestion(accountId, commentId, version.rootId, revisionInput)
            : await api.reviseManualResponse(accountId, commentId, version.rootId, revisionInput);
          try {
            row.events = await api.getWorkflow(accountId, commentId);
            row.historyWarning = false;
          } catch {
            row.events = mergeEvents(row.events ?? [], [savedVersion]);
            row.historyWarning = true;
          }
          if (responseVersionDetails(row.events ?? [], language)?.version.id !== savedVersion.id) {
            row.events = mergeEvents(row.events ?? [], [savedVersion]);
          }
        }

        const latest = responseVersionDetails(row.events ?? [], language);
        const savedText = latest?.version.payload.text ?? savedVersion.payload.text ?? variantText.trim();
        row.drafts ??= new Map();
        row.drafts.set(language, savedText);
        if (language === row.language) row.draft = savedText;
      }

      row.approved = true;
      row.status = 'approved';
      row.errorCode = null;
      approved += 1;
    } catch (error) {
      row.status = previousStatus;
      row.errorCode = typeof error?.code === 'string' ? error.code : 'COMMENT_WORKFLOW_FAILED';
      failed += 1;
    }

    onProgress({ phase: 'completed', row });
  }

  return { approved, failed };
}

export function eligibleSemiAutomaticReplyRows(rows = []) {
  return rows.filter((row) => {
    if (!row.approved || row.status !== 'approved' || row.comment?.canReply !== true
      || !isConfirmedUnanswered(row.comment)) return false;
    const response = responseVersionDetails(row.events ?? [], row.language);
    const text = response?.version?.payload?.text;
    return Boolean(response?.version?.id)
      && typeof text === 'string'
      && Boolean(text.trim())
      && !hasAttemptedVersion(row.events ?? [], response.version.id);
  });
}

export async function sendApprovedSemiAutomaticReplies(api, {
  accountId,
  rows,
  onProgress = () => {},
}) {
  const sendableRows = eligibleSemiAutomaticReplyRows(rows);
  let sent = 0;
  let failed = 0;
  let processed = 0;
  let stoppedByRateLimit = false;

  for (const [index, row] of sendableRows.entries()) {
    const commentId = row.comment.externalCommentId;
    const response = responseVersionDetails(row.events ?? [], row.language);
    const versionId = response.version.id;
    row.status = 'sending';
    row.errorCode = null;
    onProgress({ phase: 'sending', index: index + 1, total: sendableRows.length, row });

    let requestError = null;
    try {
      const resultEvent = await api.sendResponse(accountId, commentId, versionId);
      if (resultEvent?.eventType === 'MANUAL_REPLY_RESULT') {
        row.events = mergeEvents(row.events ?? [], [resultEvent]);
      }
    } catch (error) {
      requestError = error;
    }

    try {
      row.events = mergeEvents(row.events ?? [], await api.getWorkflow(accountId, commentId));
      row.historyWarning = false;
    } catch {
      row.historyWarning = true;
    }

    const resultEvent = latestManualReplyResult(row.events, versionId);
    if (resultEvent?.status === 'SUCCEEDED') {
      row.status = 'sent';
      row.sentVersionId = versionId;
      row.errorCode = null;
      if (resultEvent.payload?.appReplyStatusPersisted !== false) row.comment.appReplied = true;
      sent += 1;
    } else {
      const errorCode = resultEvent?.payload?.errorCode
        ?? requestError?.code
        ?? 'SOCIAL_PROVIDER_RESULT_AMBIGUOUS';
      row.status = isAmbiguousSendResult(requestError, resultEvent)
        ? 'send-ambiguous'
        : 'send-failed';
      row.errorCode = errorCode;
      failed += 1;
      if (errorCode === 'SOCIAL_PROVIDER_RATE_LIMITED') stoppedByRateLimit = true;
    }

    processed += 1;
    onProgress({ phase: 'completed', index: index + 1, total: sendableRows.length, row });
    if (stoppedByRateLimit) break;
  }

  return {
    sent,
    failed,
    remaining: sendableRows.length - processed,
    stoppedByRateLimit,
  };
}

function latestSuccessfulAnalysis(events = []) {
  return [...events].reverse().find((event) => (
    event.eventType === 'COMMENT_ANALYSIS_CREATED' && event.status !== 'FAILED' && event.status !== 'UNSUPPORTED'
  )) ?? null;
}

function latestManualReplyResult(events = [], versionId) {
  return [...events].reverse().find((event) => (
    event.eventType === 'MANUAL_REPLY_RESULT'
    && (event.payload?.responseVersionEventId === versionId || event.payload?.revisionEventId === versionId)
  )) ?? null;
}

function isAmbiguousSendResult(error, resultEvent) {
  return (!resultEvent && !error)
    || resultEvent?.payload?.outcome === 'AMBIGUOUS'
    || ['API_UNAVAILABLE', 'SOCIAL_PROVIDER_RESULT_AMBIGUOUS'].includes(error?.code);
}

function copyToneProfile(profile) {
  if (!profile) return null;
  return {
    primaryTone: profile.primaryTone,
    modifiers: [...(profile.modifiers ?? [])],
    customNote: profile.customNote ?? null,
  };
}

function mergeEvents(events = [], additions = []) {
  const knownIds = new Set(events.map((event) => event.id));
  return [...events, ...additions.filter((event) => event?.id && !knownIds.has(event.id))];
}
