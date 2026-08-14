const assert = require('node:assert/strict');
const test = require('node:test');

const {
  decideInitialOnboardingPointGrant,
  hasValidAdultIdentity,
  initialOnboardingPointGrantAmount,
  onboardingCompletionBlockReason,
  onboardingPointEventId,
  profileMediaVisibilityVersion,
  validateOnboardingProfileInput,
} = require('../lib/onboardingPolicy');

const referenceDate = new Date('2026-08-12T12:00:00.000Z');

function validProfile(overrides = {}) {
  return {
    relationshipType: '언어교환',
    displayName: 'Hana',
    birthYear: 2000,
    birthMonth: 1,
    birthDay: 1,
    gender: 'female',
    nationality: 'KR',
    residingCountry: 'KR',
    nativeLanguage: 'ko',
    learningLanguage: 'ja',
    bio: '',
    occupation: '',
    keywords: ['언어교환'],
    qaItems: [{ question: '취미는?', answer: '산책' }],
    photoUrls: [],
    preferredGender: null,
    preferredNationality: null,
    preferredAgeMin: null,
    preferredAgeMax: null,
    ...overrides,
  };
}

test('uses a deterministic one-time onboarding point event', () => {
  assert.equal(profileMediaVisibilityVersion, 1);
  assert.equal(initialOnboardingPointGrantAmount, 3);
  assert.equal(
    onboardingPointEventId('alice'),
    'onboarding:alice:v1'
  );
  assert.equal(
    onboardingPointEventId(' alice '),
    'onboarding:alice:v1'
  );
  assert.throws(() => onboardingPointEventId('  '), RangeError);
  assert.deepEqual(
    decideInitialOnboardingPointGrant({
      initialPointEventExists: false,
      currentKeyCount: undefined,
    }),
    {
      action: 'grant',
      amount: 3,
      balanceBefore: 0,
      balanceAfter: 3,
      source: 'onboarding_v1',
      legacyBalancePreserved: false,
    }
  );
  assert.deepEqual(
    decideInitialOnboardingPointGrant({
      initialPointEventExists: true,
      currentKeyCount: undefined,
    }),
    { action: 'none' }
  );
});

test('preserves every existing legacy balance and writes a zero-amount marker', () => {
  for (const balance of [0, 3, 25]) {
    assert.deepEqual(
      decideInitialOnboardingPointGrant({
        initialPointEventExists: false,
        currentKeyCount: balance,
      }),
      {
        action: 'write-marker',
        amount: 0,
        balanceBefore: balance,
        balanceAfter: balance,
        source: 'onboarding_legacy_balance_v1',
        legacyBalancePreserved: true,
      }
    );
  }
  assert.throws(
    () =>
      decideInitialOnboardingPointGrant({
        initialPointEventExists: false,
        currentKeyCount: -1,
      }),
    RangeError
  );
  assert.throws(
    () =>
      decideInitialOnboardingPointGrant({
        initialPointEventExists: false,
        currentKeyCount: '3',
      }),
    RangeError
  );
});

test('blocks completed users only after a fully usable profile is present', () => {
  assert.equal(onboardingCompletionBlockReason(undefined), null);
  assert.equal(onboardingCompletionBlockReason({ onboardingCompleted: false }), null);
  assert.equal(
    onboardingCompletionBlockReason(
      validProfile({ onboardingCompleted: true, birthYear: 2000, gender: 'female' }),
      referenceDate
    ),
    'already-completed'
  );
  assert.equal(
    onboardingCompletionBlockReason(
      validProfile({ onboardingCompleted: true, gender: 'unspecified' }),
      referenceDate
    ),
    null
  );
  assert.equal(
    onboardingCompletionBlockReason(
      validProfile({ onboardingCompleted: true, nationality: undefined }),
      referenceDate
    ),
    null
  );
  assert.equal(
    onboardingCompletionBlockReason(
      validProfile({ onboardingCompleted: true, learningLanguage: 'ko' }),
      referenceDate
    ),
    null
  );
  assert.equal(
    onboardingCompletionBlockReason(
      validProfile({ onboardingCompleted: true, birthYear: 2009, gender: 'male' }),
      referenceDate
    ),
    null
  );
  assert.equal(
    onboardingCompletionBlockReason(
      { onboardingCompleted: true, gender: 'male' },
      referenceDate
    ),
    null
  );
  assert.equal(onboardingCompletionBlockReason({ isBanned: true }), 'banned');
  assert.equal(
    onboardingCompletionBlockReason({ deletionRequested: true }),
    'deleted'
  );
  assert.equal(
    onboardingCompletionBlockReason({
      onboardingCompleted: true,
      isBanned: true,
    }),
    'banned'
  );
});

test('recognizes the exact adult identity remediation boundary', () => {
  assert.equal(hasValidAdultIdentity(validProfile({
    birthYear: 2008,
    birthMonth: 8,
    birthDay: 12,
    gender: 'male',
  }), referenceDate), true);
  assert.equal(hasValidAdultIdentity(validProfile({
    birthYear: 2008,
    birthMonth: 8,
    birthDay: 13,
    gender: 'male',
  }), referenceDate), false);
  assert.equal(hasValidAdultIdentity({ birthYear: 2000, gender: 'male' }, referenceDate), false);
  assert.equal(
    hasValidAdultIdentity(validProfile({ gender: 'unspecified' }), referenceDate),
    false
  );
});

