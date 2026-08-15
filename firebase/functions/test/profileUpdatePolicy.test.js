const assert = require('node:assert/strict');
const test = require('node:test');

const {
  editableProfileFieldNames,
  isValidProfileDisplayNameReservationId,
  normalizeProfileDisplayName,
  profileDisplayNameReservationIdsToRelease,
  profileMediaVisibilityVersion,
  validateProfileUpdateInput,
} = require('../lib/profileUpdatePolicy');

const referenceDate = new Date('2026-08-12T12:00:00.000Z');

function validProfile(overrides = {}) {
  return {
    displayName: ' Hana ',
    bio: ' 새로운 소개 ',
    relationshipType: '언어교환',
    birthYear: 2000,
    birthMonth: 1,
    birthDay: 1,
    gender: 'female',
    nationality: 'KR',
    residingCountry: 'JP',
    nativeLanguage: 'ko',
    learningLanguage: 'ja',
    keywords: [' 언어교환 ', '산책'],
    photoUrls: [],
    preferredGender: 'any',
    preferredNationality: 'JP',
    preferredAgeMin: 18,
    preferredAgeMax: 50,
    ...overrides,
  };
}

test('accepts and normalizes the exact Flutter profile-edit payload', () => {
  assert.equal(profileMediaVisibilityVersion, 1);
  const result = validateProfileUpdateInput(validProfile(), referenceDate);
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.value).sort(), [...editableProfileFieldNames].sort());
  assert.equal(result.value.displayName, 'Hana');
  assert.equal(result.value.bio, '새로운 소개');
  assert.deepEqual(result.value.keywords, ['언어교환', '산책']);
  assert.equal(normalizeProfileDisplayName(' Ha Na '), 'hana');
  assert.equal(isValidProfileDisplayNameReservationId('hana'), true);
  assert.equal(isValidProfileDisplayNameReservationId('a/b'), false);

  const mediaResult = validateProfileUpdateInput(
    validProfile({
      photoUrls: ['profile_media/alice/auth-1/image.jpg'],
    }),
    referenceDate,
    'alice'
  );
  assert.equal(mediaResult.ok, true);
  assert.deepEqual(mediaResult.value.photoUrls, [
    'profile_media/alice/auth-1/image.jpg',
  ]);
});

test('new profile writes reject legacy bearer URLs and wrong-owner paths', () => {
  const legacyUrl =
    'https://firebasestorage.googleapis.com/v0/b/hana-e2ee6.firebasestorage.app/o/profile_media%2Falice%2Fauth-1%2Fimage.jpg?alt=media&token=secret';
  assert.equal(
    validateProfileUpdateInput(
      validProfile({ photoUrls: [legacyUrl] }),
      referenceDate,
      'alice'
    ).ok,
    false
  );
  assert.equal(
    validateProfileUpdateInput(
      validProfile({ photoUrls: ['profile_media/bob/auth-1/image.jpg'] }),
      referenceDate,
      'alice'
    ).ok,
    false
  );
});

test('releases only safe prior reservation ids and de-duplicates legacy drift', () => {
  assert.deepEqual(
    profileDisplayNameReservationIdsToRelease({
      storedNormalized: 'oldhana',
      currentDisplayName: 'Older Hana',
      nextNormalized: 'newhana',
    }),
    ['oldhana', 'olderhana']
  );
  assert.deepEqual(
    profileDisplayNameReservationIdsToRelease({
      storedNormalized: ' Same Hana ',
      currentDisplayName: 'same hana',
      nextNormalized: 'newhana',
    }),
    ['samehana']
  );
  assert.deepEqual(
    profileDisplayNameReservationIdsToRelease({
      storedNormalized: 'a/b',
      currentDisplayName: '..',
      nextNormalized: 'newhana',
    }),
    []
  );
  assert.deepEqual(
    profileDisplayNameReservationIdsToRelease({
      storedNormalized: 'newhana',
      currentDisplayName: 'New Hana',
      nextNormalized: 'newhana',
    }),
    []
  );
});

