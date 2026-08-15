const test = require('node:test');
const assert = require('node:assert/strict');

const {
  idempotentMessageDocumentId,
  isMatchingIdempotentMessage,
  normalizeClientRequestId,
} = require('../lib/messageIdempotencyPolicy');

test('accepts canonical UUID v4 request ids and normalizes case', () => {
  assert.equal(
    normalizeClientRequestId(' 550E8400-E29B-41D4-A716-446655440000 '),
    '550e8400-e29b-41d4-a716-446655440000'
  );
});

test('rejects missing, malformed, and non-v4 request ids', () => {
  assert.equal(normalizeClientRequestId(undefined), null);
  assert.equal(normalizeClientRequestId('not-a-uuid'), null);
  assert.equal(
    normalizeClientRequestId('550e8400-e29b-11d4-a716-446655440000'),
    null
  );
});

test('derives a stable sender-scoped message document id', () => {
  const requestId = '550e8400-e29b-41d4-a716-446655440000';
  const first = idempotentMessageDocumentId('user-a', requestId);
  assert.equal(first, idempotentMessageDocumentId('user-a', requestId));
  assert.notEqual(first, idempotentMessageDocumentId('user-b', requestId));
  assert.match(first, /^[0-9a-f]{64}$/);
});

test('recognizes only the original sender and request id', () => {
  const requestId = '550e8400-e29b-41d4-a716-446655440000';
  const message = { senderId: 'user-a', clientRequestId: requestId };
  assert.equal(
    isMatchingIdempotentMessage(message, {
      senderUid: 'user-a',
      clientRequestId: requestId,
    }),
    true
  );
  assert.equal(
    isMatchingIdempotentMessage(message, {
      senderUid: 'user-b',
      clientRequestId: requestId,
    }),
    false
  );
});
