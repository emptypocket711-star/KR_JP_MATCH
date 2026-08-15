'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.resolve(__dirname, '../src/index.ts'),
  'utf8'
);
const firestoreIndexes = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../../firestore.indexes.json'),
  'utf8'
));

const quotaCollections = [
  'mediaUploadQuotas',
  'mediaUploadRequestQuotas',
  'privateMediaReadQuotas',
];

function exportSource(name) {
  const marker = `export const ${name} =`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} export must exist`);
  const next = source.indexOf('\nexport const ', start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}

test('expired quota cleanup has every required collection-scope TTL index', () => {
  const cleanup = exportSource('cleanupExpiredMediaUploads');

  for (const collectionGroup of quotaCollections) {
    const collectionQuery = new RegExp(
      `\\.collection\\('${collectionGroup}'\\)\\s*` +
        `\\.where\\('expireAt', '<=', now\\)\\s*` +
        `\\.limit\\(100\\)`
    );
    assert.match(cleanup, collectionQuery);

    const override = firestoreIndexes.fieldOverrides.find((candidate) =>
      candidate.collectionGroup === collectionGroup &&
      candidate.fieldPath === 'expireAt'
    );
    assert.ok(override, `${collectionGroup}.expireAt override must exist`);
    assert.equal(override.ttl, true);
    assert.ok(override.indexes.some((index) =>
      index.order === 'ASCENDING' && index.queryScope === 'COLLECTION'
    ), `${collectionGroup}.expireAt needs COLLECTION_ASC`);

    for (const required of [
      { order: 'ASCENDING', queryScope: 'COLLECTION_GROUP' },
      { order: 'DESCENDING', queryScope: 'COLLECTION_GROUP' },
      { arrayConfig: 'CONTAINS', queryScope: 'COLLECTION_GROUP' },
    ]) {
      assert.ok(override.indexes.some((index) =>
        Object.entries(required).every(([key, value]) => index[key] === value)
      ), `${collectionGroup}.expireAt must preserve ${JSON.stringify(required)}`);
    }
  }
});
