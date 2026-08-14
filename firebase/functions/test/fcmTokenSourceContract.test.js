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

test('missing first-session profile is retryable and never reported as success', () => {
  const callable = sourceBetween(
    'export const updateFcmToken =',
    '/** Detaches only the exact token',
  );
  const accountCheck = callable.indexOf(
    'const retryDetails = retryableFcmRegistrationDetails(accountIssue)',
  );
  const retryableFailure = callable.indexOf(
    "'Notification registration is not ready'",
  );
  const tokenWrite = callable.indexOf('tx.update(userRef');

  assert.ok(accountCheck >= 0);
  assert.ok(retryableFailure > accountCheck);
  assert.ok(tokenWrite > retryableFailure);
  assert.match(callable, /'failed-precondition'/);
  assert.match(callable, /retryDetails/);
  assert.doesNotMatch(callable, /if \(accountIssue === 'missing'\) return/);
});

test('retry response does not expose token, uid, or stored profile fields', () => {
  const policySource = readFileSync(
    join(__dirname, '..', 'src', 'fcmTokenPolicy.ts'),
    'utf8',
  );
  const helperStart = policySource.indexOf(
    'export function retryableFcmRegistrationDetails(',
  );
  assert.notEqual(helperStart, -1);
  const helper = policySource.slice(helperStart);

  assert.match(helper, /reason:\s*fcmProfileNotReadyReason/);
  assert.match(helper, /retryable:\s*true/);
  assert.doesNotMatch(helper, /storedToken|requestedToken|uid|userData/);
});
