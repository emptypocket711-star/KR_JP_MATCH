const assert = require('node:assert/strict');
const test = require('node:test');

const {
  AccountDeletionOperationError,
  accountDeletionStorageTargets,
  accountDeletionJobLeaseMillis,
  accountDeletionLeaseIssue,
  accountDeletionPhaseForJob,
  accountDeletionRetryDelayMillis,
  accountDeletionRetryStatusForPhase,
  assertAccountDeletionOperationsFulfilled,
  chatPairKeyForDeletedAccount,
  decideAccountDeletionJobClaim,
  displayNameReservationForDeletion,
  hiddenParticipantsForDeletedAccount,
  legacyMatchPhotoScrubForDeletedAccount,
  isVerifiedZeroOwnedDocuments,
  nextAccountDeletionPhase,
  shouldClearDeletedAccountPairPointer,
  shouldWriteAccountDeletionTombstone,
  unverifiedOrNonEmptyStoragePrefixes,
  userOwnedChatStoragePrefix,
  userOwnedStoragePrefixes,
} = require('../lib/accountDeletionPolicy');

test('normalizes display name reservation ids for deletion', () => {
  assert.equal(displayNameReservationForDeletion('alice'), 'alice');
  assert.equal(displayNameReservationForDeletion('  alice  '), 'alice');
  assert.equal(displayNameReservationForDeletion(''), null);
  assert.equal(displayNameReservationForDeletion(null), null);
});

test('clears only the pair pointer for the room being closed', () => {
  assert.equal(shouldClearDeletedAccountPairPointer({
    activeMatchId: 'old-room',
    closingMatchId: 'old-room',
  }), true);
  assert.equal(shouldClearDeletedAccountPairPointer({
    activeMatchId: 'new-room',
    closingMatchId: 'old-room',
  }), false);
});

test('enumerates all uid-owned profile storage prefixes', () => {
  assert.deepEqual(userOwnedStoragePrefixes('alice'), [
    'users/alice/',
    'profile_photos/alice/',
    'profile_media/alice/',
  ]);
  assert.throws(() => userOwnedStoragePrefixes(''), RangeError);
  assert.throws(() => userOwnedStoragePrefixes('a/b'), RangeError);
});

test('enumerates deduplicated chat-image prefixes for active and closed rooms', () => {
  assert.equal(
    userOwnedChatStoragePrefix('room-1', 'alice'),
    'chat_images/room-1/alice/'
  );
  assert.deepEqual(userOwnedStoragePrefixes('alice', [
    'room-1',
    'room-2',
    'room-1',
  ]), [
    'users/alice/',
    'profile_photos/alice/',
    'profile_media/alice/',
    'chat_images/room-1/alice/',
    'chat_images/room-2/alice/',
  ]);
  assert.throws(() => userOwnedChatStoragePrefix('room/other', 'alice'), RangeError);
});

test('includes chat paths found only in owned upload authorizations', () => {
  const targets = accountDeletionStorageTargets({
    uid: 'alice',
    matchIds: ['known-room'],
    authorizationObjectPaths: [
      'profile_media/alice/profile-auth/image.jpg',
      'chat_images/orphaned-room/alice/chat-auth/image.jpg',
      'chat_images/other-room/bob/chat-auth/image.jpg',
      'chat_images/bad/shape.jpg',
      null,
    ],
  });
  assert.deepEqual(targets.prefixes, [
    'users/alice/',
    'profile_photos/alice/',
    'profile_media/alice/',
    'chat_images/known-room/alice/',
    'chat_images/orphaned-room/alice/',
  ]);
  assert.deepEqual(targets.invalidAuthorizationObjectPaths, [
    'chat_images/other-room/bob/chat-auth/image.jpg',
    'chat_images/bad/shape.jpg',
    null,
  ]);
});

test('hides deleted account rooms from all valid participants', () => {
  assert.deepEqual(
    hiddenParticipantsForDeletedAccount(['alice', 'bob', 'alice'], 'alice'),
    ['alice', 'bob']
  );
  assert.deepEqual(hiddenParticipantsForDeletedAccount([], 'alice'), ['alice']);
  assert.deepEqual(hiddenParticipantsForDeletedAccount(undefined, 'alice'), [
    'alice',
  ]);
});

