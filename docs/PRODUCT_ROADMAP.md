# Hana Product Roadmap

Last updated: 2026-05-12

This document is the working roadmap for Hana. `AGENTS.md` remains the source
of truth for coding rules and non-negotiable product constraints. This document
explains what to build, why it matters, and how each section should make
implementation decisions.

## Product Goal

Hana is a Korea-Japan social matching and language-exchange app.

The product target is:

- A Japanese-user-friendly first experience that makes Korean conversation feel
  safe, approachable, and useful.
- A 1:1 social discovery and chat experience centered on language exchange and
  cross-culture conversation, not swipe dating.
- A clear Korea/Japan focus with built-in Korean <-> Japanese translated chat as
  the core differentiator.
- Store launch in Korea and Japan for Android and iOS.

The core user flow is:

```text
login -> onboarding/profile -> discovery -> profile detail -> point-gated 1:1 chat room -> translated chat
```

## Market Strategy

Hana's early supply problem should be solved from the Japanese side first. The
working assumption is that if enough Japanese users join to talk with Korean
users, Korean user acquisition becomes easier because there is visible demand
and available conversation partners.

Product positioning for Japan:

```text
韓国語を学びたい日本人が、安心して韓国人と話せるアプリ
```

Product positioning for Korea:

```text
일본인과 자연스럽게 대화하고 일본어를 연습하는 앱
```

This does not mean building two separate apps. Use one shared Firebase backend
and one shared app codebase, with store-region build configuration:

- `HANA_STORE_REGION=jp`: Japanese store build, Japanese default UI, Japanese
  legal/policy URLs, Japanese-first onboarding and copy.
- `HANA_STORE_REGION=kr`: Korean store build, Korean default UI, Korean
  legal/policy URLs, Korean-first onboarding and copy.
- Users can still change UI language in Settings.

Do not split the product into separate Korea and Japan apps unless the brand,
feature set, pricing, or compliance surface becomes materially different after
market validation.

## Product Principles

- Design for Japanese-user trust first, then keep Korean UI naturally localized.
- Avoid making Hana look like a dating or swipe app. Prefer language exchange,
  Korean conversation, Korean friends, translation, and safety framing.
- Japanese copy must be native-feeling product copy, not literal Korean
  translation.
- Discovery is profile-list based. Do not build a swipe-first flow.
- Chat is not gated by mutual likes.
- Starting a new 1:1 chat room costs 1 point.
- Reopening an existing active chat room does not cost a point.
- Leaving a 1:1 chat room closes it for both participants and removes it from
  active chat lists.
- Starting a chat again with the same person after a room was closed creates a
  new room, hides previous messages from that new conversation, and costs 1
  point.
- Server code, not client code, owns point deduction and chat-room creation.
- Chat messages must preserve `originalText`; translations are additive.
- Fake/mock users must never appear in release or promotion builds.
- Block/report actions must prevent future contact and remove the user from
  active exposure paths.
- Safety, payment, and moderation state must not rely only on client-side
  checks.
- Use the completed Ieum app as an engineering maturity reference for release
  process, Firebase safety, rules tests, and store-review preparation. Do not
  copy product flows that conflict with Hana's direct translated-chat model.

## Current MVP Shape

Bottom navigation:

- Discovery: profile discovery feed.
- Lounge: secondary community feed.
- Chats: active 1:1 chat rooms.
- Settings: account, safety, app settings.

Primary screens:

- Login
- Onboarding/profile setup
- Discovery list
- Profile detail
- Chat list
- Chat room with Korean/Japanese translation
- Point shortage / recharge entry
- Report / block
- Account deletion

## Current UX Direction

The next UX pass should keep the existing backend and feature flow, but redesign
the user-facing layer around Japanese first-time confidence.

Keep:

- Firebase data model and Cloud Functions contracts.
- Direct profile detail -> `startChat` chat creation.
- Point-gated new chat creation.
- Translated chat message contract.
- Report, block, account deletion, and server-owned safety state.

Change:

