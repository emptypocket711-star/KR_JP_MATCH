const assert = require('node:assert/strict');
const test = require('node:test');
const sharp = require('sharp');

const {
  decodeAndSanitizeServerJpeg,
  hasExactServerMediaUploadMarker,
  mediaUploadMaxBase64Length,
  mediaUploadProtocolVersion,
  mediaUploadPublicationTtlMillis,
  serverMediaUploadCustomMetadata,
  serverMediaUploadPayloadDigest,
  shouldCleanupServerMediaAfterFailure,
  validateServerMediaUploadRequest,
} = require('../lib/serverMediaUploadPolicy');
const {
  mediaUploadMaxBytes,
  privateMediaCacheControl,
  safeJpegUploadIssue,
} = require('../lib/mediaUploadPolicy');

test('rejects oversized and non-canonical base64 before any decode', () => {
  const oversized = 'A'.repeat(mediaUploadMaxBase64Length + 4);
  assert.equal(validateServerMediaUploadRequest({
    authorizationId: 'auth-1',
    jpegBase64: oversized,
  }).ok, false);
  assert.equal(validateServerMediaUploadRequest({
    authorizationId: 'auth-1',
    jpegBase64: 'AB==',
  }).ok, true);
  assert.equal(validateServerMediaUploadRequest({
    authorizationId: 'auth-1',
    jpegBase64: 'A===',
  }).ok, false);
  const maxRaw = Buffer.alloc(mediaUploadMaxBytes, 1).toString('base64');
  const valid = validateServerMediaUploadRequest({
    authorizationId: 'auth-1',
    jpegBase64: maxRaw,
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.value.decodedByteLength, mediaUploadMaxBytes);
});

test('sharp decode and re-encode produces a metadata-free safe JPEG', async () => {
  const input = await sharp({
    create: {
      width: 32,
      height: 24,
      channels: 3,
      background: { r: 20, g: 120, b: 220 },
    },
  }).jpeg({ progressive: false }).toBuffer();
  assert.equal(safeJpegUploadIssue(input), null);
  const base64 = input.toString('base64');
  const output = await decodeAndSanitizeServerJpeg(base64, input.length);
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.width, 32);
  assert.equal(metadata.height, 24);
  assert.equal(safeJpegUploadIssue(output), null);
});

test('marker-valid but nondecodable JPEG is rejected by real pixel decode', async () => {
  const fake = Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x0c, 0x03,
    0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x00, 0x3f, 0x00,
    0x2a, 0xff, 0xd9,
  ]);
  assert.equal(safeJpegUploadIssue(fake), null);
  await assert.rejects(
    decodeAndSanitizeServerJpeg(fake.toString('base64'), fake.length),
  );
});

test('server-only object marker is exact and download-token free', () => {
  const payloadDigest = serverMediaUploadPayloadDigest('aGVsbG8=');
  const marker = {
    leaseOwner: '12345678-1234-1234-1234-123456789abc',
    payloadDigest,
  };
  const metadata = serverMediaUploadCustomMetadata(marker);
  assert.deepEqual(metadata, {
    hanaCacheControl: privateMediaCacheControl,
    hanaUploadProtocolVersion: String(mediaUploadProtocolVersion),
    hanaServerUploadLeaseOwner: marker.leaseOwner,
    hanaServerUploadDigest: payloadDigest,
  });
  assert.equal(hasExactServerMediaUploadMarker(metadata, marker), true);
  assert.equal(hasExactServerMediaUploadMarker({
    ...metadata,
    hanaServerUploadDigest: '0'.repeat(64),
  }, marker), false);
  assert.equal(hasExactServerMediaUploadMarker({
    ...metadata,
    firebaseStorageDownloadTokens: 'bearer',
  }, marker), false);
  assert.equal(mediaUploadPublicationTtlMillis, 60 * 60 * 1000);
});

test('post-save transient failures retain the fenced object for recovery', () => {
  for (const code of [
    null,
    'aborted',
    'unavailable',
    'deadline-exceeded',
    'internal',
    'data-loss',
  ]) {
    assert.equal(shouldCleanupServerMediaAfterFailure(code), false, code);
  }
  for (const code of [
    'invalid-argument',
    'failed-precondition',
    'permission-denied',
    'not-found',
    'resource-exhausted',
  ]) {
    assert.equal(shouldCleanupServerMediaAfterFailure(code), true, code);
  }
});
