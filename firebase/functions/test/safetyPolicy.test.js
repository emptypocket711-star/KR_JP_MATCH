const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildReportContentEvidence,
  canUseRequestedMatchForSafety,
  clientReportIntakeDecision,
  closedChatHiddenParticipants,
  isValidReportReason,
  maxReportEvidenceBodyLength,
  normalizeReportContentContext,
  reportContentContextIssue,
  reportContentStateIssue,
  reportEvidenceVersion,
  reportRequestShapeIssue,
} = require('../lib/safetyPolicy');

test('accepts only supported report reasons', () => {
  for (const reason of [
    'spam',
    'harassment',
    'inappropriate_photo',
    'fake_profile',
    'other',
  ]) {
    assert.equal(isValidReportReason(reason), true);
  }

  assert.equal(isValidReportReason(''), false);
  assert.equal(isValidReportReason('abuse'), false);
  assert.equal(isValidReportReason(null), false);
});

test('uses requested active random match when it belongs to reporter and target', () => {
  assert.equal(
    canUseRequestedMatchForSafety({
      exists: true,
      isActive: true,
      userIds: ['alice', 'bob'],
      actorUid: 'alice',
      targetUid: 'bob',
    }),
    true
  );

  assert.equal(
    canUseRequestedMatchForSafety({
      exists: true,
      isActive: true,
      userIds: ['bob', 'alice'],
      actorUid: 'alice',
      targetUid: 'bob',
    }),
    true
  );
});

test('rejects requested matches that are inactive, missing, or for another pair', () => {
  assert.equal(
    canUseRequestedMatchForSafety({
      exists: false,
      isActive: true,
      userIds: ['alice', 'bob'],
      actorUid: 'alice',
      targetUid: 'bob',
    }),
    false
  );

  assert.equal(
    canUseRequestedMatchForSafety({
      exists: true,
      isActive: false,
      userIds: ['alice', 'bob'],
      actorUid: 'alice',
      targetUid: 'bob',
    }),
    false
  );

  assert.equal(
    canUseRequestedMatchForSafety({
      exists: true,
      isActive: true,
      userIds: ['alice', 'carol'],
      actorUid: 'alice',
      targetUid: 'bob',
    }),
    false
  );

  assert.equal(
    canUseRequestedMatchForSafety({
      exists: true,
      isActive: true,
      userIds: 'alice,bob',
      actorUid: 'alice',
      targetUid: 'bob',
    }),
    false
  );
});

test('hides closed safety rooms for both participants exactly once', () => {
  assert.deepEqual(closedChatHiddenParticipants('alice', 'bob'), [
    'alice',
    'bob',
  ]);
  assert.deepEqual(closedChatHiddenParticipants('alice', 'alice'), ['alice']);
});

test('client reports always enter open moderation intake without auto-ban', () => {
  assert.deepEqual(clientReportIntakeDecision(), {
    status: 'open',
    shouldBanTarget: false,
    shouldCloseAllTargetMatches: false,
    shouldWriteReportCounters: false,
    shouldExposeModerationCounters: false,
  });
  assert.equal('autoBanHiddenParticipants' in require('../lib/safetyPolicy'), false);
});

test('report request and content context use strict allowlists', () => {
  assert.equal(
    reportRequestShapeIssue({
      targetUid: 'bob',
      reason: 'spam',
      note: '',
      matchId: '',
      contentContext: { contentType: 'post', postId: 'post_1' },
    }),
    null
  );
  assert.match(
    reportRequestShapeIssue({ targetUid: 'bob', reason: 'spam', role: 'admin' }),
    /unsupported report field/
  );
  assert.notEqual(
    reportRequestShapeIssue({ targetUid: 'bob', reason: 'unknown' }),
    null
  );
  assert.notEqual(
    reportRequestShapeIssue({ targetUid: 'bob', reason: 'spam', note: null }),
    null
  );
  assert.notEqual(
    reportRequestShapeIssue({ targetUid: 'bob', reason: 'spam', matchId: 7 }),
    null
  );
  assert.notEqual(
    reportRequestShapeIssue({
      targetUid: 'bob',
      reason: 'spam',
      contentContext: { contentType: 'post', postId: '../post-1' },
    }),
    null
  );
  assert.equal(reportContentContextIssue(undefined), null);
  assert.equal(reportContentContextIssue(null), null);
  assert.equal(
    reportContentContextIssue({ contentType: 'post', postId: 'post_1' }),
    null
  );
  assert.equal(
    reportContentContextIssue({
      contentType: 'comment',
      postId: 'post_1',
      commentId: 'comment-2',
    }),
    null
  );
  assert.equal(
    reportContentContextIssue({
      contentType: 'reply',
      postId: 'post_1',
      commentId: 'comment-2',
      replyId: 'reply-3',
    }),
    null
  );
});

