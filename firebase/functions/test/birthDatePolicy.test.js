const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ageOnReferenceDate,
  hasMinimumAge,
  parseValidDateOfBirth,
} = require('../lib/birthDatePolicy');

const referenceDate = new Date('2026-08-12T12:00:00.000Z');

test('calculates age before and on the exact UTC birthday', () => {
  assert.equal(ageOnReferenceDate({
    birthYear: 2008,
    birthMonth: 8,
    birthDay: 13,
  }, referenceDate), 17);
  assert.equal(ageOnReferenceDate({
    birthYear: 2008,
    birthMonth: 8,
    birthDay: 12,
  }, referenceDate), 18);
});

test('validates leap days without Date normalization', () => {
  assert.deepEqual(parseValidDateOfBirth({
    birthYear: 2004,
    birthMonth: 2,
    birthDay: 29,
  }), { birthYear: 2004, birthMonth: 2, birthDay: 29 });
  assert.equal(parseValidDateOfBirth({
    birthYear: 2005,
    birthMonth: 2,
    birthDay: 29,
  }), null);
  assert.equal(hasMinimumAge({ birthYear: 2000 }, 18, referenceDate), false);
});
