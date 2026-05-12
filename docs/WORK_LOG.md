# Hana Work Log

Last updated: 2026-05-12 KST

Use this file when starting a new Codex session. It records the latest completed
work, what was verified, and the next recommended task. `AGENTS.md` remains the
source of truth for product and coding rules.

## Current Operating Mode

- Default verification path: automated tests and static analysis first.
- Use Android Emulator for repeated UI checks when practical.
- Use the user's USB Android device only for checks that truly need a real
  device, such as Google sign-in, App Check debug token behavior, FCM, payments,
  permissions, camera/image picker, and final pre-release smoke tests.
- Do not spend tokens repeatedly dumping real-device UI unless the issue cannot
  be verified another way.
- Current product direction is Japanese-user acquisition first:
  - one shared Firebase backend
  - one shared app codebase
  - `HANA_STORE_REGION=jp` for Japanese store builds
  - `HANA_STORE_REGION=kr` for Korean store builds
  - Japan builds should feel native to Japanese users before sign-in
  - Korea builds remain naturally localized, but the immediate UX priority is
    validating the Japanese supply-side experience

## Latest Completed Work

### Japanese-First Product Direction

- Confirmed product strategy:
  - Japanese user supply should be prioritized first because a strong Japanese
    user base can make Korean user acquisition easier.
  - Japan positioning should be: `韓国語を学びたい日本人が、安心して韓国人と話せるアプリ`.
  - Korea positioning should be: `일본인과 자연스럽게 대화하고 일본어를 연습하는 앱`.
  - Hana should avoid looking like a swipe/dating app and should favor language
    exchange, Korean conversation, Korean friends, translation, and safety.
- Confirmed architecture direction:
  - Do not split into separate Korea/Japan apps at this stage.
  - Keep one Firebase backend and one shared app codebase.
  - Use store-region build configuration for default UI locale and policy URLs.
- Implemented store-region launch wiring:
  - `HANA_STORE_REGION=kr` builds default to Korean UI and Korean policy URLs.
  - `HANA_STORE_REGION=jp` builds default to Japanese UI and Japanese policy
    URLs.
  - Users can still choose UI language in Settings.
- Published policy pages:
  - Korean: `/legal/ko/privacy/`, `/legal/ko/terms/`,
    `/legal/ko/community-safety/`, `/legal/ko/account-deletion/`
  - Japanese: `/legal/ja/privacy/`, `/legal/ja/terms/`,
    `/legal/ja/community-safety/`, `/legal/ja/account-deletion/`
- GitHub Pages deploy succeeded after push.
- Updated `docs/PRODUCT_ROADMAP.md` with:
  - market strategy
  - Japanese-first UX direction
  - new Phase 2.5 for Japan-first UX reframe
  - revised immediate recommended backlog
- Verification completed:
  - `flutter analyze`
  - `flutter test`
  - `scripts/validate_store_review_docs.sh`
  - `HANA_ALLOW_DEBUG_RELEASE_SIGNING=true HANA_STORE_REGION=kr scripts/build_prod_aab.sh`
  - `HANA_ALLOW_DEBUG_RELEASE_SIGNING=true HANA_STORE_REGION=jp scripts/build_prod_aab.sh`
  - `scripts/run_automated_qa.sh`

### Profile And Discovery Exposure Boundary Review

- Audited Discovery/Profile/Lounge profile exposure paths:
  - Discovery list uses `listDiscoveryProfiles`.
  - Profile detail uses `getPublicProfile`.
  - Lounge list/detail/comments use Lounge repository callables.
  - Flutter presentation code does not directly read other users' private
    `users/{uid}` documents.
- Added shared Functions public-profile exposure policy:
  - hides banned, deleted, deactivated, mock, test, operator, official, and
    promotional users
  - keeps the existing legacy complete-profile repair path for staging users
  - centralizes public-profile visibility checks for Discovery/Profile/Lounge
- Tightened Lounge comment/reply visibility:
  - comments/replies from blocked, unavailable, incomplete, or internal/test
    authors are no longer returned by `listLoungeComments`
  - comment/reply creation now requires the caller to have a public profile
- Added tests for:
  - public-profile exposure policy
  - private `users/{uid}` read denial even when a document has public profile
    fields
  - client denial for server-owned `fcmToken`, payment, and moderation fields
  - direct Lounge comment/reply reads remaining denied by Firestore rules

