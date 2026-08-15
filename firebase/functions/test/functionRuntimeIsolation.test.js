'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const stagingProject = 'hana-e2ee6';
const stagingRegion = 'us-central1';

process.env.HANA_FIREBASE_PROJECT = stagingProject;
process.env.HANA_FIREBASE_ENV = 'staging';
process.env.HANA_FUNCTIONS_REGION = stagingRegion;
process.env.GCLOUD_PROJECT = stagingProject;
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: stagingProject,
  storageBucket: `${stagingProject}.firebasestorage.app`,
});

const exported = require('../lib/index.js');
const source = fs.readFileSync(
  path.resolve(__dirname, '../src/index.ts'),
  'utf8'
);

function deployedFunctions() {
  return Object.entries(exported).filter(([, value]) =>
    value != null && typeof value === 'function' && value.__trigger != null
  );
}

function configuredValues(field) {
  return Object.fromEntries(
    deployedFunctions()
      .filter(([, fn]) => Object.hasOwn(fn.__trigger, field))
      .map(([name, fn]) => [name, fn.__trigger[field]])
  );
}

function exportSource(name) {
  const marker = `export const ${name} =`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} export must exist`);
  const next = source.indexOf('\nexport const ', start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}

test('runtime manifest keeps retry and resource options isolated', () => {
  const functions = deployedFunctions();
  assert.ok(functions.length > 0);

  const retried = functions
    .filter(([, fn]) => fn.__endpoint?.eventTrigger?.retry === true)
    .map(([name]) => name);
  assert.deepEqual(retried, ['onReservedMediaUploaded']);

  const httpsWithFailurePolicy = functions
    .filter(([, fn]) =>
      (Object.hasOwn(fn.__trigger, 'httpsTrigger') ||
        fn.__endpoint?.callableTrigger != null) &&
      Object.hasOwn(fn.__trigger, 'failurePolicy')
    )
    .map(([name]) => name);
  assert.deepEqual(httpsWithFailurePolicy, []);

  assert.deepEqual(configuredValues('failurePolicy'), {
    onReservedMediaUploaded: { retry: {} },
  });
  assert.deepEqual(configuredValues('maxInstances'), {
    getPrivateMediaBytes: 20,
    uploadPrivateMediaBytes: 20,
    confirmMediaUpload: 20,
    cleanupExpiredMediaUploads: 1,
  });
  assert.deepEqual(configuredValues('timeout'), {
    getPrivateMediaBytes: '30s',
    uploadPrivateMediaBytes: '120s',
    confirmMediaUpload: '60s',
    cleanupExpiredMediaUploads: '540s',
    listDiscoveryProfiles: '30s',
    deleteAccount: '540s',
    processAccountDeletionJobs: '540s',
  });
  assert.deepEqual(configuredValues('availableMemoryMb'), {
    getPrivateMediaBytes: 512,
    uploadPrivateMediaBytes: 1024,
    confirmMediaUpload: 512,
    cleanupExpiredMediaUploads: 512,
    listDiscoveryProfiles: 512,
    deleteAccount: 512,
    processAccountDeletionJobs: 512,
  });
});

test('source gives every specialized runtime a fresh regional builder', () => {
  assert.doesNotMatch(source, /regionalFunctions\s*\.\s*runWith\s*\(/);

  const runWithCalls = [...source.matchAll(/\.runWith\s*\(/g)].length;
  const freshRegionalRunWithCalls = [
    ...source.matchAll(
      /functions\.region\(FUNCTION_REGION\)\s*\.runWith\s*\(/g
    ),
  ].length;
  assert.equal(runWithCalls, 9);
  assert.equal(freshRegionalRunWithCalls, runWithCalls);

  const enforceAppCheckExports = [
    'reserveMediaUploadV2',
    'uploadPrivateMediaBytes',
  ];
  for (const name of enforceAppCheckExports) {
    assert.match(exportSource(name), /enforceAppCheck:\s*true/);
  }
  assert.equal(
    [...source.matchAll(/enforceAppCheck:\s*true/g)].length,
    enforceAppCheckExports.length
  );

  assert.match(
    exportSource('uploadPrivateMediaBytes'),
    /consumeAppCheckToken:\s*true/
  );
  assert.equal([...source.matchAll(/consumeAppCheckToken:\s*true/g)].length, 1);
});