test('derives active chat pair keys only for rooms containing deleted account', () => {
  assert.equal(
    chatPairKeyForDeletedAccount(['bob', 'alice'], 'alice'),
    'alice_bob'
  );
  assert.equal(chatPairKeyForDeletedAccount(['bob', 'carol'], 'alice'), null);
  assert.equal(chatPairKeyForDeletedAccount(['alice'], 'alice'), null);
  assert.equal(chatPairKeyForDeletedAccount('alice,bob', 'alice'), null);
});

test('scrubs positional legacy match photos for the deleted participant', () => {
  assert.deepEqual(
    legacyMatchPhotoScrubForDeletedAccount(['alice', 'bob'], 'alice'),
    { myPhotoUrl: '' }
  );
  assert.deepEqual(
    legacyMatchPhotoScrubForDeletedAccount(['alice', 'bob'], 'bob'),
    { photoUrl: '' }
  );
  assert.deepEqual(
    legacyMatchPhotoScrubForDeletedAccount(['alice', 'alice'], 'alice'),
    { photoUrl: '', myPhotoUrl: '' }
  );
  assert.deepEqual(
    legacyMatchPhotoScrubForDeletedAccount(undefined, 'alice'),
    { photoUrl: '', myPhotoUrl: '' }
  );
});

test('claims stale deletion jobs but fences an active owner lease', () => {
  const now = 1_000_000;
  assert.deepEqual(decideAccountDeletionJobClaim({ status: 'deleting' }, now), {
    claim: true,
    complete: false,
    phase: 'media_revoke',
  });
  assert.equal(
    decideAccountDeletionJobClaim({
      status: 'deleting',
      phase: 'storage_cleanup',
      leaseOwner: 'worker-a',
      leaseUntilMillis: now + accountDeletionJobLeaseMillis,
    }, now).claim,
    false
  );
  const renewedLeaseState = {
    status: 'deleting',
    phase: 'storage_cleanup',
    leaseOwner: 'worker-a',
    leaseUntilMillis: now + accountDeletionJobLeaseMillis * 2,
  };
  assert.equal(
    decideAccountDeletionJobClaim(
      renewedLeaseState,
      now + accountDeletionJobLeaseMillis
    ).claim,
    false
  );
  assert.equal(accountDeletionLeaseIssue(renewedLeaseState, {
    phase: 'storage_cleanup',
    leaseOwner: 'worker-b',
    nowMillis: now + accountDeletionJobLeaseMillis,
  }), 'wrong-owner');
  assert.equal(
    decideAccountDeletionJobClaim({
      status: 'deleting',
      phase: 'storage_cleanup',
      leaseOwner: 'worker-a',
      leaseUntilMillis: now,
    }, now).claim,
    true
  );
  assert.equal(
    decideAccountDeletionJobClaim({
      status: 'deleting',
      nextAttemptAtMillis: now + 1,
    }, now).claim,
    false
  );
});

test('resumes retry and legacy intermediate states from a conservative phase', () => {
  assert.equal(
    accountDeletionPhaseForJob({ status: 'storage_retry_required' }),
    'media_revoke'
  );
  assert.equal(
    accountDeletionPhaseForJob({ status: 'auth_retry_required' }),
    'media_revoke'
  );
  assert.equal(
    accountDeletionPhaseForJob({
      status: 'auth_retry_required',
      phase: 'identity_cleanup',
    }),
    'identity_cleanup'
  );
  assert.equal(
    accountDeletionPhaseForJob({ status: 'storage_deleted' }),
    'media_revoke'
  );
  assert.equal(
    accountDeletionPhaseForJob({ status: 'finalizing' }),
    'media_revoke'
  );
  assert.deepEqual(
    decideAccountDeletionJobClaim({ status: 'complete' }, 1_000),
    { claim: false, complete: true, phase: 'complete' }
  );
});

