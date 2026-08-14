#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hana-deploy-guards.XXXXXX")"
BIN_DIR="$TEST_DIR/bin"
FIREBASE_TOOLS_DIR="$TEST_DIR/lib/node_modules/firebase-tools"
CALL_LOG="$TEST_DIR/calls.log"
STDERR_LOG="$TEST_DIR/stderr.log"

cleanup() {
  rm -rf -- "$TEST_DIR"
}
trap cleanup EXIT

mkdir -p "$BIN_DIR" "$FIREBASE_TOOLS_DIR/lib/gcp"

cat > "$BIN_DIR/firebase" <<'FIREBASE'
#!/usr/bin/env bash
set -euo pipefail
printf 'firebase %s\n' "$*" >> "$HANA_TEST_CALL_LOG"
if [[ "${1:-}" == "functions:list" ]]; then
  printf '%s\n' '{"status":"success","result":[{"id":"startChat","project":"hana-e2ee6","region":"us-central1"}]}'
fi
FIREBASE

cat > "$FIREBASE_TOOLS_DIR/lib/auth.js" <<'AUTH'
'use strict';

exports.getProjectDefaultAccount = () => ({
  user: { email: 'operator@example.test' },
  tokens: { refresh_token: 'not-a-real-token' },
});
exports.setActiveAccount = () => {};
AUTH

cat > "$FIREBASE_TOOLS_DIR/lib/gcp/rules.js" <<'RULES'
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function record(value) {
  fs.appendFileSync(process.env.HANA_TEST_CALL_LOG, `${value}\n`);
}

exports.listAllReleases = async (projectId) => {
  record(`rules list ${projectId}`);
  return [{
    name:
      'projects/hana-e2ee6/releases/firebase.storage/' +
      'hana-e2ee6.firebasestorage.app',
    rulesetName: 'projects/hana-e2ee6/rulesets/reviewed-ruleset',
  }];
};

exports.getRulesetContent = async (rulesetName) => {
  record(`rules get ${rulesetName}`);
  const sourcePath = path.join(
    process.env.HANA_TEST_REPO_ROOT,
    'firebase/storage.rules',
  );
  let content = fs.readFileSync(sourcePath, 'utf8');
  if (process.env.HANA_TEST_STORAGE_RULES_DRIFT === 'true') {
    content += '\n// simulated live drift';
  }
  return [{ name: 'firebase/storage.rules', content }];
};
RULES

cat > "$BIN_DIR/gcloud" <<'GCLOUD'
#!/usr/bin/env bash
set -euo pipefail
printf 'gcloud %s\n' "$*" >> "$HANA_TEST_CALL_LOG"
if [[ "${1:-}" == "projects" && "${2:-}" == "describe" ]]; then
  printf '%s\n' '701242900024'
else
  printf '%s\n' 'roles/firebaseappcheck.tokenVerifier'
  printf '%s\n' 'roles/firebaserules.firestoreServiceAgent'
fi
GCLOUD

cat > "$BIN_DIR/npm" <<'NPM'
#!/usr/bin/env bash
set -euo pipefail
printf 'npm %s\n' "$*" >> "$HANA_TEST_CALL_LOG"
NPM

cat > "$BIN_DIR/rg" <<'RG'
#!/usr/bin/env bash
echo "deploy guards must not require ripgrep" >&2
exit 127
RG

chmod +x "$BIN_DIR/firebase" "$BIN_DIR/gcloud" "$BIN_DIR/npm" "$BIN_DIR/rg"

grep -Fq \
  '"deploy": "../../scripts/deploy_staging_firebase.sh functions"' \
  "$ROOT_DIR/firebase/functions/package.json"

run_staging() {
  PATH="$BIN_DIR:$PATH" \
  HANA_TEST_CALL_LOG="$CALL_LOG" \
  HANA_FUNCTIONS_LIVE_REGION_CONFIRMED=us-central1 \
  HANA_CONFIRM_STAGING_STRICT_MEDIA_FUNCTIONS=hana-e2ee6-private-media-strict-functions \
  HANA_CONFIRM_STAGING_FIRESTORE_RULES_PENDING_DIRECT_ROOM=hana-e2ee6-firestore-rules-pending-direct-room \
  HANA_CONFIRM_STAGING_DIRECT_ROOM_FIRESTORE_CUTOVER=hana-e2ee6-direct-room-firestore-cutover \
  HANA_CONFIRM_STAGING_FUNCTION_RETRY_POLICY=hana-e2ee6-onreservedmediauploaded-retry-only \
  HANA_CONFIRM_PRIVATE_MEDIA_STRICT_CUTOVER=hana-e2ee6-private-media-strict-cutover \
  HANA_TEST_REPO_ROOT="$ROOT_DIR" \
    "$ROOT_DIR/scripts/deploy_staging_firebase.sh" "$@"
}

