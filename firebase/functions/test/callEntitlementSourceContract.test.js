const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'index.ts'),
  'utf8'
);

function between(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test('RTC token builder derives both expirations from the paid boundary', () => {
  const helper = between(
    'function buildAgoraRtcToken',
    'interface ValidatedCallEntitlement'
  );
  assert.match(helper, /paidUntilAtMillis:\s*params\.paidUntilAtMillis/);
  assert.match(helper, /if \(lifetimeSeconds == null\)/);
  assert.match(
    helper,
    /RtcRole\.PUBLISHER,\s*lifetimeSeconds,\s*lifetimeSeconds/
  );
  assert.doesNotMatch(helper, /CALL_TOKEN_TTL_SECONDS/);
});

test('shared entitlement loader reads every mutable authorization edge', () => {
  const helper = between(
    'async function requireCallEntitlement',
    'async function notifyIncomingCall'
  );
  for (const requiredRead of [
    "collection('users').doc(callerUid)",
    "collection('users').doc(calleeUid)",
    "collection('matches').doc(matchId)",
    "collection('chatPairs').doc(pairKey)",
    "collection('activeCalls').doc(matchId)",
    "collection('blocks').doc(calleeUid)",
    "collection('blocks').doc(callerUid)",
  ]) {
    assert.ok(helper.includes(requiredRead), `missing ${requiredRead}`);
  }
  assert.match(helper, /callEntitlementIssue\(/);
  assert.match(helper, /throw callClosedError\(\)/);
  assert.match(helper, /throw callUnavailableError\(\)/);
});

test('incoming-call push revalidates the ringing entitlement immediately first', () => {
  const notifier = between(
    'async function notifyIncomingCall',
    'async function notifyNewDirectChat'
  );
  assert.match(notifier, /requireCallEntitlement\(tx/);
  assert.match(notifier, /allowedStatuses:\s*\['ringing'\]/);
  assert.match(notifier, /requirePaidEntitlement:\s*false/);
  assert.ok(
    notifier.indexOf('requireCallEntitlement') <
      notifier.indexOf('admin.messaging().send'),
    'authorization must happen before FCM send'
  );
});

test('startCall never grants RTC privileges before acceptance and payment', () => {
  const callable = between(
    'export const startCall',
    'export const acceptCall'
  );
  assert.doesNotMatch(callable, /buildAgoraRtcToken\(/);
  assert.match(callable, /token:\s*''/);
  assert.match(callable, /tokenExpiresAt:\s*null/);
  assert.match(callable, /directRoomVersion !== 1/);
  assert.match(callable, /pairSnap\.data\(\)\?\.activeMatchId !== matchId/);
  assert.match(callable, /callerUid:\s*uid/);
  assert.doesNotMatch(callable, /blocked each other/i);
});

test('acceptCall validates graph and builds the token before charging', () => {
  const callable = between(
    'export const acceptCall',
    'export const refreshCallToken'
  );
  assert.match(callable, /requireCallEntitlement\(tx/);
  assert.match(callable, /allowedStatuses:\s*\['ringing', 'accepted'\]/);
  assert.match(callable, /if \(uid !== entitlement\.calleeUid\)/);
  assert.ok(
    callable.indexOf('const token = buildAgoraRtcToken') <
      callable.indexOf('tx.update(entitlement.callerRef'),
    'token construction failure must abort before the charge write'
  );
});

test('refreshCallToken validates an accepted paid call without extending it', () => {
  const callable = between(
    'export const refreshCallToken',
    'export const declineCall'
  );
  assert.match(callable, /allowedStatuses:\s*\['accepted'\]/);
  assert.match(callable, /requirePaidEntitlement:\s*true/);
  assert.match(callable, /buildAgoraRtcToken\(/);
  assert.doesNotMatch(callable, /FieldValue\.increment/);
  assert.doesNotMatch(callable, /paidUntilAt:\s*next/);
});

test('extendCall revalidates, charges, extends, and returns one renewed token atomically', () => {
  const callable = between(
    'export const extendCall',
    '/**\n * submitRating'
  );
  assert.match(callable, /requireCallEntitlement\(tx/);
  assert.match(callable, /requirePaidEntitlement:\s*true/);
  assert.match(callable, /decideCallExtension\(/);
  assert.match(callable, /buildAgoraRtcToken\(/);
  assert.match(callable, /tx\.update\(entitlement\.requesterRef/);
  assert.match(callable, /tx\.update\(callRef/);
  assert.match(callable, /token:\s*result\.token\.token/);
  assert.doesNotMatch(callable, /Math\.max\(/);
  assert.doesNotMatch(callable, /blocked each other/i);
});
