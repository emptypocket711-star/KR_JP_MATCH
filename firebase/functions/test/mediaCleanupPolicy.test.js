const assert = require('node:assert/strict');
const test = require('node:test');

const {
  canRetireMediaAuthorization,
  decideMediaCleanupClaim,
  mediaCleanupLeaseIssue,
  mediaCleanupMaxAttempts,
  mediaCleanupRetryBaseMillis,
  mediaCleanupRetryDelayMillis,
  mediaCleanupRetryMaxMillis,
  nextPendingGenerationCleanupCount,
  shouldQuarantineMediaCleanup,
} = require('../lib/mediaCleanupPolicy');

test('claims due pending work and stale leases without stealing an active lease', () => {
  const now = 1_000_000;
  assert.deepEqual(decideMediaCleanupClaim({ status: 'pending' }, now), {
    claim: true,
    quarantine: false,
    nextAttempt: 1,
  });
  assert.equal(decideMediaCleanupClaim({
    status: 'pending',
    attempts: 2,
    nextAttemptAtMillis: now + 1,
  }, now).claim, false);
  assert.equal(decideMediaCleanupClaim({
    status: 'processing',
    attempts: 2,
    leaseOwner: 'worker-a',
    leaseUntilMillis: now + 1,
    nextAttemptAtMillis: now + 1,
  }, now).claim, false);
  assert.deepEqual(decideMediaCleanupClaim({
    status: 'processing',
    attempts: 2,
    leaseOwner: 'worker-a',
    leaseUntilMillis: now,
    nextAttemptAtMillis: now,
  }, now), {
    claim: true,
    quarantine: false,
    nextAttempt: 3,
  });
});

test('fences cleanup completion to the exact unexpired lease owner', () => {
  const state = {
    status: 'processing',
    leaseOwner: 'worker-a',
    leaseUntilMillis: 2_000,
  };
  assert.equal(mediaCleanupLeaseIssue(state, {
    leaseOwner: 'worker-a',
    nowMillis: 1_000,
  }), null);
  assert.equal(mediaCleanupLeaseIssue(state, {
    leaseOwner: 'worker-b',
    nowMillis: 1_000,
  }), 'wrong-owner');
  assert.equal(mediaCleanupLeaseIssue(state, {
    leaseOwner: 'worker-a',
    nowMillis: 2_000,
  }), 'expired');
});

test('backs poison work off and eventually quarantines it without deleting it', () => {
  assert.equal(mediaCleanupRetryDelayMillis(1), mediaCleanupRetryBaseMillis);
  assert.equal(
    mediaCleanupRetryDelayMillis(mediaCleanupMaxAttempts),
    mediaCleanupRetryMaxMillis,
  );
  assert.equal(shouldQuarantineMediaCleanup(mediaCleanupMaxAttempts - 1), false);
  assert.equal(shouldQuarantineMediaCleanup(mediaCleanupMaxAttempts), true);
  assert.deepEqual(decideMediaCleanupClaim({
    status: 'pending',
    attempts: mediaCleanupMaxAttempts,
  }, 1_000), {
    claim: false,
    quarantine: true,
    nextAttempt: mediaCleanupMaxAttempts,
  });
});

test('keeps consumed publication proof and any cleanup-dependent ledger', () => {
  assert.equal(canRetireMediaAuthorization({
    status: 'consumed',
    pendingGenerationCleanupCount: 0,
    hasGenerationCleanupDependency: false,
  }), false);
  assert.equal(canRetireMediaAuthorization({
    status: 'rejected',
    pendingGenerationCleanupCount: 1,
    hasGenerationCleanupDependency: false,
  }), false);
  assert.equal(canRetireMediaAuthorization({
    status: 'rejected',
    pendingGenerationCleanupCount: 0,
    hasGenerationCleanupDependency: true,
  }), false);
  assert.equal(canRetireMediaAuthorization({
    status: 'rejected',
    pendingGenerationCleanupCount: 0,
    hasGenerationCleanupDependency: false,
  }), true);
});

test('maintains a strict non-negative generation-cleanup dependency count', () => {
  assert.equal(nextPendingGenerationCleanupCount(undefined, 1), 1);
  assert.equal(nextPendingGenerationCleanupCount(1, -1), 0);
  assert.equal(nextPendingGenerationCleanupCount(0, -1), null);
  assert.equal(nextPendingGenerationCleanupCount(-1, 1), null);
  assert.equal(nextPendingGenerationCleanupCount('1', 1), null);
});
