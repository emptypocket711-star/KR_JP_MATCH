export function displayNameReservationForDeletion(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function hiddenParticipantsForDeletedAccount(
  userIds: unknown,
  deletedUid: string
): string[] {
  if (Array.isArray(userIds) && userIds.length > 0) {
    const participants = userIds.filter((id): id is string => typeof id === 'string');
    if (participants.length > 0) {
      return Array.from(new Set(participants));
    }
  }

  return [deletedUid];
}

export function chatPairKeyForDeletedAccount(
  userIds: unknown,
  deletedUid: string
): string | null {
  if (!Array.isArray(userIds)) return null;
  const participants = userIds.filter((id): id is string => typeof id === 'string');
  if (!participants.includes(deletedUid) || participants.length < 2) {
    return null;
  }

  return [...new Set(participants)].sort().join('_');
}

export function shouldClearDeletedAccountPairPointer(input: {
  activeMatchId: unknown;
  closingMatchId: string;
}): boolean {
  return input.activeMatchId === input.closingMatchId;
}

/**
 * Older match documents stored participant photos in positional top-level
 * fields in addition to `partnerFor`. Keep those snapshots from surviving an
 * account deletion, and use an empty string (rather than deleting the field)
 * so legacy client fallbacks cannot display the other participant's photo.
 */
export function legacyMatchPhotoScrubForDeletedAccount(
  userIds: unknown,
  deletedUid: string
): Record<'photoUrl' | 'myPhotoUrl', ''> | Partial<
  Record<'photoUrl' | 'myPhotoUrl', ''>
> {
  if (!Array.isArray(userIds) || userIds.length !== 2) {
    return { photoUrl: '', myPhotoUrl: '' };
  }
  const positions = userIds
    .map((value, index) => value === deletedUid ? index : -1)
    .filter((index) => index >= 0);
  if (positions.length !== 1) return { photoUrl: '', myPhotoUrl: '' };
  return positions[0] === 0 ? { myPhotoUrl: '' } : { photoUrl: '' };
}

export function userOwnedStoragePrefixes(
  uid: string,
  matchIds: readonly string[] = []
): string[] {
  const normalized = normalizedStoragePathSegment(uid, 'uid');
  const chatPrefixes = matchIds.map((matchId) =>
    userOwnedChatStoragePrefix(matchId, normalized)
  );
  return Array.from(new Set([
    `users/${normalized}/`,
    `profile_photos/${normalized}/`,
    `profile_media/${normalized}/`,
    ...chatPrefixes,
  ]));
}

export function userOwnedChatStoragePrefix(
  matchId: string,
  uid: string
): string {
  const normalizedUid = normalizedStoragePathSegment(uid, 'uid');
  const normalizedMatchId = normalizedStoragePathSegment(matchId, 'matchId');
  return `chat_images/${normalizedMatchId}/${normalizedUid}/`;
}

export interface AccountDeletionStorageTargets {
  prefixes: string[];
  invalidAuthorizationObjectPaths: unknown[];
}

/**
 * Adds chat prefixes found only in still-live upload authorizations. This
 * covers an authorization whose match document was removed before deletion,
 * without ever treating an arbitrary authorization path as a deletion target.
 */
export function accountDeletionStorageTargets(input: {
  uid: string;
  matchIds: readonly string[];
  authorizationObjectPaths: readonly unknown[];
}): AccountDeletionStorageTargets {
  const normalizedUid = normalizedStoragePathSegment(input.uid, 'uid');
  const authorizationMatchIds: string[] = [];
  const invalidAuthorizationObjectPaths: unknown[] = [];

  for (const value of input.authorizationObjectPaths) {
    if (typeof value !== 'string') {
      invalidAuthorizationObjectPaths.push(value);
      continue;
    }
    const segments = value.split('/');
    const isOwnedProfilePath =
      segments.length === 4 &&
      segments[0] === 'profile_media' &&
      segments[1] === normalizedUid &&
      isStoragePathSegment(segments[2]) &&
      segments[3] === 'image.jpg';
    if (isOwnedProfilePath) continue;

    const isOwnedChatPath =
      segments.length === 5 &&
      segments[0] === 'chat_images' &&
      isStoragePathSegment(segments[1]) &&
      segments[2] === normalizedUid &&
      isStoragePathSegment(segments[3]) &&
      segments[4] === 'image.jpg';
    if (isOwnedChatPath) {
      authorizationMatchIds.push(segments[1]);
      continue;
    }
    invalidAuthorizationObjectPaths.push(value);
  }

  return {
    prefixes: userOwnedStoragePrefixes(normalizedUid, [
      ...input.matchIds,
      ...authorizationMatchIds,
    ]),
    invalidAuthorizationObjectPaths,
  };
}

function normalizedStoragePathSegment(value: string, field: string): string {
  const normalized = value.trim();
  if (!isStoragePathSegment(normalized)) {
    throw new RangeError(`${field} must be a non-empty storage path segment`);
  }
  return normalized;
}

function isStoragePathSegment(value: string): boolean {
  return value.length > 0 &&
    value.length <= 1500 &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/') &&
    !containsControlCharacter(value);
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

export const accountDeletionJobLeaseMillis = 10 * 60 * 1000;
export const accountDeletionJobRetryBaseMillis = 5 * 60 * 1000;
export const accountDeletionJobRetryMaxMillis = 6 * 60 * 60 * 1000;

export const accountDeletionPhases = [
  'media_revoke',
  'firestore_cleanup',
  'storage_cleanup',
  'identity_cleanup',
  'auth_cleanup',
  'complete',
] as const;

export type AccountDeletionPhase = (typeof accountDeletionPhases)[number];

export type AccountDeletionRetryStatus =
  | 'deleting'
  | 'storage_retry_required'
  | 'auth_retry_required';

export interface AccountDeletionJobState {
  status?: unknown;
  phase?: unknown;
  leaseOwner?: unknown;
  leaseUntilMillis?: unknown;
  nextAttemptAtMillis?: unknown;
}

export interface AccountDeletionJobClaimDecision {
  claim: boolean;
  complete: boolean;
  phase: AccountDeletionPhase | null;
}

/**
 * Resolves both the durable phase model and states written by the older
 * synchronous deletion callable. Legacy states without an explicit durable
 * phase restart from media revocation, because they predate the quarantine and
 * exact chat-prefix verification contract.
 */
export function accountDeletionPhaseForJob(
  state: AccountDeletionJobState
): AccountDeletionPhase | null {
  if (state.status === 'complete') {
    return state.phase == null || state.phase === 'complete' ? 'complete' : null;
  }

  if (
    state.phase != null &&
    !(accountDeletionPhases as readonly unknown[]).includes(state.phase)
  ) {
    return null;
  }
  const explicitPhase = state.phase as AccountDeletionPhase | undefined;
  if (explicitPhase === 'complete') return null;

  switch (state.status) {
    case 'deleting':
      return explicitPhase ?? 'media_revoke';
    case 'storage_retry_required':
      return explicitPhase == null
        ? 'media_revoke'
        : earlierAccountDeletionPhase(explicitPhase, 'storage_cleanup');
    case 'auth_retry_required':
      return explicitPhase == null
        ? 'media_revoke'
        : earlierAccountDeletionPhase(explicitPhase, 'auth_cleanup');
    case 'storage_deleted':
    case 'finalizing':
      return 'media_revoke';
    default:
      return null;
  }
}

export function decideAccountDeletionJobClaim(
  state: AccountDeletionJobState,
  nowMillis: number
): AccountDeletionJobClaimDecision {
  const phase = accountDeletionPhaseForJob(state);
  if (phase == null) return { claim: false, complete: false, phase: null };
  if (phase === 'complete') {
    return { claim: false, complete: true, phase };
  }
  if (
    typeof state.leaseUntilMillis === 'number' &&
    Number.isFinite(state.leaseUntilMillis) &&
    state.leaseUntilMillis > nowMillis
  ) {
    return { claim: false, complete: false, phase };
  }
  if (
    typeof state.nextAttemptAtMillis === 'number' &&
    Number.isFinite(state.nextAttemptAtMillis) &&
    state.nextAttemptAtMillis > nowMillis
  ) {
    return { claim: false, complete: false, phase };
  }
  return { claim: true, complete: false, phase };
}

export type AccountDeletionLeaseIssue =
  | 'not-runnable'
  | 'wrong-phase'
  | 'wrong-owner'
  | 'expired'
  | null;

export function accountDeletionLeaseIssue(
  state: AccountDeletionJobState,
  expected: {
    phase: AccountDeletionPhase;
    leaseOwner: string;
    nowMillis: number;
  }
): AccountDeletionLeaseIssue {
  const phase = accountDeletionPhaseForJob(state);
  if (phase == null || phase === 'complete') return 'not-runnable';
  if (phase !== expected.phase) return 'wrong-phase';
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

export function nextAccountDeletionPhase(
  phase: AccountDeletionPhase
): AccountDeletionPhase {
  switch (phase) {
    case 'firestore_cleanup':
      return 'storage_cleanup';
    case 'media_revoke':
      return 'firestore_cleanup';
    case 'storage_cleanup':
      return 'identity_cleanup';
    case 'identity_cleanup':
      return 'auth_cleanup';
    case 'auth_cleanup':
    case 'complete':
      return 'complete';
  }
}

export function accountDeletionRetryStatusForPhase(
  phase: AccountDeletionPhase
): AccountDeletionRetryStatus {
  if (phase === 'storage_cleanup') return 'storage_retry_required';
  if (phase === 'auth_cleanup') return 'auth_retry_required';
  return 'deleting';
}

export function accountDeletionRetryDelayMillis(attempts: unknown): number {
  const normalized =
    typeof attempts === 'number' && Number.isSafeInteger(attempts)
      ? Math.max(1, attempts)
      : 1;
  return Math.min(
    accountDeletionJobRetryMaxMillis,
    accountDeletionJobRetryBaseMillis * 2 ** Math.min(10, normalized - 1)
  );
}

export class AccountDeletionOperationError extends Error {
  constructor(
    readonly stage: string,
    readonly reasons: unknown[]
  ) {
    super(`${stage} failed for ${reasons.length} operation(s)`);
    this.name = 'AccountDeletionOperationError';
  }
}

/** Prevents Promise.allSettled from silently turning deletion failures green. */
export function assertAccountDeletionOperationsFulfilled(
  stage: string,
  results: readonly PromiseSettledResult<unknown>[]
): void {
  const reasons = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : []
  );
  if (reasons.length > 0) {
    throw new AccountDeletionOperationError(stage, reasons);
  }
}

/** Every expected prefix must be observed and contain exactly zero objects. */
export function unverifiedOrNonEmptyStoragePrefixes(
  expectedPrefixes: readonly string[],
  remainingObjectCounts: Readonly<Record<string, unknown>>
): string[] {
  return expectedPrefixes.filter((prefix) => {
    const count = remainingObjectCounts[prefix];
    return typeof count !== 'number' || !Number.isSafeInteger(count) || count !== 0;
  });
}

export function isVerifiedZeroOwnedDocuments(count: unknown): boolean {
  return typeof count === 'number' && Number.isSafeInteger(count) && count === 0;
}

/** Never recreate users/{uid} after identity cleanup has already removed it. */
export function shouldWriteAccountDeletionTombstone(input: {
  userExists: boolean;
  resumablePhase: AccountDeletionPhase | null;
}): boolean {
  // The durable job is the deletion marker when users/{uid} is already gone.
  // Recreating even a tombstone shell expands the identity surface and lets
  // late onboarding-style code mistake the UID for a new account.
  return input.userExists;
}

function earlierAccountDeletionPhase(
  explicitPhase: AccountDeletionPhase | undefined,
  fallbackPhase: AccountDeletionPhase
): AccountDeletionPhase {
  if (explicitPhase == null) return fallbackPhase;
  const explicitIndex = accountDeletionPhases.indexOf(explicitPhase);
  const fallbackIndex = accountDeletionPhases.indexOf(fallbackPhase);
  return explicitIndex < fallbackIndex ? explicitPhase : fallbackPhase;
}
