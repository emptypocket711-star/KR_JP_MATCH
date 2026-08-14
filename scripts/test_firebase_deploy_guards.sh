#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hana-deploy-guards.XXXXXX")"
BIN_DIR="$TEST_DIR/bin"
CALL_LOG="$TEST_DIR/calls.log"
STDERR_LOG="$TEST_DIR/stderr.log"

cleanup() {
  rm -rf -- "$TEST_DIR"
}
trap cleanup EXIT

mkdir -p "$BIN_DIR"

cat > "$BIN_DIR/firebase" <<'FIREBASE'
#!/usr/bin/env bash
set -euo pipefail
printf 'firebase %s\n' "$*" >> "$HANA_TEST_CALL_LOG"
if [[ "${1:-}" == "functions:list" ]]; then
  printf '%s\n' '{"status":"success","result":[{"id":"startChat","project":"hana-e2ee6","region":"us-central1"}]}'
fi
FIREBASE

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
  HANA_CONFIRM_STAGING_STRICT_MEDIA_RULES_LIVE=hana-e2ee6-strict-private-media-live \
  HANA_CONFIRM_STAGING_FUNCTION_RETRY_POLICY=hana-e2ee6-onreservedmediauploaded-retry-only \
  HANA_CONFIRM_PRIVATE_MEDIA_STRICT_CUTOVER=hana-e2ee6-private-media-strict-cutover \
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
  firestore:rules \
  storage \
  functions:uploadPrivateMediaBytes \
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
run_staging firestore:rules,storage
grep -Fxq \
  'firebase deploy --project hana-e2ee6 --only firestore:rules,storage' \
  "$CALL_LOG"

: > "$CALL_LOG"
run_staging functions
grep -Fxq \
  'firebase deploy --project hana-e2ee6 --only functions --force' \
  "$CALL_LOG"

for target in functions firestore:indexes firestore:rules,storage hosting
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