### Direct Chat Room Policy

- Confirmed product policy:
  - Profile detail chat CTA starts direct 1:1 chat.
  - Mutual matching is not required.
  - Creating a new 1:1 room costs 1 point.
  - Reusing an existing active room costs 0 points.
  - If either participant leaves, the room closes for both users and disappears
    from active chat lists.
  - Starting chat again with the same user after leaving creates a brand-new room
    with no previous messages visible and costs 1 point.
- Backend:
  - `startChat` now uses `chatPairs/{pairKey}` as the server-owned pointer to
    the current active room.
  - Closed rooms remain historical `matches` documents and are not reactivated.
  - `leaveChat` clears the `chatPairs` active pointer and closes the room for
    both participants.
  - `submitRating`, `blockUser`, and rating verification now resolve active room
    state through the current active-room lookup instead of assuming deterministic
    match IDs.
- Flutter:
  - Profile detail checks active rooms instead of deterministic match IDs.
  - CTA copy now distinguishes `대화방 열기` from `대화 시작하기`.
  - Point hint displays current balance for new chat starts.
- Deployed:
  - `functions:startChat`
  - `functions:leaveChat`
  - `functions:submitRating`
  - `functions:blockUser`

### Message Sending And Translation Safety

- `sendMessage` is the client send path; direct client message writes are
  blocked by Firestore rules.
- `sendMessage` now validates text, uses a Firestore transaction, and re-checks:
  - active room
  - caller membership
  - `hiddenFor`
  - block state both directions
  - recipient existence / ban state
- Added policy helpers and tests:
  - `firebase/functions/src/messagePolicy.ts`
  - `firebase/functions/test/messagePolicy.test.js`
- `onMessageCreated` side effects are policy-driven:
  - No unread increment or FCM when room is inactive, blocked, or recipient is
    unavailable/banned.
  - Translation writes are additive and never overwrite `originalText`.
  - Translation failure marks `translationStatus: failed` while preserving the
    message.
- Added policy helpers and tests:
  - `firebase/functions/src/messageSideEffectsPolicy.ts`
  - `firebase/functions/test/messageSideEffectsPolicy.test.js`
- Deployed:
  - `functions:sendMessage`
  - `functions:onMessageCreated`

### Chat UI And List Behavior

- Chat room now watches the `matches/{matchId}` document in real time.
- If a room is inactive or hidden for the current user:
  - message input is replaced with `종료된 대화방입니다`
  - icebreaker suggestions are hidden
  - sending is blocked by UI and server
- Chat list filters active, visible rooms only.
- Chat list and legacy `/matches` copy now use direct-chat language instead of
  like/mutual-match language.

### Firestore Rules

- `matches/{matchId}` reads now require:
  - authenticated participant
  - `isActive == true`
  - current UID not in `hiddenFor`
- `matches/{matchId}/messages/{messageId}` reads use the same active/visible
  room checks.
- `chatPairs/{pairKey}` is fully server-owned; client read/write is denied.
- Added rules tests for:
  - no client room delete
  - no direct message writes
  - no closed/hidden room reads
  - no closed room message reads
  - no `chatPairs` read/create/update
- Deployed:
  - `firestore:rules`

### Block And Report Regression

- Added shared Functions safety policy helpers:
  - validates supported report reasons
  - validates whether a supplied `matchId` belongs to the reporter/target pair
  - keeps report/blocked room closure hidden from both participants
  - keeps auto-ban room hiding scoped to valid room participants
- `reportUser` now uses the shared safety policy when deciding whether a
  random/current room can be used as report context and when closing rooms after
  reports or automatic bans.
- Added Functions regression tests for report reason validation, requested
  active-room validation, closed-room hidden participants, and auto-ban hiding.
- Added Firestore rules regression tests confirming reported/blocked inactive
  rooms do not appear in active chat-list queries and report counter documents
  cannot be updated by clients.
- No real-device QA was performed for this pass; this was code, rules, and
  emulator-style automated verification only.

### Guarded Account Deletion

- `deleteAccount` now requires App Check in addition to Firebase Auth.
- Account deletion releases the caller-owned `displayNameReservations` document
  so deleted nicknames are not permanently locked.
- Active rooms closed by account deletion now also clear the relevant
  `chatPairs/{pairKey}` active pointer, matching the leave-chat restart policy.
