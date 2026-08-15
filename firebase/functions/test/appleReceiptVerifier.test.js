const assert = require('node:assert/strict');
const test = require('node:test');

const {
  Environment,
  InAppOwnershipType,
  Type,
} = require('@apple/app-store-server-library');
const {
  ApplePurchaseVerificationError,
  verifyAppleAppStoreProductPurchase,
} = require('../lib/appleReceiptVerifier');
const {
  appleRootCertificateManifest,
  loadPinnedAppleRootCertificates,
} = require('../lib/appleRootCertificates');

const sandboxConfig = {
  environment: Environment.SANDBOX,
  bundleId: 'com.emptypocket.hana',
  enableOnlineChecks: true,
};

test('loads all pinned Apple trust anchors only after SHA-256 validation', () => {
  const roots = loadPinnedAppleRootCertificates();
  assert.equal(roots.length, 3);
  assert.equal(roots.length, appleRootCertificateManifest.length);
  assert.deepEqual(
    appleRootCertificateManifest.map((asset) => asset.sha256),
    [
      'b0b1730ecbc7ff4505142c49f1295e6eda6bcaed7e2c68c5be91b5a11001f024',
      'c2b9b042dd57830e7d117dac55ac8ae19407d38e41d88f3215bc3a890444a050',
      '63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179',
    ]
  );
});

test('rejects an attacker-signed StoreKit JWS against pinned Apple roots', async () => {
  const attackerJws = [
    Buffer.from(JSON.stringify({ alg: 'ES256', x5c: ['attacker-root'] }))
      .toString('base64url'),
    Buffer.from(
      JSON.stringify({
        bundleId: 'com.emptypocket.hana',
        environment: Environment.SANDBOX,
        productId: 'hana_points_150',
        transactionId: 'forged-transaction',
        type: Type.CONSUMABLE,
        quantity: 1,
        appAccountToken: '77d7c0f0-e0ec-5e40-bff8-a84c748e7e40',
        signedDate: Date.now(),
      })
    ).toString('base64url'),
    'attacker-signature',
  ].join('.');

  await assert.rejects(
    verifyAppleAppStoreProductPurchase({
      signedTransaction: attackerJws,
      productId: 'hana_points_150',
      transactionId: 'forged-transaction',
      appAccountToken: '77d7c0f0-e0ec-5e40-bff8-a84c748e7e40',
      config: sandboxConfig,
    }),
    (error) =>
      error instanceof ApplePurchaseVerificationError && !error.retryable
  );
});

test('accepts a verified StoreKit consumable only when every claim matches', async () => {
  const transaction = {
    bundleId: 'com.emptypocket.hana',
    environment: Environment.SANDBOX,
    productId: 'hana_points_12',
    transactionId: '2000000123456789',
    originalTransactionId: '2000000123456789',
    type: Type.CONSUMABLE,
    quantity: 1,
    inAppOwnershipType: InAppOwnershipType.PURCHASED,
    appAccountToken: '77d7c0f0-e0ec-5e40-bff8-a84c748e7e40',
    purchaseDate: 1786492800000,
    signedDate: 1786492801000,
  };
  const result = await verifyAppleAppStoreProductPurchase({
    signedTransaction: 'header.payload.signature',
    productId: transaction.productId,
    transactionId: transaction.transactionId,
    appAccountToken: transaction.appAccountToken,
    config: sandboxConfig,
    verifier: {
      async verifyAndDecodeTransaction() {
        return transaction;
      },
    },
  });

  assert.deepEqual(result, {
    transactionId: transaction.transactionId,
    originalTransactionId: transaction.originalTransactionId,
    productId: transaction.productId,
    quantity: 1,
    appAccountToken: transaction.appAccountToken,
    environment: Environment.SANDBOX,
    purchaseDate: transaction.purchaseDate,
    signedDate: transaction.signedDate,
  });
});

test('rejects a verified transaction bound to another Hana account', async () => {
  await assert.rejects(
    verifyAppleAppStoreProductPurchase({
      signedTransaction: 'header.payload.signature',
      productId: 'hana_points_12',
      transactionId: '2000000123456789',
      appAccountToken: '77d7c0f0-e0ec-5e40-bff8-a84c748e7e40',
      config: sandboxConfig,
      verifier: {
        async verifyAndDecodeTransaction() {
          return {
            bundleId: 'com.emptypocket.hana',
            environment: Environment.SANDBOX,
            productId: 'hana_points_12',
            transactionId: '2000000123456789',
            type: Type.CONSUMABLE,
            quantity: 1,
            inAppOwnershipType: InAppOwnershipType.PURCHASED,
            appAccountToken: '87d7c0f0-e0ec-5e40-bff8-a84c748e7e40',
          };
        },
      },
    }),
    (error) =>
      error instanceof ApplePurchaseVerificationError &&
      error.supportCode === 'app_account_token_mismatch'
  );
});