test('accepts the current Flutter onboarding payload shape', () => {
  assert.deepEqual(validateOnboardingProfileInput(validProfile(), referenceDate), {
    ok: true,
  });
  assert.deepEqual(
    validateOnboardingProfileInput(
      validProfile({
        preferredGender: 'all',
        preferredNationality: 'any',
        preferredAgeMin: 18,
        preferredAgeMax: 100,
      }),
      referenceDate
    ),
    { ok: true }
  );
  assert.deepEqual(
    validateOnboardingProfileInput(
      validProfile({
        photoUrls: ['profile_media/alice/auth-1/image.jpg'],
      }),
      referenceDate,
      'alice'
    ),
    { ok: true }
  );
});

test('new onboarding writes reject legacy bearer URLs and wrong-owner paths', () => {
  const legacyUrl =
    'https://firebasestorage.googleapis.com/v0/b/hana-e2ee6.firebasestorage.app/o/profile_media%2Falice%2Fauth-1%2Fimage.jpg?alt=media&token=secret';
  assert.equal(
    validateOnboardingProfileInput(
      validProfile({ photoUrls: [legacyUrl] }),
      referenceDate,
      'alice'
    ).ok,
    false
  );
  assert.equal(
    validateOnboardingProfileInput(
      validProfile({ photoUrls: ['profile_media/bob/auth-1/image.jpg'] }),
      referenceDate,
      'alice'
    ).ok,
    false
  );
});

test('rejects server-owned field injection and missing schema fields', () => {
  assert.match(
    validateOnboardingProfileInput(
      validProfile({ keyCount: 9999 }),
      referenceDate
    ).reason,
    /Unexpected field: keyCount/
  );
  const missingQa = validProfile();
  delete missingQa.qaItems;
  assert.match(
    validateOnboardingProfileInput(missingQa, referenceDate).reason,
    /Missing required field: qaItems/
  );
});

test('rejects oversized strings, arrays, malformed QA and unsafe photo URLs', () => {
  const attacks = [
    [validProfile({ displayName: 'x'.repeat(21) }), /displayName/],
    [validProfile({ relationshipType: 'x'.repeat(51) }), /relationshipType/],
    [validProfile({ occupation: 'x'.repeat(81) }), /occupation/],
    [validProfile({ bio: 'x'.repeat(501) }), /bio/],
    [validProfile({ keywords: ['a', 'b', 'c', 'd', 'e', 'f'] }), /keywords/],
    [validProfile({ keywords: ['same', ' SAME '] }), /keywords/],
    [validProfile({ qaItems: Array(11).fill({ question: 'q', answer: 'a' }) }), /qaItems/],
    [validProfile({ qaItems: [{ question: 'q', answer: 'a', isAdmin: true }] }), /qaItems/],
    [validProfile({ qaItems: [{ question: 'q', answer: 'x'.repeat(501) }] }), /qaItems/],
    [validProfile({ photoUrls: ['javascript:alert(1)'] }), /photoUrls/],
    [validProfile({ photoUrls: Array(7).fill('https://example.com/a.jpg') }), /photoUrls/],
  ];

  for (const [payload, pattern] of attacks) {
    const result = validateOnboardingProfileInput(payload, referenceDate);
    assert.equal(result.ok, false);
    assert.match(result.reason, pattern);
  }
});

test('rejects invalid enum, year and preferred age ranges', () => {
  const attacks = [
    validProfile({ birthYear: 2027 }),
    validProfile({ birthYear: 2009 }),
    validProfile({ birthYear: 2000.5 }),
    validProfile({ birthMonth: 13 }),
    validProfile({ birthYear: 2005, birthMonth: 2, birthDay: 29 }),
    validProfile({ gender: 'unspecified' }),
    validProfile({ gender: 'admin' }),
    validProfile({ nationality: 'US' }),
    validProfile({ nativeLanguage: 'ko', learningLanguage: 'ko' }),
    validProfile({ preferredGender: 'everyone' }),
    validProfile({ preferredAgeMin: 17, preferredAgeMax: 30 }),
    validProfile({ preferredAgeMin: 50, preferredAgeMax: 20 }),
    validProfile({ preferredAgeMin: 20, preferredAgeMax: null }),
  ];

  for (const payload of attacks) {
    assert.equal(validateOnboardingProfileInput(payload, referenceDate).ok, false);
  }
});

test('accepts the 18th birthday and rejects the day before it', () => {
  assert.equal(validateOnboardingProfileInput(validProfile({
    birthYear: 2008,
    birthMonth: 8,
    birthDay: 12,
  }), referenceDate).ok, true);
  assert.equal(validateOnboardingProfileInput(validProfile({
    birthYear: 2008,
    birthMonth: 8,
    birthDay: 13,
  }), referenceDate).ok, false);
  assert.equal(validateOnboardingProfileInput(validProfile({
    birthYear: 2004,
    birthMonth: 2,
    birthDay: 29,
  }), referenceDate).ok, true);
});
