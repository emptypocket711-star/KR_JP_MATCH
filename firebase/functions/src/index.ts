import * as admin from 'firebase-admin';
import { createHash, randomUUID } from 'crypto';
import * as functions from 'firebase-functions/v1';
import { Translate } from '@google-cloud/translate/build/src/v2';
import { createAccountDeletionProcessor } from './accountDeletionWorker';
import { buildScopedAgoraRtcToken } from './agoraRtcToken';
import {
  activePairRoomIdsForSafety,
  decideCloseActiveChatPolicy,
  decideStartChatPolicy,
  isReusableDirectRoom,
  isExactDirectChatParticipants,
  MAX_ACTIVE_PAIR_ROOMS_PER_SAFETY_ACTION,
} from './chatPolicy';
import {
  idempotentMessageDocumentId,
  isMatchingIdempotentMessage,
  normalizeClientRequestId,
} from './messageIdempotencyPolicy';
import { validateMessageKind } from './messagePolicy';
import {
  mediaUploadAuthorizationIssue,
  mediaUploadConfirmationLeaseIssue,
  mediaUploadAuthorizationTtlMillis,
  mediaUploadMaxBytes,
  mediaUploadObjectPath,
  mediaUploadQuotaId,
  mediaUploadQuotaRetentionMillis,
  mediaUploadLateFinalizeRetentionMillis,
  mediaUploadUtcDayKey,
  nextMediaUploadQuotaCount,
  nextMediaUploadQuotaBytes,
  nextMediaUploadConfirmAttempt,
  nextMediaUploadServerRequestAttempt,
  parseMediaUploadObjectPath,
  privateMediaCacheControl,
  privateMediaMetadataPatch,
  validateReserveMediaUploadRequest,
  isSafeMediaUploadAuthorizationId,
  isVerifiedPrivateMediaMetadata,
  confirmedMediaUploadAuthorizationIssue,
  safeJpegUploadIssue,
  expiredMediaCleanupClaim,
  FinalizedServerUploadContext,
  finalizedMediaDisposition,
  isLegacyPrivateMediaObjectPath,
  parseLegacyPrivateMediaObjectPath,
} from './mediaUploadPolicy';
import {
  decodeAndSanitizeServerJpeg,
  hasExactServerMediaUploadMarker,
  mediaUploadProtocolVersion,
  mediaUploadPublicationTtlMillis,
  serverMediaUploadCustomMetadata,
  serverMediaUploadLeaseMillis,
  serverMediaUploadPayloadDigest,
  ServerMediaUploadMarker,
  shouldCleanupServerMediaAfterFailure,
  validateServerMediaUploadRequest,
} from './serverMediaUploadPolicy';
import {
  canRetireMediaAuthorization,
  decideMediaCleanupClaim,
  mediaCleanupLeaseIssue,
  mediaCleanupLeaseMillis,
  mediaCleanupRetryDelayMillis,
  nextPendingGenerationCleanupCount,
  shouldQuarantineMediaCleanup,
} from './mediaCleanupPolicy';
import {
  shouldSendChatPush,
  targetLanguagesForMessage,
  translatedPreviewForRecipient,
} from './messageSideEffectsPolicy';
import {
  activeAccountIssue,
  callableIdentityIssue,
} from './callablePolicy';
import {
  callEntitlementIssue,
  callExtensionOperationId,
  callRingingTtlSeconds,
  callTokenLifetimeSeconds,
  decideActiveCallReplacement,
  decideCallExtension,
  decideCallExtensionReplay,
  incomingCallNotificationTtlMillis,
  JoinableCallStatus,
  normalizeCallExtensionRequestId,
  videoSegmentPoints as VIDEO_SEGMENT_POINTS,
  videoSegmentSeconds as VIDEO_SEGMENT_SECONDS,
  voiceExtensionPoints as VOICE_EXTENSION_POINTS,
  voiceExtensionSeconds as VOICE_EXTENSION_SECONDS,
  voiceFreeSeconds as VOICE_FREE_SECONDS,
} from './callEntitlementPolicy';
import { ageOnReferenceDate, parseValidDateOfBirth } from './birthDatePolicy';
import { publicAgeFromPrivateProfile } from './publicProfilePolicy';
import { deprecatedLikeResult } from './legacyDiscoveryPolicy';
import {
  decideInitialOnboardingPointGrant,
  onboardingCompletionBlockReason,
  onboardingPointEventId,
  profileUploadOnboardingShellProvenance,
  validateOnboardingProfileInput,
} from './onboardingPolicy';
import {
  isEligibleExternalProfileViewer,
  isInternalOrTestUser,
  isPublicUserProfile,
} from './profileExposurePolicy';
import {
  normalizeProfileDisplayName,
  profileDisplayNameReservationIdsToRelease,
  validateProfileUpdateInput,
} from './profileUpdatePolicy';
import {
  profilePhotoObjectPath,
} from './profilePhotoPolicy';
import {
  profileMediaVisibilityDecision,
  profileMediaVisibilityVersion,
} from './profileMediaVisibilityPolicy';
import {
  chatMediaReadIssue,
  profileMediaReadIssue,
} from './privateMediaReadPolicy';
import {
  nextPrivateMediaReadByteQuota,
  nextPrivateMediaReadRequestAttemptQuota,
  privateMediaReadQuotaKeys,
} from './privateMediaReadQuotaPolicy';
import {
  PROFILE_TRANSLATION_CACHE_VERSION,
  ProfileTranslationTarget,
  playfulProfileFallback,
  resolveViewerProfileLanguage,
  translateProfileKeyword,
  translateProfileOccupation,
  translateProfilePhrase,
} from './profileTranslationPolicy';
import {
  canGrantVerifiedPlayPurchase,
  dailyLoungePostPointGrantAmount,
  isAlreadyGrantedPlayPurchaseRecord,
  isStorePointPurchaseEnabled,
  isValidPointBalance,
  isValidPointPlatform,
  isValidPurchaseToken,
  kstDateKey,
  pointAmountForProduct,
  pointBalanceAfterConsume,
  pointBalanceAfterGrant,
  pointBalanceTrustIssue,
  pointBalanceTrustVersion,
  shouldGrantDailyLoungePostPoints,
  shouldVerifyPlayBilling,
} from './pointPolicy';
import {
  ApplePurchaseVerificationError,
  verifyAppleAppStoreProductPurchase,
} from './appleReceiptVerifier';
import { verifyGooglePlayProductPurchase } from './playBillingVerifier';
import {
  fcmTokenOwnershipId,
  retryableFcmRegistrationDetails,
  shouldClearOwnedFcmToken,
} from './fcmTokenPolicy';
import {
  buildReportContentEvidence,
  clientReportIntakeDecision,
  isValidReportReason,
  normalizeReportContentContext,
  ReportContentContext,
  reportContentContextIssue,
  reportContentStateIssue,
  reportEvidenceVersion,
  reportRequestShapeIssue,
} from './safetyPolicy';
import {
  decideTranslationQuota,
  translationQuotaKeys,
  validateTranslationRequest,
} from './translationPolicy';
import {
  decidePendingStorePurchaseClaim,
  deriveStoreAppAccountToken,
  canClaimPlayPurchaseReservation,
  isTerminalPendingStorePurchaseError,
  isValidAppleTransactionId,
  isValidStoreAppAccountToken,
  maxPendingStorePurchaseAttempts,
  nextPlayVerificationQuotaCount,
  pendingStorePurchaseLeaseMillis,
  pendingStorePurchaseRetentionMillis,
  pendingStorePurchaseRetryDelayMillis,
  playPurchaseReservationLeaseMillis,
  resolveAppleStoreVerificationConfig,
} from './storePurchasePolicy';
import {
  projectIdFromFirebaseConfig,
  resolveFunctionsDeployment,
} from './functionsRegionPolicy';

// Each Firebase project keeps its existing single trigger set: staging is in
// us-central1 and production is in asia-northeast1. The guarded deploy scripts
// supply all explicit values; deployed runtimes can resolve from project ID.
const functionDeployment = resolveFunctionsDeployment({
  declaredProjectId: process.env.HANA_FIREBASE_PROJECT,
  runtimeProjectId:
    process.env.GCLOUD_PROJECT ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    projectIdFromFirebaseConfig(process.env.FIREBASE_CONFIG),
  environment: process.env.HANA_FIREBASE_ENV,
  explicitRegion: process.env.HANA_FUNCTIONS_REGION,
});
const FUNCTION_REGION = functionDeployment.region;
const regionalFunctions = functions.region(FUNCTION_REGION);

admin.initializeApp(); // redeploy

const db = admin.firestore();
const auth = admin.auth();
const accountDeletionProcessor = createAccountDeletionProcessor({
  db,
  auth,
  bucket: admin.storage().bucket(),
});
const translate = new Translate();
// firebase-functions v1 FunctionBuilder.runWith mutates the builder. Every
// specialized runtime must therefore start from a fresh regional builder so
// its options cannot leak into later callables or triggers.
const DISCOVERY_CALLABLE_RUNTIME = functions.region(FUNCTION_REGION).runWith({
  memory: '512MB',
  timeoutSeconds: 30,
});
const LOUNGE_LEGACY_CUTOFF = admin.firestore.Timestamp.fromDate(
  new Date('2026-05-10T00:00:00.000Z')
);
const pendingStorePurchaseStatuses = [
  'pending',
  'retryable_error',
  'verifying',
];

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface PublicProfile {
  uid: string;
  displayName: string;
  age: number;
  gender: 'male' | 'female';
  nationality: 'KR' | 'JP';
  residingCountry: 'KR' | 'JP' | 'OTHER';
  city?: string;
  nativeLanguage: 'ko' | 'ja';
  learningLanguage: 'ko' | 'ja';
  bio: string;
  occupation?: string;
  photoUrls: string[];
  keywords?: string[];
  relationshipType?: string;
  isOnline?: boolean;
  canTranslate?: boolean;
  affinityScore?: number;
  qaItems?: Array<Record<string, string>>;
  likeCount?: number;
  avgRating?: number;
  ratingCount?: number;
  lastSeenAt?: admin.firestore.Timestamp;
  approxDistanceKm?: number;
  approxDistanceLabel?: string;
  originalProfileText?: ProfileTextBundle;
}

interface QuotaEventData {
  uid: string;
  callId?: string;
  clientRequestId?: string;
  eventType: 'grant' | 'consume';
  amount: number;
  reason: string;
  extraQuotaPurchased?: number;
  balanceBefore?: number;
  balanceAfter?: number;
  matchId?: string;
  pairKey?: string;
  platform?: string;
  source?: string;
  receiptType?: string;
  migrationMarker?: boolean;
  legacyBalancePreserved?: boolean;
  timestamp: admin.firestore.Timestamp;
}

interface StorePointPurchaseRequest {
  platform: 'android' | 'ios';
  receipt: string;
  productId: string;
  purchaseId?: string;
  verificationSource?: string;
  appAccountToken?: string;
}

function pointBalanceReviewRequired(): never {
  throw new functions.https.HttpsError(
    'failed-precondition',
    'Point balance requires account review'
  );
}

function requireTrustedPointBalance(
  userData: Record<string, unknown> | undefined
): number {
  if (pointBalanceTrustIssue(userData) !== null) {
    return pointBalanceReviewRequired();
  }
  const balance = userData?.keyCount;
  if (!isValidPointBalance(balance)) {
    return pointBalanceReviewRequired();
  }
  return balance;
}

function pointBalanceForServerGrant(
  userData: Record<string, unknown> | undefined
): number {
  const issue = pointBalanceTrustIssue(userData);
  if (issue === null) return requireTrustedPointBalance(userData);

  const balance = userData?.keyCount;
  if (
    issue === 'untrusted-balance' &&
    userData?.pointBalanceTrustVersion === undefined &&
    userData?.pointBalanceQuarantined !== true &&
    balance === 0 &&
    isValidPointBalance(balance)
  ) {
    return balance;
  }
  return pointBalanceReviewRequired();
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function verifyAndGrantStorePointPurchase(
  uid: string,
  data: StorePointPurchaseRequest
) {
  if (data.platform === 'ios') {
    return verifyAndGrantAppleStorePointPurchase(uid, data);
  }
  return verifyAndGrantGooglePlayPointPurchase(uid, data);
}

function appleStoreVerificationConfig() {
  const runtimeConfig = functions.config();
  return resolveAppleStoreVerificationConfig(
    process.env,
    runtimeConfig.app_store ?? {}
  );
}

async function verifyAndGrantAppleStorePointPurchase(
  uid: string,
  data: StorePointPurchaseRequest
) {
  const config = appleStoreVerificationConfig();
  if (config == null) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'App Store point purchases are not enabled for this environment'
    );
  }

  const productPoints = pointAmountForProduct(data.productId);
  if (productPoints == null) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'productId is not a supported point package'
    );
  }
  if (
    typeof data.receipt !== 'string' ||
    data.receipt.length < 16 ||
    data.receipt.length > 32_768 ||
    data.receipt.split('.').length !== 3
  ) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'signed App Store transaction is invalid'
    );
  }
  if (!isValidAppleTransactionId(data.purchaseId)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'App Store transaction ID is invalid'
    );
  }
  if (data.verificationSource !== 'app_store') {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'App Store verification source is invalid'
    );
  }

  const expectedAppAccountToken = deriveStoreAppAccountToken(uid);
  if (
    !isValidStoreAppAccountToken(data.appAccountToken) ||
    data.appAccountToken !== expectedAppAccountToken
  ) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'App Store account token is invalid'
    );
  }

  let verifiedPurchase;
  try {
    verifiedPurchase = await verifyAppleAppStoreProductPurchase({
      signedTransaction: data.receipt,
      productId: data.productId,
      transactionId: data.purchaseId,
      appAccountToken: expectedAppAccountToken,
      config,
    });
  } catch (error) {
    if (error instanceof ApplePurchaseVerificationError && error.retryable) {
      throw new functions.https.HttpsError(
        'unavailable',
        'App Store verification is temporarily unavailable'
      );
    }
    throw new functions.https.HttpsError(
      'invalid-argument',
      'App Store purchase verification failed'
    );
  }

  const userRef = db.collection('users').doc(uid);
  const ledgerId = `apple:${verifiedPurchase.transactionId}`;
  const transactionRef = db.collection('storeTransactions').doc(ledgerId);
  const pointEventRef = db.collection('pointEvents').doc(ledgerId);
  const receiptHash = createHash('sha256').update(data.receipt).digest('hex');
  const appAccountTokenHash = createHash('sha256')
    .update(verifiedPurchase.appAccountToken)
    .digest('hex');

  const result = await db.runTransaction(async (tx) => {
    const [userSnap, transactionSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(transactionRef),
    ]);
    const userData = userSnap.data();
    const accountIssue = activeAccountIssue({
      exists: userSnap.exists,
      userData,
    });
    if (accountIssue === 'missing') {
      throw new functions.https.HttpsError(
        'not-found',
        'User profile not found'
      );
    }
    if (accountIssue === 'banned') {
      throw new functions.https.HttpsError(
        'permission-denied',
        'User is banned'
      );
    }
    if (accountIssue === 'deleted') {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'User account is being deleted'
      );
    }

    const existingTransaction = transactionSnap.data();
    if (transactionSnap.exists) {
      if (
        existingTransaction?.status === 'granted' &&
        existingTransaction.uid === uid &&
        existingTransaction.productId === data.productId
      ) {
        const keyCount = requireTrustedPointBalance(userData);
        return { keyCount, alreadyProcessed: true };
      }
      throw new functions.https.HttpsError(
        'already-exists',
        'App Store transaction was already processed'
      );
    }

    const currentKeyCount = pointBalanceForServerGrant(userData);
    const nextKeyCount = pointBalanceAfterGrant(
      currentKeyCount,
      productPoints
    );
    const event: QuotaEventData = {
      uid,
      eventType: 'grant',
      amount: productPoints,
      reason: `App Store point purchase (${data.productId})`,
      balanceBefore: currentKeyCount,
      balanceAfter: nextKeyCount,
      platform: 'ios',
      source: 'app_store',
      receiptType: 'storekit2_signed_transaction',
      timestamp: admin.firestore.Timestamp.now(),
    };

    tx.update(userRef, {
      keyCount: nextKeyCount,
      pointBalanceTrustVersion,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.create(transactionRef, {
      uid,
      platform: 'ios',
      store: 'apple',
      status: 'granted',
      transactionId: verifiedPurchase.transactionId,
      originalTransactionId: verifiedPurchase.originalTransactionId,
      productId: verifiedPurchase.productId,
      quantity: verifiedPurchase.quantity,
      amount: productPoints,
      environment: verifiedPurchase.environment,
      purchaseDate: verifiedPurchase.purchaseDate,
      signedDate: verifiedPurchase.signedDate,
      receiptHash,
      appAccountTokenHash,
      pointEventId: pointEventRef.id,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      grantedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.create(pointEventRef, event);
    return { keyCount: nextKeyCount, alreadyProcessed: false };
  });

  return {
    ok: true,
    extraQuotaGranted: result.alreadyProcessed ? 0 : productPoints,
    keyCount: result.keyCount,
    alreadyProcessed: result.alreadyProcessed,
  };
}

async function verifyAndGrantGooglePlayPointPurchase(
  uid: string,
  data: StorePointPurchaseRequest
) {
  if (!isStorePointPurchaseEnabled(data.platform)) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Store point purchases are temporarily unavailable'
    );
  }
  if (data.verificationSource !== 'google_play') {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Google Play verification source is invalid'
    );
  }

  const playBillingConfig = functions.config().play_billing;
  if (
    !shouldVerifyPlayBilling(
      process.env,
      playBillingConfig?.verification_enabled
    )
  ) {
    // Keep the source lock ahead of every purchase/quota write so a disabled
    // real-money path cannot be used to create durable fake reservations.
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Play Billing verification is not enabled'
    );
  }

  const productPoints = pointAmountForProduct(data.productId);
  if (productPoints == null) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'productId is not a supported point package'
    );
  }

  if (!isValidPurchaseToken(data.receipt)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'purchase token is invalid'
    );
  }

  const tokenHash = createHash('sha256')
    .update(`${data.platform}:${data.receipt}`)
    .digest('hex');
  const purchaseRef = db.collection('playPurchases').doc(tokenHash);
  const verificationQuotaRef = db
    .collection('storeVerificationQuotas')
    .doc(uid);
  const userRef = db.collection('users').doc(uid);
  const purchaseId = typeof data.purchaseId === 'string' ? data.purchaseId : '';
  const reservationId = randomUUID();
  const nowMillis = Date.now();
  const reservation = await db.runTransaction(async (tx) => {
    const [purchaseSnap, quotaSnap, userSnap] = await Promise.all([
      tx.get(purchaseRef),
      tx.get(verificationQuotaRef),
      tx.get(userRef),
    ]);
    assertActiveAccountSnapshot(userSnap);
    const purchaseData = purchaseSnap.data();
    if (
      purchaseSnap.exists &&
      isAlreadyGrantedPlayPurchaseRecord(purchaseData, uid)
    ) {
      requireTrustedPointBalance(userSnap.data());
      return 'granted' as const;
    }
    pointBalanceForServerGrant(userSnap.data());
    const leaseUntilMillis =
      purchaseData?.leaseUntil instanceof admin.firestore.Timestamp
        ? purchaseData.leaseUntil.toMillis()
        : undefined;
    if (
      !canClaimPlayPurchaseReservation(
        purchaseData == null
          ? undefined
          : { ...purchaseData, leaseUntilMillis },
        uid,
        data.productId,
        nowMillis
      )
    ) {
      return 'conflict' as const;
    }
    const dayKey = new Date(nowMillis).toISOString().slice(0, 10);
    const nextQuotaCount = nextPlayVerificationQuotaCount(
      quotaSnap.data(),
      dayKey
    );
    if (nextQuotaCount == null) {
      throw new functions.https.HttpsError(
        'resource-exhausted',
        'Daily store verification limit reached'
      );
    }

    tx.set(
      purchaseRef,
      {
        uid,
        productId: data.productId,
        platform: data.platform,
        tokenHash,
        purchaseId,
        status: 'verifying',
        reservationId,
        leaseUntil: admin.firestore.Timestamp.fromMillis(
          nowMillis + playPurchaseReservationLeaseMillis
        ),
        retryCount: purchaseSnap.exists
          ? admin.firestore.FieldValue.increment(1)
          : 0,
        createdAt: purchaseSnap.exists
          ? purchaseData?.createdAt ??
            admin.firestore.FieldValue.serverTimestamp()
          : admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    tx.set(
      verificationQuotaRef,
      {
        uid,
        dayKey,
        count: nextQuotaCount,
        expireAt: admin.firestore.Timestamp.fromMillis(
          nowMillis + 2 * 24 * 60 * 60 * 1000
        ),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return 'claimed' as const;
  });

  if (reservation === 'granted') {
    const currentUser = await db.collection('users').doc(uid).get();
    return {
      ok: true,
      extraQuotaGranted: 0,
      keyCount: requireTrustedPointBalance(currentUser.data()),
      alreadyProcessed: true,
    };
  }
  if (reservation === 'conflict') {
    throw new functions.https.HttpsError(
      'already-exists',
      'purchase token is already being processed'
    );
  }

  let verifiedPurchase;
  try {
    verifiedPurchase = await verifyGooglePlayProductPurchase(
      data.productId,
      data.receipt
    );
  } catch (_err) {
    await db.runTransaction(async (tx) => {
      const freshSnap = await tx.get(purchaseRef);
      if (freshSnap.data()?.reservationId !== reservationId) return;
      tx.update(purchaseRef, {
        status: 'verification_failed',
        errorCode: 'play_verification_failed',
        leaseUntil: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Store purchase verification failed'
    );
  }

  const expectedObfuscatedAccountId = deriveStoreAppAccountToken(uid);
  if (
    !canGrantVerifiedPlayPurchase(verifiedPurchase, {
      productId: data.productId,
      obfuscatedExternalAccountId: expectedObfuscatedAccountId,
    })
  ) {
    await db.runTransaction(async (tx) => {
      const freshSnap = await tx.get(purchaseRef);
      if (freshSnap.data()?.reservationId !== reservationId) return;
      tx.update(purchaseRef, {
        status: 'rejected',
        purchaseState: verifiedPurchase.purchaseState ?? null,
        leaseUntil: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Store purchase is not in a purchased state'
    );
  }

  const result = await db.runTransaction(async (tx) => {
    const [userSnap, freshPurchaseSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(purchaseRef),
    ]);
    const freshUserData = userSnap.data();
    const accountIssue = activeAccountIssue({
      exists: userSnap.exists,
      userData: freshUserData,
    });
    if (accountIssue === 'missing') {
      throw new functions.https.HttpsError(
        'not-found',
        'User profile not found'
      );
    }
    if (accountIssue === 'banned') {
      throw new functions.https.HttpsError(
        'permission-denied',
        'User is banned'
      );
    }
    if (accountIssue === 'deleted') {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'User account is being deleted'
      );
    }
    if (freshPurchaseSnap.data()?.status === 'granted') {
      const currentKeyCount = requireTrustedPointBalance(freshUserData);
      return {
        previousKeyCount: currentKeyCount,
        keyCount: currentKeyCount,
        alreadyProcessed: true,
      };
    }
    if (
      freshPurchaseSnap.data()?.status !== 'verifying' ||
      freshPurchaseSnap.data()?.reservationId !== reservationId
    ) {
      throw new functions.https.HttpsError(
        'aborted',
        'purchase verification lease was replaced'
      );
    }

    const currentKeyCount = pointBalanceForServerGrant(freshUserData);
    const nextKeyCount = pointBalanceAfterGrant(
      currentKeyCount,
      productPoints
    );
    const pointEventRef = db.collection('pointEvents').doc();
    const event: QuotaEventData = {
      uid,
      eventType: 'grant',
      amount: productPoints,
      reason: `Google Play point purchase (${data.productId})`,
      balanceBefore: currentKeyCount,
      balanceAfter: nextKeyCount,
      platform: data.platform,
      source: 'google_play',
      receiptType: 'google_play_product',
      timestamp: admin.firestore.Timestamp.now(),
    };

    tx.update(userRef, {
      keyCount: nextKeyCount,
      pointBalanceTrustVersion,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.update(purchaseRef, {
      status: 'granted',
      amount: productPoints,
      orderId: verifiedPurchase.orderId ?? null,
      purchaseTimeMillis: verifiedPurchase.purchaseTimeMillis ?? null,
      purchaseState: verifiedPurchase.purchaseState ?? null,
      consumptionState: verifiedPurchase.consumptionState ?? null,
      acknowledgementState: verifiedPurchase.acknowledgementState ?? null,
      accountBindingHash: createHash('sha256')
        .update(expectedObfuscatedAccountId)
        .digest('hex'),
      pointEventId: pointEventRef.id,
      leaseUntil: admin.firestore.FieldValue.delete(),
      grantedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.set(pointEventRef, event);

    return {
      previousKeyCount: currentKeyCount,
      keyCount: nextKeyCount,
      alreadyProcessed: false,
    };
  });

  return {
    ok: true,
    extraQuotaGranted: result.alreadyProcessed ? 0 : productPoints,
    keyCount: result.keyCount,
    alreadyProcessed: result.alreadyProcessed,
  };
}

/**
 * Requires verified App Check and Firebase Auth callable context.
 */
function requireVerifiedCallableUid(
  context: functions.https.CallableContext
): string {
  const issue = callableIdentityIssue({
    hasAppCheck: context.app != undefined,
    uid: context.auth?.uid,
  });
  if (issue === 'app-check') {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'App Check verification failed'
    );
  }
  if (issue === 'authentication') {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'User must be authenticated'
    );
  }

  return context.auth!.uid;
}

/**
 * Ensures the user has verified callable identity and an active account.
 */
async function requireAuthAndNotBanned(
  context: functions.https.CallableContext
): Promise<string> {
  const uid = requireVerifiedCallableUid(context);

  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) {
    throw new functions.https.HttpsError(
      'not-found',
      'User profile not found'
    );
  }

  const userData = userSnap.data();
  const accountIssue = activeAccountIssue({
    exists: userSnap.exists,
    userData,
  });
  if (accountIssue === 'banned') {
    throw new functions.https.HttpsError(
      'permission-denied',
      'User is banned'
    );
  }

  if (accountIssue === 'deleted') {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'User account is being deleted'
    );
  }

  return uid;
}

/**
 * Callables may perform network work between their initial auth check and the
 * final Firestore mutation. Every user-owned write transaction must re-read
 * the account tombstone and call this helper before writing.
 */
function assertActiveAccountSnapshot(
  snapshot: FirebaseFirestore.DocumentSnapshot,
  label = 'User'
): FirebaseFirestore.DocumentData {
  const issue = activeAccountIssue({
    exists: snapshot.exists,
    userData: snapshot.data(),
  });
  if (issue === 'missing') {
    throw new functions.https.HttpsError('not-found', `${label} profile not found`);
  }
  if (issue === 'banned') {
    throw new functions.https.HttpsError('permission-denied', `${label} is banned`);
  }
  if (issue === 'deleted') {
    throw new functions.https.HttpsError(
      'failed-precondition',
      `${label} account is being deleted`
    );
  }
  return snapshot.data()!;
}

function assertNoAccountDeletionJob(
  snapshot: FirebaseFirestore.DocumentSnapshot
): void {
  if (snapshot.exists) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'User account is being deleted'
    );
  }
}

function directRoomUnavailable(): functions.https.HttpsError {
  return new functions.https.HttpsError(
    'permission-denied',
    'Chat room is unavailable'
  );
}

function directChatTargetUnavailable(): functions.https.HttpsError {
  return new functions.https.HttpsError(
    'permission-denied',
    'Target user is unavailable'
  );
}

function reusableDirectRoomSnapshots(params: {
  matchId: string;
  matchSnap: FirebaseFirestore.DocumentSnapshot;
  pairSnap: FirebaseFirestore.DocumentSnapshot;
  expectedUserIds: readonly string[];
  pairKey: string;
}): boolean {
  const matchData = params.matchSnap.data();
  const pairData = params.pairSnap.data();
  return isReusableDirectRoom({
    matchId: params.matchId,
    matchExists: params.matchSnap.exists,
    matchActive: matchData?.isActive === true,
    matchUserIds: matchData?.userIds,
    matchPairKey: matchData?.pairKey,
    directRoomVersion: matchData?.directRoomVersion,
    hiddenFor: matchData?.hiddenFor,
    expectedUserIds: params.expectedUserIds,
    pointerExists: params.pairSnap.exists,
    pointerId: params.pairSnap.id,
    pointerUserIds: pairData?.userIds,
    pointerPairKey: pairData?.pairKey,
    pointerActiveMatchId: pairData?.activeMatchId,
    pointerClosedMatchId: pairData?.closedMatchId,
    pointerClosedReason: pairData?.closedReason,
  }) && params.pairSnap.id === params.pairKey;
}

interface DirectRoomSideEffectContext {
  senderData: FirebaseFirestore.DocumentData;
  recipientData: FirebaseFirestore.DocumentData;
}

async function readAuthorizedDirectRoomSideEffectContextInTransaction(
  tx: FirebaseFirestore.Transaction,
  params: {
    matchId: string;
    senderUid: string;
    recipientUid: string;
  }
): Promise<DirectRoomSideEffectContext | null> {
  const expectedUserIds = [params.senderUid, params.recipientUid].sort();
  const pairKey = expectedUserIds.join('_');
  const matchRef = db.collection('matches').doc(params.matchId);
  const pairRef = db.collection('chatPairs').doc(pairKey);
  const senderRef = db.collection('users').doc(params.senderUid);
  const recipientRef = db.collection('users').doc(params.recipientUid);
  const [
    matchSnap,
    pairSnap,
    senderSnap,
    recipientSnap,
    senderBlockSnap,
    recipientBlockSnap,
  ] = await Promise.all([
    tx.get(matchRef),
    tx.get(pairRef),
    tx.get(senderRef),
    tx.get(recipientRef),
    tx.get(senderRef.collection('blocks').doc(params.recipientUid)),
    tx.get(recipientRef.collection('blocks').doc(params.senderUid)),
  ]);
  if (
    activeAccountIssue({
      exists: senderSnap.exists,
      userData: senderSnap.data(),
    }) !== null ||
    activeAccountIssue({
      exists: recipientSnap.exists,
      userData: recipientSnap.data(),
    }) !== null ||
    senderBlockSnap.exists ||
    recipientBlockSnap.exists ||
    !reusableDirectRoomSnapshots({
      matchId: params.matchId,
      matchSnap,
      pairSnap,
      expectedUserIds,
      pairKey,
    })
  ) {
    return null;
  }
  return {
    senderData: senderSnap.data()!,
    recipientData: recipientSnap.data()!,
  };
}

async function readAuthorizedDirectRoomSideEffectContext(params: {
  matchId: string;
  senderUid: string;
  recipientUid: string;
}): Promise<DirectRoomSideEffectContext | null> {
  return db.runTransaction((tx) =>
    readAuthorizedDirectRoomSideEffectContextInTransaction(tx, params)
  );
}

async function applyAuthorizedMessageRecipientState(params: {
  matchId: string;
  senderUid: string;
  recipientUid: string;
  localizedPreview: string | null;
}): Promise<DirectRoomSideEffectContext | null> {
  return db.runTransaction(async (tx) => {
    const access = await readAuthorizedDirectRoomSideEffectContextInTransaction(
      tx,
      params
    );
    if (access == null) return null;
    tx.update(db.collection('matches').doc(params.matchId), {
      [`unread.${params.recipientUid}`]: admin.firestore.FieldValue.increment(1),
      ...(params.localizedPreview == null
        ? {}
        : {
            [`lastMessagePreviewFor.${params.recipientUid}`]:
              params.localizedPreview,
          }),
    });
    return access;
  });
}

async function assertActiveDirectRoomMutation(
  tx: FirebaseFirestore.Transaction,
  uid: string,
  matchId: string,
  matchData: FirebaseFirestore.DocumentData
): Promise<string> {
  const userIds = matchData.userIds as string[] | undefined;
  if (!isExactDirectChatParticipants(userIds) || !userIds.includes(uid)) {
    throw directRoomUnavailable();
  }
  if (matchData.isActive !== true) {
    throw directRoomUnavailable();
  }
  if (!Array.isArray(matchData.hiddenFor) || matchData.hiddenFor.length > 0) {
    throw directRoomUnavailable();
  }
  const otherUid = userIds.find((participant) => participant !== uid)!;
  const expectedUserIds = [uid, otherUid].sort();
  const pairKey = expectedUserIds.join('_');
  const callerRef = db.collection('users').doc(uid);
  const otherRef = db.collection('users').doc(otherUid);
  const [otherSnap, callerBlock, otherBlock, pairSnap] = await Promise.all([
    tx.get(otherRef),
    tx.get(callerRef.collection('blocks').doc(otherUid)),
    tx.get(otherRef.collection('blocks').doc(uid)),
    tx.get(db.collection('chatPairs').doc(pairKey)),
  ]);
  if (activeAccountIssue({
    exists: otherSnap.exists,
    userData: otherSnap.data(),
  }) !== null) {
    throw directRoomUnavailable();
  }
  if (callerBlock.exists || otherBlock.exists) {
    throw directRoomUnavailable();
  }
  if (!isReusableDirectRoom({
    matchId,
    matchExists: true,
    matchActive: matchData.isActive === true,
    matchUserIds: matchData.userIds,
    matchPairKey: matchData.pairKey,
    directRoomVersion: matchData.directRoomVersion,
    hiddenFor: matchData.hiddenFor,
    expectedUserIds,
    pointerExists: pairSnap.exists,
    pointerId: pairSnap.id,
    pointerUserIds: pairSnap.data()?.userIds,
    pointerPairKey: pairSnap.data()?.pairKey,
    pointerActiveMatchId: pairSnap.data()?.activeMatchId,
    pointerClosedMatchId: pairSnap.data()?.closedMatchId,
    pointerClosedReason: pairSnap.data()?.closedReason,
  })) {
    throw directRoomUnavailable();
  }
  return otherUid;
}

async function assertActiveMediaUploadRoom(
  tx: FirebaseFirestore.Transaction,
  uid: string,
  matchId: string
): Promise<void> {
  const matchRef = db.collection('matches').doc(matchId);
  const matchSnap = await tx.get(matchRef);
  const matchData = matchSnap.data();
  if (
    !matchSnap.exists ||
    matchData?.directRoomVersion !== 1 ||
    matchData?.isActive !== true ||
    !Array.isArray(matchData?.hiddenFor) ||
    matchData.hiddenFor.length > 0
  ) {
    throw directRoomUnavailable();
  }
  const userIds = matchData?.userIds as string[] | undefined;
  if (!isExactDirectChatParticipants(userIds) || !userIds.includes(uid)) {
    throw directRoomUnavailable();
  }
  const otherUid = await assertActiveDirectRoomMutation(
    tx,
    uid,
    matchId,
    matchData
  );
  const pairKey = [uid, otherUid].sort().join('_');
  const pairSnap = await tx.get(db.collection('chatPairs').doc(pairKey));
  if (
    !pairSnap.exists ||
    pairSnap.data()?.pairKey !== pairKey ||
    !isExactDirectChatParticipants(pairSnap.data()?.userIds, [uid, otherUid]) ||
    pairSnap.data()?.activeMatchId !== matchId
  ) {
    throw directRoomUnavailable();
  }
}

async function assertActiveLoungeAuthorMutation(
  tx: FirebaseFirestore.Transaction,
  viewerUid: string,
  authorUid: unknown,
  viewerSnap: FirebaseFirestore.DocumentSnapshot,
  contentData?: FirebaseFirestore.DocumentData
): Promise<void> {
  if (typeof authorUid !== 'string' || authorUid.length === 0) {
    throw new functions.https.HttpsError('permission-denied', 'Content unavailable');
  }
  const authorRef = db.collection('users').doc(authorUid);
  const authorSnap = authorUid === viewerUid ? viewerSnap : await tx.get(authorRef);
  const authorData = assertActiveAccountSnapshot(authorSnap, 'Content author');
  if (
    !isPublicUserProfile(authorData) ||
    !isEligibleExternalProfileViewer(authorData) ||
    isInternalOrPromotionalLoungeContent(contentData, authorData)
  ) {
    throw new functions.https.HttpsError('permission-denied', 'Content unavailable');
  }
  if (authorUid === viewerUid) return;
  const [viewerBlock, authorBlock] = await Promise.all([
    tx.get(db.collection('users').doc(viewerUid).collection('blocks').doc(authorUid)),
    tx.get(authorRef.collection('blocks').doc(viewerUid)),
  ]);
  if (viewerBlock.exists || authorBlock.exists) {
    throw new functions.https.HttpsError('permission-denied', 'Content unavailable');
  }
}

async function writeMessageTranslationForActiveAccount(
  uid: string,
  otherUid: string,
  matchRef: FirebaseFirestore.DocumentReference,
  messageRef: FirebaseFirestore.DocumentReference,
  data: FirebaseFirestore.DocumentData
): Promise<void> {
  const userRef = db.collection('users').doc(uid);
  const otherUserRef = db.collection('users').doc(otherUid);
  const callerBlockRef = userRef.collection('blocks').doc(otherUid);
  const recipientBlockRef = otherUserRef.collection('blocks').doc(uid);
  const expectedUserIds = [uid, otherUid].sort();
  const pairKey = expectedUserIds.join('_');
  const pairRef = db.collection('chatPairs').doc(pairKey);
  await db.runTransaction(async (tx) => {
    const [
      userSnap,
      otherUserSnap,
      matchSnap,
      messageSnap,
      callerBlock,
      recipientBlock,
      pairSnap,
    ] =
      await Promise.all([
      tx.get(userRef),
      tx.get(otherUserRef),
      tx.get(matchRef),
      tx.get(messageRef),
      tx.get(callerBlockRef),
      tx.get(recipientBlockRef),
      tx.get(pairRef),
    ]);
    assertActiveAccountSnapshot(userSnap);
    if (
      activeAccountIssue({
        exists: otherUserSnap.exists,
        userData: otherUserSnap.data(),
      }) !== null ||
      callerBlock.exists ||
      recipientBlock.exists ||
      !reusableDirectRoomSnapshots({
        matchId: matchRef.id,
        matchSnap,
        pairSnap,
        expectedUserIds,
        pairKey,
      })
    ) {
      throw directRoomUnavailable();
    }
    if (!messageSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Message not found');
    }
    tx.set(messageRef, data, { merge: true });
  });
}

function protectedProfileMediaEntries(
  photoUrls: unknown,
  uid: string
): Array<{ objectPath: string }> {
  if (!Array.isArray(photoUrls)) return [];
  const entries = new Set<string>();
  for (const value of photoUrls) {
    if (typeof value !== 'string') continue;
    const objectPath = profilePhotoObjectPath(value, uid);
    if (objectPath == null) continue;
    const parsed = parseMediaUploadObjectPath(objectPath);
    if (parsed?.kind === 'profile' && parsed.uid === uid) {
      entries.add(objectPath);
    }
  }
  return [...entries].map((objectPath) => ({ objectPath }));
}

function protectedProfileMediaPaths(
  photoUrls: unknown,
  uid: string
): string[] {
  return protectedProfileMediaEntries(photoUrls, uid)
    .map((entry) => entry.objectPath);
}

function mediaAuthorizationRefForObjectPath(
  objectPath: string
): admin.firestore.DocumentReference {
  const parsed = parseMediaUploadObjectPath(objectPath);
  if (parsed == null) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Media path is not authorization-bound'
    );
  }
  return db.collection('mediaUploadAuthorizations').doc(parsed.authorizationId);
}

interface InspectedMediaObject {
  generation: string;
  metageneration: string;
  size: number;
  customMetadata: Record<string, string | boolean | number | null>;
}

async function assertUploadedMediaMetadata(
  objectPath: string,
  options: { requirePrivateMetadata?: boolean } = {}
): Promise<InspectedMediaObject> {
  try {
    const bucket = admin.storage().bucket();
    const [metadata] = await bucket.file(objectPath).getMetadata();
    const size = Number(metadata.size);
    const generation = metadata.generation;
    const metageneration = metadata.metageneration;
    const customMetadata = { ...(metadata.metadata ?? {}) };
    if (
      metadata.contentType !== 'image/jpeg' ||
      !Number.isSafeInteger(size) ||
      size <= 0 ||
      size > mediaUploadMaxBytes ||
      typeof generation !== 'string' ||
      generation.length === 0 ||
      typeof metageneration !== 'string' ||
      metageneration.length === 0 ||
      customMetadata.hanaCacheControl !== privateMediaCacheControl ||
      (options.requirePrivateMetadata === true &&
        (metadata.cacheControl !== privateMediaCacheControl ||
          customMetadata.firebaseStorageDownloadTokens != null))
    ) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Uploaded media must be a metadata-free JPEG within the size limit'
      );
    }
    return { generation, metageneration, size, customMetadata };
  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    if (!isStorageNotFound(error)) {
      throw new functions.https.HttpsError(
        'unavailable',
        'Reserved media bytes are temporarily unavailable'
      );
    }
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Reserved media upload is missing'
    );
  }
}

