import { createHash } from 'crypto';
import {
  Environment,
  InAppOwnershipType,
  JWSTransactionDecodedPayload,
  Type,
} from '@apple/app-store-server-library';

export const appleStoreBundleId = 'com.emptypocket.hana';
export const appleStoreSandboxProjectId = 'hana-e2ee6';
export const appleStoreProductionProjectId = 'hana-production-tokyo';
export const appleStoreAppAppleId = 6769421716;
export const maxPendingStorePurchaseAttempts = 6;
export const pendingStorePurchaseLeaseMillis = 10 * 60 * 1000;
export const pendingStorePurchaseRetentionMillis = 7 * 24 * 60 * 60 * 1000;
export const playPurchaseReservationLeaseMillis = 10 * 60 * 1000;
export const maxPlayVerificationAttemptsPerUtcDay = 30;

const appleTransactionIdPattern = /^[A-Za-z0-9._-]{1,128}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AppleStoreEnvironment =
  | typeof Environment.SANDBOX
  | typeof Environment.PRODUCTION;

export interface AppleStoreVerificationConfig {
  environment: AppleStoreEnvironment;
  bundleId: typeof appleStoreBundleId;
  appAppleId?: number;
  enableOnlineChecks: true;
}

export interface AppleStoreRuntimeConfig {
  ios_purchases_enabled?: unknown;
  environment?: unknown;
  bundle_id?: unknown;
  app_apple_id?: unknown;
  production_rollout_enabled?: unknown;
}

function isEnabled(value: unknown): boolean {
  return value === true || value === 'true';
}

function configuredValue(
  envValue: string | undefined,
  configValue: unknown
): unknown {
  return envValue ?? configValue;
}

/**
 * Resolves the App Store verifier only behind explicit, project-bound gates.
 * Production needs a second rollout switch and a numeric App Apple ID, so a
 * code deploy by itself cannot activate production point grants.
 */
export function resolveAppleStoreVerificationConfig(
  env: NodeJS.ProcessEnv,
  config: AppleStoreRuntimeConfig = {}
): AppleStoreVerificationConfig | null {
  const enabled = isEnabled(
    configuredValue(
      env.APP_STORE_IOS_PURCHASES_ENABLED,
      config.ios_purchases_enabled
    )
  );
  if (!enabled) return null;

  const rawEnvironment = configuredValue(
    env.APP_STORE_ENVIRONMENT,
    config.environment
  );
  const environment =
    rawEnvironment === 'sandbox' || rawEnvironment === Environment.SANDBOX
      ? Environment.SANDBOX
      : rawEnvironment === 'production' ||
          rawEnvironment === Environment.PRODUCTION
        ? Environment.PRODUCTION
        : null;
  if (environment == null) return null;

  const bundleId = configuredValue(
    env.APP_STORE_BUNDLE_ID,
    config.bundle_id
  );
  if (bundleId !== appleStoreBundleId) return null;

  const projectId = env.GCLOUD_PROJECT ?? env.GOOGLE_CLOUD_PROJECT;
  if (
    environment === Environment.SANDBOX &&
    projectId !== appleStoreSandboxProjectId
  ) {
    return null;
  }
  if (
    environment === Environment.PRODUCTION &&
    projectId !== appleStoreProductionProjectId
  ) {
    return null;
  }

  if (environment === Environment.SANDBOX) {
    return {
      environment,
      bundleId: appleStoreBundleId,
      enableOnlineChecks: true,
    };
  }

  const productionEnabled = isEnabled(
    configuredValue(
      env.APP_STORE_PRODUCTION_ROLLOUT_ENABLED,
      config.production_rollout_enabled
    )
  );
  if (!productionEnabled) return null;

  const rawAppAppleId = configuredValue(
    env.APP_STORE_APP_APPLE_ID,
    config.app_apple_id
  );
  const appAppleId =
    typeof rawAppAppleId === 'number'
      ? rawAppAppleId
      : typeof rawAppAppleId === 'string' && /^\d+$/.test(rawAppAppleId)
        ? Number(rawAppAppleId)
        : Number.NaN;
  if (appAppleId !== appleStoreAppAppleId) return null;

  // Production remains code-locked until App Store Server Notifications V2
  // refund/revocation reconciliation and real Sandbox evidence are reviewed.
  // Removing this guard must be an explicit source change, not a runtime flag.
  return null;
}

/**
 * Stable pseudonymous UUID sent to StoreKit as appAccountToken. Both client
 * and server implement this exact namespaced SHA-256 construction.
 */
