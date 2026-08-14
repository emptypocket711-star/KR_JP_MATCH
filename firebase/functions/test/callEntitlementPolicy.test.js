const assert = require('node:assert/strict');
const test = require('node:test');

const {
  callEntitlementIssue,
  callTokenExpirySafetySeconds,
  callTokenLifetimeSeconds,
  canNotifyIncomingCall,
  decideCallExtension,
  videoSegmentPoints,
  videoSegmentSeconds,
  voiceExtensionPoints,
  voiceExtensionSeconds,
} = require('../lib/callEntitlementPolicy');

function entitlement(overrides = {}) {
  const nowMillis = 2_000_000;
  return {
    callExists: true,
    callId: 'call-1',
    requesterUid: 'alice',
    callerUid: 'alice',
    calleeUid: 'bob',
    participantUids: ['alice', 'bob'],
    callMatchId: 'match-1',
    callType: 'voice',
    roomName: 'hana_call-1',
    callStatus: 'accepted',
    paidUntilAtMillis: nowMillis + 60_000,
    callerActive: true,
    calleeActive: true,
    matchExists: true,
    matchActive: true,
    matchParticipantUids: ['bob', 'alice'],
    matchDirectRoomVersion: 1,
    matchHiddenFor: [],
    pairExists: true,
    pairActiveMatchId: 'match-1',
    pairParticipantUids: ['bob', 'alice'],
    callerBlockedCallee: false,
    calleeBlockedCaller: false,
    activeCallExists: true,
    activeCallId: 'call-1',
    activeCallMatchId: 'match-1',
    activeCallParticipantUids: ['alice', 'bob'],
    activeCallStatus: 'accepted',
    allowedStatuses: ['accepted'],
    requirePaidEntitlement: true,
    nowMillis,
    ...overrides,
  };
}

test('accepts only a complete active paid direct-call entitlement', () => {
  assert.equal(callEntitlementIssue(entitlement()), null);
  assert.equal(callEntitlementIssue(entitlement({ requesterUid: 'bob' })), null);
});

test('rejects malformed or forged call participants without disclosing detail', () => {
  for (const overrides of [
    { callExists: false },
    { requesterUid: 'mallory' },
    { callerUid: 'bob' },
    { calleeUid: 'alice' },
    { participantUids: ['alice'] },
    { participantUids: ['alice', 'alice'] },
    { participantUids: ['alice', 'mallory'] },
    { callMatchId: '' },
    { callType: 'screen-share' },
    { roomName: '' },
  ]) {
    assert.equal(callEntitlementIssue(entitlement(overrides)), 'unavailable');
  }
});

test('rejects stale call state and active pointer as closed', () => {
  for (const overrides of [
    { callStatus: 'ended' },
    { activeCallExists: false },
    { activeCallId: 'replacement-call' },
    { activeCallMatchId: 'other-match' },
    { activeCallParticipantUids: ['alice', 'mallory'] },
    { activeCallStatus: 'ringing' },
  ]) {
    assert.equal(callEntitlementIssue(entitlement(overrides)), 'closed');
  }
});

test('rejects hidden, legacy, inactive, unavailable, or blocked room graphs generically', () => {
  for (const overrides of [
    { callerActive: false },
    { calleeActive: false },
    { matchExists: false },
    { matchActive: false },
    { matchParticipantUids: ['alice', 'mallory'] },
    { matchDirectRoomVersion: undefined },
    { matchHiddenFor: undefined },
    { matchHiddenFor: ['alice'] },
    { matchHiddenFor: ['bob'] },
    { pairExists: false },
    { pairActiveMatchId: 'replacement-match' },
    { pairParticipantUids: ['alice', 'mallory'] },
    { callerBlockedCallee: true },
    { calleeBlockedCaller: true },
  ]) {
    assert.equal(callEntitlementIssue(entitlement(overrides)), 'unavailable');
  }
});

test('rejects missing, expired, and boundary-equal paid entitlements as closed', () => {
  for (const paidUntilAtMillis of [null, NaN, Infinity, 1_999_999, 2_000_000]) {
    assert.equal(
      callEntitlementIssue(entitlement({ paidUntilAtMillis })),
      'closed'
    );
  }
});

