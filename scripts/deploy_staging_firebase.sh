#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TARGET="${1:-}"
EXPECTED_PROJECT="hana-e2ee6"
EXPECTED_REGION="us-central1"
STRICT_MEDIA_TARGET="firestore:rules,storage"
STRICT_MEDIA_CONFIRMATION="hana-e2ee6-private-media-strict-cutover"
STRICT_MEDIA_FUNCTIONS_CONFIRMATION="hana-e2ee6-private-media-strict-functions"
STRICT_MEDIA_RULES_LIVE_CONFIRMATION="hana-e2ee6-strict-private-media-live"
RETRY_POLICY_CONFIRMATION="hana-e2ee6-onreservedmediauploaded-retry-only"
FIREBASE_DEPLOY_ARGS=()

if [[ -z "$TARGET" ]]; then
  cat <<'USAGE' >&2
Usage:
  HANA_FUNCTIONS_LIVE_REGION_CONFIRMED=us-central1 \
    scripts/deploy_staging_firebase.sh functions
  scripts/deploy_staging_firebase.sh firestore:indexes
  scripts/deploy_staging_firebase.sh firestore:rules,storage

Choose an explicit target. The script intentionally has no deploy-all default.
USAGE
  exit 64
fi

case "$TARGET" in
  functions | firestore:indexes | "$STRICT_MEDIA_TARGET") ;;
  *)
    cat <<ERROR >&2
Unsupported staging Firebase deploy target: $TARGET

Allowed exact targets are:
  functions
  firestore:indexes
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
outage, deploy required indexes and wait for READY, then deploy strict
firestore:rules,storage before this Functions step. Rerun with:
  HANA_CONFIRM_STAGING_STRICT_MEDIA_FUNCTIONS=hana-e2ee6-private-media-strict-functions
This acknowledgement does not verify live rule order by itself.
ERROR
    exit 64
  fi
  if [[ "${HANA_CONFIRM_STAGING_STRICT_MEDIA_RULES_LIVE:-}" != "$STRICT_MEDIA_RULES_LIVE_CONFIRMATION" ]]; then
    cat <<'ERROR' >&2
Staging V2 Functions require strict private-media Rules to be proven live first.
Fetch the staging Firestore/Storage Rules read-only through the supported Firebase
API, verify their reviewed hashes match this local strict candidate and canonical
profile/chat create=false, then rerun with:
  HANA_CONFIRM_STAGING_STRICT_MEDIA_RULES_LIVE=hana-e2ee6-strict-private-media-live
Do not set this phrase from local source inspection alone.
ERROR
    exit 64
  fi
  node scripts/validate_private_media_rollout_contract.js
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
