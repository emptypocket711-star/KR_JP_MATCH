#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

required_docs=(
  docs/store_review/PRIVACY_POLICY_KO.md
  docs/store_review/TERMS_OF_SERVICE_KO.md
  docs/store_review/COMMUNITY_SAFETY_KO.md
  docs/store_review/ACCOUNT_DELETION_AND_SUPPORT_KO.md
  docs/store_review/STORE_REVIEW_POLICY_CHECKLIST.md
  public/index.html
  public/legal/ko/privacy/index.html
  public/legal/ko/terms/index.html
  public/legal/ko/community-safety/index.html
  public/legal/ko/account-deletion/index.html
  public/legal/ja/privacy/index.html
  public/legal/ja/terms/index.html
  public/legal/ja/community-safety/index.html
  public/legal/ja/account-deletion/index.html
  public/legal/privacy/index.html
  public/legal/terms/index.html
  public/legal/community-safety/index.html
  public/legal/account-deletion/index.html
)

for doc in "${required_docs[@]}"; do
  if [[ ! -s "$doc" ]]; then
    echo "Missing store review document: $doc" >&2
    exit 1
  fi
done

for token in "개인정보" "계정 삭제" "신고" "차단" "아동" "결제"; do
  if ! rg -q "$token" docs/store_review; then
    echo "Store review docs are missing required policy token: $token" >&2
    exit 1
  fi
done

if ! rg -q "TODO" docs/store_review; then
  echo "Store review docs should keep TODO markers until operator/legal details are filled." >&2
  exit 1
fi

for token in \
  "LEGAL_TERMS_URL" \
  "LEGAL_PRIVACY_URL" \
  "LEGAL_COMMUNITY_SAFETY_URL" \
  "LEGAL_ACCOUNT_DELETION_URL" \
  "DEFAULT_UI_LOCALE"
do
  if ! rg -q "$token" lib/app/config/app_config.dart scripts/build_prod_aab.sh; then
    echo "Store review legal URL define is missing: $token" >&2
    exit 1
  fi
done

for url in \
  "https://emptypocket711-star.github.io/KR_JP_MATCH/legal/ko/terms/" \
  "https://emptypocket711-star.github.io/KR_JP_MATCH/legal/ko/privacy/" \
  "https://emptypocket711-star.github.io/KR_JP_MATCH/legal/ko/community-safety/" \
  "https://emptypocket711-star.github.io/KR_JP_MATCH/legal/ko/account-deletion/" \
  "https://emptypocket711-star.github.io/KR_JP_MATCH/legal/ja/terms/" \
  "https://emptypocket711-star.github.io/KR_JP_MATCH/legal/ja/privacy/" \
  "https://emptypocket711-star.github.io/KR_JP_MATCH/legal/ja/community-safety/" \
  "https://emptypocket711-star.github.io/KR_JP_MATCH/legal/ja/account-deletion/"
do
  if ! rg -q "$url" docs/store_review/STORE_REVIEW_POLICY_CHECKLIST.md; then
    echo "Published policy URL is not documented: $url" >&2
    exit 1
  fi
done

for token in \
  'HANA_STORE_REGION' \
  'POLICY_PATH_LOCALE' \
  'legal/\$POLICY_PATH_LOCALE/privacy/' \
  'legal/\$POLICY_PATH_LOCALE/terms/' \
  'legal/\$POLICY_PATH_LOCALE/community-safety/' \
  'legal/\$POLICY_PATH_LOCALE/account-deletion/'
do
  if ! rg -q "$token" scripts/build_prod_aab.sh; then
    echo "Store-region policy URL build wiring is missing: $token" >&2
    exit 1
  fi
done

echo "Store review docs guard is present."
