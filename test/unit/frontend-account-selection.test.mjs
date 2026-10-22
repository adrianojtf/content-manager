import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSelectedAccountId } from '../../web/account-selection.mjs';

test('account-scoped settings select the only available account automatically', () => {
  assert.equal(resolveSelectedAccountId([{ id: 'youtube-account' }], null), 'youtube-account');
});

test('account selection preserves a valid explicit choice and leaves multiple accounts unselected', () => {
  const accounts = [{ id: 'account-a' }, { id: 'account-b' }];

  assert.equal(resolveSelectedAccountId(accounts, 'account-b'), 'account-b');
  assert.equal(resolveSelectedAccountId(accounts, null), null);
  assert.equal(resolveSelectedAccountId(accounts, 'no-longer-connected'), null);
});

test('account selection returns no account when the selected network has no accounts', () => {
  assert.equal(resolveSelectedAccountId([], 'disconnected-account'), null);
});
