import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { Translate } from '@google-cloud/translate/build/src/v2';

admin.initializeApp(); // redeploy

const db = admin.firestore();
const auth = admin.auth();
const translate = new Translate();
const REPORT_BAN_THRESHOLD = 3;

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface UserProfileInput {
  displayName: string;
  birthYear: number;
  gender: 'male' | 'female';
  nationality: 'KR' | 'JP';
  residingCountry: 'KR' | 'JP' | 'OTHER';
  nativeLanguage: 'ko' | 'ja';
  learningLanguage: 'ko' | 'ja';
  bio: string;
  photoUrls: string[];
  relationshipType?: string;
  occupation?: string;
  keywords?: string[];
  qaItems?: Array<Record<string, string>>;
  preferredGender?: 'male' | 'female' | 'any' | 'all';
  preferredNationality?: 'KR' | 'JP' | 'any' | 'all';
  preferredAgeMin?: number;
  preferredAgeMax?: number;
}

interface PublicProfile {
  uid: string;
  displayName: string;
  birthYear: number;
  gender: 'male' | 'female';
  nationality: 'KR' | 'JP';
  residingCountry: 'KR' | 'JP' | 'OTHER';
  nativeLanguage: 'ko' | 'ja';
  learningLanguage: 'ko' | 'ja';
  bio: string;
  photoUrls: string[];
}

interface QuotaEventData {
  uid: string;
  eventType: 'grant' | 'consume';
  amount: number;
  reason: string;
  extraQuotaPurchased?: number;
  timestamp: admin.firestore.Timestamp;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Ensures the user is authenticated and not banned.
 * Throws HttpsError if auth is null or user is banned.
 */
async function requireAuthAndNotBanned(
  context: functions.https.CallableContext
): Promise<string> {
  // App Check 검증 — production에서 미등록 앱/에뮬 차단
  if (context.app == undefined) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'App Check verification failed'
    );
  }

  if (!context.auth?.uid) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'User must be authenticated'
    );
  }

  const userSnap = await db.collection('users').doc(context.auth.uid).get();
  if (!userSnap.exists) {
    throw new functions.https.HttpsError(
      'not-found',
      'User profile not found'
    );
  }

  const userData = userSnap.data();
  if (userData?.isBanned) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'User is banned'
    );
  }

  return context.auth.uid;
}

/**
 * Validates UserProfileInput fields.
 * Throws HttpsError if validation fails.
 */
function validateUserProfile(data: any): asserts data is UserProfileInput {
  const required = [
    'displayName',
    'birthYear',
    'gender',
    'nationality',
    'residingCountry',
    'nativeLanguage',
    'learningLanguage',
    'bio',
    'photoUrls',
  ];

  for (const field of required) {
    if (!(field in data)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `Missing required field: ${field}`
      );
    }
  }

  if (typeof data.displayName !== 'string' || data.displayName.trim().length === 0) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'displayName must be a non-empty string'
    );
  }

  if (typeof data.birthYear !== 'number' || data.birthYear < 1900 || data.birthYear > new Date().getFullYear()) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'birthYear must be a valid year'
    );
  }

  if (!['male', 'female'].includes(data.gender)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'gender must be male or female'
    );
  }

  if (!['KR', 'JP'].includes(data.nationality)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'nationality must be KR or JP'
    );
  }

  if (!['KR', 'JP', 'OTHER'].includes(data.residingCountry)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'residingCountry must be KR, JP, or OTHER'
    );
  }

  if (!['ko', 'ja'].includes(data.nativeLanguage)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'nativeLanguage must be ko or ja'
    );
  }

  if (!['ko', 'ja'].includes(data.learningLanguage)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'learningLanguage must be ko or ja'
    );
  }

  if (data.nativeLanguage === data.learningLanguage) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'nativeLanguage and learningLanguage must be different'
    );
  }

  if (typeof data.bio !== 'string' || data.bio.length > 500) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'bio must be a string <= 500 chars'
    );
  }

  if (!Array.isArray(data.photoUrls) || data.photoUrls.length === 0 || data.photoUrls.length > 6) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'photoUrls must be an array with 1-6 items'
    );
  }

  if (!data.photoUrls.every((url: any) => typeof url === 'string')) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'all photoUrls must be strings'
    );
  }
}

/**
 * Detect language from text using simple heuristics.
 * Hangul (Korean) ranges: AC00-D7AF
 * Hiragana/Katakana (Japanese): 3040-309F, 30A0-30FF
 * Kanji ranges: 4E00-9FFF
 */
function detectLanguage(text: string): 'ko' | 'ja' | 'unknown' {
  let hasHangul = false;
  let hasJapanese = false;

  for (const char of text) {
    const code = char.charCodeAt(0);
    // Check for Hangul
    if (code >= 0xac00 && code <= 0xd7af) {
      hasHangul = true;
    }
    // Check for Hiragana, Katakana, or Kanji
    if (
      (code >= 0x3040 && code <= 0x309f) ||
      (code >= 0x30a0 && code <= 0x30ff) ||
      (code >= 0x4e00 && code <= 0x9fff)
    ) {
      hasJapanese = true;
    }
  }

  if (hasHangul && !hasJapanese) return 'ko';
  if (hasJapanese && !hasHangul) return 'ja';
  return 'unknown';
}

/**
 * Translate text using Google Cloud Translation API v2.
 * Falls back to the original text if translation fails.
 */
async function callGoogleTranslate(text: string, targetLang: 'ko' | 'ja'): Promise<string> {
  try {
    const [translation] = await translate.translate(text, targetLang);
    return translation;
  } catch (err) {
    console.error(`Translation failed for lang=${targetLang}:`, err);
    return text;
  }
}

/**
 * Find an active match between two users.
 */
async function findMatch(uidA: string, uidB: string): Promise<string | null> {
  const matchId = [uidA, uidB].sort().join('_');
  const matchSnap = await db.collection('matches').doc(matchId).get();

  if (matchSnap.exists && matchSnap.data()?.isActive) {
    return matchId;
  }

  return null;
}

function firstPhoto(profile: FirebaseFirestore.DocumentData): string {
  return Array.isArray(profile.photoUrls) && profile.photoUrls.length > 0
    ? profile.photoUrls[0]
    : '';
}

