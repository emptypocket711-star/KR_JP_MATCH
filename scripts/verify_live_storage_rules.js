#!/usr/bin/env node

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function fail(message) {
  throw new Error(message);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function assertNoRulesApiOverride(environment) {
  const override = environment.FIREBASE_RULES_URL;
  if (typeof override === 'string' && override.length > 0) {
    fail(
      'FIREBASE_RULES_URL must be unset for live Google Rules verification.',
    );
  }
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) {
      fail(`Unexpected live Storage Rules verifier argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (value == null || value.startsWith('--')) {
      fail(`Missing value for ${argument}`);
    }
    values[argument.slice(2)] = value;
    index += 1;
  }
  return values;
}

function findFirebaseToolsRoot(firebaseCliPath) {
  if (typeof firebaseCliPath !== 'string' || firebaseCliPath.length === 0) {
    fail('The Firebase CLI path is required for live Rules verification.');
  }

  const resolvedCli = fs.realpathSync(firebaseCliPath);
  let current = path.dirname(resolvedCli);
  for (let depth = 0; depth < 10; depth += 1) {
    const candidates = [
      current,
      path.join(current, 'lib/node_modules/firebase-tools'),
      path.join(current, 'node_modules/firebase-tools'),
    ];
    for (const candidate of candidates) {
      if (
        fs.existsSync(path.join(candidate, 'lib/auth.js')) &&
        fs.existsSync(path.join(candidate, 'lib/gcp/rules.js'))
      ) {
        return candidate;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  fail(
    `Cannot locate firebase-tools internals from Firebase CLI: ${resolvedCli}`,
  );
}

async function verifyLiveStorageRules(options) {
  const {
    projectId,
    bucket,
    projectRoot,
    localRulesPath,
    auth,
    rules,
  } = options;
  if (!/^[a-z][a-z0-9-]{4,29}$/.test(projectId ?? '')) {
    fail('A valid exact Firebase project ID is required.');
  }
  if (bucket !== `${projectId}.firebasestorage.app`) {
    fail(`Unexpected default Storage bucket for ${projectId}: ${bucket}`);
  }
  if (!path.isAbsolute(projectRoot ?? '')) {
    fail('An absolute Firebase project root is required.');
  }
  if (!path.isAbsolute(localRulesPath ?? '')) {
    fail('An absolute local Storage Rules path is required.');
  }

  const account = auth.getProjectDefaultAccount(projectRoot);
  if (!account?.user?.email || !account?.tokens) {
    fail(
      'No Firebase CLI account is configured for this project. Reauthenticate before deployment.',
    );
  }
  auth.setActiveAccount({}, account);

  const expectedReleaseName =
    `projects/${projectId}/releases/firebase.storage/${bucket}`;
  const releases = await rules.listAllReleases(projectId);
  const matchingReleases = releases.filter(
    (release) => release?.name === expectedReleaseName,
  );
  if (matchingReleases.length !== 1) {
    fail(
      `Expected exactly one live Storage Rules release ${expectedReleaseName}; ` +
        `found ${matchingReleases.length}.`,
    );
  }

  const rulesetName = matchingReleases[0].rulesetName;
  const expectedRulesetPrefix = `projects/${projectId}/rulesets/`;
  if (
    typeof rulesetName !== 'string' ||
    !rulesetName.startsWith(expectedRulesetPrefix) ||
    !/^[A-Za-z0-9-]+$/.test(rulesetName.slice(expectedRulesetPrefix.length))
  ) {
    fail(`Live Storage release points outside ${projectId}: ${rulesetName}`);
  }

  const sourceFiles = await rules.getRulesetContent(rulesetName);
  if (!Array.isArray(sourceFiles) || sourceFiles.length !== 1) {
    fail(
      `Live Storage Rules must contain exactly one source file; found ` +
        `${Array.isArray(sourceFiles) ? sourceFiles.length : 'invalid content'}.`,
    );
  }
  const sourceFile = sourceFiles[0];
  if (
    sourceFile?.name !== 'firebase/storage.rules' ||
    typeof sourceFile?.content !== 'string'
  ) {
    fail(
      'Live Storage Rules must be the exact firebase/storage.rules source file.',
    );
  }

  const localRules = fs.readFileSync(localRulesPath);
  const liveRules = Buffer.from(sourceFile.content, 'utf8');
  const localDigest = sha256(localRules);
  const liveDigest = sha256(liveRules);
  if (liveDigest !== localDigest || !liveRules.equals(localRules)) {
    fail(
      `Live Storage Rules SHA-256 ${liveDigest} does not match the reviewed ` +
        `local strict candidate ${localDigest}.`,
    );
  }

  return {
    releaseName: expectedReleaseName,
    rulesetName,
    sha256: liveDigest,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const required = [
    'project',
    'bucket',
    'project-root',
    'local-rules',
    'firebase-cli',
  ];
  for (const name of required) {
    if (typeof args[name] !== 'string' || args[name].length === 0) {
      fail(`Missing required --${name} argument.`);
    }
  }

  assertNoRulesApiOverride(process.env);
  const firebaseToolsRoot = findFirebaseToolsRoot(args['firebase-cli']);
  const auth = require(path.join(firebaseToolsRoot, 'lib/auth.js'));
  const rules = require(path.join(firebaseToolsRoot, 'lib/gcp/rules.js'));
  const result = await verifyLiveStorageRules({
    projectId: args.project,
    bucket: args.bucket,
    projectRoot: path.resolve(args['project-root']),
    localRulesPath: path.resolve(args['local-rules']),
    auth,
    rules,
  });

  console.log(
    `Live Storage Rules verified read-only for ${args.project}: ` +
      `${result.sha256}`,
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Live Storage Rules verification failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  assertNoRulesApiOverride,
  findFirebaseToolsRoot,
  parseArgs,
  sha256,
  verifyLiveStorageRules,
};
