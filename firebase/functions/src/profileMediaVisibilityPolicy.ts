import { isPublicUserProfile } from './profileExposurePolicy';

export const profileMediaVisibilityVersion = 1;

export type ProfileMediaVisibilityDecision = 'set' | 'clear' | 'none';

/**
 * Storage Rules cannot reproduce exact calendar-age validation. This marker is
 * written only after the server's full public-profile predicate succeeds.
 */
export function profileMediaVisibilityDecision(
  data: Record<string, unknown> | undefined,
  referenceDate = new Date()
): ProfileMediaVisibilityDecision {
  const eligible =
    data?.onboardingCompleted === true &&
    isPublicUserProfile(data, referenceDate);
  if (eligible) {
    return data?.profileMediaVisibilityVersion ===
      profileMediaVisibilityVersion
      ? 'none'
      : 'set';
  }
  return data?.profileMediaVisibilityVersion == null ? 'none' : 'clear';
}
