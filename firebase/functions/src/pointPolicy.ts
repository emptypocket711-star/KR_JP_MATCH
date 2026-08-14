export const pointPlatforms = ['android', 'ios'] as const;
export type PointPlatform = (typeof pointPlatforms)[number];

export const androidPackageName = 'com.emptypocket.hana';
export const dailyLoungePostPointGrantAmount = 3;
export const pointBalanceTrustVersion = 1;
export const maximumPointBalance = 100_000;

const retiredUnsafePurchaseTokens = new Set(['qa_debug_points_v1']);

const pointProductCatalog: Record<string, number> = {
  hana_points_5: 5,
  hana_points_12: 12,
  hana_points_30: 30,
  hana_points_70: 70,
  hana_points_150: 150,
};

export function pointAmountForProduct(productId: unknown): number | null {
  if (typeof productId !== 'string') return null;
  return pointProductCatalog[productId] ?? null;
}

export function isValidPurchaseToken(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const token = value.trim();
  return (
    token.length >= 16 &&
    token.length <= 4096 &&
    !retiredUnsafePurchaseTokens.has(token)
  );
}

export function shouldVerifyPlayBilling(
  env: NodeJS.ProcessEnv,
  configValue?: unknown
): boolean {
  const configured =
    env.PLAY_BILLING_VERIFICATION_ENABLED === 'true' ||
    configValue === true ||
    configValue === 'true';

  // Runtime configuration alone must not activate real-money grants. Keep
  // source-locked until package/project alignment and idempotent Play
  // refund/chargeback reconciliation are implemented and approved.
  const playBillingProductionCodeUnlocked = false;
  return configured && playBillingProductionCodeUnlocked;
}

export function isValidPointPlatform(value: unknown): value is PointPlatform {
  return (
    typeof value === 'string' &&
    (pointPlatforms as readonly string[]).includes(value)
  );
}

export function isStorePointPurchaseEnabled(
  platform: unknown
): platform is 'android' {
  return platform === 'android';
}

export function isValidPointBalance(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximumPointBalance
  );
}

export function pointBalanceTrustIssue(
  userData: Record<string, unknown> | undefined
): 'invalid-balance' | 'quarantined-balance' | 'untrusted-balance' | null {
  if (!isValidPointBalance(userData?.keyCount)) return 'invalid-balance';
  if (userData?.pointBalanceQuarantined === true) {
    return 'quarantined-balance';
  }
  if (userData?.pointBalanceTrustVersion !== pointBalanceTrustVersion) {
    return 'untrusted-balance';
  }
  return null;
}

function validatedPointAmount(amount: number): number {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new RangeError('point amount must be a positive safe integer');
  }
  return amount;
}

export function pointBalanceAfterGrant(currentBalance: unknown, amount: number): number {
  if (!isValidPointBalance(currentBalance)) {
    throw new RangeError('current point balance is invalid');
  }
  const next = currentBalance + validatedPointAmount(amount);
  if (!isValidPointBalance(next)) {
    throw new RangeError('point grant exceeds the maximum trusted balance');
  }
  return next;
}

export function pointBalanceAfterConsume(currentBalance: unknown, amount: number): number {
  if (!isValidPointBalance(currentBalance)) {
    throw new RangeError('current point balance is invalid');
  }
  const next = currentBalance - validatedPointAmount(amount);
  if (!isValidPointBalance(next)) {
    throw new RangeError('point balance is insufficient');
  }
  return next;
}

export function kstDateKey(date = new Date()): string {
  const kstMillis = date.getTime() + 9 * 60 * 60 * 1000;
  return new Date(kstMillis).toISOString().slice(0, 10);
}

export function shouldGrantDailyLoungePostPoints(
  lastGrantDate: unknown,
  todayKey: string
): boolean {
  return lastGrantDate !== todayKey;
}

export interface VerifiedPlayProductPurchase {
  purchaseState?: number | null;
  consumptionState?: number | null;
  acknowledgementState?: number | null;
  orderId?: string | null;
  purchaseTimeMillis?: string | null;
  productId?: string | null;
  quantity?: number | null;
  obfuscatedExternalAccountId?: string | null;
}

export interface ExistingPlayPurchaseRecord {
  uid?: unknown;
  status?: unknown;
}

export function canGrantVerifiedPlayPurchase(
  purchase: VerifiedPlayProductPurchase,
  expected: {
    productId: string;
    obfuscatedExternalAccountId: string;
  }
): boolean {
  return (
    purchase.purchaseState === 0 &&
    (purchase.productId == null ||
      purchase.productId === expected.productId) &&
    (purchase.quantity == null || purchase.quantity === 1) &&
    purchase.obfuscatedExternalAccountId ===
      expected.obfuscatedExternalAccountId
  );
}

export function isAlreadyGrantedPlayPurchaseRecord(
  purchase: ExistingPlayPurchaseRecord | undefined,
  uid: string
): boolean {
  return purchase?.uid === uid && purchase.status === 'granted';
}
