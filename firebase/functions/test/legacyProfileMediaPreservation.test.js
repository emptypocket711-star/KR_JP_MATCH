const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const sharp = require('sharp');

const { safeJpegUploadIssue } = require('../lib/mediaUploadPolicy');
const {
  cleanupCreatedPreservationTargets,
  digest,
  executePreservationUserAction,
  legacyProfileTargetPath,
  parseOptions,
  PreservationRollbackError,
  preservationOwnerIssue,
  readPreservationManifest,
  sanitizeLegacyProfileJpeg,
} = require('../lib/admin/legacyProfileMediaPreservation');

const projectId = 'hana-e2ee6';
const bucket = 'hana-e2ee6.firebasestorage.app';
const maxUsers = 20_000;

function signedManifest(now = new Date(), includeAction = true) {
  const sourceReference =
    'https://firebasestorage.googleapis.com/v0/b/' +
    `${bucket}/o/users%2Falice%2Fphoto.jpg?alt=media&token=private-token`;
  const sourceObjectPath = 'users/alice/photo.jpg';
  const sourceGeneration = '123';
  const targetObjectPath = legacyProfileTargetPath({
    uid: 'alice',
    sourceObjectPath,
    sourceGeneration,
  });
  const actions = includeAction ? [{
    uid: 'alice',
    documentPath: 'users/alice',
    expectedPhotoUrls: [sourceReference],
    nextPhotoUrls: [targetObjectPath],
    media: [{
      sourceReference,
      sourceObjectPath,
      sourceGeneration,
      sourceMetageneration: '1',
      targetObjectPath,
      outputSha256: 'a'.repeat(64),
      outputSize: 1_024,
    }],
  }] : [];
  const findings = [];
  const unsigned = {
    schemaVersion: 1,
    kind: 'hana.legacy-profile-media-preservation',
    projectId,
    bucket,
    createdAt: now.toISOString(),
    scan: {
      complete: true,
      users: includeAction ? 1 : 0,
      maxUsers,
    },
    findings,
    actions,
    auditFingerprint: digest({ complete: true, findings, actions }),
  };
  return { ...unsigned, digest: digest(unsigned) };
}

function resignManifest(manifest) {
  const unsigned = structuredClone(manifest);
  delete unsigned.digest;
  unsigned.auditFingerprint = digest({
    complete: unsigned.scan.complete,
    findings: unsigned.findings,
    actions: unsigned.actions,
  });
  return { ...unsigned, digest: digest(unsigned) };
}

function manifestExpectations(manifest, now = new Date()) {
  return {
    projectId,
    bucket,
    maxUsers,
    actionCount: manifest.actions.length,
    digest: manifest.digest,
    now,
  };
}

async function writeManifestFile(directory, name, manifest, mode = 0o600) {
  const file = path.join(directory, name);
  await fs.writeFile(file, `${JSON.stringify(manifest)}\n`, {
    flag: 'wx',
    mode,
  });
  await fs.chmod(file, mode);
  return file;
}

test('preservation CLI is dry-run by default and apply needs confirmations', () => {
  const options = parseOptions([
    '--expected-project', 'hana-e2ee6',
    '--manifest', '/tmp/preserve.json',
  ]);
  assert.notEqual(options, 'help');
  assert.equal(options.apply, false);
  assert.equal(options.expectedProject, 'hana-e2ee6');
  assert.throws(
    () => parseOptions(['--expected-project', 'hana-e2ee6']),
    /--expected-project and --manifest are required/
  );
});

test('canonical target path is deterministic and owner scoped', () => {
  const input = {
    uid: 'alice',
    sourceObjectPath: 'users/alice/photo.jpg',
    sourceGeneration: '123',
  };
  const left = legacyProfileTargetPath(input);
  const right = legacyProfileTargetPath(input);
  assert.equal(left, right);
  assert.match(left, /^profile_media\/alice\/legacy-[a-f0-9]{40}\/image\.jpg$/);
  assert.notEqual(left, legacyProfileTargetPath({ ...input, uid: 'bob' }));
});

