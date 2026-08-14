const assert = require('node:assert/strict');
const test = require('node:test');

const {
  decideCloseActiveChatPolicy,
  decideStartChatPolicy,
  isExactDirectChatParticipants,
} = require('../lib/chatPolicy');

test('reuses an active pair room without charging points', () => {
  const decision = decideStartChatPolicy({
    currentPoints: 2,
    activePairMatchId: 'active_room',
    activePairMatchValid: true,
    legacyMatchId: 'alice_bob',
    legacyMatchValid: false,
  });

  assert.deepEqual(decision, {
    action: 'reuse',
    matchId: 'active_room',
    pointBalance: 2,
    alreadyExists: true,
    source: 'pair',
  });
});

test('accepts only two unique direct-chat participants', () => {
  assert.equal(isExactDirectChatParticipants(['alice', 'bob']), true);
  assert.equal(
    isExactDirectChatParticipants(['bob', 'alice'], ['alice', 'bob']),
    true
  );
  assert.equal(isExactDirectChatParticipants(['alice', 'alice']), false);
  assert.equal(isExactDirectChatParticipants(['alice', 'bob', 'carol']), false);
  assert.equal(
    isExactDirectChatParticipants(['alice', 'carol'], ['alice', 'bob']),
    false
  );
  assert.equal(isExactDirectChatParticipants('alice,bob'), false);
});

test('creates a new room and charges one point after the old room was closed', () => {
  const decision = decideStartChatPolicy({
    currentPoints: 2,
    activePairMatchId: undefined,
    activePairMatchValid: false,
    legacyMatchId: 'alice_bob',
    legacyMatchValid: false,
  });

  assert.deepEqual(decision, {
    action: 'create',
    pointBalance: 1,
    alreadyExists: false,
  });
});

test('does not reuse an invalid pair pointer and charges for a new room', () => {
  const decision = decideStartChatPolicy({
    currentPoints: 1,
    activePairMatchId: 'closed_room',
    activePairMatchValid: false,
    legacyMatchId: 'alice_bob',
    legacyMatchValid: false,
  });

  assert.deepEqual(decision, {
    action: 'create',
    pointBalance: 0,
    alreadyExists: false,
  });
});

test('returns insufficient-points when there is no active room and balance is empty', () => {
  const decision = decideStartChatPolicy({
    currentPoints: 0,
    activePairMatchId: undefined,
    activePairMatchValid: false,
    legacyMatchId: 'alice_bob',
    legacyMatchValid: false,
  });

  assert.deepEqual(decision, {
    action: 'insufficient-points',
  });
});

test('keeps legacy active rooms free while migrating them to chatPairs', () => {
  const decision = decideStartChatPolicy({
    currentPoints: 0,
    activePairMatchId: undefined,
    activePairMatchValid: false,
    legacyMatchId: 'alice_bob',
    legacyMatchValid: true,
  });

  assert.deepEqual(decision, {
    action: 'reuse',
    matchId: 'alice_bob',
    pointBalance: 0,
    alreadyExists: true,
    source: 'legacy',
  });
});

test('closes an exact active pair room and clears its matching pair pointer', () => {
  assert.deepEqual(
    decideCloseActiveChatPolicy({
      matchId: 'room_1',
      matchExists: true,
      matchActive: true,
      matchUserIds: ['alice', 'bob'],
      actorUid: 'alice',
      targetUid: 'bob',
      pairActiveMatchId: 'room_1',
    }),
    { closeMatch: true, clearPairPointer: true }
  );
});

test('never clears a concurrently replaced active pair pointer', () => {
  assert.deepEqual(
    decideCloseActiveChatPolicy({
      matchId: 'old_room',
      matchExists: true,
      matchActive: true,
      matchUserIds: ['alice', 'bob'],
      actorUid: 'alice',
      targetUid: 'bob',
      pairActiveMatchId: 'new_room',
    }),
    { closeMatch: true, clearPairPointer: false }
  );
});

test('does not close inactive, missing, malformed, or other-pair rooms', () => {
  for (const input of [
    { matchExists: false, matchActive: true, matchUserIds: ['alice', 'bob'] },
    { matchExists: true, matchActive: false, matchUserIds: ['alice', 'bob'] },
    { matchExists: true, matchActive: true, matchUserIds: ['alice', 'carol'] },
    { matchExists: true, matchActive: true, matchUserIds: ['alice', 'bob', 'carol'] },
    { matchExists: true, matchActive: true, matchUserIds: 'alice,bob' },
  ]) {
    assert.deepEqual(
      decideCloseActiveChatPolicy({
        matchId: 'room_1',
        actorUid: 'alice',
        targetUid: 'bob',
        pairActiveMatchId: 'room_1',
        ...input,
      }),
      { closeMatch: false, clearPairPointer: false }
    );
  }
});
