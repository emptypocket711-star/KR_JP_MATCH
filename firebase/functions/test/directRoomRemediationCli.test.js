const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildDirectRoomRemediationManifest,
  classifyDirectRoomRemediation,
  createRemediationIdentifierProtector,
} = require('../lib/directRoomRemediationPolicy');
const {
  writeNewManifest,
} = require('../lib/admin/directRoomRemediation');

const cliPath = path.resolve(
  __dirname,
  '../lib/admin/directRoomRemediation.js'
);

function cliEnvironment(projectId) {
  const env = { ...process.env, GOOGLE_CLOUD_PROJECT: projectId };
  delete env.GCLOUD_PROJECT;
  delete env.FIREBASE_CONFIG;
  delete env.FIRESTORE_EMULATOR_HOST;
  return env;
}

function runCli(args, projectId = 'hana-e2ee6', envOverrides = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    env: { ...cliEnvironment(projectId), ...envOverrides },
    timeout: 5000,
  });
}

function fixture() {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'hana-direct-room-remediation-cli-test-')
  );
  const keyPath = path.join(directory, 'identifier.key');
  const manifestPath = path.join(directory, 'manifest.json');
  const key = Buffer.alloc(32, 11);
  writeFileSync(keyPath, key, { mode: 0o600 });
  chmodSync(keyPath, 0o600);
  return {
    directory,
    key,
    keyPath,
    manifestPath,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

function validManifest(key, projectId = 'hana-e2ee6') {
  const classification = classifyDirectRoomRemediation({
    activeMatches: [
      {
        id: 'room_close',
        userIds: ['gone', 'survivor'],
        isActive: true,
        pairKey: 'gone_survivor',
        hiddenFor: [],
      },
      {
        id: 'room_active',
        userIds: ['alice', 'bob'],
        isActive: true,
        pairKey: 'alice_bob',
        hiddenFor: [],
      },
    ],
    chatPairs: [{
      id: 'alice_bob',
      userIds: ['alice', 'bob'],
      pairKey: 'alice_bob',
      activeMatchId: 'room_active',
      closedMatchId: 'room_closed',
      closedReason: 'left_chat',
    }],
    participantAccounts: [
      { uid: 'alice', state: 'active' },
      { uid: 'bob', state: 'active' },
      { uid: 'gone', state: 'missing' },
      { uid: 'survivor', state: 'active' },
    ],
    referencedClosedMatches: [{
      id: 'room_closed',
      userIds: ['alice', 'bob'],
      isActive: false,
      pairKey: 'alice_bob',
      hiddenFor: ['alice', 'bob'],
      closedReason: 'left_chat',
    }],
  });
  assert.equal(classification.closeUnavailableRooms.length, 1);
  assert.equal(classification.clearStaleClosedPointers.length, 1);
  return buildDirectRoomRemediationManifest({
    projectId,
    createdAt: new Date('2026-08-13T00:00:00.000Z'),
    pageSize: 200,
    maxDocumentsPerCollection: 10000,
    scanComplete: true,
    participantReferencesRequested: 4,
    participantDocumentsFound: 3,
    closedMatchReferencesRequested: 1,
    closedMatchDocumentsFound: 1,
    classification,
    protector: createRemediationIdentifierProtector(key),
  });
}

function writeManifest(files, manifest, mode = 0o600) {
  writeFileSync(files.manifestPath, `${JSON.stringify(manifest)}\n`, { mode });
  chmodSync(files.manifestPath, mode);
}

function applyArguments(files, manifest, overrides = {}) {
  return [
    '--apply',
    '--expected-project',
    overrides.expectedProject ?? 'hana-e2ee6',
    '--confirm-project',
    overrides.confirmProject ?? 'hana-e2ee6',
    '--confirm-close-count',
    String(overrides.closeCount ?? 1),
    '--confirm-pointer-cleanup-count',
    String(overrides.pointerCount ?? 1),
    '--manifest',
    files.manifestPath,
    '--manifest-digest',
    overrides.digest ?? manifest.digest,
    '--hash-key-file',
    files.keyPath,
  ];
}

test('CLI documents dry-run default and every exact apply confirmation', () => {
  const result = runCli(['--help']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /dry-run by default/);
  assert.match(result.stdout, /--confirm-project/);
  assert.match(result.stdout, /--confirm-close-count/);
  assert.match(result.stdout, /--confirm-pointer-cleanup-count/);
  assert.match(result.stdout, /--manifest-digest/);
  assert.equal(result.stderr, '');
});

test('CLI rejects projects outside the hardcoded Hana allowlist', () => {
  const files = fixture();
  try {
    const result = runCli([
      '--expected-project',
      'other-project',
      '--manifest',
      files.manifestPath,
      '--hash-key-file',
      files.keyPath,
    ], 'other-project');

    assert.equal(result.status, 1);
    assert.match(result.stderr, /not in the Hana project allowlist/);
  } finally {
    files.cleanup();
  }
});

test('CLI rejects a runtime project that differs from the explicit target', () => {
  const files = fixture();
  try {
    const result = runCli([
      '--expected-project',
      'hana-e2ee6',
      '--manifest',
      files.manifestPath,
      '--hash-key-file',
      files.keyPath,
    ], 'hana-production-tokyo');

    assert.equal(result.status, 1);
    assert.match(result.stderr, /does not match --expected-project/);
  } finally {
    files.cleanup();
  }
});

test('CLI rejects apply without exact project and action-count confirmations', () => {
  const files = fixture();
  try {
    const missingProject = runCli([
      '--apply',
      '--expected-project',
      'hana-e2ee6',
      '--manifest',
      files.manifestPath,
      '--manifest-digest',
      '0'.repeat(64),
      '--hash-key-file',
      files.keyPath,
    ]);
    const missingCounts = runCli([
      '--apply',
      '--expected-project',
      'hana-e2ee6',
      '--confirm-project',
      'hana-e2ee6',
      '--manifest',
      files.manifestPath,
      '--manifest-digest',
      '0'.repeat(64),
      '--hash-key-file',
      files.keyPath,
    ]);

    assert.equal(missingProject.status, 1);
    assert.match(missingProject.stderr, /--confirm-project must exactly match/);
    assert.equal(missingCounts.status, 1);
    assert.match(missingCounts.stderr, /exact close and pointer-cleanup count/);
  } finally {
    files.cleanup();
  }
});

test('CLI requires a second explicit confirmation for production writes', () => {
  const files = fixture();
  try {
    const result = runCli([
      '--apply',
      '--expected-project',
      'hana-production-tokyo',
      '--confirm-project',
      'hana-production-tokyo',
      '--confirm-close-count',
      '0',
      '--confirm-pointer-cleanup-count',
      '0',
      '--manifest',
      files.manifestPath,
      '--manifest-digest',
      '0'.repeat(64),
      '--hash-key-file',
      files.keyPath,
    ], 'hana-production-tokyo');

    assert.equal(result.status, 1);
    assert.match(result.stderr, /--confirm-production-write/);
  } finally {
    files.cleanup();
  }
});

test('CLI always refuses apply against a Firestore emulator', () => {
  const files = fixture();
  try {
    const result = runCli([
      '--apply',
      '--allow-emulator',
      '--expected-project',
      'hana-e2ee6',
      '--confirm-project',
      'hana-e2ee6',
      '--confirm-close-count',
      '0',
      '--confirm-pointer-cleanup-count',
      '0',
      '--manifest',
      files.manifestPath,
      '--manifest-digest',
      '0'.repeat(64),
      '--hash-key-file',
      files.keyPath,
    ], 'hana-e2ee6', {
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Apply mode is disabled.*EMULATOR_HOST/);
  } finally {
    files.cleanup();
  }
});

test('CLI rejects apply-only confirmation flags in dry-run mode', () => {
  const files = fixture();
  try {
    const result = runCli([
      '--expected-project',
      'hana-e2ee6',
      '--confirm-close-count',
      '0',
      '--manifest',
      files.manifestPath,
      '--hash-key-file',
      files.keyPath,
    ]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalid without --apply/);
  } finally {
    files.cleanup();
  }
});

test('CLI rejects an invalid or non-0600 manifest before any Firestore read', () => {
  const files = fixture();
  try {
    writeFileSync(files.manifestPath, '{}\n', { mode: 0o600 });
    chmodSync(files.manifestPath, 0o600);
    const invalid = runCli(applyArguments(
      files,
      { digest: '0'.repeat(64) },
      { digest: '0'.repeat(64) }
    ));
    chmodSync(files.manifestPath, 0o644);
    const publicFile = runCli(applyArguments(
      files,
      { digest: '0'.repeat(64) },
      { digest: '0'.repeat(64) }
    ));
    chmodSync(files.manifestPath, 0o400);
    const readOnlyFile = runCli(applyArguments(
      files,
      { digest: '0'.repeat(64) },
      { digest: '0'.repeat(64) }
    ));

    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /schema or digest verification failed/);
    assert.equal(publicFile.status, 1);
    assert.match(publicFile.stderr, /private regular file with mode 0600/);
    assert.equal(readOnlyFile.status, 1);
    assert.match(readOnlyFile.stderr, /private regular file with mode 0600/);
  } finally {
    files.cleanup();
  }
});

test('CLI validates the separate digest and exact counts before Firebase init', () => {
  const files = fixture();
  try {
    const manifest = validManifest(files.key);
    writeManifest(files, manifest);
    const wrongDigest = runCli(applyArguments(files, manifest, {
      digest: '0'.repeat(64),
    }));
    const wrongCount = runCli(applyArguments(files, manifest, {
      closeCount: 0,
    }));
    const wrongBounds = runCli([
      ...applyArguments(files, manifest),
      '--page-size',
      '199',
    ]);

    assert.equal(wrongDigest.status, 1);
    assert.match(wrongDigest.stderr, /does not match the verified manifest/);
    assert.equal(wrongCount.status, 1);
    assert.match(wrongCount.stderr, /exact count confirmations/);
    assert.equal(wrongBounds.status, 1);
    assert.match(wrongBounds.stderr, /scan bounds must exactly match/);
  } finally {
    files.cleanup();
  }
});

test('manifest writer creates mode 0600 and never overwrites an existing file', async () => {
  const files = fixture();
  try {
    const manifest = validManifest(files.key);
    await writeNewManifest(files.manifestPath, manifest);

    assert.equal(statSync(files.manifestPath).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(readFileSync(files.manifestPath, 'utf8')), manifest);
    await assert.rejects(
      writeNewManifest(files.manifestPath, manifest),
      (error) => error?.code === 'EEXIST'
    );
  } finally {
    files.cleanup();
  }
});