async function assertUploadedMediaContents(
  objectPath: string,
  inspectedObject: InspectedMediaObject
): Promise<void> {
  try {
    // Bind the full-byte inspection to the immutable generation already
    // selected by metadata and, for confirmation, by the Firestore lease.
    const [contents] = await admin.storage().bucket()
      .file(objectPath, { generation: inspectedObject.generation })
      .download({ validation: 'crc32c' });
    if (
      contents.length !== inspectedObject.size ||
      safeJpegUploadIssue(contents) != null
    ) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Uploaded media must be a metadata-free JPEG within the size limit'
      );
    }
  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    if (!isStorageNotFound(error)) {
      throw new functions.https.HttpsError(
        'unavailable',
        'Reserved media bytes are temporarily unavailable'
      );
    }
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Reserved media upload is missing'
    );
  }
}

async function assertConfirmedMediaForPublication(
  objectPath: string
): Promise<InspectedMediaObject> {
  // Full JPEG bytes are inspected exactly once while confirmMediaUpload owns
  // the immutable-generation lease. Publication needs only a bounded metadata
  // HEAD; consumeMediaAuthorization then binds this generation and size to the
  // confirmed authorization inside the same transaction as the reference.
  return assertUploadedMediaMetadata(objectPath, {
    requirePrivateMetadata: true,
  });
}

async function normalizeAndVerifyPrivateMediaMetadata(
  objectPath: string,
  inspectedObject: InspectedMediaObject
): Promise<void> {
  const file = admin.storage().bucket().file(objectPath, {
    generation: inspectedObject.generation,
  });
  try {
    await file.setMetadata(
      privateMediaMetadataPatch(inspectedObject.customMetadata),
      {
        preconditionOpts: {
          ifGenerationMatch: inspectedObject.generation,
          ifMetagenerationMatch: inspectedObject.metageneration,
        },
      }
    );
  } catch (error) {
    // Concurrent retries can race on metageneration while applying the same
    // idempotent privacy state. Accept only an exact verified end state.
    const [current] = await file.getMetadata();
    if (!isVerifiedPrivateMediaMetadata(current, inspectedObject)) throw error;
    return;
  }

  // Do not trust the PATCH response alone: re-read the immutable generation and
  // verify the bearer token is absent before publishing the authorization.
  const [verified] = await file.getMetadata();
  if (!isVerifiedPrivateMediaMetadata(verified, inspectedObject)) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Private media metadata normalization could not be verified'
    );
  }
}

function consumeMediaAuthorization(
  tx: admin.firestore.Transaction,
  authorizationSnap: admin.firestore.DocumentSnapshot,
  expected: {
    uid: string;
    kind: 'profile' | 'chat';
    objectPath: string;
    matchId?: string;
  },
  now: admin.firestore.Timestamp,
  consumer: 'completeOnboarding' | 'updateMyProfile' | 'sendMessage',
  inspectedObject: { generation: string; size: number }
): void {
  const issue = confirmedMediaUploadAuthorizationIssue(
    authorizationSnap.exists ? authorizationSnap.data() : undefined,
    expected,
    now.toMillis(),
    inspectedObject.generation,
    inspectedObject.size
  );
  if (issue != null) {
    throw new functions.https.HttpsError(
      issue === 'expired' ? 'deadline-exceeded' : 'failed-precondition',
      `Media upload authorization is invalid: ${issue}`
    );
  }
  tx.update(authorizationSnap.ref, {
    status: 'consumed',
    consumer,
    consumedAt: now,
    expiresAt: admin.firestore.FieldValue.delete(),
    // This ledger is the durable immutable-generation publication proof used
    // by the private read proxy. Do not TTL it while its profile/message path
    // can remain referenced for the life of the product.
    expireAt: admin.firestore.FieldValue.delete(),
    cleanupState: admin.firestore.FieldValue.delete(),
    cleanupLeaseOwner: admin.firestore.FieldValue.delete(),
    cleanupLeaseUntil: admin.firestore.FieldValue.delete(),
    cleanupNextAttemptAt: admin.firestore.FieldValue.delete(),
    cleanupAttempts: admin.firestore.FieldValue.delete(),
    cleanupQuarantineReason: admin.firestore.FieldValue.delete(),
    retirementDeferred: admin.firestore.FieldValue.delete(),
    updatedAt: now,
  });
}

function agoraConfig(): { appId: string; appCertificate: string } {
  const runtimeConfig = functions.config();
  const appId =
    process.env.AGORA_APP_ID ??
    runtimeConfig.agora?.app_id ??
    runtimeConfig.agora?.appid;
  const appCertificate =
    process.env.AGORA_APP_CERTIFICATE ??
    runtimeConfig.agora?.app_certificate ??
    runtimeConfig.agora?.certificate;

  if (typeof appId !== 'string' || appId.length === 0 ||
      typeof appCertificate !== 'string' || appCertificate.length === 0) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Agora is not configured'
    );
  }

  return { appId, appCertificate };
}

async function legacyPrivateMediaCutoverEnabled(): Promise<boolean> {
  const snap = await db
    .collection('privateMediaRolloutControls')
    .doc('legacyFinalizeCleanup')
    .get();
  const data = snap.data();
  return snap.exists &&
    data?.enabled === true &&
    data?.projectId === functionDeployment.projectId &&
    data?.environment === functionDeployment.environment;
}

function agoraUidForFirebaseUid(uid: string): number {
  const digest = createHash('sha256').update(uid).digest();
  return digest.readUInt32BE(0) || 1;
}

const CALL_UNAVAILABLE_MESSAGE = 'Call is unavailable';
const CALL_CLOSED_MESSAGE = 'Call is closed';

function callUnavailableError(): functions.https.HttpsError {
  return new functions.https.HttpsError(
    'permission-denied',
    CALL_UNAVAILABLE_MESSAGE
  );
}

function callClosedError(): functions.https.HttpsError {
  return new functions.https.HttpsError(
    'failed-precondition',
    CALL_CLOSED_MESSAGE
  );
}

function buildAgoraRtcToken(params: {
  appId: string;
  appCertificate: string;
  channelName: string;
  uid: string;
  callType: 'voice' | 'video';
  paidUntilAtMillis: number;
}): { rtcUid: number; token: string; expiresAt: number } {
  const nowMillis = Date.now();
  const lifetimeSeconds = callTokenLifetimeSeconds({
    paidUntilAtMillis: params.paidUntilAtMillis,
    nowMillis,
  });
  if (lifetimeSeconds == null) {
    throw callClosedError();
  }
  const rtcUid = agoraUidForFirebaseUid(params.uid);
  const expiresAt = Math.floor(nowMillis / 1000) + lifetimeSeconds;
  return {
    rtcUid,
    expiresAt,
    token: buildScopedAgoraRtcToken({
      appId: params.appId,
      appCertificate: params.appCertificate,
      channelName: params.channelName,
      uid: rtcUid,
      callType: params.callType,
      lifetimeSeconds,
    }),
  };
}

interface ValidatedCallEntitlement {
  callData: FirebaseFirestore.DocumentData;
  callerUid: string;
  calleeUid: string;
  matchId: string;
  callType: 'voice' | 'video';
  roomName: string;
  ringingExpiresAtMillis: number | null;
  paidUntilAtMillis: number | null;
  callerRef: FirebaseFirestore.DocumentReference;
  calleeRef: FirebaseFirestore.DocumentReference;
  requesterRef: FirebaseFirestore.DocumentReference;
  callerAccountSnap: FirebaseFirestore.DocumentSnapshot;
  calleeAccountSnap: FirebaseFirestore.DocumentSnapshot;
  requesterAccountSnap: FirebaseFirestore.DocumentSnapshot;
  activeCallRef: FirebaseFirestore.DocumentReference;
  now: FirebaseFirestore.Timestamp;
}

async function requireCallEntitlement(
  tx: FirebaseFirestore.Transaction,
  params: {
    callRef: FirebaseFirestore.DocumentReference;
    callId: string;
    requesterUid: string;
    allowedStatuses: readonly JoinableCallStatus[];
    requirePaidEntitlement: boolean;
  }
): Promise<ValidatedCallEntitlement> {
  const callSnap = await tx.get(params.callRef);
  const callData = callSnap.data() ?? {};
  const callerUid = callData.callerUid;
  const calleeUid = callData.calleeUid;
  const matchId = callData.matchId;
  if (
    !callSnap.exists ||
    typeof callerUid !== 'string' ||
    callerUid.length === 0 ||
    typeof calleeUid !== 'string' ||
    calleeUid.length === 0 ||
    callerUid === calleeUid ||
    typeof matchId !== 'string' ||
    matchId.length === 0 ||
    !isExactDirectChatParticipants(
      callData.participantUids,
      [callerUid, calleeUid]
    ) ||
    !callData.participantUids.includes(params.requesterUid)
  ) {
    throw callUnavailableError();
  }

  const callerRef = db.collection('users').doc(callerUid);
  const calleeRef = db.collection('users').doc(calleeUid);
  const matchRef = db.collection('matches').doc(matchId);
  const pairKey = [callerUid, calleeUid].sort().join('_');
  const pairRef = db.collection('chatPairs').doc(pairKey);
  const callerBlockRef = callerRef.collection('blocks').doc(calleeUid);
  const calleeBlockRef = calleeRef.collection('blocks').doc(callerUid);
  const activeCallRef = db.collection('activeCalls').doc(matchId);
  const [
    callerAccountSnap,
    calleeAccountSnap,
    matchSnap,
    pairSnap,
    callerBlockSnap,
    calleeBlockSnap,
    activeCallSnap,
  ] = await Promise.all([
    tx.get(callerRef),
    tx.get(calleeRef),
    tx.get(matchRef),
    tx.get(pairRef),
    tx.get(callerBlockRef),
    tx.get(calleeBlockRef),
    tx.get(activeCallRef),
  ]);
  const matchData = matchSnap.data() ?? {};
  const pairData = pairSnap.data() ?? {};
  const activeCallData = activeCallSnap.data() ?? {};
  const ringingExpiresAtMillis =
    callData.ringingExpiresAt?.toMillis?.() ?? null;
  const paidUntilAtMillis = callData.paidUntilAt?.toMillis?.() ?? null;
  const now = admin.firestore.Timestamp.now();
  const issue = callEntitlementIssue({
    callExists: callSnap.exists,
    callId: params.callId,
    requesterUid: params.requesterUid,
    callerUid,
    calleeUid,
    participantUids: callData.participantUids,
    callMatchId: matchId,
    callType: callData.type,
    roomName: callData.roomName,
    callStatus: callData.status,
    ringingExpiresAtMillis,
    paidUntilAtMillis,
    callerActive: activeAccountIssue({
      exists: callerAccountSnap.exists,
      userData: callerAccountSnap.data(),
    }) === null,
    calleeActive: activeAccountIssue({
      exists: calleeAccountSnap.exists,
      userData: calleeAccountSnap.data(),
    }) === null,
    matchExists: matchSnap.exists,
    matchActive: matchData.isActive === true,
    matchParticipantUids: matchData.userIds,
    matchPairKey: matchData.pairKey,
    matchDirectRoomVersion: matchData.directRoomVersion,
    matchHiddenFor: matchData.hiddenFor,
    pairExists: pairSnap.exists,
    pairId: pairSnap.id,
    pairPairKey: pairData.pairKey,
    pairActiveMatchId: pairData.activeMatchId,
    pairParticipantUids: pairData.userIds,
    pairClosedMatchId: pairData.closedMatchId,
    pairClosedReason: pairData.closedReason,
    callerBlockedCallee: callerBlockSnap.exists,
    calleeBlockedCaller: calleeBlockSnap.exists,
    activeCallExists: activeCallSnap.exists,
    activeCallId: activeCallData.callId,
    activeCallMatchId: activeCallData.matchId,
    activeCallParticipantUids: activeCallData.participantUids,
    activeCallStatus: activeCallData.status,
    allowedStatuses: params.allowedStatuses,
    requirePaidEntitlement: params.requirePaidEntitlement,
    nowMillis: now.toMillis(),
  });
  if (issue === 'closed') throw callClosedError();
  if (issue !== null) throw callUnavailableError();

  const requesterIsCaller = params.requesterUid === callerUid;
  return {
    callData,
    callerUid,
    calleeUid,
    matchId,
    callType: callData.type as 'voice' | 'video',
    roomName: callData.roomName as string,
    ringingExpiresAtMillis,
    paidUntilAtMillis,
    callerRef,
    calleeRef,
    requesterRef: requesterIsCaller ? callerRef : calleeRef,
    callerAccountSnap,
    calleeAccountSnap,
    requesterAccountSnap: requesterIsCaller
      ? callerAccountSnap
      : calleeAccountSnap,
    activeCallRef,
    now,
  };
}

async function notifyIncomingCall(params: {
  callerUid: string;
  callerName: string;
  callId: string;
  matchId: string;
  recipientUid: string;
  type: 'voice' | 'video';
}): Promise<void> {
  let entitlement: ValidatedCallEntitlement;
  try {
    entitlement = await db.runTransaction((tx) => requireCallEntitlement(tx, {
      callRef: db.collection('calls').doc(params.callId),
      callId: params.callId,
      requesterUid: params.callerUid,
      allowedStatuses: ['ringing'],
      requirePaidEntitlement: false,
    }));
  } catch (_) {
    return;
  }
  if (
    entitlement.callerUid !== params.callerUid ||
    entitlement.calleeUid !== params.recipientUid ||
    entitlement.matchId !== params.matchId ||
    entitlement.callData.type !== params.type
  ) return;

  const ringingExpiresAtMillis = entitlement.ringingExpiresAtMillis;
  if (ringingExpiresAtMillis == null) return;
  const notificationTtlMillis = incomingCallNotificationTtlMillis({
    ringingExpiresAtMillis,
    nowMillis: Date.now(),
  });
  if (notificationTtlMillis == null) return;

  const recipientData = entitlement.calleeAccountSnap.data();
  const fcmToken: string | null = recipientData?.fcmToken ?? null;
  const notificationsEnabled: boolean =
    recipientData?.notificationsEnabled ?? true;
  if (!fcmToken || !notificationsEnabled) return;

  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: {
        title: params.callerName,
        body: params.type === 'video'
          ? '영상통화 요청이 왔어요'
          : '음성통화 요청이 왔어요',
      },
      data: {
        type: 'incoming_call',
        callId: params.callId,
        matchId: params.matchId,
        callType: params.type,
        ringingExpiresAt: ringingExpiresAtMillis.toString(),
      },
      android: {
        priority: 'high',
        ttl: notificationTtlMillis,
      },
      apns: {
        headers: {
          'apns-expiration': Math.floor(
            ringingExpiresAtMillis / 1000
          ).toString(),
        },
        payload: {
          aps: {
            sound: 'default',
          },
        },
      },
    });
  } catch (err) {
    console.warn(`Failed to notify incoming call ${params.callId}:`, err);
  }
}

async function notifyNewDirectChat(params: {
  matchId: string;
  senderUid: string;
  recipientUid: string;
}): Promise<void> {
  const access = await readAuthorizedDirectRoomSideEffectContext(params);
  if (access == null) return;
  const { recipientData, senderData } = access;
  const fcmToken: string | null = recipientData?.fcmToken ?? null;
  const notificationsEnabled: boolean =
    recipientData?.notificationsEnabled ?? true;
  if (!fcmToken || !notificationsEnabled) return;

  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: {
        title: senderData.displayName ?? 'Hana',
        body: '새 대화방이 열렸어요',
      },
      data: {
        type: 'chat_created',
        matchId: params.matchId,
      },
      android: {
        priority: 'high',
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
          },
        },
      },
    });
  } catch (err) {
    console.warn(`Failed to notify new chat ${params.matchId}:`, err);
  }
}

function normalizeDisplayName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toLocaleLowerCase('ko-KR').replace(/\s+/g, '');
}

function validateDisplayNameAvailabilityInput(displayName: unknown): string {
  const normalized = normalizeDisplayName(displayName);
  if (normalized.length < 2 || normalized.length > 20) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'displayName must be 2-20 characters'
    );
  }
  return normalized;
}

function toPublicProfile(
  uid: string,
  data: FirebaseFirestore.DocumentData,
  _viewerData?: FirebaseFirestore.DocumentData
): PublicProfile {
  const age = publicAgeFromPrivateProfile(data, new Date());
  if (age == null) {
    throw new Error('Public profile requires a valid date of birth');
  }
  const profile: PublicProfile = {
    uid,
    displayName: data.displayName ?? 'User',
    age,
    gender: data.gender ?? 'female',
    nationality: data.nationality ?? 'KR',
    residingCountry: data.residingCountry ?? 'KR',
    city: data.city ?? '',
    nativeLanguage: data.nativeLanguage ?? '',
    learningLanguage: data.learningLanguage ?? '',
    bio: data.bio ?? '',
    occupation: data.occupation ?? '',
    photoUrls: Array.isArray(data.photoUrls) ? data.photoUrls : [],
    keywords: Array.isArray(data.keywords) ? data.keywords : [],
    relationshipType: data.relationshipType ?? '',
    isOnline: data.isOnline ?? false,
    canTranslate: data.canTranslate ?? true,
    affinityScore:
      typeof data.affinityScore === 'number' ? data.affinityScore : undefined,
    qaItems: Array.isArray(data.qaItems) ? data.qaItems : [],
    likeCount: typeof data.likeCount === 'number' ? data.likeCount : 0,
    avgRating: typeof data.avgRating === 'number' ? data.avgRating : 0,
    ratingCount: typeof data.ratingCount === 'number' ? data.ratingCount : 0,
    lastSeenAt: data.lastSeenAt,
  };
  return profile;
}

type ProfileTextBundle = {
  city: string;
  bio: string;
  occupation: string;
  keywords: string[];
  qaItems: Array<Record<string, string>>;
};

type CachedProfileTranslation = Partial<ProfileTextBundle> & {
  sourceHash?: unknown;
};

function profileTextSource(data: FirebaseFirestore.DocumentData): ProfileTextBundle {
  const qaItems = Array.isArray(data.qaItems)
    ? data.qaItems
        .filter((item: unknown): item is Record<string, unknown> => {
          return item != null && typeof item === 'object' && !Array.isArray(item);
        })
        .map((item) => {
          const normalized: Record<string, string> = {};
          for (const [key, value] of Object.entries(item)) {
            normalized[key] = typeof value === 'string' ? value : String(value ?? '');
          }
          return normalized;
        })
    : [];

  return {
    city: typeof data.city === 'string' ? data.city : '',
    bio: typeof data.bio === 'string' ? data.bio : '',
    occupation: typeof data.occupation === 'string' ? data.occupation : '',
    keywords: Array.isArray(data.keywords)
      ? data.keywords.filter((value: unknown): value is string => typeof value === 'string')
      : [],
    qaItems,
  };
}

function profileTextSourceHash(source: ProfileTextBundle): string {
  return createHash('sha256')
    .update(JSON.stringify({ version: PROFILE_TRANSLATION_CACHE_VERSION, source }))
    .digest('hex');
}

function cachedProfileTranslation(
  data: FirebaseFirestore.DocumentData,
  targetLang: ProfileTranslationTarget,
  sourceHash: string
): CachedProfileTranslation | null {
  const translations = data.profileTranslations;
  if (translations == null || typeof translations !== 'object') return null;
  const cached = (translations as Record<string, unknown>)[targetLang];
  if (cached == null || typeof cached !== 'object') return null;
  const typed = cached as CachedProfileTranslation;
  return typed.sourceHash === sourceHash ? typed : null;
}

function applyProfileTextBundle(
  profile: PublicProfile,
  bundle: Partial<ProfileTextBundle>,
  originalProfileText?: ProfileTextBundle
): PublicProfile {
  return {
    ...profile,
    city: typeof bundle.city === 'string' ? bundle.city : profile.city,
    bio: typeof bundle.bio === 'string' ? bundle.bio : profile.bio,
    occupation:
      typeof bundle.occupation === 'string' ? bundle.occupation : profile.occupation,
    keywords: Array.isArray(bundle.keywords) ? bundle.keywords : profile.keywords,
    qaItems: Array.isArray(bundle.qaItems) ? bundle.qaItems : profile.qaItems,
    originalProfileText,
  };
}

async function translateProfileString(
  value: string,
  targetLang: ProfileTranslationTarget
): Promise<string> {
  const text = value.trim();
  if (text.length === 0 || !hasTranslatableText(text)) return value;
  const phrase = translateProfilePhrase(value, targetLang);
  if (phrase != null) return phrase;
  const playfulFallback = playfulProfileFallback(value, targetLang);
  if (playfulFallback != null) return playfulFallback;
  if (detectLanguage(text) === targetLang) return value;

  try {
    return await callGoogleTranslate(value, targetLang);
  } catch (err) {
    console.warn('Profile field translation failed, using original text:', err);
    return value;
  }
}

async function translateProfileTextBundle(
  source: ProfileTextBundle,
  targetLang: ProfileTranslationTarget
): Promise<ProfileTextBundle> {
  const [city, bio, occupation, keywords, qaItems] = await Promise.all([
    translateProfileString(source.city, targetLang),
    translateProfileString(source.bio, targetLang),
    translateProfileOccupation(source.occupation, targetLang) ??
      translateProfileString(source.occupation, targetLang),
    Promise.all(
      source.keywords.map(
        (keyword) =>
          translateProfileKeyword(keyword, targetLang) ??
          translateProfileString(keyword, targetLang)
      )
    ),
    Promise.all(
      source.qaItems.map(async (item) => {
        const translated: Record<string, string> = {};
        await Promise.all(
          Object.entries(item).map(async ([key, value]) => {
            translated[key] = await translateProfileString(value, targetLang);
          })
        );
        return translated;
      })
    ),
  ]);

  return { city, bio, occupation, keywords, qaItems };
}

async function toLocalizedPublicProfile(
  uid: string,
  data: FirebaseFirestore.DocumentData,
  viewerLang: ProfileTranslationTarget,
  userRef?: FirebaseFirestore.DocumentReference,
  viewerData?: FirebaseFirestore.DocumentData,
  viewerUid?: string
): Promise<PublicProfile> {
  const profile = toPublicProfile(uid, data, viewerData);
  const profileLang = profileLanguage(data);
  if (profileLang === viewerLang) return profile;

  const source = profileTextSource(data);
  const sourceHash = profileTextSourceHash(source);
  const cached = cachedProfileTranslation(data, viewerLang, sourceHash);
  if (cached != null) return applyProfileTextBundle(profile, cached, source);

  const translated = await translateProfileTextBundle(source, viewerLang);
  if (userRef != null && viewerUid != null) {
    const viewerRef = db.collection('users').doc(viewerUid);
    await db.runTransaction(async (tx) => {
      const [freshTarget, freshViewer] = userRef.path === viewerRef.path
        ? await tx.get(userRef).then((snap) => [snap, snap] as const)
        : await Promise.all([tx.get(userRef), tx.get(viewerRef)]);
      const freshTargetData = assertActiveAccountSnapshot(freshTarget, 'Target user');
      assertActiveAccountSnapshot(freshViewer, 'Viewer');
      // Never cache a translation for source text that changed while the API
      // request was in flight.
      if (profileTextSourceHash(profileTextSource(freshTargetData)) !== sourceHash) {
        return;
      }
      tx.set(userRef, {
        profileTranslations: {
          [viewerLang]: {
            ...translated,
            sourceHash,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
      }, { merge: true });
    });
  }
  return applyProfileTextBundle(profile, translated, source);
}

async function assertProfileVisible(
  viewerUid: string,
  targetUid: string,
  viewerData: FirebaseFirestore.DocumentData | undefined,
  targetData: FirebaseFirestore.DocumentData | undefined
) {
  if (!isPublicUserProfile(targetData)) {
    throw new functions.https.HttpsError('not-found', 'Profile not found');
  }

  if (viewerUid === targetUid) return;
  if (!isEligibleExternalProfileViewer(targetData)) {
    throw new functions.https.HttpsError('not-found', 'Profile not found');
  }
  if (!isEligibleExternalProfileViewer(viewerData)) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Complete an adult profile before viewing other users'
    );
  }

  const [viewerBlockSnap, targetBlockSnap] = await Promise.all([
    db.collection('users').doc(viewerUid).collection('blocks').doc(targetUid).get(),
    db.collection('users').doc(targetUid).collection('blocks').doc(viewerUid).get(),
  ]);

  if (viewerBlockSnap.exists || targetBlockSnap.exists) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Profile is not available'
    );
  }
}

function assertEligibleExternalContentViewer(
  viewerData: FirebaseFirestore.DocumentData | undefined
): void {
  if (!isEligibleExternalProfileViewer(viewerData)) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Complete an adult profile before viewing community content'
    );
  }
}

async function hiddenUserSetFor(uid: string): Promise<Set<string>> {
  const blocksSnap = await db.collection('users').doc(uid).collection('blocks').get();

  const hidden = new Set<string>([uid]);
  blocksSnap.docs.forEach((d) => hidden.add(d.id));
  return hidden;
}

async function hasBlockBetween(uidA: string, uidB: string): Promise<boolean> {
  if (uidA === uidB) return false;
  const [aBlocksB, bBlocksA] = await Promise.all([
    db.collection('users').doc(uidA).collection('blocks').doc(uidB).get(),
    db.collection('users').doc(uidB).collection('blocks').doc(uidA).get(),
  ]);
  return aBlocksB.exists || bBlocksA.exists;
}

async function isBlockedByTarget(viewerUid: string, targetUid: string): Promise<boolean> {
  if (viewerUid === targetUid) return false;
  const snap = await db
    .collection('users')
    .doc(targetUid)
    .collection('blocks')
    .doc(viewerUid)
    .get();
  return snap.exists;
}

async function canViewAuthor(viewerUid: string, authorUid: unknown): Promise<boolean> {
  if (typeof authorUid !== 'string' || authorUid.length === 0) return true;
  return !(await hasBlockBetween(viewerUid, authorUid));
}

async function canViewLoungePostAuthor(
  viewerUid: string,
  authorUid: unknown,
  postData?: FirebaseFirestore.DocumentData
): Promise<boolean> {
  if (typeof authorUid !== 'string' || authorUid.length === 0) return false;
  const authorSnap = await db.collection('users').doc(authorUid).get();
  const authorData = authorSnap.data();
  if (
    !isPublicUserProfile(authorData) ||
    !isEligibleExternalProfileViewer(authorData)
  ) return false;
  if (isInternalOrPromotionalLoungeContent(postData, authorData)) return false;
  return canViewAuthor(viewerUid, authorUid);
}

async function assertCanViewLoungePostAuthor(
  viewerUid: string,
  authorUid: unknown,
  postData?: FirebaseFirestore.DocumentData
) {
  if (!(await canViewLoungePostAuthor(viewerUid, authorUid, postData))) {
    throw new functions.https.HttpsError('permission-denied', 'Content unavailable');
  }
}

function isInternalOrPromotionalLoungeContent(
  postData: FirebaseFirestore.DocumentData | undefined,
  authorData: FirebaseFirestore.DocumentData | undefined
): boolean {
  if (postData?.createdAt instanceof admin.firestore.Timestamp) {
    if (postData.createdAt.toMillis() < LOUNGE_LEGACY_CUTOFF.toMillis()) {
      return true;
    }
  }

  const values = [postData, authorData].filter(Boolean) as FirebaseFirestore.DocumentData[];
  if (values.some((data) => isInternalOrTestUser(data))) {
    return true;
  }

  const names = [
    postData?.authorName,
    authorData?.displayName,
    authorData?.nickname,
  ].filter((value): value is string => typeof value === 'string');

  return names.some((name) => {
    const normalized = name.trim().toLowerCase();
    return (
      normalized.includes('운영자') ||
      normalized.includes('관리자') ||
      normalized.includes('operator') ||
      normalized.includes('admin') ||
      normalized === 'hana' ||
      normalized === '하나'
    );
  });
}

