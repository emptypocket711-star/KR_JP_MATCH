const assert = require('node:assert/strict');
const test = require('node:test');

const {
  callEntitlementIssue,
  callExtensionOperationId,
  callExtensionRequestIdMaxLength,
  callExtensionRequestIdMinLength,
  callNotificationTtlSafetyMillis,
  callRingingTtlSeconds,
  callTokenExpirySafetySeconds,
  callTokenMaxLeaseSeconds,
  callTokenLifetimeSeconds,
  canNotifyIncomingCall,
  decideActiveCallReplacement,
  decideCallExtension,
  decideCallExtensionReplay,
  incomingCallNotificationTtlMillis,
  normalizeCallExtensionRequestId,
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
    ringingExpiresAtMillis: null,
    paidUntilAtMillis: nowMillis + 60_000,
    callerActive: true,
    calleeActive: true,
    matchExists: true,
    matchActive: true,
    matchParticipantUids: ['bob', 'alice'],
    matchPairKey: 'alice_bob',
    matchDirectRoomVersion: 1,
    matchHiddenFor: [],
    pairExists: true,
    pairId: 'alice_bob',
    pairPairKey: 'alice_bob',
    pairActiveMatchId: 'match-1',
    pairParticipantUids: ['bob', 'alice'],
    pairClosedMatchId: undefined,
    pairClosedReason: undefined,
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
    { pairParticipantUids: ['alice', 'mallory'] },
    { callerBlockedCallee: true },
    { calleeBlockedCaller: true },
  ]) {
    assert.equal(callEntitlementIssue(entitlement(overrides)), 'unavailable');
  }
});

