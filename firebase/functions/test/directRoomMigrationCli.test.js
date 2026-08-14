const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const {
  chmodSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  classifyDirectRoomMigration,
} = require('../lib/directRoomMigrationPolicy');
const {
  buildDirectRoomManifest,
  createIdentifierProtector,
} = require('../lib/directRoomMigrationManifest');

const cliPath = path.resolve(__dirname, '../lib/admin/directRoomMigration.js');

function cliEnvironment(projectId) {
  const env = { ...process.env, GOOGLE_CLOUD_PROJECT: projectId };
  delete env.GCLOUD_PROJECT;
  delete env.FIREBASE_CONFIG;
  delete env.FIRESTORE_EMULATOR_HOST;
  return env;
}

function runCli(args, projectId = 'hana-e2ee6') {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    env: cliEnvironment(projectId),
    timeout: 5000,
  });
}

function fixture() {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'hana-direct-room-cli-test-')
  );
  const keyPath = path.join(directory, 'identifier.key');
  const manifestPath = path.join(directory, 'manifest.json');
  const key = Buffer.alloc(32, 9);
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

test('CLI documents dry-run default and explicit apply confirmations', () => {
  const result = runCli(['--help']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /dry-run by default/);
  assert.match(result.stdout, /--confirm-project/);
  assert.match(result.stdout, /--manifest-digest/);
  assert.equal(result.stderr, '');
});

test('CLI rejects projects outside the hardcoded Hana allowlist', () => {
  const files = fixture();
  try {
    const result = runCli(
      [
        '--expected-project',
        'other-project',
        '--manifest',
        files.manifestPath,
        '--hash-key-file',
        files.keyPath,
      ],
      'other-project'
    );

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

test('CLI rejects apply without an exact project confirmation', () => {
  const files = fixture();
  try {
    const result = runCli([
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

    assert.equal(result.status, 1);
    assert.match(result.stderr, /--confirm-project must exactly match/);
  } finally {
    files.cleanup();
  }
});

test('CLI requires a second explicit confirmation for production writes', () => {
  const files = fixture();
  try {
    const result = runCli(
      [
        '--apply',
        '--expected-project',
        'hana-production-tokyo',
        '--confirm-project',
        'hana-production-tokyo',
        '--manifest',
        files.manifestPath,
        '--manifest-digest',
        '0'.repeat(64),
        '--hash-key-file',
        files.keyPath,
      ],
      'hana-production-tokyo'
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /--confirm-production-write/);
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
      '--confirm-project',
      'hana-e2ee6',
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

test('CLI rejects an invalid manifest before any Firestore read', () => {
  const files = fixture();
  try {
    writeFileSync(files.manifestPath, '{}\n', { mode: 0o600 });
    const result = runCli([
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

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Manifest schema or digest verification failed/);
  } finally {
    files.cleanup();
  }
});

test('CLI requires the separately supplied digest to match a valid manifest', () => {
  const files = fixture();
  try {
    const classification = classifyDirectRoomMigration(
      [
        {
          id: 'room_1',
          userIds: ['alice', 'bob'],
          pairKey: 'alice_bob',
        },
      ],
      [
        {
          id: 'alice_bob',
          userIds: ['alice', 'bob'],
          pairKey: 'alice_bob',
          activeMatchId: 'room_1',
        },
      ]
    );
    const manifest = buildDirectRoomManifest({
      projectId: 'hana-e2ee6',
      createdAt: new Date('2026-08-13T00:00:00.000Z'),
      pageSize: 200,
      maxDocumentsPerCollection: 10000,
      scanComplete: true,
      classification,
      protector: createIdentifierProtector(files.key),
    });
    writeFileSync(files.manifestPath, `${JSON.stringify(manifest)}\n`, {
      mode: 0o600,
    });

    const result = runCli([
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

    assert.equal(result.status, 1);
    assert.match(result.stderr, /does not match the verified manifest/);
  } finally {
    files.cleanup();
  }
});