async function notifyChatRemoved(recipientUid: string, matchId: string): Promise<void> {
  const notificationRef = db
    .collection('users')
    .doc(recipientUid)
    .collection('notifications')
    .doc();

  await notificationRef.set({
    type: 'chat_removed',
    matchId,
    title: '대화방이 종료되었습니다',
    body: '상대방의 요청으로 1:1 대화방이 종료되었습니다.',
    read: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const recipientSnap = await db.collection('users').doc(recipientUid).get();
  const recipientData = recipientSnap.data();
  const fcmToken: string | null = recipientData?.fcmToken ?? null;
  const notificationsEnabled: boolean =
    recipientData?.notificationsEnabled ?? true;

  if (!fcmToken || !notificationsEnabled) return;

  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: {
        title: '대화방이 종료되었습니다',
        body: '상대방의 요청으로 1:1 대화방이 종료되었습니다.',
      },
      data: {
        type: 'chat_removed',
        matchId,
      },
      android: {
        priority: 'high',
        notification: { channelId: 'chat_messages' },
      },
    });
  } catch (err) {
    console.warn(`Failed to notify chat removal for ${recipientUid}:`, err);
  }
}

// ============================================================================
// CALLABLE FUNCTIONS
// ============================================================================

/**
 * completeOnboarding(data: UserProfileInput) -> { ok: true }
 *
 * Validates and writes the user profile. Initializes quota and server-controlled fields.
 */
export const completeOnboarding = functions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    // TODO: Check App Check token (stub for now)
    // const appCheckToken = context.app?.alreadyInitialized;

    if (!context.auth?.uid) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'User must be authenticated'
      );
    }
    const uid = context.auth.uid;

    const existingSnap = await db.collection('users').doc(uid).get();
    if (existingSnap.data()?.isBanned) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'User is banned'
      );
    }

    // Validate input
    validateUserProfile(data);
    const preferredGender =
      data.preferredGender === 'all' ? 'any' : data.preferredGender || 'any';
    const preferredNationality =
      data.preferredNationality === 'all'
        ? 'any'
        : data.preferredNationality || 'any';

    // Initialize quota reset time
    const now = admin.firestore.Timestamp.now();
    const quotaResetAt = new admin.firestore.Timestamp(
      now.seconds + 3600, // 1 hour from now
      now.nanoseconds
    );

    // Write user profile with server-controlled fields
    await db.collection('users').doc(uid).set(
      {
        uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        onboardingCompleted: true,
        displayName: data.displayName,
        birthYear: data.birthYear,
        gender: data.gender,
        nationality: data.nationality,
        residingCountry: data.residingCountry,
        nativeLanguage: data.nativeLanguage,
        learningLanguage: data.learningLanguage,
        bio: data.bio,
        relationshipType: data.relationshipType || '',
        occupation: data.occupation || '',
        keywords: Array.isArray(data.keywords) ? data.keywords : [],
        qaItems: Array.isArray(data.qaItems) ? data.qaItems : [],
        photoUrls: data.photoUrls,
        preferredGender,
        preferredNationality,
        preferredAgeMin: data.preferredAgeMin || 20,
        preferredAgeMax: data.preferredAgeMax || 50,
        quotaRemaining: 10,
        quotaResetAt,
        extraQuotaPurchased: 0,
        keyCount: 3,
        dailyKeyLimit: 3,
        reportCount: 0,
        uniqueReporterCount: 0,
        lastReportedAt: null,
        bannedAt: null,
        isBanned: false,
        fcmToken: null,
      },
      { merge: false }
    );

    return { ok: true };
  }
);

/**
 * purchaseExtraQuota(data: { receipt: string, platform: 'android' | 'ios' })
 * -> { ok: true, extraQuotaGranted: number }
 *
 * MVP stub: Accept any non-empty receipt, grant +10 to extraQuotaPurchased.
 * TODO: Verify receipt against Play Store / App Store.
 */
export const purchaseExtraQuota = functions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);

    // Validate input
    if (typeof data.receipt !== 'string' || data.receipt.trim().length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'receipt must be a non-empty string'
      );
    }

    if (!['android', 'ios'].includes(data.platform)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'platform must be android or ios'
      );
    }

    // TODO: Verify receipt against Play Store / App Store
    // For MVP, we accept any non-empty receipt.

    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      throw new functions.https.HttpsError(
        'not-found',
        'User profile not found'
      );
    }

    const currentExtraQuota = userSnap.data()?.extraQuotaPurchased || 0;
    const newExtraQuota = currentExtraQuota + 10;

    // Atomically update extraQuotaPurchased
    await userRef.update({
      extraQuotaPurchased: newExtraQuota,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Log the purchase event
    const eventId = db.collection('quotaEvents').doc().id;
    const quotaEvent: QuotaEventData = {
      uid,
      eventType: 'grant',
      amount: 10,
      reason: `IAP purchase (${data.platform})`,
      extraQuotaPurchased: newExtraQuota,
      timestamp: admin.firestore.Timestamp.now(),
    };

    await db.collection('quotaEvents').doc(eventId).set(quotaEvent);

    return { ok: true, extraQuotaGranted: 10 };
  }
);

/**
 * requestCandidates(data: { limit?: number })
 * -> { candidates: PublicProfile[], quotaRemaining: number, quotaResetAt: Timestamp }
 *
 * Server-authoritative candidate selection with quota enforcement.
 * Rules:
 * - Reset quota if now >= quotaResetAt
 * - Exclude self, blocks, seen, banned, those who blocked caller
 * - Apply preference filters
 * - Return up to min(limit, quotaRemaining) candidates
 * - Write seen entries for delivered candidates
 * - Decrement quota atomically
 */
