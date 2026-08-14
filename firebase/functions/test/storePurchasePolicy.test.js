const assert = require('node:assert/strict');
const test = require('node:test');

const {
  Environment,
  InAppOwnershipType,
  Type,
} = require('@apple/app-store-server-library');
const {
  appleTransactionClaimIssue,
  canClaimPlayPurchaseReservation,
  decidePendingStorePurchaseClaim,
  deriveStoreAppAccountToken,
  isTerminalPendingStorePurchaseError,
  maxPendingStorePurchaseAttempts,
  maxPlayVerificationAttemptsPerUtcDay,
  nextPlayVerificationQuotaCount,
  pendingStorePurchaseRetryDelayMillis,
  resolveAppleStoreVerificationConfig,
} = require('../lib/storePurchasePolicy');

test('keeps App Store verification disabled without an explicit gate', () => {
  assert.equal(
    resolveAppleStoreVerificationConfig({ GCLOUD_PROJECT: 'hana-e2ee6' }),
    null
  );
});

test('allows only project-bound Sandbox verification', () => {
  const config = resolveAppleStoreVerificationConfig({
    GCLOUD_PROJECT: 'hana-e2ee6',
    APP_STORE_IOS_PURCHASES_ENABLED: 'true',
    APP_STORE_ENVIRONMENT: 'sandbox',
    APP_STORE_BUNDLE_ID: 'com.emptypocket.hana',
  });
  assert.deepEqual(config, {
    environment: Environment.SANDBOX,
    bundleId: 'com.emptypocket.hana',
    enableOnlineChecks: true,
  });
  assert.equal(
    resolveAppleStoreVerificationConfig({
      GCLOUD_PROJECT: 'hana-production-tokyo',
      APP_STORE_IOS_PURCHASES_ENABLED: 'true',
      APP_STORE_ENVIRONMENT: 'sandbox',
      APP_STORE_BUNDLE_ID: 'com.emptypocket.hana',
    }),
    null
  );
});

test('keeps production code-locked even with every rollout value configured', () => {
  const base = {
    GCLOUD_PROJECT: 'hana-production-tokyo',
    APP_STORE_IOS_PURCHASES_ENABLED: 'true',
    APP_STORE_ENVIRONMENT: 'production',
    APP_STORE_BUNDLE_ID: 'com.emptypocket.hana',
    APP_STORE_APP_APPLE_ID: '6769421716',
  };
  assert.equal(resolveAppleStoreVerificationConfig(base), null);
  assert.equal(
    resolveAppleStoreVerificationConfig({
      ...base,
      APP_STORE_PRODUCTION_ROLLOUT_ENABLED: 'true',
    }),
    null
  );
  assert.equal(
    resolveAppleStoreVerificationConfig({
      ...base,
      APP_STORE_APP_APPLE_ID: '1234567890',
      APP_STORE_PRODUCTION_ROLLOUT_ENABLED: 'true',
    }),
    null
  );
});

test('derives the same pseudonymous UUID as the Flutter client', () => {
  assert.equal(
    deriveStoreAppAccountToken('user-123'),
    '77d7c0f0-e0ec-5e40-bff8-a84c748e7e40'
  );
});

test('rejects mismatched, non-consumable, multi-quantity, and revoked claims', () => {
  const expected = {
    bundleId: 'com.emptypocket.hana',
    environment: Environment.SANDBOX,
    productId: 'hana_points_12',
    transactionId: '2000000123456789',
    appAccountToken: '77d7c0f0-e0ec-5e40-bff8-a84c748e7e40',
  };
  const valid = {
    ...expected,
    type: Type.CONSUMABLE,
    quantity: 1,
    inAppOwnershipType: InAppOwnershipType.PURCHASED,
  };
  assert.equal(appleTransactionClaimIssue(valid, expected), null);
  assert.equal(
    appleTransactionClaimIssue({ ...valid, productId: 'other' }, expected),
    'product_mismatch'
  );
  assert.equal(
    appleTransactionClaimIssue({ ...valid, type: Type.NON_CONSUMABLE }, expected),
    'product_type_invalid'
  );
  assert.equal(
    appleTransactionClaimIssue({ ...valid, quantity: 2 }, expected),
    'quantity_invalid'
  );
  assert.equal(
    appleTransactionClaimIssue(
      { ...valid, inAppOwnershipType: InAppOwnershipType.FAMILY_SHARED },
      expected
    ),
    'ownership_type_invalid'
  );
  assert.equal(
    appleTransactionClaimIssue({ ...valid, revocationDate: Date.now() }, expected),
    'transaction_revoked'
  );
});