test('ringing notification uses the same graph but does not require payment', () => {
  const ringing = entitlement({
    callStatus: 'ringing',
    activeCallStatus: 'ringing',
    paidUntilAtMillis: null,
  });
  delete ringing.allowedStatuses;
  delete ringing.requirePaidEntitlement;
  delete ringing.nowMillis;
  assert.equal(canNotifyIncomingCall(ringing), true);
  assert.equal(canNotifyIncomingCall({ ...ringing, matchActive: false }), false);
  assert.equal(canNotifyIncomingCall({ ...ringing, calleeActive: false }), false);
  assert.equal(canNotifyIncomingCall({ ...ringing, callerBlockedCallee: true }), false);
  assert.equal(canNotifyIncomingCall({ ...ringing, calleeBlockedCaller: true }), false);
  assert.equal(canNotifyIncomingCall({ ...ringing, activeCallId: 'new-call' }), false);
});

test('token lifetime is conservatively bounded by the paid segment', () => {
  const nowMillis = 10_100;
  const paidUntilAtMillis = 70_999;
  const lifetime = callTokenLifetimeSeconds({ nowMillis, paidUntilAtMillis });
  assert.equal(
    lifetime,
    Math.floor((paidUntilAtMillis - nowMillis) / 1000) -
      callTokenExpirySafetySeconds
  );
  const reportedExpirySeconds = Math.floor(nowMillis / 1000) + lifetime;
  assert.ok(reportedExpirySeconds < Math.floor(paidUntilAtMillis / 1000));
});

test('token lifetime fails closed at or inside the clock safety boundary', () => {
  const nowMillis = 50_000;
  for (const paidUntilAtMillis of [
    null,
    NaN,
    Infinity,
    nowMillis,
    nowMillis + callTokenExpirySafetySeconds * 1000,
    nowMillis + callTokenExpirySafetySeconds * 1000 + 999,
  ]) {
    assert.equal(
      callTokenLifetimeSeconds({ nowMillis, paidUntilAtMillis }),
      null
    );
  }
});

test('voice and video extensions pair one exact charge with one exact segment', () => {
  const nowMillis = 1_000_000;
  const paidUntilAtMillis = nowMillis + 30_000;
  assert.deepEqual(decideCallExtension({
    callType: 'voice',
    currentBalance: 5,
    paidUntilAtMillis,
    nowMillis,
  }), {
    action: 'extend',
    chargePoints: voiceExtensionPoints,
    nextBalance: 5 - voiceExtensionPoints,
    nextPaidUntilAtMillis: paidUntilAtMillis + voiceExtensionSeconds * 1000,
    segmentSeconds: voiceExtensionSeconds,
  });
  assert.deepEqual(decideCallExtension({
    callType: 'video',
    currentBalance: 5,
    paidUntilAtMillis,
    nowMillis,
  }), {
    action: 'extend',
    chargePoints: videoSegmentPoints,
    nextBalance: 5 - videoSegmentPoints,
    nextPaidUntilAtMillis: paidUntilAtMillis + videoSegmentSeconds * 1000,
    segmentSeconds: videoSegmentSeconds,
  });
});

test('expired calls cannot be revived and malformed balances cannot be charged', () => {
  const nowMillis = 1_000_000;
  for (const currentBalance of [NaN, Infinity, -1, 1.5, '5']) {
    assert.deepEqual(decideCallExtension({
      callType: 'voice',
      currentBalance,
      paidUntilAtMillis: nowMillis + 60_000,
      nowMillis,
    }), { action: 'closed' });
  }
  assert.deepEqual(decideCallExtension({
    callType: 'voice',
    currentBalance: 5,
    paidUntilAtMillis: nowMillis,
    nowMillis,
  }), { action: 'closed' });
  assert.deepEqual(decideCallExtension({
    callType: 'video',
    currentBalance: videoSegmentPoints - 1,
    paidUntilAtMillis: nowMillis + 60_000,
    nowMillis,
  }), { action: 'insufficient-points' });
});

test('serialized concurrent extensions cannot add time without the paired charge', () => {
  const nowMillis = 5_000_000;
  const initialPaidUntil = nowMillis + 60_000;
  const first = decideCallExtension({
    callType: 'voice',
    currentBalance: 2,
    paidUntilAtMillis: initialPaidUntil,
    nowMillis,
  });
  assert.equal(first.action, 'extend');
  const second = decideCallExtension({
    callType: 'voice',
    currentBalance: first.nextBalance,
    paidUntilAtMillis: first.nextPaidUntilAtMillis,
    nowMillis,
  });
  assert.equal(second.action, 'extend');
  assert.equal(second.nextBalance, 0);
  assert.equal(
    second.nextPaidUntilAtMillis,
    initialPaidUntil + 2 * voiceExtensionSeconds * 1000
  );

  const deniedThird = decideCallExtension({
    callType: 'voice',
    currentBalance: second.nextBalance,
    paidUntilAtMillis: second.nextPaidUntilAtMillis,
    nowMillis,
  });
  assert.deepEqual(deniedThird, { action: 'insufficient-points' });
});
