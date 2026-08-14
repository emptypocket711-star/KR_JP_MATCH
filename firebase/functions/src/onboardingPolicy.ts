import { isAccountDeletedOrDeleting } from './callablePolicy';
import { hasMinimumAge, parseValidDateOfBirth } from './birthDatePolicy';
import { hasValidAdultIdentity } from './profileExposurePolicy';
import { isOwnedProfileMediaPath } from './profilePhotoPolicy';
import { pointBalanceTrustIssue } from './pointPolicy';

export const initialOnboardingPointGrantAmount = 3;
export const profileUploadOnboardingShellProvenance =
  'reserveMediaUploadV2:profile-onboarding-shell:v1';
export { profileMediaVisibilityVersion } from './profileMediaVisibilityPolicy';
export { hasValidAdultIdentity };

const onboardingProfileFields = new Set([
  'relationshipType',
  'displayName',
  'birthYear',
  'birthMonth',
  'birthDay',
  'gender',
  'nationality',
  'residingCountry',
  'nativeLanguage',
  'learningLanguage',
  'bio',
  'occupation',
  'keywords',
  'qaItems',
  'photoUrls',
  'preferredGender',
  'preferredNationality',
  'preferredAgeMin',
  'preferredAgeMax',
]);

const requiredOnboardingProfileFields = [...onboardingProfileFields];

const profileUploadOnboardingShellFields = new Set([
  'uid',
  'accountStatus',
  'onboardingCompleted',
  'onboardingShellProvenance',
  'createdAt',
  'updatedAt',
  // These settings/credentials can be written through existing server-owned
  // or narrowly scoped paths before profile onboarding completes.
  'notificationsEnabled',
  'nightQuietEnabled',
  'uiLanguage',
  'lastSeenAt',
  'fcmToken',
  'fcmTokenUpdatedAt',
]);

export type OnboardingPointGrantDecision =
  | {
      action: 'none';
    }
  | {
      action: 'grant';
      amount: 3;
      balanceBefore: 0;
      balanceAfter: 3;
      source: 'onboarding_v1';
      legacyBalancePreserved: false;
    };

export type OnboardingProfileValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export type OnboardingCompletionBlockReason =
  | 'already-completed'
  | 'banned'
  | 'deleted'
  | null;

export function onboardingCompletionBlockReason(
  userData: Record<string, unknown> | undefined,
  referenceDate = new Date()
): OnboardingCompletionBlockReason {
  if (userData?.isBanned === true) return 'banned';
  if (isAccountDeletedOrDeleting(userData)) return 'deleted';
  if (
    userData?.onboardingCompleted === true &&
    hasCompleteUsableProfile(userData, referenceDate)
  ) {
    return 'already-completed';
  }
  return null;
}

export function hasCompleteUsableProfile(
  userData: Record<string, unknown> | undefined,
  referenceDate = new Date()
): boolean {
  if (userData == null || !hasValidAdultIdentity(userData, referenceDate)) {
    return false;
  }
  const displayName = userData.displayName;
  return (
    typeof displayName === 'string' &&
    displayName.trim().length >= 2 &&
    (userData.nationality === 'KR' || userData.nationality === 'JP') &&
    (userData.residingCountry === 'KR' ||
      userData.residingCountry === 'JP' ||
      userData.residingCountry === 'OTHER') &&
    (userData.nativeLanguage === 'ko' || userData.nativeLanguage === 'ja') &&
    (userData.learningLanguage === 'ko' || userData.learningLanguage === 'ja') &&
    userData.nativeLanguage !== userData.learningLanguage
  );
}

export function onboardingPointEventId(uid: string): string {
  const normalizedUid = uid.trim();
  if (normalizedUid.length === 0) {
    throw new RangeError('uid must not be empty');
  }
  return `onboarding:${normalizedUid}:v1`;
}

export function isExactProfileUploadOnboardingShell(input: {
  uid: string;
  userData: Record<string, unknown> | undefined;
}): boolean {
  const { userData } = input;
  if (
    userData == null ||
    userData.uid !== input.uid ||
    userData.accountStatus !== 'onboarding' ||
    userData.onboardingCompleted !== false ||
    userData.onboardingShellProvenance !==
      profileUploadOnboardingShellProvenance ||
    userData.createdAt == null ||
    userData.updatedAt == null
  ) {
    return false;
  }

  return Object.keys(userData).every(
    (field) =>
      field !== 'keyCount' &&
      !field.startsWith('pointBalance') &&
      profileUploadOnboardingShellFields.has(field)
  );
}

export function decideInitialOnboardingPointGrant(input: {
  uid: string;
  userExists: boolean;
  userData: Record<string, unknown> | undefined;
  initialPointEventExists: boolean;
}): OnboardingPointGrantDecision {
  if (input.userExists && pointBalanceTrustIssue(input.userData) === null) {
    return { action: 'none' };
  }

  if (input.initialPointEventExists) {
    throw new RangeError(
      'existing onboarding point evidence requires audited reconciliation'
    );
  }

  const isNewUser = !input.userExists && input.userData === undefined;
  const isServerCreatedShell =
    input.userExists &&
    isExactProfileUploadOnboardingShell({
      uid: input.uid,
      userData: input.userData,
    });
  if (!isNewUser && !isServerCreatedShell) {
    throw new RangeError(
      'untrusted existing point state requires audited reconciliation'
    );
  }

  return {
    action: 'grant',
    amount: initialOnboardingPointGrantAmount,
    balanceBefore: 0,
    balanceAfter: initialOnboardingPointGrantAmount,
    source: 'onboarding_v1',
    legacyBalancePreserved: false,
  };
}