test('content context rejects spoofed paths, extras, and invalid combinations', () => {
  for (const context of [
    'post-1',
    [],
    { contentType: 'post', postId: '../post-1' },
    { contentType: 'post', postId: 'p'.repeat(129) },
    { contentType: 'video', postId: 'post-1' },
    { contentType: 'post', postId: 'post-1', commentId: 'comment-1' },
    { contentType: 'comment', postId: 'post-1' },
    {
      contentType: 'comment',
      postId: 'post-1',
      commentId: 'comment-1',
      replyId: 'reply-1',
    },
    {
      contentType: 'reply',
      postId: 'post-1',
      commentId: 'comment-1',
    },
    {
      contentType: 'reply',
      postId: 'post-1',
      commentId: 'comment-1',
      replyId: 'reply-1',
      authorUid: 'spoofed',
    },
  ]) {
    assert.notEqual(reportContentContextIssue(context), null);
    assert.equal(normalizeReportContentContext(context), null);
  }
});

test('normalizes validated content context without client-authored evidence', () => {
  assert.deepEqual(
    normalizeReportContentContext({
      contentType: 'reply',
      postId: 'post-1',
      commentId: 'comment-1',
      replyId: 'reply-1',
    }),
    {
      contentType: 'reply',
      postId: 'post-1',
      commentId: 'comment-1',
      replyId: 'reply-1',
    }
  );
});

test('content evidence is minimal and body length is bounded', () => {
  const evidence = buildReportContentEvidence({
    authorUid: 'bob',
    content: 'x'.repeat(maxReportEvidenceBodyLength + 10),
    createdAt: { seconds: 123 },
    authorName: 'must not be copied',
    authorPhotoUrl: 'must not be copied',
  });

  assert.equal(reportEvidenceVersion, 1);
  assert.deepEqual(Object.keys(evidence).sort(), [
    'authorUid',
    'body',
    'bodyTruncated',
    'createdAt',
  ]);
  assert.equal(evidence.authorUid, 'bob');
  assert.equal(evidence.body.length, maxReportEvidenceBodyLength);
  assert.equal(evidence.bodyTruncated, true);
  assert.deepEqual(evidence.createdAt, { seconds: 123 });
});

test('content evidence requires every parent and the selected author', () => {
  const activeDocuments = [
    { exists: true, deleted: false },
    { exists: true, deleted: false },
    { exists: true, deleted: false },
  ];
  assert.equal(
    reportContentStateIssue({
      expectedDocumentCount: 3,
      documentStates: activeDocuments,
      authorUid: 'bob',
      targetUid: 'bob',
    }),
    null
  );
  assert.equal(
    reportContentStateIssue({
      expectedDocumentCount: 3,
      documentStates: activeDocuments.slice(1),
      authorUid: 'bob',
      targetUid: 'bob',
    }),
    'content-unavailable'
  );
  assert.equal(
    reportContentStateIssue({
      expectedDocumentCount: 3,
      documentStates: [
        activeDocuments[0],
        { exists: true, deleted: true },
        activeDocuments[2],
      ],
      authorUid: 'bob',
      targetUid: 'bob',
    }),
    'content-unavailable'
  );
  assert.equal(
    reportContentStateIssue({
      expectedDocumentCount: 3,
      documentStates: activeDocuments,
      authorUid: 'mallory',
      targetUid: 'bob',
    }),
    'author-mismatch'
  );
});
