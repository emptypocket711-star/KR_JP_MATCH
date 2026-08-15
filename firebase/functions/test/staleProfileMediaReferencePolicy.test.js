const assert = require('node:assert/strict');
const test = require('node:test');

const {
  classifyOwnerPhotoState,
  exactStringArray,
  firstPartyFirebaseObjectPathFromUrl,
  isExternalNonFirstPartyHttpsPhotoUrl,
  isSafeDocumentPathForReference,
  isSafeFieldPathForReference,
  isSafeUid,
  nestedValue,
  referenceOwnerUid,
} = require('../lib/staleProfileMediaReferencePolicy');

const allowedBuckets = new Set([
  'hana-e2ee6.firebasestorage.app',
  'hana-production-tokyo.firebasestorage.app',
]);
const aliceCanonical = 'profile_media/alice/auth-1/image.jpg';
const aliceCanonical2 = 'profile_media/alice/auth-2/image.jpg';
const legacyAlice =
  'https://legacy.example.com/users/alice/photo.jpg?version=1';

test('classifies missing and canonical-only current photo lists', () => {
  assert.deepEqual(classifyOwnerPhotoState(undefined, 'alice'), {
    kind: 'none',
    exactPhotoUrls: [],
  });
  assert.deepEqual(classifyOwnerPhotoState([], 'alice'), {
    kind: 'none',
    exactPhotoUrls: [],
  });
  assert.deepEqual(
    classifyOwnerPhotoState([aliceCanonical, aliceCanonical2], 'alice'),
    {
      kind: 'canonical',
      exactPhotoUrls: [aliceCanonical, aliceCanonical2],
      canonicalPaths: [aliceCanonical, aliceCanonical2],
    }
  );
});

test('keeps a sole current legacy photo as a blocking trusted-reupload finding', () => {
  const state = classifyOwnerPhotoState([legacyAlice], 'alice');
  assert.deepEqual(state, {
    kind: 'blocking-legacy-trusted-reupload',
    exactPhotoUrls: [legacyAlice],
    legacyValue: legacyAlice,
  });
  assert.equal(Object.hasOwn(state, 'clear'), false);
  assert.equal(Object.hasOwn(state, 'replacement'), false);
});

test('fails closed on malformed, mixed, multiple legacy, and wrong-owner lists', () => {
  const cases = [
    {
      value: 'not-an-array',
      reason: 'photoUrls-not-an-array',
    },
    {
      value: [''],
      reason: 'malformed-photo-value',
    },
    {
      value: [aliceCanonical, legacyAlice],
      reason: 'mixed-canonical-and-legacy',
    },
    {
      value: [legacyAlice, 'https://legacy.example.com/alice/second.jpg'],
      reason: 'multiple-noncanonical-values',
    },
    {
      value: ['profile_media/bob/auth-1/image.jpg'],
      reason: 'wrong-owner-canonical-path',
    },
    {
      value: [aliceCanonical, aliceCanonical],
      reason: 'duplicate-canonical-path',
    },
    {
      value: Array.from(
        { length: 7 },
        (_, index) => `profile_media/alice/auth-${index}/image.jpg`
      ),
      reason: 'too-many-photo-values',
    },
    {
      value: ['profile_media/alice/../image.jpg'],
      reason: 'invalid-canonical-looking-path',
    },
  ];
  for (const { value, reason } of cases) {
    const state = classifyOwnerPhotoState(value, 'alice');
    assert.equal(state.kind, 'blocking-invalid');
    assert.equal(state.reason, reason);
  }
  assert.equal(
    classifyOwnerPhotoState([aliceCanonical], '../alice').reason,
    'unsafe-owner-uid'
  );
});

test('accepts only conservative UIDs and exact collection paths', () => {
  for (const uid of ['alice', 'firebase_UID-123', 'A_1-b']) {
    assert.equal(isSafeUid(uid), true, uid);
  }
  for (const uid of [
    '', '.', '..', 'alice/bob', 'alice.bob', '__name__',
    'alice%2Fbob', 'alice\u0000bob', 'a'.repeat(129),
  ]) {
    assert.equal(isSafeUid(uid), false, JSON.stringify(uid));
  }

  const valid = [
    ['post-author', 'posts/post-1'],
    ['comment-author', 'posts/post-1/comments/comment_1'],
    ['reply-author', 'posts/post-1/comments/comment_1/replies/reply-1'],
    ['block-target', 'users/alice/blocks/bob'],
    ['match-photoUrl', 'matches/room-1'],
    ['match-myPhotoUrl', 'matches/room-1'],
    ['match-partnerFor-photoUrl', 'matches/room-1'],
  ];
  for (const [kind, path] of valid) {
    assert.equal(isSafeDocumentPathForReference(kind, path), true, path);
  }

  const invalid = [
    ['post-author', '/posts/post-1'],
    ['post-author', 'posts/post-1/comments/comment-1'],
    ['comment-author', 'posts/post-1/replies/comment-1'],
    ['reply-author', 'posts/p/comments/c/replies/r/extra/x'],
    ['block-target', 'users/alice/blocks/bob/notes/n'],
    ['match-photoUrl', 'matches/room%2Fescaped'],
    ['match-photoUrl', 'matches/../users'],
    ['match-photoUrl', 'matches/room\\nested'],
  ];
  for (const [kind, path] of invalid) {
    assert.equal(isSafeDocumentPathForReference(kind, path), false, path);
  }
});

