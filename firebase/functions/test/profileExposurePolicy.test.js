const assert = require('node:assert/strict');
const test = require('node:test');

const {
  hasCompletePublicProfile,
  hasValidAdultIdentity,
  isEligibleExternalProfileViewer,
  isInternalOrTestUser,
  isPublicUserProfile,
} = require('../lib/profileExposurePolicy');

const referenceDate = new Date('2026-08-12T12:00:00.000Z');

const completeProfile = {
  displayName: 'Hana',
  birthYear: 1998,
  birthMonth: 1,
  birthDay: 1,
  gender: 'female',
  nationality: 'KR',
  residingCountry: 'KR',
  nativeLanguage: 'ko',
  learningLanguage: 'ja',
  bio: '일본어를 공부하고 있어요.',
  photoUrls: ['https://example.com/photo.jpg'],
};

test('allows completed public profiles', () => {
  assert.equal(isPublicUserProfile({
    ...completeProfile,
    onboardingCompleted: true,
  }), true);
});

test('requires completed onboarding and a full adult identity for external viewing', () => {
  assert.equal(isEligibleExternalProfileViewer({
    ...completeProfile,
    onboardingCompleted: true,
  }, referenceDate), true);
  assert.equal(hasValidAdultIdentity(completeProfile, referenceDate), true);

  // reserveMediaUpload may create this active shell before onboarding. It
  // must not be able to enumerate or open another user's profile.
  assert.equal(isEligibleExternalProfileViewer({
    onboardingCompleted: false,
  }, referenceDate), false);
  assert.equal(isEligibleExternalProfileViewer({
    ...completeProfile,
    onboardingCompleted: false,
  }, referenceDate), false);

  const birthYearOnly = {
    ...completeProfile,
    onboardingCompleted: true,
  };
  delete birthYearOnly.birthMonth;
  delete birthYearOnly.birthDay;
  assert.equal(
    isEligibleExternalProfileViewer(birthYearOnly, referenceDate),
    false
  );
  assert.equal(isEligibleExternalProfileViewer({
    ...completeProfile,
    birthYear: 2008,
    birthMonth: 8,
    birthDay: 13,
    onboardingCompleted: true,
  }, referenceDate), false);
  assert.equal(isEligibleExternalProfileViewer({
    ...completeProfile,
    gender: 'unspecified',
    onboardingCompleted: true,
  }, referenceDate), false);
  assert.equal(isEligibleExternalProfileViewer({
    ...completeProfile,
    nationality: undefined,
    onboardingCompleted: true,
  }, referenceDate), false);
  assert.equal(isEligibleExternalProfileViewer({
    ...completeProfile,
    learningLanguage: 'ko',
    onboardingCompleted: true,
  }, referenceDate), false);
  assert.equal(isEligibleExternalProfileViewer({
    ...completeProfile,
    deletionRequested: true,
    onboardingCompleted: true,
  }, referenceDate), false);
});

test('does not require the legacy completion flag when exact DOB is valid', () => {
  assert.equal(hasCompletePublicProfile(completeProfile), true);
  assert.equal(isPublicUserProfile(completeProfile), true);
});

test('does not require profile photos for completed users', () => {
  assert.equal(isPublicUserProfile({
    ...completeProfile,
    onboardingCompleted: true,
    photoUrls: [],
  }), true);
});

test('keeps the onboarding bio field optional for public exposure', () => {
  assert.equal(isPublicUserProfile({
    ...completeProfile,
    bio: '',
    onboardingCompleted: true,
  }), true);
});

test('hides incomplete profiles', () => {
  assert.equal(isPublicUserProfile({
    ...completeProfile,
    onboardingCompleted: false,
    displayName: '',
  }), false);
});

test('uses the exact birthday and hides birth-year-only legacy identities', () => {
  assert.equal(isPublicUserProfile({
    ...completeProfile,
    birthYear: 2008,
    birthMonth: 8,
    birthDay: 12,
    onboardingCompleted: true,
  }, referenceDate), true);
  assert.equal(isPublicUserProfile({
    ...completeProfile,
    birthYear: 2008,
    birthMonth: 8,
    birthDay: 13,
    onboardingCompleted: true,
  }, referenceDate), false);
  const birthYearOnly = { ...completeProfile, onboardingCompleted: true };
  delete birthYearOnly.birthMonth;
  delete birthYearOnly.birthDay;
  assert.equal(isPublicUserProfile(birthYearOnly, referenceDate), false);
  assert.equal(isPublicUserProfile({
    ...completeProfile,
    gender: 'unspecified',
    onboardingCompleted: true,
  }, referenceDate), false);
  assert.equal(isPublicUserProfile({
    ...completeProfile,
    nativeLanguage: 'ko',
    learningLanguage: 'ko',
    onboardingCompleted: true,
  }, referenceDate), false);
});

test('hides banned deleted and deactivated profiles', () => {
  assert.equal(isPublicUserProfile({
    ...completeProfile,
    onboardingCompleted: true,
    isBanned: true,
  }), false);
  assert.equal(isPublicUserProfile({
    ...completeProfile,
    onboardingCompleted: true,
    isDeleted: true,
  }), false);
  assert.equal(isPublicUserProfile({
    ...completeProfile,
    onboardingCompleted: true,
    status: 'deactivated',
  }), false);
  assert.equal(isPublicUserProfile({
    ...completeProfile,
    onboardingCompleted: true,
    deletionRequested: true,
  }), false);
  assert.equal(isPublicUserProfile({
    ...completeProfile,
    onboardingCompleted: true,
    accountStatus: 'deleting',
  }), false);
  assert.equal(isPublicUserProfile({
    ...completeProfile,
    onboardingCompleted: true,
    accountStatus: 'deleted',
  }), false);
});

test('hides mock internal and promotional users from public exposure', () => {
  assert.equal(isInternalOrTestUser({ isMock: true }), true);
  assert.equal(isPublicUserProfile({
    ...completeProfile,
    onboardingCompleted: true,
    source: 'mock',
  }), false);
  assert.equal(isPublicUserProfile({
    ...completeProfile,
    onboardingCompleted: true,
    isOperator: true,
  }), false);
  assert.equal(isPublicUserProfile({
    ...completeProfile,
    onboardingCompleted: true,
    hiddenFromDiscovery: true,
  }), false);
  assert.equal(isPublicUserProfile({
    ...completeProfile,
    onboardingCompleted: true,
    source: 'promotion',
  }), false);
});