test('requires the exact live lease owner and phase before phase mutation', () => {
  const state = {
    status: 'deleting',
    phase: 'storage_cleanup',
    leaseOwner: 'worker-a',
    leaseUntilMillis: 2_000,
  };
  assert.equal(accountDeletionLeaseIssue(state, {
    phase: 'storage_cleanup',
    leaseOwner: 'worker-a',
    nowMillis: 1_000,
  }), null);
  assert.equal(accountDeletionLeaseIssue(state, {
    phase: 'storage_cleanup',
    leaseOwner: 'worker-b',
    nowMillis: 1_000,
  }), 'wrong-owner');
  assert.equal(accountDeletionLeaseIssue(state, {
    phase: 'auth_cleanup',
    leaseOwner: 'worker-a',
    nowMillis: 1_000,
  }), 'wrong-phase');
  assert.equal(accountDeletionLeaseIssue(state, {
    phase: 'storage_cleanup',
    leaseOwner: 'worker-a',
    nowMillis: 2_000,
  }), 'expired');
});

test('advances phases in order and maps failures to retryable job states', () => {
  assert.equal(nextAccountDeletionPhase('media_revoke'), 'firestore_cleanup');
  assert.equal(nextAccountDeletionPhase('firestore_cleanup'), 'storage_cleanup');
  assert.equal(nextAccountDeletionPhase('storage_cleanup'), 'identity_cleanup');
  assert.equal(nextAccountDeletionPhase('identity_cleanup'), 'auth_cleanup');
  assert.equal(nextAccountDeletionPhase('auth_cleanup'), 'complete');
  assert.equal(
    accountDeletionRetryStatusForPhase('storage_cleanup'),
    'storage_retry_required'
  );
  assert.equal(
    accountDeletionRetryStatusForPhase('auth_cleanup'),
    'auth_retry_required'
  );
  assert.equal(accountDeletionRetryStatusForPhase('firestore_cleanup'), 'deleting');
  assert.equal(accountDeletionRetryDelayMillis(1), 5 * 60 * 1000);
  assert.equal(accountDeletionRetryDelayMillis(100), 6 * 60 * 60 * 1000);
});

test('propagates every rejected allSettled deletion operation', () => {
  assert.doesNotThrow(() => assertAccountDeletionOperationsFulfilled(
    'post_tree',
    [{ status: 'fulfilled', value: undefined }]
  ));
  const firstFailure = new Error('post delete failed');
  assert.throws(
    () => assertAccountDeletionOperationsFulfilled('post_tree', [
      { status: 'fulfilled', value: undefined },
      { status: 'rejected', reason: firstFailure },
      { status: 'rejected', reason: 'like root delete failed' },
    ]),
    (error) =>
      error instanceof AccountDeletionOperationError &&
      error.stage === 'post_tree' &&
      error.reasons.length === 2 &&
      error.reasons[0] === firstFailure
  );
});

test('requires an exact zero verification for every owned Storage prefix', () => {
  const prefixes = userOwnedStoragePrefixes('alice');
  assert.deepEqual(unverifiedOrNonEmptyStoragePrefixes(prefixes, {
    'users/alice/': 0,
    'profile_photos/alice/': 0,
    'profile_media/alice/': 0,
  }), []);
  assert.deepEqual(unverifiedOrNonEmptyStoragePrefixes(prefixes, {
    'users/alice/': 0,
    'profile_photos/alice/': 1,
  }), ['profile_photos/alice/', 'profile_media/alice/']);
  assert.equal(isVerifiedZeroOwnedDocuments(0), true);
  assert.equal(isVerifiedZeroOwnedDocuments(1), false);
  assert.equal(isVerifiedZeroOwnedDocuments(undefined), false);
});

test('never recreates a missing user shell once deletion is requested', () => {
  assert.equal(shouldWriteAccountDeletionTombstone({
    userExists: false,
    resumablePhase: 'identity_cleanup',
  }), false);
  assert.equal(shouldWriteAccountDeletionTombstone({
    userExists: false,
    resumablePhase: 'auth_cleanup',
  }), false);
  assert.equal(shouldWriteAccountDeletionTombstone({
    userExists: true,
    resumablePhase: 'auth_cleanup',
  }), true);
  assert.equal(shouldWriteAccountDeletionTombstone({
    userExists: false,
    resumablePhase: null,
  }), false);
});
