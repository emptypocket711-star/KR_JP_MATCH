const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildStaleProfileMediaManifest,
} = require('../lib/staleProfileMediaReferenceManifest');
const {
  writeNewPrivateManifest,
} = require('../lib/admin/staleProfileMediaReferenceRemediation');

const cliPath = path.resolve(
  __dirname,
  '../lib/admin/staleProfileMediaReferenceRemediation.js'
);
const productionConfirmation =
  'I UNDERSTAND HANA PRODUCTION STALE MEDIA WRITES';

function cliEnvironment(projectId, overrides = {}) {
  const environment = {
    ...process.env,
    GOOGLE_CLOUD_PROJECT: projectId,
    ...overrides,
  };
  delete environment.GCLOUD_PROJECT;
  if (!Object.hasOwn(overrides, 'FIREBASE_CONFIG')) {
    delete environment.FIREBASE_CONFIG;
  }
  if (!Object.hasOwn(overrides, 'FIRESTORE_EMULATOR_HOST')) {
    delete environment.FIRESTORE_EMULATOR_HOST;
  }
  if (!Object.hasOwn(overrides, 'FIREBASE_AUTH_EMULATOR_HOST')) {
    delete environment.FIREBASE_AUTH_EMULATOR_HOST;
  }
  if (!Object.hasOwn(overrides, 'STORAGE_EMULATOR_HOST')) {
    delete environment.STORAGE_EMULATOR_HOST;
  }
  return environment;
}

function runCli(args, projectId = 'hana-e2ee6', envOverrides = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    env: cliEnvironment(projectId, envOverrides),
    timeout: 5000,
  });
}

function fixture() {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'hana-stale-profile-media-cli-test-')
  );
  return {
    directory,
    manifestPath: path.join(directory, 'manifest.json'),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

function scanCounts(overrides = {}) {
  return {
    users: 0,
    posts: 0,
    comments: 0,
    replies: 0,
    blocks: 0,
    matches: 0,
    referencedOwners: 0,
    missingOwnersCheckedInAuth: 0,
    missingOwnersConfirmed: 0,
    authRecordsFoundWithoutUser: 0,
    deferredFirstPartyReferences: 0,
    ...overrides,
  };
}

function validManifest(overrides = {}) {
  const projectId = overrides.projectId ?? 'hana-e2ee6';
  return buildStaleProfileMediaManifest({
    projectId,
    bucket: `${projectId}.firebasestorage.app`,
    createdAt: new Date(),
    pageSize: 200,
    maxDocumentsPerSource: 20000,
    scanComplete: true,
    scanCounts: scanCounts(),
    findings: [],
    actions: [],
    ...overrides,
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
    '--confirm-action-count',
    String(overrides.actionCount ?? manifest.counts.actions),
    '--manifest',
    files.manifestPath,
    '--manifest-digest',
    overrides.digest ?? manifest.digest,
    ...(overrides.productionConfirmation === undefined
      ? []
      : [
        '--confirm-production-write',
        overrides.productionConfirmation,
      ]),
  ];
}

test('CLI documents dry-run default and every exact apply confirmation', () => {
  const result = runCli(['--help']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /dry-run by default/i);
  assert.match(result.stdout, /--expected-project/);
  assert.match(result.stdout, /--manifest/);
  assert.match(result.stdout, /--confirm-project/);
  assert.match(result.stdout, /--confirm-action-count/);
  assert.match(result.stdout, /--manifest-digest/);
  assert.match(result.stdout, /--confirm-production-write/);
  assert.match(result.stdout, new RegExp(productionConfirmation));
  assert.equal(result.stderr, '');
});

test('audit manifest creation is mode 0600 and never overwrites', async () => {
  const files = fixture();
  try {
    const manifest = validManifest();
    await writeNewPrivateManifest(files.manifestPath, manifest);
    assert.equal(statSync(files.manifestPath).mode & 0o777, 0o600);
    await assert.rejects(
      writeNewPrivateManifest(files.manifestPath, manifest),
      /EEXIST|file already exists/i
    );
  } finally {
    files.cleanup();
  }
});

test('CLI requires explicit dry-run target arguments and rejects unknown flags', () => {
  const missingManifest = runCli([
    '--expected-project',
    'hana-e2ee6',
  ]);
  const missingProject = runCli([
    '--manifest',
    '/tmp/unused-stale-media-manifest.json',
  ]);
  const unknown = runCli([
    '--expected-project',
    'hana-e2ee6',
    '--manifest',
    '/tmp/unused-stale-media-manifest.json',
    '--unknown',
  ]);

  assert.equal(missingManifest.status, 1);
  assert.match(missingManifest.stderr, /--expected-project.*--manifest.*required/i);
  assert.equal(missingProject.status, 1);
  assert.match(missingProject.stderr, /--expected-project.*--manifest.*required/i);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /unknown argument/i);
});

test('CLI rejects projects outside the hardcoded Hana allowlist', () => {
  const files = fixture();
  try {
    const result = runCli([
      '--expected-project',
      'attacker-project',
      '--manifest',
      files.manifestPath,
    ], 'attacker-project');

    assert.equal(result.status, 1);
    assert.match(result.stderr, /not in the Hana project allowlist/i);
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
    ], 'hana-production-tokyo');

    assert.equal(result.status, 1);
    assert.match(result.stderr, /does not match --expected-project/i);
  } finally {
    files.cleanup();
  }
});

