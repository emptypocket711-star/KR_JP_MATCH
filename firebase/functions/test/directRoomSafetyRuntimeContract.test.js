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

function between(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${startMarker} must exist`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${endMarker} must follow ${startMarker}`);
  return source.slice(start, end);
}

function exportSource(name) {
  const marker = `export const ${name} =`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} export must exist`);
  const next = source.indexOf('\nexport const ', start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}

test('block and report commit safety state with every room closure atomically', () => {
  for (const name of ['blockUser', 'reportUser']) {
    const callable = exportSource(name);
    assert.match(callable, /runTransaction\(async \((tx|transaction)\) =>/);
    assert.match(callable, /stageAllActivePairSafetyClosures\((tx|transaction),/);
    assert.match(callable, /\.(set|create)\(blockRef,/);
    assert.doesNotMatch(callable, /closePairChatForSafety|findMatch\(/);
  }

  const closure = between(
    'async function stageAllActivePairSafetyClosures(',
    '\nfunction reportContentDocumentRefs('
  );
  assert.match(closure, /activePairRoomIdsForSafety/);
  assert.match(closure, /MAX_ACTIVE_PAIR_ROOMS_PER_SAFETY_ACTION \+ 1/);
  assert.match(closure, /hiddenFor: userIds/);
  assert.match(closure, /activeMatchId: admin\.firestore\.FieldValue\.delete\(\)/);
  assert.match(closure, /readActiveCallClosures/);
  assert.match(closure, /stageActiveCallClosures/);
});

test('unrelated active rooms cannot exhaust the pair-safety closure scan', () => {
  const closure = between(
    'async function stageAllActivePairSafetyClosures(',
    '\nfunction reportContentDocumentRefs('
  );
  assert.match(closure, /where\('pairKey', '==', pairKey\)/);
  assert.match(closure, /where\('isActive', '==', true\)/);
  assert.doesNotMatch(closure, /array-contains', params\.actorUid/);

  assert.ok(firestoreIndexes.indexes.some((index) =>
    index.collectionGroup === 'matches' &&
    index.queryScope === 'COLLECTION' &&
    JSON.stringify(index.fields) === JSON.stringify([
      { fieldPath: 'pairKey', order: 'ASCENDING' },
      { fieldPath: 'isActive', order: 'ASCENDING' },
    ])
  ));
});

test('the fallback block trigger propagates closure failures', () => {
  const trigger = exportSource('onUserBlocked');
  assert.match(trigger, /await db\.runTransaction/);
  assert.match(trigger, /stageAllActivePairSafetyClosures/);
  assert.doesNotMatch(trigger, /try\s*\{|catch\s*\(/);
});

test('leave closes the active call in the same room transaction', () => {
  const callable = exportSource('leaveChat');
  assert.match(callable, /readActiveCallClosures/);
  assert.match(callable, /stageActiveCallClosures/);
  assert.match(callable, /closedReason: 'left_chat'/);
});

test('message and new-chat side effects reauthorize immediately before writes', () => {
  const messageTrigger = exportSource('onMessageCreated');
  assert.match(messageTrigger, /readAuthorizedDirectRoomSideEffectContext/);
  assert.match(messageTrigger, /applyAuthorizedMessageRecipientState/);
  assert.equal(
    (messageTrigger.match(/readAuthorizedDirectRoomSideEffectContext\(/g) ?? [])
      .length,
    2
  );

  const newChatNotifier = between(
    'async function notifyNewDirectChat(',
    '\nfunction normalizeDisplayName('
  );
  assert.match(newChatNotifier, /readAuthorizedDirectRoomSideEffectContext/);
  assert.match(newChatNotifier, /senderData\.displayName/);
});

test('direct-room block failures use the same unavailable contract', () => {
  const startChat = exportSource('startChat');
  const sendMessage = exportSource('sendMessage');
  const retryTranslation = exportSource('retryMessageTranslation');
  const mediaReservation = between(
    'async function reserveMediaUploadForProtocol(',
    '\nexport const reserveMediaUpload ='
  );

  assert.match(startChat, /directChatTargetUnavailable\(\)/);
  assert.match(sendMessage, /directRoomUnavailable\(\)/);
  assert.match(retryTranslation, /directRoomUnavailable\(\)/);
  assert.match(mediaReservation, /directRoomUnavailable\(\)/);
  for (const surface of [startChat, sendMessage, retryTranslation, mediaReservation]) {
    assert.doesNotMatch(surface, /blocked each other|blocked between these users/);
  }
});

test('startChat never reactivates or clears hidden historical state', () => {
  const callable = exportSource('startChat');
  assert.match(callable, /reusableDirectRoomSnapshots/);
  assert.doesNotMatch(callable, /source === 'legacy'/);
  assert.doesNotMatch(callable, /tx\.update\(activeMatchRef/);
});

test('active chat lists are bounded and fully reauthorized by the regional callable', () => {
  const callable = exportSource('listActiveChats');
  assert.match(callable, /regionalFunctions\.https\.onCall/);
  assert.match(callable, /requireAuthAndNotBanned\(context\)/);
  assert.match(callable, /requestedLimit > 20/);
  assert.match(callable, /runTransaction/);
  assert.match(callable, /where\('userIds', 'array-contains', uid\)/);
  assert.match(callable, /where\('isActive', '==', true\)/);
  assert.match(callable, /where\('directRoomVersion', '==', 1\)/);
  assert.match(callable, /reusableDirectRoomSnapshots/);
  assert.match(callable, /callerBlockSnap\.exists/);
  assert.match(callable, /peerBlockSnap\.exists/);
  assert.match(callable, /matchId: roomSnap\.id/);
  assert.match(callable, /partner: \{/);
  assert.doesNotMatch(callable, /return\s+(?:room|peer)(?:\.data\(\))?\s*;/);
  assert.doesNotMatch(callable, /\.\.\.(?:room|peer)\b/);
});
