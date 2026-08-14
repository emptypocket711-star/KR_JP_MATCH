const assert = require('node:assert/strict');
const test = require('node:test');

const {
  fcmTokenOwnershipId,
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
