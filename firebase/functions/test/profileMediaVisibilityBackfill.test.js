const assert = require('node:assert/strict');
const test = require('node:test');

const {
  parseOptions,
} = require('../lib/admin/profileMediaVisibilityBackfill');

test('profile visibility audit is dry-run by default', () => {
  const options = parseOptions([
    '--expected-project',
    'hana-e2ee6',
  ]);
  assert.notEqual(options, 'help');
  assert.equal(options.apply, false);
  assert.equal(options.expectedProject, 'hana-e2ee6');
});

test('profile visibility apply parses exact count confirmations', () => {
  const options = parseOptions([
    '--apply',
    '--expected-project',
    'hana-e2ee6',
    '--confirm-project',
    'hana-e2ee6',
    '--confirm-set-count',
    '12',
    '--confirm-clear-count',
    '3',
  ]);
  assert.notEqual(options, 'help');
  assert.equal(options.apply, true);
  assert.equal(options.confirmSetCount, 12);
  assert.equal(options.confirmClearCount, 3);
  assert.throws(
    () => parseOptions(['--expected-project', 'hana-e2ee6', '--unknown']),
    /Unknown argument/
  );
});
