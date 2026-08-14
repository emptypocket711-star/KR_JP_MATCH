#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'firebase/functions/src/index.ts');
const storageRulesPath = path.join(root, 'firebase/storage.rules');
const productionTransitionManifestPath = path.join(
  root,
  'firebase/production-transitional-media-contract.json',
);
const expectedTransitionContract =
  'hana-private-media-v1-v2-production-transition-v1';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readRequired(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`Required private-media rollout file is missing: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function requireToken(source, token, label) {
  if (!source.includes(token)) {
    fail(`Private-media rollout contract is missing ${label}: ${token}`);
  }
}

function matchBlock(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) fail(`Strict Storage Rules block is missing: ${marker}`);
  const next = source.indexOf('\n    match /', start + marker.length);
  return source.slice(start, next < 0 ? source.length : next);
}

function sha256(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(`Required private-media rollout file is missing: ${filePath}`);
  }
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

function validateProductionTransitionArtifact() {
  const manifestSource = readRequired(productionTransitionManifestPath);
  let manifest;
  try {
    manifest = JSON.parse(manifestSource);
  } catch (error) {
    fail(`Cannot parse production transitional media manifest: ${error.message}`);
  }
  const expectedRulesPath = 'firebase/storage.production.transitional.rules';
  const expectedMatrixPath =
    'firebase/test/storage.production.transitional.rules.test.js';
  if (
    manifest?.contract !== expectedTransitionContract ||
    manifest?.storageRules !== expectedRulesPath ||
    manifest?.testMatrix !== expectedMatrixPath ||
    !/^[a-f0-9]{64}$/.test(manifest?.storageRulesSha256 ?? '') ||
    !/^[a-f0-9]{64}$/.test(manifest?.testMatrixSha256 ?? '')
  ) {
    fail(
      'Production transitional media manifest must bind the reviewed V1/V2 ' +
        'contract, exact artifact paths, and both SHA-256 digests.',
    );
  }
  const rulesPath = path.join(root, expectedRulesPath);
  const matrixPath = path.join(root, expectedMatrixPath);
  if (sha256(rulesPath) !== manifest.storageRulesSha256) {
    fail('Production transitional Storage Rules digest does not match review.');
  }
  if (sha256(matrixPath) !== manifest.testMatrixSha256) {
    fail('Production transitional V1/V2 test matrix digest does not match review.');
  }
  const matrix = readRequired(matrixPath);
  for (const token of [
    'V1 direct canonical create succeeds',
    'V2 direct canonical create fails',
    'legacy writer compatibility succeeds',
    'strict cutover direct create fails',
  ]) {
    requireToken(matrix, token, 'production V1/V2 test-matrix case');
  }
}

const functionsSource = readRequired(indexPath);
for (const [token, label] of [
  ['export const reserveMediaUpload =', 'legacy V1 reservation endpoint'],
  ['export const reserveMediaUploadV2 =', 'V2 reservation endpoint'],
  ['export const uploadPrivateMediaBytes =', 'V2 server upload endpoint'],
  ['export const confirmMediaUpload =', 'legacy V1 confirmation endpoint'],
]) {
  requireToken(functionsSource, token, label);
}

if (!/reserveMediaUploadForProtocol\(data,\s*context,\s*1\)/s.test(functionsSource)) {
  fail('reserveMediaUpload must remain explicitly bound to protocol V1.');
}
if (
  !/reserveMediaUploadForProtocol\(\s*data,\s*context,\s*mediaUploadProtocolVersion\s*\)/s
    .test(functionsSource)
) {
  fail('reserveMediaUploadV2 must remain bound to mediaUploadProtocolVersion.');
}

const storageRules = readRequired(storageRulesPath);
for (const marker of [
  'match /profile_media/{uid}/{authorizationId}/image.jpg {',
  'match /chat_images/{matchId}/{uid}/{authorizationId}/image.jpg {',
]) {
  const block = matchBlock(storageRules, marker);
  if (!/allow\s+create:\s*if\s+false\s*;/.test(block)) {
    fail(`Canonical direct create must be denied in strict rules: ${marker}`);
  }
  for (const operation of ['get', 'list', 'update', 'delete']) {
    if (!new RegExp(`allow\\s+${operation}:\\s*if\\s+false\\s*;`).test(block)) {
      fail(`Canonical direct ${operation} must be denied in strict rules: ${marker}`);
    }
  }
}

if (process.argv.includes('--require-production-transition')) {
  validateProductionTransitionArtifact();
}

console.log(
  'Private-media rollout contract verified: V1 compatibility endpoints are ' +
    'retained, V2 server upload endpoints exist, and strict canonical direct ' +
    'Storage access is denied.'
);
