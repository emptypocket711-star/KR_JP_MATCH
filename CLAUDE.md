# Project Memory - KRJP Match App

## Product
- Korea-Japan matchmaking app ("하나" / Hana).
- Not a generic global random chat app.
- Product shape: onboarding -> profile setup -> discovery -> direct 1:1 chat (like "이음" app model).
- Lounge (community feed) is a secondary surface for cross-culture conversation.
- Primary markets/languages: Korean and Japanese.
- Android-first. iOS later.

## Technical defaults
- Flutter for app client.
- Firebase for auth, Firestore, Storage, Cloud Functions, FCM.
- Discovery shows ALL registered users of the opposite nationality — no quota cap.
- Translation must preserve original text.
- Block/report must prevent re-exposure and future messaging.

## Architecture preferences
- Feature-first Flutter structure.
- Separate presentation / domain / data where practical.
- Keep UI strings localizable (existing keys in lib/l10n/*.arb).
- Prefer reviewable, small changes over wide rewrites.

## Core product rules
1. Discovery is a vertical list feed of candidate cards (one card per row, photo + name/age/city + KR/JP badge + bio preview + "대화하기" button).
2. Tapping a discovery card opens the profile detail screen — full-screen, one candidate at a time, with photo carousel and "대화 시작하기" CTA that opens chat directly.
3. Discovery shows ALL users of the opposite nationality — no quota. No server-side candidate capping.
4. "대화 시작하기" from a profile (or "대화하기" from the list) immediately opens a 1:1 chat without requiring a mutual like. Swipe-based like/pass gestures exist in code but are NOT the primary input; do not remove that code.
5. Mutual like / match flow may exist as an optional feature (e.g., for favorites), but must NOT gate chat access.
6. Chat translation: each bubble shows the original text by default; a "번역 보기" toggle reveals the translated text inline below the original. The original is never destroyed or hidden.
7. Safety is mandatory: report, block, and anti-re-exposure.

## Navigation shape
- Bottom nav has 5 tabs: 발견 / 라운지 / 매칭 / 채팅 / 프로필.
- 매칭 (matches) = list of mutual matches (people you can chat with).
- 채팅 (chat) = active conversations list (image 04 design).
- 설정 is reached from inside 프로필, not the bottom nav.

## Visual language (image-driven, 2026-04 rebuild)
- Warm cream background (#FFF8F5) — not pure white.
- Primary: salmon/coral (#E8826A). Gradient end: peach (#F5C6A0).
- Surface: warm peach (#FFF0EB). Text primary: warm charcoal (#2D2A26).
- Watercolor-style hero illustration on the login screen (서울N타워, 도쿄타워, 벚꽃, 한강다리, 하트 말풍선) — implemented in Flutter widgets when raster assets are unavailable.

## Lounge (community feed)
- Categories: 전체 / 일상 / 여행 / 언어교환 / 맛집 / 질문.
- Firestore: posts/{postId} with uid, authorName, authorPhotoUrl, authorNationality (KR|JP), category, content, imageUrls[], likeCount, commentCount, createdAt.
- Likes subcollection: post_likes/{postId}/likes/{uid}.
- FAB on lounge home opens post composer.

## Team workflow
- `krjp-master-planner` handles planning/delegation.
- Worker agents implement scoped changes.
- `qa-reviewer` validates flows after implementation.

## Guardrails
- Do not put secrets in source files.
- Do not bypass store billing for in-app digital goods.
- Do not weaken trust & safety for convenience.
- If schema changes are required, document them clearly.
