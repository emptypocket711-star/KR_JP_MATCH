const assert = require('node:assert/strict');
const test = require('node:test');

const {
  hasPrivateBirthDateField,
  publicAgeFromPrivateProfile,
} = require('../lib/publicProfilePolicy');

const referenceDate = new Date('2026-08-12T12:00:00.000Z');

test('derives only age from the private exact date of birth', () => {
  const age = publicAgeFromPrivateProfile({
    birthYear: 2008,
    birthMonth: 8,
    birthDay: 12,
  }, referenceDate);
  const publicPayload = { uid: 'alice', age };

  assert.deepEqual(publicPayload, { uid: 'alice', age: 18 });
  assert.equal(hasPrivateBirthDateField(publicPayload), false);
});

test('refuses to derive a public age from incomplete or invalid DOB data', () => {
  assert.equal(publicAgeFromPrivateProfile({ birthYear: 2000 }, referenceDate), null);
  assert.equal(publicAgeFromPrivateProfile({
    birthYear: 2005,
    birthMonth: 2,
    birthDay: 29,
  }, referenceDate), null);
});
