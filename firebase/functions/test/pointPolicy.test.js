const assert = require('node:assert/strict');
const test = require('node:test');

const pointPolicy = require('../lib/pointPolicy');
const {
  isStorePointPurchaseEnabled,
  isValidPointPlatform,
  isValidPurchaseToken,
  kstDateKey,
  pointAmountForProduct,
  pointBalanceAfterConsume,
  pointBalanceAfterGrant,
  shouldGrantDailyLoungePostPoints,
  canGrantVerifiedPlayPurchase,
  isAlreadyGrantedPlayPurchaseRecord,
  shouldVerifyPlayBilling,
} = pointPolicy;

test('accepts only supported point purchase platforms', () => {
  assert.equal(isValidPointPlatform('android'), true);
  assert.equal(isValidPointPlatform('ios'), true);
  assert.equal(isValidPointPlatform('web'), false);
  assert.equal(isValidPointPlatform(null), false);
});

test('recognizes only Android as the existing Play verification route', () => {
  assert.equal(isStorePointPurchaseEnabled('android'), true);
  assert.equal(isStorePointPurchaseEnabled('ios'), false);
  assert.equal(isStorePointPurchaseEnabled('web'), false);
});

test('does not export any QA receipt grant policy', () => {
  assert.equal('qaPointReceipt' in pointPolicy, false);
  assert.equal('isQaPointGrantAllowed' in pointPolicy, false);
  assert.equal('normalizeQaPointGrantAmount' in pointPolicy, false);
});

test('maps known point products to server-owned point amounts', () => {
  assert.equal(pointAmountForProduct('hana_points_5'), 5);
  assert.equal(pointAmountForProduct('hana_points_150'), 150);
  assert.equal(pointAmountForProduct('unknown'), null);
  assert.equal(pointAmountForProduct(null), null);
});

test('validates purchase tokens before Play verification', () => {
  assert.equal(isValidPurchaseToken('1234567890123456'), true);
  assert.equal(isValidPurchaseToken('qa_debug_points_v1'), false);
  assert.equal(isValidPurchaseToken('short'), false);
  assert.equal(isValidPurchaseToken('x'.repeat(4097)), false);
  assert.equal(isValidPurchaseToken(null), false);
});

test('keeps Play Billing code-locked despite every runtime flag', () => {
  assert.equal(shouldVerifyPlayBilling({ PLAY_BILLING_VERIFICATION_ENABLED: 'true' }), false);
  assert.equal(shouldVerifyPlayBilling({ PLAY_BILLING_VERIFICATION_ENABLED: 'false' }), false);
  assert.equal(shouldVerifyPlayBilling({}), false);
  assert.equal(shouldVerifyPlayBilling({}, 'true'), false);
  assert.equal(shouldVerifyPlayBilling({}, true), false);
  assert.equal(shouldVerifyPlayBilling({}, 'false'), false);
});

test('requires purchased Play state and exact product, quantity, and account binding', () => {
  const expected = {
    productId: 'hana_points_5',
    obfuscatedExternalAccountId: 'account-binding',
  };
  const valid = {
    purchaseState: 0,
    productId: expected.productId,
    quantity: 1,
    obfuscatedExternalAccountId: expected.obfuscatedExternalAccountId,
  };
  assert.equal(canGrantVerifiedPlayPurchase(valid, expected), true);
  // ProductPurchase may omit productId and quantity (missing quantity means
  // one). The request endpoint is already bound to expected.productId.
  assert.equal(
    canGrantVerifiedPlayPurchase({
      purchaseState: 0,
      obfuscatedExternalAccountId: expected.obfuscatedExternalAccountId,
    }, expected),
    true
  );
  assert.equal(
    canGrantVerifiedPlayPurchase({ ...valid, purchaseState: 1 }, expected),
    false
  );
  assert.equal(
    canGrantVerifiedPlayPurchase({ ...valid, productId: 'other' }, expected),
    false
  );
  assert.equal(
    canGrantVerifiedPlayPurchase({ ...valid, quantity: 2 }, expected),
    false
  );
  assert.equal(
    canGrantVerifiedPlayPurchase(
      { ...valid, obfuscatedExternalAccountId: 'other-account' },
      expected
    ),
    false
  );
  assert.equal(canGrantVerifiedPlayPurchase({}, expected), false);
});

test('classifies Play purchase ledger idempotency state', () => {
  assert.equal(
    isAlreadyGrantedPlayPurchaseRecord({ uid: 'alice', status: 'granted' }, 'alice'),
    true
  );
  assert.equal(
    isAlreadyGrantedPlayPurchaseRecord({ uid: 'bob', status: 'granted' }, 'alice'),
    false
  );
});

test('calculates auditable point balances for grants and consumes', () => {
  assert.equal(pointBalanceAfterGrant(3, 5), 8);
  assert.equal(pointBalanceAfterGrant(undefined, 5), 5);
  assert.equal(pointBalanceAfterConsume(3, 1), 2);
  assert.equal(pointBalanceAfterConsume(undefined, 1), -1);
});

test('uses KST day keys for once-daily lounge post point grants', () => {
  assert.equal(kstDateKey(new Date('2026-05-19T14:59:59.000Z')), '2026-05-19');
  assert.equal(kstDateKey(new Date('2026-05-19T15:00:00.000Z')), '2026-05-20');
  assert.equal(shouldGrantDailyLoungePostPoints(undefined, '2026-05-20'), true);
  assert.equal(shouldGrantDailyLoungePostPoints('2026-05-19', '2026-05-20'), true);
  assert.equal(shouldGrantDailyLoungePostPoints('2026-05-20', '2026-05-20'), false);
});