function toLoungePost(
  id: string,
  data: FirebaseFirestore.DocumentData,
  isLikedByMe = false
) {
  return {
    id,
    uid: data.uid ?? '',
    authorName: data.authorName ?? 'User',
    authorPhotoUrl: data.authorPhotoUrl ?? '',
    authorNationality: data.authorNationality ?? 'KR',
    authorGender: data.authorGender ?? 'female',
    category: data.category ?? '일상',
    content: data.content ?? '',
    imageUrls: Array.isArray(data.imageUrls) ? data.imageUrls : [],
    likeCount: typeof data.likeCount === 'number' ? data.likeCount : 0,
    commentCount: typeof data.commentCount === 'number' ? data.commentCount : 0,
    createdAt: data.createdAt,
    translatedKo: data.translatedKo,
    translatedJa: data.translatedJa,
    originalLang: data.originalLang,
    isLikedByMe,
  };
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

function hasTranslatableText(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

function normalizeDetectedLanguage(language: unknown): 'ko' | 'ja' | 'unknown' {
  if (typeof language !== 'string') return 'unknown';
  const normalized = language.toLowerCase();
  if (normalized === 'ko' || normalized === 'kor' || normalized === 'ko-kr') {
    return 'ko';
  }
  if (
    normalized === 'ja' ||
    normalized === 'jpn' ||
    normalized === 'ja-jp' ||
    normalized === 'jp'
  ) {
    return 'ja';
  }
  return 'unknown';
}

async function detectLanguageWithApi(text: string): Promise<'ko' | 'ja' | 'unknown'> {
  const heuristic = detectLanguage(text);
  if (heuristic !== 'unknown') return heuristic;
  if (!hasTranslatableText(text)) return 'unknown';

  try {
    const [detections] = await translate.detect(text);
    const firstDetection = Array.isArray(detections) ? detections[0] : detections;
    const apiLanguage = normalizeDetectedLanguage(
      (firstDetection as { language?: unknown } | undefined)?.language
    );
    return apiLanguage === 'unknown' ? heuristic : apiLanguage;
  } catch (err) {
    console.warn('Language detection failed, using heuristic fallback:', err);
    return heuristic;
  }
}

function profileLanguage(
  profile: FirebaseFirestore.DocumentData | undefined,
  fallback: 'ko' | 'ja' = 'ko'
): 'ko' | 'ja' {
  const uiLanguage = profile?.uiLanguage;
  if (uiLanguage === 'ko' || uiLanguage === 'ja') {
    return uiLanguage;
  }

  const nativeLanguage = profile?.nativeLanguage;
  if (nativeLanguage === 'ko' || nativeLanguage === 'ja') {
    return nativeLanguage;
  }

  const nationality = profile?.nationality;
  if (nationality === 'JP') return 'ja';
  if (nationality === 'KR') return 'ko';
  return fallback;
}

function callableViewerProfileLanguage(
  data: unknown,
  viewerProfile: FirebaseFirestore.DocumentData | undefined
): 'ko' | 'ja' {
  const requestedLanguage =
    data != null && typeof data === 'object'
      ? (data as { viewerUiLanguage?: unknown }).viewerUiLanguage
      : undefined;
  return resolveViewerProfileLanguage(
    requestedLanguage,
    profileLanguage(viewerProfile)
  );
}

function oppositeLanguage(language: 'ko' | 'ja' | 'unknown'): 'ko' | 'ja' {
  return language === 'ko' ? 'ja' : 'ko';
}

/**
 * Translate text using Google Cloud Translation API v2.
 * Throws on failure so callers can mark translation state accurately.
 */
async function callGoogleTranslate(text: string, targetLang: 'ko' | 'ja'): Promise<string> {
  try {
    const [translation] = await translate.translate(text, targetLang);
    return translation;
  } catch (err) {
    console.error(`Translation failed for lang=${targetLang}:`, err);
    throw err;
  }
}

async function reserveTranslationQuota(
  uid: string,
  requestCharacters: number,
  now = new Date()
): Promise<void> {
  const { dayKey, minuteKey } = translationQuotaKeys(now);
  const usageRef = db.collection('translationUsage').doc(`${uid}_${dayKey}`);
  const userRef = db.collection('users').doc(uid);

  await db.runTransaction(async (tx) => {
    const [usageSnap, userSnap] = await Promise.all([
      tx.get(usageRef),
      tx.get(userRef),
    ]);
    assertActiveAccountSnapshot(userSnap);
    const decision = decideTranslationQuota({
      current: usageSnap.data(),
      requestCharacters,
      minuteKey,
    });

    if (!decision.allowed) {
      throw new functions.https.HttpsError(
        'resource-exhausted',
        decision.reason === 'minute-request-limit'
          ? 'Translation request rate exceeded'
          : 'Daily translation quota exceeded'
      );
    }

    tx.set(
      usageRef,
      {
        uid,
        dayKey,
        dailyCharacters: decision.dailyCharacters,
        minuteKey: decision.minuteKey,
        minuteRequests: decision.minuteRequests,
        lastRequestCharacters: requestCharacters,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
}

/**
 * Find an active match between two users.
 */
async function findMatch(uidA: string, uidB: string): Promise<string | null> {
  const ids = [uidA, uidB].sort();
  const pairKey = ids.join('_');
  const pairRef = db.collection('chatPairs').doc(pairKey);
  return db.runTransaction(async (tx) => {
    const pairSnap = await tx.get(pairRef);
    const activeMatchId = pairSnap.data()?.activeMatchId;
    if (typeof activeMatchId !== 'string' || activeMatchId.length === 0) {
      return null;
    }
    const matchSnap = await tx.get(
      db.collection('matches').doc(activeMatchId)
    );
    return reusableDirectRoomSnapshots({
      matchId: activeMatchId,
      matchSnap,
      pairSnap,
      expectedUserIds: ids,
      pairKey,
    }) ? activeMatchId : null;
  });
}

type SafetyClosureReason = 'blocked' | 'reported' | 'left_chat';

interface ActiveCallClosureSnapshot {
  pointerRef: FirebaseFirestore.DocumentReference;
  pointerExists: boolean;
  callRef: FirebaseFirestore.DocumentReference | null;
  callData: FirebaseFirestore.DocumentData | null;
  closeCall: boolean;
}

async function readActiveCallClosures(
  tx: FirebaseFirestore.Transaction,
  matchIds: readonly string[],
  expectedUserIds: readonly string[]
): Promise<ActiveCallClosureSnapshot[]> {
  const pointerRefs = matchIds.map((matchId) =>
    db.collection('activeCalls').doc(matchId)
  );
  const pointerSnaps = await Promise.all(pointerRefs.map((ref) => tx.get(ref)));
  const callRefs = pointerSnaps.map((snapshot) => {
    const callId = snapshot.data()?.callId;
    return typeof callId === 'string' && callId.length > 0
      ? db.collection('calls').doc(callId)
      : null;
  });
  const callSnaps = await Promise.all(callRefs.map((ref) =>
    ref == null ? Promise.resolve(null) : tx.get(ref)
  ));

  return pointerSnaps.map((pointerSnap, index) => {
    const callSnap = callSnaps[index];
    const callData = callSnap?.data() ?? null;
    const callUserIds = callData?.participantUids ?? [
      callData?.callerUid,
      callData?.calleeUid,
    ];
    return {
      pointerRef: pointerRefs[index],
      pointerExists: pointerSnap.exists,
      callRef: callRefs[index],
      callData,
      closeCall:
        callSnap?.exists === true &&
        callData?.matchId === matchIds[index] &&
        isExactDirectChatParticipants(callUserIds, expectedUserIds) &&
        (callData?.status === 'ringing' || callData?.status === 'accepted'),
    };
  });
}

function stageActiveCallClosures(
  tx: FirebaseFirestore.Transaction,
  closures: readonly ActiveCallClosureSnapshot[],
  params: {
    actorUid: string;
    closedReason: SafetyClosureReason;
    now: admin.firestore.Timestamp;
  }
): void {
  for (const closure of closures) {
    if (closure.closeCall && closure.callRef != null) {
      const acceptedAtMillis = closure.callData?.acceptedAt?.toMillis?.();
      tx.update(closure.callRef, {
        status: 'ended',
        ...(params.closedReason === 'left_chat'
          ? { endedBy: params.actorUid }
          : { endedBy: admin.firestore.FieldValue.delete() }),
        endedReason: 'room_closed',
        endedAt: params.now,
        ...(typeof acceptedAtMillis === 'number'
          ? {
              durationSec: Math.max(
                0,
                Math.floor((params.now.toMillis() - acceptedAtMillis) / 1000)
              ),
            }
          : {}),
        updatedAt: params.now,
      });
    }
    if (closure.pointerExists) tx.delete(closure.pointerRef);
  }
}

/**
 * Stages every exact-pair room, pair pointer, and current call closure inside
 * the caller's existing block/report transaction. A sentinel aborts the whole
 * safety action instead of leaving a partially hidden relationship.
 */
async function stageAllActivePairSafetyClosures(
  tx: FirebaseFirestore.Transaction,
  params: {
    actorUid: string;
    targetUid: string;
    closedReason: 'blocked' | 'reported';
  }
): Promise<string[]> {
  const userIds = [params.actorUid, params.targetUid].sort();
  const pairKey = userIds.join('_');
  const activeRoomsQuery = db.collection('matches')
    .where('pairKey', '==', pairKey)
    .where('isActive', '==', true)
    .limit(MAX_ACTIVE_PAIR_ROOMS_PER_SAFETY_ACTION + 1);
  const pairPointersQuery = db.collection('chatPairs')
    .where('pairKey', '==', pairKey)
    .limit(MAX_ACTIVE_PAIR_ROOMS_PER_SAFETY_ACTION + 1);
  const canonicalPairRef = db.collection('chatPairs').doc(pairKey);
  const [activeRoomsSnap, pairPointersSnap, canonicalPairSnap] =
    await Promise.all([
      tx.get(activeRoomsQuery),
      tx.get(pairPointersQuery),
      tx.get(canonicalPairRef),
    ]);

  const selectedRooms = activePairRoomIdsForSafety({
    records: activeRoomsSnap.docs.map((doc) => ({
      id: doc.id,
      isActive: doc.data().isActive,
      userIds: doc.data().userIds,
    })),
    actorUid: params.actorUid,
    targetUid: params.targetUid,
  });
  if (
    !selectedRooms.scanComplete ||
    pairPointersSnap.size > MAX_ACTIVE_PAIR_ROOMS_PER_SAFETY_ACTION
  ) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Unable to close every active chat safely'
    );
  }

  if (
    canonicalPairSnap.exists &&
    !isExactDirectChatParticipants(canonicalPairSnap.data()?.userIds, userIds)
  ) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Unable to close every active chat safely'
    );
  }

  const matchIds = selectedRooms.matchIds;
  const matchIdSet = new Set(matchIds);
  const callClosures = await readActiveCallClosures(tx, matchIds, userIds);
  const now = admin.firestore.Timestamp.now();

  for (const matchId of matchIds) {
    tx.update(db.collection('matches').doc(matchId), {
      isActive: false,
      hiddenFor: userIds,
      closedBy: params.actorUid,
      closedReason: params.closedReason,
      closedAt: now,
      updatedAt: now,
    });
  }

  const pointerSnaps = new Map<
    string,
    FirebaseFirestore.DocumentSnapshot
  >(pairPointersSnap.docs.map((snap) => [snap.ref.path, snap]));
  if (canonicalPairSnap.exists) {
    pointerSnaps.set(canonicalPairSnap.ref.path, canonicalPairSnap);
  }
  for (const pointerSnap of pointerSnaps.values()) {
    if (!isExactDirectChatParticipants(pointerSnap.data()?.userIds, userIds)) {
      continue;
    }
    const activeMatchId = pointerSnap.data()?.activeMatchId;
    tx.set(pointerSnap.ref, {
      activeMatchId: admin.firestore.FieldValue.delete(),
      ...(typeof activeMatchId === 'string' && matchIdSet.has(activeMatchId)
        ? {
            closedMatchId: activeMatchId,
            closedReason: params.closedReason,
          }
        : {}),
      updatedAt: now,
    }, { merge: true });
  }

  stageActiveCallClosures(tx, callClosures, {
    actorUid: params.actorUid,
    closedReason: params.closedReason,
    now,
  });
  return matchIds;
}

function reportContentDocumentRefs(
  contentContext: ReportContentContext | null
): FirebaseFirestore.DocumentReference[] {
  if (!contentContext) return [];

  const postRef = db.collection('posts').doc(contentContext.postId);
  if (contentContext.contentType === 'post') return [postRef];

  const commentRef = postRef
    .collection('comments')
    .doc(contentContext.commentId!);
  if (contentContext.contentType === 'comment') {
    return [postRef, commentRef];
  }

  return [
    postRef,
    commentRef,
    commentRef.collection('replies').doc(contentContext.replyId!),
  ];
}

function verifiedReportContentEvidence(params: {
  contentContext: ReportContentContext;
  contentSnaps: FirebaseFirestore.DocumentSnapshot[];
  targetUid: string;
}) {
  const contentIndex = params.contentContext.contentType === 'post'
    ? 0
    : params.contentContext.contentType === 'comment'
      ? 1
      : 2;
  const contentData = params.contentSnaps[contentIndex]?.data() || {};
  const stateIssue = reportContentStateIssue({
    expectedDocumentCount: contentIndex + 1,
    documentStates: params.contentSnaps.map((snap) => ({
      exists: snap.exists,
      deleted: snap.data()?.deleted === true,
    })),
    authorUid: contentData.uid,
    targetUid: params.targetUid,
  });
  if (stateIssue === 'content-unavailable') {
    throw new functions.https.HttpsError(
      'not-found',
      'Reported content is no longer available'
    );
  }
  if (stateIssue === 'author-mismatch') {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Reported content does not belong to the selected user'
    );
  }

  const createdAt = contentData.createdAt instanceof admin.firestore.Timestamp
    ? contentData.createdAt
    : null;
  return buildReportContentEvidence({
    authorUid: contentData.uid,
    content: contentData.content,
    createdAt,
  });
}

function firstPhoto(profile: FirebaseFirestore.DocumentData): string {
  return Array.isArray(profile.photoUrls) && profile.photoUrls.length > 0
    ? profile.photoUrls[0]
    : '';
}

function usersShareNationality(
  first?: FirebaseFirestore.DocumentData,
  second?: FirebaseFirestore.DocumentData
): boolean {
  const firstNationality = typeof first?.nationality === 'string'
    ? first.nationality
    : '';
  const secondNationality = typeof second?.nationality === 'string'
    ? second.nationality
    : '';
  return firstNationality.length > 0 && firstNationality === secondNationality;
}

function messageNeedsTranslationForRecipient(
  originalLang: 'ko' | 'ja' | 'unknown',
  recipientProfile?: FirebaseFirestore.DocumentData
): boolean {
  if (originalLang === 'unknown') return true;
  return originalLang !== profileLanguage(recipientProfile, oppositeLanguage(originalLang));
}

function messageReplyPreview(messageData: FirebaseFirestore.DocumentData): string {
  if (messageData.messageType === 'sticker') return 'Sticker';
  if (messageData.messageType === 'image') return 'Photo';
  const text = typeof messageData.originalText === 'string'
    ? messageData.originalText.trim()
    : '';
  if (text.length <= 80) return text;
  return text.substring(0, 80) + '...';
}

const allowedMessageReactions = ['❤️', '😂', '👍', '😮', '😢', '🙏'];

/**
 * updateFcmToken(data: { token: string }) -> { ok: true }
 *
 * Stores the current device FCM token through a server-owned path so clients do
 * not directly write notification credentials to the public user document. A
 * first-session caller whose profile is not ready receives a retryable,
 * minimal failed-precondition response instead of a false success.
 */
export const updateFcmToken = regionalFunctions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = requireVerifiedCallableUid(context);

    const token = typeof data.token === 'string' ? data.token.trim() : '';
    if (token.length === 0 || token.length > 4096) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'token must be a non-empty string'
      );
    }

    const tokenOwnerRef = db
      .collection('fcmTokenOwners')
      .doc(fcmTokenOwnershipId(token));
    await db.runTransaction(async (tx) => {
      const userRef = db.collection('users').doc(uid);
      const [userSnap, ownerSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(tokenOwnerRef),
      ]);
      const accountIssue = activeAccountIssue({
        exists: userSnap.exists,
        userData: userSnap.data(),
      });
      const retryDetails = retryableFcmRegistrationDetails(accountIssue);
      if (retryDetails != null) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Notification registration is not ready',
          retryDetails
        );
      }
      if (accountIssue === 'banned') {
        throw new functions.https.HttpsError('permission-denied', 'User is banned');
      }
      if (accountIssue === 'deleted') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'User account is being deleted'
        );
      }

      const previousUid = ownerSnap.data()?.uid;
      if (typeof previousUid === 'string' && previousUid !== uid) {
        const previousUserRef = db.collection('users').doc(previousUid);
        const previousUserSnap = await tx.get(previousUserRef);
        if (previousUserSnap.exists && shouldClearOwnedFcmToken({
          storedToken: previousUserSnap.data()?.fcmToken,
          requestedToken: token,
        })) {
          tx.update(previousUserRef, {
            fcmToken: admin.firestore.FieldValue.delete(),
            fcmTokenUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      }

      tx.update(userRef, {
        fcmToken: token,
        fcmTokenUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      tx.set(tokenOwnerRef, {
        uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return { ok: true };
  }
);

/** Detaches only the exact token currently owned by the signed-in account. */
export const detachFcmToken = regionalFunctions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = requireVerifiedCallableUid(context);
    const token = typeof data.token === 'string' ? data.token.trim() : '';
    if (token.length === 0 || token.length > 4096) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'token must be a non-empty string'
      );
    }

    const userRef = db.collection('users').doc(uid);
    const tokenOwnerRef = db
      .collection('fcmTokenOwners')
      .doc(fcmTokenOwnershipId(token));
    await db.runTransaction(async (tx) => {
      const [userSnap, ownerSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(tokenOwnerRef),
      ]);
      if (ownerSnap.data()?.uid !== uid) return;
      if (shouldClearOwnedFcmToken({
        storedToken: userSnap.data()?.fcmToken,
        requestedToken: token,
      })) {
        tx.update(userRef, {
          fcmToken: admin.firestore.FieldValue.delete(),
          fcmTokenUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      tx.delete(tokenOwnerRef);
    });

    return { ok: true };
  }
);

async function notifyChatRemoved(recipientUid: string, matchId: string): Promise<void> {
  const recipientRef = db.collection('users').doc(recipientUid);
  const notificationRef = db
    .collection('users')
    .doc(recipientUid)
    .collection('notifications')
    .doc();
  const recipientData = await db.runTransaction(async (tx) => {
    const recipientSnap = await tx.get(recipientRef);
    if (activeAccountIssue({
      exists: recipientSnap.exists,
      userData: recipientSnap.data(),
    }) !== null) return null;
    tx.create(notificationRef, {
      type: 'chat_removed',
      matchId,
      title: '대화방이 종료되었습니다',
      body: '상대방의 요청으로 1:1 대화방이 종료되었습니다.',
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return recipientSnap.data() ?? {};
  });
  if (recipientData == null) return;

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
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
          },
        },
      },
    });
  } catch (err) {
    console.warn(`Failed to notify chat removal for ${recipientUid}:`, err);
  }
}

async function privateMediaReadAccessIssueFor(
  viewerUid: string,
  objectPath: string
): Promise<string | null> {
  const parsed = parseMediaUploadObjectPath(objectPath);
  if (parsed == null) return 'invalid-path';

  const viewerRef = db.collection('users').doc(viewerUid);
  if (parsed.kind === 'profile') {
    const ownerRef = db.collection('users').doc(parsed.uid);
    const [viewerSnap, ownerSnap, viewerBlockSnap, ownerBlockSnap] =
      await Promise.all([
        viewerRef.get(),
        ownerRef.get(),
        viewerRef.collection('blocks').doc(parsed.uid).get(),
        ownerRef.collection('blocks').doc(viewerUid).get(),
      ]);
    const photoUrls = ownerSnap.data()?.photoUrls;
    const needsOwnerPreviewProof = viewerUid === parsed.uid &&
      (!Array.isArray(photoUrls) || !photoUrls.includes(objectPath));
    const authorizationSnap = needsOwnerPreviewProof
      ? await db
        .collection('mediaUploadAuthorizations')
        .doc(parsed.authorizationId)
        .get()
      : null;
    const authorizationData = authorizationSnap?.data();
    const ownerPreviewAuthorized =
      needsOwnerPreviewProof &&
      authorizationSnap?.exists === true &&
      authorizationData?.uid === parsed.uid &&
      authorizationData?.kind === 'profile' &&
      authorizationData?.objectPath === objectPath &&
      authorizationData?.status === 'confirmed' &&
      authorizationData?.byteCharged === true;
    return profileMediaReadIssue({
      viewerUid,
      ownerUid: parsed.uid,
      objectPath,
      viewerExists: viewerSnap.exists,
      viewerData: viewerSnap.data(),
      ownerExists: ownerSnap.exists,
      ownerData: ownerSnap.data(),
      ownerPreviewAuthorized,
      viewerBlockedOwner: viewerBlockSnap.exists,
      ownerBlockedViewer: ownerBlockSnap.exists,
    });
  }

  const matchRef = db.collection('matches').doc(parsed.matchId!);
  const messageQuery = matchRef
    .collection('messages')
    .where('imagePath', '==', objectPath)
    .limit(1);
  const [matchSnap, messageSnap] = await Promise.all([
    matchRef.get(),
    messageQuery.get(),
  ]);
  const userIds = matchSnap.data()?.userIds;
  if (!isExactDirectChatParticipants(userIds)) {
    return 'invalid-direct-room';
  }
  if (!userIds.includes(viewerUid)) return 'not-participant';
  const otherUid = userIds.find((uid) => uid !== viewerUid)!;
  const firstRef = db.collection('users').doc(userIds[0]);
  const secondRef = db.collection('users').doc(userIds[1]);
  const [viewerSnap, firstSnap, secondSnap, viewerBlockSnap, otherBlockSnap] =
    await Promise.all([
      viewerRef.get(),
      firstRef.get(),
      secondRef.get(),
      viewerRef.collection('blocks').doc(otherUid).get(),
      db.collection('users').doc(otherUid).collection('blocks').doc(viewerUid).get(),
    ]);
  const messageData = messageSnap.docs[0]?.data();
  const messageReferenceExists = !messageSnap.empty &&
    messageData?.messageType === 'image' &&
    messageData?.senderId === parsed.uid;
  return chatMediaReadIssue({
    viewerUid,
    uploaderUid: parsed.uid,
    viewerExists: viewerSnap.exists,
    viewerData: viewerSnap.data(),
    firstParticipantExists: firstSnap.exists,
    firstParticipantData: firstSnap.data(),
    secondParticipantExists: secondSnap.exists,
    secondParticipantData: secondSnap.data(),
    viewerBlockedOther: viewerBlockSnap.exists,
    otherBlockedViewer: otherBlockSnap.exists,
    matchExists: matchSnap.exists,
    matchData: matchSnap.data(),
    messageReferenceExists,
  });
}

interface PrivateMediaGenerationProof {
  generation: string;
  size: number;
}

/**
 * While a resumable upload session can still finish, the retained
 * authorization is the immutable-generation publication proof. A second
 * session for the same path may temporarily become the latest generation
 * before its finalize cleanup runs, so the read proxy must never follow
 * `latest` during this retention window.
 */
async function privateMediaGenerationProofFor(
  objectPath: string
): Promise<PrivateMediaGenerationProof | null> {
  const parsed = parseMediaUploadObjectPath(objectPath);
  if (parsed == null) return null;
  const snap = await db
    .collection('mediaUploadAuthorizations')
    .doc(parsed.authorizationId)
    .get();
  if (!snap.exists) {
    // Authorizations outlive the maximum resumable-session and event-retry
    // window. Once that tombstone expires, no alternate generation can still
    // be published and the current immutable generation is safe to inspect.
    return null;
  }
  const data = snap.data()!;
  const validIdentity =
    data.uid === parsed.uid &&
    data.kind === parsed.kind &&
    data.objectPath === objectPath &&
    (parsed.kind === 'profile' || data.matchId === parsed.matchId);
  const generation = data.confirmedGeneration;
  const size = data.confirmedSize;
  if (
    !validIdentity ||
    (data.status !== 'confirmed' && data.status !== 'consumed') ||
    typeof generation !== 'string' ||
    generation.length === 0 ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > mediaUploadMaxBytes
  ) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Private media is unavailable'
    );
  }
  return { generation, size };
}

interface PrivateMediaReadQuotaContext {
  viewerUid: string;
  dayKey: string;
  minuteKey: string;
  quotaRef: FirebaseFirestore.DocumentReference;
  viewerRef: FirebaseFirestore.DocumentReference;
  expireAt: admin.firestore.Timestamp;
}

function privateMediaReadQuotaContext(
  viewerUid: string
): PrivateMediaReadQuotaContext {
  const now = new Date();
  const { dayKey, minuteKey } = privateMediaReadQuotaKeys(now);
  return {
    viewerUid,
    dayKey,
    minuteKey,
    quotaRef: db
      .collection('privateMediaReadQuotas')
      .doc(`${viewerUid}_${dayKey}`),
    viewerRef: db.collection('users').doc(viewerUid),
    expireAt: admin.firestore.Timestamp.fromMillis(
      now.getTime() + mediaUploadQuotaRetentionMillis
    ),
  };
}

async function chargePrivateMediaReadAttempt(
  quota: PrivateMediaReadQuotaContext
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const [quotaSnap, viewerSnap] = await Promise.all([
      tx.get(quota.quotaRef),
      tx.get(quota.viewerRef),
    ]);
    assertActiveAccountSnapshot(viewerSnap, 'Viewer');
    const next = nextPrivateMediaReadRequestAttemptQuota({
      current: quotaSnap.data(),
      dayKey: quota.dayKey,
      minuteKey: quota.minuteKey,
    });
    if (next == null) {
      throw new functions.https.HttpsError(
        'resource-exhausted',
        'Private media read quota exceeded'
      );
    }
    tx.set(quota.quotaRef, {
      uid: quota.viewerUid,
      dayKey: next.dayKey,
      dailyRequests: next.dailyRequests,
      minuteKey: next.minuteKey,
      minuteRequests: next.minuteRequests,
      expireAt: quota.expireAt,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

async function chargePrivateMediaReadBytes(
  quota: PrivateMediaReadQuotaContext,
  byteLength: number
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const [quotaSnap, viewerSnap] = await Promise.all([
      tx.get(quota.quotaRef),
      tx.get(quota.viewerRef),
    ]);
    assertActiveAccountSnapshot(viewerSnap, 'Viewer');
    const next = nextPrivateMediaReadByteQuota({
      current: quotaSnap.data(),
      dayKey: quota.dayKey,
      byteLength,
    });
    if (next == null) {
      throw new functions.https.HttpsError(
        'resource-exhausted',
        'Private media read quota exceeded'
      );
    }
    tx.set(quota.quotaRef, {
      uid: quota.viewerUid,
      dayKey: next.dayKey,
      dailyBytes: next.dailyBytes,
      expireAt: quota.expireAt,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

// ============================================================================
// CALLABLE FUNCTIONS
// ============================================================================

/**
 * checkDisplayNameAvailability(data: { displayName }) -> { available: boolean }
 */
export const checkDisplayNameAvailability = regionalFunctions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    if (context.app == undefined) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'App Check verification failed'
      );
    }

    const normalized = validateDisplayNameAvailabilityInput(data.displayName);
    const uid = context.auth?.uid;
    const reservation = await db
      .collection('displayNameReservations')
      .doc(normalized)
      .get();

    if (!reservation.exists) {
      return { available: true };
    }

    return { available: reservation.data()?.uid === uid };
  }
);

/**
 * Returns a bounded private JPEG only after fresh Auth, App Check, account,
 * visibility, block, current-profile/message-reference, and active-room checks.
 * Canonical objects never receive a permanent download token, and direct SDK
 * reads stay closed because Storage Rules can inspect at most two Firestore
 * documents without dropping one of those safety conditions.
 */
export const getPrivateMediaBytes = functions.region(FUNCTION_REGION)
  .runWith({ timeoutSeconds: 30, memory: '512MB', maxInstances: 20 })
  .https.onCall(
    async (data: any, context: functions.https.CallableContext) => {
      const viewerUid = requireVerifiedCallableUid(context);
      if (
        data == null ||
        typeof data !== 'object' ||
        Array.isArray(data) ||
        Object.keys(data).length !== 1 ||
        typeof data.path !== 'string' ||
        data.path.length === 0 ||
        data.path.length > 512 ||
        parseMediaUploadObjectPath(data.path) == null
      ) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'path must be one canonical private media path'
        );
      }

      const objectPath = data.path as string;
      // Charge every syntactically valid attempt before any protected profile,
      // block, room, or message reads. Denied-path probing must not bypass the
      // per-minute abuse budget.
      const quota = privateMediaReadQuotaContext(viewerUid);
      await chargePrivateMediaReadAttempt(quota);
      if (await privateMediaReadAccessIssueFor(viewerUid, objectPath) != null) {
        throw new functions.https.HttpsError(
          'permission-denied',
          'Private media is unavailable'
        );
      }

      const generationProof = await privateMediaGenerationProofFor(objectPath);
      const file = generationProof == null
        ? admin.storage().bucket().file(objectPath)
        : admin.storage().bucket().file(objectPath, {
          generation: generationProof.generation,
        });
      let declaredSize: number;
      let generation: string;
      try {
        const [metadata] = await file.getMetadata();
        declaredSize = Number(metadata.size);
        generation = String(metadata.generation ?? '');
        if (
          !Number.isSafeInteger(declaredSize) ||
          declaredSize <= 0 ||
          declaredSize > mediaUploadMaxBytes ||
          generation.length === 0 ||
          (generationProof != null &&
            (generation !== generationProof.generation ||
              declaredSize !== generationProof.size)) ||
          !isVerifiedPrivateMediaMetadata(metadata, {
            generation,
            size: declaredSize,
          })
        ) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            'Private media metadata is invalid'
          );
        }
      } catch (error) {
        if (error instanceof functions.https.HttpsError) throw error;
        throw new functions.https.HttpsError(
          'not-found',
          'Private media was not found'
        );
      }

      // Reserve the declared bytes before the expensive object download. The
      // transaction serializes parallel callers so quota-denied requests do
      // not all consume Storage egress before they are rejected.
      await chargePrivateMediaReadBytes(quota, declaredSize);

      let bytes: Buffer;
      try {
        const pinnedFile = admin.storage().bucket().file(objectPath, {
          generation,
        });
        [bytes] = await pinnedFile.download({ validation: 'crc32c' });
        if (
          bytes.length !== declaredSize ||
          bytes.length > mediaUploadMaxBytes ||
          safeJpegUploadIssue(bytes) != null
        ) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            'Private media content is invalid'
          );
        }
      } catch (error) {
        if (error instanceof functions.https.HttpsError) throw error;
        throw new functions.https.HttpsError(
          'not-found',
          'Private media was not found'
        );
      }

      // Close the Storage I/O window: a block, room closure, ban, or deletion
      // that committed during the download must deny the response.
      if (await privateMediaReadAccessIssueFor(viewerUid, objectPath) != null) {
        throw new functions.https.HttpsError(
          'permission-denied',
          'Private media is unavailable'
        );
      }

      return {
        bytesBase64: bytes.toString('base64'),
        contentType: 'image/jpeg',
        byteLength: bytes.length,
      };
    }
  );

async function reserveMediaUploadForProtocol(
  data: any,
  context: functions.https.CallableContext,
  uploadProtocolVersion: 1 | 2
) {
    const uid = requireVerifiedCallableUid(context);
    const validation = validateReserveMediaUploadRequest(data);
    if (!validation.ok) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        validation.reason
      );
    }

    const request = validation.value;
    const authorizationRef = db.collection('mediaUploadAuthorizations').doc();
    const authorizationId = authorizationRef.id;
    const objectPath = mediaUploadObjectPath({
      uid,
      authorizationId,
      kind: request.kind,
      matchId: request.kind === 'chat' ? request.matchId : undefined,
    });
    const now = admin.firestore.Timestamp.now();
    const expiresAt = admin.firestore.Timestamp.fromMillis(
      now.toMillis() + mediaUploadAuthorizationTtlMillis
    );
    const dayKey = mediaUploadUtcDayKey(now.toDate());
    const quotaRef = db
      .collection('mediaUploadQuotas')
      .doc(mediaUploadQuotaId(uid, dayKey));
    const userRef = db.collection('users').doc(uid);
    const deletionJobRef = db.collection('accountDeletionJobs').doc(uid);

    await db.runTransaction(async (tx) => {
      const matchRef = request.kind === 'chat'
        ? db.collection('matches').doc(request.matchId)
        : null;
      const matchSnap = matchRef == null ? null : await tx.get(matchRef);
      if (matchRef != null && (matchSnap == null || !matchSnap.exists)) {
        throw directRoomUnavailable();
      }

      const matchData = matchSnap?.data();
      const participants = matchData?.userIds;
      let otherUid: string | null = null;
      if (request.kind === 'chat') {
        if (
          !isExactDirectChatParticipants(participants) ||
          !participants.includes(uid) ||
          matchData?.directRoomVersion !== 1 ||
          matchData?.isActive !== true ||
          !Array.isArray(matchData?.hiddenFor) ||
          matchData.hiddenFor.length > 0
        ) {
          throw directRoomUnavailable();
        }
        otherUid = participants.find((participantUid) => participantUid !== uid) ?? null;
        if (otherUid == null) {
          throw directRoomUnavailable();
        }
      }

      const expectedPairKey = request.kind === 'chat' && otherUid != null
        ? [uid, otherUid].sort().join('_')
        : null;
      const pairRef = expectedPairKey == null
        ? null
        : db.collection('chatPairs').doc(expectedPairKey);

      const otherUserRef = otherUid == null
        ? null
        : db.collection('users').doc(otherUid);
      const callerBlockRef = otherUid == null
        ? null
        : userRef.collection('blocks').doc(otherUid);
      const recipientBlockRef = otherUid == null
        ? null
        : otherUserRef!.collection('blocks').doc(uid);
      const [
        userSnap,
        quotaSnap,
        otherUserSnap,
        callerBlockSnap,
        recipientBlockSnap,
        pairSnap,
        deletionJobSnap,
      ] =
        await Promise.all([
          tx.get(userRef),
          tx.get(quotaRef),
          otherUserRef == null ? Promise.resolve(null) : tx.get(otherUserRef),
          callerBlockRef == null ? Promise.resolve(null) : tx.get(callerBlockRef),
          recipientBlockRef == null ? Promise.resolve(null) : tx.get(recipientBlockRef),
          pairRef == null ? Promise.resolve(null) : tx.get(pairRef),
          tx.get(deletionJobRef),
        ]);
      assertNoAccountDeletionJob(deletionJobSnap);

      const accountIssue = activeAccountIssue({
        exists: userSnap.exists,
        userData: userSnap.data(),
      });
      // A first profile photo can be selected before completeOnboarding creates
      // the full profile. Create only a server-owned onboarding shell; chat
      // uploads always require an already-active complete account.
      if (accountIssue === 'missing' && request.kind !== 'profile') {
        throw new functions.https.HttpsError(
          'not-found',
          'User profile not found'
        );
      }
      if (accountIssue === 'banned') {
        throw new functions.https.HttpsError(
          'permission-denied',
          'User is banned'
        );
      }
      if (accountIssue === 'deleted') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'User account is being deleted'
        );
      }

      if (otherUserSnap != null && activeAccountIssue({
        exists: otherUserSnap.exists,
        userData: otherUserSnap.data(),
      }) !== null) {
        throw directRoomUnavailable();
      }
      if (callerBlockSnap?.exists || recipientBlockSnap?.exists) {
        throw directRoomUnavailable();
      }
      if (
        request.kind === 'chat' &&
        (matchData?.pairKey !== expectedPairKey ||
          (uploadProtocolVersion === mediaUploadProtocolVersion
          ? pairSnap?.exists !== true ||
            pairSnap.data()?.pairKey !== expectedPairKey ||
            !isExactDirectChatParticipants(
              pairSnap.data()?.userIds,
              [uid, otherUid!]
            ) ||
            pairSnap.data()?.activeMatchId !== request.matchId ||
            pairSnap.data()?.closedMatchId !== undefined ||
            pairSnap.data()?.closedReason !== undefined
          : pairSnap?.exists === true &&
            pairSnap.data()?.activeMatchId !== request.matchId))
      ) {
        throw directRoomUnavailable();
      }

      const countField = request.kind === 'profile'
        ? 'profileCount'
        : 'chatCount';
      const nextCount = nextMediaUploadQuotaCount({
        kind: request.kind,
        existingDayKey: quotaSnap.data()?.dayKey,
        existingCount: quotaSnap.data()?.[countField],
        requestedDayKey: dayKey,
      });
      if (nextCount == null) {
        throw new functions.https.HttpsError(
          'resource-exhausted',
          `Daily ${request.kind} media upload limit reached`
        );
      }

      // Both retained V1 and V2 reservation endpoints are server-owned. While
      // V1 remains supported during the reviewed transition, a first profile
      // upload through either endpoint must produce the same exact one-use
      // onboarding shell; otherwise a legacy client can create an incomplete
      // user document that completeOnboarding can never safely recognize.
      const isProfileUpload = request.kind === 'profile';
      if (!userSnap.exists) {
        tx.create(userRef, {
          uid,
          accountStatus: 'onboarding',
          onboardingCompleted: false,
          // Only this source-identified shell may bootstrap onboarding points.
          ...(isProfileUpload
            ? {
                onboardingShellProvenance:
                  profileUploadOnboardingShellProvenance,
              }
            : {}),
          createdAt: now,
          updatedAt: now,
        });
      }
      tx.set(quotaRef, {
        uid,
        dayKey,
        [countField]: nextCount,
        expireAt: admin.firestore.Timestamp.fromMillis(
          now.toMillis() + mediaUploadQuotaRetentionMillis
        ),
        updatedAt: now,
      }, { merge: true });
      tx.create(authorizationRef, {
        authorizationId,
        uid,
        kind: request.kind,
        matchId: request.kind === 'chat' ? request.matchId : null,
        objectPath,
        contentType: 'image/jpeg',
        maxBytes: mediaUploadMaxBytes,
        ...(uploadProtocolVersion === mediaUploadProtocolVersion
          ? { uploadProtocolVersion: mediaUploadProtocolVersion }
          : {}),
        status: 'reserved',
        quotaDayKey: dayKey,
        quotaId: quotaRef.id,
        createdAt: now,
        expiresAt,
      });
    });

    return {
      authorizationId,
      path: objectPath,
      expiresAtMillis: expiresAt.toMillis(),
      maxBytes: mediaUploadMaxBytes,
      ...(uploadProtocolVersion === mediaUploadProtocolVersion
        ? { uploadProtocolVersion: mediaUploadProtocolVersion }
        : {}),
    };
}

/**
 * Legacy protocol V1 reservation. Production transitional rules may continue
 * accepting this exact no-version authorization while an old client remains
 * supported. Never change this endpoint in place to V2.
 */
export const reserveMediaUpload = regionalFunctions.https.onCall(
  (data: any, context: functions.https.CallableContext) =>
    reserveMediaUploadForProtocol(data, context, 1)
);

/**
 * Protocol V2 reservation for uploadPrivateMediaBytes. Its authorization is
 * explicitly versioned and is never a direct client Storage capability.
 */
export const reserveMediaUploadV2 = functions.region(FUNCTION_REGION)
  .runWith({ enforceAppCheck: true })
  .https.onCall(
    (data: any, context: functions.https.CallableContext) =>
      reserveMediaUploadForProtocol(data, context, mediaUploadProtocolVersion)
  );

type ServerMediaObjectInspection =
  | { state: 'missing' }
  | { state: 'invalid'; generation: string | null }
  | { state: 'valid'; object: InspectedMediaObject };

function serverMediaUploadLeaseUntilMillis(data: unknown): number | null {
  if (!(data instanceof admin.firestore.Timestamp)) return null;
  return data.toMillis();
}

function isServerStorageNotFound(error: unknown): boolean {
  const storageError = error as {
    code?: unknown;
    response?: { statusCode?: unknown };
  };
  return Number(storageError.code ?? storageError.response?.statusCode) === 404;
}

function isServerStoragePreconditionFailure(error: unknown): boolean {
  const storageError = error as {
    code?: unknown;
    response?: { statusCode?: unknown };
  };
  return Number(storageError.code ?? storageError.response?.statusCode) === 412;
}

async function inspectServerUploadedMediaObject(
  objectPath: string,
  marker: ServerMediaUploadMarker
): Promise<ServerMediaObjectInspection> {
  let metadata: Record<string, any>;
  try {
    [metadata] = await admin.storage().bucket().file(objectPath).getMetadata();
  } catch (error) {
    if (isServerStorageNotFound(error)) return { state: 'missing' };
    throw new functions.https.HttpsError(
      'unavailable',
      'Server media object metadata is unavailable'
    );
  }
  const generation = typeof metadata.generation === 'string' &&
      metadata.generation.length > 0
    ? metadata.generation
    : null;
  const metageneration = typeof metadata.metageneration === 'string' &&
      metadata.metageneration.length > 0
    ? metadata.metageneration
    : null;
  const size = Number(metadata.size);
  const customMetadata = { ...(metadata.metadata ?? {}) };
  if (
    generation == null ||
    metageneration == null ||
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > mediaUploadMaxBytes ||
    !isVerifiedPrivateMediaMetadata(metadata, { generation, size }) ||
    !hasExactServerMediaUploadMarker(customMetadata, marker)
  ) {
    return { state: 'invalid', generation };
  }
  return {
    state: 'valid',
    object: { generation, metageneration, size, customMetadata },
  };
}

