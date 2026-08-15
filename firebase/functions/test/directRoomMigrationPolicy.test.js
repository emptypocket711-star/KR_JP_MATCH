const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MAX_PARTICIPANT_ROOM_DOCUMENTS_PER_APPLY,
  PARTICIPANT_ROOM_QUERY_LIMIT,
  classifyDirectRoomMigration,
  normalizeDirectRoomParticipants,
  participantRoomScanIsComplete,
} = require('../lib/directRoomMigrationPolicy');
const {
  buildDirectRoomManifest,
  createIdentifierProtector,
  verifyDirectRoomManifest,
} = require('../lib/directRoomMigrationManifest');

function room(overrides = {}) {
  return {
    id: 'room_1',
    userIds: ['bob', 'alice'],
    pairKey: 'alice_bob',
    hiddenFor: [],
    ...overrides,
  };
}

function pointer(overrides = {}) {
  return {
    id: 'alice_bob',
    userIds: ['alice', 'bob'],
    pairKey: 'alice_bob',
    activeMatchId: 'room_1',
    ...overrides,
  };
}

function closedPointer(overrides = {}) {
  return {
    id: 'alice_bob',
    userIds: ['alice', 'bob'],
    pairKey: 'alice_bob',
    closedMatchId: 'room_closed',
    closedReason: 'left_chat',
    ...overrides,
  };
}

function closedRoom(overrides = {}) {
  return {
    id: 'room_closed',
    userIds: ['bob', 'alice'],
    pairKey: 'alice_bob',
    isActive: false,
    closedReason: 'left_chat',
    ...overrides,
  };
}

test('normalizes only two unique non-empty direct-room participants', () => {
  assert.deepEqual(normalizeDirectRoomParticipants(['bob', 'alice']), {
    userIds: ['alice', 'bob'],
    participantKey: '["alice","bob"]',
    pairKey: 'alice_bob',
  });
  assert.equal(normalizeDirectRoomParticipants(['alice', 'alice']), null);
  assert.equal(normalizeDirectRoomParticipants(['alice']), null);
  assert.equal(normalizeDirectRoomParticipants(['alice', 'bob', 'carol']), null);
  assert.equal(normalizeDirectRoomParticipants(['alice', ' ']), null);
  assert.equal(normalizeDirectRoomParticipants('alice,bob'), null);
});

test('uses one sentinel document to fail closed above the apply scan bound', () => {
  assert.equal(
    PARTICIPANT_ROOM_QUERY_LIMIT,
    MAX_PARTICIPANT_ROOM_DOCUMENTS_PER_APPLY + 1
  );
  assert.equal(participantRoomScanIsComplete(199), true);
  assert.equal(participantRoomScanIsComplete(200), true);
  assert.equal(participantRoomScanIsComplete(201), false);
  assert.equal(participantRoomScanIsComplete(-1), false);
});

test('selects one exact active room with a consistent exact pointer', () => {
  const result = classifyDirectRoomMigration([room()], [pointer()]);

  assert.deepEqual(result.candidates, [
    {
      matchId: 'room_1',
      pairKey: 'alice_bob',
      participantKey: '["alice","bob"]',
      pointerId: 'alice_bob',
    },
  ]);
  assert.equal(result.healthy.length, 0);
  assert.equal(result.findings.length, 0);
});

test('treats a validated version-one room as healthy and idempotent', () => {
  const result = classifyDirectRoomMigration(
    [room({ directRoomVersion: 1 })],
    [pointer()]
  );

  assert.equal(result.candidates.length, 0);
  assert.equal(result.healthy.length, 1);
  assert.equal(result.healthy[0].directRoomVersion, 1);
  assert.equal(result.findings.length, 0);
});

test('never audits or backfills a room with missing, malformed, or non-empty hiddenFor', () => {
  for (const hiddenFor of [undefined, 'alice', ['alice'], ['bob'], [7]]) {
    const result = classifyDirectRoomMigration(
      [room({ hiddenFor })],
      [pointer()]
    );
    assert.equal(result.candidates.length, 0);
    assert.equal(result.healthy.length, 0);
    assert.ok(result.findings.some(
      (finding) => finding.code === 'active-match-hidden-state-invalid'
    ));
  }
});

test('backfills a missing canonical pairKey even when the V1 marker exists', () => {
  const result = classifyDirectRoomMigration(
    [room({ directRoomVersion: 1, pairKey: undefined })],
    [pointer()]
  );

  assert.equal(result.candidates.length, 1);
  assert.equal(result.healthy.length, 0);
  assert.equal(result.findings.length, 0);
});

test('allows an absent legacy match pairKey but rejects a conflicting one', () => {
  const legacy = classifyDirectRoomMigration(
    [room({ pairKey: undefined })],
    [pointer()]
  );
  const conflict = classifyDirectRoomMigration(
    [room({ pairKey: 'wrong_pair' })],
    [pointer()]
  );

  assert.equal(legacy.candidates.length, 1);
  assert.equal(conflict.candidates.length, 0);
  assert.ok(
    conflict.findings.some(
      (finding) => finding.code === 'match-pair-key-mismatch'
    )
  );
});

