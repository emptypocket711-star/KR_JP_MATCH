const test = require('node:test');
const assert = require('node:assert/strict');

const {
  projectIdFromFirebaseConfig,
  resolveFunctionsDeployment,
} = require('../lib/functionsRegionPolicy');

test('maps the staging project to its existing us-central1 trigger set', () => {
  assert.deepEqual(
    resolveFunctionsDeployment({
      declaredProjectId: 'hana-e2ee6',
      environment: 'staging',
      explicitRegion: 'us-central1',
    }),
    {
      environment: 'staging',
      projectId: 'hana-e2ee6',
      region: 'us-central1',
    }
  );
});

test('maps the production project to its existing Tokyo trigger set', () => {
  assert.deepEqual(
    resolveFunctionsDeployment({
      runtimeProjectId: 'hana-production-tokyo',
    }),
    {
      environment: 'production',
      projectId: 'hana-production-tokyo',
      region: 'asia-northeast1',
    }
  );
});

test('rejects project and environment disagreement', () => {
  assert.throws(
    () =>
      resolveFunctionsDeployment({
        declaredProjectId: 'hana-e2ee6',
        environment: 'production',
      }),
    /do not match/
  );
});

test('rejects a region that would create a second trigger set', () => {
  assert.throws(
    () =>
      resolveFunctionsDeployment({
        declaredProjectId: 'hana-e2ee6',
        explicitRegion: 'asia-northeast1',
      }),
    /region mismatch/
  );
});

test('rejects unknown and missing deployment identity', () => {
  assert.throws(
    () => resolveFunctionsDeployment({ declaredProjectId: 'other-project' }),
    /Unsupported Hana Firebase project/
  );
  assert.throws(
    () => resolveFunctionsDeployment({}),
    /without a known project or environment/
  );
});

test('parses the runtime project from FIREBASE_CONFIG fail-closed', () => {
  assert.equal(
    projectIdFromFirebaseConfig('{"projectId":"hana-e2ee6"}'),
    'hana-e2ee6'
  );
  assert.equal(projectIdFromFirebaseConfig(undefined), null);
  assert.throws(() => projectIdFromFirebaseConfig('{broken'), /valid JSON/);
  assert.throws(() => projectIdFromFirebaseConfig('{}'), /projectId/);
});
