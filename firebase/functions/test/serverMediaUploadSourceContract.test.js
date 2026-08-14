const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const source = readFileSync(join(__dirname, '..', 'src', 'index.ts'), 'utf8');

function between(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return source.slice(start, end);
}

test('V2 byte upload is replay-protected and charges quota before shape/auth reads', () => {
  const callable = between(
    'export const uploadPrivateMediaBytes =',
    '/**\n * Locks a completed upload',
  );
  assert.match(callable, /timeoutSeconds:\s*120/);
  assert.match(callable, /memory:\s*'1GB'/);
  assert.match(callable, /maxInstances:\s*20/);
  assert.match(callable, /enforceAppCheck:\s*true/);
  assert.match(callable, /consumeAppCheckToken:\s*true/);
  assert.match(callable, /context\.app\?\.alreadyConsumed === true/);
  assert.ok(
    callable.indexOf('chargeServerMediaUploadRequestAttempt(uid)') <
      callable.indexOf('validateServerMediaUploadRequest(data)'),
  );
  assert.ok(
    callable.indexOf('validateServerMediaUploadRequest(data)') <
      callable.indexOf("collection('mediaUploadAuthorizations')"),
  );
});

test('one create-only nonresumable save precedes generation-bound confirmation', () => {
  const callable = between(
    'export const uploadPrivateMediaBytes =',
    '/**\n * Locks a completed upload',
  );
  assert.equal((callable.match(/\.save\(/g) ?? []).length, 1);
  assert.match(callable, /resumable:\s*false/);
  assert.match(callable, /ifGenerationMatch:\s*0/);
  assert.match(callable, /contentType:\s*'image\/jpeg'/);
  assert.match(callable, /serverMediaUploadCustomMetadata\(marker\)/);
  assert.doesNotMatch(callable, /firebaseStorageDownloadTokens/);
  assert.match(callable, /finalizeServerMediaUpload\(/);
});

test('expensive crash recovery is bounded after durable cleanup and TTL lanes', () => {
  const worker = between(
    'export const cleanupExpiredMediaUploads =',
    '/**\n * requestCandidates',
  );
  assert.match(worker, /\.limit\(serverMediaRecoveryLimit\)/);
  const recovery = worker.indexOf("where('status', '==', 'server_uploading')");
  assert.ok(recovery > worker.indexOf('generationCleanups'));
  assert.ok(recovery > worker.indexOf('expiredUploadRequestQuotas'));
});

test('status recovery is V2-only and never downloads a confirmed object', () => {
  const confirm = between(
    'export const confirmMediaUpload =',
    '/**\n * leaveChat',
  );
  const v2Start = confirm.indexOf(
    'authorizationData?.uploadProtocolVersion === mediaUploadProtocolVersion',
  );
  assert.notEqual(v2Start, -1);
  const v2End = confirm.indexOf('const issue = mediaUploadAuthorizationIssue', v2Start);
  const v2 = confirm.slice(v2Start, v2End);
  assert.match(v2, /state:\s*'recover-server-upload'/);
  assert.doesNotMatch(v2, /\.download\s*\(/);
  const recoveryStart = confirm.indexOf(
    "if (preflight.state === 'recover-server-upload')",
  );
  const recoveryEnd = confirm.indexOf('const expected =', recoveryStart);
  const recovery = confirm.slice(recoveryStart, recoveryEnd);
  assert.match(recovery, /recoverExpiredServerMediaUpload/);
  assert.doesNotMatch(recovery, /\.download\s*\(/);
});

test('account deletion always cleans a late legacy finalize independent of cutover', () => {
  const trigger = between(
    'export const onReservedMediaUploaded =',
    'export const cleanupExpiredMediaUploads =',
  );
  assert.match(trigger, /collection\('accountDeletionJobs'\)/);
  assert.match(trigger, /deletionJobExists/);
  assert.match(
    trigger,
    /if \(!deletionJobExists && !\(await legacyPrivateMediaCutoverEnabled\(\)\)\)/,
  );
  assert.match(trigger, /account_deletion_late_legacy_finalize/);
});