export const requestCandidates = functions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);

    const limit = Math.min(data.limit || 1, 5); // Max 5 per request

    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      throw new functions.https.HttpsError(
        'not-found',
        'User profile not found'
      );
    }

    const userData = userSnap.data()!;
    let quotaRemaining =
      typeof userData.quotaRemaining === 'number' ? userData.quotaRemaining : 10;
    let quotaResetAt = userData.quotaResetAt as admin.firestore.Timestamp | undefined;

    // Reset quota if needed
    const now = admin.firestore.Timestamp.now();
    if (!quotaResetAt || now.toMillis() >= quotaResetAt.toMillis()) {
      quotaRemaining = 10;
      quotaResetAt = new admin.firestore.Timestamp(
        now.seconds + 3600,
        now.nanoseconds
      );
    }
    const effectiveLimit = Math.min(limit, quotaRemaining);

    if (effectiveLimit <= 0) {
      await userRef.update({
        quotaRemaining,
        quotaResetAt,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { candidates: [], quotaRemaining, quotaResetAt };
    }

    // Get exclusion sets
    const [blocksSnap, seenSnap] = await Promise.all([
      db.collection('users').doc(uid).collection('blocks').get(),
      db.collection('users').doc(uid).collection('seen').get(),
    ]);

    const blockedSet = new Set(blocksSnap.docs.map(d => d.id));
    const seenSet = new Set(seenSnap.docs.map(d => d.id));

    // Get users who blocked this user
    const blockersSnap = await db
      .collectionGroup('blocks')
      .where('__name__', '==', uid) // Match targetUid in path
      .get();

    const blockerSet = new Set<string>();
    for (const doc of blockersSnap.docs) {
      const path = doc.ref.path;
      const parts = path.split('/');
      if (parts[1]) {
        blockerSet.add(parts[1]); // Extract uid from path
      }
    }

    // Query candidates with preference filters
    let query: FirebaseFirestore.Query = db.collection('users');

    // Gender filter
    const preferredGender =
      userData.preferredGender === 'all' ? 'any' : userData.preferredGender || 'any';
    const preferredNationality =
      userData.preferredNationality === 'all'
        ? 'any'
        : userData.preferredNationality || 'any';

    if (preferredGender !== 'any') {
      query = query.where('gender', '==', preferredGender);
    }

    // Nationality filter
    if (preferredNationality !== 'any') {
      query = query.where('nationality', '==', preferredNationality);
    }

    // Age range filters
    const minYear = new Date().getFullYear() - (userData.preferredAgeMax || 50);
    const maxYear = new Date().getFullYear() - (userData.preferredAgeMin || 20);

    query = query
      .where('birthYear', '>=', minYear)
      .where('birthYear', '<=', maxYear)
      .where('isBanned', '==', false)
      .where('onboardingCompleted', '==', true);

    const candidateSnaps = await query.get();

    // Filter in-memory: exclude self, blocked, seen, blockers
    const candidates: PublicProfile[] = [];

    for (const snap of candidateSnaps.docs) {
      const candidateUid = snap.id;

      if (
        candidateUid === uid ||
        blockedSet.has(candidateUid) ||
        seenSet.has(candidateUid) ||
        blockerSet.has(candidateUid)
      ) {
        continue;
      }

      const candidateData = snap.data();

      candidates.push({
        uid: candidateUid,
        displayName: candidateData.displayName,
        birthYear: candidateData.birthYear,
        gender: candidateData.gender,
        nationality: candidateData.nationality,
        residingCountry: candidateData.residingCountry,
        nativeLanguage: candidateData.nativeLanguage,
        learningLanguage: candidateData.learningLanguage,
        bio: candidateData.bio,
        photoUrls: candidateData.photoUrls,
      });

      if (candidates.length >= effectiveLimit) {
        break;
      }
    }

    // Write seen entries for delivered candidates and decrement quota
    const batch = db.batch();
    const totalConsumed = candidates.length;
    const newQuotaRemaining = Math.max(0, quotaRemaining - totalConsumed);

    for (const candidate of candidates) {
      const seenRef = db
        .collection('users')
        .doc(uid)
        .collection('seen')
        .doc(candidate.uid);

      batch.set(seenRef, {
        seenAt: admin.firestore.FieldValue.serverTimestamp(),
        reason: 'delivered',
      });
    }

    // Update quota
    batch.update(userRef, {
      quotaRemaining: newQuotaRemaining,
      quotaResetAt,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await batch.commit();

    return {
      candidates,
      quotaRemaining: newQuotaRemaining,
      quotaResetAt,
    };
  }
);

/**
 * likeUser(data: { targetUid: string })
 * -> { matched: boolean, matchId: string or null }
 *
 * Transactional like handling with automatic match creation.
 */
export const likeUser = functions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);

    const targetUid = data.targetUid;

    if (typeof targetUid !== 'string' || targetUid.length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'targetUid must be a non-empty string'
      );
    }

    if (uid === targetUid) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Cannot like yourself'
      );
    }

    // Check if target is blocked
    const targetBlockedSnap = await db
      .collection('users')
      .doc(uid)
      .collection('blocks')
      .doc(targetUid)
      .get();

    if (targetBlockedSnap.exists) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Cannot like a blocked user'
      );
    }

    // Check if target blocked caller
    const callerBlockedSnap = await db
      .collection('users')
      .doc(targetUid)
      .collection('blocks')
      .doc(uid)
      .get();

    if (callerBlockedSnap.exists) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Target user has blocked you'
      );
    }

    const likeIdForward = `${uid}_${targetUid}`;
    const likeIdReverse = `${targetUid}_${uid}`;

    return db.runTransaction(async (transaction) => {
      // Check for reverse like
      const reverseLikeSnap = await transaction.get(
        db.collection('likes').doc(likeIdReverse)
      );

      const now = admin.firestore.Timestamp.now();
      const matchId = [uid, targetUid].sort().join('_');

      if (reverseLikeSnap.exists && reverseLikeSnap.data()?.status === 'pending') {
        // Mutual like! Create match
        const matchRef = db.collection('matches').doc(matchId);
        const [mySnap, targetSnap] = await Promise.all([
          transaction.get(db.collection('users').doc(uid)),
          transaction.get(db.collection('users').doc(targetUid)),
        ]);
        const myData = mySnap.data() || {};
        const targetData = targetSnap.data() || {};
        const firstPhoto = (profile: FirebaseFirestore.DocumentData) =>
          Array.isArray(profile.photoUrls) && profile.photoUrls.length > 0
            ? profile.photoUrls[0]
            : '';

        transaction.set(matchRef, {
          matchId,
          userIds: [uid, targetUid].sort(),
          createdAt: now,
          lastMessageAt: null,
          lastMessagePreview: null,
          unread: { [uid]: 0, [targetUid]: 0 },
          isActive: true,
          partnerFor: {
            [uid]: {
              displayName: targetData.displayName || '',
              photoUrl: firstPhoto(targetData),
              nationality: targetData.nationality || 'JP',
              gender: targetData.gender || 'female',
            },
            [targetUid]: {
              displayName: myData.displayName || '',
              photoUrl: firstPhoto(myData),
              nationality: myData.nationality || 'KR',
              gender: myData.gender || 'female',
            },
          },
          updatedAt: now,
        }, { merge: true });

        // Update both like docs
        transaction.set(db.collection('likes').doc(likeIdForward), {
          fromUid: uid,
          toUid: targetUid,
          createdAt: now,
          status: 'matched',
          matchId,
          updatedAt: now,
        }, { merge: true });

        transaction.update(db.collection('likes').doc(likeIdReverse), {
          status: 'matched',
          matchId,
          updatedAt: now,
        });

        // Write seen entries
        transaction.set(
          db.collection('users').doc(uid).collection('seen').doc(targetUid),
          {
            seenAt: now,
            reason: 'match',
          }
        );

        transaction.set(
          db.collection('users').doc(targetUid).collection('seen').doc(uid),
          {
            seenAt: now,
            reason: 'match',
          }
        );

        return { matched: true, matchId };
      } else {
        // Create pending like
        transaction.set(db.collection('likes').doc(likeIdForward), {
          fromUid: uid,
          toUid: targetUid,
          createdAt: now,
          status: 'pending',
          matchId: null,
        });

        // Write seen entry
        transaction.set(
          db.collection('users').doc(uid).collection('seen').doc(targetUid),
          {
            seenAt: now,
            reason: 'like',
          }
        );

        return { matched: false, matchId: null };
      }
    });
  }
);

