const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const {
  collection,
  doc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  deleteField,
  serverTimestamp,
} = require('firebase/firestore');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'demo-hana-rules';
const RULES_PATH = path.resolve(__dirname, '../firestore.rules');

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(RULES_PATH, 'utf8'),
      host: 'localhost',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

function authDb(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

function unauthDb() {
  return testEnv.unauthenticatedContext().firestore();
}

async function seed(docPath, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), docPath), data);
  });
}

describe('users', () => {
  beforeEach(async () => {
    await seed('users/alice', {
      displayName: 'Alice',
      keyCount: 4,
      status: 'active',
      uiLanguage: 'ko',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await seed('users/bob', {
      displayName: 'Bob',
      keyCount: 2,
      status: 'active',
      uiLanguage: 'ja',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  test('user can read only their own user document', async () => {
    const aliceDb = authDb('alice');
    const bobDb = authDb('bob');

    await assertSucceeds(getDoc(doc(aliceDb, 'users/alice')));
    await assertFails(getDoc(doc(bobDb, 'users/alice')));
    await assertFails(getDoc(doc(unauthDb(), 'users/alice')));
  });

  test('public profile fields do not make another user document readable', async () => {
    await seed('users/public_bob', {
      displayName: 'Public Bob',
      birthYear: 1997,
      gender: 'male',
      nationality: 'JP',
      residingCountry: 'JP',
      nativeLanguage: 'ja',
      learningLanguage: 'ko',
      bio: '한국어를 공부하고 있어요.',
      photoUrls: ['https://example.com/bob.jpg'],
      onboardingCompleted: true,
      keyCount: 2,
      fcmToken: 'private-token',
      moderationFlags: ['review'],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await assertFails(getDoc(doc(authDb('alice'), 'users/public_bob')));
  });

  test('client cannot create a user document', async () => {
    const aliceDb = authDb('alice');

    await assertFails(
      setDoc(doc(aliceDb, 'users/newAlice'), {
        displayName: 'New Alice',
        keyCount: 999,
        createdAt: serverTimestamp(),
      })
    );
  });

  test('user can update allowed own settings and presence fields', async () => {
    const aliceDb = authDb('alice');

    await assertSucceeds(
      updateDoc(doc(aliceDb, 'users/alice'), {
        notificationsEnabled: true,
        nightQuietEnabled: false,
        uiLanguage: 'ja',
        lastSeenAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    await assertSucceeds(
      updateDoc(doc(aliceDb, 'users/alice'), {
        uiLanguage: deleteField(),
      })
    );
  });

  test('deletion tombstone blocks otherwise allowed settings writes', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'users/alice'), {
        deletionRequested: true,
        accountStatus: 'deleting',
      });
    });

    await assertFails(
      updateDoc(doc(authDb('alice'), 'users/alice'), {
        notificationsEnabled: true,
        updatedAt: serverTimestamp(),
      })
    );
  });

  test('settings and presence updates reject malformed values', async () => {
    const aliceDb = authDb('alice');
    const malformedMutations = [
      { notificationsEnabled: 'yes' },
      { nightQuietEnabled: 1 },
      { uiLanguage: 'en' },
      { lastSeenAt: 'now' },
      { updatedAt: { seconds: 1 } },
      { approxLocation: { lat: '37.5', lng: 127.0 } },
      { approxLocation: { lat: 37.5 } },
      { approxLocation: { lat: 37.5, lng: 127.0, precise: true } },
      { approxLocation: { lat: -90.01, lng: 127.0 } },
      { approxLocation: { lat: 37.5, lng: 180.01 } },
      { locationUpdatedAt: serverTimestamp() },
    ];

    for (const mutation of malformedMutations) {
      await assertFails(updateDoc(doc(aliceDb, 'users/alice'), mutation));
    }
  });

  test('profile and identity fields can only be updated by updateMyProfile', async () => {
    const aliceDb = authDb('alice');
    const profileFieldMutations = [
      { displayName: 'Changed Alice' },
      { bio: '한국어와 일본어를 공부하고 있어요.' },
      { relationshipType: '언어교환' },
      { birthYear: 2000 },
      { gender: 'female' },
      { nationality: 'KR' },
      { residingCountry: 'JP' },
      { nativeLanguage: 'ko' },
      { learningLanguage: 'ja' },
      { occupation: '개발자' },
      { keywords: ['언어교환'] },
      { qaItems: [{ question: '취미는?', answer: '산책' }] },
      { photoUrls: ['https://example.com/profile.jpg'] },
      { preferredGender: 'any' },
      { preferredNationality: 'JP' },
      { preferredAgeMin: 18 },
      { preferredAgeMax: 50 },
    ];

    for (const mutation of profileFieldMutations) {
      await assertFails(updateDoc(doc(aliceDb, 'users/alice'), mutation));
    }
    await assertFails(
      updateDoc(doc(aliceDb, 'users/alice'), {
        bio: 'forged profile update',
        uiLanguage: 'ja',
        updatedAt: serverTimestamp(),
      })
    );
  });

  test('user cannot update server-owned point or moderation fields', async () => {
    const aliceDb = authDb('alice');

    await assertFails(updateDoc(doc(aliceDb, 'users/alice'), { keyCount: 999 }));
    await assertFails(updateDoc(doc(aliceDb, 'users/alice'), { fcmToken: 'forged' }));
    await assertFails(updateDoc(doc(aliceDb, 'users/alice'), { paymentLedgerVersion: 1 }));
    await assertFails(updateDoc(doc(aliceDb, 'users/alice'), { moderationFlags: [] }));
    await assertFails(updateDoc(doc(aliceDb, 'users/alice'), { status: 'banned' }));
    await assertFails(updateDoc(doc(aliceDb, 'users/alice'), { isBanned: false }));
    await assertFails(updateDoc(doc(aliceDb, 'users/alice'), { isDeleted: true }));
    await assertFails(updateDoc(doc(aliceDb, 'users/alice'), { deletedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(aliceDb, 'users/alice')));
  });

  test('user cannot update another user document', async () => {
    const aliceDb = authDb('alice');

    await assertFails(
      updateDoc(doc(aliceDb, 'users/bob'), {
        bio: 'forged update',
      })
    );
  });
});

describe('chat rooms and messages', () => {
  beforeEach(async () => {
    await seed('matches/room_ab', {
      userIds: ['alice', 'bob'],
      directRoomVersion: 1,
      isActive: true,
      hiddenFor: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await seed('matches/room_ab/messages/message_1', {
      senderId: 'alice',
      originalText: '안녕하세요',
      originalLang: 'ko',
      translations: { ja: 'こんにちは' },
      translationStatus: 'done',
      createdAt: new Date(),
    });
  });

  test('participants can read a chat room and outsiders cannot', async () => {
    await assertSucceeds(getDoc(doc(authDb('alice'), 'matches/room_ab')));
    await assertSucceeds(getDoc(doc(authDb('bob'), 'matches/room_ab')));
    await assertFails(getDoc(doc(authDb('carol'), 'matches/room_ab')));
    await assertFails(getDoc(doc(unauthDb(), 'matches/room_ab')));
  });

  test('participants can list their active chat rooms', async () => {
    const aliceDb = authDb('alice');
    const activeRoomsQuery = query(
      collection(aliceDb, 'matches'),
      where('userIds', 'array-contains', 'alice'),
      where('isActive', '==', true),
      where('directRoomVersion', '==', 1)
    );

    await assertSucceeds(getDocs(activeRoomsQuery));
  });

  test('client cannot create, update, or delete chat room records', async () => {
    const aliceDb = authDb('alice');

    await assertFails(
      setDoc(doc(aliceDb, 'matches/room_ac'), {
        userIds: ['alice', 'carol'],
        status: 'active',
      })
    );
    await assertFails(updateDoc(doc(aliceDb, 'matches/room_ab'), { status: 'inactive' }));
    await assertFails(deleteDoc(doc(aliceDb, 'matches/room_ab')));
  });

  test('participants can read messages but cannot write messages directly', async () => {
    const aliceDb = authDb('alice');

    await assertSucceeds(getDoc(doc(aliceDb, 'matches/room_ab/messages/message_1')));
    await assertFails(getDoc(doc(authDb('carol'), 'matches/room_ab/messages/message_1')));
    await assertFails(
      setDoc(doc(aliceDb, 'matches/room_ab/messages/message_2'), {
        senderId: 'alice',
        originalText: '좋아하는 음식은 뭐예요?',
        originalLang: 'ko',
        createdAt: serverTimestamp(),
      })
    );
    await assertFails(
      updateDoc(doc(aliceDb, 'matches/room_ab/messages/message_1'), {
        originalText: 'tampered',
      })
    );
  });

  test('closed or hidden rooms and messages are not readable by participants', async () => {
    await seed('matches/closed_ab', {
      userIds: ['alice', 'bob'],
      directRoomVersion: 1,
      isActive: false,
      hiddenFor: ['alice', 'bob'],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await seed('matches/closed_ab/messages/message_1', {
      senderId: 'alice',
      originalText: '이전 대화',
      createdAt: new Date(),
    });
    await seed('matches/hidden_for_alice', {
      userIds: ['alice', 'bob'],
      directRoomVersion: 1,
      isActive: true,
      hiddenFor: ['alice'],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await assertFails(getDoc(doc(authDb('alice'), 'matches/closed_ab')));
    await assertFails(getDoc(doc(authDb('bob'), 'matches/closed_ab')));
    await assertFails(getDoc(doc(authDb('alice'), 'matches/closed_ab/messages/message_1')));
    await assertFails(getDoc(doc(authDb('alice'), 'matches/hidden_for_alice')));
    await assertSucceeds(getDoc(doc(authDb('bob'), 'matches/hidden_for_alice')));
  });

  test('reported or blocked rooms are removed from active chat list queries', async () => {
    await seed('matches/reported_ab', {
      userIds: ['alice', 'bob'],
      directRoomVersion: 1,
      isActive: false,
      hiddenFor: ['alice', 'bob'],
      closedBy: 'alice',
      closedReason: 'reported',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await seed('matches/blocked_ab', {
      userIds: ['alice', 'bob'],
      directRoomVersion: 1,
      isActive: false,
      hiddenFor: ['alice', 'bob'],
      closedBy: 'alice',
      closedReason: 'blocked',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const aliceDb = authDb('alice');
    const activeRoomsQuery = query(
      collection(aliceDb, 'matches'),
      where('userIds', 'array-contains', 'alice'),
      where('isActive', '==', true),
      where('directRoomVersion', '==', 1)
    );

    const snap = await assertSucceeds(getDocs(activeRoomsQuery));
    const ids = snap.docs.map((d) => d.id);
    expect(ids).toContain('room_ab');
    expect(ids).not.toContain('reported_ab');
    expect(ids).not.toContain('blocked_ab');
  });

  test('chatPairs are server-owned and hidden from clients', async () => {
    await seed('chatPairs/alice_bob', {
      pairKey: 'alice_bob',
      userIds: ['alice', 'bob'],
      activeMatchId: 'room_ab',
      updatedAt: new Date(),
    });

    await assertFails(getDoc(doc(authDb('alice'), 'chatPairs/alice_bob')));
    await assertFails(
      setDoc(doc(authDb('alice'), 'chatPairs/alice_carol'), {
        pairKey: 'alice_carol',
        userIds: ['alice', 'carol'],
        activeMatchId: 'forged_room',
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(updateDoc(doc(authDb('alice'), 'chatPairs/alice_bob'), {
      activeMatchId: 'forged_room',
    }));
  });
});

describe('media upload ledgers', () => {
  beforeEach(async () => {
    await seed('mediaUploadAuthorizations/auth-1', {
      uid: 'alice',
      kind: 'profile',
      objectPath: 'profile_media/alice/auth-1/image.jpg',
      status: 'reserved',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await seed('mediaUploadQuotas/alice_2026-08-13', {
      uid: 'alice',
      dayKey: '2026-08-13',
      profileCount: 1,
      chatCount: 0,
    });
    await seed('mediaUploadGenerationCleanups/task-1', {
      authorizationId: 'auth-1',
      status: 'pending',
      nextAttemptAt: new Date(),
    });
    await seed('mediaUploadCleanupWorkerState/scheduler', {
      authorizationCursor: 'auth-1',
      updatedAt: new Date(),
    });
  });

  test('clients cannot inspect or mutate upload authorizations and quotas', async () => {
    for (const uid of ['alice', 'bob']) {
      const client = authDb(uid);
      await assertFails(
        getDoc(doc(client, 'mediaUploadAuthorizations/auth-1')),
      );
      await assertFails(
        updateDoc(doc(client, 'mediaUploadAuthorizations/auth-1'), {
          status: 'consumed',
        }),
      );
      await assertFails(
        getDoc(doc(client, 'mediaUploadQuotas/alice_2026-08-13')),
      );
      await assertFails(
        setDoc(doc(client, 'mediaUploadQuotas/forged'), {
          uid,
          profileCount: 0,
        }),
      );
      await assertFails(
        getDoc(doc(client, 'mediaUploadGenerationCleanups/task-1')),
      );
      await assertFails(
        setDoc(doc(client, 'mediaUploadGenerationCleanups/forged'), {
          authorizationId: 'auth-1',
          status: 'pending',
        }),
      );
      await assertFails(
        getDoc(doc(client, 'mediaUploadCleanupWorkerState/scheduler')),
      );
      await assertFails(
        updateDoc(doc(client, 'mediaUploadCleanupWorkerState/scheduler'), {
          authorizationCursor: null,
        }),
      );
    }
  });
});

describe('safety and lounge server-owned paths', () => {
  test('block documents are readable only by owner and never client-writable', async () => {
    await seed('users/alice/blocks/bob', {
      targetUid: 'bob',
      createdAt: new Date(),
    });

    await assertSucceeds(getDoc(doc(authDb('alice'), 'users/alice/blocks/bob')));
    await assertFails(getDoc(doc(authDb('bob'), 'users/alice/blocks/bob')));
    await assertFails(
      setDoc(doc(authDb('alice'), 'users/alice/blocks/carol'), {
        targetUid: 'carol',
        createdAt: serverTimestamp(),
      })
    );
  });

  test('report records and report counters are not client-readable or writable', async () => {
    await seed('reports/report_1', {
      reporterUid: 'alice',
      targetUid: 'bob',
      reason: 'spam',
      createdAt: new Date(),
    });

    await assertFails(getDoc(doc(authDb('alice'), 'reports/report_1')));
    await assertFails(
      setDoc(doc(authDb('alice'), 'reports/report_2'), {
        reporterUid: 'alice',
        targetUid: 'bob',
        reason: 'spam',
        createdAt: serverTimestamp(),
      })
    );
    await assertFails(getDoc(doc(authDb('alice'), 'reportCounters/bob/reporters/alice')));
    await assertFails(
      updateDoc(doc(authDb('alice'), 'reportCounters/bob/reporters/alice'), {
        latestReportId: 'forged',
      })
    );
  });

  test('lounge posts and likes are server-owned from the client perspective', async () => {
    await seed('posts/post_1', {
      authorUid: 'alice',
      text: '서울에서 좋아하는 카페 추천해요.',
      createdAt: new Date(),
    });
    await seed('posts/post_1/comments/comment_1', {
      uid: 'bob',
      content: '좋아요.',
      createdAt: new Date(),
    });
    await seed('posts/post_1/comments/comment_1/replies/reply_1', {
      uid: 'alice',
      content: '고마워요.',
      createdAt: new Date(),
    });

    await assertFails(getDoc(doc(authDb('alice'), 'posts/post_1')));
    await assertFails(getDoc(doc(authDb('alice'), 'posts/post_1/comments/comment_1')));
    await assertFails(getDoc(doc(authDb('alice'), 'posts/post_1/comments/comment_1/replies/reply_1')));
    await assertFails(
      setDoc(doc(authDb('alice'), 'posts/post_2'), {
        authorUid: 'alice',
        text: '직접 작성 시도',
        createdAt: serverTimestamp(),
      })
    );
    await assertFails(
      setDoc(doc(authDb('alice'), 'post_likes/post_1/likes/alice'), {
        createdAt: serverTimestamp(),
      })
    );
  });
});

describe('point and payment server-owned paths', () => {
  test('point events are not client-readable or writable', async () => {
    await seed('pointEvents/event_1', {
      uid: 'alice',
      eventType: 'consume',
      amount: 1,
      reason: 'new_direct_chat',
      balanceBefore: 3,
      balanceAfter: 2,
      createdAt: new Date(),
    });

    await assertFails(getDoc(doc(authDb('alice'), 'pointEvents/event_1')));
    await assertFails(
      setDoc(doc(authDb('alice'), 'pointEvents/event_2'), {
        uid: 'alice',
        eventType: 'grant',
        amount: 999,
        reason: 'forged',
        createdAt: serverTimestamp(),
      })
    );
    await assertFails(updateDoc(doc(authDb('alice'), 'pointEvents/event_1'), {
      balanceAfter: 999,
    }));
    await assertFails(deleteDoc(doc(authDb('alice'), 'pointEvents/event_1')));
  });

  test('verified Play purchase records are not client-readable or writable', async () => {
    await seed('playPurchases/hash_1', {
      uid: 'alice',
      productId: 'hana_points_5',
      tokenHash: 'hash_1',
      status: 'granted',
      createdAt: new Date(),
    });

    await assertFails(getDoc(doc(authDb('alice'), 'playPurchases/hash_1')));
    await assertFails(
      setDoc(doc(authDb('alice'), 'playPurchases/hash_2'), {
        uid: 'alice',
        productId: 'hana_points_150',
        tokenHash: 'hash_2',
        status: 'granted',
        createdAt: serverTimestamp(),
      })
    );
    await assertFails(updateDoc(doc(authDb('alice'), 'playPurchases/hash_1'), {
      status: 'granted_again',
    }));
    await assertFails(deleteDoc(doc(authDb('alice'), 'playPurchases/hash_1')));
  });

  test('store verification quotas are not client-readable or writable', async () => {
    await seed('storeVerificationQuotas/alice', {
      uid: 'alice',
      dayKey: '2026-08-12',
      count: 1,
      updatedAt: new Date(),
    });

    const quotaRef = doc(authDb('alice'), 'storeVerificationQuotas/alice');
    await assertFails(getDoc(quotaRef));
    await assertFails(
      setDoc(quotaRef, {
        uid: 'alice',
        dayKey: '2026-08-12',
        count: 0,
      })
    );
    await assertFails(updateDoc(quotaRef, { count: 0 }));
    await assertFails(deleteDoc(quotaRef));
  });

  test('global store transactions are not client-readable or writable', async () => {
    await seed('storeTransactions/apple:2000000123456789', {
      uid: 'alice',
      platform: 'ios',
      productId: 'hana_points_12',
      transactionId: '2000000123456789',
      receiptHash: 'receipt_hash',
      status: 'granted',
      createdAt: new Date(),
    });

    const ledgerRef = doc(
      authDb('alice'),
      'storeTransactions/apple:2000000123456789'
    );
    await assertFails(getDoc(ledgerRef));
    await assertFails(
      setDoc(doc(authDb('alice'), 'storeTransactions/apple:forged'), {
        uid: 'alice',
        platform: 'ios',
        productId: 'hana_points_150',
        status: 'granted',
      })
    );
    await assertFails(updateDoc(ledgerRef, { status: 'granted_again' }));
    await assertFails(deleteDoc(ledgerRef));
  });

  test('account deletion cleanup jobs are not client-readable or writable', async () => {
    await seed('accountDeletionJobs/alice', {
      uid: 'alice',
      status: 'storage_retry_required',
      attempts: 1,
      updatedAt: new Date(),
    });

    const jobRef = doc(authDb('alice'), 'accountDeletionJobs/alice');
    await assertFails(getDoc(jobRef));
    await assertFails(setDoc(jobRef, { uid: 'alice', status: 'complete' }));
    await assertFails(updateDoc(jobRef, { status: 'complete' }));
    await assertFails(deleteDoc(jobRef));
  });

  test('pending purchase retry state is not client-readable or writable', async () => {
    await seed('pendingStorePurchases/pending_1', {
      uid: 'alice',
      platform: 'android',
      productId: 'hana_points_5',
      receipt: 'server_purchase_token',
      attempts: 1,
      status: 'retryable_error',
      createdAt: new Date(),
    });

    const pendingRef = doc(
      authDb('alice'),
      'pendingStorePurchases/pending_1'
    );
    await assertFails(getDoc(pendingRef));
    await assertFails(
      setDoc(doc(authDb('alice'), 'pendingStorePurchases/forged'), {
        uid: 'alice',
        attempts: 0,
        status: 'pending',
      })
    );
    await assertFails(updateDoc(pendingRef, { attempts: 0 }));
    await assertFails(deleteDoc(pendingRef));
  });
});

describe('ratings', () => {
  beforeEach(async () => {
    await seed('ratings/alice_bob', {
      raterUid: 'alice',
      ratedUid: 'bob',
      stars: 5,
      tags: ['친절해요'],
      createdAt: new Date(),
    });
  });

  test('rating participants can read ratings and outsiders cannot', async () => {
    await assertSucceeds(getDoc(doc(authDb('alice'), 'ratings/alice_bob')));
    await assertSucceeds(getDoc(doc(authDb('bob'), 'ratings/alice_bob')));
    await assertFails(getDoc(doc(authDb('carol'), 'ratings/alice_bob')));
  });

  test('clients cannot create ratings directly', async () => {
    await assertFails(
      setDoc(doc(authDb('alice'), 'ratings/alice_carol'), {
        raterUid: 'alice',
        ratedUid: 'carol',
        stars: 5,
        tags: ['친절해요'],
        createdAt: serverTimestamp(),
      })
    );
  });
});