test('trusted sanitizer decodes pixels and emits a private-metadata-free JPEG', async () => {
  const source = await sharp({
    create: {
      width: 24,
      height: 16,
      channels: 3,
      background: { r: 50, g: 100, b: 150 },
    },
  })
    .jpeg()
    .withExif({ IFD0: { Artist: 'private-owner' } })
    .toBuffer();
  const output = await sanitizeLegacyProfileJpeg(source);
  assert.equal(safeJpegUploadIssue(output), null);
  assert.equal(output.includes(Buffer.from('private-owner')), false);
  assert.match(digest([...output]), /^[a-f0-9]{64}$/);
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, 24);
  assert.equal(metadata.height, 16);
});

test('trusted sanitizer rejects corrupt input', async () => {
  await assert.rejects(
    () => sanitizeLegacyProfileJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
    /Input buffer|unsafe/
  );
});

test('preservation rejects every legacy deleted or unavailable owner shape', () => {
  assert.equal(preservationOwnerIssue({ exists: true, userData: {} }), null);
  assert.equal(preservationOwnerIssue({
    exists: true,
    userData: { isBanned: true },
  }), 'banned');
  assert.equal(preservationOwnerIssue({
    exists: true,
    userData: { isDeleted: true },
  }), 'deleted');
  for (const [userData, expectedIssue] of [
    [{ deleted: true }, 'deleted'],
    [{ status: 'banned' }, 'banned'],
    [{ status: 'deleted' }, 'deleted'],
    [{ status: 'deactivated' }, 'deleted'],
  ]) {
    assert.equal(
      preservationOwnerIssue({ exists: true, userData }),
      expectedIssue
    );
  }
});

test('a deletion tombstone after target save aborts and cleans the new generation', async () => {
  const cleaned = [];
  await assert.rejects(
    () => executePreservationUserAction([{}], {
      saveOrVerifyTarget: async () => ({
        objectPath: 'profile_media/alice/new/image.jpg',
        generation: '101',
        size: 100,
        created: true,
      }),
      commitUser: async () => {
        throw new Error('deletion tombstone');
      },
      cleanupCreatedTargets: async (targets) => {
        cleaned.push(...targets);
      },
    }),
    /deletion tombstone/
  );
  assert.deepEqual(cleaned.map((target) => [
    target.objectPath,
    target.generation,
  ]), [['profile_media/alice/new/image.jpg', '101']]);
});

test('a second media failure cleans the first newly-created generation', async () => {
  const cleaned = [];
  let saves = 0;
  await assert.rejects(
    () => executePreservationUserAction([{}, {}], {
      saveOrVerifyTarget: async () => {
        saves++;
        if (saves === 2) throw new Error('second media failed');
        return {
          objectPath: 'profile_media/alice/first/image.jpg',
          generation: '201',
          size: 100,
          created: true,
        };
      },
      commitUser: async () => {
        assert.fail('commit must not run');
      },
      cleanupCreatedTargets: async (targets) => {
        cleaned.push(...targets);
      },
    }),
    /second media failed/
  );
  assert.equal(saves, 2);
  assert.deepEqual(cleaned.map((target) => target.generation), ['201']);
});

test('a preexisting verified target is never deleted by action rollback', async () => {
  let cleanupCalls = 0;
  await assert.rejects(
    () => executePreservationUserAction([{}], {
      saveOrVerifyTarget: async () => ({
        objectPath: 'profile_media/alice/existing/image.jpg',
        generation: '301',
        size: 100,
        created: false,
      }),
      commitUser: async () => {
        throw new Error('profile drift');
      },
      cleanupCreatedTargets: async () => {
        cleanupCalls++;
      },
    }),
    /profile drift/
  );
  assert.equal(cleanupCalls, 0);
});

