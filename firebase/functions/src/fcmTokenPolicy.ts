import { createHash } from 'crypto';

import type { ActiveAccountIssue } from './callablePolicy';

export const fcmProfileNotReadyReason = 'profile-not-ready' as const;

export interface FcmRegistrationRetryDetails {
  reason: typeof fcmProfileNotReadyReason;
  retryable: true;
}

export function fcmTokenOwnershipId(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function shouldClearOwnedFcmToken(input: {
  storedToken: unknown;
  requestedToken: string;
}): boolean {
  return input.storedToken === input.requestedToken;
}

/**
 * Returns the minimal client-visible signal for the only retryable account
 * state. It intentionally excludes the uid, token, and all stored profile
 * fields.
 */
export function retryableFcmRegistrationDetails(
  accountIssue: ActiveAccountIssue
): FcmRegistrationRetryDetails | null {
  if (accountIssue !== 'missing') return null;
  return {
    reason: fcmProfileNotReadyReason,
    retryable: true,
  };
}