async function chargeServerMediaUploadAttempt(
  tx: admin.firestore.Transaction,
  authorizationData: admin.firestore.DocumentData,
  uid: string
): Promise<void> {
  const quotaId = authorizationData.quotaId;
  const quotaDayKey = authorizationData.quotaDayKey;
  if (typeof quotaId !== 'string' || typeof quotaDayKey !== 'string') {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Media upload quota ledger is unavailable'
    );
  }
  const quotaRef = db.collection('mediaUploadQuotas').doc(quotaId);
  const quotaSnap = await tx.get(quotaRef);
  const quotaData = quotaSnap.data();
  if (
    !quotaSnap.exists ||
    quotaData?.uid !== uid ||
    quotaData.dayKey !== quotaDayKey
  ) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Media upload quota ledger does not match the authorization'
    );
  }
  const nextAttempts = nextMediaUploadConfirmAttempt({
    existingDayKey: quotaData.dayKey,
    existingAttempts: quotaData.confirmAttempts,
    requestedDayKey: quotaDayKey,
  });
  if (nextAttempts == null) {
    throw new functions.https.HttpsError(
      'resource-exhausted',
      'Daily media upload attempt limit reached'
    );
  }
  tx.set(quotaRef, {
    uid,
    dayKey: quotaDayKey,
    confirmAttempts: nextAttempts,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function chargeServerMediaUploadRequestAttempt(uid: string): Promise<void> {
  const now = admin.firestore.Timestamp.now();
  const dayKey = mediaUploadUtcDayKey(now.toDate());
  const quotaRef = db
    .collection('mediaUploadRequestQuotas')
    .doc(mediaUploadQuotaId(uid, dayKey));
  const userRef = db.collection('users').doc(uid);
  const deletionJobRef = db.collection('accountDeletionJobs').doc(uid);
  await db.runTransaction(async (tx) => {
    const [quotaSnap, userSnap, deletionJobSnap] = await Promise.all([
      tx.get(quotaRef),
      tx.get(userRef),
      tx.get(deletionJobRef),
    ]);
    assertActiveAccountSnapshot(userSnap);
    assertNoAccountDeletionJob(deletionJobSnap);
    const nextAttempts = nextMediaUploadServerRequestAttempt({
      existingDayKey: quotaSnap.data()?.dayKey,
      existingAttempts: quotaSnap.data()?.attempts,
      requestedDayKey: dayKey,
    });
    if (nextAttempts == null) {
      throw new functions.https.HttpsError(
        'resource-exhausted',
        'Daily private media upload request limit reached'
      );
    }
    tx.set(quotaRef, {
      uid,
      dayKey,
      attempts: nextAttempts,
      expireAt: admin.firestore.Timestamp.fromMillis(
        now.toMillis() + mediaUploadQuotaRetentionMillis
      ),
      updatedAt: now,
    }, { merge: true });
  });
}

async function rejectInvalidServerMediaPayload(input: {
  authorizationRef: admin.firestore.DocumentReference;
  uid: string;
  marker: ServerMediaUploadMarker;
}): Promise<void> {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(input.authorizationRef);
    const data = snap.data();
    if (
      !snap.exists ||
      data?.status !== 'server_uploading' ||
      data.uid !== input.uid ||
      data.serverUploadLeaseOwner !== input.marker.leaseOwner ||
      data.serverUploadDigest !== input.marker.payloadDigest
    ) {
      return;
    }
    tx.update(input.authorizationRef, {
      status: 'rejected',
      rejectionReason: 'invalid_server_jpeg',
      serverUploadLeaseOwner: admin.firestore.FieldValue.delete(),
      serverUploadLeaseUntil: admin.firestore.FieldValue.delete(),
      serverUploadRecoveryOwner: admin.firestore.FieldValue.delete(),
      expiresAt: admin.firestore.FieldValue.delete(),
      expireAt: admin.firestore.Timestamp.fromMillis(
        Date.now() + mediaUploadQuotaRetentionMillis
      ),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
}

async function queueServerMediaObjectCleanup(input: {
  authorizationRef: admin.firestore.DocumentReference;
  uid: string;
  marker: ServerMediaUploadMarker;
  recoveryOwner?: string;
  generation: string;
  reason: string;
}): Promise<void> {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(input.authorizationRef);
    const data = snap.data();
    if (
      !snap.exists ||
      data?.status !== 'server_uploading' ||
      data.uid !== input.uid ||
      data.serverUploadLeaseOwner !== input.marker.leaseOwner ||
      data.serverUploadDigest !== input.marker.payloadDigest ||
      (input.recoveryOwner == null
        ? data.serverUploadRecoveryOwner != null
        : data.serverUploadRecoveryOwner !== input.recoveryOwner)
    ) {
      return;
    }
    tx.update(input.authorizationRef, {
      status: 'cleanup_required',
      cleanupSourceStatus: 'server_uploading',
      cleanupGeneration: input.generation,
      cleanupState: 'pending',
      cleanupAttempts: 0,
      cleanupNextAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
      rejectionReason: input.reason,
      serverUploadLeaseOwner: admin.firestore.FieldValue.delete(),
      serverUploadLeaseUntil: admin.firestore.FieldValue.delete(),
      serverUploadRecoveryOwner: admin.firestore.FieldValue.delete(),
      expiresAt: admin.firestore.FieldValue.delete(),
      expireAt: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
}

async function finalizeServerMediaUpload(input: {
  authorizationRef: admin.firestore.DocumentReference;
  uid: string;
  marker: ServerMediaUploadMarker;
  recoveryOwner?: string;
  inspectedObject: InspectedMediaObject;
}): Promise<'confirmed' | 'already-confirmed' | 'byte-quota-exceeded'> {
  const userRef = db.collection('users').doc(input.uid);
  const deletionJobRef = db.collection('accountDeletionJobs').doc(input.uid);
  return db.runTransaction(async (tx) => {
    const [authorizationSnap, userSnap, deletionJobSnap] = await Promise.all([
      tx.get(input.authorizationRef),
      tx.get(userRef),
      tx.get(deletionJobRef),
    ]);
    assertActiveAccountSnapshot(userSnap);
    assertNoAccountDeletionJob(deletionJobSnap);
    const data = authorizationSnap.data();
    if (
      data?.status === 'confirmed' &&
      data.uid === input.uid &&
      data.uploadProtocolVersion === mediaUploadProtocolVersion &&
      data.serverUploadDigest === input.marker.payloadDigest &&
      data.byteCharged === true &&
      data.confirmedGeneration === input.inspectedObject.generation &&
      data.confirmedSize === input.inspectedObject.size
    ) {
      return 'already-confirmed' as const;
    }
    if (
      !authorizationSnap.exists ||
      data?.status !== 'server_uploading' ||
      data.uid !== input.uid ||
      data.uploadProtocolVersion !== mediaUploadProtocolVersion ||
      data.serverUploadLeaseOwner !== input.marker.leaseOwner ||
      data.serverUploadDigest !== input.marker.payloadDigest ||
      serverMediaUploadLeaseUntilMillis(data.serverUploadLeaseUntil) == null ||
      serverMediaUploadLeaseUntilMillis(data.serverUploadLeaseUntil)! <= Date.now() ||
      !(data.expiresAt instanceof admin.firestore.Timestamp) ||
      data.expiresAt.toMillis() <= Date.now() ||
      (input.recoveryOwner == null
        ? data.serverUploadRecoveryOwner != null
        : data.serverUploadRecoveryOwner !== input.recoveryOwner)
    ) {
      throw new functions.https.HttpsError(
        'aborted',
        'Server media upload lease changed'
      );
    }
    const parsed = parseMediaUploadObjectPath(data.objectPath);
    if (
      parsed == null ||
      parsed.authorizationId !== input.authorizationRef.id ||
      parsed.uid !== input.uid
    ) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Server media upload authorization is invalid'
      );
    }
    if (parsed.kind === 'chat') {
      await assertActiveMediaUploadRoom(tx, input.uid, parsed.matchId!);
    }
    const quotaId = data.quotaId;
    const quotaDayKey = data.quotaDayKey;
    if (typeof quotaId !== 'string' || typeof quotaDayKey !== 'string') {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Media upload quota ledger is unavailable'
      );
    }
    const quotaRef = db.collection('mediaUploadQuotas').doc(quotaId);
    const quotaSnap = await tx.get(quotaRef);
    if (
      !quotaSnap.exists ||
      quotaSnap.data()?.uid !== input.uid ||
      quotaSnap.data()?.dayKey !== quotaDayKey
    ) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Media upload quota ledger does not match the authorization'
      );
    }
    const byteField = parsed.kind === 'profile' ? 'profileBytes' : 'chatBytes';
    const nextBytes = nextMediaUploadQuotaBytes({
      kind: parsed.kind,
      existingDayKey: quotaSnap.data()?.dayKey,
      existingBytes: quotaSnap.data()?.[byteField],
      requestedDayKey: quotaDayKey,
      uploadedBytes: input.inspectedObject.size,
    });
    if (nextBytes == null) {
      tx.update(input.authorizationRef, {
        status: 'cleanup_required',
        cleanupSourceStatus: 'server_uploading',
        cleanupGeneration: input.inspectedObject.generation,
        cleanupState: 'pending',
        cleanupAttempts: 0,
        cleanupNextAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
        rejectionReason: 'daily_byte_quota_exceeded',
        serverUploadLeaseOwner: admin.firestore.FieldValue.delete(),
        serverUploadLeaseUntil: admin.firestore.FieldValue.delete(),
        serverUploadRecoveryOwner: admin.firestore.FieldValue.delete(),
        expiresAt: admin.firestore.FieldValue.delete(),
        expireAt: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return 'byte-quota-exceeded' as const;
    }
    const now = admin.firestore.Timestamp.now();
    tx.set(quotaRef, {
      [byteField]: nextBytes,
      updatedAt: now,
    }, { merge: true });
    tx.update(input.authorizationRef, {
      status: 'confirmed',
      byteCharged: true,
      confirmedGeneration: input.inspectedObject.generation,
      confirmedSize: input.inspectedObject.size,
      confirmedAt: now,
      expiresAt: admin.firestore.Timestamp.fromMillis(
        now.toMillis() + mediaUploadPublicationTtlMillis
      ),
      expireAt: admin.firestore.FieldValue.delete(),
      serverUploadLeaseOwner: admin.firestore.FieldValue.delete(),
      serverUploadLeaseUntil: admin.firestore.FieldValue.delete(),
      serverUploadRecoveryOwner: admin.firestore.FieldValue.delete(),
      updatedAt: now,
    });
    return 'confirmed' as const;
  });
}

function finalizedServerUploadContext(
  metadata: Record<string, unknown> | undefined,
  nowMillis: number
): FinalizedServerUploadContext | undefined {
  const leaseOwner = metadata?.hanaServerUploadLeaseOwner;
  const payloadDigest = metadata?.hanaServerUploadDigest;
  const marker = {
    leaseOwner: typeof leaseOwner === 'string' ? leaseOwner : '',
    payloadDigest: typeof payloadDigest === 'string' ? payloadDigest : '',
  };
  if (!hasExactServerMediaUploadMarker(metadata, marker)) return undefined;
  return {
    nowMillis,
    protocolVersion: mediaUploadProtocolVersion,
    leaseOwner: marker.leaseOwner,
    payloadDigest: marker.payloadDigest,
  };
}

function serverMediaUploadMarkerFromAuthorization(
  data: FirebaseFirestore.DocumentData
): ServerMediaUploadMarker | null {
  const marker = {
    leaseOwner: typeof data.serverUploadLeaseOwner === 'string'
      ? data.serverUploadLeaseOwner
      : '',
    payloadDigest: typeof data.serverUploadDigest === 'string'
      ? data.serverUploadDigest
      : '',
  };
  try {
    serverMediaUploadCustomMetadata(marker);
    return marker;
  } catch (_) {
    return null;
  }
}

async function recoverExpiredServerMediaUpload(input: {
  authorizationRef: admin.firestore.DocumentReference;
  uid: string;
  marker: ServerMediaUploadMarker;
}): Promise<'confirmed' | 'reset' | 'cleaning' | 'unchanged'> {
  const recoveryOwner = randomUUID();
  const claim = await db.runTransaction(async (tx) => {
    const snap = await tx.get(input.authorizationRef);
    const data = snap.data();
    const leaseUntilMillis = serverMediaUploadLeaseUntilMillis(
      data?.serverUploadLeaseUntil
    );
    if (
      !snap.exists ||
      data?.status !== 'server_uploading' ||
      leaseUntilMillis == null ||
      leaseUntilMillis > Date.now()
    ) {
      return null;
    }
    if (
      data.uid !== input.uid ||
      data.uploadProtocolVersion !== mediaUploadProtocolVersion ||
      data.serverUploadLeaseOwner !== input.marker.leaseOwner ||
      data.serverUploadDigest !== input.marker.payloadDigest
    ) {
      tx.update(input.authorizationRef, {
        status: 'cleanup_quarantined',
        cleanupState: 'quarantined',
        cleanupQuarantineReason: 'invalid_server_upload_recovery_proof',
        serverUploadLeaseOwner: admin.firestore.FieldValue.delete(),
        serverUploadLeaseUntil: admin.firestore.FieldValue.delete(),
        serverUploadRecoveryOwner: admin.firestore.FieldValue.delete(),
        expiresAt: admin.firestore.FieldValue.delete(),
        expireAt: admin.firestore.FieldValue.delete(),
        quarantinedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { state: 'quarantined' as const };
    }
    const parsed = parseMediaUploadObjectPath(data.objectPath);
    if (
      parsed == null ||
      parsed.authorizationId !== input.authorizationRef.id ||
      parsed.uid !== input.uid
    ) {
      tx.update(input.authorizationRef, {
        status: 'cleanup_quarantined',
        cleanupState: 'quarantined',
        cleanupQuarantineReason: 'invalid_server_upload_path',
        serverUploadLeaseOwner: admin.firestore.FieldValue.delete(),
        serverUploadLeaseUntil: admin.firestore.FieldValue.delete(),
        serverUploadRecoveryOwner: admin.firestore.FieldValue.delete(),
        expiresAt: admin.firestore.FieldValue.delete(),
        expireAt: admin.firestore.FieldValue.delete(),
        quarantinedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { state: 'quarantined' as const };
    }
    const now = admin.firestore.Timestamp.now();
    const expired = !(data.expiresAt instanceof admin.firestore.Timestamp) ||
      data.expiresAt.toMillis() <= now.toMillis();
    tx.update(input.authorizationRef, {
      serverUploadRecoveryOwner: recoveryOwner,
      serverUploadLeaseUntil: admin.firestore.Timestamp.fromMillis(
        now.toMillis() + serverMediaUploadLeaseMillis
      ),
      updatedAt: now,
    });
    return {
      state: 'claimed' as const,
      objectPath: data.objectPath as string,
      expiresAt: data.expiresAt,
      expired,
    };
  });
  if (claim == null) return 'unchanged';
  if (claim.state === 'quarantined') return 'cleaning';

  const inspected = await inspectServerUploadedMediaObject(
    claim.objectPath,
    input.marker
  );
  if (inspected.state === 'missing') {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(input.authorizationRef);
      const data = snap.data();
      if (
        !snap.exists ||
        data?.status !== 'server_uploading' ||
        data.serverUploadLeaseOwner !== input.marker.leaseOwner ||
        data.serverUploadDigest !== input.marker.payloadDigest ||
        data.serverUploadRecoveryOwner !== recoveryOwner
      ) {
        return 'unchanged' as const;
      }
      const now = admin.firestore.Timestamp.now();
      const mayRetry = data.expiresAt instanceof admin.firestore.Timestamp &&
        data.expiresAt.toMillis() > now.toMillis();
      tx.update(input.authorizationRef, mayRetry
        ? {
            status: 'reserved',
            serverUploadLeaseOwner: admin.firestore.FieldValue.delete(),
            serverUploadLeaseUntil: admin.firestore.FieldValue.delete(),
            serverUploadRecoveryOwner: admin.firestore.FieldValue.delete(),
            updatedAt: now,
          }
        : {
            status: 'expired_without_object',
            rejectionReason: 'server_upload_expired_without_object',
            serverUploadLeaseOwner: admin.firestore.FieldValue.delete(),
            serverUploadLeaseUntil: admin.firestore.FieldValue.delete(),
            serverUploadRecoveryOwner: admin.firestore.FieldValue.delete(),
            expiresAt: admin.firestore.FieldValue.delete(),
            expireAt: admin.firestore.Timestamp.fromMillis(
              now.toMillis() + mediaUploadLateFinalizeRetentionMillis
            ),
            updatedAt: now,
          });
      return mayRetry ? 'reset' as const : 'cleaning' as const;
    });
  }
  if (inspected.state === 'invalid') {
    if (inspected.generation == null) {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(input.authorizationRef);
        if (
          snap.exists &&
          snap.data()?.status === 'server_uploading' &&
          snap.data()?.serverUploadRecoveryOwner === recoveryOwner
        ) {
          tx.update(input.authorizationRef, {
            status: 'cleanup_quarantined',
            cleanupState: 'quarantined',
            cleanupQuarantineReason: 'server_upload_generation_unavailable',
            expiresAt: admin.firestore.FieldValue.delete(),
            expireAt: admin.firestore.FieldValue.delete(),
            quarantinedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      });
      return 'cleaning';
    }
    await queueServerMediaObjectCleanup({
      authorizationRef: input.authorizationRef,
      uid: input.uid,
      marker: input.marker,
      recoveryOwner,
      generation: inspected.generation,
      reason: 'server_upload_marker_or_metadata_mismatch',
    });
    return 'cleaning';
  }

  if (claim.expired) {
    await queueServerMediaObjectCleanup({
      authorizationRef: input.authorizationRef,
      uid: input.uid,
      marker: input.marker,
      recoveryOwner,
      generation: inspected.object.generation,
      reason: 'server_upload_authorization_expired',
    });
    return 'cleaning';
  }

  try {
    await assertUploadedMediaContents(claim.objectPath, inspected.object);
    const finalState = await finalizeServerMediaUpload({
      authorizationRef: input.authorizationRef,
      uid: input.uid,
      marker: input.marker,
      recoveryOwner,
      inspectedObject: inspected.object,
    });
    if (finalState === 'byte-quota-exceeded') return 'cleaning';
    return 'confirmed';
  } catch (error) {
    const callableCode = error instanceof functions.https.HttpsError
      ? error.code
      : null;
    if (shouldCleanupServerMediaAfterFailure(callableCode)) {
      await queueServerMediaObjectCleanup({
        authorizationRef: input.authorizationRef,
        uid: input.uid,
        marker: input.marker,
        recoveryOwner,
        generation: inspected.object.generation,
        reason: 'server_upload_recovery_failed',
      });
    }
    throw error;
  }
}

/**
 * Uploads one authorization-bound JPEG through a single Auth + App Check
 * callable. Canonical paths are never writable through the client Storage SDK.
 */
export const uploadPrivateMediaBytes = functions.region(FUNCTION_REGION)
  .runWith({
    timeoutSeconds: 120,
    memory: '1GB',
    maxInstances: 20,
    enforceAppCheck: true,
    consumeAppCheckToken: true,
  })
  .https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = requireVerifiedCallableUid(context);
    if (context.app?.alreadyConsumed === true) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'App Check limited-use token was already consumed'
      );
    }
    // Charge immediately after callable identity verification, before any
    // request-shape/base64 scan or arbitrary authorization lookup.
    await chargeServerMediaUploadRequestAttempt(uid);
    const validation = validateServerMediaUploadRequest(data);
    if (!validation.ok) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        validation.reason
      );
    }
    const request = validation.value;
    const payloadDigest = serverMediaUploadPayloadDigest(request.jpegBase64);
    let marker: ServerMediaUploadMarker = {
      leaseOwner: randomUUID(),
      payloadDigest,
    };
    const authorizationRef = db
      .collection('mediaUploadAuthorizations')
      .doc(request.authorizationId);
    const userRef = db.collection('users').doc(uid);
    const deletionJobRef = db.collection('accountDeletionJobs').doc(uid);

    const preflight = await db.runTransaction(async (tx) => {
      const [authorizationSnap, userSnap, deletionJobSnap] = await Promise.all([
        tx.get(authorizationRef),
        tx.get(userRef),
        tx.get(deletionJobRef),
      ]);
      assertActiveAccountSnapshot(userSnap);
      assertNoAccountDeletionJob(deletionJobSnap);
      const authorizationData = authorizationSnap.data();
      const objectPath = authorizationData?.objectPath;
      const parsed = parseMediaUploadObjectPath(objectPath);
      if (
        !authorizationSnap.exists ||
        parsed == null ||
        parsed.authorizationId !== request.authorizationId ||
        parsed.uid !== uid ||
        authorizationData?.uid !== uid ||
        authorizationData.uploadProtocolVersion !== mediaUploadProtocolVersion
      ) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Media upload authorization does not match the caller or protocol'
        );
      }
      const expected = {
        uid,
        kind: parsed.kind,
        objectPath,
        matchId: parsed.matchId,
      };
      if (parsed.kind === 'chat') {
        // Even an idempotent full-body replay must not bypass a block/leave
        // committed after reservation. Status-only recovery remains available
        // through confirmMediaUpload without re-sending the JPEG.
        await assertActiveMediaUploadRoom(tx, uid, parsed.matchId!);
      }
      if (
        (authorizationData.status === 'confirmed' ||
          authorizationData.status === 'consumed') &&
        authorizationData.byteCharged === true &&
        typeof authorizationData.confirmedGeneration === 'string' &&
        Number.isSafeInteger(authorizationData.confirmedSize) &&
        authorizationData.serverUploadDigest === payloadDigest
      ) {
        return { state: 'already-confirmed' as const, objectPath };
      }
      if (authorizationData.status === 'server_uploading') {
        const issue = mediaUploadAuthorizationIssue(
          authorizationData,
          expected,
          Date.now(),
          ['server_uploading']
        );
        if (issue != null) {
          throw new functions.https.HttpsError(
            issue === 'expired' ? 'deadline-exceeded' : 'failed-precondition',
            `Media upload authorization is invalid: ${issue}`
          );
        }
        if (authorizationData.serverUploadDigest !== payloadDigest) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            'A different payload already owns this media authorization'
          );
        }
        const existingLeaseOwner = authorizationData.serverUploadLeaseOwner;
        const leaseUntilMillis = serverMediaUploadLeaseUntilMillis(
          authorizationData.serverUploadLeaseUntil
        );
        if (
          typeof existingLeaseOwner !== 'string' ||
          leaseUntilMillis == null
        ) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            'Server media upload lease is invalid'
          );
        }
        if (leaseUntilMillis > Date.now()) {
          throw new functions.https.HttpsError(
            'aborted',
            'Server media upload is still in progress'
          );
        }
        return {
          state: 'recover' as const,
          objectPath,
          marker: {
            leaseOwner: existingLeaseOwner,
            payloadDigest,
          },
        };
      }
      const issue = mediaUploadAuthorizationIssue(
        authorizationData,
        expected,
        Date.now()
      );
      if (issue != null) {
        throw new functions.https.HttpsError(
          issue === 'expired' ? 'deadline-exceeded' : 'failed-precondition',
          `Media upload authorization is invalid: ${issue}`
        );
      }
      await chargeServerMediaUploadAttempt(tx, authorizationData, uid);
      const now = admin.firestore.Timestamp.now();
      tx.update(authorizationRef, {
        status: 'server_uploading',
        uploadProtocolVersion: mediaUploadProtocolVersion,
        serverUploadLeaseOwner: marker.leaseOwner,
        serverUploadLeaseUntil: admin.firestore.Timestamp.fromMillis(
          now.toMillis() + serverMediaUploadLeaseMillis
        ),
        serverUploadDigest: payloadDigest,
        serverUploadAttempts: 1,
        serverUploadStartedAt: now,
        expiresAt: admin.firestore.Timestamp.fromMillis(
          now.toMillis() + mediaUploadPublicationTtlMillis
        ),
        expireAt: admin.firestore.FieldValue.delete(),
        updatedAt: now,
      });
      return { state: 'save' as const, objectPath };
    });

    if (preflight.state === 'already-confirmed') {
      return { authorizationId: request.authorizationId, path: preflight.objectPath };
    }

    let recoveryOwner: string | undefined;
    let shouldSave = preflight.state === 'save';
    let inspectedObject: InspectedMediaObject | null = null;
    const objectPath = preflight.objectPath;
    if (preflight.state === 'recover') {
      marker = preflight.marker;
      const existing = await inspectServerUploadedMediaObject(objectPath, marker);
      if (existing.state === 'invalid') {
        if (existing.generation != null) {
          await queueServerMediaObjectCleanup({
            authorizationRef,
            uid,
            marker,
            recoveryOwner,
            generation: existing.generation,
            reason: 'invalid_server_upload_marker',
          });
        }
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Existing server media object cannot be recovered'
        );
      }
      const claimOwner = randomUUID();
      const recoveryClaim = await db.runTransaction(async (tx) => {
        const [authorizationSnap, userSnap, deletionJobSnap] = await Promise.all([
          tx.get(authorizationRef),
          tx.get(userRef),
          tx.get(deletionJobRef),
        ]);
        assertActiveAccountSnapshot(userSnap);
        assertNoAccountDeletionJob(deletionJobSnap);
        const authorizationData = authorizationSnap.data();
        if (
          !authorizationSnap.exists ||
          authorizationData?.status !== 'server_uploading' ||
          authorizationData.uid !== uid ||
          authorizationData.serverUploadLeaseOwner !== marker.leaseOwner ||
          authorizationData.serverUploadDigest !== payloadDigest ||
          serverMediaUploadLeaseUntilMillis(
            authorizationData.serverUploadLeaseUntil
          ) == null ||
          serverMediaUploadLeaseUntilMillis(
            authorizationData.serverUploadLeaseUntil
          )! > Date.now()
        ) {
          throw new functions.https.HttpsError(
            'aborted',
            'Server media recovery lease changed'
          );
        }
        const now = admin.firestore.Timestamp.now();
        if (existing.state === 'missing') {
          await chargeServerMediaUploadAttempt(tx, authorizationData, uid);
          const nextMarker = {
            leaseOwner: claimOwner,
            payloadDigest,
          };
          tx.update(authorizationRef, {
            serverUploadLeaseOwner: nextMarker.leaseOwner,
            serverUploadLeaseUntil: admin.firestore.Timestamp.fromMillis(
              now.toMillis() + serverMediaUploadLeaseMillis
            ),
            serverUploadRecoveryOwner: admin.firestore.FieldValue.delete(),
            serverUploadAttempts: Number.isSafeInteger(
              authorizationData.serverUploadAttempts
            )
              ? authorizationData.serverUploadAttempts + 1
              : 2,
            expiresAt: admin.firestore.Timestamp.fromMillis(
              now.toMillis() + mediaUploadPublicationTtlMillis
            ),
            updatedAt: now,
          });
          return { state: 'save' as const, marker: nextMarker };
        }
        tx.update(authorizationRef, {
          serverUploadRecoveryOwner: claimOwner,
          serverUploadLeaseUntil: admin.firestore.Timestamp.fromMillis(
            now.toMillis() + serverMediaUploadLeaseMillis
          ),
          updatedAt: now,
        });
        return { state: 'inspect' as const, marker };
      });
      marker = recoveryClaim.marker;
      if (recoveryClaim.state === 'save') {
        shouldSave = true;
      } else {
        recoveryOwner = claimOwner;
        inspectedObject = existing.state === 'valid' ? existing.object : null;
        if (inspectedObject == null) {
          throw new functions.https.HttpsError(
            'aborted',
            'Server media recovery object changed'
          );
        }
        await assertUploadedMediaContents(objectPath, inspectedObject);
      }
    }

    if (shouldSave) {
      let sanitized: Buffer;
      try {
        sanitized = await decodeAndSanitizeServerJpeg(
          request.jpegBase64,
          request.decodedByteLength
        );
      } catch (_) {
        await rejectInvalidServerMediaPayload({
          authorizationRef,
          uid,
          marker,
        });
        throw new functions.https.HttpsError(
          'invalid-argument',
          'Media must be a decodable metadata-free JPEG within the size limit'
        );
      }
      const target = admin.storage().bucket().file(objectPath);
      try {
        await target.save(sanitized, {
          resumable: false,
          validation: 'crc32c',
          preconditionOpts: { ifGenerationMatch: 0 },
          metadata: {
            contentType: 'image/jpeg',
            cacheControl: privateMediaCacheControl,
            metadata: serverMediaUploadCustomMetadata(marker),
          },
        });
      } catch (error) {
        if (!isServerStoragePreconditionFailure(error)) {
          throw new functions.https.HttpsError(
            'unavailable',
            'Server media storage write failed'
          );
        }
      }
      const saved = await inspectServerUploadedMediaObject(objectPath, marker);
      if (saved.state !== 'valid' || saved.object.size !== sanitized.length) {
        if (saved.state === 'invalid' && saved.generation != null) {
          await queueServerMediaObjectCleanup({
            authorizationRef,
            uid,
            marker,
            recoveryOwner,
            generation: saved.generation,
            reason: 'server_upload_verification_failed',
          });
        }
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Server media storage verification failed'
        );
      }
      inspectedObject = saved.object;
    }

    if (inspectedObject == null) {
      throw new functions.https.HttpsError(
        'unavailable',
        'Server media upload did not produce a verified object'
      );
    }
    let finalState: 'confirmed' | 'already-confirmed' | 'byte-quota-exceeded';
    try {
      finalState = await finalizeServerMediaUpload({
        authorizationRef,
        uid,
        marker,
        recoveryOwner,
        inspectedObject,
      });
    } catch (error) {
      const callableCode = error instanceof functions.https.HttpsError
        ? error.code
        : null;
      if (shouldCleanupServerMediaAfterFailure(callableCode)) {
        await queueServerMediaObjectCleanup({
          authorizationRef,
          uid,
          marker,
          recoveryOwner,
          generation: inspectedObject.generation,
          reason: 'server_upload_final_state_changed',
        });
      }
      throw error;
    }
    if (finalState === 'byte-quota-exceeded') {
      throw new functions.https.HttpsError(
        'resource-exhausted',
        'Daily media upload byte limit reached'
      );
    }
    return { authorizationId: request.authorizationId, path: objectPath };
  }
);

/**
 * Locks a completed upload to its object generation after server-side JPEG
 * inspection and private-metadata normalization. Final profile or message
 * mutation still owns the one-time authorization consumption.
 */
