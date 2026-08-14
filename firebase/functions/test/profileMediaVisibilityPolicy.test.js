const assert = require('node:assert/strict');
const test = require('node:test');

const {
  profileMediaVisibilityDecision,
  profileMediaVisibilityVersion,
} = require('../lib/profileMediaVisibilityPolicy');

const referenceDate = new Date('2026-08-13T00:00:00.000Z');

function eligible(overrides = {}) {
  return {
    onboardingCompleted: true,
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
    ...overrides,
  };
}

test('attests only a fully public adult profile', () => {
  assert.equal(profileMediaVisibilityVersion, 1);
  assert.equal(profileMediaVisibilityDecision(eligible(), referenceDate), 'set');
  assert.equal(
    profileMediaVisibilityDecision(
      eligible({ profileMediaVisibilityVersion: 1 }),
      referenceDate
    ),
    'none'
  );
  assert.equal(
    profileMediaVisibilityDecision(eligible({ birthYear: 2010 }), referenceDate),
    'none'
  );
  assert.equal(
    profileMediaVisibilityDecision(
      eligible({ hiddenFromDiscovery: true }),
      referenceDate
    ),
    'none'
  );
});

test('clears a stale attestation from an unavailable profile', () => {
  assert.equal(
    profileMediaVisibilityDecision(
      eligible({ isBanned: true, profileMediaVisibilityVersion: 1 }),
      referenceDate
    ),
    'clear'
  );
  assert.equal(
    profileMediaVisibilityDecision(
      eligible({ deletionRequested: true, profileMediaVisibilityVersion: 1 }),
      referenceDate
    ),
    'clear'
  );
});
