#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hana-app-check-iam.XXXXXX")"
BIN_DIR="$TEST_DIR/bin"
CALL_LOG="$TEST_DIR/calls.log"
STDERR_LOG="$TEST_DIR/stderr.log"

cleanup() {
  rm -rf -- "$TEST_DIR"
}
trap cleanup EXIT

mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/gcloud" <<'GCLOUD'
#!/usr/bin/env bash
set -euo pipefail
printf 'gcloud %s\n' "$*" >> "$HANA_TEST_CALL_LOG"
if [[ "${HANA_TEST_ROLE_PRESENT:-}" == "true" ]]; then
  printf '%s\n' 'roles/firebaseappcheck.tokenVerifier'
fi
GCLOUD
chmod +x "$BIN_DIR/gcloud"

run_preflight() {
  PATH="$BIN_DIR:$PATH" \
  HANA_TEST_CALL_LOG="$CALL_LOG" \
    "$ROOT_DIR/scripts/preflight_app_check_replay_iam.sh" "$@"
}

: > "$CALL_LOG"
if HANA_TEST_ROLE_PRESENT=false run_preflight hana-e2ee6 2>"$STDERR_LOG"; then
  echo "App Check IAM preflight accepted a missing verifier role." >&2
  exit 1
fi
  grep -Fq 'App Check replay-protection IAM binding is missing.' "$STDERR_LOG"
for token in \
  'gcloud projects get-iam-policy hana-e2ee6' \
  'bindings.role=roles/firebaseappcheck.tokenVerifier' \
  'serviceAccount:hana-e2ee6@appspot.gserviceaccount.com'
do
  grep -Fq "$token" "$CALL_LOG"
done

: > "$CALL_LOG"
HANA_TEST_ROLE_PRESENT=true run_preflight hana-production-tokyo >/dev/null
for token in \
  'gcloud projects get-iam-policy hana-production-tokyo' \
  'serviceAccount:hana-production-tokyo@appspot.gserviceaccount.com'
do
  grep -Fq "$token" "$CALL_LOG"
done

: > "$CALL_LOG"
if HANA_TEST_ROLE_PRESENT=true run_preflight arbitrary-project 2>"$STDERR_LOG"; then
  echo "App Check IAM preflight accepted an arbitrary project." >&2
  exit 1
fi
if [[ -s "$CALL_LOG" ]]; then
  echo "Invalid project reached the live IAM lookup." >&2
  exit 1
fi

echo "App Check replay-protection IAM preflight tests passed."