async function markMediaAuthorizationRejectedAfterCleanup(input: {
  uid: string;
  authorizationRef: FirebaseFirestore.DocumentReference;
  generation: string;
}): Promise<boolean> {
  const userRef = db.collection('users').doc(input.uid);
  return db.runTransaction(async (tx) => {
    const [userSnap, authorizationSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(input.authorizationRef),
    ]);
    if (
      activeAccountIssue({
        exists: userSnap.exists,
        userData: userSnap.data(),
      }) != null ||
      !authorizationSnap.exists ||
      authorizationSnap.data()?.status !== 'cleanup_required' ||
      authorizationSnap.data()?.cleanupGeneration !== input.generation
    ) {
      return false;
    }
    tx.update(input.authorizationRef, {
      status: 'rejected',
      cleanupGeneration: admin.firestore.FieldValue.delete(),
      expireAt: admin.firestore.Timestamp.fromMillis(
        Date.now() + mediaUploadQuotaRetentionMillis
      ),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return true;
  });
}

export const confirmMediaUpload = functions.region(FUNCTION_REGION)
  .runWith({ timeoutSeconds: 60, memory: '512MB', maxInstances: 20 })
  .https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = requireVerifiedCallableUid(context);
    if (
      data == null ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      Object.keys(data).length !== 1 ||
      !isSafeMediaUploadAuthorizationId(data.authorizationId)
    ) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'authorizationId is invalid'
      );
    }

    const authorizationId = data.authorizationId as string;
    const authorizationRef = db
      .collection('mediaUploadAuthorizations')
      .doc(authorizationId);
    const userRef = db.collection('users').doc(uid);
    const preflight = await db.runTransaction(async (tx) => {
      const [authorizationSnap, userSnap] = await Promise.all([
        tx.get(authorizationRef),
        tx.get(userRef),
      ]);
      assertActiveAccountSnapshot(userSnap);
      const authorizationData = authorizationSnap.data();
      const objectPath = authorizationData?.objectPath;
      const parsed = parseMediaUploadObjectPath(objectPath);
      if (
        parsed == null ||
        parsed.authorizationId !== authorizationId ||
        parsed.uid !== uid
      ) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Media upload authorization does not match the caller'
        );
      }
      const expected = {
        uid,
        kind: parsed.kind,
        objectPath,
        matchId: parsed.matchId,
      };
      if (authorizationData?.uploadProtocolVersion === mediaUploadProtocolVersion) {
        if (
          (authorizationData.status === 'confirmed' ||
            authorizationData.status === 'consumed') &&
          authorizationData.byteCharged === true &&
          typeof authorizationData.confirmedGeneration === 'string' &&
          authorizationData.confirmedGeneration.length > 0 &&
          Number.isSafeInteger(authorizationData.confirmedSize) &&
          authorizationData.confirmedSize > 0
        ) {
          return { state: 'already-confirmed' as const, objectPath, parsed };
        }
        if (authorizationData.status === 'server_uploading') {
          const marker = serverMediaUploadMarkerFromAuthorization(
            authorizationData
          );
          const leaseUntilMillis = serverMediaUploadLeaseUntilMillis(
            authorizationData.serverUploadLeaseUntil
          );
          if (marker == null || leaseUntilMillis == null) {
            throw new functions.https.HttpsError(
              'failed-precondition',
              'Server media upload recovery proof is invalid'
            );
          }
          if (leaseUntilMillis <= Date.now()) {
            return {
              state: 'recover-server-upload' as const,
              objectPath,
              parsed,
              marker,
            };
          }
          throw new functions.https.HttpsError(
            'aborted',
            'Server media upload is still in progress',
            {
              uploadState: 'server_uploading',
              retryAfterMillis: Math.max(1, leaseUntilMillis - Date.now()),
            }
          );
        }
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Protocol V2 media must be uploaded by uploadPrivateMediaBytes'
        );
      }
      const issue = mediaUploadAuthorizationIssue(
        authorizationData,
        expected,
        Date.now(),
        ['reserved', 'uploaded', 'confirming', 'confirmed']
      );
      if (issue != null) {
        throw new functions.https.HttpsError(
          issue === 'expired' ? 'deadline-exceeded' : 'failed-precondition',
          `Media upload authorization is invalid: ${issue}`
        );
      }

      const quotaId = authorizationData?.quotaId;
      const quotaDayKey = authorizationData?.quotaDayKey;
      if (typeof quotaId !== 'string' || typeof quotaDayKey !== 'string') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Media upload quota ledger is unavailable'
        );
      }
      const quotaRef = db.collection('mediaUploadQuotas').doc(quotaId);
      const quotaSnap = await tx.get(quotaRef);
      const quotaData = quotaSnap.data();
      if (
        !quotaSnap.exists ||
        quotaData?.uid !== uid ||
        quotaData?.dayKey !== quotaDayKey
      ) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Media upload quota ledger does not match the authorization'
        );
      }
      const nextConfirmAttempts = nextMediaUploadConfirmAttempt({
        existingDayKey: quotaData.dayKey,
        existingAttempts: quotaData.confirmAttempts,
        requestedDayKey: quotaDayKey,
      });
      if (nextConfirmAttempts == null) {
        throw new functions.https.HttpsError(
          'resource-exhausted',
          'Daily media confirmation attempt limit reached'
        );
      }
      tx.set(quotaRef, {
        uid,
        dayKey: quotaDayKey,
        confirmAttempts: nextConfirmAttempts,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      if (authorizationData?.status === 'confirming') {
        throw new functions.https.HttpsError(
          'aborted',
          'Media confirmation is in progress'
        );
      }
      if (authorizationData?.status === 'confirmed') {
        if (
          authorizationData.byteCharged !== true ||
          typeof authorizationData.confirmedGeneration !== 'string' ||
          authorizationData.confirmedGeneration.length === 0 ||
          !Number.isSafeInteger(authorizationData.confirmedSize) ||
          authorizationData.confirmedSize <= 0 ||
          authorizationData.confirmedSize > mediaUploadMaxBytes
        ) {
          throw new functions.https.HttpsError(
            'aborted',
            'Confirmed media metadata changed'
          );
        }
        return { state: 'already-confirmed' as const, objectPath, parsed };
      }
      return { state: 'inspect' as const, objectPath, parsed };
    });

    const { objectPath, parsed } = preflight;
    if (preflight.state === 'already-confirmed') {
      return { authorizationId, path: objectPath };
    }
    if (preflight.state === 'recover-server-upload') {
      const outcome = await recoverExpiredServerMediaUpload({
        authorizationRef,
        uid,
        marker: preflight.marker,
      });
      if (outcome === 'confirmed') {
        return { authorizationId, path: objectPath };
      }
      throw new functions.https.HttpsError(
        outcome === 'reset' ? 'failed-precondition' : 'aborted',
        outcome === 'reset'
          ? 'Server media upload was not committed; retry the byte upload once'
          : 'Server media upload recovery is not complete'
      );
    }
    const expected = {
      uid,
      kind: parsed.kind,
      objectPath,
      matchId: parsed.matchId,
    };
    // Metadata is bounded and cheap. The full 5 MiB read occurs only after the
    // transaction below grants this invocation the immutable-generation lease.
    const inspectedObject = await assertUploadedMediaMetadata(objectPath);
    const bucket = admin.storage().bucket();
    const confirmLeaseOwner = randomUUID();
    const expectedLease = {
      owner: confirmLeaseOwner,
      generation: inspectedObject.generation,
      size: inspectedObject.size,
    };
    const confirmationResult = await db.runTransaction(async (tx) => {
      const [freshSnap, freshUserSnap] = await Promise.all([
        tx.get(authorizationRef),
        tx.get(userRef),
      ]);
      assertActiveAccountSnapshot(freshUserSnap);
      const freshData = freshSnap.data();
      if (freshData?.status === 'confirming') {
        if (mediaUploadConfirmationLeaseIssue(freshData, expectedLease) != null) {
          throw new functions.https.HttpsError('aborted', 'Media confirmation is in progress');
        }
        return 'confirming' as const;
      }
      if (
        freshData?.status === 'uploaded' &&
        freshData.uploadedGeneration !== inspectedObject.generation
      ) {
        throw new functions.https.HttpsError(
          'aborted',
          'Uploaded media generation changed'
        );
      }
      if (freshData?.status === 'confirmed') {
        if (
          freshData.byteCharged !== true ||
          freshData.confirmedGeneration !== inspectedObject.generation ||
          freshData.confirmedSize !== inspectedObject.size
        ) {
          throw new functions.https.HttpsError(
            'aborted',
            'Confirmed media metadata changed'
          );
        }
        return 'already-confirmed' as const;
      }
      const freshIssue = mediaUploadAuthorizationIssue(
        freshData,
        expected,
        Date.now(),
        ['reserved', 'uploaded']
      );
      if (freshIssue != null) {
        throw new functions.https.HttpsError(
          freshIssue === 'expired' ? 'deadline-exceeded' : 'failed-precondition',
          `Media upload authorization is invalid: ${freshIssue}`
        );
      }

      const quotaId = freshData?.quotaId;
      const quotaDayKey = freshData?.quotaDayKey;
      if (
        typeof quotaId !== 'string' ||
        typeof quotaDayKey !== 'string'
      ) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Media upload quota ledger is unavailable'
        );
      }
      const quotaRef = db.collection('mediaUploadQuotas').doc(quotaId);
      const quotaSnap = await tx.get(quotaRef);
      const byteField = parsed.kind === 'profile'
        ? 'profileBytes'
        : 'chatBytes';
      const nextBytes = nextMediaUploadQuotaBytes({
        kind: parsed.kind,
        existingDayKey: quotaSnap.data()?.dayKey,
        existingBytes: quotaSnap.data()?.[byteField],
        requestedDayKey: quotaDayKey,
        uploadedBytes: inspectedObject.size,
      });
      if (nextBytes == null) {
        tx.update(authorizationRef, {
          // Record the exact generation before attempting deletion. If the
          // Storage delete fails (or this callable stops after commit), the
          // scheduled cleanup can retry without ever exposing the object.
          status: 'cleanup_required',
          rejectionReason: 'daily_byte_quota_exceeded',
          cleanupGeneration: inspectedObject.generation,
          expiresAt: admin.firestore.FieldValue.delete(),
          expireAt: admin.firestore.FieldValue.delete(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return 'byte-quota-exceeded' as const;
      }
      tx.set(quotaRef, {
        [byteField]: nextBytes,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      tx.update(authorizationRef, {
        status: 'confirming',
        byteCharged: true,
        lockedGeneration: inspectedObject.generation,
        lockedSize: inspectedObject.size,
        confirmLeaseOwner,
        downloadToken: admin.firestore.FieldValue.delete(),
        lockedUrl: admin.firestore.FieldValue.delete(),
        confirmedUrl: admin.firestore.FieldValue.delete(),
        uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return 'confirming' as const;
    });

    if (confirmationResult === 'already-confirmed') {
      // Another invocation completed after this request's metadata HEAD. Its
      // final transaction already verified the full generation and private
      // metadata, so a retry returns without another object download.
      return { authorizationId, path: objectPath };
    }

    if (confirmationResult === 'byte-quota-exceeded') {
      try {
        await bucket
          .file(objectPath, { generation: inspectedObject.generation })
          .delete({ ignoreNotFound: true });
        await markMediaAuthorizationRejectedAfterCleanup({
          uid,
          authorizationRef,
          generation: inspectedObject.generation,
        });
      } catch (cleanupError) {
        console.error(`Failed to delete over-quota media ${objectPath}:`, cleanupError);
      }
      throw new functions.https.HttpsError(
        'resource-exhausted',
        `Daily ${parsed.kind} media byte limit reached`
      );
    }

    if (confirmationResult === 'confirming') {
      try {
        await assertUploadedMediaContents(objectPath, inspectedObject);
        await normalizeAndVerifyPrivateMediaMetadata(objectPath, inspectedObject);
        await db.runTransaction(async (tx) => {
          const [freshSnap, freshUserSnap] = await Promise.all([
            tx.get(authorizationRef),
            tx.get(userRef),
          ]);
          assertActiveAccountSnapshot(freshUserSnap);
          const freshData = freshSnap.data();
          if (mediaUploadConfirmationLeaseIssue(freshData, expectedLease) != null) {
            throw new functions.https.HttpsError(
              'aborted',
              'Media confirmation lock changed'
            );
          }
          tx.update(authorizationRef, {
            status: 'confirmed',
            confirmedGeneration: inspectedObject.generation,
            confirmedSize: inspectedObject.size,
            lockedGeneration: admin.firestore.FieldValue.delete(),
            lockedSize: admin.firestore.FieldValue.delete(),
            lockedUrl: admin.firestore.FieldValue.delete(),
            confirmedUrl: admin.firestore.FieldValue.delete(),
            downloadToken: admin.firestore.FieldValue.delete(),
            confirmLeaseOwner: admin.firestore.FieldValue.delete(),
            confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        });
      } catch (error) {
        const failedLeaseState = await db.runTransaction(async (tx) => {
          const [failedSnap, failedUserSnap] = await Promise.all([
            tx.get(authorizationRef),
            tx.get(userRef),
          ]);
          const failedData = failedSnap.data();
          if (
            !failedSnap.exists ||
            mediaUploadConfirmationLeaseIssue(failedData, expectedLease) != null
          ) {
            return 'changed' as const;
          }
          if (
            activeAccountIssue({
              exists: failedUserSnap.exists,
              userData: failedUserSnap.data(),
            }) != null
          ) {
            return 'inactive' as const;
          }
          tx.update(authorizationRef, {
            status: 'cleanup_required',
            rejectionReason: 'confirmation_failed',
            cleanupGeneration: inspectedObject.generation,
            expiresAt: admin.firestore.FieldValue.delete(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          return 'owned' as const;
        });
        if (failedLeaseState === 'changed') {
          if (error instanceof functions.https.HttpsError) throw error;
          throw new functions.https.HttpsError(
            'aborted',
            'Media confirmation ownership changed'
          );
        }
        try {
          await bucket
            .file(objectPath, { generation: inspectedObject.generation })
            .delete({ ignoreNotFound: true });
          if (failedLeaseState === 'owned') {
            await markMediaAuthorizationRejectedAfterCleanup({
              uid,
              authorizationRef,
              generation: inspectedObject.generation,
            });
          }
        } catch (cleanupError) {
          console.error(`Failed to delete unconfirmed media ${objectPath}:`, cleanupError);
        }
        if (error instanceof functions.https.HttpsError) throw error;
        throw new functions.https.HttpsError(
          'unavailable',
          'Media confirmation failed'
        );
      }
    }

    return {
      authorizationId,
      path: objectPath,
    };
  }
);

/**
 * completeOnboarding(data: UserProfileInput) -> { ok: true }
 *
 * Validates and writes the user profile. Initializes quota and server-controlled fields.
 */
export const completeOnboarding = regionalFunctions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = requireVerifiedCallableUid(context);
    const profileReferenceDate = new Date();

    // Validate input
    const profileData = { ...data };
    // Older clients can still include this field, but it is never trusted as
    // authentication input. Callable context is the sole identity source.
    delete profileData.clientIdToken;
    const profileValidation = validateOnboardingProfileInput(
      profileData,
      profileReferenceDate,
      uid
    );
    if (!profileValidation.ok) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        profileValidation.reason
      );
    }
    const preferredGender =
      profileData.preferredGender === 'all'
        ? 'any'
        : profileData.preferredGender || 'any';
    const preferredNationality =
      profileData.preferredNationality === 'all'
        ? 'any'
        : profileData.preferredNationality || 'any';
    const displayNameNormalized = validateDisplayNameAvailabilityInput(
      profileData.displayName
    );
    const profileMediaEntries = protectedProfileMediaEntries(
      profileData.photoUrls,
      uid
    );
    const profileMediaPaths = profileMediaEntries.map(
      (entry) => entry.objectPath
    );
    const inspectedProfileMedia = await Promise.all(
      profileMediaPaths.map(assertConfirmedMediaForPublication)
    );
    const profileMediaAuthorizationRefs = profileMediaPaths.map(
      mediaAuthorizationRefForObjectPath
    );

    // Initialize quota reset time
    const now = admin.firestore.Timestamp.now();
    const quotaResetAt = new admin.firestore.Timestamp(
      now.seconds + 3600, // 1 hour from now
      now.nanoseconds
    );

    await db.runTransaction(async (tx) => {
      const userRef = db.collection('users').doc(uid);
      const reservationRef = db
        .collection('displayNameReservations')
        .doc(displayNameNormalized);
      const initialPointEventRef = db
        .collection('pointEvents')
        .doc(onboardingPointEventId(uid));
      const deletionJobRef = db.collection('accountDeletionJobs').doc(uid);
      const [
        userSnap,
        reservationSnap,
        initialPointEventSnap,
        deletionJobSnap,
        ...profileMediaAuthorizationSnaps
      ] = await Promise.all([
        tx.get(userRef),
        tx.get(reservationRef),
        tx.get(initialPointEventRef),
        tx.get(deletionJobRef),
        ...profileMediaAuthorizationRefs.map((ref) => tx.get(ref)),
      ]);
      assertNoAccountDeletionJob(deletionJobSnap);
      const userData = userSnap.data();
      const blockReason = onboardingCompletionBlockReason(userData);
      if (blockReason === 'already-completed') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Onboarding has already been completed'
        );
      }
      if (blockReason === 'banned') {
        throw new functions.https.HttpsError(
          'permission-denied',
          'User is banned'
        );
      }
      if (blockReason === 'deleted') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'User account is being deleted'
        );
      }

      const existingNormalized = userData?.displayNameNormalized;
      const previousReservationRef =
        typeof existingNormalized === 'string' &&
        existingNormalized.length > 0 &&
        existingNormalized !== displayNameNormalized
          ? db.collection('displayNameReservations').doc(existingNormalized)
          : null;
      const previousReservationSnap = previousReservationRef == null
        ? null
        : await tx.get(previousReservationRef);

      if (reservationSnap.exists && reservationSnap.data()?.uid !== uid) {
        throw new functions.https.HttpsError(
          'already-exists',
          'Display name is already taken'
        );
      }

      if (
        previousReservationRef != null &&
        previousReservationSnap?.data()?.uid === uid
      ) {
        tx.delete(previousReservationRef);
      }

      const existingProfileMediaPaths = new Set(
        protectedProfileMediaPaths(userData?.photoUrls, uid)
      );
      for (let index = 0; index < profileMediaPaths.length; index += 1) {
        const objectPath = profileMediaPaths[index];
        if (existingProfileMediaPaths.has(objectPath)) continue;
        consumeMediaAuthorization(
          tx,
          profileMediaAuthorizationSnaps[index],
          {
            uid,
            kind: 'profile',
            objectPath,
          },
          now,
          'completeOnboarding',
          inspectedProfileMedia[index]
        );
      }

      tx.set(reservationRef, {
        uid,
        displayName: profileData.displayName.trim(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const profileUpdate: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = {
        uid,
        createdAt: userSnap.exists
          ? userData?.createdAt ?? admin.firestore.FieldValue.serverTimestamp()
          : admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        onboardingCompleted: true,
        accountStatus: 'active',
        displayName: profileData.displayName.trim(),
        displayNameNormalized,
        birthYear: profileData.birthYear,
        birthMonth: profileData.birthMonth,
        birthDay: profileData.birthDay,
        gender: profileData.gender,
        nationality: profileData.nationality,
        residingCountry: profileData.residingCountry,
        nativeLanguage: profileData.nativeLanguage,
        learningLanguage: profileData.learningLanguage,
        bio: profileData.bio || '',
        relationshipType: profileData.relationshipType || '',
        occupation: profileData.occupation || '',
        keywords: Array.isArray(profileData.keywords) ? profileData.keywords : [],
        qaItems: Array.isArray(profileData.qaItems) ? profileData.qaItems : [],
        photoUrls: profileMediaPaths,
        preferredGender,
        preferredNationality,
        preferredAgeMin: profileData.preferredAgeMin || 20,
        preferredAgeMax: profileData.preferredAgeMax || 50,
      };

      const visibilityDecision = profileMediaVisibilityDecision(
        { ...userData, ...profileUpdate },
        profileReferenceDate
      );
      if (visibilityDecision === 'set') {
        profileUpdate.profileMediaVisibilityVersion =
          profileMediaVisibilityVersion;
      } else if (visibilityDecision === 'clear') {
        profileUpdate.profileMediaVisibilityVersion =
          admin.firestore.FieldValue.delete();
      }

      if (typeof userData?.quotaRemaining !== 'number') {
        profileUpdate.quotaRemaining = 10;
      }
      if (userData?.quotaResetAt == null) {
        profileUpdate.quotaResetAt = quotaResetAt;
      }
      if (typeof userData?.extraQuotaPurchased !== 'number') {
        profileUpdate.extraQuotaPurchased = 0;
      }
      if (typeof userData?.dailyKeyLimit !== 'number') {
        profileUpdate.dailyKeyLimit = 3;
      }

      let pointGrantDecision;
      try {
        pointGrantDecision = decideInitialOnboardingPointGrant({
          uid,
          userExists: userSnap.exists,
          userData,
          initialPointEventExists: initialPointEventSnap.exists,
        });
      } catch (_) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Point balance requires account review'
        );
      }

      if (
        userData?.onboardingShellProvenance ===
        profileUploadOnboardingShellProvenance
      ) {
        profileUpdate.onboardingShellProvenance =
          admin.firestore.FieldValue.delete();
      }

      if (pointGrantDecision.action === 'grant') {
        profileUpdate.keyCount = pointGrantDecision.balanceAfter;
        profileUpdate.pointBalanceTrustVersion = pointBalanceTrustVersion;
        tx.create(initialPointEventRef, {
          uid,
          eventType: 'grant',
          amount: pointGrantDecision.amount,
          reason: 'Initial onboarding point grant',
          balanceBefore: pointGrantDecision.balanceBefore,
          balanceAfter: pointGrantDecision.balanceAfter,
          source: pointGrantDecision.source,
          migrationMarker: false,
          legacyBalancePreserved: pointGrantDecision.legacyBalancePreserved,
          timestamp: now,
        } as QuotaEventData);
      }

      // Merge only the explicit profile/default fields above. Existing
      // moderation, notification, payment and other server-owned state is kept.
      tx.set(userRef, profileUpdate, { merge: true });
    });

    return { ok: true };
  }
);

/**
 * updateMyProfile(data: ProfileEditInput) -> { ok: true }
 *
 * Updates only the strict public/profile-preference schema. Authentication,
 * App Check, active-account state, and display-name uniqueness are enforced in
 * the server transaction; every unrelated user field is preserved.
 */
export const updateMyProfile = regionalFunctions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = requireVerifiedCallableUid(context);
    const profileReferenceDate = new Date();
    const validation = validateProfileUpdateInput(
      data,
      profileReferenceDate,
      uid
    );
    if (!validation.ok) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        validation.reason
      );
    }

    const profileUpdate = validation.value;
    const profileMediaEntries = protectedProfileMediaEntries(
      profileUpdate.photoUrls,
      uid
    );
    const profileMediaPaths = profileMediaEntries.map(
      (entry) => entry.objectPath
    );
    const inspectedProfileMedia = await Promise.all(
      profileMediaPaths.map(assertConfirmedMediaForPublication)
    );
    const profileMediaAuthorizationRefs = profileMediaPaths.map(
      mediaAuthorizationRefForObjectPath
    );
    const displayNameNormalized = normalizeProfileDisplayName(
      profileUpdate.displayName
    );
    const userRef = db.collection('users').doc(uid);
    const nextReservationRef = db
      .collection('displayNameReservations')
      .doc(displayNameNormalized);

    await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      const userData = userSnap.data();
      const accountIssue = activeAccountIssue({
        exists: userSnap.exists,
        userData,
      });
      if (accountIssue === 'missing') {
        throw new functions.https.HttpsError(
          'not-found',
          'User profile not found'
        );
      }
      if (accountIssue === 'banned') {
        throw new functions.https.HttpsError(
          'permission-denied',
          'User is banned'
        );
      }
      if (accountIssue === 'deleted') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'User account is being deleted'
        );
      }

      const previousReservationRefs =
        profileDisplayNameReservationIdsToRelease({
          storedNormalized: userData?.displayNameNormalized,
          currentDisplayName: userData?.displayName,
          nextNormalized: displayNameNormalized,
        }).map((id) => db.collection('displayNameReservations').doc(id));
      const reservationSnapshots = await Promise.all([
          tx.get(nextReservationRef),
          ...previousReservationRefs.map((ref) => tx.get(ref)),
          ...profileMediaAuthorizationRefs.map((ref) => tx.get(ref)),
        ]);
      const nextReservationSnap = reservationSnapshots[0];
      const previousReservationSnaps = reservationSnapshots.slice(
        1,
        1 + previousReservationRefs.length
      );
      const profileMediaAuthorizationSnaps = reservationSnapshots.slice(
        1 + previousReservationRefs.length
      );

      if (
        nextReservationSnap.exists &&
        nextReservationSnap.data()?.uid !== uid
      ) {
        throw new functions.https.HttpsError(
          'already-exists',
          'Display name is already taken'
        );
      }

      for (let index = 0; index < previousReservationRefs.length; index += 1) {
        if (previousReservationSnaps[index].data()?.uid === uid) {
          tx.delete(previousReservationRefs[index]);
        }
      }
      const existingProfileMediaPaths = new Set(
        protectedProfileMediaPaths(userData?.photoUrls, uid)
      );
      const now = admin.firestore.Timestamp.now();
      for (let index = 0; index < profileMediaPaths.length; index += 1) {
        const objectPath = profileMediaPaths[index];
        if (existingProfileMediaPaths.has(objectPath)) continue;
        consumeMediaAuthorization(
          tx,
          profileMediaAuthorizationSnaps[index],
          {
            uid,
            kind: 'profile',
            objectPath,
          },
          now,
          'updateMyProfile',
          inspectedProfileMedia[index]
        );
      }
      tx.set(nextReservationRef, {
        uid,
        displayName: profileUpdate.displayName,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      const userUpdate: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = {
        ...profileUpdate,
        photoUrls: profileMediaPaths,
        displayNameNormalized,
        updatedAt: now,
      };
      const visibilityDecision = profileMediaVisibilityDecision(
        { ...userData, ...userUpdate },
        profileReferenceDate
      );
      if (visibilityDecision === 'set') {
        userUpdate.profileMediaVisibilityVersion =
          profileMediaVisibilityVersion;
      } else if (visibilityDecision === 'clear') {
        userUpdate.profileMediaVisibilityVersion =
          admin.firestore.FieldValue.delete();
      }
      tx.update(userRef, userUpdate);
    });

    return { ok: true };
  }
);

/** Deletes a caller-owned profile object and removes its URL from the profile. */
export const deleteMyProfilePhoto = regionalFunctions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);
    const url = typeof data.url === 'string' ? data.url.trim() : '';
    const objectPath = profilePhotoObjectPath(url, uid);
    if (objectPath == null) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'url must identify a caller-owned profile photo'
      );
    }

    await admin.storage().bucket().file(objectPath).delete({ ignoreNotFound: true });

    const userRef = db.collection('users').doc(uid);
    await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      assertActiveAccountSnapshot(userSnap);
      tx.update(userRef, {
        photoUrls: admin.firestore.FieldValue.arrayRemove(url),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    return { ok: true };
  }
);

/**
 * purchaseExtraQuota(data: { receipt, platform, productId, purchaseId,
 *   verificationSource, appAccountToken? })
 * -> { ok: true, extraQuotaGranted: number, keyCount: number }
 *
 * Android keeps its verified Play Billing path. StoreKit 2 verification is
 * implemented but remains disabled until its explicit environment rollout
 * gates are configured and Sandbox evidence is approved.
 */
export const purchaseExtraQuota = regionalFunctions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);

    // Validate input
    if (typeof data.receipt !== 'string' || data.receipt.trim().length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'receipt must be a non-empty string'
      );
    }

    if (!isValidPointPlatform(data.platform)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'platform must be android or ios'
      );
    }
    if (
      data.purchaseId != null &&
      (typeof data.purchaseId !== 'string' || data.purchaseId.length > 256)
    ) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'purchaseId is invalid'
      );
    }
    if (
      data.verificationSource != null &&
      (typeof data.verificationSource !== 'string' ||
        data.verificationSource.length > 32)
    ) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'verificationSource is invalid'
      );
    }

    if (data.platform === 'android' && !isStorePointPurchaseEnabled('android')) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Store point purchases are temporarily unavailable'
      );
    }

    return await verifyAndGrantStorePointPurchase(
      uid,
      data as StorePointPurchaseRequest
    );
  }
);

export const recordPendingStorePurchase = regionalFunctions.https.onCall(
  async (_data: any, context: functions.https.CallableContext) => {
    await requireAuthAndNotBanned(context);
    // Legacy callable kept as a fail-closed compatibility surface. Accepting
    // arbitrary raw Play tokens here allowed queue amplification. Unfinished
    // store purchases are retried by the platform purchase stream instead.
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Server-side pending purchase intake is disabled'
    );
  }
);

async function finalizePendingStorePurchase(
  ref: admin.firestore.DocumentReference,
  leaseOwner: string,
  updates: Record<string, unknown>
): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (data?.status !== 'verifying' || data.leaseOwner !== leaseOwner) {
      return false;
    }
    tx.set(
      ref,
      {
        ...updates,
        leaseOwner: admin.firestore.FieldValue.delete(),
        leaseUntil: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return true;
  });
}

