import { hasMinimumAge } from './birthDatePolicy';

export type UserProfileLike = Record<string, unknown>;

export function hasValidAdultIdentity(
  data: UserProfileLike | undefined,
  referenceDate = new Date()
): boolean {
  return (
    hasMinimumAge(data, 18, referenceDate) &&
    (data?.gender === 'male' || data?.gender === 'female')
  );
}

/**
 * The minimum viewer identity required before one account can enumerate or
 * open another account's public profile surfaces. In particular, a
 * reservation-created onboarding shell is active but is not an eligible
 * external viewer.
 */
export function isEligibleExternalProfileViewer(
  data: UserProfileLike | undefined,
  referenceDate = new Date()
): boolean {
  return (
    data?.onboardingCompleted === true &&
    !isDeletedOrUnavailableUser(data) &&
    hasCompletePublicProfile(data, referenceDate)
  );
}

export function isInternalOrTestUser(data: UserProfileLike | undefined): boolean {
  if (!data) return false;
  const source = typeof data.source === 'string' ? data.source : '';
  return (
    data.isAdmin === true ||
    data.isOperator === true ||
    data.isOfficial === true ||
    data.isTestUser === true ||
    data.hiddenFromDiscovery === true ||
    data.isMock === true ||
    source === 'mock' ||
    source === 'operator' ||
    source === 'promotion'
  );
}

export function isDeletedOrUnavailableUser(
  data: UserProfileLike | undefined
): boolean {
  if (!data) return true;
  const status = typeof data.status === 'string' ? data.status : '';
  const accountStatus =
    typeof data.accountStatus === 'string' ? data.accountStatus : '';
  return (
    data.isBanned === true ||
    data.isDeleted === true ||
    data.deleted === true ||
    data.deletedAt != null ||
    data.deletionRequested === true ||
    status === 'banned' ||
    status === 'deleted' ||
    status === 'deactivated' ||
    accountStatus === 'deleting' ||
    accountStatus === 'deleted' ||
    accountStatus === 'deactivated' ||
    accountStatus === 'banned'
  );
}

export function hasCompletePublicProfile(
  data: UserProfileLike | undefined,
  referenceDate = new Date()
): boolean {
  if (!data) return false;
  return (
    typeof data.displayName === 'string' &&
    data.displayName.trim().length > 0 &&
    hasValidAdultIdentity(data, referenceDate) &&
    (data.nationality === 'KR' || data.nationality === 'JP') &&
    (data.residingCountry === 'KR' ||
      data.residingCountry === 'JP' ||
      data.residingCountry === 'OTHER') &&
    (data.nativeLanguage === 'ko' || data.nativeLanguage === 'ja') &&
    (data.learningLanguage === 'ko' || data.learningLanguage === 'ja') &&
    data.nativeLanguage !== data.learningLanguage &&
    typeof data.bio === 'string'
  );
}

export function isPublicUserProfile(
  data: UserProfileLike | undefined,
  referenceDate = new Date()
): boolean {
  if (isDeletedOrUnavailableUser(data)) return false;
  if (isInternalOrTestUser(data)) return false;
  // A completion flag is never enough to expose an invalid legacy identity.
  // Birth-year-only accounts from the boundary year remain hidden until they
  // provide a full date of birth through the remediation flow.
  return hasCompletePublicProfile(data, referenceDate);
}
