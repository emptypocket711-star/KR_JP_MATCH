const assert = require('node:assert/strict');
const test = require('node:test');

const {
  mediaUploadAuthorizationIssue,
  mediaUploadConfirmationLeaseIssue,
  mediaUploadDailyLimits,
  mediaUploadDailyByteLimits,
  mediaUploadObjectPath,
  mediaUploadQuotaId,
  mediaUploadUtcDayKey,
  nextMediaUploadQuotaCount,
  nextMediaUploadQuotaBytes,
  nextMediaUploadConfirmAttempt,
  nextMediaUploadServerRequestAttempt,
  mediaUploadDailyConfirmAttemptLimit,
  parseMediaUploadObjectPath,
  validateReserveMediaUploadRequest,
  hasJpegSignature,
  safeJpegUploadIssue,
  isSafeMediaUploadAuthorizationId,
  confirmedMediaUploadAuthorizationIssue,
  expiredMediaCleanupClaim,
  finalizedMediaDisposition,
  isLegacyPrivateMediaObjectPath,
  parseLegacyPrivateMediaObjectPath,
  isVerifiedPrivateMediaMetadata,
  privateMediaCacheControl,
  privateMediaMetadataPatch,
} = require('../lib/mediaUploadPolicy');

test('server byte-upload request quota rejects attempt 101 regardless of auth state', () => {
  const input = {
    existingDayKey: '2026-08-14',
    requestedDayKey: '2026-08-14',
  };
  assert.equal(nextMediaUploadServerRequestAttempt({
    ...input,
    existingAttempts: undefined,
  }), 1);
  assert.equal(nextMediaUploadServerRequestAttempt({
    ...input,
    existingAttempts: 99,
  }), 100);
  assert.equal(nextMediaUploadServerRequestAttempt({
    ...input,
    existingAttempts: 100,
  }), null);
});

test('recognizes only exact legacy private-media cutover prefixes', () => {
  assert.equal(isLegacyPrivateMediaObjectPath('users/alice/photo.jpg'), true);
  assert.equal(
    isLegacyPrivateMediaObjectPath('profile_photos/alice/old/photo.jpg'),
    true,
  );
  assert.equal(
    isLegacyPrivateMediaObjectPath('chat_images/room-1/alice/123.jpg'),
    true,
  );
  assert.equal(
    isLegacyPrivateMediaObjectPath(
      'chat_images/room-1/alice/auth-1/image.jpg',
    ),
    false,
  );
  assert.equal(isLegacyPrivateMediaObjectPath('public/alice/photo.jpg'), false);
  assert.equal(isLegacyPrivateMediaObjectPath('users/../photo.jpg'), false);
  assert.deepEqual(parseLegacyPrivateMediaObjectPath('users/alice/photo.jpg'), {
    uid: 'alice',
    kind: 'profile',
    matchId: null,
  });
  assert.deepEqual(
    parseLegacyPrivateMediaObjectPath('chat_images/room-1/alice/123.jpg'),
    { uid: 'alice', kind: 'chat', matchId: 'room-1' },
  );
  assert.equal(
    parseLegacyPrivateMediaObjectPath(
      'chat_images/room-1/alice/auth-1/image.jpg',
    ),
    null,
  );
});

