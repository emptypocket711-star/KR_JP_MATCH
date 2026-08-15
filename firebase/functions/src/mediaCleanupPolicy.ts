export const mediaCleanupLeaseMillis = 10 * 60 * 1000;
export const mediaCleanupRetryBaseMillis = 15 * 60 * 1000;
export const mediaCleanupRetryMaxMillis = 6 * 60 * 60 * 1000;
export const mediaCleanupMaxAttempts = 12;

export type MediaCleanupQueueStatus =
  | 'pending'
  | 'processing'
  | 'quarantined';

export interface MediaCleanupQueueState {
  status?: unknown;
  attempts?: unknown;
  leaseOwner?: unknown;
  leaseUntilMillis?: unknown;
  nextAttemptAtMillis?: unknown;
}

export interface MediaCleanupClaimDecision {
  claim: boolean;
  quarantine: boolean;
  nextAttempt: number;
}

function normalizedAttempts(value: unknown): number {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : 0;
}

/**
 * Claims only due work. A stale processing lease becomes runnable again, while
 * an active lease or future retry is skipped without consuming an attempt.
 */
export function decideMediaCleanupClaim(
  state: MediaCleanupQueueState,
  nowMillis: number
): MediaCleanupClaimDecision {
  const attempts = normalizedAttempts(state.attempts);
  if (state.status === 'quarantined' || attempts >= mediaCleanupMaxAttempts) {
    return { claim: false, quarantine: true, nextAttempt: attempts };
  }
  if (state.status !== 'pending' && state.status !== 'processing') {
    return { claim: false, quarantine: false, nextAttempt: attempts };
  }
  if (
    typeof state.nextAttemptAtMillis === 'number' &&
    Number.isFinite(state.nextAttemptAtMillis) &&
    state.nextAttemptAtMillis > nowMillis
  ) {
    return { claim: false, quarantine: false, nextAttempt: attempts };
  }
  if (
    state.status === 'processing' &&
    typeof state.leaseUntilMillis === 'number' &&
    Number.isFinite(state.leaseUntilMillis) &&
    state.leaseUntilMillis > nowMillis
  ) {
    return { claim: false, quarantine: false, nextAttempt: attempts };
  }
  return { claim: true, quarantine: false, nextAttempt: attempts + 1 };
}

export type MediaCleanupLeaseIssue =
  | 'not-processing'
  | 'wrong-owner'
  | 'expired'
  | null;

export function mediaCleanupLeaseIssue(
  state: MediaCleanupQueueState,
  expected: { leaseOwner: string; nowMillis: number }
): MediaCleanupLeaseIssue {
  if (state.status !== 'processing') return 'not-processing';
  if (state.leaseOwner !== expected.leaseOwner) return 'wrong-owner';
  if (
    typeof state.leaseUntilMillis !== 'number' ||
    !Number.isFinite(state.leaseUntilMillis) ||
    state.leaseUntilMillis <= expected.nowMillis
  ) {
    return 'expired';
  }
  return null;
}

export function mediaCleanupRetryDelayMillis(attempts: unknown): number {
  const boundedAttempts = Math.min(
    mediaCleanupMaxAttempts,
    Math.max(1, normalizedAttempts(attempts))
  );
  return Math.min(
    mediaCleanupRetryMaxMillis,
    mediaCleanupRetryBaseMillis * 2 ** (boundedAttempts - 1)
  );
}

export function shouldQuarantineMediaCleanup(attempts: unknown): boolean {
  return normalizedAttempts(attempts) >= mediaCleanupMaxAttempts;
}

/**
 * Consumed authorizations are durable publication-generation proofs. Other
 * terminal ledgers may retire only after both the transactionally maintained
 * counter and the compatibility dependency query say no cleanup remains.
 */
export function canRetireMediaAuthorization(input: {
  status: unknown;
  pendingGenerationCleanupCount: unknown;
  hasGenerationCleanupDependency: boolean;
}): boolean {
  if (input.status === 'consumed') return false;
  if (input.hasGenerationCleanupDependency) return false;
  return input.pendingGenerationCleanupCount == null ||
    input.pendingGenerationCleanupCount === 0;
}

export function nextPendingGenerationCleanupCount(
  current: unknown,
  delta: 1 | -1
): number | null {
  const normalized = current == null
    ? 0
    : typeof current === 'number' &&
        Number.isSafeInteger(current) &&
        current >= 0
      ? current
      : null;
  if (normalized == null) return null;
  const next = normalized + delta;
  return next >= 0 ? next : null;
}
