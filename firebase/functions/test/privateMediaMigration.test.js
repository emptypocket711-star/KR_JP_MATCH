const assert = require('node:assert/strict');
const test = require('node:test');

const {
  firstPartyObjectPathFromUrl,
  isManagedPrivateMediaObjectPath,
  manifestDigest,
  parseOptions,
  storagePageToken,
} = require('../lib/admin/privateMediaMigration');

const bucket = 'hana-e2ee6.firebasestorage.app';
const canonicalUrl =
  'https://firebasestorage.googleapis.com/v0/b/hana-e2ee6.firebasestorage.app/o/chat_images%2Froom-1%2Falice%2Fauth-1%2Fimage.jpg?alt=media&token=secret';

test('private media migration is dry-run by default and requires a manifest', () => {
  const options = parseOptions([
    '--expected-project',
    'hana-e2ee6',
    '--manifest',
    '/tmp/private-media.json',
  ]);
  assert.notEqual(options, 'help');
  assert.equal(options.apply, false);
  assert.equal(options.expectedProject, 'hana-e2ee6');
  assert.throws(
    () => parseOptions(['--expected-project', 'hana-e2ee6']),
    /--expected-project and --manifest are required/
  );
  assert.throws(
    () => parseOptions([
      '--expected-project',
      'hana-e2ee6',
      '--manifest',
      '/tmp/x',
      '--unknown',
    ]),
    /Unknown argument/
  );
});

test('token revocation scope includes canonical and exact legacy media paths', () => {
  for (const objectPath of [
    'profile_media/alice/auth-1/image.jpg',
    'chat_images/room-1/alice/auth-1/image.jpg',
    'users/alice/photo_1.jpg',
    'profile_photos/alice/archive/photo_1.jpg',
  ]) {
    assert.equal(isManagedPrivateMediaObjectPath(objectPath), true, objectPath);
  }
  for (const objectPath of [
    'users/alice',
    'users/alice/nested/photo.jpg',
    'profile_photos/alice',
    'profile_photos/alice/../bob/photo.jpg',
    'voice_messages/alice/message.m4a',
    '/users/alice/photo.jpg',
  ]) {
    assert.equal(isManagedPrivateMediaObjectPath(objectPath), false, objectPath);
  }
});

test('extracts only exact current-project first-party media URLs', () => {
  assert.equal(
    firstPartyObjectPathFromUrl(canonicalUrl, bucket),
    'chat_images/room-1/alice/auth-1/image.jpg'
  );
  assert.equal(
    firstPartyObjectPathFromUrl(
      canonicalUrl.replace(bucket, 'attacker.firebasestorage.app'),
      bucket
    ),
    null
  );
  assert.equal(
    firstPartyObjectPathFromUrl(
      canonicalUrl.replace('?alt=media', '?redirect=https://example.com&alt=media'),
      bucket
    ),
    null
  );
  assert.equal(
    firstPartyObjectPathFromUrl(
      canonicalUrl.replace(
        'https://firebasestorage.googleapis.com',
        'https://user:pass@firebasestorage.googleapis.com'
      ),
      bucket
    ),
    null
  );
});

test('manifest digest is deterministic across object key order', () => {
  const left = { b: 2, a: { d: 4, c: 3 } };
  const right = { a: { c: 3, d: 4 }, b: 2 };
  assert.equal(manifestDigest(left), manifestDigest(right));
  assert.match(manifestDigest(left), /^[a-f0-9]{64}$/);
});

test('storage pagination treats a null or empty next query as complete', () => {
  assert.equal(storagePageToken(null), undefined);
  assert.equal(storagePageToken(undefined), undefined);
  assert.equal(storagePageToken({}), undefined);
  assert.equal(storagePageToken({ pageToken: '' }), undefined);
  assert.equal(storagePageToken({ pageToken: 'next-page' }), 'next-page');
});