test('late finalize cleanup preserves only the authorization-bound generation', () => {
  const expected = {
    uid: 'alice',
    kind: 'chat',
    matchId: 'room-1',
    objectPath: 'chat_images/room-1/alice/auth/image.jpg',
  };
  assert.equal(
    finalizedMediaDisposition(undefined, expected, 'g1'),
    'cleanup-unpublishable',
  );
  assert.equal(
    finalizedMediaDisposition({ ...expected, status: 'reserved' }, expected, 'g1'),
    'process-reservation',
  );
  assert.equal(
    finalizedMediaDisposition(
      { ...expected, status: 'reserved', uploadProtocolVersion: 2 },
      expected,
      'g1',
      {
        nowMillis: 3000,
        protocolVersion: 2,
        leaseOwner: 'lease-owner-123456',
        payloadDigest: 'a'.repeat(64),
      },
    ),
    'cleanup-unpublishable',
  );
  const serverUploading = {
    ...expected,
    status: 'server_uploading',
    uploadProtocolVersion: 2,
    serverUploadLeaseOwner: 'lease-owner-123456',
    serverUploadDigest: 'a'.repeat(64),
    serverUploadLeaseUntil: { toMillis: () => 2000 },
  };
  const serverContext = {
    nowMillis: 1000,
    protocolVersion: 2,
    leaseOwner: 'lease-owner-123456',
    payloadDigest: 'a'.repeat(64),
  };
  assert.equal(
    finalizedMediaDisposition(serverUploading, expected, 'g1', serverContext),
    'preserve-server-upload',
  );
  assert.equal(
    finalizedMediaDisposition(
      { ...serverUploading, serverUploadLeaseUntil: { toMillis: () => 1000 } },
      expected,
      'g1',
      serverContext,
    ),
    'recover-server-upload',
  );
  assert.equal(
    finalizedMediaDisposition(serverUploading, expected, 'g1', {
      ...serverContext,
      payloadDigest: 'b'.repeat(64),
    }),
    'cleanup-unpublishable',
  );
  for (const [status, generationField] of [
    ['uploaded', 'uploadedGeneration'],
    ['confirming', 'lockedGeneration'],
    ['confirmed', 'confirmedGeneration'],
    ['consumed', 'confirmedGeneration'],
  ]) {
    assert.equal(
      finalizedMediaDisposition(
        { ...expected, status, [generationField]: 'g1' },
        expected,
        'g1',
      ),
      'preserve-live-authorization',
    );
    assert.equal(
      finalizedMediaDisposition(
        { ...expected, status, [generationField]: 'g1' },
        expected,
        'g2',
      ),
      'cleanup-unpublishable',
    );
  }
  assert.equal(
    finalizedMediaDisposition(
      {
        ...expected,
        status: 'uploaded',
        uploadProtocolVersion: 2,
        uploadedGeneration: 'g1',
      },
      expected,
      'g1',
    ),
    'cleanup-unpublishable',
  );
  assert.equal(
    finalizedMediaDisposition(
      { ...expected, status: 'cleanup_required', cleanupGeneration: 'g1' },
      expected,
      'g1',
    ),
    'preserve-existing-cleanup',
  );
  assert.equal(
    finalizedMediaDisposition(
      { ...expected, status: 'cleanup_required', cleanupGeneration: 'g1' },
      expected,
      'g2',
    ),
    'cleanup-unpublishable',
  );
  assert.equal(
    finalizedMediaDisposition(
      { ...expected, status: 'expired_without_object' },
      expected,
      'g1',
    ),
    'cleanup-unpublishable',
  );
  assert.equal(
    finalizedMediaDisposition(
      { ...expected, uid: 'mallory', status: 'consumed' },
      expected,
      'g1',
    ),
    'cleanup-unpublishable',
  );
});

test('validates strict profile and chat reservation request shapes', () => {
  assert.deepEqual(validateReserveMediaUploadRequest({ kind: 'profile' }), {
    ok: true,
    value: { kind: 'profile' },
  });
  assert.deepEqual(
    validateReserveMediaUploadRequest({ kind: 'chat', matchId: 'room-1' }),
    { ok: true, value: { kind: 'chat', matchId: 'room-1' } },
  );
  assert.equal(
    validateReserveMediaUploadRequest({ kind: 'profile', matchId: 'room' }).ok,
    false,
  );
  assert.equal(
    validateReserveMediaUploadRequest({ kind: 'chat', matchId: '../room' }).ok,
    false,
  );
  assert.equal(
    validateReserveMediaUploadRequest({ kind: 'chat', matchId: 'room', uid: 'x' }).ok,
    false,
  );
});

test('consumption requires a byte-charged confirmed immutable generation', () => {
  const now = 1000;
  const expected = {
    uid: 'alice',
    kind: 'profile',
    objectPath: 'profile_media/alice/auth/image.jpg',
  };
  const confirmed = {
    ...expected,
    status: 'confirmed',
    byteCharged: true,
    confirmedGeneration: '7',
    confirmedSize: 2048,
    expiresAt: { toMillis: () => now + 1 },
  };
  assert.equal(
    confirmedMediaUploadAuthorizationIssue(
      confirmed,
      expected,
      now,
      '7',
      2048,
    ),
    null,
  );
  assert.equal(
    confirmedMediaUploadAuthorizationIssue(
      { ...confirmed, status: 'uploaded' },
      expected,
      now,
      '7',
      2048,
    ),
    'not-reserved',
  );
  assert.equal(
    confirmedMediaUploadAuthorizationIssue(
      { ...confirmed, byteCharged: false },
      expected,
      now,
      '7',
      2048,
    ),
    'not-byte-charged',
  );
  assert.notEqual(
    confirmedMediaUploadAuthorizationIssue(
      confirmed,
      expected,
      now,
      '8',
      2048,
    ),
    null,
  );
  assert.equal(
    confirmedMediaUploadAuthorizationIssue(
      confirmed,
      { ...expected, objectPath: 'profile_media/alice/other/image.jpg' },
      now,
      '7',
      2048,
    ),
    'wrong-path',
  );
  assert.equal(
    confirmedMediaUploadAuthorizationIssue(
      confirmed,
      expected,
      now,
      '7',
      2049,
    ),
    'wrong-path',
  );
});

