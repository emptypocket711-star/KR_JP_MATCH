const assert = require('node:assert/strict');
const test = require('node:test');

const {
  actionKey,
  buildDirectRoomRemediationManifest,
  classifyDirectRoomRemediation,
  createRemediationIdentifierProtector,
  participantAccountState,
  verifyDirectRoomRemediationManifest,
} = require('../lib/directRoomRemediationPolicy');

function room(overrides = {}) {
  return {
    id: 'room_active',
    userIds: ['bob', 'alice'],
    isActive: true,
    pairKey: 'alice_bob',
    hiddenFor: [],
    ...overrides,
  };
}

function stalePointer(overrides = {}) {
  return {
    id: 'alice_bob',
    userIds: ['alice', 'bob'],
    pairKey: 'alice_bob',
    activeMatchId: 'room_active',
    closedMatchId: 'room_closed',
    closedReason: 'left_chat',
    ...overrides,
  };
}

function closedRoom(overrides = {}) {
  return {
    id: 'room_closed',
    userIds: ['alice', 'bob'],
    isActive: false,
    pairKey: 'alice_bob',
    hiddenFor: ['alice', 'bob'],
    closedReason: 'left_chat',
    ...overrides,
  };
}

function account(uid, state = 'active') {
  return { uid, state };
}

function classify({
  activeMatches = [room()],
  chatPairs = [],
  participantAccounts = [account('alice'), account('bob', 'missing')],
  referencedClosedMatches = [],
} = {}) {
  return classifyDirectRoomRemediation({
    activeMatches,
    chatPairs,
    participantAccounts,
    referencedClosedMatches,
  });
}

test('classifies missing and legacy deletion states without treating bans as deletion', () => {
  assert.equal(participantAccountState({ exists: false }), 'missing');
  assert.equal(participantAccountState({
    exists: true,
    userData: { deletionRequested: true },
  }), 'deleted');
  assert.equal(participantAccountState({
    exists: true,
    userData: { deleted: true },
  }), 'deleted');
  assert.equal(participantAccountState({
    exists: true,
    userData: { status: 'deactivated' },
  }), 'deleted');
  assert.equal(participantAccountState({
    exists: true,
    userData: { isBanned: true },
  }), 'ineligible');
  assert.equal(participantAccountState({
    exists: true,
    userData: { status: 'banned' },
  }), 'ineligible');
  assert.equal(participantAccountState({ exists: true, userData: {} }), 'active');
});

test('selects one exact active room with one missing participant and no pointer', () => {
  const result = classify();

  assert.deepEqual(result.closeUnavailableRooms, [{
    kind: 'close-unavailable-room',
    matchId: 'room_active',
    pairKey: 'alice_bob',
    participantKey: '["alice","bob"]',
    unavailableUid: 'bob',
    unavailableState: 'missing',
  }]);
  assert.equal(result.clearStaleClosedPointers.length, 0);
  assert.equal(result.findings.length, 0);
});

test('selects the same close action for one server-marked deleted participant', () => {
  const result = classify({
    participantAccounts: [account('alice'), account('bob', 'deleted')],
  });

  assert.equal(result.closeUnavailableRooms.length, 1);
  assert.equal(result.closeUnavailableRooms[0].unavailableState, 'deleted');
});

test('never closes when participant states are not exactly one active and one deleted', () => {
  for (const participantAccounts of [
    [account('alice'), account('bob')],
    [account('alice', 'missing'), account('bob', 'deleted')],
    [account('alice'), account('bob', 'ineligible')],
  ]) {
    const result = classify({ participantAccounts });
    assert.equal(result.closeUnavailableRooms.length, 0);
  }
});

test('never closes a duplicate active pair, conflicting room, or any pointer claim', () => {
  const duplicate = classify({
    activeMatches: [room(), room({ id: 'room_other' })],
  });
  const conflictingRoom = classify({
    activeMatches: [room({ pairKey: 'wrong', directRoomVersion: 2 })],
  });
  const pointerClaim = classify({
    chatPairs: [{
      id: 'unrelated',
      userIds: ['alice', 'bob'],
      pairKey: 'alice_bob',
      activeMatchId: 'other_room',
    }],
  });

  assert.equal(duplicate.closeUnavailableRooms.length, 0);
  assert.ok(duplicate.findings.some((item) => item.code === 'ambiguous-active-pair'));
  assert.equal(conflictingRoom.closeUnavailableRooms.length, 0);
  assert.ok(conflictingRoom.findings.some(
    (item) => item.code === 'close-room-state-conflict'
  ));
  assert.equal(pointerClaim.closeUnavailableRooms.length, 0);
  assert.ok(pointerClaim.findings.some(
    (item) => item.code === 'close-room-pointer-conflict'
  ));
});