assert_no_external_calls() {
  if [[ -s "$CALL_LOG" ]]; then
    echo "Rejected deploy target reached an external command stub." >&2
    cat "$CALL_LOG" >&2
    exit 1
  fi
}

for target in \
  storage \
  functions:uploadPrivateMediaBytes \
  functions:listActiveChats \
  hosting \
  firestore:indexes,functions \
  firestore:rules,storage,functions
do
  : > "$CALL_LOG"
  if run_staging "$target" 2> "$STDERR_LOG"; then
    echo "Staging deploy accepted unsupported target: $target" >&2
    exit 1
  fi
  grep -Fq 'Unsupported staging Firebase deploy target' "$STDERR_LOG"
  assert_no_external_calls
done

: > "$CALL_LOG"
if run_staging 2> "$STDERR_LOG"; then
  echo "Staging deploy accepted a missing target." >&2
  exit 1
fi
grep -Fq 'Choose an explicit target' "$STDERR_LOG"
assert_no_external_calls

: > "$CALL_LOG"
run_staging firestore:indexes
grep -Fxq \
  'firebase deploy --project hana-e2ee6 --only firestore:indexes' \
  "$CALL_LOG"

: > "$CALL_LOG"
if PATH="$BIN_DIR:$PATH" HANA_TEST_CALL_LOG="$CALL_LOG" \
  HANA_CONFIRM_STAGING_DIRECT_ROOM_FIRESTORE_CUTOVER=wrong \
  "$ROOT_DIR/scripts/deploy_staging_firebase.sh" firestore:rules \
  2> "$STDERR_LOG"
then
  echo "Staging Firestore cutover accepted a wrong attestation." >&2
  exit 1
fi
grep -Fq 'one-record direct-room backfill/re-audit' "$STDERR_LOG"
assert_no_external_calls

: > "$CALL_LOG"
if HANA_TEST_STORAGE_RULES_DRIFT=true run_staging firestore:rules \
  2> "$STDERR_LOG"
then
  echo "Staging Firestore cutover accepted drifted live Storage Rules." >&2
  exit 1
fi
grep -Fq 'does not match the reviewed local strict candidate' "$STDERR_LOG"
if grep -Fq 'firebase deploy ' "$CALL_LOG"; then
  echo "Storage Rules drift reached Firestore deploy." >&2
  exit 1
fi

: > "$CALL_LOG"
run_staging firestore:rules
grep -Fxq 'rules list hana-e2ee6' "$CALL_LOG"
grep -Fxq \
  'rules get projects/hana-e2ee6/rulesets/reviewed-ruleset' \
  "$CALL_LOG"
grep -Fxq \
  'firebase deploy --project hana-e2ee6 --only firestore:rules' \
  "$CALL_LOG"

: > "$CALL_LOG"
if PATH="$BIN_DIR:$PATH" HANA_TEST_CALL_LOG="$CALL_LOG" \
  HANA_CONFIRM_PRIVATE_MEDIA_STRICT_CUTOVER=hana-e2ee6-private-media-strict-cutover \
  "$ROOT_DIR/scripts/deploy_staging_firebase.sh" firestore:rules,storage \
  2> "$STDERR_LOG"
then
  echo "Combined Rules cutover bypassed the direct-room attestation." >&2
  exit 1
fi
grep -Fq 'one-record direct-room backfill/re-audit' "$STDERR_LOG"
assert_no_external_calls

: > "$CALL_LOG"
run_staging firestore:rules,storage
grep -Fxq \
  'firebase deploy --project hana-e2ee6 --only firestore:rules,storage' \
  "$CALL_LOG"

