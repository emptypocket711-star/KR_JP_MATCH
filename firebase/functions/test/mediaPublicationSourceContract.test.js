const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const source = readFileSync(join(__dirname, '..', 'src', 'index.ts'), 'utf8');

function sourceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test('publication inspection is metadata-only and requires private metadata', () => {
  const helper = sourceBetween(
    'async function assertConfirmedMediaForPublication(',
    'async function normalizeAndVerifyPrivateMediaMetadata(',
  );
  assert.match(helper, /assertUploadedMediaMetadata\(objectPath/);
  assert.match(helper, /requirePrivateMetadata:\s*true/);
  assert.doesNotMatch(helper, /assertUploadedMediaContents|\.download\s*\(/);
});

test('profile and message publication paths cannot reinspect full bytes', () => {
  for (const [startMarker, endMarker] of [
    ['export const completeOnboarding =', '/**\n * updateMyProfile('],
    [
      'export const updateMyProfile =',
      '/** Deletes a caller-owned profile object',
    ],
    ['export const sendMessage =', '/**\n * retryMessageTranslation('],
  ]) {
    const callable = sourceBetween(startMarker, endMarker);
    assert.match(callable, /assertConfirmedMediaForPublication/);
    assert.match(callable, /consumeMediaAuthorization/);
    assert.doesNotMatch(
      callable,
      /assertUploadedMediaContents|\.download\s*\(/,
    );
  }
});
