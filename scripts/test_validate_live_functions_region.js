#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const validator = path.join(__dirname, 'validate_live_functions_region.js');
const tempDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'hana-functions-region-test-')
);

function run(inventory, project = 'hana-e2ee6', region = 'us-central1') {
  const inventoryPath = path.join(tempDirectory, `${Math.random()}.json`);
  fs.writeFileSync(inventoryPath, JSON.stringify(inventory));
  return spawnSync(process.execPath, [validator, project, region, inventoryPath], {
    encoding: 'utf8',
  });
}

try {
  const valid = run({
    status: 'success',
    result: [
      { id: 'startChat', project: 'hana-e2ee6', region: 'us-central1' },
      { id: 'sendMessage', project: 'hana-e2ee6', region: 'us-central1' },
    ],
  });
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /Verified 2 deployed Functions/);

  const mixed = run({
    status: 'success',
    result: [
      { id: 'startChat', project: 'hana-e2ee6', region: 'us-central1' },
      { id: 'sendMessage', project: 'hana-e2ee6', region: 'asia-northeast1' },
    ],
  });
  assert.notEqual(mixed.status, 0);
  assert.match(mixed.stderr, /does not match/);

  const empty = run({ status: 'success', result: [] });
  assert.notEqual(empty.status, 0);
  assert.match(empty.stderr, /No deployed Functions/);

  const wrongProject = run({
    status: 'success',
    result: [
      { id: 'startChat', project: 'other-project', region: 'us-central1' },
    ],
  });
  assert.notEqual(wrongProject.status, 0);

  const malformedPath = path.join(tempDirectory, 'malformed.json');
  fs.writeFileSync(malformedPath, '{broken');
  const malformed = spawnSync(
    process.execPath,
    [validator, 'hana-e2ee6', 'us-central1', malformedPath],
    { encoding: 'utf8' }
  );
  assert.notEqual(malformed.status, 0);
  assert.match(malformed.stderr, /Cannot parse/);

  console.log('Live Functions region inventory validator tests passed.');
} finally {
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}