- Added shared account deletion policy helpers and Functions tests for:
  - display-name reservation cleanup eligibility
  - hidden participants for deleted-account room closure
  - active chat-pair key cleanup eligibility
- Settings account deletion now refreshes Firebase Auth and App Check tokens
  before calling the server, matching block/report callable behavior.
- Firestore rules regression coverage now confirms clients cannot mark
  themselves deleted or directly delete their own user document.

### Point And Payment-Sensitive State

- Added shared Functions point policy helpers for:
  - supported purchase platform validation
  - QA-only point grant eligibility
  - guarded QA grant amount normalization
  - auditable point balance calculations
- QA point grants still require the debug receipt and a `@hana.example` test
  account; real store receipts remain rejected until Play Billing verification
  is implemented.
- QA point grant ledger events now include `balanceBefore`, `balanceAfter`,
  platform, source, and receipt type.
- `startChat` now writes a server-owned `pointEvents` consume ledger event when
  it creates a new 1:1 chat room and deducts 1 point.
- Existing active chat reuse still costs 0 points and does not create a consume
  event.
- `pointEvents/{eventId}` is explicitly server-owned in Firestore rules, with
  tests denying client read/create/update/delete.
- Paywall QA point grant now refreshes Firebase Auth and App Check tokens before
  calling the server.

### Android Play Billing Client Preparation

- Added the official Flutter `in_app_purchase` package.
- Paywall now queries consumable point products from the store using these IDs:
  - `hana_points_5`
  - `hana_points_12`
  - `hana_points_30`
  - `hana_points_70`
  - `hana_points_150`
- Paywall purchase action now starts a consumable purchase for available store
  products and listens to the purchase stream.
- Completed purchases are sent to `purchaseExtraQuota` with product ID, purchase
  ID, receipt token, and verification source.
- `purchaseExtraQuota` now validates real purchase product IDs but still refuses
  to grant points until server-side Play receipt verification is implemented.
- Added `docs/PLAY_BILLING_SETUP.md` with package name, product IDs, and the
  server verification checklist.

### Server-Side Play Purchase Verification Boundary

- Added `googleapis` to Cloud Functions so the server can call Google Play
  Android Publisher APIs.
- Added `playBillingVerifier.ts` using `purchases.products.get` with:
  - package name `com.hana.app`
  - product ID from the paywall package
  - purchase token from `in_app_purchase`
- Real Play purchase verification is gated by either
  `PLAY_BILLING_VERIFICATION_ENABLED=true` or Firebase runtime config
  `play_billing.verification_enabled=true`; without a true flag, real purchases
  are rejected before points can be granted.
- Validated Play purchase tokens are keyed by SHA-256 hash in
  `playPurchases/{tokenHash}`.
- Duplicate purchase tokens are rejected, or treated as idempotent only when the
  same user already has a granted record.
- Server grants purchased points and writes `pointEvents` only after Google Play
  reports `purchaseState == 0`.
- `playPurchases/{tokenHash}` is explicitly server-owned in Firestore rules,
  with client read/create/update/delete denied by tests.
- Play Billing verification can be enabled through either
  `PLAY_BILLING_VERIFICATION_ENABLED=true` or Firebase runtime config
  `play_billing.verification_enabled=true`.
- Staging deploy completed for:
  - `functions:purchaseExtraQuota`
  - `functions:startChat`
  - `firestore:rules`

### Automated QA Gate

- Added `scripts/run_automated_qa.sh` as the default pre-device QA gate.
- The script runs:
  - `flutter analyze`
  - `flutter test`
  - `cd firebase/functions && npm test`
  - `cd firebase/test && npm test`
  - `cd firebase/functions && npm audit --omit=dev --audit-level=high`
  - staging-style Android debug APK build with mock/QA flags disabled
  - production AAB build with mock/QA flags disabled
- Set `RUN_ANDROID_BUILDS=false` to skip Android builds for faster local loops.
- Set `RUN_PROD_AAB=false` to skip the production AAB build when only code
  tests are needed.

### Documentation

- Updated `AGENTS.md` with current chat/point policy and test commands.
- Updated `docs/PRODUCT_ROADMAP.md` with direct-chat restart policy.
- Updated `docs/E2E_QA_CHECKLIST.md` with chat exit and restart QA flow.

