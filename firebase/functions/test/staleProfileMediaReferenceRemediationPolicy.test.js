const assert = require('node:assert/strict');
const test = require('node:test');

const {
  classifyStaleMediaAuditRecords,
} = require('../lib/admin/staleProfileMediaReferenceRemediation');

function doc(path, data) {
  return { path, id: path.split('/').at(-1), data };
}

function records(overrides = {}) {
  return {
    users: [],
    posts: [],
    comments: [],
    replies: [],
    blocks: [],
    matches: [],
    ...overrides,
  };
}

function classify(input, auth = {}) {
  return classifyStaleMediaAuditRecords({
    projectId: 'hana-e2ee6',
    records: input,
    authPresentWithoutUser: new Set(auth.present ?? []),
    authMissingOwners: new Set(auth.missing ?? []),
  });
}

test('clears every exact snapshot type for an existing owner with no current photo', () => {
  const result = classify(records({
    users: [doc('users/bob', { photoUrls: [] })],
    posts: [doc('posts/p1', {
      uid: 'bob',
      authorPhotoUrl: 'profile_media/bob/old-post/image.jpg',
    })],
    comments: [doc('posts/p2/comments/c1', {
      uid: 'bob',
      authorPhotoUrl: 'https://legacy.example.com/bob-comment.jpg',
    })],
    replies: [doc('posts/p2/comments/c2/replies/r1', {
      uid: 'bob',
      authorPhotoUrl: 'https://legacy.example.com/bob-reply.jpg',
    })],
    blocks: [doc('users/alice/blocks/bob', {
      targetUid: 'bob',
      photoUrl: 'https://legacy.example.com/bob-block.jpg',
    })],
    matches: [doc('matches/room-1', {
      userIds: ['alice', 'bob'],
      myPhotoUrl: '',
      photoUrl: 'https://legacy.example.com/bob-position.jpg',
      partnerFor: {
        alice: { photoUrl: 'https://legacy.example.com/bob-partner.jpg' },
        bob: { photoUrl: '' },
      },
    })],
  }));

  assert.deepEqual(result.findings, []);
  assert.equal(result.actions.length, 6);
  assert.equal(
    result.actions.every((action) =>
      action.actionType === 'clear-reference' &&
      action.ownerUid === 'bob' &&
      action.ownerExpectation.kind === 'existing-no-current-photo' &&
      action.ownerExpectation.photoUrlsState === 'empty-array'
    ),
    true
  );
});

test('keeps a sole current legacy profile as a blocking trusted-reupload finding', () => {
  const result = classify(records({
    users: [doc('users/bob', {
      photoUrls: ['https://legacy.example.com/current-bob.jpg'],
    })],
    matches: [doc('matches/room-1', {
      userIds: ['alice', 'bob'],
      photoUrl: 'https://legacy.example.com/current-bob.jpg',
    })],
  }));

  assert.equal(result.actions.length, 0);
  assert.deepEqual(result.findings, [{
    code: 'legacy-current-photo-requires-trusted-reupload',
    location: 'users/bob',
  }]);
});

test('does not copy a current canonical photo into a stale snapshot', () => {
  const canonical = 'profile_media/bob/current/image.jpg';
  const result = classify(records({
    users: [doc('users/bob', { photoUrls: [canonical] })],
    matches: [doc('matches/room-1', {
      userIds: ['alice', 'bob'],
      photoUrl: 'https://legacy.example.com/old-bob.jpg',
      partnerFor: { alice: { photoUrl: canonical } },
    })],
  }));

  assert.equal(result.actions.length, 0);
  assert.deepEqual(result.findings, [{
    code: 'current-photo-reference-needs-path-migration',
    location: 'matches/room-1#photoUrl',
  }]);
});

test('defers only exact target-project first-party legacy URLs downstream', () => {
  const canonical = 'profile_media/bob/current/image.jpg';
  const exactLegacy =
    'https://firebasestorage.googleapis.com/v0/b/hana-e2ee6.firebasestorage.app/o/users%2Fbob%2Fold.jpg?alt=media&token=secret';
  const result = classify(records({
    users: [doc('users/bob', { photoUrls: [canonical] })],
    matches: [doc('matches/room-1', {
      userIds: ['alice', 'bob'],
      photoUrl: exactLegacy,
    })],
  }));

  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.actions, []);
  assert.equal(result.deferredFirstPartyReferences, 1);

  for (const nonDeferred of [
    exactLegacy.replace('hana-e2ee6', 'hana-production-tokyo'),
    exactLegacy.replace('&token=secret', '&token=secret&redirect=evil'),
    exactLegacy.replace(
      'users%2Fbob%2Fold.jpg',
      'profile_media%2Fbob%2Fremoved%2Fimage.jpg'
    ),
    'https://external.example.com/bob.jpg',
    'profile_media/bob/removed/image.jpg',
  ]) {
    const blocked = classify(records({
      users: [doc('users/bob', { photoUrls: [canonical] })],
      matches: [doc('matches/room-1', {
        userIds: ['alice', 'bob'],
        photoUrl: nonDeferred,
      })],
    }));
    assert.equal(blocked.deferredFirstPartyReferences, 0, nonDeferred);
    assert.equal(
      blocked.findings[0].code,
      'current-photo-reference-needs-path-migration',
      nonDeferred
    );
  }
});

