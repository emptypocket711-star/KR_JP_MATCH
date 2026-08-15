const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const { doc, setDoc, Timestamp } = require('firebase/firestore');
const {
  deleteObject,
  getBytes,
  listAll,
  ref,
  uploadBytes,
} = require('firebase/storage');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'demo-hana-rules';
const RULES_PATH = path.resolve(__dirname, '../storage.rules');
const CHAT_AUTH_ID = 'chat-auth-1';
const CHAT_IMAGE_PATH =
  `chat_images/room-1/alice/${CHAT_AUTH_ID}/image.jpg`;
const PROFILE_AUTH_ID = 'profile-auth-1';
const PROFILE_IMAGE_PATH =
  `profile_media/alice/${PROFILE_AUTH_ID}/image.jpg`;
const PRIVATE_CACHE_CONTROL = 'private, no-store, max-age=0';
const PRIVATE_CUSTOM_METADATA = {
  hanaCacheControl: PRIVATE_CACHE_CONTROL,
};

jest.setTimeout(15_000);

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: 'localhost',
      port: 8080,
    },
    storage: {
      rules: fs.readFileSync(RULES_PATH, 'utf8'),
      host: 'localhost',
      port: 9199,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

afterEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.clearStorage();
});

async function seedActiveRoom(overrides = {}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await Promise.all([
      setDoc(doc(context.firestore(), 'users/alice'), activeUser()),
      setDoc(doc(context.firestore(), 'users/bob'), activeUser()),
    ]);
    await setDoc(doc(context.firestore(), 'matches/room-1'), {
      userIds: ['alice', 'bob'],
      directRoomVersion: 1,
      isActive: true,
      hiddenFor: [],
      ...overrides,
    });
  });
}

function activeUser(overrides = {}) {
  return {
    onboardingCompleted: true,
    profileMediaVisibilityVersion: 1,
    displayName: 'Hana',
    birthYear: 2000,
    birthMonth: 1,
    birthDay: 1,
    gender: 'female',
    nationality: 'KR',
    residingCountry: 'KR',
    nativeLanguage: 'ko',
    learningLanguage: 'ja',
    bio: '',
    isBanned: false,
    isDeleted: false,
    deleted: false,
    deletionRequested: false,
    accountStatus: 'active',
    status: 'active',
    hiddenFromDiscovery: false,
    isMock: false,
    source: 'user',
    ...overrides,
  };
}

async function seedUser(uid, overrides = {}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), `users/${uid}`),
      activeUser({
        photoUrls: uid === 'alice' ? [PROFILE_IMAGE_PATH] : [],
        ...overrides,
      }),
    );
  });
}

async function seedBlock(ownerUid, blockedUid) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), `users/${ownerUid}/blocks/${blockedUid}`),
      { blockedAt: Timestamp.now() },
    );
  });
}

async function seedAuthorization({
  authorizationId = CHAT_AUTH_ID,
  uid = 'alice',
  kind = 'chat',
  matchId = 'room-1',
  objectPath = CHAT_IMAGE_PATH,
  status = 'reserved',
  expiresAt = Timestamp.fromMillis(Date.now() + 60_000),
  uploadProtocolVersion,
} = {}) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(
        context.firestore(),
        `mediaUploadAuthorizations/${authorizationId}`,
      ),
      {
        authorizationId,
        uid,
        kind,
        matchId,
        objectPath,
        status,
        contentType: 'image/jpeg',
        maxBytes: 5 * 1024 * 1024,
        expiresAt,
        ...(uploadProtocolVersion == null ? {} : { uploadProtocolVersion }),
      },
    );
  });
}

async function seedChatImage() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await uploadBytes(
      ref(context.storage(), CHAT_IMAGE_PATH),
      Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
      { contentType: 'image/jpeg' },
    );
  });
}

