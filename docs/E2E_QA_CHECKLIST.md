# Hana E2E QA Checklist

Use this checklist before a promotion build or store review build. The goal is
to verify the Korea/Japan direct-chat flow without exposing mock users.

## Preconditions

- Deploy the current Firestore rules and Cloud Functions to the intended
  Firebase project.
- Register the Android test device's App Check debug token in Firebase
  Console or through the App Check REST API.
- Use two real test accounts:
  - User A: Korean profile, native language `ko`, learning language `ja`
  - User B: Japanese profile, native language `ja`, learning language `ko`
- Build with mock data disabled. This is the default, but pass the flag
  explicitly for promotion/store QA:

```bash
flutter run -d <android-device-id> --dart-define=ALLOW_MOCK_DATA=false
```

Release/profile builds disable mock data regardless of this flag.

To intentionally use local mock profiles during UI development, use a debug
build with `--dart-define=ALLOW_MOCK_DATA=true`. Do not use that flag for
promotion videos, store review builds, or real-user QA.

For local QA only, the debug build can expose an email/password login form:

```bash
flutter run -d <android-device-id> \
  --dart-define=ALLOW_MOCK_DATA=false \
  --dart-define=ALLOW_QA_EMAIL_LOGIN=true \
  --dart-define=ALLOW_QA_POINT_GRANT=true
```

`ALLOW_QA_EMAIL_LOGIN` and `ALLOW_QA_POINT_GRANT` are ignored in
release/profile builds. The QA point grant also requires a `@hana.example` test
account on the server; it is not a production purchase path.

Store-region UI defaults should be checked separately:

```bash
flutter run -d <android-device-id> \
  --dart-define=DEFAULT_UI_LOCALE=ja \
  --dart-define=LEGAL_TERMS_URL=https://emptypocket711-star.github.io/KR_JP_MATCH/legal/ja/terms/ \
  --dart-define=LEGAL_PRIVACY_URL=https://emptypocket711-star.github.io/KR_JP_MATCH/legal/ja/privacy/ \
  --dart-define=LEGAL_COMMUNITY_SAFETY_URL=https://emptypocket711-star.github.io/KR_JP_MATCH/legal/ja/community-safety/ \
  --dart-define=LEGAL_ACCOUNT_DELETION_URL=https://emptypocket711-star.github.io/KR_JP_MATCH/legal/ja/account-deletion/ \
  --dart-define=ALLOW_MOCK_DATA=false

flutter run -d <android-device-id> \
  --dart-define=DEFAULT_UI_LOCALE=ko \
  --dart-define=LEGAL_TERMS_URL=https://emptypocket711-star.github.io/KR_JP_MATCH/legal/ko/terms/ \
  --dart-define=LEGAL_PRIVACY_URL=https://emptypocket711-star.github.io/KR_JP_MATCH/legal/ko/privacy/ \
  --dart-define=LEGAL_COMMUNITY_SAFETY_URL=https://emptypocket711-star.github.io/KR_JP_MATCH/legal/ko/community-safety/ \
  --dart-define=LEGAL_ACCOUNT_DELETION_URL=https://emptypocket711-star.github.io/KR_JP_MATCH/legal/ko/account-deletion/ \
  --dart-define=ALLOW_MOCK_DATA=false
```

Production AAB builds should use `HANA_STORE_REGION=jp` or
`HANA_STORE_REGION=kr` through `scripts/build_prod_aab.sh`, which injects the
matching default UI locale and policy URLs.

Japan build expectation:

- Login and first-launch UI starts in Japanese before sign-in.
- Legal links point to `/legal/ja/...`.
- Copy frames Hana as safe Korean conversation and language exchange, not swipe
  dating.

Korea build expectation:

- Login and first-launch UI starts in Korean before sign-in.
- Legal links point to `/legal/ko/...`.
- Settings language override still works after sign-in.

In debug QA builds, the login screen also exposes a `신규 QA 계정 생성` action.
Use a fresh email address with a normal test domain such as
`qa.new.0511.1@hanatest.com` and a 6+ character password, then complete
onboarding from the redirected profile setup screen.

## Account Setup

For each account, complete onboarding with:

- Display name
- Birth year
- Gender
- Nationality
- Residing country
- Native and learning language
- Bio
- Optional profile photo. Account creation and onboarding must still complete
  when no photo is uploaded.

Verify both users have:

- `onboardingCompleted: true`
- `isBanned: false`
- `keyCount >= 1`

Current Android staging notes:

- Existing-user profile edit, photo upload, settings, lounge posting/comments,
  profile navigation from lounge, rating score display, rating submission, chat
  list display, and FCM boot path have passed on the USB Android test device.
- First-signup onboarding includes optional profile photo upload and still needs
  a fresh-account QA pass on the USB Android test device.
- Account deletion still needs a guarded destructive QA pass.

## Smoke Flow

1. Sign in as User A.
2. Open Discovery.
3. Verify User B can appear and no `mock_` profile appears.
4. Open User B's profile detail.
5. Tap the chat CTA.
6. Verify a 1:1 chat opens and User A loses exactly 1 point only if the room was newly created.
7. Send a Korean message from User A.
8. Sign in as User B.
9. Open Chats and enter the same room.
10. Verify the message shows Japanese translation and original Korean is still available.
11. Send a Japanese reply from User B.
12. Sign in as User A and verify Korean translation appears.
13. Reopen User B's profile after chat creation.
14. Verify `평가하기` appears.
15. Submit one rating and verify the completion screen appears.
16. Reopen the profile and verify the rating score/count is visible.

## Chat Exit And Restart Flow

1. User A opens an active chat room with User B.
2. User A leaves the chat room.
3. Verify the room disappears from User A's active chat list.
4. Sign in as User B and verify the same room also disappears from User B's
   active chat list.
5. User A opens User B's profile again.
6. Verify the CTA says this is a new chat start and shows the current point
   balance / 1-point cost.
7. Start chat again.
8. Verify a new room opens with no previous messages visible.
9. Verify User A loses exactly 1 point.
10. Leave the new room and repeat once to confirm the same pair can create a
    fresh room again and each new room costs 1 point.

## Safety Flow

1. User A blocks User B from the chat room.
2. Verify the room disappears from active chat lists.
3. Verify User B cannot send a new message to User A.
4. Verify User B does not appear in User A Discovery.
5. Verify User A does not appear in User B Discovery.
6. Verify Lounge posts/comments/replies from either blocked side are hidden from the other side.

## Report Flow

1. Recreate or reuse a test pair.
2. User A reports User B.
3. Verify a report document is created server-side and is not readable by clients.
4. Verify the related chat room is closed and hidden.
5. Verify future chat creation between the pair is blocked.

## Account Deletion Flow

1. Create a lounge post, comment, reply, rating, and chat as User A.
2. Delete User A from Settings.
3. Verify User A Auth account is deleted.
4. Verify User A profile doc and private subcollections are removed.
5. Verify User A's active chat rooms are inactive with `closedReason: account_deleted`.
6. Verify User A's lounge posts are deleted.
7. Verify User A's comments/replies on other posts are anonymized.

## Pass Criteria

- No mock Discovery users or mock Lounge posts appear.
- Legacy/operator Lounge posts do not appear in promotion/store QA.
- Chat creation is direct and costs points only for a newly created room.
- Leaving a chat closes it for both users, and a later chat with the same user
  creates a fresh room with no previous messages visible.
- Translations are additive; `originalText` remains unchanged.
- Block/report/delete prevents future contact and active exposure.
- No user can directly read another user's private `users/{uid}` document.
- Clients cannot directly create ratings or write notification tokens; these go
  through Cloud Functions.
