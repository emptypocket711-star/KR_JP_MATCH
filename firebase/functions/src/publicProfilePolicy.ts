import { ageOnReferenceDate, parseValidDateOfBirth } from './birthDatePolicy';

export function publicAgeFromPrivateProfile(
  data: Record<string, unknown>,
  referenceDate = new Date()
): number | null {
  const dateOfBirth = parseValidDateOfBirth(data);
  return dateOfBirth == null
    ? null
    : ageOnReferenceDate(dateOfBirth, referenceDate);
}

export function hasPrivateBirthDateField(
  value: Record<string, unknown>
): boolean {
  return (
    Object.prototype.hasOwnProperty.call(value, 'birthYear') ||
    Object.prototype.hasOwnProperty.call(value, 'birthMonth') ||
    Object.prototype.hasOwnProperty.call(value, 'birthDay')
  );
}