test('private media publication requires exact cache state and no bearer token', () => {
  const expected = { generation: '7', size: 2048 };
  const valid = {
    generation: '7',
    size: '2048',
    contentType: 'image/jpeg',
    cacheControl: privateMediaCacheControl,
    metadata: { hanaCacheControl: privateMediaCacheControl },
  };
  assert.equal(isVerifiedPrivateMediaMetadata(valid, expected), true);
  assert.equal(isVerifiedPrivateMediaMetadata({
    ...valid,
    metadata: {
      ...valid.metadata,
      firebaseStorageDownloadTokens: 'bearer-secret',
    },
  }, expected), false);
  assert.equal(isVerifiedPrivateMediaMetadata({
    ...valid,
    cacheControl: 'public, max-age=3600',
  }, expected), false);
  assert.equal(isVerifiedPrivateMediaMetadata({
    ...valid,
    metadata: {},
  }, expected), false);
  assert.equal(isVerifiedPrivateMediaMetadata({
    ...valid,
    generation: '8',
  }, expected), false);
  assert.deepEqual(privateMediaMetadataPatch({
    harmless: 'kept',
    firebaseStorageDownloadTokens: 'bearer-secret',
  }), {
    cacheControl: privateMediaCacheControl,
    metadata: {
      harmless: 'kept',
      firebaseStorageDownloadTokens: null,
      hanaCacheControl: privateMediaCacheControl,
    },
  });
});

test('only the exact confirmation lease owner may publish or clean up', () => {
  const expected = {
    owner: 'worker-a',
    generation: '7',
    size: 2048,
  };
  const confirming = {
    status: 'confirming',
    confirmLeaseOwner: expected.owner,
    byteCharged: true,
    lockedGeneration: expected.generation,
    lockedSize: expected.size,
  };
  assert.equal(mediaUploadConfirmationLeaseIssue(confirming, expected), null);
  assert.equal(
    mediaUploadConfirmationLeaseIssue(confirming, {
      ...expected,
      owner: 'worker-b',
    }),
    'wrong-owner',
  );
  assert.equal(
    mediaUploadConfirmationLeaseIssue(
      { ...confirming, status: 'confirmed' },
      expected,
    ),
    'not-confirming',
  );
  assert.equal(
    mediaUploadConfirmationLeaseIssue(
      { ...confirming, lockedGeneration: '8' },
      expected,
    ),
    'wrong-generation',
  );
});

test('expired cleanup claims are fresh status-bound and generation-exact', () => {
  const expiresAt = { toMillis: () => 1000 };
  const confirmed = {
    uid: 'alice',
    kind: 'profile',
    objectPath: 'profile_media/alice/auth-1/image.jpg',
    status: 'confirmed',
    confirmedGeneration: '7',
    expiresAt,
  };
  assert.deepEqual(expiredMediaCleanupClaim('auth-1', confirmed, 1000), {
    objectPath: confirmed.objectPath,
    generation: '7',
  });
  assert.equal(
    expiredMediaCleanupClaim('auth-1', { ...confirmed, status: 'consumed' }, 1000),
    null,
  );
  assert.equal(
    expiredMediaCleanupClaim('auth-1', confirmed, 999),
    null,
  );
  assert.deepEqual(
    expiredMediaCleanupClaim(
      'auth-1',
      { ...confirmed, status: 'reserved', confirmedGeneration: undefined },
      1000,
      { objectPath: confirmed.objectPath, generation: '8' },
    ),
    { objectPath: confirmed.objectPath, generation: '8' },
  );
  assert.equal(
    expiredMediaCleanupClaim(
      'auth-1',
      { ...confirmed, status: 'reserved', confirmedGeneration: undefined },
      1000,
      { objectPath: 'profile_media/alice/other/image.jpg', generation: '8' },
    ),
    null,
  );
});

