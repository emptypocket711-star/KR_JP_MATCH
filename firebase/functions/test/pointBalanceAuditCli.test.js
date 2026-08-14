const assert = require('node:assert/strict');
const { chmod, mkdtemp, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  parseOptions,
  readManifest,
  verifyTarget,
  writeNewManifest,
} = require('../lib/admin/pointBalanceAudit');
const {
  buildPointBalanceAuditManifest,
  classifyPointBalanceAudit,
} = require('../lib/pointBalanceAuditPolicy');

function dryRunArgs(manifestPath = '/tmp/point-balance.json') {
  return [
    '--expected-project',
    'hana-e2ee6',
    '--manifest',
    manifestPath,
  ];
}

function validManifest() {
  return buildPointBalanceAuditManifest({
    projectId: 'hana-e2ee6',
    createdAt: new Date('2026-08-15T00:00:00.000Z'),
    complete: true,
    maxUsers: 10_000,
    maxPointEvents: 100_000,
    maxEventsPerUser: 1_000,
    classification: classifyPointBalanceAudit({ users: [], pointEvents: [] }),
  });
}

test('CLI is read-only by default and parses exact bounded apply confirmations', () => {
  const dryRun = parseOptions(dryRunArgs());
  assert.equal(dryRun.apply, false);
  assert.equal(dryRun.expectedProject, 'hana-e2ee6');

  const apply = parseOptions([
    '--apply',
    ...dryRunArgs(),
    '--confirm-project',
    'hana-e2ee6',
    '--manifest-digest',
    'a'.repeat(64),
    '--confirm-trust-count',
    '0',
    '--confirm-quarantine-count',
    '2',
    '--max-apply-actions',
    '2',
  ]);
  assert.equal(apply.apply, true);
  assert.equal(apply.confirmTrustCount, 0);
  assert.equal(apply.confirmQuarantineCount, 2);
  assert.equal(apply.maxApplyActions, 2);
  assert.throws(
    () => parseOptions([...dryRunArgs(), '--max-users', '0']),
    /between 1/
  );
});

test('target verification is staging-only, exact-project, and refuses emulator apply', () => {
  const previousProject = process.env.GOOGLE_CLOUD_PROJECT;
  const previousEmulator = process.env.FIRESTORE_EMULATOR_HOST;
  try {
    process.env.GOOGLE_CLOUD_PROJECT = 'hana-e2ee6';
    delete process.env.FIRESTORE_EMULATOR_HOST;
    assert.equal(verifyTarget(parseOptions(dryRunArgs())), 'hana-e2ee6');
    assert.throws(
      () => verifyTarget(parseOptions([
        ...dryRunArgs(),
        '--confirm-project',
        'hana-e2ee6',
      ])),
      /invalid without --apply/
    );
    assert.throws(
      () => verifyTarget(parseOptions(['--apply', ...dryRunArgs()])),
      /requires exact project, digest, trust-count, and quarantine-count/
    );
    assert.throws(
      () => verifyTarget(parseOptions([
        '--apply',
        ...dryRunArgs(),
        '--confirm-project',
        'hana-e2ee6',
        '--manifest-digest',
        'not-a-digest',
        '--confirm-trust-count',
        '0',
        '--confirm-quarantine-count',
        '0',
      ])),
      /lowercase SHA-256/
    );

    process.env.GOOGLE_CLOUD_PROJECT = 'hana-production-tokyo';
    assert.throws(
      () => verifyTarget(parseOptions(dryRunArgs())),
      /exactly match/
    );
    process.env.GOOGLE_CLOUD_PROJECT = 'hana-e2ee6';

    assert.throws(
      () => verifyTarget(parseOptions([
        '--expected-project',
        'hana-production-tokyo',
        '--manifest',
        '/tmp/a.json',
      ])),
      /source-locked/
    );

    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
    const manifest = validManifest();
    const apply = parseOptions([
      '--apply',
      ...dryRunArgs(),
      '--confirm-project',
      'hana-e2ee6',
      '--manifest-digest',
      manifest.digest,
      '--confirm-trust-count',
      '0',
      '--confirm-quarantine-count',
      '0',
      '--allow-emulator',
    ]);
    assert.throws(() => verifyTarget(apply), /Apply mode is refused/);
  } finally {
    if (previousProject === undefined) delete process.env.GOOGLE_CLOUD_PROJECT;
    else process.env.GOOGLE_CLOUD_PROJECT = previousProject;
    if (previousEmulator === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
    else process.env.FIRESTORE_EMULATOR_HOST = previousEmulator;
  }
});

test('manifest writer is private, no-overwrite, and reader rejects public files', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hana-point-audit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const manifestPath = path.join(directory, 'manifest.json');
  const manifest = validManifest();

  await writeNewManifest(manifestPath, manifest);
  assert.deepEqual(JSON.parse(await readFile(manifestPath, 'utf8')), manifest);
  assert.deepEqual(await readManifest(manifestPath), manifest);
  await assert.rejects(() => writeNewManifest(manifestPath, manifest), /EEXIST/);

  await chmod(manifestPath, 0o644);
  await assert.rejects(() => readManifest(manifestPath), /mode-0600/);
  await chmod(manifestPath, 0o400);
  await assert.rejects(() => readManifest(manifestPath), /mode-0600/);
});
