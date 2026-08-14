const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildStaleProfileMediaManifest,
  staleProfileMediaActionKey,
  staleProfileMediaManifestDigest,
  unsignedStaleProfileMediaManifest,
  verifyStaleProfileMediaManifest,
} = require('../lib/staleProfileMediaReferenceManifest');

function scanCounts(overrides = {}) {
  return {
    users: 3,
    posts: 2,
    comments: 1,
    replies: 1,
    blocks: 1,
    matches: 2,
    referencedOwners: 3,
    missingOwnersCheckedInAuth: 1,
    missingOwnersConfirmed: 1,
    authRecordsFoundWithoutUser: 0,
    deferredFirstPartyReferences: 0,
    ...overrides,
  };
}

function clearAction(overrides = {}) {
  return {
    actionType: 'clear-reference',
    referenceKind: 'match-partnerFor-photoUrl',
    documentPath: 'matches/room-1',
    fieldPath: 'partnerFor.alice.photoUrl',
    ownerUid: 'bob',
    expectedValue: 'https://legacy.example.com/bob.jpg',
    ownerExpectation: {
      kind: 'existing-no-current-photo',
      photoUrlsState: 'empty-array',
    },
    ...overrides,
  };
}

function deleteAction(overrides = {}) {
  return {
    actionType: 'delete-orphan-post-tree',
    documentPath: 'posts/orphan-1',
    ownerUid: 'missing-user',
    expectedAuthorPhotoUrl: 'https://legacy.example.com/orphan.jpg?version=1',
    ownerExpectation: { kind: 'missing-user-and-auth' },
    ...overrides,
  };
}

function manifest(overrides = {}) {
  return buildStaleProfileMediaManifest({
    projectId: 'hana-e2ee6',
    bucket: 'hana-e2ee6.firebasestorage.app',
    createdAt: new Date('2026-08-13T00:00:00.000Z'),
    pageSize: 200,
    maxDocumentsPerSource: 20000,
    scanComplete: true,
    scanCounts: scanCounts(),
    findings: [],
    actions: [clearAction(), deleteAction()],
    ...overrides,
  });
}

function redigest(value) {
  value.digest = staleProfileMediaManifestDigest(
    unsignedStaleProfileMediaManifest(value)
  );
  return value;
}

test('builds a deterministic, sorted and strictly verified manifest', () => {
  const value = manifest();
  assert.equal(verifyStaleProfileMediaManifest(value), true);
  assert.equal(value.counts.actions, 2);
  assert.equal(value.counts.clearReferences, 1);
  assert.equal(value.counts.deleteOrphanPostTrees, 1);
  assert.deepEqual(
    value.actions.map(staleProfileMediaActionKey),
    [...value.actions.map(staleProfileMediaActionKey)].sort()
  );
  assert.match(value.digest, /^[a-f0-9]{64}$/);
});

test('incomplete scans never carry applyable actions', () => {
  const value = manifest({
    scanComplete: false,
    findings: [{ code: 'scan-incomplete', location: 'scan' }],
  });
  assert.equal(value.actions.length, 0);
  assert.equal(value.counts.actions, 0);
  assert.equal(verifyStaleProfileMediaManifest(value), true);
});

test('rejects injected fields, digest drift and count drift', () => {
  const injected = structuredClone(manifest());
  injected.actions[0].arbitraryPath = 'users/victim';
  redigest(injected);
  assert.equal(verifyStaleProfileMediaManifest(injected), false);

  const drifted = structuredClone(manifest());
  drifted.actions[0].expectedValue = 'changed';
  assert.equal(verifyStaleProfileMediaManifest(drifted), false);

  const wrongCount = structuredClone(manifest());
  wrongCount.counts.actions = 99;
  redigest(wrongCount);
  assert.equal(verifyStaleProfileMediaManifest(wrongCount), false);

  const wrongBucket = structuredClone(manifest());
  wrongBucket.bucket = 'attacker.firebasestorage.app';
  redigest(wrongBucket);
  assert.equal(verifyStaleProfileMediaManifest(wrongBucket), false);
});

test('rejects path, field, owner, and external URL scope confusion', () => {
  for (const action of [
    clearAction({ documentPath: 'users/victim' }),
    clearAction({ fieldPath: 'partnerFor.alice.displayName' }),
    clearAction({ ownerUid: '../victim' }),
    deleteAction({ documentPath: 'reports/evidence-1' }),
    deleteAction({
      expectedAuthorPhotoUrl:
        'https://firebasestorage.googleapis.com/v0/b/hana-e2ee6.firebasestorage.app/o/users%2Fmissing-user%2Fphoto.jpg?alt=media&token=secret',
    }),
  ]) {
    const value = manifest({ actions: [action] });
    assert.equal(verifyStaleProfileMediaManifest(value), false);
  }
});

test('rejects duplicate actions even when the digest is recomputed', () => {
  const action = clearAction();
  const value = manifest({ actions: [action, structuredClone(action)] });
  assert.equal(verifyStaleProfileMediaManifest(value), false);
});

test('rejects conflicting rewrites and rewrites inside an approved delete tree', () => {
  const first = clearAction();
  const conflicting = clearAction({
    expectedValue: 'https://legacy.example.com/changed.jpg',
  });
  assert.equal(
    verifyStaleProfileMediaManifest(manifest({ actions: [first, conflicting] })),
    false
  );

  const child = clearAction({
    referenceKind: 'comment-author',
    documentPath: 'posts/orphan-1/comments/comment-1',
    fieldPath: 'authorPhotoUrl',
    ownerUid: 'missing-user',
    ownerExpectation: { kind: 'missing-user-and-auth' },
  });
  assert.equal(
    verifyStaleProfileMediaManifest(manifest({
      actions: [deleteAction(), child],
    })),
    false
  );
});

test('manifest digest is stable across object key insertion order', () => {
  const left = { b: 2, a: { d: 4, c: 3 } };
  const right = { a: { c: 3, d: 4 }, b: 2 };
  assert.equal(
    staleProfileMediaManifestDigest(left),
    staleProfileMediaManifestDigest(right)
  );
});