test('selects one exact active pointer with one validated stale closed state', () => {
  const result = classify({
    chatPairs: [stalePointer()],
    participantAccounts: [account('alice'), account('bob')],
    referencedClosedMatches: [closedRoom()],
  });

  assert.deepEqual(result.clearStaleClosedPointers, [{
    kind: 'clear-stale-closed-pointer',
    matchId: 'room_active',
    closedMatchId: 'room_closed',
    pairKey: 'alice_bob',
    participantKey: '["alice","bob"]',
    pointerId: 'alice_bob',
    pointerClosedReason: 'left_chat',
    historicalClosedReason: 'left_chat',
  }]);
  assert.equal(result.closeUnavailableRooms.length, 0);
  assert.equal(result.findings.length, 0);
});

test('selects stale closed fields when both pointer and history omit closedReason', () => {
  const result = classify({
    chatPairs: [stalePointer({ closedReason: undefined })],
    participantAccounts: [account('alice'), account('bob')],
    referencedClosedMatches: [closedRoom({ closedReason: undefined })],
  });

  assert.deepEqual(result.clearStaleClosedPointers, [{
    kind: 'clear-stale-closed-pointer',
    matchId: 'room_active',
    closedMatchId: 'room_closed',
    pairKey: 'alice_bob',
    participantKey: '["alice","bob"]',
    pointerId: 'alice_bob',
    pointerClosedReason: undefined,
    historicalClosedReason: undefined,
  }]);
  assert.equal(result.findings.length, 0);
});

test('selects the reviewed legacy pointer-absent history-present reason shape', () => {
  const result = classify({
    chatPairs: [stalePointer({ closedReason: undefined })],
    participantAccounts: [account('alice'), account('bob')],
    referencedClosedMatches: [closedRoom({ closedReason: 'left_chat' })],
  });

  assert.deepEqual(result.clearStaleClosedPointers, [{
    kind: 'clear-stale-closed-pointer',
    matchId: 'room_active',
    closedMatchId: 'room_closed',
    pairKey: 'alice_bob',
    participantKey: '["alice","bob"]',
    pointerId: 'alice_bob',
    pointerClosedReason: undefined,
    historicalClosedReason: 'left_chat',
  }]);
  assert.equal(result.findings.length, 0);
});

test('keeps invalid, reversed, and unequal closed reasons as findings', () => {
  const invalidPointerReasons = [null, '', 7].map((closedReason) => classify({
    chatPairs: [stalePointer({ closedReason })],
    participantAccounts: [account('alice'), account('bob')],
    referencedClosedMatches: [closedRoom()],
  }));
  const invalidHistoricalReasons = [null, '', 7].map((closedReason) => classify({
    chatPairs: [stalePointer({ closedReason: undefined })],
    participantAccounts: [account('alice'), account('bob')],
    referencedClosedMatches: [closedRoom({ closedReason })],
  }));
  const unsafeReasonPairs = [
    classify({
      chatPairs: [stalePointer()],
      participantAccounts: [account('alice'), account('bob')],
      referencedClosedMatches: [closedRoom({ closedReason: undefined })],
    }),
    classify({
      chatPairs: [stalePointer({ closedReason: 'left_chat' })],
      participantAccounts: [account('alice'), account('bob')],
      referencedClosedMatches: [closedRoom({ closedReason: 'blocked' })],
    }),
  ];

  for (const result of invalidPointerReasons) {
    assert.equal(result.clearStaleClosedPointers.length, 0);
    assert.ok(result.findings.some(
      (item) => item.code === 'malformed-stale-pointer'
    ));
  }
  for (const result of [...invalidHistoricalReasons, ...unsafeReasonPairs]) {
    assert.equal(result.clearStaleClosedPointers.length, 0);
    assert.ok(result.findings.some(
      (item) => item.code === 'stale-pointer-history-conflict'
    ));
  }
});