## Verification Completed

- `cd firebase/functions && npm test`
  - 23 tests passing after public-profile exposure policy additions.
- `cd firebase/test && npm test`
  - 16 rules tests passing after private-user and Lounge read boundary additions.
- `cd firebase/functions && npm test`
  - 18 tests passing after chat/message policy additions.
- `cd firebase/test && npm test`
  - 15 rules tests passing after active/hidden room access changes.
- `flutter analyze`
  - Passing after public-profile exposure boundary review.
- `flutter test`
  - Passing after public-profile exposure boundary review.
- `cd firebase/functions && npm test`
  - 23 tests passing after adding `getProfileDetail`.
- `cd firebase/test && npm test`
  - 16 rules tests passing after the profile-detail callable cleanup.
- `flutter analyze`
  - Passing after moving profile detail status reads behind `getProfileDetail`.
- `flutter test`
  - Passing after moving profile detail status reads behind `getProfileDetail`.
- Emulator smoke on `emulator-5554`
  - Discovery -> profile detail -> existing chat room -> message send passed.
  - No Firestore permission-denied logs were observed after the
    `getProfileDetail` staging deploy.
- Real-device QA on `SCHUOB8P6LJRFINB`
  - Discovery, profile detail, Lounge, profile/settings edit flows passed.
  - Chat send worked, but chat list showed repeated refresh because the
    active-room list query was denied by Firestore rules.
  - Fixed the `matches` list rule for active participant chat-list queries,
    kept direct hidden-room `get` reads denied, and deployed staging rules.
- `cd firebase/test && npm test`
  - 17 rules tests passing after chat-list query rule coverage.
- `flutter analyze`
  - Passing after chat-list stream smoothing and rule-related client cleanup.
- Fresh-account onboarding QA prep
  - Added a debug-only QA email account creation action to the login screen.
  - Added optional onboarding profile photo upload using the existing
    `OnboardingRepository.uploadProfilePhotos` path.
  - Product rule confirmed and implemented: account creation, onboarding, and
    public exposure must work without a profile photo.
  - Reinstalled the staging debug build on `SCHUOB8P6LJRFINB` for manual QA.
- `flutter analyze`
  - Passing after onboarding photo upload and QA account creation changes.
- `flutter test`
  - Passing after onboarding photo upload and QA account creation changes.
- `cd firebase/functions && npm test`
  - 24 tests passing after making profile photos optional for public exposure.
- `flutter analyze`
  - Passing after making onboarding photos optional.
- `flutter test`
  - Passing after making onboarding photos optional.
- `cd firebase/functions && npm test`
  - 29 tests passing after block/report safety policy regression coverage.
- `cd firebase/test && npm test`
  - 18 rules tests passing after reported/blocked room list and report-counter
    access coverage.
- `flutter analyze`
  - Passing after safety repository/report sheet App Check/Auth refresh and UI
    tap-area cleanup.
- `flutter test`
  - Passing after safety repository/report sheet App Check/Auth refresh and UI
    tap-area cleanup.
- `cd firebase/functions && npm test`
  - 32 tests passing after guarded account deletion policy coverage.
- `cd firebase/test && npm test`
  - 18 rules tests passing after deletion-field and direct user delete denial
    coverage.
- `flutter analyze`
  - Passing after Settings account deletion token refresh.
- `flutter test`
  - Passing after Settings account deletion token refresh.
- `cd firebase/functions && npm test`
  - 36 tests passing after point policy and ledger coverage.
- `cd firebase/test && npm test`
  - 19 rules tests passing after explicit `pointEvents` server-owned coverage.
- `flutter analyze`
  - Passing after Paywall QA point grant token refresh.
- `flutter test`
  - Passing after Paywall QA point grant token refresh.
- `cd firebase/functions && npm test`
  - 37 tests passing after point product ID mapping coverage.
- `cd firebase/test && npm test`
  - 19 rules tests passing after Play Billing client prep.
- `flutter analyze`
  - Passing after Play Billing client prep.
- `flutter test`
  - Passing after Play Billing client prep.
- `flutter build apk --debug`
  - Passing after adding `in_app_purchase`.
- `cd firebase/functions && npm test`
  - 40 tests passing after Play verification gating and purchase-state policy
    coverage.