test('uses leases, retry backoff, and a hard terminal attempt limit', () => {
  const now = 1_000_000;
  assert.deepEqual(
    decidePendingStorePurchaseClaim({ status: 'pending', attempts: 0 }, now),
    { claim: true, terminal: false, nextAttempt: 1 }
  );
  assert.equal(
    decidePendingStorePurchaseClaim(
      { status: 'verifying', attempts: 1, leaseUntilMillis: now + 1 },
      now
    ).claim,
    false
  );
  assert.equal(
    decidePendingStorePurchaseClaim(
      { status: 'verifying', attempts: 1, leaseUntilMillis: now - 1 },
      now
    ).claim,
    true
  );
  assert.deepEqual(
    decidePendingStorePurchaseClaim(
      { status: 'retryable_error', attempts: maxPendingStorePurchaseAttempts },
      now
    ),
    {
      claim: false,
      terminal: true,
      nextAttempt: maxPendingStorePurchaseAttempts,
    }
  );
  assert.equal(pendingStorePurchaseRetryDelayMillis(1), 15 * 60 * 1000);
  assert.equal(pendingStorePurchaseRetryDelayMillis(6), 6 * 60 * 60 * 1000);
  assert.equal(isTerminalPendingStorePurchaseError('invalid-argument'), true);
  assert.equal(isTerminalPendingStorePurchaseError('unavailable'), false);
});

test('bounds Play verification calls per Firebase user and UTC day', () => {
  assert.equal(nextPlayVerificationQuotaCount(undefined, '2026-08-12'), 1);
  assert.equal(
    nextPlayVerificationQuotaCount(
      { dayKey: '2026-08-11', count: 999 },
      '2026-08-12'
    ),
    1
  );
  assert.equal(
    nextPlayVerificationQuotaCount(
      {
        dayKey: '2026-08-12',
        count: maxPlayVerificationAttemptsPerUtcDay - 1,
      },
      '2026-08-12'
    ),
    maxPlayVerificationAttemptsPerUtcDay
  );
  assert.equal(
    nextPlayVerificationQuotaCount(
      {
        dayKey: '2026-08-12',
        count: maxPlayVerificationAttemptsPerUtcDay,
      },
      '2026-08-12'
    ),
    null
  );
});

test('reclaims only expired same-account Play verification reservations', () => {
  const now = 1_000_000;
  assert.equal(
    canClaimPlayPurchaseReservation(undefined, 'alice', 'hana_points_5', now),
    true
  );
  assert.equal(
    canClaimPlayPurchaseReservation(
      {
        uid: 'alice',
        productId: 'hana_points_5',
        status: 'verifying',
        leaseUntilMillis: now + 1,
      },
      'alice',
      'hana_points_5',
      now
    ),
    false
  );
  assert.equal(
    canClaimPlayPurchaseReservation(
      {
        uid: 'alice',
        productId: 'hana_points_5',
        status: 'verifying',
        leaseUntilMillis: now,
      },
      'alice',
      'hana_points_5',
      now
    ),
    true
  );
  assert.equal(
    canClaimPlayPurchaseReservation(
      {
        uid: 'alice',
        productId: 'hana_points_5',
        status: 'verification_failed',
      },
      'alice',
      'hana_points_5',
      now
    ),
    true
  );
  assert.equal(
    canClaimPlayPurchaseReservation(
      {
        uid: 'bob',
        productId: 'hana_points_5',
        status: 'verification_failed',
      },
      'alice',
      'hana_points_5',
      now
    ),
    false
  );
  assert.equal(
    canClaimPlayPurchaseReservation(
      {
        uid: 'alice',
        productId: 'hana_points_150',
        status: 'rejected',
      },
      'alice',
      'hana_points_5',
      now
    ),
    false
  );
});