test('never selects malformed active rooms', () => {
  const result = classifyDirectRoomMigration(
    [
      room({ id: 'same_user', userIds: ['alice', 'alice'] }),
      room({ id: 'three_users', userIds: ['alice', 'bob', 'carol'] }),
      room({ id: 'not_array', userIds: 'alice,bob' }),
    ],
    [pointer()]
  );

  assert.equal(result.candidates.length, 0);
  assert.equal(result.counts.malformedActiveMatches, 3);
  assert.ok(
    result.findings.every(
      (finding) => finding.code !== 'duplicate-active-pair'
    )
  );
});

test('never marks either room when an exact participant pair has duplicates', () => {
  const result = classifyDirectRoomMigration(
    [room(), room({ id: 'room_2' })],
    [pointer()]
  );

  assert.equal(result.candidates.length, 0);
  assert.ok(
    result.findings.some(
      (finding) => finding.code === 'duplicate-active-pair'
    )
  );
});

test('detects underscore-normalized pair key collisions without selecting rooms', () => {
  const result = classifyDirectRoomMigration(
    [
      room({
        id: 'collision_1',
        userIds: ['a_b', 'c'],
        pairKey: 'a_b_c',
      }),
      room({
        id: 'collision_2',
        userIds: ['a', 'b_c'],
        pairKey: 'a_b_c',
      }),
    ],
    [
      {
        id: 'a_b_c',
        userIds: ['a_b', 'c'],
        pairKey: 'a_b_c',
        activeMatchId: 'collision_1',
      },
    ]
  );

  assert.equal(result.candidates.length, 0);
  assert.ok(
    result.findings.some(
      (finding) => finding.code === 'normalized-pair-key-collision'
    )
  );
});

test('requires the chatPairs identity fields and pointer to match exactly', () => {
  for (const changedPointer of [
    undefined,
    pointer({ userIds: ['alice', 'carol'] }),
    pointer({ pairKey: 'wrong_pair' }),
    pointer({ activeMatchId: 'other_room' }),
  ]) {
    const result = classifyDirectRoomMigration(
      [room()],
      changedPointer === undefined ? [] : [changedPointer]
    );
    assert.equal(result.candidates.length, 0);
    assert.ok(result.findings.length > 0);
  }
});

test('rejects active pointers carrying stale closed-room metadata', () => {
  for (const changedPointer of [
    pointer({ closedMatchId: 'old_room' }),
    pointer({ closedReason: 'left_chat' }),
  ]) {
    const result = classifyDirectRoomMigration([room()], [changedPointer]);
    assert.equal(result.candidates.length, 0);
    assert.ok(result.findings.length > 0);
  }
});

test('requires exactly one chatPairs record for the participant tuple and room', () => {
  const duplicateTuple = classifyDirectRoomMigration(
    [room()],
    [pointer(), pointer({ id: 'unexpected_pointer' })]
  );
  const duplicateRoomPointer = classifyDirectRoomMigration(
    [room()],
    [
      pointer(),
      {
        id: 'carol_dana',
        userIds: ['carol', 'dana'],
        pairKey: 'carol_dana',
        activeMatchId: 'room_1',
      },
    ]
  );
  const malformedDuplicateClaim = classifyDirectRoomMigration(
    [room()],
    [
      pointer(),
      {
        id: 'malformed_duplicate',
        userIds: 'alice,bob',
        pairKey: 'alice_bob',
        activeMatchId: 'unrelated_room',
      },
    ]
  );

  assert.equal(duplicateTuple.candidates.length, 0);
  assert.ok(
    duplicateTuple.findings.some(
      (finding) => finding.code === 'duplicate-chat-pair'
    )
  );
  assert.equal(duplicateRoomPointer.candidates.length, 0);
  assert.ok(
    duplicateRoomPointer.findings.some(
      (finding) => finding.code === 'multiple-chat-pair-pointers'
    )
  );
  assert.equal(malformedDuplicateClaim.candidates.length, 0);
  assert.ok(
    malformedDuplicateClaim.findings.some(
      (finding) => finding.code === 'duplicate-chat-pair'
    )
  );
});

test('does not overwrite null, zero, string, or future marker values', () => {
  for (const marker of [null, 0, '1', 2]) {
    const result = classifyDirectRoomMigration(
      [room({ directRoomVersion: marker })],
      [pointer()]
    );
    assert.equal(result.candidates.length, 0);
    assert.ok(
      result.findings.some(
        (finding) => finding.code === 'unsupported-direct-room-marker'
      )
    );
  }
});

test('reports orphan pair pointers instead of attempting repair', () => {
  const result = classifyDirectRoomMigration([], [pointer()]);

  assert.equal(result.candidates.length, 0);
  assert.ok(
    result.findings.some((finding) => finding.code === 'orphan-chat-pair')
  );
});