test('field paths are exact and reject forged partner viewers', () => {
  assert.equal(
    isSafeFieldPathForReference('post-author', 'authorPhotoUrl'),
    true
  );
  assert.equal(
    isSafeFieldPathForReference('post-author', 'nested.authorPhotoUrl'),
    false
  );
  assert.equal(
    isSafeFieldPathForReference(
      'match-partnerFor-photoUrl',
      'partnerFor.alice.photoUrl'
    ),
    true
  );
  for (const path of [
    'partnerFor.alice.profile.photoUrl',
    'partnerFor.alice.bob.photoUrl',
    'partnerFor.alice%2Eevil.photoUrl',
    'partnerFor.__proto__.photoUrl',
    'photoUrl',
  ]) {
    assert.equal(
      isSafeFieldPathForReference('match-partnerFor-photoUrl', path),
      false,
      path
    );
  }
});

test('resolves post, comment, reply, and exact block snapshot owners', () => {
  assert.equal(
    referenceOwnerUid(
      'post-author', 'posts/post-1', 'authorPhotoUrl', { uid: 'alice' }
    ),
    'alice'
  );
  assert.equal(
    referenceOwnerUid(
      'comment-author',
      'posts/post-1/comments/comment-1',
      'authorPhotoUrl',
      { uid: 'alice' }
    ),
    'alice'
  );
  assert.equal(
    referenceOwnerUid(
      'reply-author',
      'posts/post-1/comments/comment-1/replies/reply-1',
      'authorPhotoUrl',
      { uid: 'alice' }
    ),
    'alice'
  );
  assert.equal(
    referenceOwnerUid(
      'block-target', 'users/alice/blocks/bob', 'photoUrl',
      { targetUid: 'bob' }
    ),
    'bob'
  );
  assert.equal(
    referenceOwnerUid(
      'block-target', 'users/alice/blocks/bob', 'photoUrl',
      { targetUid: 'mallory' }
    ),
    null
  );
  assert.equal(
    referenceOwnerUid(
      'post-author', 'posts/post-1', 'photoUrl', { uid: 'alice' }
    ),
    null
  );
});

test('uses exact positional legacy match semantics and partner inversion', () => {
  const data = { userIds: ['alice', 'bob'] };
  assert.equal(
    referenceOwnerUid(
      'match-myPhotoUrl', 'matches/room-1', 'myPhotoUrl', data
    ),
    'alice'
  );
  assert.equal(
    referenceOwnerUid(
      'match-photoUrl', 'matches/room-1', 'photoUrl', data
    ),
    'bob'
  );
  assert.equal(
    referenceOwnerUid(
      'match-partnerFor-photoUrl', 'matches/room-1',
      'partnerFor.alice.photoUrl', data
    ),
    'bob'
  );
  assert.equal(
    referenceOwnerUid(
      'match-partnerFor-photoUrl', 'matches/room-1',
      'partnerFor.bob.photoUrl', data
    ),
    'alice'
  );
});

test('rejects duplicate/extra participants, wrong types, and forged viewers', () => {
  const cases = [
    [{ userIds: ['alice', 'alice'] }, 'partnerFor.alice.photoUrl'],
    [{ userIds: ['alice', 'bob', 'mallory'] }, 'partnerFor.alice.photoUrl'],
    [{ userIds: ['alice', 7] }, 'partnerFor.alice.photoUrl'],
    [{ userIds: ['alice', 'bob'] }, 'partnerFor.mallory.photoUrl'],
    [{ userIds: ['alice', 'bob'] }, 'partnerFor.alice.bob.photoUrl'],
  ];
  for (const [data, fieldPath] of cases) {
    assert.equal(
      referenceOwnerUid(
        'match-partnerFor-photoUrl', 'matches/room-1', fieldPath, data
      ),
      null
    );
  }
});

