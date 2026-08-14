#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:-}"

case "$PROJECT_ID" in
  hana-e2ee6 | hana-production-tokyo) ;;
  *)
    echo "App Check replay IAM preflight requires an exact Hana Firebase project." >&2
    exit 64
    ;;
esac

# This repository exports Gen 1 Functions through firebase-functions/v1 with
# default Admin SDK credentials. Firebase requires the App Engine default
# service account to verify and consume limited-use App Check tokens.
RUNTIME_SERVICE_ACCOUNT="${PROJECT_ID}@appspot.gserviceaccount.com"
REQUIRED_ROLE="roles/firebaseappcheck.tokenVerifier"

if ! gcloud projects get-iam-policy "$PROJECT_ID" \
  --flatten='bindings[].members' \
  --filter="bindings.role=${REQUIRED_ROLE} AND bindings.members=serviceAccount:${RUNTIME_SERVICE_ACCOUNT}" \
  --format='value(bindings.role)' | rg -Fxq "$REQUIRED_ROLE"
then
  cat <<ERROR >&2
App Check replay-protection IAM binding is missing.

The Gen 1 runtime service account must have Firebase App Check Token Verifier
before uploadPrivateMediaBytes can consume limited-use tokens:
  project: ${PROJECT_ID}
  member:  serviceAccount:${RUNTIME_SERVICE_ACCOUNT}
  role:    ${REQUIRED_ROLE}
ERROR
  exit 64
fi

echo "App Check replay-protection IAM preflight passed for ${PROJECT_ID}."
