const test = require('node:test');
const assert = require('node:assert/strict');

const {
  nextPrivateMediaReadByteQuota,
  nextPrivateMediaReadQuota,
  nextPrivateMediaReadRequestAttemptQuota,
  privateMediaReadDailyByteLimit,
  privateMediaReadDailyRequestLimit,
  privateMediaReadMinuteLimit,
  privateMediaReadQuotaKeys,
} = require('../lib/privateMediaReadQuotaPolicy');

function mergeQuotaUpdate(current, update) {
  return { ...current, ...update };
}

test('creates deterministic UTC day and minute quota keys', () => {
  const keys = privateMediaReadQuotaKeys(new Date('2026-08-14T03:04:05Z'));
  assert.deepEqual(keys, {
    dayKey: '2026-08-14',
    minuteKey: '2026-08-14T03:04',
  });
});

test('charges each pre-access attempt and allows exactly 60 per minute', () => {
  const dayKey = '2026-08-14';
  const minuteKey = '2026-08-14T03:04';
  const current = {
    dayKey,
    dailyBytes: 1234,
    dailyRequests: 4,
    minuteKey,
    minuteRequests: privateMediaReadMinuteLimit - 1,
  };

  const sixtieth = nextPrivateMediaReadRequestAttemptQuota({
    current,
    dayKey,
    minuteKey,
  });
  assert.deepEqual(sixtieth, {
    dayKey,
    dailyRequests: 5,
    minuteKey,
    minuteRequests: privateMediaReadMinuteLimit,
  });
  assert.deepEqual(current, {
    dayKey: '2026-08-14',
    dailyBytes: 1234,
    dailyRequests: 4,
    minuteKey,
    minuteRequests: privateMediaReadMinuteLimit - 1,
  });
  assert.equal(
    nextPrivateMediaReadRequestAttemptQuota({
      current: mergeQuotaUpdate(current, sixtieth),
      dayKey,
      minuteKey,
    }),
    null,
  );

  const nextMinuteKey = '2026-08-14T03:05';
  assert.deepEqual(
    nextPrivateMediaReadRequestAttemptQuota({
      current: mergeQuotaUpdate(current, sixtieth),
      dayKey,
      minuteKey: nextMinuteKey,
    }),
    { dayKey, dailyRequests: 6, minuteKey: nextMinuteKey, minuteRequests: 1 },
  );
});

test('allows exactly 2000 attempts per UTC day across minute windows', () => {
  const dayKey = '2026-08-14';
  const minuteKey = '2026-08-14T23:59';
  const current = {
    dayKey,
    dailyRequests: privateMediaReadDailyRequestLimit - 1,
    minuteKey,
    minuteRequests: 0,
  };
  const boundary = nextPrivateMediaReadRequestAttemptQuota({
    current,
    dayKey,
    minuteKey,
  });
  assert.deepEqual(boundary, {
    dayKey,
    dailyRequests: privateMediaReadDailyRequestLimit,
    minuteKey,
    minuteRequests: 1,
  });
  assert.equal(nextPrivateMediaReadRequestAttemptQuota({
    current: mergeQuotaUpdate(current, boundary),
    dayKey,
    minuteKey: '2026-08-14T23:58',
  }), null);
  assert.deepEqual(nextPrivateMediaReadRequestAttemptQuota({
    current: mergeQuotaUpdate(current, boundary),
    dayKey: '2026-08-15',
    minuteKey: '2026-08-15T00:00',
  }), {
    dayKey: '2026-08-15',
    dailyRequests: 1,
    minuteKey: '2026-08-15T00:00',
    minuteRequests: 1,
  });
});

test('charges bytes only after metadata and allows exactly 250 MiB per day', () => {
  const dayKey = '2026-08-14';
  const current = {
    dayKey,
    dailyBytes: privateMediaReadDailyByteLimit - 1,
    minuteKey: '2026-08-14T03:04',
    minuteRequests: 17,
  };

  const boundary = nextPrivateMediaReadByteQuota({
    current,
    dayKey,
    byteLength: 1,
  });
  assert.deepEqual(boundary, {
    dayKey,
    dailyBytes: privateMediaReadDailyByteLimit,
  });
  assert.equal(
    nextPrivateMediaReadByteQuota({
      current: mergeQuotaUpdate(current, boundary),
      dayKey,
      byteLength: 1,
    }),
    null,
  );

  const nextDayKey = '2026-08-15';
  assert.deepEqual(
    nextPrivateMediaReadByteQuota({
      current: mergeQuotaUpdate(current, boundary),
      dayKey: nextDayKey,
      byteLength: 7,
    }),
    { dayKey: nextDayKey, dailyBytes: 7 },
  );
});

