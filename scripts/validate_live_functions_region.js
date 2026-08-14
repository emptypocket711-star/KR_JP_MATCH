#!/usr/bin/env node

'use strict';

const fs = require('node:fs');

function fail(message) {
  console.error(message);
  process.exit(1);
}

const [projectId, expectedRegion, inventoryPath] = process.argv.slice(2);
if (!projectId || !expectedRegion || !inventoryPath) {
  fail(
    'Usage: validate_live_functions_region.js <project-id> <expected-region> <inventory-json>'
  );
}

let inventory;
try {
  inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
} catch (error) {
  fail(`Cannot parse Firebase Functions inventory: ${error.message}`);
}

if (inventory?.status !== 'success' || !Array.isArray(inventory?.result)) {
  fail('Firebase Functions inventory did not return a successful result array.');
}

if (inventory.result.length === 0) {
  fail(
    `No deployed Functions found in ${projectId}; refusing to infer a safe target region.`
  );
}

const invalid = inventory.result.filter(
  (entry) =>
    !entry ||
    entry.project !== projectId ||
    typeof entry.id !== 'string' ||
    entry.id.length === 0 ||
    entry.region !== expectedRegion
);
if (invalid.length > 0) {
  const summary = invalid
    .slice(0, 10)
    .map(
      (entry) =>
        `${entry?.id ?? 'unknown'}:${entry?.project ?? 'missing-project'}:` +
        `${entry?.region ?? 'missing-region'}`
    )
    .join(', ');
  fail(
    `Functions inventory does not match ${projectId}/${expectedRegion}: ${summary}`
  );
}

console.log(
  `Verified ${inventory.result.length} deployed Functions in ` +
    `${projectId}/${expectedRegion}.`
);
