# KRJP Match App - Data and API Contract (v1)

This document is the single source of truth for all workers. Do not change shapes without updating this file first. All Firestore document shapes and Cloud Function signatures below are binding.

Scope: MVP. Where a real external dependency is required (IAP, translation API), stub with a clearly-marked interface so it can be swapped later.

---

## 1. Firestore collections

### users/{uid}
Auth-linked user record. Written on first sign-in; updated by user.

Fields:
- uid: string
- createdAt: Timestamp
- updatedAt: Timestamp
- onboardingCompleted: boolean
- displayName: string
- birthYear: number (int, e.g. 1998)
- gender: one of [male, female]
- nationality: one of [KR, JP]
- residingCountry: one of [KR, JP, OTHER]
- nativeLanguage: one of [ko, ja]
- learningLanguage: one of [ko, ja]
- bio: string (<= 500 chars)
- photoUrls: array of string (<= 6, Storage URLs)
- preferredGender: one of [male, female, any]
- preferredNationality: one of [KR, JP, any]
- preferredAgeMin: number
- preferredAgeMax: number
- quotaRemaining: number  (decremented per candidate consumed)
- quotaResetAt: Timestamp  (server-assigned next hourly reset)
- extraQuotaPurchased: number  (extra slots remaining)
- isBanned: boolean
- fcmToken: string or null

### users/{uid}/seen/{otherUid}
Anti re-exposure ledger. Never re-surface a uid listed here. Written by server when a candidate is delivered (passed, liked, blocked, reported, or matched).

Fields:
- seenAt: Timestamp
- reason: one of [pass, like, match, block, report, delivered]

### users/{uid}/blocks/{otherUid}
Blocklist. Server consults on candidate generation and message send.

Fields:
- blockedAt: Timestamp
- reason: string or null

### likes/{likeId}
Directed like. likeId = fromUid + "_" + toUid. A pass is NOT stored here; it only appears in the seen ledger.

Fields:
- fromUid: string
- toUid: string
- createdAt: Timestamp
- status: one of [pending, matched, expired]
- matchId: string or null

### matches/{matchId}
Created only when mutual like is detected (transactional). matchId is min(a,b) + "_" + max(a,b).

Fields:
- matchId: string
- userIds: array of exactly 2 strings (sorted)
- createdAt: Timestamp
- lastMessageAt: Timestamp or null
- lastMessagePreview: string or null (original text truncated)
- unread: map uid -> number
- isActive: boolean (false when either user blocks)

### matches/{matchId}/messages/{messageId}
Chat messages. Original text is immutable. Translations are added later by a trigger but never overwrite originalText.

Fields:
- messageId: string
- senderId: string
- createdAt: Timestamp
- originalText: string  (IMMUTABLE after create)
- originalLang: one of [ko, ja, unknown]
- translations: map with keys ko and ja, each string or null
- translationStatus: one of [pending, done, failed]
- deletedForSender: boolean  (soft hide from own side only)

### reports/{reportId}
Moderation intake. Write-only from client; read by admin/server.

Fields:
- reportId: string
- reporterUid: string
- targetUid: string
- reason: one of [spam, harassment, inappropriate_photo, fake_profile, other]
- note: string (<= 1000 chars)
- matchId: string or null
- createdAt: Timestamp
- status: one of [open, reviewed, actioned]

### candidatePool/{uid}  (server-internal; optional cache)
Server may maintain a short-lived candidate cache per user. Client never reads this directly; client only calls requestCandidates.

### quotaEvents/{eventId}  (server-internal, audit)
Logs quota grants/consumption for anti-abuse analysis.

---

## 2. Cloud Functions - callable signatures

All callables require App Check + authenticated user. Reject if context.auth is null. Reject if users/{uid}.isBanned == true.

### completeOnboarding(data: UserProfileInput) -> { ok: true }
Validates and writes the user profile. Initializes quotaRemaining = 10, quotaResetAt = now + 1h.

### requestCandidates(data: { limit?: number }) -> { candidates: PublicProfile[], quotaRemaining: number, quotaResetAt: Timestamp }
Server-authoritative candidate selection. Rules:
- Reset quota if now >= quotaResetAt (base 10/hour).
- Exclude: self, anyone in users/{uid}/blocks, anyone in users/{uid}/seen, anyone with isBanned=true, anyone who blocked the caller.
- Apply preference filters (gender, nationality, age range).
- Return up to min(limit, quotaRemaining) candidates.
- For each returned candidate, write users/{uid}/seen/{otherUid} with reason=delivered and decrement quota atomically.
- PublicProfile = subset of user doc with no sensitive fields (no fcmToken, no preferences, no quota).

