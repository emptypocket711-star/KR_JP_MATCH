const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildPointBalanceAuditManifest,
  classifyPointBalanceAudit,
  pointBalanceAuditManifestDigest,
  pointBalanceAuditMatchesManifest,
  pointBalanceEvidenceIssue,
  pointBalanceTrustVersion,
  unsignedPointBalanceAuditManifest,
  verifyPointBalanceAuditManifest,
} = require('../lib/pointBalanceAuditPolicy');

function user(overrides = {}) {
  return {
    uid: 'alice',
    keyCount: 3,
    pointBalanceTrustVersion: undefined,
    pointBalanceQuarantined: undefined,
    pointBalanceQuarantineReason: undefined,
    updateTime: '100',
    ...overrides,
  };
}

function grant(overrides = {}) {
  return {
    id: 'event-1',
    uid: 'alice',
    eventType: 'grant',
    amount: 3,
    balanceBefore: 0,
    balanceAfter: 3,
    source: 'onboarding_v1',
    migrationMarker: false,
    legacyBalancePreserved: false,
    timestampNanos: '1000',
    updateTime: '101',
    ...overrides,
  };
}

test('trusts only an exact chronological server event chain from zero', () => {
  assert.equal(pointBalanceEvidenceIssue('alice', 3, [grant()]), null);
  assert.equal(
    pointBalanceEvidenceIssue('alice', 2, [
      grant(),
      grant({
        id: 'event-2',
        eventType: 'consume',
        amount: 1,
        balanceBefore: 3,
        balanceAfter: 2,
        source: 'startChat',
        timestampNanos: '2000',
        updateTime: '201',
      }),
    ]),
    null
  );
  assert.equal(
    pointBalanceEvidenceIssue('alice', 8, [
      grant({ balanceBefore: 5, balanceAfter: 8 }),
    ]),
    'event-chain-mismatch'
  );
  assert.equal(
    pointBalanceEvidenceIssue('alice', 3, [
      grant(),
      grant({ id: 'event-2', timestampNanos: '2000' }),
    ]),
    'ambiguous-event-order'
  );
  assert.equal(
    pointBalanceEvidenceIssue('alice', 3, [grant({ uid: 'bob' })]),
    'malformed-event'
  );
});

test('supports only the exact zero-balance onboarding migration marker', () => {
  const marker = grant({
    amount: 0,
    balanceAfter: 0,
    source: 'onboarding_legacy_balance_v1',
    migrationMarker: true,
    legacyBalancePreserved: true,
  });
  assert.equal(pointBalanceEvidenceIssue('alice', 0, [marker]), null);
  assert.equal(
    pointBalanceEvidenceIssue('alice', 0, [
      { ...marker, legacyBalancePreserved: false },
    ]),
    'malformed-event'
  );
});

test('classifies explainable balances for trust and unexplained balances for quarantine', () => {
  const result = classifyPointBalanceAudit({
    users: [
      user(),
      user({
        uid: 'bob',
        keyCount: 9,
        updateTime: '200',
      }),
      user({
        uid: 'carol',
        keyCount: 3,
        pointBalanceTrustVersion,
        updateTime: '300',
      }),
      user({
        uid: 'dana',
        keyCount: 0,
        pointBalanceQuarantined: true,
        pointBalanceQuarantineReason: 'no-server-events',
        updateTime: '400',
      }),
    ],
    pointEvents: [
      grant(),
      grant({ uid: 'carol', id: 'event-carol', updateTime: '301' }),
      grant({ uid: 'deleted', id: 'orphan', updateTime: '999' }),
    ],
  });

  assert.deepEqual(
    result.actions.map(({ uid, action, reason }) => ({ uid, action, reason })),
    [
      { uid: 'alice', action: 'trust', reason: 'server-event-evidence' },
      { uid: 'bob', action: 'quarantine', reason: 'no-server-events' },
    ]
  );
  assert.deepEqual(result.counts, {
    users: 4,
    pointEvents: 3,
    orphanPointEvents: 1,
    healthyTrusted: 1,
    healthyQuarantined: 1,
    trustActions: 1,
    quarantineActions: 1,
  });
});

test('invalid balances are quarantined without coercing their stored value', () => {
  for (const keyCount of [undefined, -1, 1.5, Number.NaN, '3']) {
    const result = classifyPointBalanceAudit({
      users: [user({ keyCount })],
      pointEvents: [],
    });
    assert.equal(result.actions[0].action, 'quarantine');
    assert.equal(result.actions[0].reason, 'invalid-balance');
  }
});

test('manifest is deterministic, tamper-evident, and never applies an incomplete scan', () => {
  const classification = classifyPointBalanceAudit({
    users: [user()],
    pointEvents: [grant()],
  });
  const manifest = buildPointBalanceAuditManifest({
    projectId: 'hana-e2ee6',
    createdAt: new Date('2026-08-15T00:00:00.000Z'),
    complete: true,
    maxUsers: 100,
    maxPointEvents: 1000,
    maxEventsPerUser: 20,
    classification,
  });
  assert.equal(verifyPointBalanceAuditManifest(manifest), true);
  assert.equal(pointBalanceAuditMatchesManifest(manifest, classification), true);

  const tampered = structuredClone(manifest);
  tampered.actions[0].expectedEventCount = 99;
  assert.equal(verifyPointBalanceAuditManifest(tampered), false);

  const injected = structuredClone(manifest);
  injected.unreviewed = true;
  injected.digest = pointBalanceAuditManifestDigest(
    unsignedPointBalanceAuditManifest(injected)
  );
  assert.equal(verifyPointBalanceAuditManifest(injected), false);

  const drifted = classifyPointBalanceAudit({
    users: [user({ updateTime: 'drifted' })],
    pointEvents: [grant()],
  });
  assert.equal(pointBalanceAuditMatchesManifest(manifest, drifted), false);

  const incomplete = buildPointBalanceAuditManifest({
    projectId: 'hana-e2ee6',
    createdAt: new Date('2026-08-15T00:00:00.000Z'),
    complete: false,
    maxUsers: 100,
    maxPointEvents: 1000,
    maxEventsPerUser: 20,
    classification,
  });
  assert.deepEqual(incomplete.actions, []);
  assert.equal(verifyPointBalanceAuditManifest(incomplete), true);
});

test('user or event update-time drift changes the approved action', () => {
  const original = classifyPointBalanceAudit({
    users: [user()],
    pointEvents: [grant()],
  }).actions[0];
  const userDrift = classifyPointBalanceAudit({
    users: [user({ updateTime: 'changed' })],
    pointEvents: [grant()],
  }).actions[0];
  const eventDrift = classifyPointBalanceAudit({
    users: [user()],
    pointEvents: [grant({ updateTime: 'changed' })],
  }).actions[0];
  assert.notEqual(
    original.expectedUserStateDigest,
    userDrift.expectedUserStateDigest
  );
  assert.notEqual(
    original.expectedEvidenceDigest,
    eventDrift.expectedEvidenceDigest
  );
});
