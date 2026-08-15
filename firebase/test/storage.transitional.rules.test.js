const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const { doc, setDoc, Timestamp } = require('firebase/firestore');
const { ref, uploadBytes } = require('firebase/storage');
const fs = require('fs');
const path = require('path');

// Storage cross-service Firestore reads are project-bound. Keep this identical
// to the emulator project selected by package.json.
const PROJECT_ID = 'demo-hana-rules';
const RULES_PATH = path.resolve(__dirname, '../storage.transitional.rules');
const AUTH_ID = 'profile-auth-1';
const OBJECT_PATH = `profile_media/alice/${AUTH_ID}/image.jpg`;
const UPLOAD = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
const METADATA = {
  contentType: 'image/jpeg',
  cacheControl: 'private, no-store, max-age=0',
  customMetadata: {
    hanaCacheControl: 'private, no-store, max-age=0',
  },
};

jest.setTimeout(15_000);

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host: 'localhost', port: 8080 },
    storage: {
      rules: fs.readFileSync(RULES_PATH, 'utf8'),
      host: 'localhost',
      port: 9199,
    },
  });
});

afterAll(async () => testEnv.cleanup());

afterEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.clearStorage();
});

async function seedAuthorization(uploadProtocolVersion) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await Promise.all([
      setDoc(doc(context.firestore(), 'users/alice'), {
        accountStatus: 'active',
        isBanned: false,
        isDeleted: false,
        deleted: false,
        deletionRequested: false,
      }),
      setDoc(
        doc(
          context.firestore(),
          `mediaUploadAuthorizations/${AUTH_ID}`,
        ),
        {
          authorizationId: AUTH_ID,
          uid: 'alice',
          kind: 'profile',
          matchId: null,
          objectPath: OBJECT_PATH,
          status: 'reserved',
          contentType: 'image/jpeg',
          maxBytes: 5 * 1024 * 1024,
          expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
          ...(uploadProtocolVersion == null ? {} : { uploadProtocolVersion }),
        },
      ),
    ]);
  });
}

test('reviewed transitional rules allow only a no-version V1 reservation', async () => {
  await seedAuthorization();
  await assertSucceeds(
    uploadBytes(
      ref(testEnv.authenticatedContext('alice').storage(), OBJECT_PATH),
      UPLOAD,
      METADATA,
    ),
  );
});

test('reviewed transitional rules deny a V2 direct canonical create', async () => {
  await seedAuthorization(2);
  await assertFails(
    uploadBytes(
      ref(testEnv.authenticatedContext('alice').storage(), OBJECT_PATH),
      UPLOAD,
      METADATA,
    ),
  );
});