### likeUser(data: { targetUid: string }) -> { matched: boolean, matchId: string or null }
- Create likes/{fromUid}_{targetUid} if not exists.
- Transactionally check if likes/{targetUid}_{fromUid} exists with status=pending.
- If yes: atomically create matches/{matchId}, update both like docs to status=matched, write seen ledger entries with reason=match.
- If no: write seen ledger for caller with reason=like.

### passUser(data: { targetUid: string }) -> { ok: true }
Writes users/{uid}/seen/{targetUid} with reason=pass. No other state changes.

### sendMessage(data: { matchId: string, originalText: string }) -> { messageId: string }
- Verify caller is in matches/{matchId}.userIds and matches/{matchId}.isActive==true.
- Verify neither side has blocked the other.
- Write message doc with translationStatus=pending, translations={ko:null,ja:null}.
- Update match summary (lastMessageAt, lastMessagePreview, unread).
- A separate Firestore onCreate trigger performs translation.

### blockUser(data: { targetUid: string, reason?: string }) -> { ok: true }
- Write users/{uid}/blocks/{targetUid}.
- Write seen ledger for caller with reason=block.
- If an active match exists, set matches/{matchId}.isActive=false.

### reportUser(data: { targetUid: string, reason: string, note?: string, matchId?: string }) -> { reportId: string }
- Create reports/{reportId}.
- Auto-block the reporter from the target (same effect as blockUser).

### purchaseExtraQuota(data: { receipt: string, platform: android or ios }) -> { ok: true, extraQuotaGranted: number }
MVP stub: do NOT verify receipt against Play. Accept any non-empty receipt, grant +10 to extraQuotaPurchased, and log a quotaEvents entry. Mark function with a "TODO: verify Play receipt" comment so it is swappable. Extra quota is consumed AFTER base quota and does not reset on the hourly timer.

### Trigger: onMessageCreated (Firestore onCreate on matches/*/messages/*)
- Detect originalLang (simple heuristic: hangul vs kana/kanji ranges; if ambiguous, set unknown).
- Call translation (MVP stub: return prefixed strings; real API is swappable). Mark with TODO: swap to real translation API.
- Update message doc with translations and translationStatus=done.
- NEVER modify originalText.
- On failure: set translationStatus=failed, do not retry more than 3 times.

### Trigger: onUserBlocked (onCreate on users/*/blocks/*)
- If a match exists between the two users, set isActive=false.

---

## 3. Firestore security rules (summary; exact file lives in firebase/firestore.rules)

- Default deny.
- users/{uid}: read any authenticated user. Write only self; quotaRemaining, quotaResetAt, extraQuotaPurchased, isBanned are NOT writable by client (only by admin SDK).
- users/{uid}/seen/*: no client read, no client write. Server-only.
- users/{uid}/blocks/*: owner can read; no direct client write (must use blockUser callable).
- likes/*: no client read, no client write (use likeUser callable).
- matches/{matchId}: read if auth.uid in userIds. No client write.
- matches/{matchId}/messages/*: read if auth.uid in parent match userIds. No client write (use sendMessage).
- reports/*: no client read; no client write (use reportUser).

## 4. Storage rules

- profile_photos/{uid}/{filename}: write only self, read if authenticated. Max 5MB, image/* content type.

---

## 5. Client-side Flutter contract

- Features live under lib/features/<feature>/ with data/, domain/, presentation/.
- Shared services in lib/core/services/.
- Repositories wrap FirebaseFunctions.instance.httpsCallable(...); UI never calls Firebase directly.
- State management: Riverpod. flutter_riverpod + hooks_riverpod optional.
- Routing: go_router, defined in lib/app/router/app_router.dart.
- Localization: flutter_localizations + intl with ARB files in lib/l10n/ (app_ko.arb, app_ja.arb). Default locale chosen by device; fallback ko.

---

## 6. Non-negotiable product rules (from CLAUDE.md)

1. No list browsing. One candidate at a time, full screen.
2. Swipe right = like, left = pass.
3. Base quota 10/hour. Server enforces.
4. Mutual like unlocks chat. Not before.
5. Chat shows translated text AND preserves original text on-screen.
6. Block/report must prevent re-exposure (seen ledger + blocks list).
7. No secrets in source. No IAP bypass in production code paths.

---

## 7. Stubs flagged for later

- Translation API: currently string-prefix stub inside onMessageCreated.
- Play/App Store receipt verification: currently accept-any stub inside purchaseExtraQuota.
- FCM push notifications: token stored but no server-side push send in MVP (flag as TODO in message trigger).
- App Check enforcement: wire the check but allow debug tokens in emulator.