test('requires the exact canonical current-room pointer without closure residue', () => {
  for (const overrides of [
    { matchPairKey: undefined },
    { matchPairKey: 'alice_mallory' },
    { pairId: 'alice_mallory' },
    { pairPairKey: undefined },
    { pairPairKey: 'alice_mallory' },
    { pairActiveMatchId: 'replacement-match' },
    { pairClosedMatchId: 'historical-match' },
    { pairClosedMatchId: null },
    { pairClosedReason: 'left_chat' },
    { pairClosedReason: null },
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
    ringingExpiresAtMillis: 2_060_000,
    paidUntilAtMillis: null,
  });
  delete ringing.allowedStatuses;
  delete ringing.requirePaidEntitlement;
  assert.equal(canNotifyIncomingCall(ringing), true);
  assert.equal(canNotifyIncomingCall({ ...ringing, matchActive: false }), false);
  assert.equal(canNotifyIncomingCall({ ...ringing, calleeActive: false }), false);
  assert.equal(canNotifyIncomingCall({ ...ringing, callerBlockedCallee: true }), false);
  assert.equal(canNotifyIncomingCall({ ...ringing, calleeBlockedCaller: true }), false);
  assert.equal(canNotifyIncomingCall({ ...ringing, activeCallId: 'new-call' }), false);
  assert.equal(canNotifyIncomingCall({
    ...ringing,
    ringingExpiresAtMillis: 2_000_000,
  }), false);
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

test('token lease is renewable and never exceeds sixty seconds', () => {
  const nowMillis = 100_000;
  assert.equal(callTokenLifetimeSeconds({
    nowMillis,
    paidUntilAtMillis: nowMillis + 10 * 60 * 1000,
  }), callTokenMaxLeaseSeconds);
  assert.equal(callTokenMaxLeaseSeconds, 60);
  assert.equal(callRingingTtlSeconds, 60);
});

test('incoming push TTL stays conservatively inside the ringing boundary', () => {
  const nowMillis = 100_000;
  const ringingExpiresAtMillis = nowMillis + callRingingTtlSeconds * 1000;
  assert.equal(incomingCallNotificationTtlMillis({
    nowMillis,
    ringingExpiresAtMillis,
  }), callRingingTtlSeconds * 1000 - callNotificationTtlSafetyMillis);
  assert.equal(incomingCallNotificationTtlMillis({
    nowMillis,
    ringingExpiresAtMillis: nowMillis + callNotificationTtlSafetyMillis,
  }), null);
  assert.equal(incomingCallNotificationTtlMillis({
    nowMillis,
    ringingExpiresAtMillis: Infinity,
  }), null);
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

test('active-call replacement rejects live calls and closes exact stale calls', () => {
  const nowMillis = 5_000_000;
  const base = {
    pointerExists: true,
    callExists: true,
    callBelongsToRoom: true,
    status: 'ringing',
    ringingExpiresAtMillis: nowMillis + 1,
    paidUntilAtMillis: null,
    nowMillis,
  };
  assert.equal(decideActiveCallReplacement(base), 'busy');
  assert.equal(decideActiveCallReplacement({
    ...base,
    ringingExpiresAtMillis: nowMillis,
  }), 'close-stale-ringing');
  assert.equal(decideActiveCallReplacement({
    ...base,
    ringingExpiresAtMillis: null,
  }), 'close-stale-ringing');
  assert.equal(decideActiveCallReplacement({
    ...base,
    status: 'accepted',
    paidUntilAtMillis: nowMillis + 1,
  }), 'busy');
  assert.equal(decideActiveCallReplacement({
    ...base,
    status: 'accepted',
    paidUntilAtMillis: nowMillis,
  }), 'close-expired-accepted');
  assert.equal(decideActiveCallReplacement({
    ...base,
    callBelongsToRoom: false,
  }), 'replace-pointer');
  assert.equal(decideActiveCallReplacement({
    ...base,
    callExists: false,
  }), 'replace-pointer');
  assert.equal(decideActiveCallReplacement({
    ...base,
    status: 'ended',
  }), 'replace-pointer');
});

test('extension request IDs use a strict bounded transport-safe shape', () => {
  const minimum = 'a'.repeat(callExtensionRequestIdMinLength);
  const maximum = 'Z'.repeat(callExtensionRequestIdMaxLength);
  assert.equal(normalizeCallExtensionRequestId(minimum), minimum);
  assert.equal(normalizeCallExtensionRequestId(maximum), maximum);
  for (const value of [
    null,
    123,
    '',
    'a'.repeat(callExtensionRequestIdMinLength - 1),
    'a'.repeat(callExtensionRequestIdMaxLength + 1),
    'request id with spaces',
    'request/id/with/slashes',
    'request.id.with.dots',
  ]) {
    assert.equal(normalizeCallExtensionRequestId(value), null);
  }
});

test('extension operation IDs are deterministic and caller scoped', () => {
  const base = {
    callId: 'call-1',
    uid: 'alice',
    clientRequestId: 'request_12345678',
  };
  const first = callExtensionOperationId(base);
  assert.equal(first, callExtensionOperationId(base));
  assert.match(first, /^call_extension_[a-f0-9]{64}$/);
  assert.notEqual(first, callExtensionOperationId({ ...base, uid: 'bob' }));
  assert.notEqual(first, callExtensionOperationId({
    ...base,
    clientRequestId: 'request_87654321',
  }));
});

function replayFixture(overrides = {}) {
  const operationId = callExtensionOperationId({
    callId: 'call-1',
    uid: 'alice',
    clientRequestId: 'request_12345678',
  });
  return {
    operationExists: true,
    operation: {
      operationId,
      callId: 'call-1',
      uid: 'alice',
      clientRequestId: 'request_12345678',
      matchId: 'match-1',
      callType: 'voice',
      roomName: 'hana_call-1',
      paidUntilAtMillis: 9_000_000,
      chargedPoints: voiceExtensionPoints,
      keyCount: 4,
      pointEventId: operationId,
      status: 'committed',
    },
    eventExists: true,
    event: {
      uid: 'alice',
      callId: 'call-1',
      matchId: 'match-1',
      eventType: 'consume',
      source: 'extendCall',
      reason: 'voice_call_extension',
      amount: voiceExtensionPoints,
      balanceBefore: 5,
      balanceAfter: 4,
      clientRequestId: 'request_12345678',
    },
    expected: {
      operationId,
      callId: 'call-1',
      uid: 'alice',
      clientRequestId: 'request_12345678',
      matchId: 'match-1',
      callType: 'voice',
      roomName: 'hana_call-1',
    },
    ...overrides,
  };
}

test('lost-response extension retry returns the exact committed accounting result', () => {
  assert.deepEqual(decideCallExtensionReplay(replayFixture()), {
    action: 'replay',
    paidUntilAtMillis: 9_000_000,
    chargedPoints: voiceExtensionPoints,
    keyCount: 4,
  });
});

test('same-request transaction loser replays the winner without a second charge', () => {
  const absent = replayFixture({
    operationExists: false,
    operation: undefined,
    eventExists: false,
    event: undefined,
  });
  assert.deepEqual(decideCallExtensionReplay(absent), { action: 'new' });

  const winnerResult = decideCallExtensionReplay(replayFixture());
  const retriedLoserResult = decideCallExtensionReplay(replayFixture());
  assert.deepEqual(retriedLoserResult, winnerResult);
  assert.equal(retriedLoserResult.action, 'replay');
});

test('video replay requires the exact three-point video ledger shape', () => {
  const fixture = replayFixture();
  fixture.operation.callType = 'video';
  fixture.operation.chargedPoints = videoSegmentPoints;
  fixture.operation.keyCount = 2;
  fixture.event.reason = 'video_call_extension';
  fixture.event.amount = videoSegmentPoints;
  fixture.event.balanceBefore = 5;
  fixture.event.balanceAfter = 2;
  fixture.expected.callType = 'video';
  assert.deepEqual(decideCallExtensionReplay(fixture), {
    action: 'replay',
    paidUntilAtMillis: 9_000_000,
    chargedPoints: videoSegmentPoints,
    keyCount: 2,
  });
});

test('extension replay fails closed on an orphan or tampered operation/event pair', () => {
  assert.deepEqual(decideCallExtensionReplay(replayFixture({
    operationExists: false,
    operation: undefined,
    eventExists: false,
    event: undefined,
  })), { action: 'new' });
  assert.deepEqual(decideCallExtensionReplay(replayFixture({
    operationExists: false,
    operation: undefined,
  })), { action: 'inconsistent' });
  assert.deepEqual(decideCallExtensionReplay(replayFixture({
    eventExists: false,
    event: undefined,
  })), { action: 'inconsistent' });

  const tampered = replayFixture();
  tampered.event.amount = 99;
  assert.deepEqual(decideCallExtensionReplay(tampered), {
    action: 'inconsistent',
  });
  const wrongCaller = replayFixture();
  wrongCaller.operation.uid = 'mallory';
  assert.deepEqual(decideCallExtensionReplay(wrongCaller), {
    action: 'inconsistent',
  });
  for (const mutate of [
    (fixture) => { fixture.operation.operationId = 'other-operation'; },
    (fixture) => { fixture.operation.paidUntilAtMillis = -1; },
    (fixture) => { fixture.event.reason = 'video_call_extension'; },
    (fixture) => { fixture.event.balanceBefore = 999; },
  ]) {
    const fixture = replayFixture();
    mutate(fixture);
    assert.deepEqual(decideCallExtensionReplay(fixture), {
      action: 'inconsistent',
    });
  }
});