test('rejects missing, unexpected, and server-owned fields', () => {
  const missing = validProfile();
  delete missing.photoUrls;
  assert.match(validateProfileUpdateInput(missing, referenceDate).reason, /Missing required/);
  assert.match(
    validateProfileUpdateInput(validProfile({ keyCount: 999 }), referenceDate).reason,
    /Unexpected field: keyCount/
  );
  assert.match(
    validateProfileUpdateInput(validProfile({ isBanned: false }), referenceDate).reason,
    /Unexpected field: isBanned/
  );
});

test('rejects minors, unsupported identity and invalid language pairs', () => {
  const attacks = [
    validProfile({ birthYear: 2009 }),
    validProfile({ birthYear: 2000.5 }),
    validProfile({ birthMonth: 0 }),
    validProfile({ birthYear: 2005, birthMonth: 2, birthDay: 29 }),
    validProfile({ gender: 'unspecified' }),
    validProfile({ nationality: 'US' }),
    validProfile({ residingCountry: 'US' }),
    validProfile({ nativeLanguage: 'en' }),
    validProfile({ nativeLanguage: 'ko', learningLanguage: 'ko' }),
  ];

  for (const payload of attacks) {
    assert.equal(validateProfileUpdateInput(payload, referenceDate).ok, false);
  }
});

test('rejects invalid strings, enums, arrays and preference ranges', () => {
  const attacks = [
    validProfile({ displayName: 'x' }),
    validProfile({ displayName: 'x'.repeat(21) }),
    validProfile({ displayName: '..' }),
    validProfile({ displayName: '__name__' }),
    validProfile({ displayName: 'a/b' }),
    validProfile({ displayName: 'a\u0000b' }),
    validProfile({ bio: 'x'.repeat(501) }),
    validProfile({ relationshipType: '데이트' }),
    validProfile({ keywords: ['a', 'b', 'c', 'd', 'e', 'f'] }),
    validProfile({ keywords: ['same', ' SAME '] }),
    validProfile({ keywords: ['x'.repeat(31)] }),
    validProfile({ photoUrls: Array(7).fill('https://example.com/a.jpg') }),
    validProfile({ photoUrls: ['http://example.com/a.jpg'] }),
    validProfile({ photoUrls: ['https://user:pass@example.com/a.jpg'] }),
    validProfile({ photoUrls: ['https://example.com/a.jpg', 'https://example.com/a.jpg'] }),
    validProfile({ preferredGender: 'all' }),
    validProfile({ preferredNationality: 'US' }),
    validProfile({ preferredAgeMin: 17 }),
    validProfile({ preferredAgeMax: 101 }),
    validProfile({ preferredAgeMin: 50, preferredAgeMax: 20 }),
  ];

  for (const payload of attacks) {
    assert.equal(validateProfileUpdateInput(payload, referenceDate).ok, false);
  }
});

test('allows empty optional arrays and null preference enums', () => {
  const result = validateProfileUpdateInput(
    validProfile({
      keywords: [],
      photoUrls: [],
      preferredGender: null,
      preferredNationality: null,
      preferredAgeMin: 18,
      preferredAgeMax: 100,
      residingCountry: 'OTHER',
    }),
    referenceDate
  );
  assert.equal(result.ok, true);
});

test('keeps bio optional to match onboarding and public exposure', () => {
  const result = validateProfileUpdateInput(
    validProfile({ bio: '   ' }),
    referenceDate
  );
  assert.equal(result.ok, true);
  assert.equal(result.value.bio, '');
});

test('enforces the exact 18th-birthday boundary', () => {
  assert.equal(validateProfileUpdateInput(validProfile({
    birthYear: 2008,
    birthMonth: 8,
    birthDay: 12,
  }), referenceDate).ok, true);
  assert.equal(validateProfileUpdateInput(validProfile({
    birthYear: 2008,
    birthMonth: 8,
    birthDay: 13,
  }), referenceDate).ok, false);
});
