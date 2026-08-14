const assert = require('node:assert/strict');
const test = require('node:test');

const {
  activeAccountIssue,
  callableIdentityIssue,
  isAccountDeletedOrDeleting,
} = require('../lib/callablePolicy');

test('requires App Check before callable authentication', () => {
  assert.equal(
    callableIdentityIssue({ hasAppCheck: false, uid: 'alice' }),
    'app-check'
  );
  assert.equal(
    callableIdentityIssue({ hasAppCheck: true, uid: undefined }),
    'authentication'
  );
  assert.equal(
    callableIdentityIssue({ hasAppCheck: true, uid: 'alice' }),
    null
  );
});

test('detects every supported deleting or deleted account marker', () => {
  assert.equal(isAccountDeletedOrDeleting(undefined), false);
  assert.equal(isAccountDeletedOrDeleting({}), false);
  assert.equal(isAccountDeletedOrDeleting({ isDeleted: true }), true);
  assert.equal(isAccountDeletedOrDeleting({ deleted: true }), true);
  assert.equal(isAccountDeletedOrDeleting({ deletionRequested: true }), true);
  assert.equal(isAccountDeletedOrDeleting({ deletedAt: {} }), true);
  assert.equal(isAccountDeletedOrDeleting({ accountStatus: 'deleting' }), true);
  assert.equal(isAccountDeletedOrDeleting({ accountStatus: 'deleted' }), true);
  assert.equal(isAccountDeletedOrDeleting({ accountStatus: 'deactivated' }), true);
  assert.equal(isAccountDeletedOrDeleting({ status: 'deleted' }), true);
  assert.equal(isAccountDeletedOrDeleting({ status: 'deactivated' }), true);
  assert.equal(isAccountDeletedOrDeleting({ accountStatus: 'active' }), false);
});

test('rechecks fresh account state before a server-owned grant', () => {
  assert.equal(activeAccountIssue({ exists: false, userData: undefined }), 'missing');
  assert.equal(
    activeAccountIssue({ exists: true, userData: { isBanned: true } }),
    'banned'
  );
  assert.equal(
    activeAccountIssue({ exists: true, userData: { status: 'banned' } }),
    'banned'
  );
  assert.equal(
    activeAccountIssue({ exists: true, userData: { accountStatus: 'banned' } }),
    'banned'
  );
  assert.equal(
    activeAccountIssue({ exists: true, userData: { deletionRequested: true } }),
    'deleted'
  );
  assert.equal(
    activeAccountIssue({ exists: true, userData: { accountStatus: 'active' } }),
    null
  );
});