export const processPendingStorePurchases = regionalFunctions.pubsub
  .schedule('every 15 minutes')
  .onRun(async () => {
    const snapshots = await Promise.all(
      pendingStorePurchaseStatuses.map((status) =>
        db
          .collection('pendingStorePurchases')
          .where('status', '==', status)
          .limit(100)
          .get()
      )
    );
    const pendingDocs = snapshots.flatMap((snapshot) => snapshot.docs);
    let claimedCount = 0;

    for (const doc of pendingDocs) {
      if (claimedCount >= 20) break;
      const nowMillis = Date.now();
      const leaseOwner = randomUUID();
      const claimed = await db.runTransaction<Record<string, unknown> | null>(
        async (tx) => {
          const freshSnap = await tx.get(doc.ref);
          if (!freshSnap.exists) return null;
          const freshData = freshSnap.data()!;
          const leaseUntilMillis =
            freshData.leaseUntil instanceof admin.firestore.Timestamp
              ? freshData.leaseUntil.toMillis()
              : undefined;
          const nextAttemptAtMillis =
            freshData.nextAttemptAt instanceof admin.firestore.Timestamp
              ? freshData.nextAttemptAt.toMillis()
              : undefined;
          const decision = decidePendingStorePurchaseClaim(
            {
              status: freshData.status,
              attempts: freshData.attempts,
              leaseUntilMillis,
              nextAttemptAtMillis,
            },
            nowMillis
          );
          if (decision.terminal) {
            tx.set(
              doc.ref,
              {
                status: 'failed',
                lastErrorMessage: 'pending_purchase_retry_limit_reached',
                leaseUntil: admin.firestore.FieldValue.delete(),
                nextAttemptAt: admin.firestore.FieldValue.delete(),
                receipt: admin.firestore.FieldValue.delete(),
                expireAt: admin.firestore.Timestamp.fromMillis(
                  nowMillis + pendingStorePurchaseRetentionMillis
                ),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
            return null;
          }
          if (!decision.claim) return null;

          tx.set(
            doc.ref,
            {
              status: 'verifying',
              attempts: decision.nextAttempt,
              leaseUntil: admin.firestore.Timestamp.fromMillis(
                nowMillis + pendingStorePurchaseLeaseMillis
              ),
              leaseOwner,
              expireAt:
                freshData.expireAt instanceof admin.firestore.Timestamp
                  ? freshData.expireAt
                  : admin.firestore.Timestamp.fromMillis(
                      nowMillis + pendingStorePurchaseRetentionMillis
                    ),
              nextAttemptAt: admin.firestore.FieldValue.delete(),
              lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
          return {
            ...freshData,
            attempts: decision.nextAttempt,
            leaseOwner,
          } as Record<string, unknown>;
        }
      );
      if (claimed == null) continue;
      claimedCount += 1;

      const data = claimed;
      if (
        typeof data.uid !== 'string' ||
        typeof data.productId !== 'string' ||
        typeof data.receipt !== 'string' ||
        !isValidPointPlatform(data.platform) ||
        !isValidPurchaseToken(data.receipt)
      ) {
        await finalizePendingStorePurchase(doc.ref, leaseOwner, {
          status: 'failed',
          lastErrorMessage: 'pending_purchase_data_invalid',
          nextAttemptAt: admin.firestore.FieldValue.delete(),
          receipt: admin.firestore.FieldValue.delete(),
        });
        continue;
      }

      if (!isStorePointPurchaseEnabled(data.platform)) {
        await finalizePendingStorePurchase(doc.ref, leaseOwner, {
          status: 'failed',
          lastErrorMessage: 'pending_purchase_platform_disabled',
          nextAttemptAt: admin.firestore.FieldValue.delete(),
          receipt: admin.firestore.FieldValue.delete(),
        });
        continue;
      }

      try {
        const result = await verifyAndGrantStorePointPurchase(data.uid, {
          platform: data.platform,
          productId: data.productId,
          receipt: data.receipt,
          purchaseId:
            typeof data.purchaseId === 'string' ? data.purchaseId : '',
          verificationSource:
            typeof data.verificationSource === 'string'
              ? data.verificationSource
              : '',
        });
        await finalizePendingStorePurchase(doc.ref, leaseOwner, {
          status: result.alreadyProcessed ? 'already_processed' : 'granted',
          keyCount: result.keyCount,
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
          lastErrorMessage: admin.firestore.FieldValue.delete(),
          nextAttemptAt: admin.firestore.FieldValue.delete(),
          receipt: admin.firestore.FieldValue.delete(),
        });
      } catch (err) {
        const errorCode =
          err instanceof functions.https.HttpsError ? err.code : 'internal';
        const attempts =
          typeof data.attempts === 'number' ? data.attempts : 1;
        const terminal =
          attempts >= maxPendingStorePurchaseAttempts ||
          isTerminalPendingStorePurchaseError(errorCode);
        await finalizePendingStorePurchase(doc.ref, leaseOwner, {
          status: terminal ? 'failed' : 'retryable_error',
          lastErrorMessage: `pending_purchase_${errorCode}`.slice(0, 100),
          nextAttemptAt: terminal
            ? admin.firestore.FieldValue.delete()
            : admin.firestore.Timestamp.fromMillis(
                Date.now() + pendingStorePurchaseRetryDelayMillis(attempts)
              ),
          ...(terminal
            ? { receipt: admin.firestore.FieldValue.delete() }
            : {}),
        });
      }
    }
  });

/**
 * Removes expired, never-consumed media reservations and their exact orphan
 * objects. Quota counters intentionally remain charged until their short TTL;
 * abandoning an upload must not refund an abuse-control budget.
 */
interface MediaGenerationCleanupTask {
  cleanupKind: 'canonical' | 'legacy';
  authorizationId: string | null;
  bucket: string;
  uid: string;
  kind: 'profile' | 'chat';
  objectPath: string;
  matchId: string | null;
  generation: string;
}

function mediaGenerationCleanupTaskId(
  bucket: string,
  objectPath: string,
  generation: string
): string {
  return createHash('sha256')
    .update('hana-media-generation-cleanup-v1\0')
    .update(bucket)
    .update('\0')
    .update(objectPath)
    .update('\0')
    .update(generation)
    .digest('hex');
}

function isExactMediaGenerationCleanupTask(
  data: FirebaseFirestore.DocumentData | undefined,
  expected: MediaGenerationCleanupTask
): boolean {
  return data?.cleanupKind === expected.cleanupKind &&
    data.authorizationId === expected.authorizationId &&
    data.bucket === expected.bucket &&
    data.uid === expected.uid &&
    data.kind === expected.kind &&
    data.objectPath === expected.objectPath &&
    data.matchId === expected.matchId &&
    data.generation === expected.generation;
}

function cleanupTimestampMillis(value: unknown): number | undefined {
  return value instanceof admin.firestore.Timestamp
    ? value.toMillis()
    : undefined;
}

async function ensureMediaGenerationCleanupTask(
  tx: admin.firestore.Transaction,
  taskRef: admin.firestore.DocumentReference,
  task: MediaGenerationCleanupTask,
  reason: string
): Promise<void> {
  const taskSnap = await tx.get(taskRef);
  if (taskSnap.exists) {
    if (!isExactMediaGenerationCleanupTask(taskSnap.data(), task)) {
      throw new Error(`Conflicting media generation cleanup ${taskRef.id}`);
    }
    return;
  }
  let authorizationFenceCounted = false;
  if (task.cleanupKind === 'canonical' && task.authorizationId != null) {
    const authorizationRef = db
      .collection('mediaUploadAuthorizations')
      .doc(task.authorizationId);
    const authorizationSnap = await tx.get(authorizationRef);
    if (authorizationSnap.exists) {
      const nextCount = nextPendingGenerationCleanupCount(
        authorizationSnap.data()?.pendingGenerationCleanupCount,
        1
      );
      if (nextCount == null) {
        throw new Error(
          `Invalid cleanup dependency count for ${task.authorizationId}`
        );
      }
      tx.update(authorizationRef, {
        pendingGenerationCleanupCount: nextCount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      authorizationFenceCounted = true;
    }
  }
  tx.create(taskRef, {
    ...task,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: admin.firestore.Timestamp.now(),
    authorizationFenceCounted,
    reason,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

interface ClaimedMediaGenerationCleanup {
  leaseOwner: string;
  attempts: number;
}

async function claimMediaGenerationCleanupTask(
  taskRef: admin.firestore.DocumentReference,
  task: MediaGenerationCleanupTask
): Promise<ClaimedMediaGenerationCleanup | null> {
  const leaseOwner = randomUUID();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(taskRef);
    if (!snap.exists || !isExactMediaGenerationCleanupTask(snap.data(), task)) {
      return null;
    }
    const data = snap.data()!;
    const nowMillis = Date.now();
    const decision = decideMediaCleanupClaim({
      status: data.status,
      attempts: data.attempts,
      leaseOwner: data.leaseOwner,
      leaseUntilMillis: cleanupTimestampMillis(data.leaseUntil),
      nextAttemptAtMillis: cleanupTimestampMillis(data.nextAttemptAt),
    }, nowMillis);
    if (decision.quarantine) {
      tx.update(taskRef, {
        status: 'quarantined',
        leaseOwner: admin.firestore.FieldValue.delete(),
        leaseUntil: admin.firestore.FieldValue.delete(),
        nextAttemptAt: admin.firestore.FieldValue.delete(),
        quarantinedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return null;
    }
    if (!decision.claim) return null;
    const leaseUntil = admin.firestore.Timestamp.fromMillis(
      nowMillis + mediaCleanupLeaseMillis
    );
    tx.update(taskRef, {
      status: 'processing',
      attempts: decision.nextAttempt,
      leaseOwner,
      leaseUntil,
      nextAttemptAt: leaseUntil,
      lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { leaseOwner, attempts: decision.nextAttempt };
  });
}

async function finishMediaGenerationCleanupTask(
  taskRef: admin.firestore.DocumentReference,
  task: MediaGenerationCleanupTask,
  claimed: ClaimedMediaGenerationCleanup
): Promise<void> {
  const expectedTaskId = mediaGenerationCleanupTaskId(
    task.bucket,
    task.objectPath,
    task.generation
  );
  if (taskRef.id !== expectedTaskId) {
    throw new Error('Media generation cleanup task ID mismatch');
  }
  if (task.bucket !== admin.storage().bucket().name) {
    throw new Error('Media generation cleanup bucket mismatch');
  }
  const parsed = parseMediaUploadObjectPath(task.objectPath);
  const validCanonical = task.cleanupKind === 'canonical' &&
    parsed != null &&
    parsed.authorizationId === task.authorizationId &&
    parsed.uid === task.uid &&
    parsed.kind === task.kind &&
    (parsed.kind !== 'chat' || parsed.matchId === task.matchId);
  const validLegacy = task.cleanupKind === 'legacy' &&
    task.authorizationId == null &&
    isLegacyPrivateMediaObjectPath(task.objectPath) &&
    task.uid === (task.objectPath.startsWith('chat_images/')
      ? task.objectPath.split('/')[2]
      : task.objectPath.split('/')[1]) &&
    task.kind === (task.objectPath.startsWith('chat_images/')
      ? 'chat'
      : 'profile') &&
    task.matchId === (task.objectPath.startsWith('chat_images/')
      ? task.objectPath.split('/')[1]
      : null);
  if (!validCanonical && !validLegacy) {
    throw new Error('Unsafe media generation cleanup task');
  }
  const bucket = admin.storage().bucket(task.bucket);
  await bucket
    .file(task.objectPath, { generation: task.generation })
    .delete({ ignoreNotFound: true });
  await db.runTransaction(async (tx) => {
    const freshTask = await tx.get(taskRef);
    if (!freshTask.exists) return;
    const freshData = freshTask.data()!;
    if (!isExactMediaGenerationCleanupTask(freshData, task)) {
      throw new Error(`Changed media generation cleanup ${taskRef.id}`);
    }
    const leaseIssue = mediaCleanupLeaseIssue({
      status: freshData.status,
      leaseOwner: freshData.leaseOwner,
      leaseUntilMillis: cleanupTimestampMillis(freshData.leaseUntil),
    }, {
      leaseOwner: claimed.leaseOwner,
      nowMillis: Date.now(),
    });
    if (leaseIssue != null) {
      throw new Error(`Media generation cleanup lease lost: ${leaseIssue}`);
    }
    if (task.authorizationId != null) {
      const authorizationRef = db
        .collection('mediaUploadAuthorizations')
        .doc(task.authorizationId);
      const authorizationSnap = await tx.get(authorizationRef);
      if (
        freshData.authorizationFenceCounted === true &&
        !authorizationSnap.exists
      ) {
        throw new Error('Cleanup authorization fence disappeared');
      }
      if (authorizationSnap.exists) {
        const dependencies = await tx.get(db
          .collection('mediaUploadGenerationCleanups')
          .where('authorizationId', '==', task.authorizationId)
          .limit(2));
        const remainingDependencyExists = dependencies.docs
          .some((doc) => doc.id !== taskRef.id);
        const currentCount = authorizationSnap
          .data()?.pendingGenerationCleanupCount;
        const nextCount = freshData.authorizationFenceCounted === true
          ? nextPendingGenerationCleanupCount(currentCount, -1)
          : currentCount;
        if (freshData.authorizationFenceCounted === true && nextCount == null) {
          throw new Error('Cleanup authorization fence is inconsistent');
        }
        const rearmRetirement =
          authorizationSnap.data()?.status !== 'consumed' &&
          authorizationSnap.data()?.retirementDeferred === true &&
          !remainingDependencyExists &&
          (nextCount == null || nextCount === 0);
        tx.update(authorizationRef, {
          ...(freshData.authorizationFenceCounted === true
            ? { pendingGenerationCleanupCount: nextCount }
            : {}),
          ...(rearmRetirement
            ? {
                expireAt: admin.firestore.Timestamp.now(),
                retirementDeferred: admin.firestore.FieldValue.delete(),
              }
            : {}),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }
    tx.delete(taskRef);
  });
}

async function recordMediaGenerationCleanupFailure(
  taskRef: admin.firestore.DocumentReference,
  task: MediaGenerationCleanupTask,
  claimed: ClaimedMediaGenerationCleanup,
  error: unknown
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(taskRef);
    const data = snap.data();
    if (
      !snap.exists ||
      !isExactMediaGenerationCleanupTask(data, task) ||
      data?.status !== 'processing' ||
      data.leaseOwner !== claimed.leaseOwner
    ) {
      return;
    }
    const quarantine = shouldQuarantineMediaCleanup(claimed.attempts);
    tx.update(taskRef, {
      status: quarantine ? 'quarantined' : 'pending',
      leaseOwner: admin.firestore.FieldValue.delete(),
      leaseUntil: admin.firestore.FieldValue.delete(),
      nextAttemptAt: quarantine
        ? admin.firestore.FieldValue.delete()
        : admin.firestore.Timestamp.fromMillis(
            Date.now() + mediaCleanupRetryDelayMillis(claimed.attempts)
          ),
      lastErrorMessage: String(error).slice(0, 300),
      ...(quarantine
        ? { quarantinedAt: admin.firestore.FieldValue.serverTimestamp() }
        : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
}

async function processMediaGenerationCleanupTask(
  taskRef: admin.firestore.DocumentReference,
  task: MediaGenerationCleanupTask
): Promise<boolean> {
  const claimed = await claimMediaGenerationCleanupTask(taskRef, task);
  if (claimed == null) return false;
  try {
    await finishMediaGenerationCleanupTask(taskRef, task, claimed);
    return true;
  } catch (error) {
    await recordMediaGenerationCleanupFailure(taskRef, task, claimed, error);
    throw error;
  }
}

export const onReservedMediaUploaded = functions.region(FUNCTION_REGION)
  .runWith({ failurePolicy: true })
  .storage.object()
  .onFinalize(async (object) => {
    const objectPath = object.name;
    if (typeof objectPath !== 'string') return null;
    const generation = object.generation;
    if (typeof generation !== 'string' || generation.length === 0) {
      throw new Error(`Uploaded media generation unavailable for ${objectPath}`);
    }
    const parsed = parseMediaUploadObjectPath(objectPath);
    if (parsed == null) {
      const legacy = parseLegacyPrivateMediaObjectPath(objectPath);
      // A legacy resumable session started before the strict-media cutover
      // remains a bearer capability for up to one week. The explicit
      // environment-bound server control stays disabled while old clients are
      // supported and is
      // enabled only after strict rules/version gates make every such finalize
      // unpublishable.
      if (legacy == null) return null;
      // Account deletion is a durable per-user fence, independent of the
      // environment-wide legacy cutover flag. A session started before the
      // tombstone can finalize for up to one week and must never resurrect the
      // deleted user's bytes.
      const deletionJobExists = (await db
        .collection('accountDeletionJobs')
        .doc(legacy.uid)
        .get()).exists;
      if (!deletionJobExists && !(await legacyPrivateMediaCutoverEnabled())) {
        return null;
      }
      const legacyTask: MediaGenerationCleanupTask = {
        cleanupKind: 'legacy',
        authorizationId: null,
        bucket: object.bucket,
        uid: legacy.uid,
        kind: legacy.kind,
        objectPath,
        matchId: legacy.matchId,
        generation,
      };
      const legacyTaskRef = db
        .collection('mediaUploadGenerationCleanups')
        .doc(mediaGenerationCleanupTaskId(object.bucket, objectPath, generation));
      await db.runTransaction(async (tx) => {
        await ensureMediaGenerationCleanupTask(
          tx,
          legacyTaskRef,
          legacyTask,
          deletionJobExists
            ? 'account_deletion_late_legacy_finalize'
            : 'legacy_cutover_late_finalize'
        );
      });
      await processMediaGenerationCleanupTask(legacyTaskRef, legacyTask);
      return null;
    }
    const authorizationRef = db
      .collection('mediaUploadAuthorizations')
      .doc(parsed.authorizationId);
    const expected = {
      uid: parsed.uid,
      kind: parsed.kind,
      objectPath,
      matchId: parsed.matchId,
    };
    const cleanupTask: MediaGenerationCleanupTask = {
      cleanupKind: 'canonical',
      authorizationId: parsed.authorizationId,
      bucket: object.bucket,
      uid: parsed.uid,
      kind: parsed.kind,
      objectPath,
      matchId: parsed.matchId ?? null,
      generation,
    };
    const cleanupTaskRef = db
      .collection('mediaUploadGenerationCleanups')
      .doc(mediaGenerationCleanupTaskId(object.bucket, objectPath, generation));
    const serverUploadContext = finalizedServerUploadContext(
      object.metadata as Record<string, unknown> | undefined,
      Date.now()
    );

    // Classify before downloading. A terminal, missing, or mismatched late
    // generation needs no content inspection and must first gain its own
    // durable cleanup task. Never overwrite the live authorization that binds
    // a different published generation.
    const initialDisposition = await db.runTransaction(async (tx) => {
      const snap = await tx.get(authorizationRef);
      const disposition = finalizedMediaDisposition(
        snap.exists ? snap.data() : undefined,
        expected,
        generation,
        serverUploadContext
      );
      if (disposition === 'cleanup-unpublishable') {
        await ensureMediaGenerationCleanupTask(
          tx,
          cleanupTaskRef,
          cleanupTask,
          snap.exists ? 'authorization_generation_mismatch' : 'authorization_missing'
        );
      }
      return disposition;
    });
    if (initialDisposition === 'cleanup-unpublishable') {
      await processMediaGenerationCleanupTask(cleanupTaskRef, cleanupTask);
      return null;
    }
    if (
      initialDisposition === 'preserve-server-upload' ||
      initialDisposition === 'preserve-live-authorization' ||
      initialDisposition === 'preserve-existing-cleanup'
    ) {
      return null;
    }
    if (initialDisposition === 'recover-server-upload') {
      if (serverUploadContext == null) {
        throw new Error('Server upload recovery marker disappeared');
      }
      await recoverExpiredServerMediaUpload({
        authorizationRef,
        uid: parsed.uid,
        marker: {
          leaseOwner: serverUploadContext.leaseOwner,
          payloadDigest: serverUploadContext.payloadDigest,
        },
      });
      return null;
    }

    const file = admin.storage()
      .bucket(object.bucket)
      .file(objectPath, { generation });
    let validJpeg: boolean;
    try {
      const [contents] = await file.download({ validation: 'crc32c' });
      const size = Number(object.size);
      validJpeg = object.contentType === 'image/jpeg' &&
        Number.isSafeInteger(size) &&
        size > 0 &&
        size <= mediaUploadMaxBytes &&
        contents.length === size &&
        safeJpegUploadIssue(contents) == null;
    } catch (error) {
      // failurePolicy retries transient inspection failures. Returning success
      // here could strand a terminal late generation outside every sweeper.
      console.error(`Unable to inspect uploaded media ${objectPath}:`, error);
      throw error;
    }

    const finalizeResult = await db.runTransaction(async (tx) => {
      const snap = await tx.get(authorizationRef);
      const authorizationData = snap.data();
      const disposition = finalizedMediaDisposition(
        snap.exists ? authorizationData : undefined,
        expected,
        generation,
        serverUploadContext
      );
      if (
        disposition === 'preserve-server-upload' ||
        disposition === 'preserve-live-authorization' ||
        disposition === 'preserve-existing-cleanup'
      ) {
        return 'unchanged' as const;
      }
      if (disposition === 'recover-server-upload') {
        return 'recover-server-upload' as const;
      }
      if (disposition === 'cleanup-unpublishable') {
        await ensureMediaGenerationCleanupTask(
          tx,
          cleanupTaskRef,
          cleanupTask,
          'authorization_changed_during_finalize'
        );
        return 'cleanup' as const;
      }

      const issue = mediaUploadAuthorizationIssue(
        authorizationData,
        expected,
        Date.now()
      );
      if (!validJpeg || issue != null) {
        await ensureMediaGenerationCleanupTask(
          tx,
          cleanupTaskRef,
          cleanupTask,
          !validJpeg ? 'invalid_jpeg' : `authorization_${issue}`
        );
        tx.update(authorizationRef, {
          status: 'rejected',
          rejectionReason: !validJpeg ? 'invalid_jpeg' : `authorization_${issue}`,
          expiresAt: admin.firestore.FieldValue.delete(),
          expireAt: admin.firestore.Timestamp.fromMillis(
            Date.now() + mediaUploadLateFinalizeRetentionMillis
          ),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return 'cleanup' as const;
      }
      tx.update(authorizationRef, {
        status: 'uploaded',
        uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
        uploadedGeneration: generation,
        uploadedSize: Number(object.size),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return 'uploaded' as const;
    });
    if (finalizeResult === 'cleanup') {
      await processMediaGenerationCleanupTask(cleanupTaskRef, cleanupTask);
    }
    if (finalizeResult === 'recover-server-upload') {
      if (serverUploadContext == null) {
        throw new Error('Server upload recovery marker disappeared');
      }
      await recoverExpiredServerMediaUpload({
        authorizationRef,
        uid: parsed.uid,
        marker: {
          leaseOwner: serverUploadContext.leaseOwner,
          payloadDigest: serverUploadContext.payloadDigest,
        },
      });
    }
    return null;
  });

const mediaCleanupReadyLimit = 100;
const mediaCleanupLegacyScanLimit = 100;
// Recovery may inspect and decode a full private-media object. Keep this lane
// deliberately small and run it only after every cheap cleanup/TTL lane so a
// saturated recovery backlog cannot starve durable generation cleanup.
const serverMediaRecoveryLimit = 10;

interface ClaimedMediaAuthorizationCleanup {
  ref: admin.firestore.DocumentReference;
  authorizationId: string;
  leaseOwner: string;
  attempts: number;
  objectPath: string;
  generation: string | null;
  sourceStatus: string;
  uid: unknown;
  kind: unknown;
  matchId: unknown;
}

function mediaAuthorizationCleanupState(
  data: FirebaseFirestore.DocumentData
): Parameters<typeof decideMediaCleanupClaim>[0] {
  return {
    status: data.cleanupState,
    attempts: data.cleanupAttempts,
    leaseOwner: data.cleanupLeaseOwner,
    leaseUntilMillis: cleanupTimestampMillis(data.cleanupLeaseUntil),
    nextAttemptAtMillis: cleanupTimestampMillis(data.cleanupNextAttemptAt),
  };
}

function isStorageNotFound(error: unknown): boolean {
  const storageError = error as {
    code?: unknown;
    response?: { statusCode?: unknown };
  };
  return Number(
    storageError.code ?? storageError.response?.statusCode
  ) === 404;
}

async function claimExpiredMediaAuthorizationCleanup(
  authorizationRef: admin.firestore.DocumentReference,
  now: admin.firestore.Timestamp
): Promise<ClaimedMediaAuthorizationCleanup | null> {
  const leaseOwner = randomUUID();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(authorizationRef);
    if (!snap.exists) return null;
    const data = snap.data()!;
    if (
      !['reserved', 'uploaded', 'confirming', 'confirmed'].includes(data.status) ||
      !(data.expiresAt instanceof admin.firestore.Timestamp) ||
      data.expiresAt.toMillis() > now.toMillis()
    ) {
      return null;
    }
    const parsed = parseMediaUploadObjectPath(data.objectPath);
    const validIdentity = parsed != null &&
      parsed.authorizationId === authorizationRef.id &&
      parsed.uid === data.uid &&
      parsed.kind === data.kind &&
      (parsed.kind !== 'chat' || parsed.matchId === data.matchId);
    const claim = validIdentity
      ? expiredMediaCleanupClaim(
          authorizationRef.id,
          data,
          now.toMillis()
        )
      : null;
    const canInspectLatest = validIdentity &&
      (data.status === 'reserved' || data.status === 'uploaded');
    if (claim == null && !canInspectLatest) {
      // Never guess a path or immutable generation. Quarantine keeps every
      // proof field available for operator remediation without blocking the
      // due-time queue.
      tx.update(authorizationRef, {
        status: 'cleanup_quarantined',
        cleanupState: 'quarantined',
        cleanupQuarantineReason: validIdentity
          ? 'missing_immutable_generation'
          : 'invalid_authorization_identity',
        expiredAt: data.expiresAt,
        expiresAt: admin.firestore.FieldValue.delete(),
        expireAt: admin.firestore.FieldValue.delete(),
        quarantinedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return null;
    }
    const attempts = 1;
    const leaseUntil = admin.firestore.Timestamp.fromMillis(
      Date.now() + mediaCleanupLeaseMillis
    );
    tx.update(authorizationRef, {
      status: 'cleanup_required',
      cleanupSourceStatus: data.status,
      cleanupGeneration: claim?.generation ?? admin.firestore.FieldValue.delete(),
      cleanupState: 'processing',
      cleanupAttempts: attempts,
      cleanupLeaseOwner: leaseOwner,
      cleanupLeaseUntil: leaseUntil,
      cleanupNextAttemptAt: leaseUntil,
      expiredAt: data.expiresAt,
      expiresAt: admin.firestore.FieldValue.delete(),
      expireAt: admin.firestore.FieldValue.delete(),
      lastCleanupAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return {
      ref: authorizationRef,
      authorizationId: authorizationRef.id,
      leaseOwner,
      attempts,
      objectPath: data.objectPath,
      generation: claim?.generation ?? null,
      sourceStatus: data.status,
      uid: data.uid,
      kind: data.kind,
      matchId: data.matchId,
    };
  });
}

async function claimQueuedMediaAuthorizationCleanup(
  authorizationRef: admin.firestore.DocumentReference,
  allowLegacy = false
): Promise<ClaimedMediaAuthorizationCleanup | null> {
  const leaseOwner = randomUUID();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(authorizationRef);
    if (!snap.exists) return null;
    const data = snap.data()!;
    if (data.status !== 'cleanup_required') {
      if (data.cleanupState != null) {
        const terminal = ['rejected', 'expired_without_object', 'consumed']
          .includes(data.status);
        tx.update(authorizationRef, {
          cleanupState: terminal
            ? admin.firestore.FieldValue.delete()
            : 'quarantined',
          cleanupLeaseOwner: admin.firestore.FieldValue.delete(),
          cleanupLeaseUntil: admin.firestore.FieldValue.delete(),
          cleanupNextAttemptAt: admin.firestore.FieldValue.delete(),
          ...(terminal
            ? {}
            : {
                cleanupQuarantineReason: 'unexpected_authorization_status',
                quarantinedAt: admin.firestore.FieldValue.serverTimestamp(),
              }),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      return null;
    }
    const queueState = data.cleanupState == null && allowLegacy
      ? { status: 'pending' as const, attempts: data.cleanupAttempts }
      : mediaAuthorizationCleanupState(data);
    const nowMillis = Date.now();
    const decision = decideMediaCleanupClaim(queueState, nowMillis);
    if (decision.quarantine) {
      tx.update(authorizationRef, {
        cleanupState: 'quarantined',
        cleanupLeaseOwner: admin.firestore.FieldValue.delete(),
        cleanupLeaseUntil: admin.firestore.FieldValue.delete(),
        cleanupNextAttemptAt: admin.firestore.FieldValue.delete(),
        quarantinedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return null;
    }
    if (!decision.claim) return null;
    const leaseUntil = admin.firestore.Timestamp.fromMillis(
      nowMillis + mediaCleanupLeaseMillis
    );
    tx.update(authorizationRef, {
      cleanupState: 'processing',
      cleanupAttempts: decision.nextAttempt,
      cleanupLeaseOwner: leaseOwner,
      cleanupLeaseUntil: leaseUntil,
      cleanupNextAttemptAt: leaseUntil,
      lastCleanupAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return {
      ref: authorizationRef,
      authorizationId: authorizationRef.id,
      leaseOwner,
      attempts: decision.nextAttempt,
      objectPath: data.objectPath,
      generation: typeof data.cleanupGeneration === 'string' &&
        data.cleanupGeneration.length > 0
        ? data.cleanupGeneration
        : null,
      sourceStatus: typeof data.cleanupSourceStatus === 'string'
        ? data.cleanupSourceStatus
        : 'legacy_cleanup_required',
      uid: data.uid,
      kind: data.kind,
      matchId: data.matchId,
    };
  });
}

async function persistClaimedAuthorizationGeneration(
  claimed: ClaimedMediaAuthorizationCleanup,
  generation: string
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(claimed.ref);
    const data = snap.data();
    const leaseIssue = mediaCleanupLeaseIssue(
      mediaAuthorizationCleanupState(data ?? {}),
      { leaseOwner: claimed.leaseOwner, nowMillis: Date.now() }
    );
    if (
      !snap.exists ||
      data?.status !== 'cleanup_required' ||
      leaseIssue != null ||
      (data.cleanupGeneration != null && data.cleanupGeneration !== generation)
    ) {
      throw new Error('Media authorization cleanup generation lease changed');
    }
    tx.update(claimed.ref, {
      cleanupGeneration: generation,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
}

async function completeClaimedMediaAuthorizationCleanup(
  claimed: ClaimedMediaAuthorizationCleanup,
  generation: string | null,
  noObject: boolean
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(claimed.ref);
    const data = snap.data();
    const leaseIssue = mediaCleanupLeaseIssue(
      mediaAuthorizationCleanupState(data ?? {}),
      { leaseOwner: claimed.leaseOwner, nowMillis: Date.now() }
    );
    if (
      !snap.exists ||
      data?.status !== 'cleanup_required' ||
      leaseIssue != null ||
      (!noObject && data.cleanupGeneration !== generation)
    ) {
      throw new Error('Media authorization cleanup lease changed');
    }
    tx.update(claimed.ref, {
      status: noObject ? 'expired_without_object' : 'rejected',
      rejectionReason: noObject
        ? 'authorization_expired'
        : 'authorization_expired_cleanup_complete',
      cleanupState: admin.firestore.FieldValue.delete(),
      cleanupGeneration: admin.firestore.FieldValue.delete(),
      cleanupLeaseOwner: admin.firestore.FieldValue.delete(),
      cleanupLeaseUntil: admin.firestore.FieldValue.delete(),
      cleanupNextAttemptAt: admin.firestore.FieldValue.delete(),
      expireAt: admin.firestore.Timestamp.fromMillis(
        Date.now() + mediaUploadLateFinalizeRetentionMillis
      ),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
}

async function recordMediaAuthorizationCleanupFailure(
  claimed: ClaimedMediaAuthorizationCleanup,
  error: unknown
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(claimed.ref);
    const data = snap.data();
    if (
      !snap.exists ||
      data?.status !== 'cleanup_required' ||
      data.cleanupState !== 'processing' ||
      data.cleanupLeaseOwner !== claimed.leaseOwner
    ) {
      return;
    }
    const quarantine = shouldQuarantineMediaCleanup(claimed.attempts);
    tx.update(claimed.ref, {
      cleanupState: quarantine ? 'quarantined' : 'pending',
      cleanupLeaseOwner: admin.firestore.FieldValue.delete(),
      cleanupLeaseUntil: admin.firestore.FieldValue.delete(),
      cleanupNextAttemptAt: quarantine
        ? admin.firestore.FieldValue.delete()
        : admin.firestore.Timestamp.fromMillis(
            Date.now() + mediaCleanupRetryDelayMillis(claimed.attempts)
          ),
      lastCleanupError: String(error).slice(0, 300),
      ...(quarantine
        ? { quarantinedAt: admin.firestore.FieldValue.serverTimestamp() }
        : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
}

async function processClaimedMediaAuthorizationCleanup(
  claimed: ClaimedMediaAuthorizationCleanup,
  bucket: ReturnType<ReturnType<typeof admin.storage>['bucket']>
): Promise<boolean> {
  try {
    const parsed = parseMediaUploadObjectPath(claimed.objectPath);
    if (
      parsed == null ||
      parsed.authorizationId !== claimed.authorizationId ||
      parsed.uid !== claimed.uid ||
      parsed.kind !== claimed.kind ||
      (parsed.kind === 'chat' && parsed.matchId !== claimed.matchId)
    ) {
      throw new Error('Unsafe media authorization cleanup path');
    }
    let generation = claimed.generation;
    if (generation == null) {
      if (
        claimed.sourceStatus !== 'reserved' &&
        claimed.sourceStatus !== 'uploaded'
      ) {
        throw new Error('Immutable cleanup generation is unavailable');
      }
      try {
        const [metadata] = await bucket.file(claimed.objectPath).getMetadata();
        if (
          typeof metadata.generation !== 'string' ||
          metadata.generation.length === 0
        ) {
          throw new Error('Cleanup object generation is unavailable');
        }
        const inspectedGeneration = metadata.generation;
        generation = inspectedGeneration;
        await persistClaimedAuthorizationGeneration(
          claimed,
          inspectedGeneration
        );
      } catch (error) {
        if (isStorageNotFound(error)) {
          await completeClaimedMediaAuthorizationCleanup(claimed, null, true);
          return true;
        }
        throw error;
      }
    }
    await bucket
      .file(claimed.objectPath, { generation })
      .delete({ ignoreNotFound: true });
    await completeClaimedMediaAuthorizationCleanup(
      claimed,
      generation,
      false
    );
    return true;
  } catch (error) {
    await recordMediaAuthorizationCleanupFailure(claimed, error);
    console.error(
      `Media authorization cleanup failed for ${claimed.authorizationId}:`,
      error
    );
    return false;
  }
}

async function mediaCleanupLegacyPage(
  collectionName: 'mediaUploadAuthorizations' | 'mediaUploadGenerationCleanups',
  cursorField: 'authorizationCursor' | 'generationCursor'
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const stateRef = db.collection('mediaUploadCleanupWorkerState').doc('scheduler');
  const stateSnap = await stateRef.get();
  const cursor = typeof stateSnap.data()?.[cursorField] === 'string'
    ? stateSnap.data()![cursorField] as string
    : null;
  let baseQuery: FirebaseFirestore.Query = db.collection(collectionName);
  if (collectionName === 'mediaUploadAuthorizations') {
    baseQuery = baseQuery.where('status', '==', 'cleanup_required');
  }
  let query = baseQuery
    .orderBy(admin.firestore.FieldPath.documentId())
    .limit(mediaCleanupLegacyScanLimit);
  if (cursor != null) query = query.startAfter(cursor);
  let snap = await query.get();
  if (snap.empty && cursor != null) {
    snap = await baseQuery
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(mediaCleanupLegacyScanLimit)
      .get();
  }
  const nextCursor = snap.empty || snap.size < mediaCleanupLegacyScanLimit
    ? null
    : snap.docs[snap.docs.length - 1].id;
  await stateRef.set({
    [cursorField]: nextCursor,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return snap.docs;
}

export const cleanupExpiredMediaUploads = functions.region(FUNCTION_REGION)
  .runWith({ timeoutSeconds: 540, memory: '512MB', maxInstances: 1 })
  .pubsub
  .schedule('every 15 minutes')
  .onRun(async () => {
    const now = admin.firestore.Timestamp.now();
    const bucket = admin.storage().bucket();
    let authorizationCleanupsProcessed = 0;
    let generationCleanupsProcessed = 0;

    // Due-time ordering plus a future nextAttemptAt on every lease/failure means
    // 100 failing documents cannot permanently hide document 101.
    const readyAuthorizations = await db
      .collection('mediaUploadAuthorizations')
      .where('cleanupState', 'in', ['pending', 'processing'])
      .where('cleanupNextAttemptAt', '<=', now)
      .orderBy('cleanupNextAttemptAt')
      .limit(mediaCleanupReadyLimit)
      .get();
    for (const doc of readyAuthorizations.docs) {
      const claimed = await claimQueuedMediaAuthorizationCleanup(doc.ref);
      if (
        claimed != null &&
        await processClaimedMediaAuthorizationCleanup(claimed, bucket)
      ) {
        authorizationCleanupsProcessed += 1;
      }
    }

    // Compatibility lane for reservations written before cleanupNextAttemptAt
    // existed. Every examined due document leaves this query in one transaction
    // by becoming cleanup_required or cleanup_quarantined.
    const expired = await db
      .collection('mediaUploadAuthorizations')
      .where('status', 'in', ['reserved', 'uploaded', 'confirming', 'confirmed'])
      .where('expiresAt', '<=', now)
      .orderBy('expiresAt')
      .limit(mediaCleanupLegacyScanLimit)
      .get();
    for (const authorizationDoc of expired.docs) {
      const claimed = await claimExpiredMediaAuthorizationCleanup(
        authorizationDoc.ref,
        now
      );
      if (
        claimed != null &&
        await processClaimedMediaAuthorizationCleanup(claimed, bucket)
      ) {
        authorizationCleanupsProcessed += 1;
      }
    }

    // A rotating document-id cursor upgrades cleanup_required records produced
    // by an older function revision. It cannot remain pinned behind one stable
    // first page, and the lease prevents duplicate external work.
    const legacyAuthorizationDocs = await mediaCleanupLegacyPage(
      'mediaUploadAuthorizations',
      'authorizationCursor'
    );
    for (const authorizationDoc of legacyAuthorizationDocs) {
      const data = authorizationDoc.data();
      if (
        data.status !== 'cleanup_required' ||
        data.cleanupState != null
      ) {
        continue;
      }
      const claimed = await claimQueuedMediaAuthorizationCleanup(
        authorizationDoc.ref,
        true
      );
      if (
        claimed != null &&
        await processClaimedMediaAuthorizationCleanup(claimed, bucket)
      ) {
        authorizationCleanupsProcessed += 1;
      }
    }

    // A single reservation can have multiple pre-started resumable sessions.
    // Every late immutable generation owns an independent durable cleanup
    // document so concurrent g2/g3 finalizes cannot overwrite one another or
    // mutate the live g1 authorization proof.
    const generationCleanups = await db
      .collection('mediaUploadGenerationCleanups')
      .where('status', 'in', ['pending', 'processing'])
      .where('nextAttemptAt', '<=', now)
      .orderBy('nextAttemptAt')
      .limit(mediaCleanupReadyLimit)
      .get();
    for (const cleanupDoc of generationCleanups.docs) {
      const cleanupData = cleanupDoc.data();
      const cleanupTask: MediaGenerationCleanupTask = {
        cleanupKind: cleanupData.cleanupKind,
        authorizationId: cleanupData.authorizationId,
        bucket: cleanupData.bucket,
        uid: cleanupData.uid,
        kind: cleanupData.kind,
        objectPath: cleanupData.objectPath,
        matchId: cleanupData.matchId,
        generation: cleanupData.generation,
      };
      try {
        if (!isExactMediaGenerationCleanupTask(cleanupData, cleanupTask)) {
          throw new Error(`Unsafe generation cleanup identity ${cleanupDoc.id}`);
        }
        if (await processMediaGenerationCleanupTask(cleanupDoc.ref, cleanupTask)) {
          generationCleanupsProcessed += 1;
        }
      } catch (error) {
        console.error(
          `Generation cleanup retry failed for ${cleanupDoc.id}:`,
          error
        );
      }
    }

    const legacyGenerationDocs = await mediaCleanupLegacyPage(
      'mediaUploadGenerationCleanups',
      'generationCursor'
    );
    for (const cleanupDoc of legacyGenerationDocs) {
      const cleanupData = cleanupDoc.data();
      if (
        (cleanupData.status !== 'pending' && cleanupData.status !== 'processing') ||
        cleanupData.nextAttemptAt instanceof admin.firestore.Timestamp
      ) {
        continue;
      }
      const cleanupTask: MediaGenerationCleanupTask = {
        cleanupKind: cleanupData.cleanupKind,
        authorizationId: cleanupData.authorizationId,
        bucket: cleanupData.bucket,
        uid: cleanupData.uid,
        kind: cleanupData.kind,
        objectPath: cleanupData.objectPath,
        matchId: cleanupData.matchId,
        generation: cleanupData.generation,
      };
      try {
        if (await processMediaGenerationCleanupTask(cleanupDoc.ref, cleanupTask)) {
          generationCleanupsProcessed += 1;
        }
      } catch (error) {
        console.error(
          `Legacy generation cleanup retry failed for ${cleanupDoc.id}:`,
          error
        );
      }
    }

    const [
      terminalAuthorizations,
      expiredQuotas,
      expiredReadQuotas,
      expiredUploadRequestQuotas,
    ] =
      await Promise.all([
      db
        .collection('mediaUploadAuthorizations')
        .where('expireAt', '<=', now)
        .limit(100)
        .get(),
      db
        .collection('mediaUploadQuotas')
        .where('expireAt', '<=', now)
        .limit(100)
        .get(),
      db
        .collection('privateMediaReadQuotas')
        .where('expireAt', '<=', now)
        .limit(100)
        .get(),
      db
        .collection('mediaUploadRequestQuotas')
        .where('expireAt', '<=', now)
        .limit(100)
        .get(),
      ]);
    let terminalAuthorizationsDeleted = 0;
    let consumedProofsRetained = 0;
    for (const doc of terminalAuthorizations.docs) {
      const outcome = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(doc.ref);
        if (
          !fresh.exists ||
          !(fresh.data()?.expireAt instanceof admin.firestore.Timestamp) ||
          fresh.data()!.expireAt.toMillis() > now.toMillis()
        ) {
          return 'unchanged' as const;
        }
        const data = fresh.data()!;
        if (data.status === 'consumed') {
          // Remove legacy TTL fields but retain the authorization forever as
          // the immutable-generation proof for a published profile/message.
          tx.update(doc.ref, {
            expireAt: admin.firestore.FieldValue.delete(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          return 'retained-consumed' as const;
        }
        const dependencyQuery = db
          .collection('mediaUploadGenerationCleanups')
          .where('authorizationId', '==', doc.id)
          .limit(1);
        const dependencies = await tx.get(dependencyQuery);
        if (!canRetireMediaAuthorization({
          status: data.status,
          pendingGenerationCleanupCount: data.pendingGenerationCleanupCount,
          hasGenerationCleanupDependency: !dependencies.empty,
        })) {
          // Leave the proof ledger in place but remove it from the first page
          // of the terminal query. The final dependent task re-arms expireAt
          // transactionally after it drops the fence count.
          tx.update(doc.ref, {
            expireAt: admin.firestore.FieldValue.delete(),
            retirementDeferred: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          return 'retained-dependent' as const;
        }
        // Task creation increments pendingGenerationCleanupCount in the same
        // transaction that creates the task. This delete therefore conflicts
        // and retries if a late finalize is concurrently establishing proof.
        tx.delete(doc.ref);
        return 'deleted' as const;
      });
      if (outcome === 'deleted') terminalAuthorizationsDeleted += 1;
      if (outcome === 'retained-consumed') consumedProofsRetained += 1;
    }

    const cleanupBatch = db.batch();
    expiredQuotas.docs.forEach((doc) => cleanupBatch.delete(doc.ref));
    expiredReadQuotas.docs.forEach((doc) => cleanupBatch.delete(doc.ref));
    expiredUploadRequestQuotas.docs.forEach(
      (doc) => cleanupBatch.delete(doc.ref)
    );
    if (
      expiredQuotas.size +
      expiredReadQuotas.size +
      expiredUploadRequestQuotas.size > 0
    ) {
      await cleanupBatch.commit();
    }

    // A callable can stop after the create-only Storage save but before its
    // final Firestore transaction. This is intentionally the final, bounded
    // lane: each item can inspect/decode up to 5 MiB, whereas every durable
    // cleanup and terminal quota lane above must run on every invocation.
    const expiredServerUploads = await db
      .collection('mediaUploadAuthorizations')
      .where('status', '==', 'server_uploading')
      .where('serverUploadLeaseUntil', '<=', now)
      .orderBy('serverUploadLeaseUntil')
      .limit(serverMediaRecoveryLimit)
      .get();
    let serverUploadsRecovered = 0;
    for (const doc of expiredServerUploads.docs) {
      const marker = serverMediaUploadMarkerFromAuthorization(doc.data());
      if (marker == null || typeof doc.data().uid !== 'string') {
        await db.runTransaction(async (tx) => {
          const fresh = await tx.get(doc.ref);
          if (
            fresh.exists &&
            fresh.data()?.status === 'server_uploading' &&
            fresh.data()?.serverUploadLeaseUntil instanceof
              admin.firestore.Timestamp &&
            fresh.data()!.serverUploadLeaseUntil.toMillis() <= now.toMillis()
          ) {
            tx.update(doc.ref, {
              status: 'cleanup_quarantined',
              cleanupState: 'quarantined',
              cleanupQuarantineReason: 'invalid_server_upload_marker',
              expiresAt: admin.firestore.FieldValue.delete(),
              expireAt: admin.firestore.FieldValue.delete(),
              quarantinedAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          }
        });
        continue;
      }
      try {
        const outcome = await recoverExpiredServerMediaUpload({
          authorizationRef: doc.ref,
          uid: doc.data().uid,
          marker,
        });
        if (outcome !== 'unchanged') serverUploadsRecovered += 1;
      } catch (error) {
        console.error(
          `Expired server media recovery failed for ${doc.id}:`,
          error
        );
      }
    }

    return {
      expiredReservationsScanned: expired.size,
      cleanupAuthorizationsReadyScanned: readyAuthorizations.size,
      authorizationCleanupsProcessed,
      generationCleanupsReadyScanned: generationCleanups.size,
      generationCleanupsProcessed,
      terminalAuthorizationsDeleted,
      consumedProofsRetained,
      quotaDocumentsDeleted: expiredQuotas.size,
      readQuotaDocumentsDeleted: expiredReadQuotas.size,
      uploadRequestQuotaDocumentsDeleted: expiredUploadRequestQuotas.size,
      expiredServerUploadsScanned: expiredServerUploads.size,
      serverUploadsRecovered,
    };
  });

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
export const requestCandidates = regionalFunctions.https.onCall(
  async (_data: any, context: functions.https.CallableContext) => {
    await requireAuthAndNotBanned(context);
    // Legacy swipe/quota discovery is not part of the current direct-chat
    // product and previously bypassed the unified public-profile policy.
    return {
      candidates: [],
      quotaRemaining: 0,
      quotaResetAt: null,
      deprecated: true,
    };
  }
);

/**
 * listDiscoveryProfiles(data: { limit?: number, excludeUids?: string[] })
 * -> { profiles: PublicProfile[], hasMore: boolean }
 *
 * Server-mediated discovery list for the current direct-chat product flow.
 * This does not consume points or candidate quota; points are charged only
 * when startChat creates a new 1:1 room.
 */
export const listDiscoveryProfiles = DISCOVERY_CALLABLE_RUNTIME.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);
    const limit = Math.min(
      Math.max(typeof data.limit === 'number' ? data.limit : 12, 1),
      20
    );
    const excludeUids = Array.isArray(data.excludeUids)
      ? data.excludeUids.filter((id: unknown): id is string => typeof id === 'string')
      : [];
    const excludeSet = new Set<string>([uid, ...excludeUids]);

    const mySnap = await db.collection('users').doc(uid).get();
    const myData = mySnap.data()!;
    assertEligibleExternalContentViewer(myData);
    const preferredNationality =
      myData.preferredNationality === 'all'
        ? 'any'
        : myData.preferredNationality || (myData.nationality === 'KR' ? 'JP' : 'KR');
    const preferredGender =
      myData.preferredGender === 'all' ? 'any' : myData.preferredGender || 'any';

    const blocksSnap = await db.collection('users').doc(uid).collection('blocks').get();

    blocksSnap.docs.forEach((d) => excludeSet.add(d.id));

    const preferredAgeMin = myData.preferredAgeMin || 20;
    const preferredAgeMax = myData.preferredAgeMax || 50;
    const referenceDate = new Date();
    const profiles: PublicProfile[] = [];
    const batchSize = 250;
    const maxScannedDocs = 1250;
    let scannedDocs = 0;
    let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined;

    while (profiles.length < limit && scannedDocs < maxScannedDocs) {
      let query: FirebaseFirestore.Query = db
        .collection('users')
        .where('onboardingCompleted', '==', true)
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(batchSize);
      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }

      const snap = await query.get();
      if (snap.empty) break;
      scannedDocs += snap.docs.length;
      lastDoc = snap.docs[snap.docs.length - 1];

      for (const doc of snap.docs) {
        if (excludeSet.has(doc.id)) continue;
        const profileData = doc.data();
        if (!isPublicUserProfile(profileData)) continue;
        if (
          preferredNationality !== 'any' &&
          profileData.nationality !== preferredNationality
        ) {
          continue;
        }
        if (preferredGender !== 'any' && profileData.gender !== preferredGender) {
          continue;
        }
        const dateOfBirth = parseValidDateOfBirth(profileData);
        if (dateOfBirth == null) continue;
        const age = ageOnReferenceDate(dateOfBirth, referenceDate);
        if (age == null || age < preferredAgeMin || age > preferredAgeMax) {
          continue;
        }
        if (await isBlockedByTarget(uid, doc.id)) continue;

        profiles.push(toPublicProfile(doc.id, profileData, myData));
        if (profiles.length >= limit) break;
      }

      if (snap.docs.length < batchSize) break;
    }

    return {
      profiles,
      hasMore: profiles.length >= limit,
    };
  }
);

/**
 * getPublicProfile(data: { uid: string }) -> { profile: PublicProfile }
 *
 * Returns a profile only if the caller is allowed to see it.
 */
export const getPublicProfile = regionalFunctions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const viewerUid = await requireAuthAndNotBanned(context);
    const targetUid = data.uid;

    if (typeof targetUid !== 'string' || targetUid.length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'uid must be a non-empty string'
      );
    }

    const [viewerSnap, targetSnap] = await Promise.all([
      db.collection('users').doc(viewerUid).get(),
      db.collection('users').doc(targetUid).get(),
    ]);
    await assertProfileVisible(
      viewerUid,
      targetUid,
      viewerSnap.data(),
      targetSnap.data()
    );

    return {
      profile: toPublicProfile(targetUid, targetSnap.data()!, viewerSnap.data()),
    };
  }
);

/**
 * translatePublicProfile(data: { uid: string, viewerUiLanguage?: 'ko' | 'ja' })
 * -> { profile: PublicProfile }
 *
 * Translates profile text only after the viewer explicitly asks for it. This
 * keeps Discovery and Profile Detail initial loads fast for App Review and
 * real users, especially from Korea/Japan to the current North America backend.
 */
export const translatePublicProfile = regionalFunctions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const viewerUid = await requireAuthAndNotBanned(context);
    const targetUid = data.uid;

    if (typeof targetUid !== 'string' || targetUid.length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'uid must be a non-empty string'
      );
    }

    const [viewerSnap, targetSnap] = await Promise.all([
      db.collection('users').doc(viewerUid).get(),
      db.collection('users').doc(targetUid).get(),
    ]);
    await assertProfileVisible(
      viewerUid,
      targetUid,
      viewerSnap.data(),
      targetSnap.data()
    );
    const viewerLang = callableViewerProfileLanguage(data, viewerSnap.data());

    return {
      profile: await toLocalizedPublicProfile(
        targetUid,
        targetSnap.data()!,
        viewerLang,
        targetSnap.ref,
        viewerSnap.data(),
        viewerUid
      ),
    };
  }
);

/**
 * getProfileDetail(data: { uid: string })
 * -> { profile: PublicProfile, isOwnProfile, hasActiveChat, hasAlreadyRated }
 *
 * Server-mediated profile detail state. This keeps private chat-room and rating
 * lookups out of the client, where Firestore rules cannot safely authorize the
 * broad queries needed for this screen.
 */
export const getProfileDetail = regionalFunctions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const viewerUid = await requireAuthAndNotBanned(context);
    const targetUid = data.uid;

    if (typeof targetUid !== 'string' || targetUid.length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'uid must be a non-empty string'
      );
    }

    const [viewerSnap, targetSnap] = await Promise.all([
      db.collection('users').doc(viewerUid).get(),
      db.collection('users').doc(targetUid).get(),
    ]);
    await assertProfileVisible(
      viewerUid,
      targetUid,
      viewerSnap.data(),
      targetSnap.data()
    );
    let hasActiveChat = false;
    let hasAlreadyRated = false;

    if (viewerUid !== targetUid) {
      const [matchId, ratingSnap] = await Promise.all([
        findMatch(viewerUid, targetUid),
        db.collection('ratings').doc(`${viewerUid}_${targetUid}`).get(),
      ]);
      hasActiveChat = matchId != null;
      hasAlreadyRated = ratingSnap.exists;
    }

    return {
      profile: toPublicProfile(targetUid, targetSnap.data()!, viewerSnap.data()),
      isOwnProfile: viewerUid === targetUid,
      hasActiveChat,
      hasAlreadyRated,
    };
  }
);

/**
 * likeUser(data: { targetUid: string })
 * -> { matched: boolean, matchId: string or null }
 *
 * Deprecated compatibility endpoint. Direct chat rooms may only be created by
 * startChat, which owns the one-point creation contract.
 */
export const likeUser = regionalFunctions.https.onCall(
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

    console.info('Deprecated likeUser call ignored', { uid, targetUid });
    return deprecatedLikeResult();
  }
);

/**
 * passUser(data: { targetUid: string }) -> { ok: true }
 *
 * Record a pass without any other state changes.
 */
export const passUser = regionalFunctions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);

    const targetUid = data.targetUid;

    if (typeof targetUid !== 'string' || targetUid.length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'targetUid must be a non-empty string'
      );
    }

    const callerRef = db.collection('users').doc(uid);
    const targetRef = db.collection('users').doc(targetUid);
    const seenRef = callerRef.collection('seen').doc(targetUid);
    await db.runTransaction(async (tx) => {
      const [callerSnap, targetSnap] = await Promise.all([
        tx.get(callerRef),
        tx.get(targetRef),
      ]);
      assertActiveAccountSnapshot(callerSnap);
      assertActiveAccountSnapshot(targetSnap, 'Target user');
      tx.set(seenRef, {
        seenAt: admin.firestore.FieldValue.serverTimestamp(),
        reason: 'pass',
      });
    });

    return { ok: true };
  }
);

/**
 * sendMessage(data: { matchId: string, clientRequestId?: string, originalText?: string, messageType?: 'text' | 'sticker' | 'image', stickerPack?: string, stickerId?: string, imagePath?: string }) -> { messageId: string, duplicate: boolean }
 *
 * Send a message in a match with verification and mutation of summary fields.
 * Current clients provide a UUID v4 clientRequestId so response-loss retries
 * resolve to the same document. The missing-id fallback keeps approved legacy
 * builds compatible until the minimum-version rollout gate is complete.
 */
export const sendMessage = regionalFunctions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);

    const matchId = data.matchId;
    const submittedClientRequestId = data.clientRequestId;
    const normalizedClientRequestId = normalizeClientRequestId(
      submittedClientRequestId
    );
    if (
      submittedClientRequestId != null &&
      normalizedClientRequestId == null
    ) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'clientRequestId must be a UUID v4'
      );
    }
    const clientRequestId = normalizedClientRequestId ?? randomUUID();
    const messageValidation = validateMessageKind(data, {
      matchId: data.matchId,
      uid,
    });

    if (typeof matchId !== 'string' || matchId.length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'matchId must be a non-empty string'
      );
    }

    if (!messageValidation.ok) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        messageValidation.reason === 'too-long'
          ? 'originalText must be 1000 characters or less'
          : messageValidation.reason === 'invalid-message-type'
            ? 'messageType must be text, sticker, or image'
          : messageValidation.reason === 'invalid-sticker-pack'
            ? 'stickerPack is not supported'
            : messageValidation.reason === 'invalid-sticker-id'
              ? 'stickerId is not supported'
              : messageValidation.reason === 'invalid-image-url'
                ? 'imageUrl is not accepted for new messages'
                : messageValidation.reason === 'invalid-image-path'
                  ? 'imagePath must be a valid chat image storage path'
                  : 'originalText must be a non-empty string'
      );
    }

    const originalText = messageValidation.originalText;
    const matchRef = db.collection('matches').doc(matchId);
    const messageRef = matchRef.collection('messages').doc(
      idempotentMessageDocumentId(uid, clientRequestId)
    );
    const messageId = messageRef.id;
    const existingMessageSnap = await messageRef.get();
    if (existingMessageSnap.exists) {
      if (!isMatchingIdempotentMessage(existingMessageSnap.data(), {
        senderUid: uid,
        clientRequestId,
      })) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Message idempotency key collision'
        );
      }
      return { messageId, duplicate: true };
    }
    const imageObjectPath = messageValidation.kind === 'image'
      ? messageValidation.imagePath
      : null;
    const imageAuthorizationRef = imageObjectPath == null
      ? null
      : mediaAuthorizationRefForObjectPath(imageObjectPath);
    const inspectedImageObject = imageObjectPath == null
      ? null
      : await assertConfirmedMediaForPublication(imageObjectPath);

    const created = await db.runTransaction(async (tx) => {
      const [matchSnap, messageSnap, imageAuthorizationSnap] = await Promise.all([
        tx.get(matchRef),
        tx.get(messageRef),
        imageAuthorizationRef == null
          ? Promise.resolve(null)
          : tx.get(imageAuthorizationRef),
      ]);

      if (messageSnap.exists) {
        if (!isMatchingIdempotentMessage(messageSnap.data(), {
          senderUid: uid,
          clientRequestId,
        })) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            'Message idempotency key collision'
          );
        }
        return false;
      }

      if (!matchSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Match not found');
      }

      const matchData = matchSnap.data()!;
      const userIds = matchData.userIds as string[] | undefined;
      if (!isExactDirectChatParticipants(userIds) || !userIds.includes(uid)) {
        throw directRoomUnavailable();
      }

      if (matchData.isActive !== true) {
        throw directRoomUnavailable();
      }

      const hiddenFor = matchData.hiddenFor as string[] | undefined;
      if (!Array.isArray(hiddenFor) || hiddenFor.length > 0) {
        throw directRoomUnavailable();
      }

      const otherUid = userIds.find((id) => id !== uid);
      if (!otherUid) {
        throw directRoomUnavailable();
      }

      const otherUserRef = db.collection('users').doc(otherUid);
      const callerBlockRef = db.collection('users').doc(uid).collection('blocks').doc(otherUid);
      const recipientBlockRef = db.collection('users').doc(otherUid).collection('blocks').doc(uid);
      const expectedUserIds = [uid, otherUid].sort();
      const pairKey = expectedUserIds.join('_');
      const pairRef = db.collection('chatPairs').doc(pairKey);
      const replyToMessageId = typeof data.replyToMessageId === 'string'
        ? data.replyToMessageId.trim()
        : '';
      const replyMessageRef = replyToMessageId.length > 0
        ? matchRef.collection('messages').doc(replyToMessageId)
        : null;
      const callerUserRef = db.collection('users').doc(uid);
      const [
        callerUserSnap,
        otherUserSnap,
        callerBlockSnap,
        recipientBlockSnap,
        replyMessageSnap,
        pairSnap,
      ] = await Promise.all([
        tx.get(callerUserRef),
        tx.get(otherUserRef),
        tx.get(callerBlockRef),
        tx.get(recipientBlockRef),
        replyMessageRef == null ? Promise.resolve(null) : tx.get(replyMessageRef),
        tx.get(pairRef),
      ]);

      if (activeAccountIssue({
        exists: callerUserSnap.exists,
        userData: callerUserSnap.data(),
      }) !== null) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Sender account is unavailable'
        );
      }

      if (
        activeAccountIssue({
          exists: otherUserSnap.exists,
          userData: otherUserSnap.data(),
        }) !== null
      ) {
        throw directRoomUnavailable();
      }

      if (callerBlockSnap.exists || recipientBlockSnap.exists) {
        throw directRoomUnavailable();
      }

      if (!reusableDirectRoomSnapshots({
        matchId,
        matchSnap,
        pairSnap,
        expectedUserIds,
        pairKey,
      })) {
        throw directRoomUnavailable();
      }

      if (replyMessageRef != null) {
        if (replyMessageSnap == null || !replyMessageSnap.exists) {
          throw new functions.https.HttpsError(
            'not-found',
            'Reply target message not found'
          );
        }
        const replyData = replyMessageSnap.data() ?? {};
        if (typeof replyData.senderId !== 'string') {
          throw new functions.https.HttpsError(
            'failed-precondition',
            'Reply target message is invalid'
          );
        }
      }

      const now = admin.firestore.Timestamp.now();
      const isSticker = messageValidation.kind === 'sticker';
      const isImage = messageValidation.kind === 'image';
      const truncatedPreview = isImage
        ? 'Photo'
        : isSticker
        ? 'Sticker'
        : originalText.length > 50
          ? originalText.substring(0, 50) + '...'
          : originalText;

      const messagePayload: admin.firestore.DocumentData = {
        messageId,
        senderId: uid,
        clientRequestId,
        createdAt: now,
        messageType: messageValidation.kind,
        originalText,
        originalLang: 'unknown',
        translations: { ko: null, ja: null },
        translationStatus: isSticker || isImage ? 'skipped' : 'pending',
        deletedForSender: false,
        reactions: {},
      };

      if (replyMessageSnap != null && replyMessageSnap.exists) {
        const replyData = replyMessageSnap.data() ?? {};
        const replyPreview = messageReplyPreview(replyData);
        messagePayload.replyToMessageId = replyMessageSnap.id;
        messagePayload.replyPreview = replyPreview;
        messagePayload.replySenderId = replyData.senderId;
      }

      if (isSticker) {
        messagePayload.stickerPack = messageValidation.stickerPack;
        messagePayload.stickerId = messageValidation.stickerId;
        messagePayload.stickerAsset = messageValidation.stickerAsset;
      }

      if (isImage) {
        if (!messageValidation.imagePath.startsWith(`chat_images/${matchId}/${uid}/`)) {
          throw new functions.https.HttpsError(
            'permission-denied',
            'Image path does not belong to this chat sender'
          );
        }
        if (imageAuthorizationSnap == null || inspectedImageObject == null) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            'Image upload authorization is missing'
          );
        }
        consumeMediaAuthorization(
          tx,
          imageAuthorizationSnap,
          {
            uid,
            kind: 'chat',
            matchId,
            objectPath: messageValidation.imagePath,
          },
          now,
          'sendMessage',
          inspectedImageObject
        );
        messagePayload.imagePath = messageValidation.imagePath;
      }

      tx.set(messageRef, messagePayload);

      tx.update(matchRef, {
        lastMessageAt: now,
        lastMessagePreview: truncatedPreview,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return true;
    });

    return { messageId, duplicate: !created };
  }
);

/**
 * retryMessageTranslation(data: { matchId: string, messageId: string })
 * -> { ok: true, targetLang: 'ko' | 'ja' }
 *
 * Retries translation for one message into the caller's reading language.
 */
export const retryMessageTranslation = regionalFunctions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);
    const matchId = data.matchId;
    const messageId = data.messageId;

    if (typeof matchId !== 'string' || matchId.length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'matchId must be a non-empty string'
      );
    }

    if (typeof messageId !== 'string' || messageId.length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'messageId must be a non-empty string'
      );
    }

    const matchRef = db.collection('matches').doc(matchId);
    const messageRef = matchRef.collection('messages').doc(messageId);
    const [matchSnap, messageSnap, userSnap] = await Promise.all([
      matchRef.get(),
      messageRef.get(),
      db.collection('users').doc(uid).get(),
    ]);

    if (!matchSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Match not found');
    }

    if (!messageSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Message not found');
    }

    const matchData = matchSnap.data()!;
    if (!isExactDirectChatParticipants(matchData.userIds) ||
      !matchData.userIds.includes(uid)) {
      throw directRoomUnavailable();
    }

    if (
      matchData.isActive !== true ||
      !Array.isArray(matchData.hiddenFor) ||
      matchData.hiddenFor.length > 0
    ) {
      throw directRoomUnavailable();
    }

    const otherUid = (matchData.userIds as string[]).find((id) => id !== uid);
    if (!otherUid) {
      throw directRoomUnavailable();
    }

    const expectedUserIds = [uid, otherUid].sort();
    const pairKey = expectedUserIds.join('_');
    const [
      callerBlockedOther,
      otherBlockedCaller,
      otherUserSnap,
      pairSnap,
    ] = await Promise.all([
      db.collection('users').doc(uid).collection('blocks').doc(otherUid).get(),
      db.collection('users').doc(otherUid).collection('blocks').doc(uid).get(),
      db.collection('users').doc(otherUid).get(),
      db.collection('chatPairs').doc(pairKey).get(),
    ]);

    if (
      activeAccountIssue({
        exists: otherUserSnap.exists,
        userData: otherUserSnap.data(),
      }) !== null ||
      callerBlockedOther.exists ||
      otherBlockedCaller.exists ||
      !reusableDirectRoomSnapshots({
        matchId,
        matchSnap,
        pairSnap,
        expectedUserIds,
        pairKey,
      })
    ) {
      throw directRoomUnavailable();
    }

    const messageData = messageSnap.data()!;
    if (messageData.messageType === 'sticker' || messageData.messageType === 'image') {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'This message is not translatable'
      );
    }

    if (usersShareNationality(userSnap.data(), otherUserSnap.data())) {
      await writeMessageTranslationForActiveAccount(uid, otherUid, matchRef, messageRef, {
        originalLang: 'unknown',
        translationStatus: 'skipped',
        translations: { ko: null, ja: null },
        translatedTargetLangs: [],
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { ok: true, targetLang: 'none' };
    }

    const originalText = messageData.originalText;
    if (typeof originalText !== 'string' || originalText.trim().length === 0) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Message has no original text'
      );
    }

    const originalLang =
      normalizeDetectedLanguage(messageData.originalLang) === 'unknown'
        ? await detectLanguageWithApi(originalText)
        : normalizeDetectedLanguage(messageData.originalLang);
    const targetLang = profileLanguage(userSnap.data(), oppositeLanguage(originalLang));

    if (
      !hasTranslatableText(originalText) ||
      !messageNeedsTranslationForRecipient(originalLang, userSnap.data())
    ) {
      await writeMessageTranslationForActiveAccount(uid, otherUid, matchRef, messageRef, {
        originalLang,
        translationStatus: 'skipped',
        translations: { ko: null, ja: null },
        translatedTargetLangs: [],
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { ok: true, targetLang };
    }

    const translatedText = originalLang === targetLang
      ? originalText
      : await callGoogleTranslate(originalText, targetLang);

    await writeMessageTranslationForActiveAccount(uid, otherUid, matchRef, messageRef, {
      originalLang,
      translations: {
        [targetLang]: translatedText,
      },
      translationStatus: 'done',
      translatedTargetLangs: admin.firestore.FieldValue.arrayUnion(targetLang),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { ok: true, targetLang };
  }
);

/**
 * setMessageReaction(data: { matchId: string, messageId: string, emoji?: string })
 * -> { ok: true }
 *
 * Sets or clears the caller's reaction on a chat message.
 */
export const setMessageReaction = regionalFunctions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);
    const matchId = data.matchId;
    const messageId = data.messageId;
    const emoji = typeof data.emoji === 'string' ? data.emoji.trim() : '';

    if (typeof matchId !== 'string' || matchId.length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'matchId must be a non-empty string'
      );
    }
    if (typeof messageId !== 'string' || messageId.length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'messageId must be a non-empty string'
      );
    }
    if (emoji.length > 0 && !allowedMessageReactions.includes(emoji)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'emoji is not supported'
      );
    }

    const matchRef = db.collection('matches').doc(matchId);
    const messageRef = matchRef.collection('messages').doc(messageId);
    const userRef = db.collection('users').doc(uid);
    await db.runTransaction(async (tx) => {
      const [matchSnap, messageSnap, userSnap] = await Promise.all([
        tx.get(matchRef),
        tx.get(messageRef),
        tx.get(userRef),
      ]);
      assertActiveAccountSnapshot(userSnap);
      if (!matchSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Match not found');
      }
      if (!messageSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Message not found');
      }
      const matchData = matchSnap.data()!;
      await assertActiveDirectRoomMutation(tx, uid, matchId, matchData);

      tx.update(messageRef, {
        [`reactions.${uid}`]: emoji.length > 0
          ? emoji
          : admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return { ok: true };
  }
);

/**
 * leaveChat(data: { matchId: string }) -> { ok: true }
 *
 * Close an active chat for both users and notify the other user.
 */
export const leaveChat = regionalFunctions.https.onCall(
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
    const userRef = db.collection('users').doc(uid);
    let otherUid = '';
    const closed = await db.runTransaction(async (tx) => {
      const [matchSnap, userSnap] = await Promise.all([
        tx.get(matchRef),
        tx.get(userRef),
      ]);
      assertActiveAccountSnapshot(userSnap);
      if (!matchSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Match not found');
      }

      const matchData = matchSnap.data()!;
      const userIds = matchData.userIds as string[] | undefined;
      if (
        !Array.isArray(userIds) ||
        userIds.length !== 2 ||
        new Set(userIds).size !== 2 ||
        !userIds.includes(uid)
      ) {
        throw new functions.https.HttpsError(
          'permission-denied',
          'User not in this match'
        );
      }

      otherUid = userIds.find((id) => id !== uid) ?? '';
      const sortedUserIds = [...userIds].sort();
      const pairKey = sortedUserIds.join('_');
      const pairRef = db.collection('chatPairs').doc(pairKey);
      const pairSnap = await tx.get(pairRef);
      const callClosures = await readActiveCallClosures(
        tx,
        [matchId],
        sortedUserIds
      );
      const now = admin.firestore.Timestamp.now();
      const decision = decideCloseActiveChatPolicy({
        matchId,
        matchExists: true,
        matchActive: matchData.isActive === true,
        matchUserIds: userIds,
        actorUid: uid,
        targetUid: otherUid,
        pairActiveMatchId: pairSnap.data()?.activeMatchId,
      });

      // A repeated leave for a historical room is idempotent and must never
      // clear a concurrently-created replacement room's pair pointer.
      if (!decision.closeMatch) {
        stageActiveCallClosures(tx, callClosures, {
          actorUid: uid,
          closedReason: 'left_chat',
          now,
        });
        return false;
      }

      tx.update(matchRef, {
        isActive: false,
        hiddenFor: admin.firestore.FieldValue.arrayUnion(...userIds),
        closedBy: uid,
        closedReason: 'left_chat',
        closedAt: now,
        updatedAt: now,
      });

      if (decision.clearPairPointer) {
        tx.set(
          pairRef,
          {
            pairKey,
            userIds: sortedUserIds,
            activeMatchId: admin.firestore.FieldValue.delete(),
            closedMatchId: matchId,
            closedReason: 'left_chat',
            updatedAt: now,
          },
          { merge: true }
        );
      }
      stageActiveCallClosures(tx, callClosures, {
        actorUid: uid,
        closedReason: 'left_chat',
        now,
      });
      return true;
    });

    if (closed && otherUid) {
      await notifyChatRemoved(otherUid, matchId);
    }

    return { ok: true };
  }
);

/**
 * setChatFavorite(data: { matchId: string, favorite: boolean }) -> { ok: true }
 */
export const setChatFavorite = regionalFunctions.https.onCall(
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
    const userRef = db.collection('users').doc(uid);
    await db.runTransaction(async (tx) => {
      const [matchSnap, userSnap] = await Promise.all([
        tx.get(matchRef),
        tx.get(userRef),
      ]);
      assertActiveAccountSnapshot(userSnap);
      if (!matchSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Match not found');
      }
      const matchData = matchSnap.data()!;
      await assertActiveDirectRoomMutation(tx, uid, matchId, matchData);
      tx.update(matchRef, {
        [`favoriteFor.${uid}`]: favorite,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return { ok: true };
  }
);

/**
 * markChatRead(data: { matchId: string }) -> { ok: true }
 *
 * Clears the caller's unread badge for an active chat they can access.
 */
export const markChatRead = regionalFunctions.https.onCall(
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
    const userRef = db.collection('users').doc(uid);
    await db.runTransaction(async (tx) => {
      const [matchSnap, userSnap] = await Promise.all([
        tx.get(matchRef),
        tx.get(userRef),
      ]);
      assertActiveAccountSnapshot(userSnap);
      if (!matchSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Match not found');
      }
      const matchData = matchSnap.data()!;
      await assertActiveDirectRoomMutation(tx, uid, matchId, matchData);
      tx.update(matchRef, {
        [`unread.${uid}`]: 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return { ok: true };
  }
);

export const listLoungePosts = regionalFunctions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);
    const limit = Math.min(
      Math.max(typeof data.limit === 'number' ? data.limit : 50, 1),
      50
    );
    const [mySnap, hiddenUsers] = await Promise.all([
      db.collection('users').doc(uid).get(),
      hiddenUserSetFor(uid),
    ]);
    assertEligibleExternalContentViewer(mySnap.data());
    hiddenUsers.delete(uid);

    const snap = await db
      .collection('posts')
      .orderBy('createdAt', 'desc')
      .limit(Math.min(Math.max(limit * 3, limit), 60))
      .get();

    const visibleDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    for (const doc of snap.docs) {
      const postData = doc.data();
      const authorUid = postData.uid as string | undefined;
      if (authorUid && hiddenUsers.has(authorUid)) continue;
      if (!(await canViewLoungePostAuthor(uid, authorUid, postData))) continue;
      visibleDocs.push(doc);
      if (visibleDocs.length >= limit) break;
    }

    const likedSnaps = await Promise.all(
      visibleDocs.map((d) =>
        db.collection('post_likes').doc(d.id).collection('likes').doc(uid).get()
      )
    );

    return {
      myNationality: mySnap.data()?.nationality ?? 'KR',
      posts: visibleDocs.map((d, i) =>
        toLoungePost(d.id, d.data(), likedSnaps[i].exists)
      ),
    };
  }
);

export const createLoungePost = regionalFunctions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);
    const content = typeof data.content === 'string' ? data.content.trim() : '';
    const category = typeof data.category === 'string' ? data.category.trim() : '';
    const allowedCategories = new Set(['일상', '언어교환', '맛집', '여행', '질문']);

    if (content.length === 0 || content.length > 1000) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'content must be between 1 and 1000 characters'
      );
    }

    if (!allowedCategories.has(category)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'invalid category'
      );
    }

    const userSnap = await db.collection('users').doc(uid).get();
    const userData = userSnap.data() ?? {};
    assertEligibleExternalContentViewer(userData);
    if (!isPublicUserProfile(userData)) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Complete your profile before posting'
      );
    }
    const postRef = db.collection('posts').doc();
    const userRef = db.collection('users').doc(uid);
    const todayKey = kstDateKey();

    const grantResult = await db.runTransaction(async (tx) => {
      const freshUserSnap = await tx.get(userRef);
      const freshUserData = assertActiveAccountSnapshot(freshUserSnap);
      assertEligibleExternalContentViewer(freshUserData);
      if (!isPublicUserProfile(freshUserData)) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Complete your profile before posting'
        );
      }
      const freshPhotoUrls = Array.isArray(freshUserData.photoUrls)
        ? freshUserData.photoUrls
        : [];
      const shouldGrant = shouldGrantDailyLoungePostPoints(
        freshUserData.lastLoungePostPointGrantDate,
        todayKey
      );
      const currentKeyCount = shouldGrant
        ? pointBalanceForServerGrant(freshUserData)
        : requireTrustedPointBalance(freshUserData);
      const nextKeyCount = shouldGrant
        ? pointBalanceAfterGrant(currentKeyCount, dailyLoungePostPointGrantAmount)
        : currentKeyCount;

      tx.set(postRef, {
        uid,
        authorName: freshUserData.displayName ?? context.auth?.token.name ?? 'User',
        authorPhotoUrl: freshPhotoUrls.length > 0 ? freshPhotoUrls[0] : '',
        authorNationality: freshUserData.nationality ?? 'KR',
        authorGender: freshUserData.gender ?? 'female',
        category,
        content,
        imageUrls: [],
        likeCount: 0,
        commentCount: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      if (shouldGrant) {
        const pointEventRef = db.collection('pointEvents').doc();
        tx.update(userRef, {
          keyCount: nextKeyCount,
          pointBalanceTrustVersion,
          lastLoungePostPointGrantDate: todayKey,
          lastLoungePostPointGrantAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        tx.set(pointEventRef, {
          uid,
          eventType: 'grant',
          amount: dailyLoungePostPointGrantAmount,
          reason: 'Daily lounge post reward',
          source: 'lounge_post',
          balanceBefore: currentKeyCount,
          balanceAfter: nextKeyCount,
          timestamp: admin.firestore.Timestamp.now(),
        } satisfies QuotaEventData);
      }

      return {
        granted: shouldGrant,
        pointsGranted: shouldGrant ? dailyLoungePostPointGrantAmount : 0,
        keyCount: nextKeyCount,
      };
    });

    return { ok: true, postId: postRef.id, ...grantResult };
  }
);

export const getLoungePost = regionalFunctions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);
    const postId = data.postId;

    if (typeof postId !== 'string' || postId.length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'postId must be a non-empty string'
      );
    }

    const [postSnap, likedSnap, mySnap] = await Promise.all([
      db.collection('posts').doc(postId).get(),
      db.collection('post_likes').doc(postId).collection('likes').doc(uid).get(),
      db.collection('users').doc(uid).get(),
    ]);

    if (!postSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Post not found');
    }

    assertEligibleExternalContentViewer(mySnap.data());
    await assertCanViewLoungePostAuthor(uid, postSnap.data()?.uid, postSnap.data());

    return {
      myNationality: mySnap.data()?.nationality ?? 'KR',
      post: toLoungePost(postSnap.id, postSnap.data()!, likedSnap.exists),
    };
  }
);

