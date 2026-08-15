#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: scripts/preflight_functions_region.sh <project-id> <expected-region>" >&2
  exit 64
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ID="$1"
EXPECTED_REGION="$2"

case "$PROJECT_ID:$EXPECTED_REGION" in
  hana-e2ee6:us-central1|hana-production-tokyo:asia-northeast1) ;;
  *)
    echo "Unsupported Hana project/Functions region pair: $PROJECT_ID/$EXPECTED_REGION" >&2
    exit 64
    ;;
esac

INVENTORY_FILE="$(mktemp "${TMPDIR:-/tmp}/hana-functions-inventory.XXXXXX")"
trap 'rm -f "$INVENTORY_FILE"' EXIT

firebase functions:list \
  --project "$PROJECT_ID" \
  --json \
  --non-interactive >"$INVENTORY_FILE"

node "$ROOT_DIR/scripts/validate_live_functions_region.js" \
  "$PROJECT_ID" \
  "$EXPECTED_REGION" \
  "$INVENTORY_FILE"