export function deriveStoreAppAccountToken(uid: string): string {
  const bytes = createHash('sha256')
    .update(`hana.store.app-account.v1:${uid}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

export function isValidAppleTransactionId(value: unknown): value is string {
  return typeof value === 'string' && appleTransactionIdPattern.test(value);
}

export function isValidStoreAppAccountToken(
  value: unknown
): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}

export interface ExpectedAppleTransactionClaims {
  productId: string;
  transactionId: string;
  appAccountToken: string;
  environment: AppleStoreEnvironment;
  bundleId: string;
}

/** Returns a stable support code; null means all point-grant claims match. */
export function appleTransactionClaimIssue(
  transaction: JWSTransactionDecodedPayload,
  expected: ExpectedAppleTransactionClaims
): string | null {
  if (transaction.bundleId !== expected.bundleId) return 'bundle_id_mismatch';
  if (transaction.environment !== expected.environment) {
    return 'environment_mismatch';
  }
  if (transaction.productId !== expected.productId) return 'product_mismatch';
  if (transaction.transactionId !== expected.transactionId) {
    return 'transaction_id_mismatch';
  }
  if (!isValidAppleTransactionId(transaction.transactionId)) {
    return 'transaction_id_invalid';
  }
  if (transaction.type !== Type.CONSUMABLE) return 'product_type_invalid';
  if (transaction.quantity !== 1) return 'quantity_invalid';
  if (transaction.inAppOwnershipType !== InAppOwnershipType.PURCHASED) {
    return 'ownership_type_invalid';
  }
  if (transaction.revocationDate != null || transaction.revocationReason != null) {
    return 'transaction_revoked';
  }
  if (transaction.appAccountToken !== expected.appAccountToken) {
    return 'app_account_token_mismatch';
  }
  return null;
}

export interface PendingStorePurchaseState {
  status?: unknown;
  attempts?: unknown;
  leaseUntilMillis?: unknown;
  nextAttemptAtMillis?: unknown;
}

export interface PendingStorePurchaseClaimDecision {
  claim: boolean;
  terminal: boolean;
  nextAttempt: number;
}

export function decidePendingStorePurchaseClaim(
  state: PendingStorePurchaseState,
  nowMillis: number
): PendingStorePurchaseClaimDecision {
  const attempts =
    typeof state.attempts === 'number' && Number.isInteger(state.attempts)
      ? Math.max(0, state.attempts)
      : 0;
  if (attempts >= maxPendingStorePurchaseAttempts) {
    return { claim: false, terminal: true, nextAttempt: attempts };
  }

  const status = state.status;
  const supportedStatus =
    status === 'pending' ||
    status === 'retryable_error' ||
    status === 'verifying';
  if (!supportedStatus) {
    return { claim: false, terminal: false, nextAttempt: attempts };
  }

  if (
    status === 'verifying' &&
    typeof state.leaseUntilMillis === 'number' &&
    state.leaseUntilMillis > nowMillis
  ) {
    return { claim: false, terminal: false, nextAttempt: attempts };
  }
  if (
    status === 'retryable_error' &&
    typeof state.nextAttemptAtMillis === 'number' &&
    state.nextAttemptAtMillis > nowMillis
  ) {
    return { claim: false, terminal: false, nextAttempt: attempts };
  }

  return { claim: true, terminal: false, nextAttempt: attempts + 1 };
}

export function pendingStorePurchaseRetryDelayMillis(attempts: number): number {
  const boundedAttempts = Math.min(
    maxPendingStorePurchaseAttempts,
    Math.max(1, Math.trunc(attempts))
  );
  return Math.min(6 * 60 * 60 * 1000, 15 * 60 * 1000 * 2 ** (boundedAttempts - 1));
}

export function isTerminalPendingStorePurchaseError(errorCode: unknown): boolean {
  return (
    errorCode === 'invalid-argument' ||
    errorCode === 'already-exists' ||
    errorCode === 'not-found' ||
    errorCode === 'permission-denied' ||
    errorCode === 'unauthenticated'
  );
}

export interface PlayPurchaseReservationState {
  uid?: unknown;
  productId?: unknown;
  status?: unknown;
  leaseUntilMillis?: unknown;
}

export function canClaimPlayPurchaseReservation(
  state: PlayPurchaseReservationState | undefined,
  uid: string,
  productId: string,
  nowMillis: number
): boolean {
  if (state == null) return true;
  if (state.uid !== uid || state.productId !== productId) return false;
  if (state.status === 'verification_failed' || state.status === 'rejected') {
    return true;
  }
  return (
    state.status === 'verifying' &&
    typeof state.leaseUntilMillis === 'number' &&
    state.leaseUntilMillis <= nowMillis
  );
}

export interface PlayVerificationQuotaState {
  dayKey?: unknown;
  count?: unknown;
}

export function nextPlayVerificationQuotaCount(
  state: PlayVerificationQuotaState | undefined,
  dayKey: string
): number | null {
  const currentCount =
    state?.dayKey === dayKey &&
    typeof state.count === 'number' &&
    Number.isInteger(state.count)
      ? Math.max(0, state.count)
      : 0;
  if (currentCount >= maxPlayVerificationAttemptsPerUtcDay) return null;
  return currentCount + 1;
}