async function seedProfileImage() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await uploadBytes(
      ref(context.storage(), PROFILE_IMAGE_PATH),
      Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
      {
        contentType: 'image/jpeg',
        cacheControl: PRIVATE_CACHE_CONTROL,
        customMetadata: PRIVATE_CUSTOM_METADATA,
      },
    );
  });
}

function storageFor(uid) {
  return testEnv.authenticatedContext(uid).storage();
}

describe('chat image privacy', () => {
  test('canonical chat reads are callable-only', async () => {
    await seedActiveRoom();
    await seedChatImage();

    await assertFails(getBytes(ref(storageFor('alice'), CHAT_IMAGE_PATH)));
    await assertFails(getBytes(ref(storageFor('bob'), CHAT_IMAGE_PATH)));
  });

  test('deleting, banned, or blocked participants cannot read chat images', async () => {
    await seedActiveRoom();
    await seedChatImage();

    await seedUser('alice', { deletionRequested: true, accountStatus: 'deleting' });
    await assertFails(getBytes(ref(storageFor('bob'), CHAT_IMAGE_PATH)));

    await seedUser('alice', { isBanned: true, status: 'banned' });
    await assertFails(getBytes(ref(storageFor('bob'), CHAT_IMAGE_PATH)));

    await seedUser('alice');
    await seedBlock('alice', 'bob');
    await assertFails(getBytes(ref(storageFor('alice'), CHAT_IMAGE_PATH)));
    await assertFails(getBytes(ref(storageFor('bob'), CHAT_IMAGE_PATH)));
  });

  test('non-participants and signed-out users cannot read a chat image', async () => {
    await seedActiveRoom();
    await seedChatImage();

    await assertFails(getBytes(ref(storageFor('charlie'), CHAT_IMAGE_PATH)));
    await assertFails(
      getBytes(ref(testEnv.unauthenticatedContext().storage(), CHAT_IMAGE_PATH)),
    );
  });

  test('closed or hidden rooms cannot expose their chat images', async () => {
    await seedActiveRoom({ isActive: false });
    await seedChatImage();
    await assertFails(getBytes(ref(storageFor('alice'), CHAT_IMAGE_PATH)));

    await seedActiveRoom({ hiddenFor: ['alice'] });
    await assertFails(getBytes(ref(storageFor('alice'), CHAT_IMAGE_PATH)));

    await seedActiveRoom({ hiddenFor: ['bob'] });
    await assertFails(getBytes(ref(storageFor('alice'), CHAT_IMAGE_PATH)));
  });

  test('malformed three-party or duplicate-participant rooms cannot expose images', async () => {
    await seedActiveRoom({ userIds: ['alice', 'bob', 'charlie'] });
    await seedChatImage();
    await assertFails(getBytes(ref(storageFor('alice'), CHAT_IMAGE_PATH)));

    await seedActiveRoom({ userIds: ['alice', 'alice'] });
    await assertFails(getBytes(ref(storageFor('alice'), CHAT_IMAGE_PATH)));
  });

  test('unattested exact-two rooms cannot read canonical chat images', async () => {
    await seedActiveRoom({ directRoomVersion: 0 });
    await seedAuthorization();

    await assertFails(getBytes(ref(storageFor('alice'), CHAT_IMAGE_PATH)));
    // Even an exact reservation is not a client Storage capability in V2.
    await assertFails(
      uploadBytes(
        ref(storageFor('alice'), CHAT_IMAGE_PATH),
        Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
        {
          contentType: 'image/jpeg',
          cacheControl: PRIVATE_CACHE_CONTROL,
          customMetadata: PRIVATE_CUSTOM_METADATA,
        },
      ),
    );
  });

  test('canonical chat creates are callable-only even for the reservation owner', async () => {
    await seedActiveRoom();
    await seedAuthorization();
    const image = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);

    await assertFails(
      uploadBytes(ref(storageFor('alice'), CHAT_IMAGE_PATH), image, {
        contentType: 'image/jpeg',
        cacheControl: PRIVATE_CACHE_CONTROL,
        customMetadata: PRIVATE_CUSTOM_METADATA,
      }),
    );
    await seedAuthorization({ uploadProtocolVersion: 2 });
    await assertFails(
      uploadBytes(ref(storageFor('alice'), CHAT_IMAGE_PATH), image, {
        contentType: 'image/jpeg',
        cacheControl: PRIVATE_CACHE_CONTROL,
        customMetadata: PRIVATE_CUSTOM_METADATA,
      }),
    );
    await assertFails(
      uploadBytes(
        ref(storageFor('bob'), CHAT_IMAGE_PATH),
        image,
        {
          contentType: 'image/jpeg',
          cacheControl: PRIVATE_CACHE_CONTROL,
          customMetadata: PRIVATE_CUSTOM_METADATA,
        },
      ),
    );
    await assertFails(
      uploadBytes(
        ref(
          storageFor('charlie'),
          'chat_images/room-1/charlie/chat-auth-1/image.jpg',
        ),
        image,
        {
          contentType: 'image/jpeg',
          cacheControl: PRIVATE_CACHE_CONTROL,
          customMetadata: PRIVATE_CUSTOM_METADATA,
        },
      ),
    );
  });

  test('chat upload requires the exact live server reservation', async () => {
    await seedActiveRoom();
    const image = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    await assertFails(
      uploadBytes(ref(storageFor('alice'), CHAT_IMAGE_PATH), image, {
        contentType: 'image/jpeg',
        cacheControl: PRIVATE_CACHE_CONTROL,
        customMetadata: PRIVATE_CUSTOM_METADATA,
      }),
    );

    await seedAuthorization({ status: 'consumed' });
    await assertFails(
      uploadBytes(ref(storageFor('alice'), CHAT_IMAGE_PATH), image, {
        contentType: 'image/jpeg',
        cacheControl: PRIVATE_CACHE_CONTROL,
        customMetadata: PRIVATE_CUSTOM_METADATA,
      }),
    );

    await seedAuthorization({ status: 'confirmed' });
    await assertFails(
      uploadBytes(ref(storageFor('alice'), CHAT_IMAGE_PATH), image, {
        contentType: 'image/jpeg',
        cacheControl: PRIVATE_CACHE_CONTROL,
        customMetadata: PRIVATE_CUSTOM_METADATA,
      }),
    );

    // Even if an earlier object was removed by a server-side failure, the
    // finalize state cannot recreate/replay the same reservation path.
    await seedAuthorization({ status: 'uploaded' });
    await assertFails(
      uploadBytes(ref(storageFor('alice'), CHAT_IMAGE_PATH), image, {
        contentType: 'image/jpeg',
        cacheControl: PRIVATE_CACHE_CONTROL,
        customMetadata: PRIVATE_CUSTOM_METADATA,
      }),
    );

    await seedAuthorization({
      expiresAt: Timestamp.fromMillis(Date.now() - 60_000),
    });
    await assertFails(
      uploadBytes(ref(storageFor('alice'), CHAT_IMAGE_PATH), image, {
        contentType: 'image/jpeg',
        cacheControl: PRIVATE_CACHE_CONTROL,
        customMetadata: PRIVATE_CUSTOM_METADATA,
      }),
    );

    await seedAuthorization({ uid: 'mallory' });
    await assertFails(
      uploadBytes(ref(storageFor('alice'), CHAT_IMAGE_PATH), image, {
        contentType: 'image/jpeg',
        cacheControl: PRIVATE_CACHE_CONTROL,
        customMetadata: PRIVATE_CUSTOM_METADATA,
      }),
    );
  });

  test('chat canonical create stays denied regardless of metadata', async () => {
    await seedActiveRoom();
    await seedAuthorization();
    const image = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    await assertFails(
      uploadBytes(ref(storageFor('alice'), CHAT_IMAGE_PATH), image, {
        contentType: 'image/png',
        cacheControl: PRIVATE_CACHE_CONTROL,
        customMetadata: PRIVATE_CUSTOM_METADATA,
      }),
    );
    await assertFails(
      uploadBytes(ref(storageFor('alice'), CHAT_IMAGE_PATH), image, {
        contentType: 'image/jpeg',
        cacheControl: PRIVATE_CACHE_CONTROL,
        customMetadata: PRIVATE_CUSTOM_METADATA,
      }),
    );
    // The Storage finalize trigger changes reserved -> uploaded immediately;
    // once that happens the same authorization cannot overwrite its object.
    await seedAuthorization({ status: 'uploaded' });
    await assertFails(
      uploadBytes(ref(storageFor('alice'), CHAT_IMAGE_PATH), image, {
        contentType: 'image/jpeg',
        cacheControl: PRIVATE_CACHE_CONTROL,
        customMetadata: PRIVATE_CUSTOM_METADATA,
      }),
    );
  });

  test('chat upload requires the exact private no-store metadata marker', async () => {
    await seedActiveRoom();
    await seedAuthorization();
    const image = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);

    await assertFails(
      uploadBytes(ref(storageFor('alice'), CHAT_IMAGE_PATH), image, {
        contentType: 'image/jpeg',
      }),
    );
    await assertFails(
      uploadBytes(ref(storageFor('alice'), CHAT_IMAGE_PATH), image, {
        contentType: 'image/jpeg',
        cacheControl: 'public, max-age=31536000',
        customMetadata: {
          hanaCacheControl: 'public, max-age=31536000',
        },
      }),
    );
  });

  test('account deletion state prevents a reserved upload from being used', async () => {
    await seedActiveRoom();
    await seedAuthorization();
    await seedUser('alice', {
      deletionRequested: true,
      accountStatus: 'deleting',
    });

    await assertFails(
      uploadBytes(
        ref(storageFor('alice'), CHAT_IMAGE_PATH),
        Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
        {
          contentType: 'image/jpeg',
          cacheControl: PRIVATE_CACHE_CONTROL,
          customMetadata: PRIVATE_CUSTOM_METADATA,
        },
      ),
    );

    await seedUser('alice', {
      deletionRequested: false,
      accountStatus: 'banned',
    });
    await assertFails(
      uploadBytes(
        ref(storageFor('alice'), CHAT_IMAGE_PATH),
        Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
        {
          contentType: 'image/jpeg',
          cacheControl: PRIVATE_CACHE_CONTROL,
          customMetadata: PRIVATE_CUSTOM_METADATA,
        },
      ),
    );
  });

  test('client deletion cannot replay a server reservation', async () => {
    await seedActiveRoom();
    await seedChatImage();

    await assertFails(deleteObject(ref(storageFor('bob'), CHAT_IMAGE_PATH)));
    await assertFails(deleteObject(ref(storageFor('alice'), CHAT_IMAGE_PATH)));
  });
});

