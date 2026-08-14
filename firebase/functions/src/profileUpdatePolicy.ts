import { hasMinimumAge, parseValidDateOfBirth } from './birthDatePolicy';
import { isOwnedProfileMediaPath } from './profilePhotoPolicy';

export const editableProfileFieldNames = [
  'displayName',
  'bio',
  'relationshipType',
  'birthYear',
  'birthMonth',
  'birthDay',
  'gender',
  'nationality',
  'residingCountry',
  'nativeLanguage',
  'learningLanguage',
  'keywords',
  'photoUrls',
  'preferredGender',
  'preferredNationality',
  'preferredAgeMin',
  'preferredAgeMax',
] as const;
export { profileMediaVisibilityVersion } from './profileMediaVisibilityPolicy';

const editableProfileFields = new Set<string>(editableProfileFieldNames);
const relationshipTypes = new Set([
  '친구',
  '언어교환',
  '문화교류',
  '친한친구',
]);

export interface ValidatedProfileUpdate {
  displayName: string;
  bio: string;
  relationshipType: string;
  birthYear: number;
  birthMonth: number;
  birthDay: number;
  gender: 'male' | 'female';
  nationality: 'KR' | 'JP';
  residingCountry: 'KR' | 'JP' | 'OTHER';
  nativeLanguage: 'ko' | 'ja';
  learningLanguage: 'ko' | 'ja';
  keywords: string[];
  photoUrls: string[];
  preferredGender: 'male' | 'female' | 'any' | null;
  preferredNationality: 'KR' | 'JP' | 'any' | null;
  preferredAgeMin: number;
  preferredAgeMax: number;
}

export type ProfileUpdateValidationResult =
  | { ok: true; value: ValidatedProfileUpdate }
  | { ok: false; reason: string };

export function validateProfileUpdateInput(
  input: unknown,
  referenceDate = new Date(),
  uid?: string
): ProfileUpdateValidationResult {
  if (!isPlainRecord(input)) {
    return invalid('profile update must be an object');
  }

  for (const key of Object.keys(input)) {
    if (!editableProfileFields.has(key)) {
      return invalid(`Unexpected field: ${key}`);
    }
  }
  for (const key of editableProfileFieldNames) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) {
      return invalid(`Missing required field: ${key}`);
    }
  }

  if (!isTrimmedLength(input.displayName, 2, 20)) {
    return invalid('displayName must be 2-20 characters');
  }
  const normalizedDisplayName = normalizeProfileDisplayName(input.displayName);
  if (!isValidProfileDisplayNameReservationId(normalizedDisplayName)) {
    return invalid('displayName contains unsupported characters');
  }
  if (typeof input.bio !== 'string' || input.bio.length > 500) {
    return invalid('bio must be a string <= 500 characters');
  }
  if (
    typeof input.relationshipType !== 'string' ||
    !relationshipTypes.has(input.relationshipType)
  ) {
    return invalid('relationshipType is invalid');
  }
  const dateOfBirth = parseValidDateOfBirth(input);
  if (dateOfBirth == null) {
    return invalid('birthYear, birthMonth and birthDay must be a valid date');
  }
  if (!hasMinimumAge(input, 18, referenceDate)) {
    return invalid('date of birth must identify an adult aged 18 or older');
  }
  if (!oneOf(input.gender, ['male', 'female'])) {
    return invalid('gender must be male or female');
  }
  if (!oneOf(input.nationality, ['KR', 'JP'])) {
    return invalid('nationality must be KR or JP');
  }
  if (!oneOf(input.residingCountry, ['KR', 'JP', 'OTHER'])) {
    return invalid('residingCountry must be KR, JP, or OTHER');
  }
  if (!oneOf(input.nativeLanguage, ['ko', 'ja'])) {
    return invalid('nativeLanguage must be ko or ja');
  }
  if (!oneOf(input.learningLanguage, ['ko', 'ja'])) {
    return invalid('learningLanguage must be ko or ja');
  }
  if (input.nativeLanguage === input.learningLanguage) {
    return invalid('nativeLanguage and learningLanguage must be different');
  }
  if (!isBoundedUniqueStringArray(input.keywords, 5, 30)) {
    return invalid(
      'keywords must be up to 5 unique non-empty strings <= 30 characters'
    );
  }
  if (!isProfilePhotoArray(input.photoUrls, uid)) {
    return invalid(
      'photoUrls must contain up to 6 unique owned profile-media paths'
    );
  }
  if (!nullableOneOf(input.preferredGender, ['male', 'female', 'any'])) {
    return invalid('preferredGender is invalid');
  }
  if (!nullableOneOf(input.preferredNationality, ['KR', 'JP', 'any'])) {
    return invalid('preferredNationality is invalid');
  }
  if (
    typeof input.preferredAgeMin !== 'number' ||
    !Number.isSafeInteger(input.preferredAgeMin) ||
    typeof input.preferredAgeMax !== 'number' ||
    !Number.isSafeInteger(input.preferredAgeMax) ||
    input.preferredAgeMin < 18 ||
    input.preferredAgeMax > 100 ||
    input.preferredAgeMin > input.preferredAgeMax
  ) {
    return invalid('preferred age range must be integers from 18 to 100');
  }

  return {
    ok: true,
    value: {
      displayName: input.displayName.trim(),
      bio: input.bio.trim(),
      relationshipType: input.relationshipType,
      birthYear: dateOfBirth.birthYear,
      birthMonth: dateOfBirth.birthMonth,
      birthDay: dateOfBirth.birthDay,
      gender: input.gender,
      nationality: input.nationality,
      residingCountry: input.residingCountry,
      nativeLanguage: input.nativeLanguage,
      learningLanguage: input.learningLanguage,
      keywords: input.keywords.map((value) => value.trim()),
      photoUrls: [...input.photoUrls],
      preferredGender: input.preferredGender,
      preferredNationality: input.preferredNationality,
      preferredAgeMin: input.preferredAgeMin,
      preferredAgeMax: input.preferredAgeMax,
    },
  };
}