test('enforces actual confirmed daily byte budgets independently by kind', () => {
  assert.equal(
    nextMediaUploadQuotaBytes({
      kind: 'profile',
      existingDayKey: '2026-08-13',
      existingBytes: mediaUploadDailyByteLimits.profile - 1,
      requestedDayKey: '2026-08-13',
      uploadedBytes: 1,
    }),
    mediaUploadDailyByteLimits.profile,
  );
  assert.equal(
    nextMediaUploadQuotaBytes({
      kind: 'profile',
      existingDayKey: '2026-08-13',
      existingBytes: mediaUploadDailyByteLimits.profile,
      requestedDayKey: '2026-08-13',
      uploadedBytes: 1,
    }),
    null,
  );
  assert.equal(
    nextMediaUploadQuotaBytes({
      kind: 'chat',
      existingDayKey: '2026-08-12',
      existingBytes: mediaUploadDailyByteLimits.chat,
      requestedDayKey: '2026-08-13',
      uploadedBytes: 1024,
    }),
    1024,
  );
  assert.equal(
    nextMediaUploadQuotaBytes({
      kind: 'chat',
      existingDayKey: '2026-08-13',
      existingBytes: 0,
      requestedDayKey: '2026-08-13',
      uploadedBytes: 5 * 1024 * 1024 + 1,
    }),
    null,
  );
});

test('recognizes the JPEG start-of-image signature', () => {
  assert.equal(hasJpegSignature(Uint8Array.from([0xff, 0xd8, 0xff])), true);
  assert.equal(hasJpegSignature(Uint8Array.from([0x89, 0x50, 0x4e, 0x47])), false);
  assert.equal(hasJpegSignature(Uint8Array.from([0xff, 0xd8])), false);
});

test('accepts a structurally complete metadata-free JPEG marker stream', () => {
  const clean = Uint8Array.from([
    0xff, 0xd8,
    // Strict thumbnail-free JFIF APP0.
    0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00,
    0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    // Baseline SOF: length 17, 8 bit, 1x1, three RGB/YUV components.
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    // SOS: length 12, three components, then entropy and EOI.
    0xff, 0xda, 0x00, 0x0c, 0x03,
    0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x00, 0x3f, 0x00,
    0x2a, 0xff, 0x00, 0x33, 0xff, 0xd9,
  ]);
  assert.equal(safeJpegUploadIssue(clean), null);
});

test('rejects private APP metadata comments and malformed JPEG segments', () => {
  const suffix = [
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x0c, 0x03,
    0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x00, 0x3f, 0x00,
    0x2a, 0xff, 0xd9,
  ];
  for (const marker of [
    0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8,
    0xe9, 0xea, 0xeb, 0xec, 0xed, 0xee, 0xef, 0xfe,
  ]) {
    const privateJpeg = Uint8Array.from([
      0xff, 0xd8,
      0xff, marker, 0x00, 0x04, 0x41, 0x42,
      ...suffix,
    ]);
    assert.equal(safeJpegUploadIssue(privateJpeg), 'forbidden-metadata');
  }
  assert.equal(
    safeJpegUploadIssue(Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x20, 0x01, 0x02,
    ])),
    'malformed',
  );
  assert.equal(
    safeJpegUploadIssue(Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x06, 0x45, 0x56, 0x49, 0x4c,
      ...suffix,
    ])),
    'forbidden-metadata',
  );
  assert.equal(
    safeJpegUploadIssue(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])),
    'malformed',
  );
  assert.equal(
    safeJpegUploadIssue(Uint8Array.from([...suffix, 0x00])),
    'invalid-signature',
  );
});

test('rejects dimension and total-pixel JPEG bombs at the server boundary', () => {
  function singlePixelJpeg(width, height) {
    return Uint8Array.from([
      0xff, 0xd8,
      0xff, 0xc0, 0x00, 0x11, 0x08,
      (height >> 8) & 0xff, height & 0xff,
      (width >> 8) & 0xff, width & 0xff,
      0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
      0xff, 0xda, 0x00, 0x0c, 0x03,
      0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x00, 0x3f, 0x00,
      0x2a, 0xff, 0xd9,
    ]);
  }
  assert.equal(safeJpegUploadIssue(singlePixelJpeg(2400, 1)), null);
  assert.equal(safeJpegUploadIssue(singlePixelJpeg(2401, 1)), 'malformed');
  assert.equal(safeJpegUploadIssue(singlePixelJpeg(2100, 2000)), 'malformed');
});