describe('profile media writes', () => {
  test('canonical profile reads are callable-only', async () => {
    await seedUser('alice');
    await seedUser('bob');
    await seedProfileImage();

    await assertFails(getBytes(ref(storageFor('alice'), PROFILE_IMAGE_PATH)));
    await assertFails(getBytes(ref(storageFor('bob'), PROFILE_IMAGE_PATH)));
    await assertFails(
      getBytes(ref(testEnv.unauthenticatedContext().storage(), PROFILE_IMAGE_PATH)),
    );

    await seedUser('alice', { hiddenFromDiscovery: true });
    await assertFails(getBytes(ref(storageFor('bob'), PROFILE_IMAGE_PATH)));
    await assertFails(getBytes(ref(storageFor('alice'), PROFILE_IMAGE_PATH)));

    await seedUser('alice');
    await seedBlock('bob', 'alice');
    await assertFails(getBytes(ref(storageFor('bob'), PROFILE_IMAGE_PATH)));

    await seedUser('alice', { isTestUser: true });
    await assertFails(getBytes(ref(storageFor('bob'), PROFILE_IMAGE_PATH)));
  });

  test('profile media get rejects unavailable owner or viewer accounts', async () => {
    await seedUser('alice');
    await seedUser('bob');
    await seedProfileImage();

    await seedUser('bob', { accountStatus: 'deleting' });
    await assertFails(getBytes(ref(storageFor('bob'), PROFILE_IMAGE_PATH)));

    await seedUser('bob');
    await seedUser('alice', { isBanned: true });
    await assertFails(getBytes(ref(storageFor('bob'), PROFILE_IMAGE_PATH)));
  });

  test('profile media visibility requires server attestation and static identity', async () => {
    await seedUser('alice', { profileMediaVisibilityVersion: 0 });
    await seedUser('bob');
    await seedProfileImage();

    await assertFails(getBytes(ref(storageFor('bob'), PROFILE_IMAGE_PATH)));
    await assertFails(getBytes(ref(storageFor('alice'), PROFILE_IMAGE_PATH)));

    await seedUser('alice', {
      profileMediaVisibilityVersion: 1,
      birthMonth: 13,
    });
    await assertFails(getBytes(ref(storageFor('bob'), PROFILE_IMAGE_PATH)));

    await seedUser('alice', {
      profileMediaVisibilityVersion: 1,
      nativeLanguage: 'ko',
      learningLanguage: 'ko',
    });
    await assertFails(getBytes(ref(storageFor('bob'), PROFILE_IMAGE_PATH)));
  });

  test('non-owner cannot read an unreferenced or removed profile object', async () => {
    await seedUser('alice', { photoUrls: [] });
    await seedUser('bob');
    await seedProfileImage();

    await assertFails(getBytes(ref(storageFor('bob'), PROFILE_IMAGE_PATH)));
    await assertFails(getBytes(ref(storageFor('alice'), PROFILE_IMAGE_PATH)));
  });

  test('private media prefixes cannot be listed', async () => {
    await seedUser('alice');
    await seedActiveRoom();
    await seedProfileImage();
    await seedChatImage();

    await assertFails(listAll(ref(storageFor('alice'), 'profile_media/alice')));
    await assertFails(listAll(ref(storageFor('alice'), 'chat_images/room-1')));
  });

  test('canonical profile creates are callable-only', async () => {
    const image = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    await seedUser('alice');
    await seedUser('bob');
    await seedAuthorization({
      authorizationId: PROFILE_AUTH_ID,
      kind: 'profile',
      matchId: null,
      objectPath: PROFILE_IMAGE_PATH,
    });
    await assertFails(
      uploadBytes(ref(storageFor('alice'), PROFILE_IMAGE_PATH), image, {
        contentType: 'image/jpeg',
        cacheControl: PRIVATE_CACHE_CONTROL,
        customMetadata: PRIVATE_CUSTOM_METADATA,
      }),
    );
    await assertFails(
      uploadBytes(ref(storageFor('bob'), PROFILE_IMAGE_PATH), image, {
        contentType: 'image/jpeg',
        cacheControl: PRIVATE_CACHE_CONTROL,
        customMetadata: PRIVATE_CUSTOM_METADATA,
      }),
    );
    await assertFails(
      uploadBytes(
        ref(
          storageFor('alice'),
          'profile_media/alice/another-auth/image.jpg',
        ),
        image,
        {
          contentType: 'image/jpeg',
          cacheControl: PRIVATE_CACHE_CONTROL,
          customMetadata: PRIVATE_CUSTOM_METADATA,
        },
      ),
    );
  });

  test('legacy profile paths no longer accept writes', async () => {
    const image = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    await assertFails(
      uploadBytes(ref(storageFor('alice'), 'users/alice/photo_1.jpg'), image, {
        contentType: 'image/jpeg',
      }),
    );
    await assertFails(
      uploadBytes(
        ref(storageFor('alice'), 'profile_photos/alice/photo.jpg'),
        image,
        { contentType: 'image/jpeg' },
      ),
    );
  });
});