/**
 * passUser(data: { targetUid: string }) -> { ok: true }
 *
 * Record a pass without any other state changes.
 */
export const passUser = functions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);

    const targetUid = data.targetUid;

    if (typeof targetUid !== 'string' || targetUid.length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'targetUid must be a non-empty string'
      );
    }

    await db
      .collection('users')
      .doc(uid)
      .collection('seen')
      .doc(targetUid)
      .set({
        seenAt: admin.firestore.FieldValue.serverTimestamp(),
        reason: 'pass',
      });

    return { ok: true };
  }
);

/**
 * sendMessage(data: { matchId: string, originalText: string }) -> { messageId: string }
 *
 * Send a message in a match with verification and mutation of summary fields.
 */
export const sendMessage = functions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);

    const matchId = data.matchId;
    const originalText = data.originalText;

    if (typeof matchId !== 'string' || matchId.length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'matchId must be a non-empty string'
      );
    }

    if (typeof originalText !== 'string' || originalText.trim().length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'originalText must be a non-empty string'
      );
    }

    const matchRef = db.collection('matches').doc(matchId);
    const matchSnap = await matchRef.get();

    if (!matchSnap.exists) {
      throw new functions.https.HttpsError(
        'not-found',
        'Match not found'
      );
    }

    const matchData = matchSnap.data()!;

    // Verify caller is in the match
    if (!matchData.userIds.includes(uid)) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'User not in this match'
      );
    }

    // Verify match is active
    if (!matchData.isActive) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Match is not active'
      );
    }

    // Get the other user's uid
    const otherUid = matchData.userIds.find((id: string) => id !== uid);

    // Verify neither side has blocked the other
    const [blockCheckA, blockCheckB] = await Promise.all([
      db.collection('users').doc(uid).collection('blocks').doc(otherUid).get(),
      db.collection('users').doc(otherUid).collection('blocks').doc(uid).get(),
    ]);

    if (blockCheckA.exists || blockCheckB.exists) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'One or both users have blocked each other'
      );
    }

    // Create message document
    const messageId = db.collection('matches').doc(matchId).collection('messages').doc().id;
    const now = admin.firestore.Timestamp.now();

    const batch = db.batch();

    const messageRef = db
      .collection('matches')
      .doc(matchId)
      .collection('messages')
      .doc(messageId);

    batch.set(messageRef, {
      messageId,
      senderId: uid,
      createdAt: now,
      originalText,
      originalLang: 'unknown', // Will be detected by onMessageCreated trigger
      translations: { ko: null, ja: null },
      translationStatus: 'pending',
      deletedForSender: false,
    });

    // Update match summary
    const truncatedPreview = originalText.length > 50
      ? originalText.substring(0, 50) + '...'
      : originalText;

    batch.update(matchRef, {
      lastMessageAt: now,
      lastMessagePreview: truncatedPreview,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await batch.commit();

    return { messageId };
  }
);

/**
 * leaveChat(data: { matchId: string }) -> { ok: true }
 *
 * Close an active chat for both users and notify the other user.
 */
export const leaveChat = functions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);
    const matchId = data.matchId;

    if (typeof matchId !== 'string' || matchId.length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'matchId must be a non-empty string'
      );
    }

    const matchRef = db.collection('matches').doc(matchId);
    const matchSnap = await matchRef.get();

    if (!matchSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Match not found');
    }

    const matchData = matchSnap.data()!;
    if (!matchData.userIds.includes(uid)) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'User not in this match'
      );
    }

    const otherUid: string = (matchData.userIds as string[]).find(
      (id) => id !== uid
    ) ?? '';

    await matchRef.update({
      isActive: false,
      closedBy: uid,
      closedReason: 'left_chat',
      closedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (otherUid) {
      await notifyChatRemoved(otherUid, matchId);
    }

    return { ok: true };
  }
);

/**
 * setChatFavorite(data: { matchId: string, favorite: boolean }) -> { ok: true }
 */
export const setChatFavorite = functions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);
    const matchId = data.matchId;
    const favorite = data.favorite === true;

    if (typeof matchId !== 'string' || matchId.length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'matchId must be a non-empty string'
      );
    }

    const matchRef = db.collection('matches').doc(matchId);
    const matchSnap = await matchRef.get();

    if (!matchSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Match not found');
    }

    const matchData = matchSnap.data()!;
    if (!matchData.userIds.includes(uid)) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'User not in this match'
      );
    }

    await matchRef.update({
      [`favoriteFor.${uid}`]: favorite,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { ok: true };
  }
);

/**
 * addPostComment(data: { postId: string, content: string }) -> { commentId: string }
 */