test('builds and parses only server authorization-bound object paths', () => {
  const profilePath = mediaUploadObjectPath({
    kind: 'profile',
    uid: 'alice',
    authorizationId: 'randomAuth',
  });
  const chatPath = mediaUploadObjectPath({
    kind: 'chat',
    uid: 'alice',
    matchId: 'room-1',
    authorizationId: 'randomAuth',
  });
  assert.equal(profilePath, 'profile_media/alice/randomAuth/image.jpg');
  assert.equal(chatPath, 'chat_images/room-1/alice/randomAuth/image.jpg');
  assert.deepEqual(parseMediaUploadObjectPath(profilePath), {
    kind: 'profile',
    uid: 'alice',
    authorizationId: 'randomAuth',
  });
  assert.deepEqual(parseMediaUploadObjectPath(chatPath), {
    kind: 'chat',
    matchId: 'room-1',
    uid: 'alice',
    authorizationId: 'randomAuth',
  });
  assert.equal(parseMediaUploadObjectPath('users/alice/photo_1.jpg'), null);
  assert.equal(
    parseMediaUploadObjectPath('chat_images/room-1/alice/1.jpg'),
    null,
  );
});

test('uses UTC quota days and enforces independent daily limits', () => {
  const date = new Date('2026-08-13T23:59:59.000Z');
  assert.equal(mediaUploadUtcDayKey(date), '2026-08-13');
  assert.equal(mediaUploadQuotaId('alice', '2026-08-13'), 'alice_2026-08-13');
  assert.equal(
    nextMediaUploadQuotaCount({
      kind: 'profile',
      existingDayKey: '2026-08-13',
      existingCount: mediaUploadDailyLimits.profile - 1,
      requestedDayKey: '2026-08-13',
    }),
    mediaUploadDailyLimits.profile,
  );
  assert.equal(
    nextMediaUploadQuotaCount({
      kind: 'profile',
      existingDayKey: '2026-08-13',
      existingCount: mediaUploadDailyLimits.profile,
      requestedDayKey: '2026-08-13',
    }),
    null,
  );
  assert.equal(
    nextMediaUploadQuotaCount({
      kind: 'chat',
      existingDayKey: '2026-08-12',
      existingCount: 999,
      requestedDayKey: '2026-08-13',
    }),
    1,
  );
});

test('bounds metadata-level confirmation attempts per uid and UTC day', () => {
  assert.equal(nextMediaUploadConfirmAttempt({
    existingDayKey: '2026-08-13',
    existingAttempts: mediaUploadDailyConfirmAttemptLimit - 1,
    requestedDayKey: '2026-08-14',
  }), 1);
  assert.equal(nextMediaUploadConfirmAttempt({
    existingDayKey: '2026-08-14',
    existingAttempts: mediaUploadDailyConfirmAttemptLimit - 1,
    requestedDayKey: '2026-08-14',
  }), mediaUploadDailyConfirmAttemptLimit);
  assert.equal(nextMediaUploadConfirmAttempt({
    existingDayKey: '2026-08-14',
    existingAttempts: mediaUploadDailyConfirmAttemptLimit,
    requestedDayKey: '2026-08-14',
  }), null);
});

test('authorizations are single-owner, exact-path, reserved, and unexpired', () => {
  const now = 1_000;
  const expected = {
    uid: 'alice',
    kind: 'chat',
    matchId: 'room-1',
    objectPath: 'chat_images/room-1/alice/auth/image.jpg',
  };
  const valid = {
    ...expected,
    status: 'reserved',
    expiresAt: { toMillis: () => now + 1 },
  };
  assert.equal(mediaUploadAuthorizationIssue(valid, expected, now), null);
  assert.equal(
    mediaUploadAuthorizationIssue(
      { ...valid, status: 'uploaded' },
      expected,
      now,
      ['uploaded'],
    ),
    null,
  );
  assert.equal(
    mediaUploadAuthorizationIssue({ ...valid, uid: 'mallory' }, expected, now),
    'wrong-owner',
  );
  assert.equal(
    mediaUploadAuthorizationIssue({ ...valid, status: 'consumed' }, expected, now),
    'not-reserved',
  );
  assert.equal(
    mediaUploadAuthorizationIssue({
      ...valid,
      expiresAt: { toMillis: () => now },
    }, expected, now),
    'expired',
  );
});

test('validates authorization ids as one bounded path segment', () => {
  assert.equal(isSafeMediaUploadAuthorizationId('auth-1'), true);
  assert.equal(isSafeMediaUploadAuthorizationId('../auth'), false);
  assert.equal(isSafeMediaUploadAuthorizationId('a/b'), false);
  assert.equal(isSafeMediaUploadAuthorizationId(''), false);
});