: > "$CALL_LOG"
if PATH="$BIN_DIR:$PATH" HANA_TEST_CALL_LOG="$CALL_LOG" \
  HANA_FUNCTIONS_LIVE_REGION_CONFIRMED=us-central1 \
  HANA_CONFIRM_STAGING_STRICT_MEDIA_FUNCTIONS=hana-e2ee6-private-media-strict-functions \
  HANA_CONFIRM_STAGING_FUNCTION_RETRY_POLICY=hana-e2ee6-onreservedmediauploaded-retry-only \
  "$ROOT_DIR/scripts/deploy_staging_firebase.sh" functions \
  2> "$STDERR_LOG"
then
  echo "Staging Functions accepted no Firestore rollout state." >&2
  exit 1
fi
grep -Fq 'Choose exactly one reviewed staging Firestore rollout state' "$STDERR_LOG"
assert_no_external_calls

: > "$CALL_LOG"
if PATH="$BIN_DIR:$PATH" HANA_TEST_CALL_LOG="$CALL_LOG" \
  HANA_FUNCTIONS_LIVE_REGION_CONFIRMED=us-central1 \
  HANA_CONFIRM_STAGING_STRICT_MEDIA_FUNCTIONS=hana-e2ee6-private-media-strict-functions \
  HANA_CONFIRM_STAGING_FIRESTORE_RULES_PENDING_DIRECT_ROOM=hana-e2ee6-firestore-rules-pending-direct-room \
  HANA_CONFIRM_STAGING_STRICT_MEDIA_RULES_LIVE=hana-e2ee6-strict-private-media-live \
  HANA_CONFIRM_STAGING_FUNCTION_RETRY_POLICY=hana-e2ee6-onreservedmediauploaded-retry-only \
  "$ROOT_DIR/scripts/deploy_staging_firebase.sh" functions \
  2> "$STDERR_LOG"
then
  echo "Staging Functions accepted conflicting Firestore rollout states." >&2
  exit 1
fi
grep -Fq 'Do not set both phrases' "$STDERR_LOG"
assert_no_external_calls

: > "$CALL_LOG"
if FIREBASE_RULES_URL=http://127.0.0.1:9999 run_staging functions \
  2> "$STDERR_LOG"
then
  echo "Staging Functions accepted a Firebase Rules API override." >&2
  exit 1
fi
grep -Fq 'FIREBASE_RULES_URL must be unset' "$STDERR_LOG"
assert_no_external_calls

: > "$CALL_LOG"
if HANA_TEST_STORAGE_RULES_DRIFT=true run_staging functions \
  2> "$STDERR_LOG"
then
  echo "Staging Functions accepted drifted live Storage Rules." >&2
  exit 1
fi
grep -Fq 'does not match the reviewed local strict candidate' "$STDERR_LOG"
if grep -Fq 'firebase deploy ' "$CALL_LOG"; then
  echo "Storage Rules drift reached firebase deploy." >&2
  exit 1
fi

: > "$CALL_LOG"
run_staging functions
grep -Fxq 'rules list hana-e2ee6' "$CALL_LOG"
grep -Fxq \
  'rules get projects/hana-e2ee6/rulesets/reviewed-ruleset' \
  "$CALL_LOG"
grep -Fxq \
  'firebase deploy --project hana-e2ee6 --only functions --force' \
  "$CALL_LOG"

for target in functions firestore:indexes firestore:rules firestore:rules,storage hosting
do
  : > "$CALL_LOG"
  if PATH="$BIN_DIR:$PATH" HANA_TEST_CALL_LOG="$CALL_LOG" \
    "$ROOT_DIR/scripts/deploy_prod_firebase.sh" "$target" 2> "$STDERR_LOG"
  then
    echo "Production deny-only sentinel accepted target: $target" >&2
    exit 1
  fi
  grep -Fq 'Production Firebase deployment is disabled' "$STDERR_LOG"
  assert_no_external_calls
done

: > "$CALL_LOG"
if PATH="$BIN_DIR:$PATH" HANA_TEST_CALL_LOG="$CALL_LOG" \
  "$ROOT_DIR/scripts/deploy_prod_firebase.sh" 2> "$STDERR_LOG"
then
  echo "Production deny-only sentinel accepted a missing target." >&2
  exit 1
fi
grep -Fq 'Production Firebase deployment is disabled' "$STDERR_LOG"
assert_no_external_calls

echo "Firebase deploy target guard tests passed."