export function normalizeProfileDisplayName(value: string): string {
  return value.trim().toLocaleLowerCase('ko-KR').replace(/\s+/g, '');
}

export function isValidProfileDisplayNameReservationId(
  value: string
): boolean {
  return (
    value.length >= 2 &&
    value.length <= 20 &&
    value !== '..' &&
    !/^__.*__$/u.test(value) &&
    !value.includes('/') &&
    !containsUnsupportedControlCharacter(value)
  );
}

export function profileDisplayNameReservationIdsToRelease(input: {
  storedNormalized: unknown;
  currentDisplayName: unknown;
  nextNormalized: string;
}): string[] {
  const candidates = [input.storedNormalized, input.currentDisplayName];
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const normalized = normalizeProfileDisplayName(candidate);
    if (
      normalized !== input.nextNormalized &&
      isValidProfileDisplayNameReservationId(normalized)
    ) {
      ids.add(normalized);
    }
  }
  return [...ids];
}

function invalid(reason: string): ProfileUpdateValidationResult {
  return { ok: false, reason };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isTrimmedLength(
  value: unknown,
  min: number,
  max: number
): value is string {
  if (typeof value !== 'string') return false;
  const length = value.trim().length;
  return length >= min && length <= max;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[]
): value is T {
  return typeof value === 'string' && allowed.includes(value as T);
}

function nullableOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[]
): value is T | null {
  return value === null || oneOf(value, allowed);
}

function isBoundedUniqueStringArray(
  value: unknown,
  maxItems: number,
  maxLength: number
): value is string[] {
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

function isProfilePhotoArray(value: unknown, uid?: string): value is string[] {
  if (!Array.isArray(value) || value.length > 6) return false;
  const unique = new Set<string>();
  for (const item of value) {
    if (
      typeof item !== 'string' ||
      item.length === 0 ||
      item.length > 512 ||
      unique.has(item) ||
      !isOwnedProfileMediaPath(item, uid)
    ) {
      return false;
    }
    unique.add(item);
  }
  return true;
}

function containsUnsupportedControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}
