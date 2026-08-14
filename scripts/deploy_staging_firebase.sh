#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TARGET="${1:-}"
EXPECTED_PROJECT="hana-e2ee6"
EXPECTED_REGION="us-central1"
EXPECTED_STORAGE_BUCKET="hana-e2ee6.firebasestorage.app"
STRICT_MEDIA_TARGET="firestore:rules,storage"
DIRECT_ROOM_FIRESTORE_TARGET="firestore:rules"
STRICT_MEDIA_CONFIRMATION="hana-e2ee6-private-media-strict-cutover"
STRICT_MEDIA_FUNCTIONS_CONFIRMATION="hana-e2ee6-private-media-strict-functions"
STRICT_MEDIA_RULES_LIVE_CONFIRMATION="hana-e2ee6-strict-private-media-live"
DIRECT_ROOM_FIRESTORE_PENDING_CONFIRMATION="hana-e2ee6-firestore-rules-pending-direct-room"
DIRECT_ROOM_FIRESTORE_CUTOVER_CONFIRMATION="hana-e2ee6-direct-room-firestore-cutover"
RETRY_POLICY_CONFIRMATION="hana-e2ee6-onreservedmediauploaded-retry-only"
FIREBASE_DEPLOY_ARGS=()

verify_live_staging_storage_rules() {
  local firebase_cli
  firebase_cli="$(command -v firebase || true)"
  if [[ -z "$firebase_cli" ]]; then
    echo "Firebase CLI is required for live Storage Rules verification." >&2
    exit 64
  fi
  node scripts/verify_live_storage_rules.js \
    --project "$EXPECTED_PROJECT" \
    --bucket "$EXPECTED_STORAGE_BUCKET" \
    --project-root "$ROOT_DIR" \
    --local-rules "$ROOT_DIR/firebase/storage.rules" \
    --firebase-cli "$firebase_cli"
}

if [[ -z "$TARGET" ]]; then
  cat <<'USAGE' >&2
Usage:
  HANA_FUNCTIONS_LIVE_REGION_CONFIRMED=us-central1 \
  HANA_CONFIRM_STAGING_FIRESTORE_RULES_PENDING_DIRECT_ROOM=hana-e2ee6-firestore-rules-pending-direct-room \
    scripts/deploy_staging_firebase.sh functions
  scripts/deploy_staging_firebase.sh firestore:indexes
  HANA_CONFIRM_STAGING_DIRECT_ROOM_FIRESTORE_CUTOVER=hana-e2ee6-direct-room-firestore-cutover \
    scripts/deploy_staging_firebase.sh firestore:rules
  HANA_CONFIRM_STAGING_DIRECT_ROOM_FIRESTORE_CUTOVER=hana-e2ee6-direct-room-firestore-cutover \
  HANA_CONFIRM_PRIVATE_MEDIA_STRICT_CUTOVER=hana-e2ee6-private-media-strict-cutover \
    scripts/deploy_staging_firebase.sh firestore:rules,storage

Choose an explicit target. The script intentionally has no deploy-all default.
USAGE
  exit 64
fi

case "$TARGET" in
  functions | firestore:indexes | "$DIRECT_ROOM_FIRESTORE_TARGET" | "$STRICT_MEDIA_TARGET") ;;
  *)
    cat <<ERROR >&2
Unsupported staging Firebase deploy target: $TARGET

Allowed exact targets are:
  functions
  firestore:indexes
  $DIRECT_ROOM_FIRESTORE_TARGET
  $STRICT_MEDIA_TARGET
ERROR
    exit 64
    ;;
esac

if [[ "$TARGET" == *"functions"* && \
  "${HANA_FUNCTIONS_LIVE_REGION_CONFIRMED:-}" != "$EXPECTED_REGION" ]]; then
  cat <<'ERROR' >&2
Staging Functions deployment is region-locked. Reauthenticate, inventory the
currently deployed callable and trigger regions, and confirm that this source
will update the single us-central1 trigger set without creating duplicates.
After that reviewed check, rerun with:
  HANA_FUNCTIONS_LIVE_REGION_CONFIRMED=us-central1
ERROR
  exit 64
fi

if [[ "$TARGET" == *"functions"* ]]; then
  if [[ "${HANA_CONFIRM_STAGING_STRICT_MEDIA_FUNCTIONS:-}" != "$STRICT_MEDIA_FUNCTIONS_CONFIRMATION" ]]; then
    cat <<'ERROR' >&2
Staging private-media V2 Functions are part of one destructive maintenance
window. Confirm no supported staging legacy client remains, announce the media
outage, deploy required indexes and wait for READY, and confirm strict Storage
Rules are already live before this Functions step. Rerun with:
  HANA_CONFIRM_STAGING_STRICT_MEDIA_FUNCTIONS=hana-e2ee6-private-media-strict-functions
This acknowledgement does not verify the live Storage Rules by itself.
ERROR
    exit 64
  fi
  FIRESTORE_PENDING=false
  FIRESTORE_STRICT_LIVE=false
  if [[ "${HANA_CONFIRM_STAGING_FIRESTORE_RULES_PENDING_DIRECT_ROOM:-}" == "$DIRECT_ROOM_FIRESTORE_PENDING_CONFIRMATION" ]]; then
    FIRESTORE_PENDING=true
  fi
  if [[ "${HANA_CONFIRM_STAGING_STRICT_MEDIA_RULES_LIVE:-}" == "$STRICT_MEDIA_RULES_LIVE_CONFIRMATION" ]]; then
    FIRESTORE_STRICT_LIVE=true
  fi
  if [[ "$FIRESTORE_PENDING" == "$FIRESTORE_STRICT_LIVE" ]]; then
    cat <<'ERROR' >&2