export const addPostComment = functions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);
    const postId = data.postId;
    const content = typeof data.content === 'string' ? data.content.trim() : '';

    if (typeof postId !== 'string' || postId.length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'postId must be a non-empty string'
      );
    }

    if (content.length === 0 || content.length > 500) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'content must be 1-500 characters'
      );
    }

    const [postSnap, userSnap] = await Promise.all([
      db.collection('posts').doc(postId).get(),
      db.collection('users').doc(uid).get(),
    ]);

    if (!postSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Post not found');
    }

    const userData = userSnap.data() || {};
    const commentRef = db
      .collection('posts')
      .doc(postId)
      .collection('comments')
      .doc();

    const batch = db.batch();
    batch.set(commentRef, {
      commentId: commentRef.id,
      uid,
      authorName: userData.displayName || '',
      authorPhotoUrl: firstPhoto(userData),
      authorNationality: userData.nationality || 'KR',
      authorGender: userData.gender || 'female',
      content,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      deleted: false,
    });
    batch.update(db.collection('posts').doc(postId), {
      commentCount: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await batch.commit();

    return { commentId: commentRef.id };
  }
);

/**
 * addPostReply(data: { postId: string, commentId: string, content: string })
 * -> { replyId: string }
 */
export const addPostReply = functions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);
    const postId = data.postId;
    const commentId = data.commentId;
    const content = typeof data.content === 'string' ? data.content.trim() : '';

    if (typeof postId !== 'string' || postId.length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'postId must be a non-empty string'
      );
    }

    if (typeof commentId !== 'string' || commentId.length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'commentId must be a non-empty string'
      );
    }

    if (content.length === 0 || content.length > 500) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'content must be 1-500 characters'
      );
    }

    const postRef = db.collection('posts').doc(postId);
    const commentRef = postRef.collection('comments').doc(commentId);
    const [postSnap, commentSnap, userSnap] = await Promise.all([
      postRef.get(),
      commentRef.get(),
      db.collection('users').doc(uid).get(),
    ]);

    if (!postSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Post not found');
    }

    if (!commentSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Comment not found');
    }

    const userData = userSnap.data() || {};
    const replyRef = commentRef.collection('replies').doc();

    const batch = db.batch();
    batch.set(replyRef, {
      replyId: replyRef.id,
      uid,
      authorName: userData.displayName || '',
      authorPhotoUrl: firstPhoto(userData),
      authorNationality: userData.nationality || 'KR',
      authorGender: userData.gender || 'female',
      content,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      deleted: false,
    });
    batch.update(commentRef, {
      replyCount: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    batch.update(postRef, {
      commentCount: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await batch.commit();

    return { replyId: replyRef.id };
  }
);

/**
 * deleteAccount() -> { ok: true }
 *
 * Permanently deletes the caller's account:
 *   1. Deletes Firestore subcollections (blocks, seen)
 *   2. Deletes likes sent/received
 *   3. Deactivates active matches (chat history preserved)
 *   4. Deletes Storage photos under users/{uid}/
 *   5. Deletes Firestore user doc
 *   6. Deletes Firebase Auth user
 */
export const deleteAccount = functions.https.onCall(
  async (_data: any, context: functions.https.CallableContext) => {
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'User must be authenticated'
      );
    }
    const uid = context.auth.uid;

    // Helper: delete all docs in a collection path in batches
    const deleteCollection = async (collPath: string) => {
      let snap = await db.collection(collPath).limit(400).get();
      while (!snap.empty) {
        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        snap = await db.collection(collPath).limit(400).get();
      }
    };

    // 1. Delete subcollections
    await Promise.all([
      deleteCollection(`users/${uid}/blocks`),
      deleteCollection(`users/${uid}/seen`),
    ]);

    // 2. Delete likes sent and received
    const [sentSnap, receivedSnap] = await Promise.all([
      db.collection('likes').where('fromUid', '==', uid).get(),
      db.collection('likes').where('toUid', '==', uid).get(),
    ]);
    const allLikeDocs = [...sentSnap.docs, ...receivedSnap.docs];
    if (allLikeDocs.length > 0) {
      const likeBatch = db.batch();
      allLikeDocs.forEach((d) => likeBatch.delete(d.ref));
      await likeBatch.commit();
    }

    // 3. Deactivate active matches (preserve chat history)
    const matchesSnap = await db
      .collection('matches')
      .where('userIds', 'array-contains', uid)
      .where('isActive', '==', true)
      .get();
    if (!matchesSnap.empty) {
      const matchBatch = db.batch();
      matchesSnap.docs.forEach((d) =>
        matchBatch.update(d.ref, {
          isActive: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        })
      );
      await matchBatch.commit();
    }

    // 4. Delete Storage files under users/{uid}/
    try {
      const bucket = admin.storage().bucket();
      const [files] = await bucket.getFiles({ prefix: `users/${uid}/` });
      await Promise.allSettled(files.map((f) => f.delete()));
    } catch (err) {
      console.warn(`Storage cleanup for ${uid} failed (non-fatal):`, err);
    }

    // 5. Delete Firestore user doc
    await db.collection('users').doc(uid).delete();

    // 6. Delete Firebase Auth user
    await auth.deleteUser(uid);

    return { ok: true };
  }
);

/**
 * blockUser(data: { targetUid: string, reason?: string }) -> { ok: true }
 *
 * Block a user and deactivate any active match.
 */