- Login and first-launch copy.
- Onboarding order and wording.
- Discovery card information priority.
- Profile detail CTA and point explanation.
- Chat translation display clarity.
- Point shortage and purchase copy.
- Empty, loading, blocked, reported, and unavailable states.
- Japanese safety and trust copy.

Target Japanese tone:

- Friendly, calm, and low-pressure.
- Use `交流`, `会話`, `韓国語`, `韓国の人`, and `友だち` where appropriate.
- Avoid overusing `出会い`, `マッチ`, romance framing, or aggressive conversion
  copy.
- Good CTA examples:
  - `翻訳つきで話してみる`
  - `韓国語で会話を始める`
  - `話してみる`
- Point explanation should be clear but secondary:
  - `新しいチャット開始に1ポイント使います`
  - `すでにあるチャットには追加ポイントはかかりません`

## Phase 0 - Product Contract Cleanup

Goal: remove ambiguity before adding more features.

Tasks:

- Update `AGENTS.md` to explicitly describe the point model.
- Treat `matches` as the legacy Firestore path for active chat rooms.
- Keep the UI language focused on "chat room" instead of "match" where possible.
- Define release behavior for empty discovery: show an empty state, not mock
  profiles.
- Define point refund policy for failed chat creation, block/report cases, and
  deleted or banned targets.

Acceptance criteria:

- Future agents can read `AGENTS.md` and this roadmap without inferring a
  mutual-like chat model.
- Product decisions around points and chat-room reuse are explicit.

## Phase 1 - Backend Safety And Points

Goal: make the core paid chat flow enforceable from the server.

Tasks:

- Rename or wrap `keyCount` conceptually as points. Prefer a future additive
  migration to `pointBalance`.
- Keep `startChat(data: { targetUid })` as the only path that creates or reuses
  a 1:1 chat room.
- In `startChat`, check before deducting a point:
  - caller is authenticated and not banned
  - target exists and is not banned
  - caller is not chatting with self
  - neither user has blocked the other
  - existing active chat room should be returned without point deduction
- Deduct exactly 1 point only when creating a new active chat room.
- Return a clear `resource-exhausted` error when points are insufficient.
- Make Firestore rules reject client-created `matches` documents.
- Restrict `matches` updates to safe client-owned fields, or route updates
  through Cloud Functions.
- Strengthen message creation rules or move message sending fully to the
  `sendMessage` callable.

Acceptance criteria:

- A modified client cannot create a chat room without the server point check.
- A modified client cannot message after block, report, ban, or inactive chat.
- Existing chat-room reuse never spends another point.

## Phase 2 - Flutter Core Flow

Goal: make the main user path simple, understandable, and consistent.

Tasks:

- Profile detail chat CTA calls `startChat`.
- If points are available, navigate to `/chat/:matchId`.
- If points are insufficient, show a point shortage/recharge path.
- Existing active chat rooms open without showing a payment barrier.
- Closed chat rooms are never reactivated. The next chat with the same person
  is a new paid room.
- Remove or hide mutual-match UI from the main discovery flow.
- Keep `/matches` as legacy/secondary only, with `/chats` as the main chat list.
- Add loading, empty, and error states for discovery, profile detail, and chat
  creation.

Acceptance criteria:

- A user can understand that one new chat room costs one point.
- There is no UI suggesting mutual likes are required to chat.
- Chat creation failures explain what happened without losing the user.
- If either user leaves a chat, the chat disappears from active lists and the
  same pair's next chat starts empty in a new room.

## Phase 2.5 - Japanese-First UX Reframe

Goal: make the Japanese store build feel like an app for Japanese users who want
to safely talk with Korean people, not like a generic translated matching app.

This phase should happen before adding more secondary features. The core
technical architecture is already close enough; the current gap is first
impression, copy, trust, and information priority.

Tasks:

- Login / first launch:
  - Japanese store build starts in Japanese before sign-in.
  - Explain the product as Korean conversation with translation support.
  - Show trust cues such as report/block and optional profile photo.
