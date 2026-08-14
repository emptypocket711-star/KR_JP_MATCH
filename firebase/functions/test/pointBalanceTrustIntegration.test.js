const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = readFileSync(
  path.join(__dirname, '..', 'src', 'index.ts'),
  'utf8'
);

function section(start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('point paths never coerce a missing keyCount to zero or use blind increments', () => {
  assert.doesNotMatch(source, /keyCount as number\)\s*\?\?\s*0/);
  assert.doesNotMatch(
    source,
    /keyCount:\s*admin\.firestore\.FieldValue\.increment/
  );
});

test('store grants and idempotent returns enforce the point trust boundary', () => {
  const apple = section(
    'async function verifyAndGrantAppleStorePointPurchase(',
    'async function verifyAndGrantGooglePlayPointPurchase('
  );
  assert.match(apple, /pointBalanceForServerGrant\(userData\)/);
  assert.match(apple, /requireTrustedPointBalance\(userData\)/);
  assert.match(apple, /pointBalanceTrustVersion/);

  const google = section(
    'async function verifyAndGrantGooglePlayPointPurchase(',
    '/**\n * Requires verified App Check'
  );
  assert.match(google, /pointBalanceForServerGrant\(freshUserData\)/);
  assert.match(google, /requireTrustedPointBalance\(freshUserData\)/);
  assert.match(google, /requireTrustedPointBalance\(currentUser\.data\(\)\)/);
  assert.match(google, /pointBalanceTrustVersion/);
});

test('retained media endpoints create the same consumed onboarding provenance', () => {
  const reserveMedia = section(
    'async function reserveMediaUploadForProtocol(',
    '/**\n * Legacy protocol V1 reservation'
  );
  assert.match(
    reserveMedia,
    /const isProfileUpload = request\.kind === 'profile'/
  );
  assert.match(
    reserveMedia,
    /\.\.\.\(isProfileUpload[\s\S]*onboardingShellProvenance:\s*profileUploadOnboardingShellProvenance/
  );

  const onboarding = section(
    'export const completeOnboarding =',
    'export const updateMyProfile ='
  );
  assert.match(onboarding, /userExists:\s*userSnap\.exists/);
  assert.match(onboarding, /userData,/);
  assert.doesNotMatch(onboarding, /onboardingPointEventExplainsBalance/);
  assert.match(
    onboarding,
    /profileUpdate\.onboardingShellProvenance\s*=\s*admin\.firestore\.FieldValue\.delete\(\)/
  );
  assert.match(onboarding, /tx\.create\(initialPointEventRef/);
  assert.match(onboarding, /pointBalanceTrustVersion/);
});

test('lounge establishes trust only with its server grant event', () => {
  const lounge = section(
    'export const createLoungePost =',
    'export const getLoungePost ='
  );
  assert.match(lounge, /pointBalanceForServerGrant/);
  assert.match(lounge, /requireTrustedPointBalance/);
  assert.match(lounge, /pointBalanceTrustVersion/);
});

test('chat and call create/retry paths require trusted balances before use', () => {
  const startChat = section('export const startChat =', 'export const startCall =');
  assert.match(startChat, /requireTrustedPointBalance\(freshUserData\)/);
  assert.match(startChat, /pointBalanceAfterConsume\(currentPoints, 1\)/);

  const startCall = section('export const startCall =', 'export const acceptCall =');
  assert.match(startCall, /requireTrustedPointBalance\(userSnap\.data\(\)\)/);

  const acceptCall = section('export const acceptCall =', 'export const declineCall =');
  assert.match(acceptCall, /requireTrustedPointBalance/);
  assert.match(acceptCall, /pointBalanceAfterConsume/);

  const extendCall = section('export const extendCall =', 'export const submitRating =');
  assert.match(
    extendCall,
    /requireTrustedPointBalance\(\s*entitlement\.requesterAccountSnap\.data\(\)\s*\)/
  );
  assert.match(extendCall, /decideCallExtension/);
  assert.match(extendCall, /keyCount:\s*decision\.nextBalance/);
});