export const blockUser = functions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);

    const targetUid = data.targetUid;
    const reason = data.reason || null;

    if (typeof targetUid !== 'string' || targetUid.length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'targetUid must be a non-empty string'
      );
    }

    if (uid === targetUid) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Cannot block yourself'
      );
    }

    const targetSnap = await db.collection('users').doc(targetUid).get();
    if (!targetSnap.exists) {
      throw new functions.https.HttpsError(
        'not-found',
        'Target user profile not found'
      );
    }
    const targetData = targetSnap.data() || {};
    const batch = db.batch();
    const now = admin.firestore.Timestamp.now();

    // Write block entry
    const blockRef = db
      .collection('users')
      .doc(uid)
      .collection('blocks')
      .doc(targetUid);

    batch.set(blockRef, {
      blockedAt: now,
      reason,
      targetUid,
      displayName: targetData.displayName || '',
      photoUrl: firstPhoto(targetData),
      nationality: targetData.nationality || 'JP',
      gender: targetData.gender || 'female',
    });

    // Write seen entry
    const seenRef = db
      .collection('users')
      .doc(uid)
      .collection('seen')
      .doc(targetUid);

    batch.set(seenRef, {
      seenAt: now,
      reason: 'block',
    });

    // Find and deactivate active match
    const matchId = [uid, targetUid].sort().join('_');
    const matchRef = db.collection('matches').doc(matchId);
    const matchSnap = await matchRef.get();

    if (matchSnap.exists && matchSnap.data()?.isActive) {
      batch.update(matchRef, {
        isActive: false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();
    if (matchSnap.exists && matchSnap.data()?.isActive) {
      await notifyChatRemoved(targetUid, matchId);
    }

    return { ok: true };
  }
);

/**
 * unblockUser(data: { targetUid: string }) -> { ok: true }
 *
 * Remove a user from the caller's block list. Existing matches are not restored.
 */
export const unblockUser = functions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);
    const targetUid = data.targetUid;

    if (typeof targetUid !== 'string' || targetUid.length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'targetUid must be a non-empty string'
      );
    }

    await db
      .collection('users')
      .doc(uid)
      .collection('blocks')
      .doc(targetUid)
      .delete();

    return { ok: true };
  }
);

/**
 * reportUser(data: { targetUid: string, reason: string, note?: string, matchId?: string })
 * -> { reportId: string }
 *
 * Report a user and auto-block them.
 */
export const reportUser = functions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);

    const targetUid = data.targetUid;
    const reason = data.reason;
    const note = data.note || '';
    const matchId = data.matchId || null;

    if (typeof targetUid !== 'string' || targetUid.length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'targetUid must be a non-empty string'
      );
    }

    if (uid === targetUid) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Cannot report yourself'
      );
    }

    if (typeof reason !== 'string' || !['spam', 'harassment', 'inappropriate_photo', 'fake_profile', 'other'].includes(reason)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'reason must be one of: spam, harassment, inappropriate_photo, fake_profile, other'
      );
    }

    if (typeof note !== 'string' || note.length > 1000) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'note must be a string <= 1000 chars'
      );
    }

    const reportId = db.collection('reports').doc().id;
    const now = admin.firestore.Timestamp.now();
    const reportRef = db.collection('reports').doc(reportId);
    const blockRef = db
      .collection('users')
      .doc(uid)
      .collection('blocks')
      .doc(targetUid);
    const seenRef = db
      .collection('users')
      .doc(uid)
      .collection('seen')
      .doc(targetUid);
    const targetRef = db.collection('users').doc(targetUid);
    const reporterRef = db
      .collection('reportCounters')
      .doc(targetUid)
      .collection('reporters')
      .doc(uid);

    const result = await db.runTransaction(async (transaction) => {
      const [targetSnap, reporterSnap] = await Promise.all([
        transaction.get(targetRef),
        transaction.get(reporterRef),
      ]);

      if (!targetSnap.exists) {
        throw new functions.https.HttpsError(
          'not-found',
          'Target user profile not found'
        );
      }

      const targetData = targetSnap.data() || {};
      const currentReportCount =
        typeof targetData.reportCount === 'number'
          ? targetData.reportCount
          : 0;
      const currentUniqueReporterCount =
        typeof targetData.uniqueReporterCount === 'number'
          ? targetData.uniqueReporterCount
          : 0;
      const shouldCountReporter = !reporterSnap.exists;
      const reportCount = currentReportCount + 1;
      const uniqueReporterCount =
        currentUniqueReporterCount + (shouldCountReporter ? 1 : 0);
      const shouldBan =
        !targetData.isBanned && uniqueReporterCount >= REPORT_BAN_THRESHOLD;

      transaction.set(reportRef, {
        reportId,
        reporterUid: uid,
        targetUid,
        reason,
        note,
        matchId,
        createdAt: now,
        status: shouldBan ? 'auto_banned' : 'open',
        counted: shouldCountReporter,
      });

      transaction.set(blockRef, {
        blockedAt: now,
        reason: `report: ${reason}`,
        reportId,
        targetUid,
        displayName: targetData.displayName || '',
        photoUrl: firstPhoto(targetData),
        nationality: targetData.nationality || 'JP',
        gender: targetData.gender || 'female',
      });

      transaction.set(seenRef, {
        seenAt: now,
        reason: 'report',
      });

      transaction.set(
        reporterRef,
        {
          reporterUid: uid,
          firstReportedAt: reporterSnap.data()?.firstReportedAt || now,
          lastReportedAt: now,
          latestReportId: reportId,
        },
        { merge: true }
      );

      transaction.update(targetRef, {
        reportCount,
        uniqueReporterCount,
        lastReportedAt: now,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(shouldBan
          ? {
              isBanned: true,
              bannedAt: now,
              banReason: 'report_threshold',
            }
          : {}),
      });

      return { shouldBan, reportCount, uniqueReporterCount };
    });

    // Deactivate match if exists
    const autoMatchId = [uid, targetUid].sort().join('_');
    const matchRef = db.collection('matches').doc(autoMatchId);
    const matchSnap = await matchRef.get();

    if (matchSnap.exists && matchSnap.data()?.isActive) {
      await matchRef.update({
        isActive: false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      await notifyChatRemoved(targetUid, autoMatchId);
    }

    if (result.shouldBan) {
      const matchesSnap = await db
        .collection('matches')
        .where('userIds', 'array-contains', targetUid)
        .where('isActive', '==', true)
        .get();

      if (!matchesSnap.empty) {
        const deactivateBatch = db.batch();
        matchesSnap.docs.forEach((d) =>
          deactivateBatch.update(d.ref, {
            isActive: false,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          })
        );
        await deactivateBatch.commit();
      }
    }

    return {
      reportId,
      blocked: true,
      targetBanned: result.shouldBan,
      reportCount: result.reportCount,
      uniqueReporterCount: result.uniqueReporterCount,
      banThreshold: REPORT_BAN_THRESHOLD,
    };
  }
);

// ============================================================================
// FIRESTORE TRIGGERS
// ============================================================================

/**
 * Trigger: onMessageCreated
 *
 * Detects language, translates, and updates message doc.
 * TODO: Replace stub translation with real API (Google Translate, DeepL, etc.)
 * TODO: Add FCM push notification sending
 */