- Onboarding:
  - Keep required steps short.
  - Make profile photo clearly optional.
  - Default Japanese users toward native Japanese / learning Korean where
    appropriate, while still allowing changes.
  - Ask for interests and a short intro in a way that helps Korean users start
    conversations.
- Discovery:
  - Prioritize nationality, spoken/learning languages, interests, and short bio.
  - Make Korean profiles easy for Japanese users to scan.
  - Use `さがす` or similarly natural navigation copy for the Japan build.
  - Empty states should explain whether there are no visible Korean users,
    filters/blocks removed candidates, or a network error occurred.
- Profile detail:
  - Make the primary CTA `翻訳つきで話してみる` or equivalent.
  - Show the one-point cost as a small, clear explanation below the CTA.
  - Keep block/report visible but visually separate from the main action.
- Chat:
  - Show original and translated text with clear labels.
  - Keep pending/failed translation states visible and calm.
  - Do not hide the original message.
- Points:
  - Explain points as a new conversation starter, not a dating paywall.
  - Use copy such as `1ポイント = 新しいチャット1件`.
  - Make existing active chat reuse clearly free.

Acceptance criteria:

- A Japanese tester understands within the first minute that Hana is for safe
  Korean conversation and language exchange.
- A Japanese tester can complete onboarding without adding a photo.
- A Japanese tester can find a Korean profile, understand the point cost, and
  start a translated chat without seeing dating/mutual-like language.
- Korean UI remains natural and does not become a literal mirror of Japanese
  copy.

## Phase 3 - Real Discovery And Mock Isolation

Goal: make discovery release-safe.

Status: implemented for Discovery and Lounge fallback paths through
`AppConfig.allowMockData`; mock data is off by default and only appears when a
debug build explicitly passes `--dart-define=ALLOW_MOCK_DATA=true`.
Profile/release builds cannot display mock data.

Tasks:

- Remove automatic mock fallback from normal app runtime. (Done)
- Gate mock candidates behind an explicit debug/development flag only.
- In release/profile builds, show real users only.
- Exclude blocked, blocker, banned, deleted, and incomplete profiles.
- Keep empty discovery calm and honest: no fake profiles.
- Review filtering logic for Korean/Japanese market assumptions.

Acceptance criteria:

- Release builds cannot display `mock_candidates.dart` data.
- Firebase errors produce an error state, not fake profiles.
- Empty markets display an empty state suitable for promotion builds.

## Phase 4 - Translation Chat

Goal: make Korean/Japanese translation the product's strongest feature.

Tasks:

- Preserve `originalText` permanently.
- Store detected `originalLang`.
- Store translations under additive fields, such as `translations.ko` and
  `translations.ja`.
- Show original and translated text clearly in the chat bubble.
- Handle translation pending, done, and failed states.
- Avoid overwriting or hiding the original when translation fails.
- Route message sending through the `sendMessage` callable, not direct client
  Firestore message writes.
- Keep `onMessageCreated` side effects isolated: translation failure should not
  prevent the message from existing, and inactive/blocked/banned recipients
  should not receive unread increments or FCM.
- Decide the default display policy:
  - show original first with a translation toggle, or
  - show translated first with original available.
- Track translation cost and rate-limit strategy before launch.

Acceptance criteria:

- A Korean and Japanese user can chat without losing the original message.
- Translation failure does not break the chat.
- The UI makes it clear which text is original and which text is translated.

## Phase 5 - Trust, Safety, And Store Review

Goal: meet baseline social app safety expectations for Korea/Japan store launch.

Tasks:

- Block user:
  - writes server-owned block state
  - removes future discovery exposure
  - prevents chat creation
  - prevents message sending
  - suppresses notifications
- Report user:
  - writes non-public moderation records
  - includes context such as `matchId`, `messageId`, or `postId` when available
  - auto-blocks if that remains the product policy
  - deactivates unsafe chat paths
- Account deletion:
  - deletes or anonymizes user-owned profile data
  - preserves moderation records where needed
  - removes active exposure
- Add privacy policy, terms, community guidelines, and support/contact paths.
- Ensure Japanese and Korean user-facing safety strings are localized.

Acceptance criteria:

