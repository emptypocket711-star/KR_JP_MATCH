# KR/JP Match App Working Guide

This file is the current source of truth for Codex or any coding agent working
in this repository. If another document conflicts with this one, follow this
file and update or remove the stale document.

## Product

- App name/product: Hana, a Korea-Japan social matching and language-exchange app.
- Primary markets: Korean and Japanese users.
- Platform priority: Android first. iOS can come later.
- Core flow: login -> onboarding/profile setup -> discovery -> profile detail -> direct chat.
- Lounge is a secondary community feed for cross-culture conversation.

## Current Non-Negotiable Rules

- There is no swipe-based discovery flow.
- Chat is not gated by mutual matching.
- Pressing the chat CTA on a profile creates or reuses a 1:1 chat room immediately.
- Do not reintroduce "mutual like unlocks chat" unless the product direction changes explicitly.
- Do not reintroduce candidate quota or swipe credits as the primary discovery model.
- The `matches` Firestore collection currently stores chat-room relationship records. Treat it as the active chat room collection, not only as mutual-like matches.
- Chat messages must preserve `originalText`; translations are additive and must never overwrite the original.
- Block/report actions must prevent future contact and remove the user from active exposure paths.

## Current App Shape

- Bottom navigation currently has four tabs:
  - `/discovery`: profile discovery feed
  - `/lounge`: community lounge
  - `/chats`: active chat list
  - `/settings`: settings
- `/matches` still exists in routing/code as legacy or secondary surface. Do not treat it as the main chat gate.
- Discovery is a vertical list of profile cards. Tapping a card opens `/profile/detail/:uid`.
- Profile detail is the main decision surface. The primary CTA calls `startChat`.
- Chat rooms are opened at `/chat/:matchId`.

## Technology

- Flutter app using Riverpod and GoRouter.
- Firebase Auth, Firestore, Storage, Cloud Functions, FCM, and App Check.
- Firebase Functions live in `firebase/functions/src/index.ts`.
- App code is feature-first under `lib/features/<feature>/`.
- Shared app shell, router, theme, widgets, and services live under `lib/app` and `lib/core`.

## Important Files

- `lib/app/router/app_router.dart`: route definitions and auth/profile redirects.
- `lib/core/widgets/bottom_nav_bar.dart`: current bottom navigation.
- `lib/features/discovery/presentation/discovery_screen.dart`: discovery feed.
- `lib/features/discovery/data/discovery_repository_impl.dart`: discovery and `startChat` repository calls.
- `lib/features/profile/presentation/profile_detail_screen.dart`: direct-chat CTA.
- `lib/features/chat/data/chat_repository_impl.dart`: message writes.
- `lib/features/chat/presentation/chat_screen.dart`: translated chat UI.
- `lib/features/matches/data/matches_repository_impl.dart`: reads active chat-room records.
- `firebase/functions/src/index.ts`: callable functions and Firestore triggers.
- `firebase/firestore.rules` and `firebase/storage.rules`: access control.

## Backend Contract Notes

- `startChat(data: { targetUid })` creates or reuses the chat room document and returns `matchId`.
- `sendMessage` may exist as a callable, but the current Flutter repository writes messages directly to Firestore.
- `onMessageCreated` detects language, writes translations, updates unread counts, and may send FCM.
- `blockUser` and `reportUser` are server callables and should keep chat/safety state consistent.
- Client code should not write server-owned moderation or safety state directly unless the current rules explicitly allow it.

## Data Model Terms

- `users/{uid}`: profile and app user state.
- `matches/{matchId}`: active 1:1 chat room record, despite the legacy name.
- `matches/{matchId}/messages/{messageId}`: chat messages with immutable original text.
- `users/{uid}/blocks/{targetUid}`: block list.
- `reports/{reportId}`: moderation intake.
- `posts/{postId}` and `post_likes/{postId}/likes/{uid}`: lounge/community data.

## Coding Conventions

- Keep changes small and scoped.
- Follow existing feature folders: `data`, `domain`, `presentation`.
- Prefer existing providers, repositories, routes, and theme constants over new abstractions.
- Keep UI strings localizable where practical.
- Do not commit generated build output, `.dart_tool`, `build`, Gradle caches, or `node_modules`.
- Do not commit keystores, service account keys, `.env` files, or private secrets.

## Known Cleanup Needed

- Some Korean/Japanese text in Dart files is mojibake from earlier encoding damage. Fix user-visible strings carefully when touching those screens.
- Several names still use "match" because the chat-room collection is called `matches`. Do not infer mutual-like gating from the name alone.
- Some legacy like/pass code may remain. Remove or refactor it only when it is clearly unused and covered by the current direct-chat flow.

## Mac Setup

```bash
git clone https://github.com/emptypocket711-star/KR_JP_MATCH.git
cd KR_JP_MATCH
flutter pub get
cd firebase/functions
npm install
```

Run from the repo root:

```bash
flutter analyze
flutter test
```