test('preserves five safe closures while adding one asymmetric legacy cleanup', () => {
  const closeRooms = Array.from({ length: 5 }, (_, index) => room({
    id: `room_close_${index}`,
    userIds: [`active-${index}`, `gone-${index}`],
    pairKey: `active-${index}_gone-${index}`,
  }));
  const participantAccounts = Array.from({ length: 5 }, (_, index) => [
    account(`active-${index}`),
    account(`gone-${index}`, 'missing'),
  ]).flat();
  const result = classify({
    activeMatches: [...closeRooms, room()],
    chatPairs: [stalePointer({ closedReason: undefined })],
    participantAccounts: [
      ...participantAccounts,
      account('alice'),
      account('bob'),
    ],
    referencedClosedMatches: [closedRoom({ closedReason: 'left_chat' })],
  });

  assert.equal(result.closeUnavailableRooms.length, 5);
  assert.equal(result.clearStaleClosedPointers.length, 1);
  assert.equal(result.findings.length, 0);
});

test('does not treat normal active-only or closed-only pointers as remediation actions', () => {
  const activeOnly = classify({
    chatPairs: [stalePointer({
      closedMatchId: undefined,
      closedReason: undefined,
    })],
    participantAccounts: [account('alice'), account('bob')],
  });
  const closedOnly = classify({
    activeMatches: [],
    chatPairs: [stalePointer({ activeMatchId: undefined })],
    participantAccounts: [],
    referencedClosedMatches: [closedRoom()],
  });

  assert.equal(activeOnly.clearStaleClosedPointers.length, 0);
  assert.equal(closedOnly.clearStaleClosedPointers.length, 0);
});

test('rejects stale pointer cleanup on user, current room, history, or uniqueness drift', () => {
  const inactiveUser = classify({
    chatPairs: [stalePointer()],
    participantAccounts: [account('alice'), account('bob', 'deleted')],
    referencedClosedMatches: [closedRoom()],
  });
  const duplicateRoom = classify({
    activeMatches: [room(), room({ id: 'room_other' })],
    chatPairs: [stalePointer()],
    participantAccounts: [account('alice'), account('bob')],
    referencedClosedMatches: [closedRoom()],
  });
  const wrongHistory = classify({
    chatPairs: [stalePointer()],
    participantAccounts: [account('alice'), account('bob')],
    referencedClosedMatches: [closedRoom({ closedReason: 'blocked' })],
  });
  const duplicatePointer = classify({
    chatPairs: [
      stalePointer(),
      stalePointer({ id: 'duplicate_pointer' }),
    ],
    participantAccounts: [account('alice'), account('bob')],
    referencedClosedMatches: [closedRoom()],
  });

  assert.equal(inactiveUser.clearStaleClosedPointers.length, 0);
  assert.ok(inactiveUser.findings.some(
    (item) => item.code === 'stale-pointer-participant-state-conflict'
  ));
  assert.equal(duplicateRoom.clearStaleClosedPointers.length, 0);
  assert.ok(duplicateRoom.findings.some(
    (item) => item.code === 'stale-pointer-current-room-conflict'
  ));
  assert.equal(wrongHistory.clearStaleClosedPointers.length, 0);
  assert.ok(wrongHistory.findings.some(
    (item) => item.code === 'stale-pointer-history-conflict'
  ));
  assert.equal(duplicatePointer.clearStaleClosedPointers.length, 0);
  assert.ok(duplicatePointer.findings.some(
    (item) => item.code === 'stale-pointer-duplicate-claim'
  ));
});

test('HMAC manifest contains no raw identifiers and rejects audit or action tampering', () => {
  const classification = classify({
    activeMatches: [
      room({
        id: 'room_missing',
        userIds: ['alice', 'missing-user'],
        pairKey: 'alice_missing-user',
      }),
      room(),
    ],
    chatPairs: [stalePointer()],
    participantAccounts: [
      account('alice'),
      account('bob'),
      account('missing-user', 'missing'),
    ],
    referencedClosedMatches: [closedRoom()],
  });
  const manifest = buildDirectRoomRemediationManifest({
    projectId: 'hana-e2ee6',
    createdAt: new Date('2026-08-13T00:00:00.000Z'),
    pageSize: 200,
    maxDocumentsPerCollection: 10000,
    scanComplete: true,
    participantReferencesRequested: 3,
    participantDocumentsFound: 2,
    closedMatchReferencesRequested: 1,
    closedMatchDocumentsFound: 1,
    classification,
    protector: createRemediationIdentifierProtector(Buffer.alloc(32, 7)),
  });
  const serialized = JSON.stringify(manifest);

  assert.equal(verifyDirectRoomRemediationManifest(manifest), true);
  assert.equal(manifest.actions.length, 2);
  assert.equal(new Set(manifest.actions.map(actionKey)).size, 2);
  for (const raw of ['alice', 'bob', 'missing-user', 'room_missing', 'room_closed']) {
    assert.equal(serialized.includes(raw), false);
  }

  const tamperedCount = JSON.parse(serialized);
  tamperedCount.counts.closeUnavailableRooms = 99;
  assert.equal(verifyDirectRoomRemediationManifest(tamperedCount), false);
  const tamperedAction = JSON.parse(serialized);
  tamperedAction.actions[0].matchHash = '0'.repeat(64);
  assert.equal(verifyDirectRoomRemediationManifest(tamperedAction), false);
});