- A blocked or reported user cannot continue contact through discovery, chat,
  or notifications.
- Normal users cannot read report records.
- Store reviewers can find report, block, and account deletion paths.

## Phase 6 - Monetization And Store Payments

Goal: convert point usage into a reliable paid model.

Tasks:

- Define point packages and free starting balance.
- Show point balance in relevant UX surfaces.
- Add point purchase UI.
- Android: integrate Play Billing and server-side purchase verification.
- iOS: integrate StoreKit and server-side purchase verification.
- Record point ledger events server-side:
  - grant
  - purchase
  - consume
  - refund or adjustment
- Make point balance derived or auditable from server-owned events.
- Write clear paid item copy for Korea and Japan.

Acceptance criteria:

- Users understand what points do before purchase.
- Purchases are verified server-side before points are granted.
- Point spending is auditable and cannot be forged by a modified client.

## Phase 7 - Launch Readiness

Goal: prepare real release builds for Korea/Japan stores.

Status: staging/prod command structure has started. Store-region legal URLs and
default UI locale are wired for Korea/Japan builds. `hana-e2ee6` is currently
treated as staging, and production still needs a separate Firebase project.

Tasks:

- Split staging and production Firebase configuration and scripts, following the
  proven Ieum pattern. (Started)
- Create the real production Firebase project and replace the current
  placeholder production alias.
- Add resilient app bootstrap: App Check provider handling, Firebase timeout
  handling, boot error recording, and graceful boot failure UI. (Done for
  staging/debug flow)
- Android release build, signing, Play Console setup.
- iOS release build, signing, App Store Connect setup.
- App icon, screenshots, short/long descriptions in Korean and Japanese, with
  Japanese store assets written for Japanese users first.
- Privacy policy and terms URLs. (Published Korean/Japanese GitHub Pages URLs
  added; operator/legal details still need final review)
- Account deletion, child safety/community safety, and support/contact pages or
  docs. (Published Korean/Japanese GitHub Pages URLs added; operator/legal
  details still need final review)
- App tracking/privacy nutrition labels where required.
- Firebase App Check production configuration.
- Crash/analytics decision and disclosure.
- Production Firebase indexes and rules review.
- Firebase rules tests for users, matches/messages, reports, blocks, lounge,
  ratings, and points. (Started; current rules suite covers core server-owned
  paths and ratings)
- Manual QA on Android first, then iOS. (Started; existing-user profile,
  settings, lounge, rating, chat list, and FCM boot path passed)

Current remaining Android QA before promotion/store review:

- Fresh-account onboarding with image upload and profile completion.
- Two-account direct chat and translation pass after latest safety changes.
- Block/report regression pass.
- Guarded account deletion pass.
- Real purchase sandbox flow after Play Billing is implemented.

Acceptance criteria:

- A reviewer can complete onboarding, discovery, chat creation, messaging,
  report/block, and account deletion.
- No mock users appear.
- Paid point behavior is clearly described and works in sandbox.
- Korean store builds default to Korean UI and Korean policy URLs.
- Japanese store builds default to Japanese UI and Japanese policy URLs.

## Section Reference

Use this section to decide which files and contracts to inspect before making
changes.

### Ieum Reference App

Read in the completed reference app when a task touches release process,
Firebase safety, store review, or architecture:

- `/Users/bon-hyunkoo/chat-app/CLAUDE.md`
- `/Users/bon-hyunkoo/chat-app/lib/main.dart`
- `/Users/bon-hyunkoo/chat-app/firebase/firestore.rules`
- `/Users/bon-hyunkoo/chat-app/firebase/test/firestore.rules.test.js`
- `/Users/bon-hyunkoo/chat-app/docs/eval_release.md`
- `/Users/bon-hyunkoo/chat-app/docs/architecture/schema.md`
- `/Users/bon-hyunkoo/chat-app/scripts/`

Borrow:

- staging/prod Firebase separation and scripts
- App Check/bootstrap/Crashlytics hardening
- repository/provider injection discipline
- Firebase rules test coverage
- account deletion and store-review documentation
- IAP receipt-verification direction