- `cd firebase/test && npm test`
  - 20 rules tests passing after explicit `playPurchases` server-owned coverage.
- `npm audit fix`
  - Cleared the high-severity `fast-xml-builder` advisory in Functions
    dependencies.
- `npm audit --omit=dev --audit-level=high`
  - No high-severity audit failures remain; low-severity Firebase Admin
    transitive advisories still require a breaking `--force` dependency change
    and were left untouched.
- `firebase deploy --project staging --only functions:purchaseExtraQuota,functions:startChat,firestore:rules`
  - Completed successfully on `hana-e2ee6`.
- `firebase functions:list --project staging`
  - Confirmed `purchaseExtraQuota` and `startChat` are present as Node.js 22
    callable functions in `us-central1`.
- `scripts/run_automated_qa.sh`
  - Passing end-to-end.
  - Built debug APK at `build/app/outputs/flutter-apk/app-debug.apk`.
  - Built production AAB at `build/app/outputs/bundle/release/app-release.aab`
    with mock data, QA email login, and QA point grant disabled.
- Real-device smoke performed earlier for the new room policy:
  - active room reuse did not charge
  - leave removed room from chat list
  - same profile showed new chat start and point cost
  - new room opened without previous messages
  - point balance decreased from 2 to 1 after new room creation

## Current Next Recommended Task

Japanese-first UX reframe before more secondary feature work.

Immediate UI scope:

- Login / first-launch copy for the Japan build.
- Onboarding copy and photo-optional presentation.
- Discovery card information priority for Japanese users scanning Korean
  profiles.
- Profile detail CTA and one-point explanation.
- Chat original/translation labels and pending/failed translation states.
- Point shortage and purchase copy that explains points as new conversation
  starters, not a dating paywall.

After the first UX pass, resume Play Console/API configuration and sandbox
purchase QA.

Latest safety/discovery QA note:

- Block/report behavior now has Functions and Firestore rules regression
  coverage for the server-owned pieces that can be verified without a device.
- Account deletion now has code-level coverage for App Check alignment,
  nickname reservation release, active chat-pair cleanup, and client-side
  deletion-field denial.
- Point balance changes now have server-owned grant/consume ledger coverage for
  QA grants and new direct-chat creation.
- Android paywall can now query/start store purchases, but real point grants
  remain blocked until server-side Play receipt verification is implemented.
- Server-side Play verification code is in place, behind an explicit environment
  flag, and duplicate purchase tokens are guarded by a server-owned ledger.
- Staging has the updated `purchaseExtraQuota`, `startChat`, and Firestore rules
  deployed, but real purchase grants remain disabled until the verification flag
  and Google Play API permissions are configured.
- Store-region builds are now part of the product contract:
  - Japan build should be smoke-tested with `HANA_STORE_REGION=jp`.
  - Korea build should be smoke-tested with `HANA_STORE_REGION=kr`.
  - Settings language override should still work after either build default.
- Automated QA gate is available and should be run before asking for real-device
  checks. Release AAB compile checks are allowed to use debug signing only when
  `HANA_ALLOW_DEBUG_RELEASE_SIGNING=true` is explicitly set by the QA script.
- Store-ready release AAB builds now fail closed unless upload signing
  environment variables are configured.
- Play Billing config guard is part of automated QA and checks product IDs,
  package name, server verification hooks, and client-denied ledgers before
  sandbox purchase testing.
- Play purchase token handling now reserves tokens atomically before Google Play
  verification, returns idempotent success for already granted same-user
  deliveries, and allows same-user retry after verification failure or rejection.
- Staging has the updated `purchaseExtraQuota` duplicate-token reservation logic
  deployed and verified in the Functions list.
- Firebase project config guard is part of automated QA and confirms
  `hana-e2ee6` remains staging/default while production still uses the explicit
  placeholder alias.
- Store-review policy draft docs are available under `docs/store_review/` and
  automated QA checks that the privacy, terms, safety, account deletion/support,
  and review checklist files remain present.
- Login and Settings legal links now open URLs supplied through dart-defines;
  store AAB builds require the corresponding `HANA_*_URL` environment variables.
- Public GitHub Pages policy pages are staged under `public/`, with default app
  URLs pointing at `https://emptypocket711-star.github.io/KR_JP_MATCH/legal/...`.
  The Pages workflow publishes only `public/`, not the internal `docs/` folder.