test('manifest separately protects pointer and historical reason state', () => {
  const protector = createRemediationIdentifierProtector(Buffer.alloc(32, 12));
  const manifestForReasons = (pointerReason, historicalReason) => {
    const classification = classify({
      chatPairs: [stalePointer({ closedReason: pointerReason })],
      participantAccounts: [account('alice'), account('bob')],
      referencedClosedMatches: [closedRoom({ closedReason: historicalReason })],
    });
    return buildDirectRoomRemediationManifest({
      projectId: 'hana-e2ee6',
      createdAt: new Date('2026-08-13T00:00:00.000Z'),
      pageSize: 200,
      maxDocumentsPerCollection: 10000,
      scanComplete: true,
      participantReferencesRequested: 2,
      participantDocumentsFound: 2,
      closedMatchReferencesRequested: 1,
      closedMatchDocumentsFound: 1,
      classification,
      protector,
    });
  };
  const absent = manifestForReasons(undefined, undefined);
  const legacyAsymmetric = manifestForReasons(undefined, 'state:absent');
  const presentSentinelText = manifestForReasons('state:absent', 'state:absent');
  const absentAction = absent.actions[0];
  const legacyAction = legacyAsymmetric.actions[0];
  const presentAction = presentSentinelText.actions[0];

  assert.equal(absentAction.pointerClosedReasonState, 'absent');
  assert.equal(absentAction.historicalClosedReasonState, 'absent');
  assert.equal(legacyAction.pointerClosedReasonState, 'absent');
  assert.equal(legacyAction.historicalClosedReasonState, 'present');
  assert.equal(presentAction.pointerClosedReasonState, 'present');
  assert.equal(presentAction.historicalClosedReasonState, 'present');
  assert.notEqual(
    absentAction.pointerClosedReasonHash,
    presentAction.pointerClosedReasonHash
  );
  assert.notEqual(
    absentAction.pointerClosedReasonHash,
    absentAction.historicalClosedReasonHash
  );
  assert.equal(
    legacyAction.historicalClosedReasonHash,
    presentAction.historicalClosedReasonHash
  );
  assert.equal(JSON.stringify(absent).includes('room_closed'), false);
  assert.equal(JSON.stringify(legacyAsymmetric).includes('state:absent'), false);
  assert.equal(verifyDirectRoomRemediationManifest(absent), true);
  assert.equal(verifyDirectRoomRemediationManifest(legacyAsymmetric), true);
  assert.equal(verifyDirectRoomRemediationManifest(presentSentinelText), true);

  const tamperedState = structuredClone(legacyAsymmetric);
  tamperedState.actions[0].pointerClosedReasonState = 'present';
  assert.equal(verifyDirectRoomRemediationManifest(tamperedState), false);
});

test('incomplete scans never emit remediation actions', () => {
  const classification = classify();
  const manifest = buildDirectRoomRemediationManifest({
    projectId: 'hana-e2ee6',
    createdAt: new Date('2026-08-13T00:00:00.000Z'),
    pageSize: 200,
    maxDocumentsPerCollection: 1,
    scanComplete: false,
    participantReferencesRequested: 2,
    participantDocumentsFound: 1,
    closedMatchReferencesRequested: 0,
    closedMatchDocumentsFound: 0,
    classification,
    protector: createRemediationIdentifierProtector(Buffer.alloc(32, 8)),
  });

  assert.deepEqual(manifest.actions, []);
  assert.equal(verifyDirectRoomRemediationManifest(manifest), true);
});