export const onMessageCreated = functions.firestore
  .document('matches/{matchId}/messages/{messageId}')
  .onCreate(async (snap, context) => {
    const messageData = snap.data();
    const { matchId } = context.params;

    try {
      // Detect original language
      const originalLang = detectLanguage(messageData.originalText);

      // Translate to both languages (skip if already in target lang)
      const [koTranslation, jaTranslation] = await Promise.all([
        originalLang === 'ko'
          ? Promise.resolve(messageData.originalText)
          : callGoogleTranslate(messageData.originalText, 'ko'),
        originalLang === 'ja'
          ? Promise.resolve(messageData.originalText)
          : callGoogleTranslate(messageData.originalText, 'ja'),
      ]);

      // Update message with translations
      await snap.ref.update({
        originalLang,
        translations: {
          ko: koTranslation,
          ja: jaTranslation,
        },
        translationStatus: 'done',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // FCM push notification to recipient
      const senderUid: string = messageData.senderId;
      const matchSnap = await db.collection('matches').doc(matchId).get();
      if (matchSnap.exists) {
        const matchData = matchSnap.data()!;
        const recipientUid: string = (matchData.userIds as string[]).find(
          (id) => id !== senderUid
        ) ?? '';

        if (recipientUid) {
          // Increment unread for recipient
          await db.collection('matches').doc(matchId).update({
            [`unread.${recipientUid}`]: admin.firestore.FieldValue.increment(1),
          });

          // Load recipient profile for FCM token + settings
          const recipientSnap = await db
            .collection('users')
            .doc(recipientUid)
            .get();
          const recipientData = recipientSnap.data();
          const fcmToken: string | null = recipientData?.fcmToken ?? null;
          const notificationsEnabled: boolean =
            recipientData?.notificationsEnabled ?? true;
          const nightQuietEnabled: boolean =
            recipientData?.nightQuietEnabled ?? false;

          if (fcmToken && notificationsEnabled) {
            // Check night quiet hours in KST (UTC+9)
            const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
            const hourKst = nowKst.getUTCHours();
            const isNightQuiet =
              nightQuietEnabled && (hourKst >= 22 || hourKst < 8);

            if (!isNightQuiet) {
              // Load sender display name
              const senderSnap = await db
                .collection('users')
                .doc(senderUid)
                .get();
              const senderName: string =
                senderSnap.data()?.displayName ?? '하나';
              const preview =
                messageData.originalText.length > 60
                  ? messageData.originalText.substring(0, 60) + '…'
                  : messageData.originalText;

              await admin.messaging().send({
                token: fcmToken,
                notification: {
                  title: senderName,
                  body: preview,
                },
                data: {
                  matchId,
                  type: 'chat_message',
                },
                android: {
                  priority: 'high',
                  notification: { channelId: 'chat_messages' },
                },
              });
            }
          }
        }
      }
    } catch (error) {
      console.error('onMessageCreated error:', error);
      // Mark translation as failed
      try {
        await snap.ref.update({
          translationStatus: 'failed',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (updateError) {
        console.error('Failed to update translationStatus:', updateError);
      }
    }
  });

/**
 * Trigger: onPostCreated
 *
 * Translates lounge post content into both Korean and Japanese.
 * Stores translatedKo / translatedJa on the post document.
 */
export const onPostCreated = functions.firestore
  .document('posts/{postId}')
  .onCreate(async (snap) => {
    const data = snap.data();
    const content = data.content as string | undefined;
    if (!content || content.trim().length === 0) return;

    try {
      const detectedLang = detectLanguage(content);
      const originalLang: 'ko' | 'ja' = detectedLang === 'ja' ? 'ja' : 'ko';

      const [translatedKo, translatedJa] = await Promise.all([
        originalLang === 'ko'
          ? Promise.resolve(content)
          : callGoogleTranslate(content, 'ko'),
        originalLang === 'ja'
          ? Promise.resolve(content)
          : callGoogleTranslate(content, 'ja'),
      ]);

      await snap.ref.update({ translatedKo, translatedJa, originalLang });
    } catch (error) {
      console.error('onPostCreated translation error:', error);
    }
  });

/**
 * Trigger: onUserBlocked
 *
 * When a user is blocked, deactivate any active match between them.
 */
export const onUserBlocked = functions.firestore
  .document('users/{uid}/blocks/{targetUid}')
  .onCreate(async (snap, context) => {
    const { uid, targetUid } = context.params;

    try {
      // Find active match
      const matchId = [uid, targetUid].sort().join('_');
      const matchRef = db.collection('matches').doc(matchId);
      const matchSnap = await matchRef.get();

      if (matchSnap.exists && matchSnap.data()?.isActive) {
        await matchRef.update({
          isActive: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    } catch (error) {
      console.error('onUserBlocked error:', error);
    }
  });

/**
 * Trigger: onDiscoveryLikeCreated
 *
 * When someone likes a user from discovery, increment the target's likeCount.
 */
export const onDiscoveryLikeCreated = functions.firestore
  .document('likes/{likeId}')
  .onCreate(async (snap) => {
    const data = snap.data();
    const toUid = data?.toUid as string | undefined;
    if (!toUid) return;

    try {
      await db.collection('users').doc(toUid).update({
        likeCount: admin.firestore.FieldValue.increment(1),
      });
    } catch (error) {
      console.error('onDiscoveryLikeCreated error:', error);
    }
  });

/**
 * Trigger: onPostLikeCreated
 *
 * When someone likes a lounge post, increment the post author's likeCount.
 */
export const onPostLikeCreated = functions.firestore
  .document('post_likes/{postId}/likes/{uid}')
  .onCreate(async (_snap, context) => {
    const { postId } = context.params;

    try {
      const postSnap = await db.collection('posts').doc(postId).get();
      if (!postSnap.exists) return;
      const authorUid = postSnap.data()?.uid as string | undefined;
      if (!authorUid) return;

      await db.collection('users').doc(authorUid).update({
        likeCount: admin.firestore.FieldValue.increment(1),
      });
    } catch (error) {
      console.error('onPostLikeCreated error:', error);
    }
  });

/**
 * Trigger: onPostLikeDeleted
 *
 * When a post like is removed, decrement the post author's likeCount.
 */
export const onPostLikeDeleted = functions.firestore
  .document('post_likes/{postId}/likes/{uid}')
  .onDelete(async (_snap, context) => {
    const { postId } = context.params;

    try {
      const postSnap = await db.collection('posts').doc(postId).get();
      if (!postSnap.exists) return;
      const authorUid = postSnap.data()?.uid as string | undefined;
      if (!authorUid) return;

      await db.collection('users').doc(authorUid).update({
        likeCount: admin.firestore.FieldValue.increment(-1),
      });
    } catch (error) {
      console.error('onPostLikeDeleted error:', error);
    }
  });

/**
 * Trigger: onRatingWritten
 *
 * When a rating is created, verify a match exists between rater and rated,
 * then recompute the rated user's avgRating aggregate.
 */
/**
 * startChat(data: { targetUid: string }) -> { matchId, keyCount, alreadyExists }
 *
 * 서버에서 열쇠 1개 차감 후 매치 생성. 기존 매치는 열쇠 차감 없이 matchId 반환.
 */
export const startChat = functions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);
    const targetUid = data.targetUid;

    if (typeof targetUid !== 'string' || targetUid.length === 0) {
      throw new functions.https.HttpsError('invalid-argument', 'targetUid required');
    }
    if (uid === targetUid) {
      throw new functions.https.HttpsError('invalid-argument', 'Cannot chat with yourself');
    }

    const ids = [uid, targetUid].sort();
    const matchId = ids.join('_');
    const matchRef = db.collection('matches').doc(matchId);
    const userRef = db.collection('users').doc(uid);

    const [existingMatch, targetSnap, mySnap] = await Promise.all([
      matchRef.get(),
      db.collection('users').doc(targetUid).get(),
      userRef.get(),
    ]);

    // 기존 매치 — 열쇠 차감 없이 반환
    if (existingMatch.exists) {
      return {
        matchId,
        keyCount: (mySnap.data()?.keyCount as number) ?? 0,
        alreadyExists: true,
      };
    }

    const myData = mySnap.data() ?? {};
    const targetData = targetSnap.data() ?? {};
    const getPhoto = (d: any) =>
      Array.isArray(d.photoUrls) && d.photoUrls.length > 0 ? d.photoUrls[0] : '';

    // 트랜잭션: 열쇠 확인+차감 + 매치 생성
    const newKeyCount = await db.runTransaction(async (tx) => {
      const freshUser = await tx.get(userRef);
      const currentKeys = (freshUser.data()?.keyCount as number) ?? 0;

      if (currentKeys <= 0) {
        throw new functions.https.HttpsError('resource-exhausted', '열쇠가 부족합니다');
      }

      tx.update(userRef, {
        keyCount: admin.firestore.FieldValue.increment(-1),
      });

      tx.set(matchRef, {
        matchId,
        userIds: ids,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        isActive: true,
        unread: { [uid]: 0, [targetUid]: 0 },
        lastMessageAt: null,
        lastMessagePreview: null,
        partnerFor: {
          [uid]: {
            displayName: targetData.displayName ?? '',
            photoUrl: getPhoto(targetData),
            nationality: targetData.nationality ?? 'JP',
            gender: targetData.gender ?? 'female',
          },
          [targetUid]: {
            displayName: myData.displayName ?? '',
            photoUrl: getPhoto(myData),
            nationality: myData.nationality ?? 'KR',
            gender: myData.gender ?? 'female',
          },
        },
      });

      return currentKeys - 1;
    });

    return { matchId, keyCount: newKeyCount, alreadyExists: false };
  }
);

/**
 * translateText(data: { text: string, targetLang: 'ko' | 'ja' })
 * -> { translatedText: string }
 *
 * On-demand translation callable for lounge post/comment/reply translation.
 */
export const translateText = functions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const text = typeof data.text === 'string' ? data.text.trim() : '';
    const targetLang = data.targetLang;

    if (text.length === 0) {
      throw new functions.https.HttpsError('invalid-argument', 'text must not be empty');
    }

    if (!['ko', 'ja'].includes(targetLang)) {
      throw new functions.https.HttpsError('invalid-argument', 'targetLang must be ko or ja');
    }

    const translatedText = await callGoogleTranslate(text, targetLang as 'ko' | 'ja');
    return { translatedText };
  }
);

/**
 * resetDailyKeys — 매일 자정 KST 열쇠 초기화
 */
export const resetDailyKeys = functions.pubsub
  .schedule('0 15 * * *') // 자정 KST = 15:00 UTC
  .timeZone('Asia/Seoul')
  .onRun(async () => {
    const snapshot = await db
      .collection('users')
      .where('onboardingCompleted', '==', true)
      .get();

    let batch = db.batch();
    let count = 0;

    for (const doc of snapshot.docs) {
      const limit = (doc.data().dailyKeyLimit as number) ?? 3;
      batch.update(doc.ref, { keyCount: limit });
      count++;
      if (count >= 400) {
        await batch.commit();
        batch = db.batch();
        count = 0;
      }
    }
    if (count > 0) await batch.commit();
  });

export const onRatingWritten = functions.firestore
  .document('ratings/{ratingId}')
  .onCreate(async (snap) => {
    const data = snap.data();
    const raterUid = data?.raterUid as string | undefined;
    const ratedUid = data?.ratedUid as string | undefined;
    const stars = data?.stars;

    if (!raterUid || !ratedUid || typeof stars !== 'number') {
      await snap.ref.delete();
      return;
    }

    // Verify a match exists between rater and rated
    const matchId = [raterUid, ratedUid].sort().join('_');
    const matchSnap = await db.collection('matches').doc(matchId).get();
    if (!matchSnap.exists) {
      await snap.ref.delete();
      return;
    }

    // Recompute avgRating on the rated user's doc
    const userRef = db.collection('users').doc(ratedUid);
    try {
      await db.runTransaction(async (transaction) => {
        const userSnap = await transaction.get(userRef);
        if (!userSnap.exists) return;
        const userData = userSnap.data() || {};
        const currentSum = (userData.ratingSum as number) || 0;
        const currentCount = (userData.ratingCount as number) || 0;
        const newSum = currentSum + stars;
        const newCount = currentCount + 1;
        const newAvg = Math.round((newSum / newCount) * 10) / 10;

        transaction.update(userRef, {
          ratingSum: newSum,
          ratingCount: newCount,
          avgRating: newAvg,
        });
      });
    } catch (error) {
      console.error('onRatingWritten aggregation error:', error);
    }
  });
