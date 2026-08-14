const assert = require('node:assert/strict');
const test = require('node:test');

const {
  decideTranslationQuota,
  translationDailyCharacterLimit,
  translationMaxTextCharacters,
  translationMinuteRequestLimit,
  translationQuotaKeys,
  validateTranslationRequest,
} = require('../lib/translationPolicy');

test('validates translation language and the 1000-character boundary', () => {
  assert.deepEqual(validateTranslationRequest(' hello ', 'ja'), {
    ok: true,
    text: 'hello',
    targetLang: 'ja',
  });
  assert.equal(
    validateTranslationRequest('x'.repeat(translationMaxTextCharacters), 'ko').ok,
    true
  );
  assert.deepEqual(validateTranslationRequest('', 'ko'), {
    ok: false,
    reason: 'empty-text',
  });
  assert.deepEqual(
    validateTranslationRequest(
      'x'.repeat(translationMaxTextCharacters + 1),
      'ko'
    ),
    { ok: false, reason: 'text-too-long' }
  );
  assert.deepEqual(validateTranslationRequest('hello', 'en'), {
    ok: false,
    reason: 'invalid-target-language',
  });
});

test('creates deterministic UTC day and minute quota keys', () => {
  assert.deepEqual(
    translationQuotaKeys(new Date('2026-08-12T03:45:59.000Z')),
    { dayKey: '2026-08-12', minuteKey: '2026-08-12T03:45' }
  );
});

test('enforces per-minute request and daily character limits', () => {
  const minuteKey = '2026-08-12T03:45';
  assert.deepEqual(
    decideTranslationQuota({
      current: undefined,
      requestCharacters: 10,
      minuteKey,
    }),
    {
      allowed: true,
      dailyCharacters: 10,
      minuteKey,
      minuteRequests: 1,
    }
  );
  assert.deepEqual(
    decideTranslationQuota({
      current: {
        dailyCharacters: 100,
        minuteKey,
        minuteRequests: translationMinuteRequestLimit,
      },
      requestCharacters: 1,
      minuteKey,
    }),
    { allowed: false, reason: 'minute-request-limit' }
  );
  assert.deepEqual(
    decideTranslationQuota({
      current: {
        dailyCharacters: translationDailyCharacterLimit,
        minuteKey: 'older-minute',
        minuteRequests: translationMinuteRequestLimit,
      },
      requestCharacters: 1,
      minuteKey,
    }),
    { allowed: false, reason: 'daily-character-limit' }
  );
});

test('resets only the minute counter when the minute changes', () => {
  const result = decideTranslationQuota({
    current: {
      dailyCharacters: 500,
      minuteKey: '2026-08-12T03:44',
      minuteRequests: translationMinuteRequestLimit,
    },
    requestCharacters: 25,
    minuteKey: '2026-08-12T03:45',
  });
  assert.deepEqual(result, {
    allowed: true,
    dailyCharacters: 525,
    minuteKey: '2026-08-12T03:45',
    minuteRequests: 1,
  });
});
