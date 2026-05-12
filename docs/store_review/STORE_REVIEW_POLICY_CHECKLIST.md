# Store Review Policy Checklist

Last updated: 2026-05-12

Use this checklist before submitting Hana to Google Play or App Store review.

## Documents

- Privacy policy URL is live and matches `PRIVACY_POLICY_KO.md`.
- Terms URL is live and matches `TERMS_OF_SERVICE_KO.md`.
- Community safety URL is live and matches `COMMUNITY_SAFETY_KO.md`.
- Account deletion/support URL is live and matches
  `ACCOUNT_DELETION_AND_SUPPORT_KO.md`.
- Korean Google Play/App Store URLs:
  - `https://emptypocket711-star.github.io/KR_JP_MATCH/legal/ko/privacy/`
  - `https://emptypocket711-star.github.io/KR_JP_MATCH/legal/ko/terms/`
  - `https://emptypocket711-star.github.io/KR_JP_MATCH/legal/ko/community-safety/`
  - `https://emptypocket711-star.github.io/KR_JP_MATCH/legal/ko/account-deletion/`
- Japanese Google Play/App Store URLs:
  - `https://emptypocket711-star.github.io/KR_JP_MATCH/legal/ja/privacy/`
  - `https://emptypocket711-star.github.io/KR_JP_MATCH/legal/ja/terms/`
  - `https://emptypocket711-star.github.io/KR_JP_MATCH/legal/ja/community-safety/`
  - `https://emptypocket711-star.github.io/KR_JP_MATCH/legal/ja/account-deletion/`
- Operator name, business details, support email, and legal jurisdiction are no
  longer `TODO`.

## App Paths

- Login screen terms link opens the published terms URL.
- Login screen privacy link opens the published privacy URL.
- Settings terms link opens the published terms URL.
- Settings privacy link opens the published privacy URL.
- Store AAB build uses the default GitHub Pages legal URLs, or override URLs
  passed with `HANA_TERMS_URL`, `HANA_PRIVACY_URL`,
  `HANA_COMMUNITY_SAFETY_URL`, and `HANA_ACCOUNT_DELETION_URL`.
- Korean store builds use `HANA_STORE_REGION=kr` and start with Korean UI.
- Japanese store builds use `HANA_STORE_REGION=jp` and start with Japanese UI.
- Settings account deletion flow works in the submitted build.
- Report and block entry points are visible from relevant user/profile/chat
  surfaces.

## Safety

- Block prevents future Discovery/Profile/Chat/Lounge exposure.
- Report creates server-owned moderation records not readable by clients.
- Deleted accounts disappear from active exposure paths.
- Mock, internal, operator, official, and promotional users are not shown in
  release or promotion builds.
- Child safety/community safety policy is published and reachable.

## Payments

- Point product copy explains that one new 1:1 chat costs one point.
- Existing active chat room reuse costs zero points.
- Google Play products match `docs/PLAY_BILLING_SETUP.md`.
- Server-side receipt verification is enabled only after Play Console/API setup.
- Duplicate purchase token behavior is tested in staging.

## Firebase And Builds

- `scripts/run_automated_qa.sh` passes.
- Store-ready AAB is built with upload signing, not debug signing.
- `hana-e2ee6` is not used as a production launch project.
- Production Firebase project alias is real before production deploy.