test('rejects adversarial metadata sizes without changing quota state', () => {
  const current = {
    dayKey: '2026-08-14',
    dailyBytes: 99,
    minuteKey: '2026-08-14T03:04',
    minuteRequests: 3,
  };
  for (const byteLength of [
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.equal(
      nextPrivateMediaReadByteQuota({
        current,
        dayKey: current.dayKey,
        byteLength,
      }),
      null,
    );
  }
  assert.deepEqual(current, {
    dayKey: '2026-08-14',
    dailyBytes: 99,
    minuteKey: '2026-08-14T03:04',
    minuteRequests: 3,
  });
});

test('stage-specific merge patches cannot double-count or clobber counters', () => {
  const dayKey = '2026-08-14';
  const minuteKey = '2026-08-14T03:04';
  const initial = {
    dayKey,
    dailyBytes: 100,
    minuteKey,
    minuteRequests: 7,
  };

  // Both decisions may be based on the same snapshot. Because each returns
  // only its own fields, transaction merge order cannot overwrite the other
  // counter and the request attempt is still charged exactly once.
  const requestUpdate = nextPrivateMediaReadRequestAttemptQuota({
    current: initial,
    dayKey,
    minuteKey,
  });
  const byteUpdate = nextPrivateMediaReadByteQuota({
    current: initial,
    dayKey,
    byteLength: 25,
  });
  const requestThenBytes = mergeQuotaUpdate(
    mergeQuotaUpdate(initial, requestUpdate),
    byteUpdate,
  );
  const bytesThenRequest = mergeQuotaUpdate(
    mergeQuotaUpdate(initial, byteUpdate),
    requestUpdate,
  );

  const expected = {
    dayKey,
    dailyBytes: 125,
    dailyRequests: 1,
    minuteKey,
    minuteRequests: 8,
  };
  assert.deepEqual(requestThenBytes, expected);
  assert.deepEqual(bytesThenRequest, expected);
  assert.equal('dailyBytes' in requestUpdate, false);
  assert.equal('minuteRequests' in byteUpdate, false);
});

test('serialized concurrent transactions stop at both exact limits', () => {
  const dayKey = '2026-08-14';
  const minuteKey = '2026-08-14T03:04';
  let state = {
    dayKey,
    dailyBytes: privateMediaReadDailyByteLimit - 3,
    minuteKey,
    minuteRequests: privateMediaReadMinuteLimit - 2,
  };

  for (let index = 0; index < 2; index += 1) {
    const update = nextPrivateMediaReadRequestAttemptQuota({
      current: state,
      dayKey,
      minuteKey,
    });
    assert.notEqual(update, null);
    state = mergeQuotaUpdate(state, update);
  }
  assert.equal(state.minuteRequests, privateMediaReadMinuteLimit);
  assert.equal(
    nextPrivateMediaReadRequestAttemptQuota({ current: state, dayKey, minuteKey }),
    null,
  );

  for (const byteLength of [2, 1]) {
    const update = nextPrivateMediaReadByteQuota({
      current: state,
      dayKey,
      byteLength,
    });
    assert.notEqual(update, null);
    state = mergeQuotaUpdate(state, update);
  }
  assert.equal(state.dailyBytes, privateMediaReadDailyByteLimit);
  assert.equal(
    nextPrivateMediaReadByteQuota({ current: state, dayKey, byteLength: 1 }),
    null,
  );
});

test('keeps the legacy one-step adapter compatible until integration moves', () => {
  const keys = privateMediaReadQuotaKeys(new Date('2026-08-14T03:04:05Z'));
  assert.deepEqual(
    nextPrivateMediaReadQuota({
      current: undefined,
      ...keys,
      byteLength: 1024,
    }),
    { dailyBytes: 1024, minuteRequests: 1 },
  );
  assert.equal(
    nextPrivateMediaReadQuota({
      current: { ...keys, minuteRequests: privateMediaReadMinuteLimit },
      ...keys,
      byteLength: 1,
    }),
    null,
  );
});