test('deletes only an exact external-photo orphan post and omits child rewrites', () => {
  const result = classify(records({
    posts: [doc('posts/orphan-1', {
      uid: 'missing',
      authorPhotoUrl: 'https://legacy.example.com/missing.jpg',
    })],
    comments: [doc('posts/orphan-1/comments/c1', {
      uid: 'missing',
      authorPhotoUrl: 'https://legacy.example.com/missing-comment.jpg',
    })],
    replies: [doc('posts/orphan-1/comments/c1/replies/r1', {
      uid: 'missing',
      authorPhotoUrl: 'https://legacy.example.com/missing-reply.jpg',
    })],
  }), { missing: ['missing'] });

  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.actions, [{
    actionType: 'delete-orphan-post-tree',
    documentPath: 'posts/orphan-1',
    ownerUid: 'missing',
    expectedAuthorPhotoUrl: 'https://legacy.example.com/missing.jpg',
    ownerExpectation: { kind: 'missing-user-and-auth' },
  }]);
});

test('preserves orphan posts for Auth-backed or first-party owners', () => {
  const firstParty =
    'https://firebasestorage.googleapis.com/v0/b/hana-e2ee6.firebasestorage.app/o/users%2Fmissing%2Fphoto.jpg?alt=media&token=secret';
  const authBacked = classify(records({
    posts: [doc('posts/auth-backed', {
      uid: 'missing',
      authorPhotoUrl: 'https://legacy.example.com/missing.jpg',
    })],
  }), { present: ['missing'] });
  const firstPartyResult = classify(records({
    posts: [doc('posts/first-party', {
      uid: 'missing',
      authorPhotoUrl: firstParty,
    })],
  }), { missing: ['missing'] });

  assert.equal(authBacked.actions.length, 0);
  assert.equal(
    authBacked.findings[0].code,
    'missing-user-auth-record-still-exists'
  );
  assert.equal(firstPartyResult.actions.length, 0);
  assert.deepEqual(firstPartyResult.findings, [{
    code: 'orphan-post-not-external',
    location: 'posts/first-party',
  }]);
});

test('scrubs missing-owner matches but preserves exact positional semantics', () => {
  const result = classify(records({
    users: [doc('users/alice', {
      photoUrls: ['profile_media/alice/current/image.jpg'],
    })],
    matches: [doc('matches/room-1', {
      userIds: ['alice', 'missing'],
      myPhotoUrl: 'profile_media/alice/current/image.jpg',
      photoUrl: 'https://legacy.example.com/missing-position.jpg',
      partnerFor: {
        alice: { photoUrl: 'https://legacy.example.com/missing-partner.jpg' },
        missing: { photoUrl: 'profile_media/alice/current/image.jpg' },
      },
    })],
  }), { missing: ['missing'] });

  assert.deepEqual(result.findings, []);
  assert.equal(result.actions.length, 2);
  assert.deepEqual(
    result.actions.map((action) => action.fieldPath).sort(),
    ['partnerFor.alice.photoUrl', 'photoUrl']
  );
  assert.equal(result.actions.every((action) =>
    action.ownerUid === 'missing' &&
    action.ownerExpectation.kind === 'missing-user-and-auth'
  ), true);
});

test('malformed owner relations block instead of guessing', () => {
  const result = classify(records({
    blocks: [doc('users/alice/blocks/bob', {
      targetUid: 'mallory',
      photoUrl: 'https://legacy.example.com/bob.jpg',
    })],
    matches: [doc('matches/room-1', {
      userIds: ['alice', 'alice'],
      photoUrl: 'https://legacy.example.com/unknown.jpg',
      partnerFor: {
        mallory: { photoUrl: 'https://legacy.example.com/x.jpg' },
        'unsafe.viewer': { photoUrl: 'https://legacy.example.com/y.jpg' },
      },
    })],
  }));

  assert.equal(result.actions.length, 0);
  assert.equal(
    result.findings.every((finding) =>
      finding.code === 'malformed-reference-schema'
    ),
    true
  );
  assert.equal(result.findings.length, 4);
});
