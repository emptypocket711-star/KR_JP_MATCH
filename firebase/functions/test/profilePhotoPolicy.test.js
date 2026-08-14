const assert = require('node:assert/strict');
const test = require('node:test');

const {
  isOwnedFirebaseProfilePhotoUrl,
  isOwnedProfileMediaPath,
  profilePhotoObjectPath,
} = require('../lib/profilePhotoPolicy');

const alicePhoto =
  'https://firebasestorage.googleapis.com/v0/b/hana-e2ee6.firebasestorage.app/o/users%2Falice%2Fphoto.jpg?alt=media&token=x';
const reservedAlicePhoto =
  'https://firebasestorage.googleapis.com/v0/b/hana-e2ee6.firebasestorage.app/o/profile_media%2Falice%2Fauth-1%2Fimage.jpg?alt=media&token=x';

test('accepts only Firebase profile object URLs owned by the expected uid', () => {
  assert.equal(isOwnedFirebaseProfilePhotoUrl(alicePhoto), true);
  assert.equal(isOwnedFirebaseProfilePhotoUrl(alicePhoto, 'alice'), true);
  assert.equal(isOwnedFirebaseProfilePhotoUrl(alicePhoto, 'bob'), false);
  assert.equal(isOwnedFirebaseProfilePhotoUrl(reservedAlicePhoto, 'alice'), true);
  assert.equal(isOwnedFirebaseProfilePhotoUrl(reservedAlicePhoto, 'bob'), false);
  assert.equal(isOwnedFirebaseProfilePhotoUrl('https://example.com/track.jpg'), false);
  assert.equal(
    isOwnedFirebaseProfilePhotoUrl(
      'https://firebasestorage.googleapis.com/v0/b/attacker-bucket/o/users%2Falice%2Fphoto.jpg?alt=media&token=x',
      'alice'
    ),
    false
  );
  assert.equal(
    isOwnedFirebaseProfilePhotoUrl(
      'https://firebasestorage.googleapis.com/v0/b/hana-production-tokyo.firebasestorage.app/o/chat_images%2Froom%2Falice%2Fa.jpg',
      'alice'
    ),
    false
  );
});

test('extracts only a verified caller-owned object path', () => {
  assert.equal(profilePhotoObjectPath(alicePhoto, 'alice'), 'users/alice/photo.jpg');
  assert.equal(profilePhotoObjectPath(alicePhoto, 'bob'), null);
  assert.equal(
    profilePhotoObjectPath(reservedAlicePhoto, 'alice'),
    'profile_media/alice/auth-1/image.jpg'
  );
});

test('canonical profile media paths are the only new writable references', () => {
  const path = 'profile_media/alice/auth-1/image.jpg';
  assert.equal(isOwnedProfileMediaPath(path), true);
  assert.equal(isOwnedProfileMediaPath(path, 'alice'), true);
  assert.equal(isOwnedProfileMediaPath(path, 'bob'), false);
  assert.equal(isOwnedProfileMediaPath('profile_media/alice/auth-1/image.png'), false);
  assert.equal(isOwnedProfileMediaPath('profile_media/alice/../image.jpg'), false);
  assert.equal(profilePhotoObjectPath(path, 'alice'), path);
});
