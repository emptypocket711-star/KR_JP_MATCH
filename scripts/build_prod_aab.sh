#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DEFAULT_LEGAL_BASE_URL="https://emptypocket711-star.github.io/KR_JP_MATCH"
LEGAL_BASE_URL="${HANA_LEGAL_BASE_URL:-$DEFAULT_LEGAL_BASE_URL}"
HANA_STORE_REGION="${HANA_STORE_REGION:-kr}"
case "$HANA_STORE_REGION" in
  kr|KR|korea|KOREA)
    STORE_LOCALE="ko"
    POLICY_PATH_LOCALE="ko"
    ;;
  jp|JP|japan|JAPAN)
    STORE_LOCALE="ja"
    POLICY_PATH_LOCALE="ja"
    ;;
  *)
    echo "Unsupported HANA_STORE_REGION: $HANA_STORE_REGION" >&2
    echo "Use HANA_STORE_REGION=kr or HANA_STORE_REGION=jp." >&2
    exit 1
    ;;
esac
TERMS_URL="${HANA_TERMS_URL:-$LEGAL_BASE_URL/legal/$POLICY_PATH_LOCALE/terms/}"
PRIVACY_URL="${HANA_PRIVACY_URL:-$LEGAL_BASE_URL/legal/$POLICY_PATH_LOCALE/privacy/}"
COMMUNITY_SAFETY_URL="${HANA_COMMUNITY_SAFETY_URL:-$LEGAL_BASE_URL/legal/$POLICY_PATH_LOCALE/community-safety/}"
ACCOUNT_DELETION_URL="${HANA_ACCOUNT_DELETION_URL:-$LEGAL_BASE_URL/legal/$POLICY_PATH_LOCALE/account-deletion/}"

missing=()
for var_name in \
  HANA_UPLOAD_KEYSTORE \
  HANA_UPLOAD_STORE_PASSWORD \
  HANA_UPLOAD_KEY_ALIAS \
  HANA_UPLOAD_KEY_PASSWORD
do
  if [[ -z "${!var_name:-}" ]]; then
    missing+=("$var_name")
  fi
done

if (( ${#missing[@]} > 0 )); then
  if [[ "${HANA_ALLOW_DEBUG_RELEASE_SIGNING:-}" != "true" ]]; then
    echo "Store release build is not configured." >&2
    echo "Missing: ${missing[*]}" >&2
    echo "Set upload signing environment variables before building a store AAB." >&2
    echo "For local compile-only QA only, set HANA_ALLOW_DEBUG_RELEASE_SIGNING=true." >&2
    exit 1
  fi

  echo "WARNING: Building release AAB with incomplete store config for compile-only QA." >&2
  echo "Do not upload this AAB to Play Console." >&2
fi

flutter build appbundle \
  --release \
  --dart-define=APP_ENV=production \
  --dart-define=ALLOW_MOCK_DATA=false \
  --dart-define=ALLOW_QA_EMAIL_LOGIN=false \
  --dart-define=ALLOW_QA_POINT_GRANT=false \
  --dart-define=DEFAULT_UI_LOCALE="$STORE_LOCALE" \
  --dart-define=LEGAL_TERMS_URL="$TERMS_URL" \
  --dart-define=LEGAL_PRIVACY_URL="$PRIVACY_URL" \
  --dart-define=LEGAL_COMMUNITY_SAFETY_URL="$COMMUNITY_SAFETY_URL" \
  --dart-define=LEGAL_ACCOUNT_DELETION_URL="$ACCOUNT_DELETION_URL"

echo "Production AAB:"
echo "build/app/outputs/bundle/release/app-release.aab"