Do not borrow:

- any flow that implies mutual matching is required for chat
- mock/fake-user exposure in release or promotion builds
- product assumptions that weaken Hana's Korean/Japanese translation-first chat
  contract

### Product And Navigation

Read:

- `AGENTS.md`
- `lib/app/router/app_router.dart`
- `lib/core/widgets/bottom_nav_bar.dart`
- `README.md`

Check:

- Main tabs remain Discovery, Lounge, Chats, Settings.
- `/chats` is the primary chat list.
- `/matches` is legacy or secondary.

### Discovery And Profile

Read:

- `lib/features/discovery/presentation/discovery_screen.dart`
- `lib/features/discovery/presentation/discovery_provider.dart`
- `lib/features/discovery/data/discovery_repository_impl.dart`
- `lib/features/discovery/data/mock_candidates.dart`
- `lib/features/profile/presentation/profile_detail_screen.dart`

Check:

- Real users only in release.
- Profile detail is the decision surface.
- Chat CTA uses `startChat`.
- No mutual-like gate is required.

### Points And Chat Creation

Read:

- `firebase/functions/src/index.ts`
- `lib/features/discovery/data/discovery_repository_impl.dart`
- `lib/features/paywall/presentation/paywall_screen.dart`
- `lib/features/paywall/presentation/key_provider.dart`

Check:

- New chat room creation costs 1 point.
- Existing room reuse costs 0 points.
- Point deduction happens server-side.
- Insufficient points route to a clear recharge flow.

### Chat And Translation

Read:

- `lib/features/chat/data/chat_repository_impl.dart`
- `lib/features/chat/domain/chat_message.dart`
- `lib/features/chat/presentation/chat_screen.dart`
- `firebase/functions/src/index.ts`
- `firebase/firestore.rules`

Check:

- `originalText` is required and immutable by product policy.
- Translations are additive.
- Blocked/inactive chats cannot accept new messages.
- Translation failure does not destroy the original message.

### Safety And Moderation

Read:

- `lib/features/safety/data/safety_repository_impl.dart`
- `lib/features/safety/presentation/report_bottom_sheet.dart`
- `lib/features/safety/presentation/block_confirm_dialog.dart`
- `lib/features/settings/presentation/blocked_users_screen.dart`
- `firebase/functions/src/index.ts`
- `firebase/firestore.rules`

Check:

- Block/report are server callables.
- Report records are not readable by normal clients.
- Blocked users disappear from exposure and contact paths.
- FCM respects block and ban state.

### Store Launch

Read:

- `pubspec.yaml`
- `android/`
- `ios/`
- Firebase console configuration
- Store listing assets and policy docs when added

Check:

- Android and iOS build settings are release-ready.
- Korean and Japanese localization is complete enough for review.
- Privacy, terms, report/block, and account deletion are available.
- Store-region builds are configured correctly:
  - Korea: `HANA_STORE_REGION=kr`
  - Japan: `HANA_STORE_REGION=jp`

## Immediate Recommended Backlog

1. Japanese-first UX reframe pass: login, onboarding, discovery cards, profile
   detail CTA, point shortage copy, and chat translation labels.
2. Add Japanese copy QA: review all Japanese UI strings for native-feeling tone,
   avoiding dating-heavy language.
3. Prepare Japan store listing copy and screenshot story before Korean store
   listing finalization.
4. Keep automated QA green while changing UI: `flutter analyze`,
   `flutter test`, and `scripts/run_automated_qa.sh`.
5. Add or update emulator smoke checks for `HANA_STORE_REGION=jp` and
   `HANA_STORE_REGION=kr` first-launch behavior.
6. Finalize operator/legal details in Korean and Japanese policy pages.
7. Continue launch readiness: production Firebase project, upload signing,
   Play Billing verification enablement, and later iOS StoreKit verification.
8. Improve translated chat display states and retry UX.
9. Audit remaining mutual-like/pass wording and remove it from primary UX.
10. Prepare Android-first store checklist, then iOS parity checklist.
