import assert from 'node:assert/strict';
import test from 'node:test';
import { commentKey, eventLabel, renderComment } from '../../web/view.mjs';

const comment = {
  platform: 'facebook',
  socialAccountId: 'account-1',
  externalCommentId: 'comment-1',
  externalThreadId: 'comment-1',
  externalPublicationId: 'post-1',
  authorDisplayName: 'Viewer',
  text: 'Great post!',
  createdAt: '2026-10-20T12:00:00.000Z',
  canReply: true,
  canLike: true,
  appLiked: false,
  appReplied: false,
  externalReplyStatus: 'UNKNOWN',
};

function render(commentValue, busy = false) {
  const key = commentKey(commentValue.socialAccountId, commentValue.externalCommentId);
  return renderComment(commentValue, {
    workflows: new Map([[key, []]]),
    workflowErrors: new Map(),
    workflowLoading: new Set(),
    expandedComments: new Set(),
    drafts: new Map(),
    busy: busy ? new Set([`like:${key}`]) : new Set(),
    language: 'pt-BR',
  });
}

test('supported comments show a hollow heart until liked and a red filled heart after success', () => {
  const unliked = render(comment);
  const liked = render({ ...comment, appLiked: true });

  assert.match(unliked, /data-action="toggle-comment-like"[^>]*aria-pressed="false"/);
  assert.match(unliked, /fill="none"/);
  assert.doesNotMatch(unliked, /comment-like-button is-liked/);
  assert.match(liked, /class="comment-like-button is-liked"/);
  assert.match(liked, /aria-pressed="true"/);
  assert.match(liked, /fill="currentColor"/);
});

test('unsupported comments do not show the like control and pending requests disable it', () => {
  assert.doesNotMatch(render({ ...comment, canLike: false }), /data-action="toggle-comment-like"/);
  assert.doesNotMatch(render({ ...comment, platform: 'youtube', canLike: false }), /data-action="toggle-comment-like"/);
  assert.match(render(comment, true), /data-action="toggle-comment-like"[^>]*disabled/);
});

test('like history labels distinguish a like from an unlike', () => {
  assert.equal(eventLabel({ eventType: 'COMMENT_LIKE_CHANGED', status: 'SUCCEEDED', payload: { action: 'LIKE' } }), 'Comentário curtido');
  assert.equal(eventLabel({ eventType: 'COMMENT_LIKE_CHANGED', status: 'SUCCEEDED', payload: { action: 'UNLIKE' } }), 'Curtida removida');
  assert.equal(eventLabel({ eventType: 'COMMENT_LIKE_CHANGED', status: 'FAILED', payload: { action: 'LIKE' } }), 'Comentário curtido — falhou');
});
