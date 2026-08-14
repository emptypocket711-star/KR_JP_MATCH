import * as admin from 'firebase-admin';
import { randomUUID } from 'crypto';
import {
  AccountDeletionPhase,
  accountDeletionJobLeaseMillis,
  accountDeletionLeaseIssue,
  accountDeletionPhaseForJob,
  accountDeletionRetryDelayMillis,
  accountDeletionRetryStatusForPhase,
  accountDeletionStorageTargets,
  assertAccountDeletionOperationsFulfilled,
  chatPairKeyForDeletedAccount,
  decideAccountDeletionJobClaim,
  displayNameReservationForDeletion,
  hiddenParticipantsForDeletedAccount,
  legacyMatchPhotoScrubForDeletedAccount,
  isVerifiedZeroOwnedDocuments,
  nextAccountDeletionPhase,
  shouldClearDeletedAccountPairPointer,
  shouldWriteAccountDeletionTombstone,
  unverifiedOrNonEmptyStoragePrefixes,
} from './accountDeletionPolicy';
import { activeAccountIssue } from './callablePolicy';
import {
  mediaUploadAuthorizationTtlMillis,
  mediaUploadLateFinalizeRetentionMillis,
} from './mediaUploadPolicy';

const QUERY_PAGE_SIZE = 100;
const WRITE_BATCH_SIZE = 400;
const STORAGE_DELETE_PAGE_SIZE = 100;
const STORAGE_DELETE_MAX_PAGES_PER_PREFIX = 1_000;
const SCHEDULE_PROCESS_LIMIT = 20;
const SCHEDULE_READY_PROCESS_LIMIT = 15;
const SCHEDULE_LEGACY_PROCESS_LIMIT = 5;
const SCHEDULE_LEGACY_SCAN_LIMIT = 50;
const LEASE_HEARTBEAT_MILLIS = 60 * 1000;

export const accountDeletionRunnableStatuses = [
  'deleting',
  'storage_retry_required',
  'auth_retry_required',
  // States written by the pre-worker implementation. They restart from an
  // exact Storage verification gate in accountDeletionPhaseForJob().
  'storage_deleted',
  'finalizing',
] as const;

interface ClaimedAccountDeletionPhase {
  uid: string;
  phase: AccountDeletionPhase;
  leaseOwner: string;
  attempts: number;
}

interface AccountDeletionPhaseResult {
  processed: boolean;
  complete: boolean;
  pending: boolean;
}

export interface AccountDeletionProcessor {
  enqueue(uid: string): Promise<'complete' | 'queued'>;
  process(uid: string, maxPhases?: number): Promise<AccountDeletionPhaseResult>;
  processRunnableJobs(): Promise<{ scanned: number; processed: number }>;
}