export const listLoungeComments = regionalFunctions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);
    const postId = data.postId;

    if (typeof postId !== 'string' || postId.length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'postId must be a non-empty string'
      );
    }

    const postRef = db.collection('posts').doc(postId);
    const [postSnap, mySnap] = await Promise.all([
      postRef.get(),
      db.collection('users').doc(uid).get(),
    ]);
    if (!postSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Post not found');
    }
    assertEligibleExternalContentViewer(mySnap.data());
    await assertCanViewLoungePostAuthor(uid, postSnap.data()?.uid, postSnap.data());

    const hiddenUsers = await hiddenUserSetFor(uid);
    hiddenUsers.delete(uid);
    const commentsSnap = await postRef.collection('comments').orderBy('createdAt').get();
    const comments = [];

    for (const commentDoc of commentsSnap.docs) {
      const commentData = commentDoc.data();
      const commentUid = commentData.uid as string | undefined;
      if (commentUid && hiddenUsers.has(commentUid)) continue;
      if (!(await canViewLoungePostAuthor(uid, commentUid))) continue;

      const repliesSnap = await commentDoc.ref.collection('replies').orderBy('createdAt').get();
      const replies = [];
      for (const replyDoc of repliesSnap.docs) {
        const reply = {
          id: replyDoc.id,
          ...replyDoc.data(),
        } as FirebaseFirestore.DocumentData;
        const replyUid = reply.uid as string | undefined;
        if (replyUid && hiddenUsers.has(replyUid)) continue;
        if (!(await canViewLoungePostAuthor(uid, replyUid))) continue;
        replies.push(reply);
      }

      comments.push({
        id: commentDoc.id,
        ...commentData,
        replies,
      });
    }

    return { comments };
  }
);

export const togglePostLike = regionalFunctions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);
    const postId = data.postId;

    if (typeof postId !== 'string' || postId.length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'postId must be a non-empty string'
      );
    }

    const postRef = db.collection('posts').doc(postId);
    const likeRef = db.collection('post_likes').doc(postId).collection('likes').doc(uid);
    const userRef = db.collection('users').doc(uid);
    const postSnap = await postRef.get();
    if (!postSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Post not found');
    }
    await assertCanViewLoungePostAuthor(uid, postSnap.data()?.uid, postSnap.data());

    return db.runTransaction(async (transaction) => {
      const [freshPostSnap, likeSnap, userSnap] = await Promise.all([
        transaction.get(postRef),
        transaction.get(likeRef),
        transaction.get(userRef),
      ]);
      assertActiveAccountSnapshot(userSnap);
      assertEligibleExternalContentViewer(userSnap.data());

      if (!freshPostSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Post not found');
      }
      await assertActiveLoungeAuthorMutation(
        transaction,
        uid,
        freshPostSnap.data()?.uid,
        userSnap,
        freshPostSnap.data()
      );

      const liked = !likeSnap.exists;
      if (liked) {
        transaction.set(likeRef, {
          uid,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        transaction.update(postRef, {
          likeCount: admin.firestore.FieldValue.increment(1),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        transaction.delete(likeRef);
        transaction.update(postRef, {
          likeCount: admin.firestore.FieldValue.increment(-1),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      const currentLikeCount =
        typeof freshPostSnap.data()?.likeCount === 'number'
          ? freshPostSnap.data()!.likeCount
          : 0;
      return {
        liked,
        likeCount: Math.max(0, currentLikeCount + (liked ? 1 : -1)),
      };
    });
  }
);

/**
 * addPostComment(data: { postId: string, content: string }) -> { commentId: string }
 */
export const addPostComment = regionalFunctions.https.onCall(
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
    await assertCanViewLoungePostAuthor(uid, postSnap.data()?.uid, postSnap.data());

    const userData = userSnap.data() || {};
    assertEligibleExternalContentViewer(userData);
    if (!isPublicUserProfile(userData)) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Complete your profile before commenting'
      );
    }
    const commentRef = db
      .collection('posts')
      .doc(postId)
      .collection('comments')
      .doc();

    const postRef = db.collection('posts').doc(postId);
    const userRef = db.collection('users').doc(uid);
    await db.runTransaction(async (tx) => {
      const [freshPost, freshUser] = await Promise.all([
        tx.get(postRef),
        tx.get(userRef),
      ]);
      if (!freshPost.exists) {
        throw new functions.https.HttpsError('not-found', 'Post not found');
      }
      const freshUserData = assertActiveAccountSnapshot(freshUser);
      assertEligibleExternalContentViewer(freshUserData);
      if (!isPublicUserProfile(freshUserData)) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Complete your profile before commenting'
        );
      }
      await assertActiveLoungeAuthorMutation(
        tx,
        uid,
        freshPost.data()?.uid,
        freshUser,
        freshPost.data()
      );
      tx.set(commentRef, {
        commentId: commentRef.id,
        uid,
        authorName: freshUserData.displayName || '',
        authorPhotoUrl: firstPhoto(freshUserData),
        authorNationality: freshUserData.nationality || 'KR',
        authorGender: freshUserData.gender || 'female',
        content,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        deleted: false,
      });
      tx.update(postRef, {
        commentCount: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return { commentId: commentRef.id };
  }
);

/**
 * addPostReply(data: { postId: string, commentId: string, content: string })
 * -> { replyId: string }
 */
export const addPostReply = regionalFunctions.https.onCall(
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
    await assertCanViewLoungePostAuthor(uid, postSnap.data()?.uid, postSnap.data());

    if (!commentSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Comment not found');
    }
    await assertCanViewLoungePostAuthor(uid, commentSnap.data()?.uid);

    const userData = userSnap.data() || {};
    assertEligibleExternalContentViewer(userData);
    if (!isPublicUserProfile(userData)) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Complete your profile before replying'
      );
    }
    const replyRef = commentRef.collection('replies').doc();

    const userRef = db.collection('users').doc(uid);
    await db.runTransaction(async (tx) => {
      const [freshPost, freshComment, freshUser] = await Promise.all([
        tx.get(postRef),
        tx.get(commentRef),
        tx.get(userRef),
      ]);
      if (!freshPost.exists) {
        throw new functions.https.HttpsError('not-found', 'Post not found');
      }
      if (!freshComment.exists) {
        throw new functions.https.HttpsError('not-found', 'Comment not found');
      }
      const freshUserData = assertActiveAccountSnapshot(freshUser);
      assertEligibleExternalContentViewer(freshUserData);
      if (!isPublicUserProfile(freshUserData)) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Complete your profile before replying'
        );
      }
      await assertActiveLoungeAuthorMutation(
        tx,
        uid,
        freshPost.data()?.uid,
        freshUser,
        freshPost.data()
      );
      await assertActiveLoungeAuthorMutation(
        tx,
        uid,
        freshComment.data()?.uid,
        freshUser
      );
      tx.set(replyRef, {
        replyId: replyRef.id,
        uid,
        authorName: freshUserData.displayName || '',
        authorPhotoUrl: firstPhoto(freshUserData),
        authorNationality: freshUserData.nationality || 'KR',
        authorGender: freshUserData.gender || 'female',
        content,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        deleted: false,
      });
      tx.update(commentRef, {
        replyCount: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      tx.update(postRef, {
        commentCount: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return { replyId: replyRef.id };
  }
);

/**
 * Accepts an account-deletion request and opportunistically processes durable
 * leased phases. A scheduled worker resumes any phase after a crash, including
 * legacy storage/auth retry states. Returning pending=true means the identity
 * is already tombstoned and can no longer create user-owned data.
 */
export const deleteAccount = functions.region(FUNCTION_REGION)
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .https.onCall(
    async (_data: any, context: functions.https.CallableContext) => {
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

      const uid = context.auth.uid;
      const enqueueResult = await accountDeletionProcessor.enqueue(uid);
      if (enqueueResult === 'complete') {
        return { ok: true, pending: false };
      }
      const result = await accountDeletionProcessor.process(uid, 6);
      return { ok: true, pending: result.pending };
    }
  );

/**
 * Resumes stale deleting/storage/auth jobs under phase and lease fencing.
 * Bounded scans avoid one scheduled invocation monopolizing the project.
 */
export const processAccountDeletionJobs = functions.region(FUNCTION_REGION)
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .pubsub.schedule('every 15 minutes')
  .onRun(async () => {
    const result = await accountDeletionProcessor.processRunnableJobs();
    console.log('Account deletion worker completed', result);
    return null;
  });

/**
 * blockUser(data: { targetUid: string, reason?: string }) -> { ok: true }
 *
 * Block a user and deactivate any active match.
 */
export const blockUser = regionalFunctions.https.onCall(
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
    const now = admin.firestore.Timestamp.now();

    // Write block entry
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
    const callerRef = db.collection('users').doc(uid);
    const targetRef = db.collection('users').doc(targetUid);

    const closedMatchIds = await db.runTransaction(async (tx) => {
      const [callerSnap, freshTargetSnap] = await Promise.all([
        tx.get(callerRef),
        tx.get(targetRef),
      ]);
      assertActiveAccountSnapshot(callerSnap);
      const targetData = assertActiveAccountSnapshot(freshTargetSnap, 'Target user');
      const closedIds = await stageAllActivePairSafetyClosures(tx, {
        actorUid: uid,
        targetUid,
        closedReason: 'blocked',
      });
      tx.set(blockRef, {
        blockedAt: now,
        reason,
        targetUid,
        displayName: targetData.displayName || '',
        photoUrl: firstPhoto(targetData),
        nationality: targetData.nationality || 'JP',
        gender: targetData.gender || 'female',
      });

      tx.set(seenRef, {
        seenAt: now,
        reason: 'block',
      });
      return closedIds;
    });

    if (closedMatchIds.length > 0) {
      await notifyChatRemoved(targetUid, closedMatchIds[0]);
    }

    return { ok: true };
  }
);

/**
 * unblockUser(data: { targetUid: string }) -> { ok: true }
 *
 * Remove a user from the caller's block list. Existing matches are not restored.
 */
export const unblockUser = regionalFunctions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);
    const targetUid = data.targetUid;

    if (typeof targetUid !== 'string' || targetUid.length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'targetUid must be a non-empty string'
      );
    }

    const userRef = db.collection('users').doc(uid);
    const blockRef = userRef.collection('blocks').doc(targetUid);
    await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      assertActiveAccountSnapshot(userSnap);
      tx.delete(blockRef);
    });

    return { ok: true };
  }
);

/**
 * reportUser(data: {
 *   targetUid: string,
 *   reason: string,
 *   note?: string,
 *   matchId?: string,
 *   contentContext?: {
 *     contentType: 'post' | 'comment' | 'reply',
 *     postId: string,
 *     commentId?: string,
 *     replyId?: string,
 *   },
 * })
 * -> { reportId: string }
 *
 * Report a user or their lounge content and auto-block them. Content evidence
 * is always read from Firestore by the server; client-authored snapshots are
 * not accepted.
 */
export const reportUser = regionalFunctions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);

    const requestShapeIssue = reportRequestShapeIssue(data);
    if (requestShapeIssue) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        requestShapeIssue
      );
    }

    const targetUid = data.targetUid;
    const reason = data.reason;
    const note = data.note === undefined ? '' : data.note;
    if (data.matchId !== undefined && typeof data.matchId !== 'string') {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'matchId must be a string when provided'
      );
    }
    const requestedMatchId =
      typeof data.matchId === 'string' && data.matchId.length > 0
        ? data.matchId
        : null;
    const contentContextValidationIssue = reportContentContextIssue(
      data.contentContext
    );
    if (contentContextValidationIssue) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        contentContextValidationIssue
      );
    }
    const contentContext = normalizeReportContentContext(data.contentContext);

    if (
      typeof targetUid !== 'string' ||
      targetUid.length === 0 ||
      targetUid.length > 128 ||
      targetUid.includes('/')
    ) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'targetUid must be a valid user id'
      );
    }

    if (uid === targetUid) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Cannot report yourself'
      );
    }

    if (!isValidReportReason(reason)) {
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

    if (
      requestedMatchId !== null &&
      (requestedMatchId.length > 128 || requestedMatchId.includes('/'))
    ) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'matchId must be a valid document id'
      );
    }

    const reportId = db.collection('reports').doc().id;
    const now = admin.firestore.Timestamp.now();
    const intakeDecision = clientReportIntakeDecision();
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
    const reporterRef = db.collection('users').doc(uid);
    const contentRefs = reportContentDocumentRefs(contentContext);

    const closedMatchIds = await db.runTransaction(async (transaction) => {
      const [reporterSnap, targetSnap, ...contentSnaps] = await Promise.all([
        transaction.get(reporterRef),
        transaction.get(targetRef),
        ...contentRefs.map((ref) => transaction.get(ref)),
      ]);
      assertActiveAccountSnapshot(reporterSnap, 'Reporter');
      const targetData = assertActiveAccountSnapshot(targetSnap, 'Target user');
      const contentEvidence = contentContext
        ? verifiedReportContentEvidence({
            contentContext,
            contentSnaps,
            targetUid,
          })
        : null;
      const closedIds = await stageAllActivePairSafetyClosures(transaction, {
        actorUid: uid,
        targetUid,
        closedReason: 'reported',
      });

      transaction.set(reportRef, {
        reportId,
        reporterUid: uid,
        targetUid,
        reason,
        note,
        matchId: requestedMatchId,
        createdAt: now,
        status: intakeDecision.status,
        evidenceVersion: reportEvidenceVersion,
        targetType: contentContext ? 'content' : 'user',
        contentContext,
        contentEvidence,
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
      return closedIds;
    });

    if (closedMatchIds.length > 0) {
      await notifyChatRemoved(targetUid, closedMatchIds[0]);
    }

    return {
      reportId,
      blocked: true,
    };
  }
);

// ============================================================================
// FIRESTORE TRIGGERS
// ============================================================================

/**
 * Trigger: onMessageCreated
 *
 * Detects language, writes additive translations, increments unread, and sends
 * chat push notifications when the recipient can still receive this message.
 */
export const onMessageCreated = regionalFunctions.firestore
  .document('matches/{matchId}/messages/{messageId}')
  .onCreate(async (snap, context) => {
    const messageData = snap.data();
    const { matchId } = context.params;

    try {
      const senderUid: string = messageData.senderId;
      const isStickerMessage = messageData.messageType === 'sticker';
      const isImageMessage = messageData.messageType === 'image';
      const matchSnap = await db.collection('matches').doc(matchId).get();
      if (matchSnap.exists) {
        const matchData = matchSnap.data()!;
        if (
          !isExactDirectChatParticipants(matchData.userIds) ||
          !matchData.userIds.includes(senderUid)
        ) return;
        const recipientUid: string = matchData.userIds.find(
          (id) => id !== senderUid
        ) ?? '';

        if (recipientUid) {
          const initialAccess =
            await readAuthorizedDirectRoomSideEffectContext({
              matchId,
              senderUid,
              recipientUid,
            });
          if (initialAccess == null) return;
          const { recipientData, senderData } = initialAccess;

          let resolvedOriginalLang: 'ko' | 'ja' | 'unknown' = 'unknown';
          let resolvedTranslations: Record<string, string | null> = {
            ko: null,
            ja: null,
          };

          if (
            isStickerMessage ||
            isImageMessage ||
            usersShareNationality(senderData, recipientData)
          ) {
            await snap.ref.update({
              originalLang: 'unknown',
              translations: { ko: null, ja: null },
              translationStatus: 'skipped',
              translatedTargetLangs: [],
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          } else {
            const originalLang = await detectLanguageWithApi(messageData.originalText);
            resolvedOriginalLang = originalLang;
            const targetLanguages = targetLanguagesForMessage({
              originalLang,
              recipientProfile: recipientData,
              senderProfile: senderData,
            });

            try {
              if (
                !hasTranslatableText(messageData.originalText) ||
                !messageNeedsTranslationForRecipient(originalLang, recipientData)
              ) {
                await snap.ref.update({
                  originalLang,
                  translations: { ko: null, ja: null },
                  translationStatus: 'skipped',
                  translatedTargetLangs: [],
                  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
              } else {
                const translations: Record<string, string | null> = {
                  ko: null,
                  ja: null,
                };

                for (const targetLang of targetLanguages) {
                  translations[targetLang] = originalLang === targetLang
                    ? messageData.originalText
                    : await callGoogleTranslate(messageData.originalText, targetLang);
                }
                resolvedTranslations = translations;

                await snap.ref.update({
                  originalLang,
                  translations,
                  translationStatus: 'done',
                  translatedTargetLangs: targetLanguages,
                  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
              }
            } catch (translationError) {
              console.error('Message translation failed:', translationError);
              await snap.ref.update({
                originalLang,
                translationStatus: 'failed',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
            }
          }

          const localizedPreview = isStickerMessage || isImageMessage
            ? null
            : translatedPreviewForRecipient({
              originalText: messageData.originalText,
              originalLang: resolvedOriginalLang,
              translations: resolvedTranslations,
              recipientProfile: recipientData,
              maxLength: 50,
            });

          // Reauthorize inside the same transaction as the unread mutation so
          // a concurrent block/closure cannot leave a recipient side effect.
          const unreadAccess = await applyAuthorizedMessageRecipientState({
            matchId,
            senderUid,
            recipientUid,
            localizedPreview,
          });
          if (unreadAccess == null) return;

          // Re-read once more immediately before push delivery. Translation or
          // unread work can race with a block, ban, room closure, or pointer
          // replacement, and a stale token must not receive the notification.
          const pushAccess = await readAuthorizedDirectRoomSideEffectContext({
            matchId,
            senderUid,
            recipientUid,
          });
          if (pushAccess == null) return;
          const pushRecipientData = pushAccess.recipientData;
          const pushSenderData = pushAccess.senderData;
          const fcmToken: string | null = pushRecipientData.fcmToken ?? null;
          const notificationsEnabled: boolean =
            pushRecipientData.notificationsEnabled ?? true;
          const nightQuietEnabled: boolean =
            pushRecipientData.nightQuietEnabled ?? false;
          const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
          const hourKst = nowKst.getUTCHours();

          if (shouldSendChatPush({
            fcmToken,
            notificationsEnabled,
            nightQuietEnabled,
            hourKst,
          }) && fcmToken) {
            const senderName: string =
              pushSenderData.displayName ?? '하나';
            const preview = isStickerMessage
              ? 'Sticker'
              : isImageMessage
                ? 'Photo'
                : translatedPreviewForRecipient({
                  originalText: messageData.originalText,
                  originalLang: resolvedOriginalLang,
                  translations: resolvedTranslations,
                  recipientProfile: pushRecipientData,
                  maxLength: 60,
                }) ?? '';

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
              },
              apns: {
                payload: {
                  aps: {
                    sound: 'default',
                  },
                },
              },
            });
          }
        }
      }
    } catch (error) {
      console.error('onMessageCreated error:', error);
    }
  });

/**
 * Trigger: onPostCreated
 *
 * Translates lounge post content into both Korean and Japanese.
 * Stores translatedKo / translatedJa on the post document.
 */
export const onPostCreated = regionalFunctions.firestore
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
export const onUserBlocked = regionalFunctions.firestore
  .document('users/{uid}/blocks/{targetUid}')
  .onCreate(async (_snap, context) => {
    const { uid, targetUid } = context.params;

    await db.runTransaction(async (tx) => {
      await stageAllActivePairSafetyClosures(tx, {
        actorUid: uid,
        targetUid,
        closedReason: 'blocked',
      });
    });
  });

/**
 * Trigger: onDiscoveryLikeCreated
 *
 * When someone likes a user from discovery, increment the target's likeCount.
 */
export const onDiscoveryLikeCreated = regionalFunctions.firestore
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
export const onPostLikeCreated = regionalFunctions.firestore
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
export const onPostLikeDeleted = regionalFunctions.firestore
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
 * listActiveChats(data: { limit?: number, cursor?: string })
 * -> { rooms: SanitizedActiveChat[], nextCursor: string | null }
 *
 * Firestore cannot prove bilateral block and peer-account lookups for a
 * collection query. Keep direct list reads closed and return only rooms that
 * pass the full current-pointer contract in one bounded server transaction.
 */
export const listActiveChats = regionalFunctions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);
    const requestedLimit = data?.limit ?? 20;
    const cursor = data?.cursor ?? null;
    if (
      !Number.isSafeInteger(requestedLimit) ||
      requestedLimit < 1 ||
      requestedLimit > 20
    ) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'limit must be an integer from 1 to 20'
      );
    }
    if (
      cursor !== null &&
      (typeof cursor !== 'string' ||
        cursor.length === 0 ||
        cursor.length > 128 ||
        cursor.includes('/'))
    ) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'cursor must be a valid room id'
      );
    }

    const result = await db.runTransaction(async (tx) => {
      let roomsQuery: FirebaseFirestore.Query = db.collection('matches')
        .where('userIds', 'array-contains', uid)
        .where('isActive', '==', true)
        .where('directRoomVersion', '==', 1)
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(requestedLimit + 1);
      if (cursor !== null) roomsQuery = roomsQuery.startAfter(cursor);

      const [candidateSnap, callerSnap] = await Promise.all([
        tx.get(roomsQuery),
        tx.get(db.collection('users').doc(uid)),
      ]);
      assertActiveAccountSnapshot(callerSnap);
      const pageDocs = candidateSnap.docs.slice(0, requestedLimit);
      const rooms = (await Promise.all(pageDocs.map(async (roomSnap) => {
        const room = roomSnap.data();
        if (
          !isExactDirectChatParticipants(room.userIds) ||
          !room.userIds.includes(uid) ||
          !Array.isArray(room.hiddenFor) ||
          room.hiddenFor.length !== 0
        ) return null;
        const otherUid = room.userIds.find((participantUid) =>
          participantUid !== uid
        );
        if (otherUid == null) return null;
        const expectedUserIds = [uid, otherUid].sort();
        const pairKey = expectedUserIds.join('_');
        if (room.pairKey !== pairKey) return null;

        const peerRef = db.collection('users').doc(otherUid);
        const [pairSnap, peerSnap, callerBlockSnap, peerBlockSnap] =
          await Promise.all([
            tx.get(db.collection('chatPairs').doc(pairKey)),
            tx.get(peerRef),
            tx.get(db.collection('users').doc(uid).collection('blocks').doc(otherUid)),
            tx.get(peerRef.collection('blocks').doc(uid)),
          ]);
        if (
          activeAccountIssue({
            exists: peerSnap.exists,
            userData: peerSnap.data(),
          }) !== null ||
          callerBlockSnap.exists ||
          peerBlockSnap.exists ||
          !reusableDirectRoomSnapshots({
            matchId: roomSnap.id,
            matchSnap: roomSnap,
            pairSnap,
            expectedUserIds,
            pairKey,
          })
        ) return null;

        const peer = peerSnap.data()!;
        const createdAtMillis = room.createdAt?.toMillis?.();
        const lastMessageAtMillis = room.lastMessageAt?.toMillis?.();
        const unreadCount = room.unread?.[uid];
        const favorite = room.favoriteFor?.[uid];
        const localizedPreview = room.lastMessagePreviewFor?.[uid];
        return {
          matchId: roomSnap.id,
          userIds: expectedUserIds,
          createdAtMillis: typeof createdAtMillis === 'number'
            ? createdAtMillis
            : null,
          lastMessageAtMillis: typeof lastMessageAtMillis === 'number'
            ? lastMessageAtMillis
            : null,
          lastMessagePreview: typeof localizedPreview === 'string'
            ? localizedPreview
            : typeof room.lastMessagePreview === 'string'
              ? room.lastMessagePreview
              : null,
          unreadCount: Number.isSafeInteger(unreadCount) && unreadCount >= 0
            ? unreadCount
            : 0,
          favorite: favorite === true,
          partner: {
            uid: otherUid,
            displayName: typeof peer.displayName === 'string'
              ? peer.displayName
              : '',
            photoUrl: firstPhoto(peer),
            nationality: typeof peer.nationality === 'string'
              ? peer.nationality
              : '',
            gender: typeof peer.gender === 'string' ? peer.gender : '',
          },
        };
      }))).filter((room): room is NonNullable<typeof room> => room != null);

      return {
        rooms,
        nextCursor: candidateSnap.size > requestedLimit && pageDocs.length > 0
          ? pageDocs[pageDocs.length - 1].id
          : null,
      };
    });

    return result;
  }
);

