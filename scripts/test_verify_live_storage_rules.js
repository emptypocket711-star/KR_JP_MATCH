#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  assertNoRulesApiOverride,
  findFirebaseToolsRoot,
  verifyLiveStorageRules,
} = require('./verify_live_storage_rules');

const projectId = 'hana-e2ee6';
const bucket = `${projectId}.firebasestorage.app`;
const releaseName =
  `projects/${projectId}/releases/firebase.storage/${bucket}`;
const rulesetName = `projects/${projectId}/rulesets/reviewed-ruleset`;
const projectRoot = path.resolve(__dirname, '..');
const localRulesPath = path.join(projectRoot, 'firebase/storage.rules');
const localRules = fs.readFileSync(localRulesPath, 'utf8');

function dependencies(overrides = {}) {
  return {
    auth: {
      getProjectDefaultAccount: () => ({
        user: { email: 'operator@example.test' },
        tokens: { refresh_token: 'not-a-real-token' },
      }),
      setActiveAccount: () => {},
      ...overrides.auth,
    },
    rules: {
      listAllReleases: async () => [{ name: releaseName, rulesetName }],
      getRulesetContent: async () => [{
        name: 'firebase/storage.rules',
        content: localRules,
      }],
      ...overrides.rules,
    },
  };
}

function verify(overrides = {}) {
  const deps = dependencies(overrides);
  return verifyLiveStorageRules({
    projectId,
    bucket,
    projectRoot,
    localRulesPath,
    ...deps,
  });
}

test('accepts only the exact live staging Storage release and local source', async () => {
  const result = await verify();
  assert.equal(result.releaseName, releaseName);
  assert.equal(result.rulesetName, rulesetName);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
});

test('fails closed without a configured Firebase CLI account', async () => {
  await assert.rejects(
    verify({ auth: { getProjectDefaultAccount: () => undefined } }),
    /Reauthenticate before deployment/,
  );
});

test('rejects a Firebase Rules API endpoint override', () => {
  assert.throws(
    () => assertNoRulesApiOverride({
      FIREBASE_RULES_URL: 'http://127.0.0.1:9999',
    }),
    /must be unset for live Google Rules verification/,
  );
  assert.doesNotThrow(() => assertNoRulesApiOverride({}));
});

test('rejects missing, duplicate, or cross-project Storage releases', async () => {
  await assert.rejects(
    verify({ rules: { listAllReleases: async () => [] } }),
    /found 0/,
  );
  await assert.rejects(
    verify({
      rules: {
        listAllReleases: async () => [
          { name: releaseName, rulesetName },
          { name: releaseName, rulesetName },
        ],
      },
    }),
    /found 2/,
  );
  await assert.rejects(
    verify({
      rules: {
        listAllReleases: async () => [{
          name: releaseName,
          rulesetName: 'projects/attacker/rulesets/not-staging',
        }],
      },
    }),
    /points outside hana-e2ee6/,
  );
});

test('rejects an unexpected source set or any content drift', async () => {
  await assert.rejects(
    verify({
      rules: {
        getRulesetContent: async () => [
          { name: 'firebase/storage.rules', content: localRules },
          { name: 'extra.rules', content: 'allow read: if true;' },
        ],
      },
    }),
    /exactly one source file/,
  );
  await assert.rejects(
    verify({
      rules: {
        getRulesetContent: async () => [{
          name: 'firebase/storage.rules',
          content: `${localRules}\n// drift`,
        }],
      },
    }),
    /does not match the reviewed local strict candidate/,
  );
});

test('discovers both Homebrew-style and package-root firebase-tools layouts', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hana-rules-tool-'));
  try {
    const cliPath = path.join(tempRoot, 'bin/firebase');
    const toolsRoot = path.join(
      tempRoot,
      'lib/node_modules/firebase-tools',
    );
    fs.mkdirSync(path.dirname(cliPath), { recursive: true });
    fs.mkdirSync(path.join(toolsRoot, 'lib/gcp'), { recursive: true });
    fs.writeFileSync(cliPath, '#!/usr/bin/env node\n');
    fs.writeFileSync(path.join(toolsRoot, 'lib/auth.js'), 'module.exports = {};\n');
    fs.writeFileSync(
      path.join(toolsRoot, 'lib/gcp/rules.js'),
      'module.exports = {};\n',
    );
    assert.equal(findFirebaseToolsRoot(cliPath), fs.realpathSync(toolsRoot));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