test('CLI rejects a mismatched runtime Storage bucket before Firebase initialization', () => {
  const files = fixture();
  try {
    const result = runCli([
      '--expected-project',
      'hana-e2ee6',
      '--manifest',
      files.manifestPath,
    ], 'hana-e2ee6', {
      FIREBASE_CONFIG: JSON.stringify({
        projectId: 'hana-e2ee6',
        storageBucket: 'attacker.firebasestorage.app',
      }),
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Storage bucket does not match/i);
  } finally {
    files.cleanup();
  }
});

test('CLI refuses emulator environments before Firebase initialization', () => {
  const files = fixture();
  try {
    for (const [name, value] of [
      ['FIRESTORE_EMULATOR_HOST', '127.0.0.1:8080'],
      ['FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1:9099'],
    ]) {
      const result = runCli([
        '--expected-project',
        'hana-e2ee6',
        '--manifest',
        files.manifestPath,
      ], 'hana-e2ee6', { [name]: value });

      assert.equal(result.status, 1, name);
      assert.match(result.stderr, /emulator/i, name);
    }
  } finally {
    files.cleanup();
  }
});

test('CLI rejects apply without exact project, digest, and count confirmations', () => {
  const files = fixture();
  try {
    const missingProject = runCli([
      '--apply',
      '--expected-project',
      'hana-e2ee6',
      '--confirm-action-count',
      '0',
      '--manifest',
      files.manifestPath,
      '--manifest-digest',
      '0'.repeat(64),
    ]);
    const missingDigest = runCli([
      '--apply',
      '--expected-project',
      'hana-e2ee6',
      '--confirm-project',
      'hana-e2ee6',
      '--confirm-action-count',
      '0',
      '--manifest',
      files.manifestPath,
    ]);
    const missingCount = runCli([
      '--apply',
      '--expected-project',
      'hana-e2ee6',
      '--confirm-project',
      'hana-e2ee6',
      '--manifest',
      files.manifestPath,
      '--manifest-digest',
      '0'.repeat(64),
    ]);

    assert.equal(missingProject.status, 1);
    assert.match(missingProject.stderr, /--confirm-project.*exact/i);
    assert.equal(missingDigest.status, 1);
    assert.match(missingDigest.stderr, /--manifest-digest/i);
    assert.equal(missingCount.status, 1);
    assert.match(missingCount.stderr, /--confirm-action-count/i);
  } finally {
    files.cleanup();
  }
});

test('CLI rejects malformed apply digest and action-count confirmations', () => {
  const files = fixture();
  try {
    const invalidDigest = runCli([
      '--apply',
      '--expected-project',
      'hana-e2ee6',
      '--confirm-project',
      'hana-e2ee6',
      '--confirm-action-count',
      '0',
      '--manifest',
      files.manifestPath,
      '--manifest-digest',
      'ABC',
    ]);
    const invalidCounts = ['-1', '1.5', '9007199254740992'].map((count) =>
      runCli([
        '--apply',
        '--expected-project',
        'hana-e2ee6',
        '--confirm-project',
        'hana-e2ee6',
        '--confirm-action-count',
        count,
        '--manifest',
        files.manifestPath,
        '--manifest-digest',
        '0'.repeat(64),
      ])
    );

    assert.equal(invalidDigest.status, 1);
    assert.match(invalidDigest.stderr, /--manifest-digest.*64.*SHA-256/i);
    for (const result of invalidCounts) {
      assert.equal(result.status, 1);
      assert.match(result.stderr, /--confirm-action-count.*integer/i);
    }
  } finally {
    files.cleanup();
  }
});

test('CLI requires the exact extra production write phrase', () => {
  const files = fixture();
  try {
    const base = [
      '--apply',
      '--expected-project',
      'hana-production-tokyo',
      '--confirm-project',
      'hana-production-tokyo',
      '--confirm-action-count',
      '0',
      '--manifest',
      files.manifestPath,
      '--manifest-digest',
      '0'.repeat(64),
    ];
    const missing = runCli(base, 'hana-production-tokyo');
    const wrong = runCli([
      ...base,
      '--confirm-production-write',
      'hana-production-tokyo',
    ], 'hana-production-tokyo');

    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /--confirm-production-write/i);
    assert.equal(wrong.status, 1);
    assert.match(wrong.stderr, /--confirm-production-write|production phrase/i);
  } finally {
    files.cleanup();
  }
});