export function createAccountDeletionProcessor(input: {
  db: FirebaseFirestore.Firestore;
  auth: admin.auth.Auth;
  bucket: ReturnType<typeof admin.storage> extends { bucket: (...args: any[]) => infer T }
    ? T
    : never;
}): AccountDeletionProcessor {
  const { db, auth, bucket } = input;

  const jobRefFor = (uid: string) =>
    db.collection('accountDeletionJobs').doc(uid);
  const userRefFor = (uid: string) => db.collection('users').doc(uid);

  async function enqueue(uid: string): Promise<'complete' | 'queued'> {
    const userRef = userRefFor(uid);
    const jobRef = jobRefFor(uid);
    return db.runTransaction(async (tx) => {
      const [userSnap, jobSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(jobRef),
      ]);
      if (jobSnap.data()?.status === 'complete') return 'complete';

      const now = admin.firestore.FieldValue.serverTimestamp();
      const existing = jobSnap.data();
      const resumablePhase = accountDeletionPhaseForJob({
        status: existing?.status,
        phase: existing?.phase,
      });
      const resumable = resumablePhase != null && resumablePhase !== 'complete';
      // After identity_cleanup deletes users/{uid}, an Auth retry or a caller
      // retry must never recreate a partial user shell.
      if (shouldWriteAccountDeletionTombstone({
        userExists: userSnap.exists,
        resumablePhase,
      })) {
        tx.set(userRef, {
          deletionRequested: true,
          accountStatus: 'deleting',
          profileMediaVisibilityVersion: admin.firestore.FieldValue.delete(),
          deletionRequestedAt: userSnap.data()?.deletionRequestedAt ?? now,
          updatedAt: now,
        }, { merge: true });
      }
      tx.set(jobRef, {
        uid,
        status: 'deleting',
        phase: resumable ? resumablePhase : 'media_revoke',
        requestAttempts: admin.firestore.FieldValue.increment(1),
        requestedAt: existing?.requestedAt ?? now,
        nextAttemptAt: admin.firestore.Timestamp.fromMillis(Date.now()),
        updatedAt: now,
      }, { merge: true });
      return 'queued';
    });
  }

  async function claim(uid: string): Promise<ClaimedAccountDeletionPhase | null> {
    const jobRef = jobRefFor(uid);
    const leaseOwner = randomUUID();
    return db.runTransaction(async (tx) => {
      const jobSnap = await tx.get(jobRef);
      if (!jobSnap.exists) return null;
      const jobData = jobSnap.data() ?? {};
      const nowMillis = Date.now();
      const decision = decideAccountDeletionJobClaim({
        status: jobData.status,
        phase: jobData.phase,
        leaseOwner: jobData.leaseOwner,
        leaseUntilMillis: timestampMillis(jobData.leaseUntil),
        nextAttemptAtMillis: timestampMillis(jobData.nextAttemptAt),
      }, nowMillis);
      if (!decision.claim || decision.phase == null || decision.phase === 'complete') {
        return null;
      }
      const attempts = safeInteger(jobData.attempts) + 1;
      tx.set(jobRef, {
        status: 'deleting',
        phase: decision.phase,
        attempts,
        leaseOwner,
        leaseUntil: admin.firestore.Timestamp.fromMillis(
          nowMillis + accountDeletionJobLeaseMillis
        ),
        lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
        nextAttemptAt: admin.firestore.Timestamp.fromMillis(
          nowMillis + accountDeletionJobLeaseMillis
        ),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return { uid, phase: decision.phase, leaseOwner, attempts };
    });
  }

  async function assertCurrentLease(
    tx: FirebaseFirestore.Transaction,
    claimed: ClaimedAccountDeletionPhase
  ): Promise<FirebaseFirestore.DocumentSnapshot> {
    const jobSnap = await tx.get(jobRefFor(claimed.uid));
    const data = jobSnap.data() ?? {};
    const issue = accountDeletionLeaseIssue({
      status: data.status,
      phase: data.phase,
      leaseOwner: data.leaseOwner,
      leaseUntilMillis: timestampMillis(data.leaseUntil),
    }, {
      phase: claimed.phase,
      leaseOwner: claimed.leaseOwner,
      nowMillis: Date.now(),
    });
    if (issue != null) throw new Error(`account deletion lease lost: ${issue}`);
    return jobSnap;
  }

  async function advance(
    claimed: ClaimedAccountDeletionPhase,
    extra: FirebaseFirestore.DocumentData = {}
  ): Promise<AccountDeletionPhase> {
    const nextPhase = nextAccountDeletionPhase(claimed.phase);
    await db.runTransaction(async (tx) => {
      await assertCurrentLease(tx, claimed);
      tx.set(jobRefFor(claimed.uid), {
        status: nextPhase === 'complete' ? 'complete' : 'deleting',
        phase: nextPhase,
        leaseOwner: admin.firestore.FieldValue.delete(),
        leaseUntil: admin.firestore.FieldValue.delete(),
        nextAttemptAt: nextPhase === 'complete'
          ? admin.firestore.FieldValue.delete()
          : admin.firestore.Timestamp.fromMillis(Date.now()),
        lastErrorStage: admin.firestore.FieldValue.delete(),
        lastErrorMessage: admin.firestore.FieldValue.delete(),
        ...(nextPhase === 'complete'
          ? { completedAt: admin.firestore.FieldValue.serverTimestamp() }
          : {}),
        ...extra,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    return nextPhase;
  }

  async function recordFailure(
    claimed: ClaimedAccountDeletionPhase,
    error: unknown
  ): Promise<void> {
    const delayMillis = accountDeletionRetryDelayMillis(claimed.attempts);
    await db.runTransaction(async (tx) => {
      try {
        await assertCurrentLease(tx, claimed);
      } catch (leaseError) {
        console.warn(`Account deletion failure ledger skipped for ${claimed.uid}:`, leaseError);
        return;
      }
      tx.set(jobRefFor(claimed.uid), {
        status: accountDeletionRetryStatusForPhase(claimed.phase),
        phase: claimed.phase,
        leaseOwner: admin.firestore.FieldValue.delete(),
        leaseUntil: admin.firestore.FieldValue.delete(),
        nextAttemptAt: admin.firestore.Timestamp.fromMillis(Date.now() + delayMillis),
        lastErrorStage: claimed.phase,
        lastErrorMessage: safeErrorMessage(error),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });
  }

  async function process(
    uid: string,
    maxPhases = 1
  ): Promise<AccountDeletionPhaseResult> {
    let processed = false;
    for (let index = 0; index < Math.max(1, Math.min(maxPhases, 6)); index++) {
      const claimed = await claim(uid);
      if (claimed == null) {
        const snap = await jobRefFor(uid).get();
        const complete = snap.data()?.status === 'complete';
        return { processed, complete, pending: !complete };
      }
      processed = true;
      try {
        const extra = await executeWithLeaseHeartbeat(claimed);
        const nextPhase = await advance(claimed, extra);
        if (nextPhase === 'complete') {
          return { processed: true, complete: true, pending: false };
        }
      } catch (error) {
        console.error(
          `Account deletion ${claimed.phase} for ${claimed.uid} failed:`,
          error
        );
        await recordFailure(claimed, error);
        return { processed: true, complete: false, pending: true };
      }
    }
    return { processed, complete: false, pending: true };
  }

  async function renewLease(claimed: ClaimedAccountDeletionPhase): Promise<void> {
    await db.runTransaction(async (tx) => {
      await assertCurrentLease(tx, claimed);
      tx.set(jobRefFor(claimed.uid), {
        leaseUntil: admin.firestore.Timestamp.fromMillis(
          Date.now() + accountDeletionJobLeaseMillis
        ),
        nextAttemptAt: admin.firestore.Timestamp.fromMillis(
          Date.now() + accountDeletionJobLeaseMillis
        ),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });
  }

  async function executeWithLeaseHeartbeat(
    claimed: ClaimedAccountDeletionPhase
  ): Promise<FirebaseFirestore.DocumentData> {
    let heartbeatFailure: unknown;
    let heartbeatRunning = false;
    await renewLease(claimed);
    const heartbeat = setInterval(() => {
      if (heartbeatRunning || heartbeatFailure != null) return;
      heartbeatRunning = true;
      void renewLease(claimed)
        .catch((error) => {
          heartbeatFailure = error;
        })
        .finally(() => {
          heartbeatRunning = false;
        });
    }, LEASE_HEARTBEAT_MILLIS);
    try {
      const result = await executePhase(claimed);
      if (heartbeatFailure != null) throw heartbeatFailure;
      await renewLease(claimed);
      return result;
    } finally {
      clearInterval(heartbeat);
    }
  }

  async function executePhase(
    claimed: ClaimedAccountDeletionPhase
  ): Promise<FirebaseFirestore.DocumentData> {
    switch (claimed.phase) {
      case 'media_revoke':
        await revokeMediaAuthorizations(claimed.uid);
        return {
          mediaRevokedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
      case 'firestore_cleanup':
        await cleanupFirestore(claimed.uid);
        return {
          firestoreCleanedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
      case 'storage_cleanup':
        await enforceMediaRevocationQuarantine(claimed.uid);
        await deleteAndVerifyOwnedStorage(claimed.uid);
        return {
          storageDeletedAt: admin.firestore.FieldValue.serverTimestamp(),
          storageVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
      case 'identity_cleanup':
        await assertFinalDeletionGates(claimed.uid);
        await preserveRevokedMediaAuthorizationTombstones(claimed.uid);
        await cleanupFirestoreIdentity(claimed.uid);
        return {
          identityDeletedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
      case 'auth_cleanup':
        try {
          await auth.deleteUser(claimed.uid);
        } catch (error: any) {
          if (error?.code !== 'auth/user-not-found') throw error;
        }
        return {
          authDeletedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
      case 'complete':
        return {};
    }
  }

  async function revokeMediaAuthorizations(uid: string): Promise<void> {
    await visitQueryPages(
      db.collection('mediaUploadAuthorizations').where('uid', '==', uid),
      async (docs) => {
        const batch = db.batch();
        docs.forEach((doc) => batch.set(doc.ref, {
          status: 'account_deletion_revoked',
          downloadToken: admin.firestore.FieldValue.delete(),
          confirmedUrl: admin.firestore.FieldValue.delete(),
          lockedUrl: admin.firestore.FieldValue.delete(),
          expiresAt: admin.firestore.FieldValue.delete(),
          cleanupState: admin.firestore.FieldValue.delete(),
          cleanupLeaseOwner: admin.firestore.FieldValue.delete(),
          cleanupLeaseUntil: admin.firestore.FieldValue.delete(),
          cleanupNextAttemptAt: admin.firestore.FieldValue.delete(),
          expireAt: admin.firestore.Timestamp.fromMillis(
            Date.now() + mediaUploadLateFinalizeRetentionMillis
          ),
          accountDeletionRevokedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true }));
        await batch.commit();
      }
    );
  }

  async function enforceMediaRevocationQuarantine(uid: string): Promise<void> {
    const jobSnap = await jobRefFor(uid).get();
    const revokedAt = timestampMillis(jobSnap.data()?.mediaRevokedAt);
    if (revokedAt == null) throw new Error('media revocation timestamp is missing');
    const safeAt = revokedAt + mediaUploadAuthorizationTtlMillis;
    if (Date.now() < safeAt) {
      throw new Error(`media upload quarantine remains until ${safeAt}`);
    }
  }

  async function cleanupFirestore(uid: string): Promise<void> {
    await Promise.all([
      deleteCollectionPath(`users/${uid}/blocks`),
      deleteCollectionPath(`users/${uid}/seen`),
      deleteCollectionPath(`users/${uid}/notifications`),
    ]);

    await anonymizeOwnedActivity(
      db.collectionGroup('comments').where('uid', '==', uid)
    );
    await anonymizeOwnedActivity(
      db.collectionGroup('replies').where('uid', '==', uid)
    );
    await deleteQueryFully(
      db.collectionGroup('likes').where('uid', '==', uid)
    );

    while (true) {
      const posts = await db.collection('posts')
        .where('uid', '==', uid)
        .limit(25)
        .get();
      if (posts.empty) break;
      for (const post of posts.docs) await deletePostTree(post.ref);
    }
    await assertZeroQuery(
      db.collection('posts').where('uid', '==', uid),
      'authored posts'
    );

    await deleteQueryFully(db.collection('likes').where('fromUid', '==', uid));
    await deleteQueryFully(db.collection('likes').where('toUid', '==', uid));
    await deleteRatings(uid);
    await closeActiveMatches(uid);
    await endParticipantCalls(uid);
    await cleanupPrivateOperationalState(uid);
  }

  async function cleanupPrivateOperationalState(uid: string): Promise<void> {
    await Promise.all([
      deleteQueryFully(db.collection('translationUsage').where('uid', '==', uid)),
      deleteQueryFully(db.collection('callDailyQuotas').where('uid', '==', uid)),
      deleteQueryFully(db.collection('mediaUploadQuotas').where('uid', '==', uid)),
      deleteQueryFully(db.collection('privateMediaReadQuotas').where('uid', '==', uid)),
      deleteQueryFully(db.collection('mediaUploadRequestQuotas').where('uid', '==', uid)),
      db.collection('translationUsage').doc(uid).delete(),
      db.collection('storeVerificationQuotas').doc(uid).delete(),
    ]);

    // Pending raw store tokens are non-audit operational state. Remove every
    // caller-owned pending record; granted store ledgers and point events stay
    // intact for financial/fraud audit.
    await deleteQueryFully(
      db.collection('pendingStorePurchases').where('uid', '==', uid)
    );
    await Promise.all([
      assertZeroQuery(db.collection('translationUsage').where('uid', '==', uid),
        'translation usage'),
      assertZeroQuery(db.collection('callDailyQuotas').where('uid', '==', uid),
        'call daily quotas'),
      assertZeroQuery(db.collection('mediaUploadQuotas').where('uid', '==', uid),
        'media upload quotas'),
      assertZeroQuery(db.collection('privateMediaReadQuotas').where('uid', '==', uid),
        'private media read quotas'),
      assertZeroQuery(db.collection('mediaUploadRequestQuotas').where('uid', '==', uid),
        'media upload request quotas'),
      assertZeroQuery(db.collection('pendingStorePurchases').where('uid', '==', uid),
        'pending store purchases'),
    ]);
    const [legacyUsage, storeQuota] = await Promise.all([
      db.collection('translationUsage').doc(uid).get(),
      db.collection('storeVerificationQuotas').doc(uid).get(),
    ]);
    if (legacyUsage.exists || storeQuota.exists) {
      throw new Error('private operational singleton cleanup verification failed');
    }
  }

  async function anonymizeOwnedActivity(query: FirebaseFirestore.Query): Promise<void> {
    while (true) {
      const snap = await query.limit(WRITE_BATCH_SIZE).get();
      if (snap.empty) return;
      const batch = db.batch();
      snap.docs.forEach((doc) => batch.update(doc.ref, {
        uid: null,
        authorName: '탈퇴한 사용자',
        authorPhotoUrl: '',
        authorNationality: '',
        authorGender: '',
        content: '삭제된 댓글입니다.',
        translations: admin.firestore.FieldValue.delete(),
        deleted: true,
        deletedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }));
      await batch.commit();
    }
  }

  async function deletePostTree(postRef: FirebaseFirestore.DocumentReference): Promise<void> {
    while (true) {
      const comments = await postRef.collection('comments').limit(25).get();
      if (comments.empty) break;
      for (const comment of comments.docs) {
        await deleteCollectionPath(`${comment.ref.path}/replies`);
        await comment.ref.delete();
      }
    }
    await deleteCollectionPath(`post_likes/${postRef.id}/likes`);
    const results = await Promise.allSettled([
      db.collection('post_likes').doc(postRef.id).delete(),
      postRef.delete(),
    ]);
    assertAccountDeletionOperationsFulfilled('delete-post-tree-root', results);
  }

  async function deleteRatings(uid: string): Promise<void> {
    const affected = new Set<string>();
    while (true) {
      const snap = await db.collection('ratings')
        .where('raterUid', '==', uid)
        .limit(WRITE_BATCH_SIZE)
        .get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((doc) => {
        const ratedUid = doc.data().ratedUid;
        if (typeof ratedUid === 'string' && ratedUid !== uid) affected.add(ratedUid);
        batch.delete(doc.ref);
      });
      await batch.commit();
    }
    await deleteQueryFully(db.collection('ratings').where('ratedUid', '==', uid));
    for (const ratedUid of affected) await recomputeRating(ratedUid);
  }

  async function recomputeRating(ratedUid: string): Promise<void> {
    const ratings = await db.collection('ratings')
      .where('ratedUid', '==', ratedUid)
      .get();
    let sum = 0;
    ratings.docs.forEach((doc) => {
      if (typeof doc.data().stars === 'number') sum += doc.data().stars;
    });
    await db.runTransaction(async (tx) => {
      const userRef = userRefFor(ratedUid);
      const userSnap = await tx.get(userRef);
      if (activeAccountIssue({
        exists: userSnap.exists,
        userData: userSnap.data(),
      }) != null) return;
      tx.update(userRef, {
        ratingSum: sum,
        ratingCount: ratings.size,
        avgRating: ratings.empty
          ? 0
          : Math.round((sum / ratings.size) * 10) / 10,
      });
    });
  }

  async function closeActiveMatches(uid: string): Promise<void> {
    while (true) {
      const matches = await db.collection('matches')
        .where('userIds', 'array-contains', uid)
        .where('isActive', '==', true)
        .limit(QUERY_PAGE_SIZE)
        .get();
      if (matches.empty) return;
      for (const matchDoc of matches.docs) {
        await db.runTransaction(async (tx) => {
          const fresh = await tx.get(matchDoc.ref);
          if (!fresh.exists || fresh.data()?.isActive !== true) return;
          const userIds = fresh.data()?.userIds;
          const hiddenFor = hiddenParticipantsForDeletedAccount(userIds, uid);
          const pairKey = chatPairKeyForDeletedAccount(userIds, uid);
          const pairRef = pairKey == null ? null : db.collection('chatPairs').doc(pairKey);
          const pairSnap = pairRef == null ? null : await tx.get(pairRef);
          tx.update(matchDoc.ref, {
            isActive: false,
            hiddenFor: admin.firestore.FieldValue.arrayUnion(...hiddenFor),
            closedBy: uid,
            closedReason: 'account_deleted',
            closedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          if (pairRef != null && shouldClearDeletedAccountPairPointer({
            activeMatchId: pairSnap?.data()?.activeMatchId,
            closingMatchId: matchDoc.id,
          })) {
            tx.set(pairRef, {
              pairKey,
              userIds: [...hiddenFor].sort(),
              activeMatchId: admin.firestore.FieldValue.delete(),
              closedMatchId: matchDoc.id,
              closedReason: 'account_deleted',
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
          }
        });
      }
    }
  }

  async function endParticipantCalls(uid: string): Promise<void> {
    for (const query of [
      db.collection('calls').where('participantUids', 'array-contains', uid),
      db.collection('calls').where('callerUid', '==', uid),
      db.collection('calls').where('calleeUid', '==', uid),
    ]) {
      await visitQueryPages(query, async (docs) => {
        for (const call of docs) await endParticipantCall(uid, call);
      });
    }
  }

  async function endParticipantCall(
    uid: string,
    call: FirebaseFirestore.QueryDocumentSnapshot
  ): Promise<void> {
    if (!['ringing', 'accepted'].includes(call.data().status)) return;
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(call.ref);
      if (!fresh.exists || !['ringing', 'accepted'].includes(fresh.data()?.status)) return;
      const matchId = fresh.data()?.matchId;
      const activeCallRef = typeof matchId === 'string' && matchId.length > 0
        ? db.collection('activeCalls').doc(matchId)
        : null;
      const activeCall = activeCallRef == null ? null : await tx.get(activeCallRef);
      tx.update(call.ref, {
        status: 'ended',
        endedBy: uid,
        endedReason: 'account_deleted',
        endedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      if (activeCallRef != null && activeCall?.data()?.callId === call.id) {
        tx.delete(activeCallRef);
      }
    });
  }

  async function deleteAndVerifyOwnedStorage(uid: string): Promise<void> {
    const verified = new Set<string>();
    const deleteTargets = async (
      matchIds: readonly string[],
      objectPaths: readonly unknown[]
    ) => {
      const targets = accountDeletionStorageTargets({
        uid,
        matchIds,
        authorizationObjectPaths: objectPaths,
      });
      if (targets.invalidAuthorizationObjectPaths.length > 0) {
        throw new Error('unsafe media authorization object path blocks deletion');
      }
      for (const prefix of targets.prefixes) {
        if (verified.has(prefix)) continue;
        await deleteStoragePrefix(prefix);
        verified.add(prefix);
      }
    };

    await deleteTargets([], []);
    await visitQueryPages(
      db.collection('matches').where('userIds', 'array-contains', uid),
      async (docs) => deleteTargets(docs.map((doc) => doc.id), [])
    );
    await visitQueryPages(
      db.collection('mediaUploadAuthorizations').where('uid', '==', uid),
      async (docs) => deleteTargets([], docs.map((doc) => doc.data().objectPath))
    );

    await verifyOwnedStorageIsEmpty(uid);
    await scrubDeletedMediaReferences(uid);
  }

  async function scrubDeletedMediaReferences(uid: string): Promise<void> {
    await visitQueryPages(
      db.collection('matches').where('userIds', 'array-contains', uid),
      async (matches) => {
        for (const match of matches) {
          const batch = db.batch();
          const viewers = Array.isArray(match.data().userIds)
            ? match.data().userIds.filter(
                (candidate: unknown): candidate is string =>
                  typeof candidate === 'string' && candidate !== uid
              )
            : [];
          const anonymizedPartner: FirebaseFirestore.UpdateData<
            FirebaseFirestore.DocumentData
          > = {
            ...legacyMatchPhotoScrubForDeletedAccount(
              match.data().userIds,
              uid
            ),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          };
          viewers.forEach((viewerUid: string) => {
            anonymizedPartner[`partnerFor.${viewerUid}.displayName`] = '탈퇴한 사용자';
            anonymizedPartner[`partnerFor.${viewerUid}.photoUrl`] = '';
          });
          batch.update(match.ref, anonymizedPartner);
          await batch.commit();

          // Messages cannot be collection-group filtered by both sender and
          // image type without deployment-specific composite indexes, so scan
          // this bounded room subcollection page-by-page.
          await visitQueryPages(match.ref.collection('messages'), async (messages) => {
            const messageBatch = db.batch();
            let changed = 0;
            for (const message of messages) {
              const data = message.data();
              const path = data.imagePath;
              const isOwnedImage = data.messageType === 'image' &&
                (data.senderId === uid || (
                  typeof path === 'string' &&
                  path.startsWith(`chat_images/${match.id}/${uid}/`)
                ));
              if (!isOwnedImage) continue;
              messageBatch.set(message.ref, {
                imageUrl: admin.firestore.FieldValue.delete(),
                imagePath: admin.firestore.FieldValue.delete(),
                mediaDeleted: true,
                mediaDeletedAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              }, { merge: true });
              changed++;
            }
            if (changed > 0) await messageBatch.commit();
          });
        }
      }
    );
  }

  async function deleteStoragePrefix(prefix: string): Promise<void> {
    for (let page = 0; page < STORAGE_DELETE_MAX_PAGES_PER_PREFIX; page++) {
      const [files] = await bucket.getFiles({
        prefix,
        maxResults: STORAGE_DELETE_PAGE_SIZE,
        autoPaginate: false,
      });
      if (files.length === 0) return;
      const results = await Promise.allSettled(
        files.map((file: any) => file.delete({ ignoreNotFound: true }))
      );
      assertAccountDeletionOperationsFulfilled(`delete-storage:${prefix}`, results);
    }
    throw new Error(`storage deletion page limit reached for ${prefix}`);
  }

  async function verifyOwnedStorageIsEmpty(uid: string): Promise<void> {
    const checked = new Set<string>();
    const verifyTargets = async (
      matchIds: readonly string[],
      objectPaths: readonly unknown[]
    ) => {
      const targets = accountDeletionStorageTargets({
        uid,
        matchIds,
        authorizationObjectPaths: objectPaths,
      });
      if (targets.invalidAuthorizationObjectPaths.length > 0) {
        throw new Error('unsafe media authorization object path blocks verification');
      }
      for (const prefix of targets.prefixes) {
        if (checked.has(prefix)) continue;
        const [remaining] = await bucket.getFiles({
          prefix,
          maxResults: 1,
          autoPaginate: false,
        });
        const counts = { [prefix]: remaining.length };
        const failures = unverifiedOrNonEmptyStoragePrefixes([prefix], counts);
        if (failures.length > 0) throw new Error(`storage prefix is not empty: ${prefix}`);
        checked.add(prefix);
      }
    };
    await verifyTargets([], []);
    await visitQueryPages(
      db.collection('matches').where('userIds', 'array-contains', uid),
      async (docs) => verifyTargets(docs.map((doc) => doc.id), [])
    );
    await visitQueryPages(
      db.collection('mediaUploadAuthorizations').where('uid', '==', uid),
      async (docs) => verifyTargets([], docs.map((doc) => doc.data().objectPath))
    );
  }

  async function assertFinalDeletionGates(uid: string): Promise<void> {
    await revokeMediaAuthorizations(uid);
    await assertZeroQuery(
      db.collection('posts').where('uid', '==', uid),
      'authored posts'
    );
    await assertZeroQuery(
      db.collectionGroup('comments').where('uid', '==', uid),
      'authored comments'
    );
    await assertZeroQuery(
      db.collectionGroup('replies').where('uid', '==', uid),
      'authored replies'
    );
    await Promise.all([
      assertZeroQuery(db.collection('translationUsage').where('uid', '==', uid),
        'translation usage'),
      assertZeroQuery(db.collection('callDailyQuotas').where('uid', '==', uid),
        'call daily quotas'),
      assertZeroQuery(db.collection('mediaUploadQuotas').where('uid', '==', uid),
        'media upload quotas'),
      assertZeroQuery(db.collection('privateMediaReadQuotas').where('uid', '==', uid),
        'private media read quotas'),
      assertZeroQuery(db.collection('mediaUploadRequestQuotas').where('uid', '==', uid),
        'media upload request quotas'),
      assertZeroQuery(db.collection('pendingStorePurchases').where('uid', '==', uid),
        'pending store purchases'),
    ]);
    const [legacyUsage, storeQuota] = await Promise.all([
      db.collection('translationUsage').doc(uid).get(),
      db.collection('storeVerificationQuotas').doc(uid).get(),
    ]);
    if (legacyUsage.exists || storeQuota.exists) {
      throw new Error('private operational singleton verification failed');
    }
    await verifyOwnedStorageIsEmpty(uid);
  }

  async function preserveRevokedMediaAuthorizationTombstones(
    uid: string
  ): Promise<void> {
    const query = db.collection('mediaUploadAuthorizations').where('uid', '==', uid);
    await visitQueryPages(query, async (docs) => {
      const batch = db.batch();
      docs.forEach((doc) => batch.set(doc.ref, {
        status: 'account_deletion_revoked',
        downloadToken: admin.firestore.FieldValue.delete(),
        confirmedUrl: admin.firestore.FieldValue.delete(),
        lockedUrl: admin.firestore.FieldValue.delete(),
        expiresAt: admin.firestore.FieldValue.delete(),
        cleanupState: admin.firestore.FieldValue.delete(),
        cleanupLeaseOwner: admin.firestore.FieldValue.delete(),
        cleanupLeaseUntil: admin.firestore.FieldValue.delete(),
        cleanupNextAttemptAt: admin.firestore.FieldValue.delete(),
        expireAt: admin.firestore.Timestamp.fromMillis(
          Date.now() + mediaUploadLateFinalizeRetentionMillis
        ),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true }));
      await batch.commit();
    });
  }

  async function cleanupFirestoreIdentity(uid: string): Promise<void> {
    const userRef = userRefFor(uid);
    const userSnap = await userRef.get();
    const displayNameReservationId = displayNameReservationForDeletion(
      userSnap.data()?.displayNameNormalized
    );
    if (displayNameReservationId != null) {
      const reservationRef = db.collection('displayNameReservations')
        .doc(displayNameReservationId);
      await db.runTransaction(async (tx) => {
        const reservation = await tx.get(reservationRef);
        if (reservation.data()?.uid === uid) tx.delete(reservationRef);
      });
    }
    const tokenOwners = db.collection('fcmTokenOwners').where('uid', '==', uid);
    await deleteQueryFully(tokenOwners);
    await assertZeroQuery(tokenOwners, 'FCM token owners');
    await userRef.delete();
  }

  async function processRunnableJobs(): Promise<{ scanned: number; processed: number }> {
    let processed = 0;
    const seen = new Set<string>();
    const now = admin.firestore.Timestamp.now();

    // A single global due-time ordering prevents one status lane from
    // continuously hiding another. Scan beyond the execution budget so a
    // handful of concurrently leased jobs cannot hide runnable work either.
    const readySnap = await db.collection('accountDeletionJobs')
      .where('status', 'in', [...accountDeletionRunnableStatuses])
      .where('nextAttemptAt', '<=', now)
      .orderBy('nextAttemptAt')
      .limit(SCHEDULE_LEGACY_SCAN_LIMIT)
      .get();
    const scanned = readySnap.size;
    for (const doc of readySnap.docs) {
      if (processed >= SCHEDULE_READY_PROCESS_LIMIT) break;
      seen.add(doc.id);
      const result = await process(doc.id, 6);
      if (result.processed) processed++;
    }

    // Rotate through jobs written before nextAttemptAt became mandatory. This
    // compatibility lane reserves capacity, advances a persistent document-id
    // cursor, and therefore also cannot starve behind one stable first page.
    const legacy = await processLegacyRunnableJobs(
      seen,
      Math.min(SCHEDULE_LEGACY_PROCESS_LIMIT, SCHEDULE_PROCESS_LIMIT - processed)
    );
    return {
      scanned: scanned + legacy.scanned,
      processed: processed + legacy.processed,
    };
  }

  async function processLegacyRunnableJobs(
    seen: Set<string>,
    processLimit: number
  ): Promise<{ scanned: number; processed: number }> {
    if (processLimit <= 0) return { scanned: 0, processed: 0 };
    const cursorRef = db.collection('accountDeletionWorkerState').doc('scheduler');
    const cursorSnap = await cursorRef.get();
    const cursor = typeof cursorSnap.data()?.legacyCursor === 'string'
      ? cursorSnap.data()!.legacyCursor as string
      : null;
    let processed = 0;
    let query = db.collection('accountDeletionJobs')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(SCHEDULE_LEGACY_SCAN_LIMIT);
    if (cursor != null) query = query.startAfter(cursor);
    let snap = await query.get();
    if (snap.empty && cursor != null) {
      snap = await db.collection('accountDeletionJobs')
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(SCHEDULE_LEGACY_SCAN_LIMIT)
        .get();
    }
    const scanned = snap.size;
    const runnableStatuses = new Set<string>(accountDeletionRunnableStatuses);
    let lastExaminedId: string | null = null;
    for (const doc of snap.docs) {
      if (processed >= processLimit) break;
      lastExaminedId = doc.id;
      const job = doc.data();
      if (
        seen.has(doc.id) ||
        !runnableStatuses.has(job.status) ||
        timestampMillis(job.nextAttemptAt) != null
      ) continue;
      seen.add(doc.id);
      const result = await process(doc.id, 6);
      if (result.processed) processed++;
    }

    const fullyExaminedPage = snap.empty ||
      lastExaminedId === snap.docs[snap.docs.length - 1].id;
    const nextCursor = fullyExaminedPage && snap.size < SCHEDULE_LEGACY_SCAN_LIMIT
      ? null
      : lastExaminedId;

    await cursorRef.set({
      legacyCursor: nextCursor,
      legacyCursors: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { scanned, processed };
  }

  async function deleteCollectionPath(path: string): Promise<void> {
    while (true) {
      const snap = await db.collection(path).limit(WRITE_BATCH_SIZE).get();
      if (snap.empty) return;
      await deleteDocumentRefs(snap.docs.map((doc) => doc.ref));
    }
  }

  async function deleteQueryFully(query: FirebaseFirestore.Query): Promise<void> {
    while (true) {
      const snap = await query.limit(WRITE_BATCH_SIZE).get();
      if (snap.empty) return;
      await deleteDocumentRefs(snap.docs.map((doc) => doc.ref));
    }
  }

  async function deleteDocumentRefs(
    refs: readonly FirebaseFirestore.DocumentReference[]
  ): Promise<void> {
    for (let index = 0; index < refs.length; index += WRITE_BATCH_SIZE) {
      const batch = db.batch();
      refs.slice(index, index + WRITE_BATCH_SIZE).forEach((ref) => batch.delete(ref));
      await batch.commit();
    }
  }

  async function assertZeroQuery(
    query: FirebaseFirestore.Query,
    label: string
  ): Promise<void> {
    const snap = await query.limit(1).get();
    if (!isVerifiedZeroOwnedDocuments(snap.size)) {
      throw new Error(`${label} verification failed`);
    }
  }

  async function visitQueryPages(
    query: FirebaseFirestore.Query,
    visitor: (docs: FirebaseFirestore.QueryDocumentSnapshot[]) => Promise<void>
  ): Promise<void> {
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    while (true) {
      let pageQuery = query
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(QUERY_PAGE_SIZE);
      if (cursor != null) pageQuery = pageQuery.startAfter(cursor);
      const snap = await pageQuery.get();
      if (snap.empty) return;
      await visitor(snap.docs);
      cursor = snap.docs[snap.docs.length - 1];
      if (snap.size < QUERY_PAGE_SIZE) return;
    }
  }

  return { enqueue, process, processRunnableJobs };
}

function timestampMillis(value: unknown): number | undefined {
  if (value instanceof admin.firestore.Timestamp) return value.toMillis();
  return undefined;
}

function safeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/[\r\n]+/g, ' ').slice(0, 500);
}