test('classifies a verified closedMatchId pointer as healthy, not orphaned', () => {
  const result = classifyDirectRoomMigration(
    [],
    [closedPointer()],
    [closedRoom()]
  );

  assert.deepEqual(result.healthyClosed, [{
    closedMatchId: 'room_closed',
    pairKey: 'alice_bob',
    participantKey: '["alice","bob"]',
    pointerId: 'alice_bob',
  }]);
  assert.equal(result.findings.length, 0);
  assert.equal(result.counts.closedMatchReferencesRequested, 1);
  assert.equal(result.counts.closedMatchDocumentsFound, 1);
  assert.equal(result.counts.healthyClosedPointers, 1);
});

test('keeps empty, malformed, and both-pointer states as findings', () => {
  const neither = classifyDirectRoomMigration(
    [],
    [closedPointer({ closedMatchId: undefined, closedReason: undefined })]
  );
  const empty = classifyDirectRoomMigration(
    [],
    [closedPointer({ closedMatchId: '' })]
  );
  const both = classifyDirectRoomMigration(
    [room()],
    [closedPointer({ activeMatchId: 'room_1' })],
    [closedRoom()]
  );

  assert.ok(neither.findings.some(
    (finding) => finding.code === 'chat-pair-neither-active-nor-closed'
  ));
  assert.ok(empty.findings.some(
    (finding) => finding.code === 'malformed-chat-pair'
  ));
  assert.ok(both.findings.some(
    (finding) => finding.code === 'chat-pair-both-active-and-closed'
  ));
  assert.equal(neither.healthyClosed.length, 0);
  assert.equal(empty.healthyClosed.length, 0);
  assert.equal(both.healthyClosed.length, 0);
});

test('fails closed for missing, active, pair-mismatched, or reason-mismatched closed rooms', () => {
  const cases = [
    {
      closedMatches: [],
      code: 'chat-pair-closed-match-missing',
    },
    {
      closedMatches: [closedRoom({ isActive: true })],
      code: 'chat-pair-closed-match-state-mismatch',
    },
    {
      closedMatches: [closedRoom({ userIds: ['alice', 'carol'] })],
      code: 'chat-pair-closed-match-pair-mismatch',
    },
    {
      closedMatches: [closedRoom({ pairKey: 'wrong_pair' })],
      code: 'chat-pair-closed-match-pair-mismatch',
    },
    {
      closedMatches: [closedRoom({ closedReason: 'blocked' })],
      code: 'chat-pair-closed-reason-mismatch',
    },
  ];

  for (const fixture of cases) {
    const result = classifyDirectRoomMigration(
      [],
      [closedPointer()],
      fixture.closedMatches
    );
    assert.equal(result.healthyClosed.length, 0);
    assert.ok(
      result.findings.some((finding) => finding.code === fixture.code),
      `missing ${fixture.code}`
    );
  }
});

test('a closed pointer is not healthy while the same pair still has an active room', () => {
  const result = classifyDirectRoomMigration(
    [room()],
    [closedPointer()],
    [closedRoom()]
  );

  assert.equal(result.healthyClosed.length, 0);
  assert.ok(result.findings.some(
    (finding) => finding.code === 'chat-pair-closed-match-state-mismatch'
  ));
});

test('manifest HMAC-protects identifiers and rejects tampering', () => {
  const classification = classifyDirectRoomMigration([room()], [pointer()]);
  const protector = createIdentifierProtector(Buffer.alloc(32, 7));
  const manifest = buildDirectRoomManifest({
    projectId: 'hana-e2ee6',
    createdAt: new Date('2026-08-13T00:00:00.000Z'),
    pageSize: 200,
    maxDocumentsPerCollection: 10000,
    scanComplete: true,
    classification,
    protector,
  });
  const serialized = JSON.stringify(manifest);

  assert.equal(verifyDirectRoomManifest(manifest), true);
  assert.equal(manifest.actions.length, 1);
  assert.equal(serialized.includes('alice'), false);
  assert.equal(serialized.includes('bob'), false);
  assert.equal(serialized.includes('room_1'), false);
  assert.equal(manifest.scan.closedMatchReferencesRequested, 0);
  assert.equal(manifest.scan.closedMatchDocumentsFound, 0);

  const tampered = JSON.parse(serialized);
  tampered.counts.candidateBackfills = 99;
  assert.equal(verifyDirectRoomManifest(tampered), false);
});

test('an incomplete scan emits no apply actions', () => {
  const classification = classifyDirectRoomMigration([room()], [pointer()]);
  const manifest = buildDirectRoomManifest({
    projectId: 'hana-e2ee6',
    createdAt: new Date('2026-08-13T00:00:00.000Z'),
    pageSize: 200,
    maxDocumentsPerCollection: 1,
    scanComplete: false,
    classification,
    protector: createIdentifierProtector(Buffer.alloc(32, 8)),
  });

  assert.equal(manifest.scan.complete, false);
  assert.deepEqual(manifest.actions, []);
  assert.equal(verifyDirectRoomManifest(manifest), true);
});