export function validateOnboardingProfileInput(
  value: unknown,
  referenceDate = new Date(),
  uid?: string
): OnboardingProfileValidationResult {
  if (!isPlainRecord(value)) {
    return invalid('profile must be an object');
  }

  for (const key of Object.keys(value)) {
    if (!onboardingProfileFields.has(key)) {
      return invalid(`Unexpected field: ${key}`);
    }
  }
  for (const key of requiredOnboardingProfileFields) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      return invalid(`Missing required field: ${key}`);
    }
  }

  const displayName = value.displayName;
  if (!isTrimmedLength(displayName, 2, 20)) {
    return invalid('displayName must be 2-20 characters');
  }

  if (parseValidDateOfBirth(value) == null) {
    return invalid('birthYear, birthMonth and birthDay must be a valid date');
  }
  if (!hasMinimumAge(value, 18, referenceDate)) {
    return invalid('date of birth must identify an adult aged 18 or older');
  }

  if (!oneOf(value.gender, ['male', 'female'])) {
    return invalid('gender must be male or female');
  }
  if (!oneOf(value.nationality, ['KR', 'JP'])) {
    return invalid('nationality must be KR or JP');
  }
  if (!oneOf(value.residingCountry, ['KR', 'JP', 'OTHER'])) {
    return invalid('residingCountry must be KR, JP, or OTHER');
  }
  if (!oneOf(value.nativeLanguage, ['ko', 'ja'])) {
    return invalid('nativeLanguage must be ko or ja');
  }
  if (!oneOf(value.learningLanguage, ['ko', 'ja'])) {
    return invalid('learningLanguage must be ko or ja');
  }
  if (value.nativeLanguage === value.learningLanguage) {
    return invalid('nativeLanguage and learningLanguage must be different');
  }

  if (!isTrimmedLength(value.relationshipType, 1, 50)) {
    return invalid('relationshipType must be 1-50 characters');
  }
  if (typeof value.bio !== 'string' || value.bio.length > 500) {
    return invalid('bio must be a string <= 500 characters');
  }
  if (typeof value.occupation !== 'string' || value.occupation.length > 80) {
    return invalid('occupation must be a string <= 80 characters');
  }

  if (!isBoundedUniqueStringArray(value.keywords, 5, 30)) {
    return invalid('keywords must be up to 5 unique non-empty strings <= 30 characters');
  }
  if (!isProfilePhotoArray(value.photoUrls, uid)) {
    return invalid('photoUrls must contain up to 6 unique owned profile-media paths');
  }
  if (!isQaItems(value.qaItems)) {
    return invalid('qaItems must contain up to 10 question/answer string objects');
  }

  if (!nullableOneOf(value.preferredGender, ['male', 'female', 'any', 'all'])) {
    return invalid('preferredGender is invalid');
  }
  if (!nullableOneOf(value.preferredNationality, ['KR', 'JP', 'any', 'all'])) {
    return invalid('preferredNationality is invalid');
  }

  const ageMin = value.preferredAgeMin;
  const ageMax = value.preferredAgeMax;
  const bothAgesMissing = ageMin == null && ageMax == null;
  if (!bothAgesMissing) {
    if (
      typeof ageMin !== 'number' ||
      !Number.isSafeInteger(ageMin) ||
      typeof ageMax !== 'number' ||
      !Number.isSafeInteger(ageMax) ||
      ageMin < 18 ||
      ageMax > 100 ||
      ageMin > ageMax
    ) {
      return invalid('preferred age range must be integers from 18 to 100');
    }
  }

  return { ok: true };
}

function invalid(reason: string): OnboardingProfileValidationResult {
  return { ok: false, reason };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isTrimmedLength(value: unknown, min: number, max: number): boolean {
  if (typeof value !== 'string') return false;
  const length = value.trim().length;
  return length >= min && length <= max;
}

function oneOf(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === 'string' && allowed.includes(value);
}

function nullableOneOf(value: unknown, allowed: readonly string[]): boolean {
  return value == null || oneOf(value, allowed);
}

function isBoundedUniqueStringArray(
  value: unknown,
  maxItems: number,
  maxLength: number
): boolean {
  if (!Array.isArray(value) || value.length > maxItems) return false;
  const normalized = new Set<string>();
  for (const item of value) {
    if (!isTrimmedLength(item, 1, maxLength)) return false;
    const key = item.trim().toLocaleLowerCase('ko-KR');
    if (normalized.has(key)) return false;
    normalized.add(key);
  }
  return true;
}

function isProfilePhotoArray(value: unknown, uid?: string): boolean {
  if (!Array.isArray(value) || value.length > 6) return false;
  const unique = new Set<string>();
  for (const item of value) {
    if (
      typeof item !== 'string' ||
      item.length === 0 ||
      item.length > 512 ||
      !isOwnedProfileMediaPath(item, uid) ||
      unique.has(item)
    ) {
      return false;
    }
    unique.add(item);
  }
  return true;
}

function isQaItems(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 10) return false;
  for (const item of value) {
    if (!isPlainRecord(item)) return false;
    const keys = Object.keys(item).sort();
    if (keys.length !== 2 || keys[0] !== 'answer' || keys[1] !== 'question') {
      return false;
    }
    if (!isTrimmedLength(item.question, 1, 120)) return false;
    if (!isTrimmedLength(item.answer, 1, 500)) return false;
  }
  return true;
}
