export const minimumSupportedBirthYear = 1900;

export interface DateOfBirth {
  birthYear: number;
  birthMonth: number;
  birthDay: number;
}

export function parseValidDateOfBirth(
  value: Record<string, unknown> | undefined
): DateOfBirth | null {
  const birthYear = value?.birthYear;
  const birthMonth = value?.birthMonth;
  const birthDay = value?.birthDay;
  if (
    typeof birthYear !== 'number' ||
    !Number.isSafeInteger(birthYear) ||
    typeof birthMonth !== 'number' ||
    !Number.isSafeInteger(birthMonth) ||
    typeof birthDay !== 'number' ||
    !Number.isSafeInteger(birthDay) ||
    birthYear < minimumSupportedBirthYear ||
    birthMonth < 1 ||
    birthMonth > 12 ||
    birthDay < 1
  ) {
    return null;
  }

  const candidate = new Date(Date.UTC(birthYear, birthMonth - 1, birthDay));
  if (
    candidate.getUTCFullYear() !== birthYear ||
    candidate.getUTCMonth() + 1 !== birthMonth ||
    candidate.getUTCDate() !== birthDay
  ) {
    return null;
  }
  return { birthYear, birthMonth, birthDay };
}

export function ageOnReferenceDate(
  dateOfBirth: DateOfBirth,
  referenceDate = new Date()
): number | null {
  const referenceYear = referenceDate.getUTCFullYear();
  const referenceMonth = referenceDate.getUTCMonth() + 1;
  const referenceDay = referenceDate.getUTCDate();
  if (dateOfBirth.birthYear > referenceYear) return null;

  const birthdayHasPassed =
    referenceMonth > dateOfBirth.birthMonth ||
    (referenceMonth === dateOfBirth.birthMonth &&
      referenceDay >= dateOfBirth.birthDay);
  const age =
    referenceYear - dateOfBirth.birthYear - (birthdayHasPassed ? 0 : 1);
  return age >= 0 ? age : null;
}

export function hasMinimumAge(
  value: Record<string, unknown> | undefined,
  minimumAge: number,
  referenceDate = new Date()
): boolean {
  const dateOfBirth = parseValidDateOfBirth(value);
  if (dateOfBirth == null) return false;
  const age = ageOnReferenceDate(dateOfBirth, referenceDate);
  return age != null && age >= minimumAge;
}