test('created-target cleanup deletes and verifies only the exact generation', async () => {
  const calls = [];
  const fakeBucket = {
    file(objectPath, options) {
      calls.push(['file', objectPath, options]);
      return {
        async delete(deleteOptions) {
          calls.push(['delete', deleteOptions]);
        },
        async exists() {
          calls.push(['exists']);
          return [false];
        },
      };
    },
  };
  await cleanupCreatedPreservationTargets(fakeBucket, [{
    objectPath: 'profile_media/alice/new/image.jpg',
    generation: '302',
    size: 100,
    created: true,
  }, {
    objectPath: 'profile_media/alice/existing/image.jpg',
    generation: '301',
    size: 100,
    created: false,
  }]);
  assert.deepEqual(calls, [
    ['file', 'profile_media/alice/new/image.jpg', { generation: '302' }],
    ['delete', { ignoreNotFound: true, ifGenerationMatch: '302' }],
    ['exists'],
  ]);
});

test('cleanup failure is surfaced without replacing it with the operation error', async () => {
  await assert.rejects(
    () => executePreservationUserAction([{}], {
      saveOrVerifyTarget: async () => ({
        objectPath: 'profile_media/alice/new/image.jpg',
        generation: '401',
        size: 100,
        created: true,
      }),
      commitUser: async () => {
        throw new Error('profile drift');
      },
      cleanupCreatedTargets: async () => {
        throw new Error('cleanup verification failed');
      },
    }),
    (error) => {
      assert.ok(error instanceof PreservationRollbackError);
      assert.match(error.operationError.message, /profile drift/);
      assert.match(error.cleanupError.message, /cleanup verification failed/);
      return true;
    }
  );
});

test('manifest reader refuses a mode-0644 bearer-token manifest', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hana-preserve-mode-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const now = new Date('2026-08-14T00:00:00.000Z');
  const manifest = signedManifest(now);
  const file = await writeManifestFile(directory, 'manifest.json', manifest, 0o644);
  await assert.rejects(
    () => readPreservationManifest(
      file,
      manifestExpectations(manifest, now)
    ),
    /mode-0600/
  );
});

test('manifest reader enforces age, project, count, paths, and digest', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hana-preserve-schema-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const now = new Date('2026-08-14T12:00:00.000Z');

  const valid = signedManifest(now);
  const validFile = await writeManifestFile(directory, 'valid.json', valid);
  assert.equal(
    (await readPreservationManifest(
      validFile,
      manifestExpectations(valid, now)
    )).digest,
    valid.digest
  );

  const expired = signedManifest(
    new Date(now.getTime() - 24 * 60 * 60 * 1000 - 1)
  );
  const expiredFile = await writeManifestFile(directory, 'expired.json', expired);
  await assert.rejects(
    () => readPreservationManifest(
      expiredFile,
      manifestExpectations(expired, now)
    ),
    /expired/
  );

  const wrongProject = resignManifest({ ...valid, projectId: 'other-project' });
  const wrongProjectFile = await writeManifestFile(
    directory,
    'wrong-project.json',
    wrongProject
  );
  await assert.rejects(
    () => readPreservationManifest(
      wrongProjectFile,
      manifestExpectations(wrongProject, now)
    ),
    /schema, target, or count/
  );

  const malformedPath = structuredClone(valid);
  malformedPath.actions[0].documentPath = 'users/bob';
  const resignedMalformedPath = resignManifest(malformedPath);
  const malformedPathFile = await writeManifestFile(
    directory,
    'malformed-path.json',
    resignedMalformedPath
  );
  await assert.rejects(
    () => readPreservationManifest(
      malformedPathFile,
      manifestExpectations(resignedMalformedPath, now)
    ),
    /user action schema/
  );

  await assert.rejects(
    () => readPreservationManifest(validFile, {
      ...manifestExpectations(valid, now),
      actionCount: 2,
    }),
    /schema, target, or count/
  );
  await assert.rejects(
    () => readPreservationManifest(validFile, {
      ...manifestExpectations(valid, now),
      digest: 'b'.repeat(64),
    }),
    /digest verification/
  );
});
