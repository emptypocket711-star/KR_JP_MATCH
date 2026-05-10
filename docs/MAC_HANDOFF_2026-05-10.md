# Mac Handoff - 2026-05-10

This document summarizes today's repository setup and the exact steps to
continue work from a Mac.

## GitHub Repository

- Repository URL: `https://github.com/emptypocket711-star/KR_JP_MATCH.git`
- Branch: `main`
- Baseline commit before this handoff note: `66c0765 Document current direct chat product flow`
- Windows working path used today: `C:\dev\krjp_match_app`
- Recommended Mac working path: `~/dev/KR_JP_MATCH`

## Clone On Mac

```bash
mkdir -p ~/dev
cd ~/dev
git clone https://github.com/emptypocket711-star/KR_JP_MATCH.git
cd KR_JP_MATCH
git status
git log --oneline -3
```

Expected status after clone:

```text
On branch main
nothing to commit, working tree clean
```

## Required Local Tools On Mac

- Flutter SDK with Android support
- Android Studio or Android SDK command-line tools
- JDK compatible with the Android Gradle plugin
- Node.js and npm for Firebase Functions
- Firebase CLI if deploying or running emulators

Check the environment:

```bash
flutter doctor
node --version
npm --version
```

## Install Dependencies

From the repo root:

```bash
flutter pub get
```

For Firebase Functions:

```bash
cd firebase/functions
npm install
npm run build
cd ../..
```

## Verify The App

From the repo root:

```bash
flutter analyze
flutter test
```

Run on a connected Android device or emulator:

```bash
flutter run
```

## What Was Done Today

1. Initialized Git in `C:\dev\krjp_match_app`.
2. Added `.gitignore` coverage for Flutter build output, Dart tool state,
   Gradle caches, Android local files, Firebase Functions `node_modules`, and
   generated Functions output.
3. Added `.gitattributes` to keep text line endings stable across Windows and
   macOS, and to mark image/font assets as binary.
4. Created the initial Git commit and pushed it to GitHub.
5. Clarified the current product direction in `AGENTS.md`.
6. Removed stale documents that described the old mutual-match/swipe/quota
   model:
   - `CLAUDE.md`
   - `docs/DATA_CONTRACT.md`
   - `.claude/agents/*.md`
7. Updated `README.md` to reflect the current direct-chat flow.

## Current Product Truth

The root `AGENTS.md` is the current source of truth for future Codex sessions.

Important current rules:

- There is no swipe-based discovery flow.
- Chat is not gated by mutual matching.
- Pressing the chat CTA on a profile creates or reuses a 1:1 chat room
  immediately.
- The Firestore `matches` collection currently represents active 1:1 chat-room
  relationship records, despite the legacy name.
- Translated chat must preserve `originalText`; translations are additive.

## Key Files To Read First

- `AGENTS.md`
- `README.md`
- `lib/app/router/app_router.dart`
- `lib/core/widgets/bottom_nav_bar.dart`
- `lib/features/discovery/presentation/discovery_screen.dart`
- `lib/features/profile/presentation/profile_detail_screen.dart`
- `lib/features/discovery/data/discovery_repository_impl.dart`
- `lib/features/chat/presentation/chat_screen.dart`
- `lib/features/chat/data/chat_repository_impl.dart`
- `firebase/functions/src/index.ts`

## Known Follow-Up Work

- Fix mojibake in Korean/Japanese user-facing strings.
- Continue aligning names that still say "match" with the current direct-chat
  product model, without breaking the existing `matches` Firestore path.
- Review Firestore rules against the current direct-message write flow.
- Run a full Flutter/Firebase verification on the Mac after cloning.

## Normal Git Workflow On Mac

```bash
git pull
# make changes
git status
git add -A
git commit -m "Describe the change"
git push
```
