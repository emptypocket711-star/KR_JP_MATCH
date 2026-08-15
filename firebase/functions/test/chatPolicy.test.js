const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MAX_ACTIVE_PAIR_ROOMS_PER_SAFETY_ACTION,
  activePairRoomIdsForSafety,
  decideCloseActiveChatPolicy,
  decideStartChatPolicy,
  isExactDirectChatParticipants,
  isReusableDirectRoom,
} = require('../lib/chatPolicy');

test('reuses an active pair room without charging points', () => {
  const decision = decideStartChatPolicy({
    currentPoints: 2,
    activePairMatchId: 'active_room',
    activePairMatchValid: true,
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
  });

  assert.deepEqual(decision, {
    action: 'insufficient-points',
  });
});

test('never implicitly reuses an un-migrated legacy room', () => {
  const decision = decideStartChatPolicy({
    currentPoints: 1,
    activePairMatchId: undefined,
    activePairMatchValid: false,
  });

  assert.deepEqual(decision, {
    action: 'create',
    pointBalance: 0,
    alreadyExists: false,
  });
});

function reusableRoom(overrides = {}) {
  return {
    matchId: 'room_1',
    matchExists: true,
    matchActive: true,
    matchUserIds: ['alice', 'bob'],
    matchPairKey: 'alice_bob',
    directRoomVersion: 1,
    hiddenFor: [],
    expectedUserIds: ['alice', 'bob'],
    pointerExists: true,
    pointerId: 'alice_bob',
    pointerUserIds: ['alice', 'bob'],
    pointerPairKey: 'alice_bob',
    pointerActiveMatchId: 'room_1',
    ...overrides,
  };
}

test('reuses only the current exact visible V1 direct room', () => {
  assert.equal(isReusableDirectRoom(reusableRoom()), true);
  for (const overrides of [
    { hiddenFor: ['alice'] },
    { hiddenFor: ['bob'] },
    { hiddenFor: undefined },
    { hiddenFor: 'alice' },
    { directRoomVersion: undefined },
    { directRoomVersion: 2 },
    { matchPairKey: undefined },
    { pointerExists: false },
    { pointerActiveMatchId: 'old_room' },
    { pointerClosedMatchId: 'closed_room' },
    { pointerClosedReason: 'blocked' },
    { pointerUserIds: ['alice', 'carol'] },
  ]) {
    assert.equal(
      isReusableDirectRoom(reusableRoom(overrides)),
      false,
      JSON.stringify(overrides)
    );
  }
});

test('selects every exact active pair room and fails closed above 100 same-pair rooms', () => {
  assert.deepEqual(activePairRoomIdsForSafety({
    records: [
      { id: 'room_2', isActive: true, userIds: ['bob', 'alice'] },
      { id: 'room_1', isActive: true, userIds: ['alice', 'bob'] },
      { id: 'closed', isActive: false, userIds: ['alice', 'bob'] },
      { id: 'other', isActive: true, userIds: ['alice', 'carol'] },
    ],
    actorUid: 'alice',
    targetUid: 'bob',
  }), {
    scanComplete: true,
    matchIds: ['room_1', 'room_2'],
  });

  const sentinel = Array.from(
    { length: MAX_ACTIVE_PAIR_ROOMS_PER_SAFETY_ACTION + 1 },
    (_, index) => ({
      id: `room_${index}`,
      isActive: true,
      userIds: ['alice', 'bob'],
    })
  );
  assert.deepEqual(activePairRoomIdsForSafety({
    records: sentinel,
    actorUid: 'alice',
    targetUid: 'bob',
  }), { scanComplete: false, matchIds: [] });
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