Choose exactly one reviewed staging Firestore rollout state before deploying
the full Functions set.

If the tightened direct-room Firestore Rules are intentionally pending until
the compatible Functions, backfill/re-audit, client smoke, and version gate:
  HANA_CONFIRM_STAGING_FIRESTORE_RULES_PENDING_DIRECT_ROOM=hana-e2ee6-firestore-rules-pending-direct-room

If the reviewed strict Firestore Rules are already proven live instead:
  HANA_CONFIRM_STAGING_STRICT_MEDIA_RULES_LIVE=hana-e2ee6-strict-private-media-live

Do not set both phrases. Neither phrase substitutes for the separate read-only
live Storage Rules verification performed by this script.
ERROR
    exit 64
  fi
  node scripts/validate_private_media_rollout_contract.js
  verify_live_staging_storage_rules
  if [[ "${HANA_CONFIRM_STAGING_FUNCTION_RETRY_POLICY:-}" != "$RETRY_POLICY_CONFIRMATION" ]]; then
    cat <<'ERROR' >&2
Staging Functions deployment enables event retry only for
onReservedMediaUploaded. Before Firebase CLI may receive --force, build and run
the runtime-isolation regression and verify the generated manifest has exactly
one retry-enabled export and zero HTTPS failure policies. Then rerun with:
  HANA_CONFIRM_STAGING_FUNCTION_RETRY_POLICY=hana-e2ee6-onreservedmediauploaded-retry-only
ERROR
    exit 64
  fi
  (cd firebase/functions && npm run build && \
    node --test test/functionRuntimeIsolation.test.js)
  scripts/preflight_app_check_replay_iam.sh "$EXPECTED_PROJECT"
  scripts/preflight_functions_region.sh "$EXPECTED_PROJECT" "$EXPECTED_REGION"
  export HANA_FIREBASE_ENV=staging
  export HANA_FIREBASE_PROJECT="$EXPECTED_PROJECT"
  export HANA_FUNCTIONS_REGION="$EXPECTED_REGION"
  FIREBASE_DEPLOY_ARGS+=(--force)
fi

if [[ "$TARGET" == "$DIRECT_ROOM_FIRESTORE_TARGET" || "$TARGET" == "$STRICT_MEDIA_TARGET" ]]; then
  if [[ "${HANA_CONFIRM_STAGING_DIRECT_ROOM_FIRESTORE_CUTOVER:-}" != "$DIRECT_ROOM_FIRESTORE_CUTOVER_CONFIRMATION" ]]; then
    cat <<'ERROR' >&2
The staging direct-room Firestore cutover denies client active-room list queries.
Deploy and verify the full compatible Functions set first, complete the reviewed
one-record direct-room backfill/re-audit, pass listActiveChats client smoke, and
enforce the compatible minimum version. Then rerun with:
  HANA_CONFIRM_STAGING_DIRECT_ROOM_FIRESTORE_CUTOVER=hana-e2ee6-direct-room-firestore-cutover
ERROR
    exit 64
  fi
fi

if [[ "$TARGET" == "$DIRECT_ROOM_FIRESTORE_TARGET" ]]; then
  node scripts/validate_private_media_rollout_contract.js
  verify_live_staging_storage_rules
fi

if [[ "$TARGET" == *"storage"* ]]; then
  if [[ "${HANA_CONFIRM_PRIVATE_MEDIA_STRICT_CUTOVER:-}" != "$STRICT_MEDIA_CONFIRMATION" ]]; then
    cat <<'ERROR' >&2
Staging strict private-media cutover is destructive. After the canonical
V2 client (`reserveMediaUploadV2` + `uploadPrivateMediaBytes`), backfills, version
gate, and reviewed migration dry-run are ready,
rerun with:
  HANA_CONFIRM_PRIVATE_MEDIA_STRICT_CUTOVER=hana-e2ee6-private-media-strict-cutover
ERROR
    exit 64
  fi
  node scripts/validate_private_media_rollout_contract.js
  PROJECT_NUMBER="$(gcloud projects describe "$EXPECTED_PROJECT" \
    --format='value(projectNumber)')"
  STORAGE_SERVICE_AGENT="service-${PROJECT_NUMBER}@gcp-sa-firebasestorage.iam.gserviceaccount.com"
  STORAGE_RULES_ROLE_OUTPUT="$(gcloud projects get-iam-policy "$EXPECTED_PROJECT" \
    --flatten='bindings[].members' \
    --filter="bindings.role=roles/firebaserules.firestoreServiceAgent AND bindings.members=serviceAccount:${STORAGE_SERVICE_AGENT}" \
    --format='value(bindings.role)')"
  STORAGE_RULES_ROLE_FOUND=false
  while IFS= read -r storage_rules_role; do
    if [[ "$storage_rules_role" == 'roles/firebaserules.firestoreServiceAgent' ]]; then
      STORAGE_RULES_ROLE_FOUND=true
      break
    fi
  done <<< "$STORAGE_RULES_ROLE_OUTPUT"
  if [[ "$STORAGE_RULES_ROLE_FOUND" != true ]]; then
    echo "Storage Rules cross-service Firestore IAM binding is missing." >&2
    exit 64
  fi
fi

if [[ ${#FIREBASE_DEPLOY_ARGS[@]} -gt 0 ]]; then
  firebase deploy --project "$EXPECTED_PROJECT" --only "$TARGET" \
    "${FIREBASE_DEPLOY_ARGS[@]}"
else
  firebase deploy --project "$EXPECTED_PROJECT" --only "$TARGET"
fi