/**
 * startChat(data: { targetUid: string }) -> { matchId, pointBalance, keyCount, alreadyExists }
 *
 * Creates or reuses a direct 1:1 chat room.
 * Existing active rooms cost 0. If either user left the previous room,
 * the next start creates a brand-new room and costs 1 point.
 */
export const startChat = regionalFunctions.https.onCall(
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
    const pairKey = ids.join('_');
    const pairRef = db.collection('chatPairs').doc(pairKey);
    const userRef = db.collection('users').doc(uid);
    const targetRef = db.collection('users').doc(targetUid);
    const callerBlockRef = db.collection('users').doc(uid).collection('blocks').doc(targetUid);
    const targetBlockRef = db.collection('users').doc(targetUid).collection('blocks').doc(uid);

    const [
      targetSnap,
      callerBlockedTarget,
      targetBlockedCaller,
    ] = await Promise.all([
      targetRef.get(),
      callerBlockRef.get(),
      targetBlockRef.get(),
    ]);

    if (!targetSnap.exists) {
      throw directChatTargetUnavailable();
    }

    const targetData = targetSnap.data() ?? {};
    if (
      activeAccountIssue({
        exists: targetSnap.exists,
        userData: targetData,
      }) !== null ||
      !isEligibleExternalProfileViewer(targetData) ||
      !isPublicUserProfile(targetData)
    ) {
      throw directChatTargetUnavailable();
    }

    if (callerBlockedTarget.exists || targetBlockedCaller.exists) {
      throw directChatTargetUnavailable();
    }

    const getPhoto = (d: any) =>
      Array.isArray(d.photoUrls) && d.photoUrls.length > 0 ? d.photoUrls[0] : '';

    // Transaction: re-check active room, point check + deduction, then create a new room.
    const chatResult = await db.runTransaction(async (tx) => {
      const [
        freshPair,
        freshUser,
        freshTarget,
        freshCallerBlock,
        freshTargetBlock,
      ] = await Promise.all([
        tx.get(pairRef),
        tx.get(userRef),
        tx.get(targetRef),
        tx.get(callerBlockRef),
        tx.get(targetBlockRef),
      ]);

      if (activeAccountIssue({
        exists: freshUser.exists,
        userData: freshUser.data(),
      }) !== null) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'User account is unavailable'
        );
      }

      if (!freshTarget.exists) {
        throw directChatTargetUnavailable();
      }

      const freshTargetData = freshTarget.data() ?? {};
      const freshUserData = freshUser.data() ?? {};
      const currentPoints = requireTrustedPointBalance(freshUserData);
      if (!isEligibleExternalProfileViewer(freshUserData)) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Complete an adult profile before starting a chat'
        );
      }
      if (
        activeAccountIssue({
          exists: freshTarget.exists,
          userData: freshTargetData,
        }) !== null ||
        !isEligibleExternalProfileViewer(freshTargetData) ||
        !isPublicUserProfile(freshTargetData)
      ) {
        throw directChatTargetUnavailable();
      }

      if (freshCallerBlock.exists || freshTargetBlock.exists) {
        throw directChatTargetUnavailable();
      }

      const activeMatchId = freshPair.data()?.activeMatchId;
      let activePairMatchValid = false;
      if (typeof activeMatchId === 'string' && activeMatchId.length > 0) {
        const activeMatchRef = db.collection('matches').doc(activeMatchId);
        const activeMatchSnap = await tx.get(activeMatchRef);
        activePairMatchValid = reusableDirectRoomSnapshots({
          matchId: activeMatchId,
          matchSnap: activeMatchSnap,
          pairSnap: freshPair,
          expectedUserIds: ids,
          pairKey,
        });
      }

      const decision = decideStartChatPolicy({
        currentPoints,
        activePairMatchId:
          typeof activeMatchId === 'string' ? activeMatchId : undefined,
        activePairMatchValid,
      });

      if (decision.action === 'reuse' && decision.source === 'pair') {
        return {
          matchId: decision.matchId,
          pointBalance: decision.pointBalance,
          alreadyExists: decision.alreadyExists,
          createdNew: false,
        };
      }

      if (decision.action === 'insufficient-points') {
        throw new functions.https.HttpsError('resource-exhausted', '포인트가 부족합니다');
      }

      const nextPointBalance = pointBalanceAfterConsume(currentPoints, 1);
      tx.update(userRef, {
        keyCount: nextPointBalance,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      const matchRef = db.collection('matches').doc();
      const matchId = matchRef.id;
      const pointEventRef = db.collection('pointEvents').doc();
      const matchPayload: Record<string, unknown> = {
        matchId,
        pairKey,
        directRoomVersion: 1,
        userIds: ids,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        isActive: true,
        hiddenFor: [],
        unread: { [uid]: 0, [targetUid]: 0 },
        lastMessageAt: null,
        lastMessagePreview: null,
        partnerFor: {
          [uid]: {
            displayName: freshTargetData.displayName ?? '',
            photoUrl: getPhoto(freshTargetData),
            nationality: freshTargetData.nationality ?? 'JP',
            gender: freshTargetData.gender ?? 'female',
          },
          [targetUid]: {
            displayName: freshUserData.displayName ?? '',
            photoUrl: getPhoto(freshUserData),
            nationality: freshUserData.nationality ?? 'KR',
            gender: freshUserData.gender ?? 'female',
          },
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      tx.set(matchRef, matchPayload);
      tx.set(pairRef, {
        pairKey,
        userIds: ids,
        activeMatchId: matchId,
        closedMatchId: admin.firestore.FieldValue.delete(),
        closedReason: admin.firestore.FieldValue.delete(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

      const pointEvent: QuotaEventData = {
        uid,
        eventType: 'consume',
        amount: 1,
        reason: 'new_direct_chat',
        balanceBefore: currentPoints,
        balanceAfter: nextPointBalance,
        matchId,
        pairKey,
        source: 'startChat',
        timestamp: admin.firestore.Timestamp.now(),
      };
      tx.set(pointEventRef, pointEvent);

      return {
        matchId,
        pointBalance: decision.pointBalance,
        alreadyExists: decision.alreadyExists,
        createdNew: true,
      };
    });

    if (chatResult.createdNew) {
      await notifyNewDirectChat({
        matchId: chatResult.matchId,
        senderUid: uid,
        recipientUid: targetUid,
      });
    }

    return {
      matchId: chatResult.matchId,
      pointBalance: chatResult.pointBalance,
      keyCount: chatResult.pointBalance,
      alreadyExists: chatResult.alreadyExists,
    };
  }
);

/**
 * startCall(data: { matchId: string, type: 'voice' | 'video' })
 * -> { callId, roomName, agoraAppId, paidUntilAt, freeSegment }
 *
 * Voice policy: one free 5-minute voice call per caller per KST/JST day,
 * then 1 point per 10-minute extension/segment.
 * Video policy: 3 points per 10-minute segment.
 */
export const startCall = regionalFunctions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);
    const type = data.type;
    const matchId = data.matchId;

    if (type !== 'voice' && type !== 'video') {
      throw new functions.https.HttpsError('invalid-argument', 'type must be voice or video');
    }
    if (typeof matchId !== 'string' || matchId.length === 0) {
      throw new functions.https.HttpsError('invalid-argument', 'matchId required');
    }

    // Validate server configuration before creating a ringing call, but do not
    // issue any RTC privilege until acceptCall establishes a paid segment.
    const { appId } = agoraConfig();
    const matchRef = db.collection('matches').doc(matchId);
    const activeCallRef = db.collection('activeCalls').doc(matchId);
    const userRef = db.collection('users').doc(uid);
    const todayKey = kstDateKey();
    const quotaRef = db.collection('callDailyQuotas').doc(`${uid}_${todayKey}`);
    const callRef = db.collection('calls').doc();
    const callId = callRef.id;
    const roomName = `hana_${callId}`;

    const result = await db.runTransaction(async (tx) => {
      const [matchSnap, userSnap, quotaSnap, activeCallSnap] = await Promise.all([
        tx.get(matchRef),
        tx.get(userRef),
        tx.get(quotaRef),
        tx.get(activeCallRef),
      ]);

      const matchData = matchSnap.data() ?? {};
      const userIds = matchData.userIds as string[] | undefined;
      if (
        !matchSnap.exists ||
        matchData.isActive !== true ||
        !isExactDirectChatParticipants(userIds) ||
        !userIds.includes(uid) ||
        matchData.directRoomVersion !== 1 ||
        !Array.isArray(matchData.hiddenFor) ||
        matchData.hiddenFor.length !== 0
      ) {
        throw callUnavailableError();
      }

      if (activeAccountIssue({
        exists: userSnap.exists,
        userData: userSnap.data(),
      }) !== null) {
        throw callUnavailableError();
      }

      const targetUid = userIds.find((id) => id !== uid)!;
      const pairKey = [...userIds].sort().join('_');
      const [
        targetSnap,
        pairSnap,
        callerBlockSnap,
        targetBlockSnap,
      ] = await Promise.all([
        tx.get(db.collection('users').doc(targetUid)),
        tx.get(db.collection('chatPairs').doc(pairKey)),
        tx.get(db.collection('users').doc(uid).collection('blocks').doc(targetUid)),
        tx.get(db.collection('users').doc(targetUid).collection('blocks').doc(uid)),
      ]);
      if (
        activeAccountIssue({
          exists: targetSnap.exists,
          userData: targetSnap.data(),
        }) !== null
      ) {
        throw callUnavailableError();
      }
      if (
        !reusableDirectRoomSnapshots({
          matchId,
          matchSnap,
          pairSnap,
          expectedUserIds: userIds,
          pairKey,
        }) ||
        callerBlockSnap.exists ||
        targetBlockSnap.exists
      ) {
        throw callUnavailableError();
      }

      const priorActiveCallId = activeCallSnap.data()?.callId;
      const priorCallSnap =
        typeof priorActiveCallId === 'string' &&
        priorActiveCallId.length > 0
          ? await tx.get(db.collection('calls').doc(priorActiveCallId))
          : null;
      const priorCallData = priorCallSnap?.data() ?? {};
      const activeCallData = activeCallSnap.data() ?? {};
      const now = admin.firestore.Timestamp.now();
      const replacement = decideActiveCallReplacement({
        pointerExists: activeCallSnap.exists,
        callExists: priorCallSnap?.exists === true,
        callBelongsToRoom:
          priorCallData.callId === priorActiveCallId &&
          priorCallData.matchId === matchId &&
          isExactDirectChatParticipants(
            priorCallData.participantUids,
            userIds
          ) &&
          activeCallData.matchId === matchId &&
          isExactDirectChatParticipants(
            activeCallData.participantUids,
            userIds
          ) &&
          activeCallData.status === priorCallData.status,
        status: priorCallData.status,
        ringingExpiresAtMillis:
          priorCallData.ringingExpiresAt?.toMillis?.() ?? null,
        paidUntilAtMillis: priorCallData.paidUntilAt?.toMillis?.() ?? null,
        nowMillis: now.toMillis(),
      });
      if (replacement === 'busy') throw callClosedError();

      const ringingExpiresAt = admin.firestore.Timestamp.fromMillis(
        now.toMillis() + callRingingTtlSeconds * 1000
      );
      if (replacement === 'close-stale-ringing' && priorCallSnap != null) {
        tx.update(priorCallSnap.ref, {
          status: 'missed',
          endedAt: now,
          endedReason: 'ringing_expired',
          updatedAt: now,
        });
      } else if (
        replacement === 'close-expired-accepted' &&
        priorCallSnap != null
      ) {
        tx.update(priorCallSnap.ref, {
          status: 'ended',
          endedAt: now,
          endedReason: 'paid_entitlement_expired',
          updatedAt: now,
        });
      }

      const currentPoints = requireTrustedPointBalance(userSnap.data());
      const voiceFreeAvailable =
        type === 'voice' && quotaSnap.data()?.freeVoiceCallUsed !== true;
      const chargePoints = type === 'video'
        ? VIDEO_SEGMENT_POINTS
        : voiceFreeAvailable
          ? 0
          : VOICE_EXTENSION_POINTS;
      if (currentPoints < chargePoints) {
        throw new functions.https.HttpsError('resource-exhausted', '포인트가 부족합니다');
      }

      const callerData = userSnap.data() ?? {};
      const targetData = targetSnap.data() ?? {};

      const callPayload = {
        callId,
        matchId,
        callerUid: uid,
        calleeUid: targetUid,
        participantUids: userIds,
        type,
        status: 'ringing',
        roomName,
        ringingExpiresAt,
        paidUntilAt: null,
        segmentSeconds: null,
        extensionCount: 0,
        freeSegment: voiceFreeAvailable,
        initialChargePoints: chargePoints,
        callerDisplayName: callerData.displayName ?? '',
        calleeDisplayName: targetData.displayName ?? '',
        createdAt: now,
        updatedAt: now,
      };
      tx.set(callRef, callPayload);
      tx.set(activeCallRef, {
        callId,
        matchId,
        participantUids: userIds,
        status: 'ringing',
        ringingExpiresAt,
        updatedAt: now,
      });

      return {
        targetUid,
        callerName: callerData.displayName ?? 'Hana',
        paidUntilAtMillis: null,
        chargePoints: 0,
        freeSegment: voiceFreeAvailable,
        ringingExpiresAtMillis: ringingExpiresAt.toMillis(),
      };
    });

    await notifyIncomingCall({
      callerUid: uid,
      callerName: result.callerName,
      callId,
      matchId,
      recipientUid: result.targetUid,
      type,
    });

    return {
      callId,
      roomName,
      agoraAppId: appId,
      token: '',
      rtcUid: 0,
      tokenExpiresAt: null,
      paidUntilAt: result.paidUntilAtMillis,
      ringingExpiresAt: result.ringingExpiresAtMillis,
      chargedPoints: result.chargePoints,
      freeSegment: result.freeSegment,
    };
  }
);

export const acceptCall = regionalFunctions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);
    const callId = data.callId;
    if (typeof callId !== 'string' || callId.length === 0) {
      throw new functions.https.HttpsError('invalid-argument', 'callId required');
    }

    const { appId, appCertificate } = agoraConfig();
    const callRef = db.collection('calls').doc(callId);
    const accepted = await db.runTransaction(async (tx) => {
      const entitlement = await requireCallEntitlement(tx, {
        callRef,
        callId,
        requesterUid: uid,
        allowedStatuses: ['ringing', 'accepted'],
        requirePaidEntitlement: false,
      });
      const callData = entitlement.callData;
      const currentPoints = requireTrustedPointBalance(
        entitlement.callerAccountSnap.data()
      );
      if (callData.status === 'accepted') {
        const paidUntilAtMillis = entitlement.paidUntilAtMillis;
        if (
          paidUntilAtMillis == null ||
          paidUntilAtMillis <= entitlement.now.toMillis()
        ) {
          throw callClosedError();
        }
        const token = buildAgoraRtcToken({
          appId,
          appCertificate,
          channelName: entitlement.roomName,
          uid,
          callType: entitlement.callType,
          paidUntilAtMillis,
        });
        return {
          roomName: entitlement.roomName,
          paidUntilAtMillis,
          chargedPoints: 0,
          freeSegment: callData.freeSegment === true,
          token,
        };
      }

      // Only the callee can transition a ringing call into a paid call. The
      // caller may obtain a token only after observing the accepted state.
      if (uid !== entitlement.calleeUid) throw callClosedError();

      const todayKey = kstDateKey();
      const quotaRef = db
        .collection('callDailyQuotas')
        .doc(`${entitlement.callerUid}_${todayKey}`);
      const quotaSnap = await tx.get(quotaRef);
      const voiceFreeAvailable =
        entitlement.callType === 'voice' &&
        quotaSnap.data()?.freeVoiceCallUsed !== true;
      const chargePoints = entitlement.callType === 'video'
        ? VIDEO_SEGMENT_POINTS
        : voiceFreeAvailable
          ? 0
          : VOICE_EXTENSION_POINTS;
      const segmentSeconds = entitlement.callType === 'video'
        ? VIDEO_SEGMENT_SECONDS
        : voiceFreeAvailable
          ? VOICE_FREE_SECONDS
          : VOICE_EXTENSION_SECONDS;
      if (currentPoints < chargePoints) {
        throw new functions.https.HttpsError('resource-exhausted', '포인트가 부족합니다');
      }

      const now = entitlement.now;
      const paidUntilAt = admin.firestore.Timestamp.fromMillis(
        now.toMillis() + segmentSeconds * 1000
      );
      const token = buildAgoraRtcToken({
        appId,
        appCertificate,
        channelName: entitlement.roomName,
        uid,
        callType: entitlement.callType,
        paidUntilAtMillis: paidUntilAt.toMillis(),
      });

      if (chargePoints > 0) {
        const nextPointBalance = pointBalanceAfterConsume(
          currentPoints,
          chargePoints
        );
        tx.update(entitlement.callerRef, {
          keyCount: nextPointBalance,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        const pointEventRef = db.collection('pointEvents').doc();
        tx.set(pointEventRef, {
          uid: entitlement.callerUid,
          eventType: 'consume',
          amount: chargePoints,
          reason: entitlement.callType === 'video'
            ? 'video_call_segment'
            : 'voice_call_segment',
          balanceBefore: currentPoints,
          balanceAfter: nextPointBalance,
          matchId: entitlement.matchId,
          source: 'acceptCall',
          timestamp: now,
        } as QuotaEventData);
      }

      if (voiceFreeAvailable) {
        tx.set(quotaRef, {
          uid: entitlement.callerUid,
          dateKey: todayKey,
          freeVoiceCallUsed: true,
          freeVoiceSecondsLimit: VOICE_FREE_SECONDS,
          freeVoiceSecondsUsed: 0,
          callId,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }

      tx.update(callRef, {
        status: 'accepted',
        acceptedAt: now,
        ringingExpiresAt: admin.firestore.FieldValue.delete(),
        paidUntilAt,
        segmentSeconds,
        freeSegment: voiceFreeAvailable,
        initialChargePoints: chargePoints,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      tx.set(entitlement.activeCallRef, {
        callId,
        matchId: entitlement.matchId,
        participantUids: callData.participantUids ?? [],
        status: 'accepted',
        ringingExpiresAt: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      return {
        roomName: entitlement.roomName,
        paidUntilAtMillis: paidUntilAt.toMillis(),
        chargedPoints: chargePoints,
        freeSegment: voiceFreeAvailable,
        token,
      };
    });
    return {
      callId,
      roomName: accepted.roomName,
      agoraAppId: appId,
      token: accepted.token.token,
      rtcUid: accepted.token.rtcUid,
      tokenExpiresAt: accepted.token.expiresAt,
      paidUntilAt: accepted.paidUntilAtMillis,
      chargedPoints: accepted.chargedPoints,
      freeSegment: accepted.freeSegment,
    };
  }
);

/**
 * Returns a fresh participant-specific RTC token only while the complete call
 * entitlement remains active. This never charges or extends the paid window.
 */
export const refreshCallToken = regionalFunctions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);
    const callId = data.callId;
    if (typeof callId !== 'string' || callId.length === 0) {
      throw new functions.https.HttpsError('invalid-argument', 'callId required');
    }

    const { appId, appCertificate } = agoraConfig();
    const refreshed = await db.runTransaction(async (tx) => {
      const entitlement = await requireCallEntitlement(tx, {
        callRef: db.collection('calls').doc(callId),
        callId,
        requesterUid: uid,
        allowedStatuses: ['accepted'],
        requirePaidEntitlement: true,
      });
      const paidUntilAtMillis = entitlement.paidUntilAtMillis!;
      const token = buildAgoraRtcToken({
        appId,
        appCertificate,
        channelName: entitlement.roomName,
        uid,
        callType: entitlement.callType,
        paidUntilAtMillis,
      });
      return {
        roomName: entitlement.roomName,
        paidUntilAtMillis,
        freeSegment: entitlement.callData.freeSegment === true,
        token,
      };
    });

    return {
      callId,
      roomName: refreshed.roomName,
      agoraAppId: appId,
      token: refreshed.token.token,
      rtcUid: refreshed.token.rtcUid,
      tokenExpiresAt: refreshed.token.expiresAt,
      paidUntilAt: refreshed.paidUntilAtMillis,
      chargedPoints: 0,
      freeSegment: refreshed.freeSegment,
    };
  }
);

export const declineCall = regionalFunctions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);
    const callId = data.callId;
    if (typeof callId !== 'string' || callId.length === 0) {
      throw new functions.https.HttpsError('invalid-argument', 'callId required');
    }
    const callRef = db.collection('calls').doc(callId);
    const userRef = db.collection('users').doc(uid);
    await db.runTransaction(async (tx) => {
      const [callSnap, userSnap] = await Promise.all([
        tx.get(callRef),
        tx.get(userRef),
      ]);
      assertActiveAccountSnapshot(userSnap);
      if (!callSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Call not found');
      }
      const callData = callSnap.data() ?? {};
      if (callData.calleeUid !== uid && callData.callerUid !== uid) {
        throw new functions.https.HttpsError('permission-denied', 'Not a call participant');
      }
      if (callData.status !== 'ringing') return;
      const matchId = callData.matchId;
      const activeCallRef = typeof matchId === 'string' && matchId.length > 0
        ? db.collection('activeCalls').doc(matchId)
        : null;
      const activeCallSnap = activeCallRef == null ? null : await tx.get(activeCallRef);
      tx.update(callRef, {
        status: 'declined',
        endedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      if (activeCallRef != null && activeCallSnap?.data()?.callId === callId) {
        tx.delete(activeCallRef);
      }
    });
    return { ok: true };
  }
);

export const markCallMissed = regionalFunctions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);
    const callId = data.callId;
    if (typeof callId !== 'string' || callId.length === 0) {
      throw new functions.https.HttpsError('invalid-argument', 'callId required');
    }
    const callRef = db.collection('calls').doc(callId);
    const userRef = db.collection('users').doc(uid);
    await db.runTransaction(async (tx) => {
      const [callSnap, userSnap] = await Promise.all([
        tx.get(callRef),
        tx.get(userRef),
      ]);
      assertActiveAccountSnapshot(userSnap);
      if (!callSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Call not found');
      }
      const callData = callSnap.data() ?? {};
      if (callData.calleeUid !== uid && callData.callerUid !== uid) {
        throw new functions.https.HttpsError('permission-denied', 'Not a call participant');
      }
      if (callData.status !== 'ringing') return;
      const matchId = callData.matchId;
      const activeCallRef = typeof matchId === 'string' && matchId.length > 0
        ? db.collection('activeCalls').doc(matchId)
        : null;
      const activeCallSnap = activeCallRef == null ? null : await tx.get(activeCallRef);
      tx.update(callRef, {
        status: 'missed',
        endedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      if (activeCallRef != null && activeCallSnap?.data()?.callId === callId) {
        tx.delete(activeCallRef);
      }
    });
    return { ok: true };
  }
);

export const endCall = regionalFunctions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);
    const callId = data.callId;
    if (typeof callId !== 'string' || callId.length === 0) {
      throw new functions.https.HttpsError('invalid-argument', 'callId required');
    }
    const callRef = db.collection('calls').doc(callId);
    const userRef = db.collection('users').doc(uid);
    await db.runTransaction(async (tx) => {
      const [callSnap, userSnap] = await Promise.all([
        tx.get(callRef),
        tx.get(userRef),
      ]);
      assertActiveAccountSnapshot(userSnap);
      if (!callSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Call not found');
      }
      const callData = callSnap.data() ?? {};
      if (callData.calleeUid !== uid && callData.callerUid !== uid) {
        throw new functions.https.HttpsError('permission-denied', 'Not a call participant');
      }
      if (callData.status === 'ended' || callData.status === 'declined') return;
      const matchId = callData.matchId;
      const activeCallRef = typeof matchId === 'string' && matchId.length > 0
        ? db.collection('activeCalls').doc(matchId)
        : null;
      const activeCallSnap = activeCallRef == null ? null : await tx.get(activeCallRef);
      const now = admin.firestore.Timestamp.now();
      const acceptedAtMillis = callData.acceptedAt?.toMillis?.() ?? now.toMillis();
      tx.update(callRef, {
        status: 'ended',
        endedBy: uid,
        endedAt: now,
        durationSec: Math.max(
          0,
          Math.floor((now.toMillis() - acceptedAtMillis) / 1000)
        ),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      if (activeCallRef != null && activeCallSnap?.data()?.callId === callId) {
        tx.delete(activeCallRef);
      }
    });
    return { ok: true };
  }
);

export const extendCall = regionalFunctions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);
    const callId = data.callId;
    if (typeof callId !== 'string' || callId.length === 0) {
      throw new functions.https.HttpsError('invalid-argument', 'callId required');
    }
    const clientRequestId = normalizeCallExtensionRequestId(
      data.clientRequestId
    );
    if (clientRequestId == null) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'clientRequestId is invalid'
      );
    }

    const { appId, appCertificate } = agoraConfig();
    const callRef = db.collection('calls').doc(callId);
    const operationId = callExtensionOperationId({
      callId,
      uid,
      clientRequestId,
    });
    const operationRef = callRef
      .collection('extensionOperations')
      .doc(operationId);
    const pointEventRef = db.collection('pointEvents').doc(operationId);
    const result = await db.runTransaction(async (tx) => {
      const entitlement = await requireCallEntitlement(tx, {
        callRef,
        callId,
        requesterUid: uid,
        allowedStatuses: ['accepted'],
        requirePaidEntitlement: true,
      });
      const [operationSnap, pointEventSnap] = await Promise.all([
        tx.get(operationRef),
        tx.get(pointEventRef),
      ]);
      const operationData = operationSnap.data();
      const pointEventData = pointEventSnap.data();
      const replay = decideCallExtensionReplay({
        operationExists: operationSnap.exists,
        operation: operationData == null ? undefined : {
          operationId: operationData.operationId,
          callId: operationData.callId,
          uid: operationData.uid,
          clientRequestId: operationData.clientRequestId,
          matchId: operationData.matchId,
          callType: operationData.callType,
          roomName: operationData.roomName,
          paidUntilAtMillis:
            operationData.paidUntilAt?.toMillis?.() ?? null,
          chargedPoints: operationData.chargedPoints,
          keyCount: operationData.keyCount,
          pointEventId: operationData.pointEventId,
          status: operationData.status,
        },
        eventExists: pointEventSnap.exists,
        event: pointEventData == null ? undefined : {
          uid: pointEventData.uid,
          callId: pointEventData.callId,
          matchId: pointEventData.matchId,
          eventType: pointEventData.eventType,
          source: pointEventData.source,
          reason: pointEventData.reason,
          amount: pointEventData.amount,
          balanceBefore: pointEventData.balanceBefore,
          balanceAfter: pointEventData.balanceAfter,
          clientRequestId: pointEventData.clientRequestId,
        },
        expected: {
          operationId,
          callId,
          uid,
          clientRequestId,
          matchId: entitlement.matchId,
          callType: entitlement.callType,
          roomName: entitlement.roomName,
        },
      });
      if (replay.action === 'inconsistent') throw callClosedError();
      if (replay.action === 'replay') {
        if (
          replay.paidUntilAtMillis > entitlement.paidUntilAtMillis!
        ) throw callClosedError();
        const token = buildAgoraRtcToken({
          appId,
          appCertificate,
          channelName: entitlement.roomName,
          uid,
          callType: entitlement.callType,
          paidUntilAtMillis: replay.paidUntilAtMillis,
        });
        return {
          roomName: entitlement.roomName,
          paidUntilAtMillis: replay.paidUntilAtMillis,
          chargedPoints: replay.chargedPoints,
          keyCount: replay.keyCount,
          freeSegment: entitlement.callData.freeSegment === true,
          token,
          idempotentReplay: true,
        };
      }

      const currentPoints = requireTrustedPointBalance(
        entitlement.requesterAccountSnap.data()
      );
      const decision = decideCallExtension({
        callType: entitlement.callType,
        currentBalance: currentPoints,
        paidUntilAtMillis: entitlement.paidUntilAtMillis,
        nowMillis: entitlement.now.toMillis(),
      });
      if (decision.action === 'closed') throw callClosedError();
      if (decision.action === 'insufficient-points') {
        throw new functions.https.HttpsError('resource-exhausted', '포인트가 부족합니다');
      }
      const nextPaidUntilAt = admin.firestore.Timestamp.fromMillis(
        decision.nextPaidUntilAtMillis
      );
      const token = buildAgoraRtcToken({
        appId,
        appCertificate,
        channelName: entitlement.roomName,
        uid,
        callType: entitlement.callType,
        paidUntilAtMillis: decision.nextPaidUntilAtMillis,
      });

      tx.update(entitlement.requesterRef, {
        keyCount: decision.nextBalance,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      tx.update(callRef, {
        paidUntilAt: nextPaidUntilAt,
        extensionCount: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      tx.create(pointEventRef, {
        uid,
        callId,
        eventType: 'consume',
        amount: decision.chargePoints,
        reason: entitlement.callType === 'video'
          ? 'video_call_extension'
          : 'voice_call_extension',
        balanceBefore: currentPoints,
        balanceAfter: decision.nextBalance,
        matchId: entitlement.matchId,
        source: 'extendCall',
        clientRequestId,
        timestamp: entitlement.now,
      } as QuotaEventData);
      tx.create(operationRef, {
        operationId,
        callId,
        uid,
        clientRequestId,
        matchId: entitlement.matchId,
        callType: entitlement.callType,
        roomName: entitlement.roomName,
        status: 'committed',
        paidUntilAt: nextPaidUntilAt,
        chargedPoints: decision.chargePoints,
        keyCount: decision.nextBalance,
        pointEventId: operationId,
        createdAt: entitlement.now,
      });

      return {
        roomName: entitlement.roomName,
        paidUntilAtMillis: nextPaidUntilAt.toMillis(),
        chargedPoints: decision.chargePoints,
        keyCount: decision.nextBalance,
        freeSegment: entitlement.callData.freeSegment === true,
        token,
        idempotentReplay: false,
      };
    });

    return {
      ok: true,
      callId,
      roomName: result.roomName,
      agoraAppId: appId,
      token: result.token.token,
      rtcUid: result.token.rtcUid,
      tokenExpiresAt: result.token.expiresAt,
      paidUntilAt: result.paidUntilAtMillis,
      chargedPoints: result.chargedPoints,
      keyCount: result.keyCount,
      freeSegment: result.freeSegment,
      clientRequestId,
      idempotentReplay: result.idempotentReplay,
    };
  }
);

/**
 * submitRating(data: { ratedUid: string, stars: number, tags?: string[] })
 * -> { ok: true }
 *
 * Creates one rating per rater/rated pair after verifying an active 1:1 chat
 * exists. Rating aggregation remains handled by onRatingWritten.
 */
export const submitRating = regionalFunctions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const raterUid = await requireAuthAndNotBanned(context);
    const ratedUid = data.ratedUid;
    const stars = data.stars;
    const rawTags: unknown[] = Array.isArray(data.tags) ? data.tags : [];

    if (typeof ratedUid !== 'string' || ratedUid.length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'ratedUid must be a non-empty string'
      );
    }

    if (raterUid === ratedUid) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Cannot rate yourself'
      );
    }

    if (typeof stars !== 'number' || stars < 1 || stars > 5) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'stars must be between 1 and 5'
      );
    }

    const [matchId, ratedSnap] = await Promise.all([
      findMatch(raterUid, ratedUid),
      db.collection('users').doc(ratedUid).get(),
    ]);

    if (activeAccountIssue({
      exists: ratedSnap.exists,
      userData: ratedSnap.data(),
    }) !== null) {
      throw new functions.https.HttpsError('not-found', 'Rated user not found');
    }

    if (!matchId) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'A chat room is required before rating'
      );
    }

    const tags = rawTags
      .filter((tag): tag is string => typeof tag === 'string')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)
      .slice(0, 10);

    const ratingId = `${raterUid}_${ratedUid}`;
    const ratingRef = db.collection('ratings').doc(ratingId);
    await db.runTransaction(async (transaction) => {
      const raterRef = db.collection('users').doc(raterUid);
      const ratedRef = db.collection('users').doc(ratedUid);
      const matchRef = db.collection('matches').doc(matchId);
      const [existing, freshRater, freshRated, freshMatch] = await Promise.all([
        transaction.get(ratingRef),
        transaction.get(raterRef),
        transaction.get(ratedRef),
        transaction.get(matchRef),
      ]);
      assertActiveAccountSnapshot(freshRater, 'Rater');
      assertActiveAccountSnapshot(freshRated, 'Rated user');
      if (
        !freshMatch.exists ||
        freshMatch.data()?.isActive !== true ||
        !isExactDirectChatParticipants(
          freshMatch.data()?.userIds,
          [raterUid, ratedUid]
        )
      ) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'An active chat room is required before rating'
        );
      }
      if (existing.exists) {
        throw new functions.https.HttpsError(
          'already-exists',
          'Rating already submitted'
        );
      }

      transaction.set(ratingRef, {
        raterUid,
        ratedUid,
        stars: Math.round(stars),
        tags,
        matchId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return { ok: true };
  }
);

/**
 * translateText(data: { text: string, targetLang: 'ko' | 'ja' })
 * -> { translatedText: string }
 *
 * On-demand translation callable for lounge post/comment/reply translation.
 */
export const translateText = regionalFunctions.https.onCall(
  async (data: any, context: functions.https.CallableContext) => {
    const uid = await requireAuthAndNotBanned(context);
    const request = validateTranslationRequest(data.text, data.targetLang);
    if (!request.ok) {
      const message =
        request.reason === 'empty-text'
          ? 'text must not be empty'
          : request.reason === 'text-too-long'
            ? 'text must be <= 1000 characters'
            : 'targetLang must be ko or ja';
      throw new functions.https.HttpsError('invalid-argument', message);
    }

    await reserveTranslationQuota(uid, request.text.length);
    const translatedText = await callGoogleTranslate(
      request.text,
      request.targetLang
    );
    return { translatedText };
  }
);

/**
 * resetDailyKeys — disabled.
 *
 * Free points are no longer granted by a 24-hour reset. Users can earn the
 * daily free reward by writing one lounge post per KST day.
 */
export const resetDailyKeys = regionalFunctions.pubsub
  .schedule('0 15 * * *') // 자정 KST = 15:00 UTC
  .timeZone('Asia/Seoul')
  .onRun(async () => {
    console.info('resetDailyKeys disabled; lounge post reward policy is active');
    return null;
  });

export const onRatingWritten = regionalFunctions.firestore
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

    // Verify an active chat room exists between rater and rated.
    const matchId = await findMatch(raterUid, ratedUid);
    if (!matchId) {
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
