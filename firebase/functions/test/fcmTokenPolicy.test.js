const assert = require('node:assert/strict');
const test = require('node:test');

const {
  fcmProfileNotReadyReason,
  fcmTokenOwnershipId,
  retryableFcmRegistrationDetails,
  shouldClearOwnedFcmToken,
} = require('../lib/fcmTokenPolicy');

test('derives a deterministic non-plaintext token ownership id', () => {
  const id = fcmTokenOwnershipId('device-token');
  assert.equal(id, fcmTokenOwnershipId('device-token'));
  assert.equal(id.length, 64);
  assert.notEqual(id, 'device-token');
});

test('clears only the exact token currently owned by an account', () => {
  assert.equal(shouldClearOwnedFcmToken({
    storedToken: 'token-a',
    requestedToken: 'token-a',
  }), true);
  assert.equal(shouldClearOwnedFcmToken({
    storedToken: 'new-token',
    requestedToken: 'old-token',
  }), false);
});

test('encodes only a minimal retryable result while the own profile is absent', () => {
  const details = retryableFcmRegistrationDetails('missing');

  assert.deepEqual(details, {
    reason: fcmProfileNotReadyReason,
    retryable: true,
  });
  assert.deepEqual(Object.keys(details).sort(), ['reason', 'retryable']);
  assert.equal(JSON.stringify(details).includes('token'), false);
  assert.equal(JSON.stringify(details).includes('uid'), false);
});

test('does not label banned, deleted, or active accounts as retryable', () => {
  assert.equal(retryableFcmRegistrationDetails('banned'), null);
  assert.equal(retryableFcmRegistrationDetails('deleted'), null);
  assert.equal(retryableFcmRegistrationDetails(null), null);
});