test('CLI rejects every apply-only confirmation flag in dry-run mode', () => {
  const files = fixture();
  try {
    const applyOnlyArguments = [
      ['--confirm-project', 'hana-e2ee6'],
      ['--confirm-action-count', '0'],
      ['--manifest-digest', '0'.repeat(64)],
      ['--confirm-production-write', productionConfirmation],
    ];
    for (const flagArguments of applyOnlyArguments) {
      const result = runCli([
        '--expected-project',
        'hana-e2ee6',
        '--manifest',
        files.manifestPath,
        ...flagArguments,
      ]);

      assert.equal(result.status, 1, flagArguments[0]);
      assert.match(result.stderr, /invalid without --apply/i, flagArguments[0]);
    }
  } finally {
    files.cleanup();
  }
});

test('CLI rejects malformed and non-private manifest inputs before live reads', () => {
  const files = fixture();
  try {
    writeFileSync(files.manifestPath, '{}\n', { mode: 0o600 });
    chmodSync(files.manifestPath, 0o600);
    const invalidSchema = runCli(applyArguments(
      files,
      { counts: { actions: 0 }, digest: '0'.repeat(64) },
      { digest: '0'.repeat(64) }
    ));

    const manifest = validManifest();
    writeManifest(files, manifest, 0o644);
    const publicFile = runCli(applyArguments(files, manifest, {
      digest: '0'.repeat(64),
    }));
    chmodSync(files.manifestPath, 0o400);
    const readOnlyFile = runCli(applyArguments(files, manifest, {
      digest: '0'.repeat(64),
    }));

    const directoryPath = path.join(files.directory, 'manifest-directory');
    mkdirSync(directoryPath);
    const directoryInput = runCli([
      ...applyArguments(files, manifest, { digest: '0'.repeat(64) })
        .map((value) => value === files.manifestPath ? directoryPath : value),
    ]);

    chmodSync(files.manifestPath, 0o600);
    writeManifest(files, manifest);
    const symlinkPath = path.join(files.directory, 'manifest-link.json');
    symlinkSync(files.manifestPath, symlinkPath);
    const symlinkInput = runCli([
      ...applyArguments(files, manifest, { digest: '0'.repeat(64) })
        .map((value) => value === files.manifestPath ? symlinkPath : value),
    ]);

    assert.equal(invalidSchema.status, 1);
    assert.match(invalidSchema.stderr, /manifest schema or digest verification failed/i);
    for (const [label, result] of [
      ['public file', publicFile],
      ['read-only file', readOnlyFile],
      ['directory', directoryInput],
      ['symlink', symlinkInput],
    ]) {
      assert.equal(result.status, 1, label);
      assert.match(
        result.stderr,
        /private regular file with mode 0600/i,
        label
      );
    }
  } finally {
    files.cleanup();
  }
});

test('CLI validates manifest project, digest, and exact action count before live reads', () => {
  const files = fixture();
  try {
    const manifest = validManifest();
    writeManifest(files, manifest);

    const wrongDigest = runCli(applyArguments(files, manifest, {
      digest: '0'.repeat(64),
    }));
    const wrongCount = runCli(applyArguments(files, manifest, {
      actionCount: 1,
    }));

    const productionManifest = validManifest({
      projectId: 'hana-production-tokyo',
    });
    writeManifest(files, productionManifest);
    const wrongProject = runCli(applyArguments(files, productionManifest, {
      digest: '0'.repeat(64),
      actionCount: 1,
    }));

    assert.equal(wrongDigest.status, 1);
    assert.match(wrongDigest.stderr, /does not match the verified manifest/i);
    assert.equal(wrongCount.status, 1);
    assert.match(wrongCount.stderr, /--confirm-action-count.*manifest/i);
    assert.equal(wrongProject.status, 1);
    assert.match(wrongProject.stderr, /manifest project.*--expected-project/i);
  } finally {
    files.cleanup();
  }
});

test('CLI rejects stale and future manifests before Firebase initialization', () => {
  const files = fixture();
  try {
    const stale = validManifest({
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    });
    writeManifest(files, stale);
    const staleResult = runCli(applyArguments(files, stale));
    assert.equal(staleResult.status, 1);
    assert.match(staleResult.stderr, /older than 24 hours/i);

    const future = validManifest({
      createdAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    writeManifest(files, future);
    const futureResult = runCli(applyArguments(files, future));
    assert.equal(futureResult.status, 1);
    assert.match(futureResult.stderr, /too far in the future/i);
  } finally {
    files.cleanup();
  }
});

test('CLI refuses a complete manifest with blocking findings before live reads', () => {
  const files = fixture();
  try {
    const manifest = validManifest({
      findings: [{
        code: 'legacy-current-photo-requires-trusted-reupload',
        location: 'users/blocked-owner',
      }],
    });
    writeManifest(files, manifest);
    const result = runCli(applyArguments(files, manifest));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /contains blocking findings/i);
  } finally {
    files.cleanup();
  }
});