- Manual device QA should focus only on visible app behavior: report submit
  succeeds, reported/blocked user disappears from Discovery/Profile/Chat/Lounge
  exposure, deleted accounts disappear from active exposure, and closed chat
  rooms do not keep refreshing in the chat list.
- Next launch blocker is external setup: create Play Console products, configure
  Google Play Developer API access for the Firebase runtime, set the verification
  flag, deploy, then run sandbox purchase QA.

QA handoff preference:

- Code-level checks, unit tests, rules tests, analyze, and deploy verification
  should be handled by Codex.
- Before handoff, run `scripts/run_automated_qa.sh` unless the task is a tiny
  docs-only change.
- Ask the tester only for real-device behavior that cannot be confirmed well at
  code level, such as login state, permission prompts, image picker, visible UI
  transitions, push receipt, and cross-account block/report exposure.

Suggested scope:

- Run a fresh-account onboarding QA pass with and without image upload.
- Run the two-account direct-chat and translation pass after safety changes.
- Run account deletion visible-behavior smoke on a real Android device when the
  tester is ready.
- Run final block/report visible-behavior smoke on a real Android device when
  the tester is ready.
- Run Android sandbox purchase QA after Play Console products and tester access
  are configured.
- Verify duplicate-token retry behavior in staging logs during sandbox QA.
- Configure Android upload signing variables before any Play Console submission
  build.
- Run `scripts/validate_play_billing_config.sh` before enabling Play Billing
  verification or starting sandbox purchase QA, then watch `playPurchases`
  status transitions in staging logs during duplicate-token retry tests.

## Useful Commands

```bash
flutter analyze
flutter test

cd firebase/functions
npm test

cd firebase/test
npm test

scripts/run_automated_qa.sh
scripts/build_prod_aab.sh
scripts/validate_play_billing_config.sh
scripts/validate_firebase_project_config.sh
scripts/validate_store_review_docs.sh
```

Staging deploy commands used recently:

```bash
firebase deploy --only functions:startChat --project hana-e2ee6
firebase deploy --only functions:sendMessage --project hana-e2ee6
firebase deploy --only functions:onMessageCreated --project hana-e2ee6
firebase deploy --only functions:getProfileDetail --project hana-e2ee6
firebase deploy --project staging --only functions:purchaseExtraQuota
firebase deploy --only firestore:rules --project hana-e2ee6
```

## Key Files Changed Recently

- `firebase/functions/src/index.ts`
- `firebase/functions/src/accountDeletionPolicy.ts`
- `firebase/functions/src/chatPolicy.ts`
- `firebase/functions/src/messagePolicy.ts`
- `firebase/functions/src/messageSideEffectsPolicy.ts`
- `firebase/functions/src/pointPolicy.ts`
- `firebase/functions/src/playBillingVerifier.ts`
- `firebase/functions/src/profileExposurePolicy.ts`
- `firebase/functions/src/safetyPolicy.ts`
- `firebase/functions/test/*.test.js`
- `firebase/firestore.rules`
- `firebase/test/firestore.rules.test.js`
- `lib/features/profile/data/profile_repository_impl.dart`
- `lib/features/profile/domain/profile_detail_state.dart`
- `lib/features/profile/presentation/profile_detail_screen.dart`
- `lib/features/profile/presentation/profile_provider.dart`
- `lib/features/auth/data/auth_repository_impl.dart`
- `lib/features/auth/domain/auth_repository.dart`
- `lib/features/auth/presentation/login_screen.dart`
- `lib/features/onboarding/presentation/onboarding_screen.dart`
- `docs/E2E_QA_CHECKLIST.md`
- `docs/PLAY_BILLING_SETUP.md`
- `docs/store_review/*.md`
- `scripts/run_automated_qa.sh`
- `lib/features/chat/data/chat_repository_impl.dart`
- `lib/features/chat/domain/chat_repository.dart`
- `lib/features/chat/presentation/chat_provider.dart`
- `lib/features/chat/presentation/chat_screen.dart`
- `lib/features/matches/data/matches_repository_impl.dart`
- `lib/features/matches/presentation/chats_list_screen.dart`
- `lib/features/matches/presentation/matches_screen.dart`
- `AGENTS.md`
- `docs/PRODUCT_ROADMAP.md`
- `docs/E2E_QA_CHECKLIST.md`
