const assert = require('node:assert/strict');
const test = require('node:test');

const { deprecatedLikeResult } = require('../lib/legacyDiscoveryPolicy');

test('deprecated likes can never create or unlock a chat room', () => {
  assert.deepEqual(deprecatedLikeResult(), {
    matched: false,
    matchId: null,
    deprecated: true,
  });
});
