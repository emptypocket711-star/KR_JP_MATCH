const test = require('node:test');
const assert = require('node:assert/strict');

const {
  chatMediaReadIssue,
  profileMediaReadIssue,
} = require('../lib/privateMediaReadPolicy');

const activeProfile = {
  displayName: 'Hana',
  birthYear: 1995,
  birthMonth: 5,
  birthDay: 15,
  gender: 'male',
  nationality: 'KR',
  residingCountry: 'KR',
  nativeLanguage: 'ko',
  learningLanguage: 'ja',
  bio: '',
  onboardingCompleted: true,
  profileMediaVisibilityVersion: 1,
};

const profilePath = 'profile_media/owner/auth/image.jpg';

function profileInput(overrides = {}) {
  return {
    viewerUid: 'viewer',
    ownerUid: 'owner',
    objectPath: profilePath,
    viewerExists: true,
    viewerData: activeProfile,
    ownerExists: true,
    ownerData: { ...activeProfile, photoUrls: [profilePath] },
    ownerPreviewAuthorized: false,
    viewerBlockedOwner: false,
    ownerBlockedViewer: false,
    referenceDate: new Date('2026-08-14T00:00:00.000Z'),
    ...overrides,
  };
}

test('profile media permits an active viewer for the current public path', () => {
  assert.equal(profileMediaReadIssue(profileInput()), null);
});

test('profile media permits an active owner without public exposure', () => {
  assert.equal(profileMediaReadIssue(profileInput({
    viewerUid: 'owner',
    ownerPreviewAuthorized: true,
    viewerData: { onboardingCompleted: false },
    ownerData: {
      onboardingCompleted: false,
    },
  })), null);
});

test('profile media denies an onboarding shell from reading another profile', () => {
  assert.equal(profileMediaReadIssue(profileInput({
    viewerData: { onboardingCompleted: false },
  })), 'viewer-ineligible');
  assert.equal(profileMediaReadIssue(profileInput({
    viewerData: {
      ...activeProfile,
      onboardingCompleted: false,
    },
  })), 'viewer-ineligible');
  assert.equal(profileMediaReadIssue(profileInput({
    viewerData: {
      ...activeProfile,
      birthMonth: undefined,
      birthDay: undefined,
    },
  })), 'viewer-ineligible');
  assert.equal(profileMediaReadIssue(profileInput({
    viewerData: { onboardingCompleted: false },
    ownerData: { ...activeProfile, photoUrls: [] },
  })), 'viewer-ineligible');
});

test('profile media denies removed paths, unavailable accounts, blocks, and hidden owners', () => {
  assert.equal(profileMediaReadIssue(profileInput({
    ownerData: { ...activeProfile, photoUrls: [] },
  })), 'profile-reference-missing');
  assert.equal(profileMediaReadIssue(profileInput({
    viewerData: { ...activeProfile, deletionRequested: true },
  })), 'viewer-unavailable');
  assert.equal(profileMediaReadIssue(profileInput({
    ownerData: { ...activeProfile, photoUrls: [profilePath], isBanned: true },
  })), 'owner-unavailable');
  assert.equal(profileMediaReadIssue(profileInput({
    viewerBlockedOwner: true,
  })), 'blocked');
  assert.equal(profileMediaReadIssue(profileInput({
    ownerData: {
      ...activeProfile,
      photoUrls: [profilePath],
      hiddenFromDiscovery: true,
    },
  })), 'owner-not-public');
});

function chatInput(overrides = {}) {
  return {
    viewerUid: 'alice',
    uploaderUid: 'bob',
    viewerExists: true,
    viewerData: activeProfile,
    firstParticipantExists: true,
    firstParticipantData: activeProfile,
    secondParticipantExists: true,
    secondParticipantData: activeProfile,
    viewerBlockedOther: false,
    otherBlockedViewer: false,
    matchExists: true,
    matchData: {
      userIds: ['alice', 'bob'],
      directRoomVersion: 1,
      isActive: true,
      hiddenFor: [],
    },
    messageReferenceExists: true,
    ...overrides,
  };
}

test('chat media permits only an active exact direct room participant', () => {
  assert.equal(chatMediaReadIssue(chatInput()), null);
});

test('chat media denies malformed, inactive, hidden, blocked, or unavailable rooms', () => {
  assert.equal(chatMediaReadIssue(chatInput({
    viewerData: { onboardingCompleted: false },
  })), 'viewer-ineligible');
  assert.equal(chatMediaReadIssue(chatInput({
    matchData: { userIds: ['alice', 'bob', 'mallory'], isActive: true },
  })), 'invalid-direct-room');
  assert.equal(chatMediaReadIssue(chatInput({
    matchData: { userIds: ['alice', 'bob'], directRoomVersion: 1, isActive: false, hiddenFor: [] },
  })), 'inactive-room');
  assert.equal(chatMediaReadIssue(chatInput({
    matchData: { userIds: ['alice', 'bob'], directRoomVersion: 1, isActive: true, hiddenFor: ['alice'] },
  })), 'hidden-room');
  assert.equal(chatMediaReadIssue(chatInput({ otherBlockedViewer: true })), 'blocked');
  assert.equal(chatMediaReadIssue(chatInput({ messageReferenceExists: false })), 'profile-reference-missing');
  assert.equal(chatMediaReadIssue(chatInput({
    secondParticipantData: { ...activeProfile, accountStatus: 'deleting' },
  })), 'owner-unavailable');
});