test('classifies only strict non-first-party HTTPS URLs as external', () => {
  for (const value of [
    'https://cdn.example.com/photos/alice.jpg',
    'https://media.attacker.example/a.jpg?version=1',
    'https://firebasestorage.googleapis.com/v0/b/attacker-bucket.app/o/users%2Falice%2Fphoto.jpg?alt=media',
    'https://storage.googleapis.com/attacker-bucket.app/photos/alice.jpg',
  ]) {
    assert.equal(
      isExternalNonFirstPartyHttpsPhotoUrl(value, allowedBuckets),
      true,
      value
    );
  }

  for (const value of [
    'https://firebasestorage.googleapis.com/v0/b/hana-e2ee6.firebasestorage.app/o/profile_media%2Falice%2Fauth-1%2Fimage.jpg?alt=media',
    'https://storage.googleapis.com/hana-production-tokyo.firebasestorage.app/profile_media/alice/auth-1/image.jpg',
    'https://hana-e2ee6.firebasestorage.app/profile_media/alice/image.jpg',
    'https://hana-e2ee6.firebasestorage.app.storage.googleapis.com/users/alice/photo.jpg',
    'https://storage.cloud.google.com/hana-e2ee6.firebasestorage.app/users/alice/photo.jpg',
    'https://firebasestorage.googleapis.com/download/storage/v1/b/hana-e2ee6.firebasestorage.app/o/users%2Falice%2Fphoto.jpg',
    'http://cdn.example.com/photos/alice.jpg',
    'https://user:pass@cdn.example.com/photos/alice.jpg',
    'https://cdn.example.com:8443/photos/alice.jpg',
    'https://cdn.example.com/photos/alice.jpg#fragment',
    'https://localhost/photos/alice.jpg',
    'https://127.0.0.1/photos/alice.jpg',
    'https://cdn.example.com/%2e%2e/secret.jpg',
    'https://cdn.example.com/photos%2Falice.jpg',
    'https://firebasestorage.googleapis.com/not-a-download-url',
    'javascript:alert(1)',
  ]) {
    assert.equal(
      isExternalNonFirstPartyHttpsPhotoUrl(value, allowedBuckets),
      false,
      value
    );
  }
});

test('extracts only exact allowlisted Firebase download object paths', () => {
  const exact =
    'https://firebasestorage.googleapis.com/v0/b/hana-e2ee6.firebasestorage.app/o/users%2Falice%2Flegacy.jpg?alt=media&token=secret';
  assert.equal(
    firstPartyFirebaseObjectPathFromUrl(exact, allowedBuckets),
    'users/alice/legacy.jpg'
  );
  for (const value of [
    exact.replace('hana-e2ee6', 'attacker-project'),
    exact.replace('?alt=media', '?alt=media&redirect=evil'),
    exact.replace('users%2Falice', '..%2Falice'),
    exact.replace('https://', 'http://'),
    exact.replace('firebasestorage.googleapis.com', 'firebasestorage.googleapis.com.evil.test'),
  ]) {
    assert.equal(
      firstPartyFirebaseObjectPathFromUrl(value, allowedBuckets),
      null,
      value
    );
  }
});

test('fails closed on malformed bucket allowlists and hostname/path confusion', () => {
  assert.equal(
    isExternalNonFirstPartyHttpsPhotoUrl(
      'https://cdn.example.com/photos/alice.jpg',
      new Set()
    ),
    false
  );
  assert.equal(
    isExternalNonFirstPartyHttpsPhotoUrl(
      'https://cdn.example.com/photos/alice.jpg',
      ['HANA-E2EE6.firebasestorage.app']
    ),
    false
  );
  assert.equal(
    isExternalNonFirstPartyHttpsPhotoUrl(
      'https://firebasestorage.googleapis.com.evil.example/v0/b/hana-e2ee6.firebasestorage.app/o/a.jpg',
      allowedBuckets
    ),
    true
  );
  assert.equal(
    isExternalNonFirstPartyHttpsPhotoUrl(
      'https://firebasestorage.googleapis.com/v0/b/hana-e2ee6.firebasestorage.app.evil/o/a.jpg',
      allowedBuckets
    ),
    true
  );
});

test('reads exact own nested fields and compares exact ordered snapshots', () => {
  const data = {
    photoUrl: 'legacy',
    partnerFor: { alice: { photoUrl: 'alice-photo' } },
  };
  assert.equal(nestedValue(data, 'photoUrl'), 'legacy');
  assert.equal(
    nestedValue(data, 'partnerFor.alice.photoUrl'),
    'alice-photo'
  );
  assert.equal(nestedValue(data, 'partnerFor.bob.photoUrl'), undefined);
  assert.equal(nestedValue(data, '__proto__.polluted'), undefined);
  assert.equal(nestedValue(Object.create({ photoUrl: 'inherited' }), 'photoUrl'), undefined);

  assert.equal(exactStringArray(['a', 'b'], ['a', 'b']), true);
  assert.equal(exactStringArray(['b', 'a'], ['a', 'b']), false);
  assert.equal(exactStringArray(['a'], ['a', 'b']), false);
  assert.equal(exactStringArray(['a', 2], ['a', '2']), false);
});
