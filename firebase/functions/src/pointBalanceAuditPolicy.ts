import { createHash } from 'node:crypto';

import {
  isValidPointBalance,
  pointBalanceTrustIssue,
  pointBalanceTrustVersion,
} from './pointPolicy';

export const POINT_BALANCE_AUDIT_MANIFEST_KIND =
  'hana.point-balance-trust-audit';
export const POINT_BALANCE_AUDIT_SCHEMA_VERSION = 1;
export const POINT_BALANCE_AUDIT_POLICY_VERSION = 'point-balance-trust-v1';

export interface PointBalanceUserAuditRecord {
  uid: string;
  keyCount: unknown;
  pointBalanceTrustVersion: unknown;
  pointBalanceQuarantined: unknown;
  pointBalanceQuarantineReason: unknown;
  updateTime: string;
}

export interface PointEventAuditRecord {
  id: string;
  uid: unknown;
  eventType: unknown;
  amount: unknown;
  balanceBefore: unknown;
  balanceAfter: unknown;
  source: unknown;
  migrationMarker: unknown;
  legacyBalancePreserved: unknown;
  timestampNanos: string | null;
  updateTime: string;
}

export type PointBalanceQuarantineReason =
  | 'invalid-balance'
  | 'no-server-events'
  | 'malformed-event'
  | 'ambiguous-event-order'
  | 'event-chain-mismatch';

export interface PointBalanceAuditAction {
  uid: string;
  action: 'trust' | 'quarantine';
  reason: 'server-event-evidence' | PointBalanceQuarantineReason;
  expectedUserStateDigest: string;
  expectedEvidenceDigest: string;
  expectedEventCount: number;
}

export interface PointBalanceAuditCounts {
  users: number;
  pointEvents: number;
  orphanPointEvents: number;
  healthyTrusted: number;
  healthyQuarantined: number;
  trustActions: number;
  quarantineActions: number;
}

export interface PointBalanceAuditManifestUnsigned {
  schemaVersion: 1;
  kind: typeof POINT_BALANCE_AUDIT_MANIFEST_KIND;
  policyVersion: typeof POINT_BALANCE_AUDIT_POLICY_VERSION;
  projectId: string;
  createdAt: string;
  scan: {
    complete: boolean;
    maxUsers: number;
    maxPointEvents: number;
    maxEventsPerUser: number;
  };
  counts: PointBalanceAuditCounts;
  actions: PointBalanceAuditAction[];
}

export interface PointBalanceAuditManifest
  extends PointBalanceAuditManifestUnsigned {
  digest: string;
}

export interface PointBalanceAuditClassification {
  counts: PointBalanceAuditCounts;
  actions: PointBalanceAuditAction[];
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function encodedUnknown(value: unknown): JsonValue {
  if (value === undefined) return { type: 'undefined' };
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { type: 'number', value: 'nan' };
    if (value === Infinity) return { type: 'number', value: 'infinity' };
    if (value === -Infinity) {
      return { type: 'number', value: 'negative-infinity' };
    }
    return value;
  }
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(encodedUnknown);
  if (typeof value === 'object') {
    const result: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>
    )) {
      result[key] = encodedUnknown(child);
    }
    return result;
  }
  return { type: typeof value };
}

function canonicalize(value: JsonValue): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return `{${entries
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalize(child)}`)
    .join(',')}}`;
}

function digestValue(value: unknown): string {
  return createHash('sha256')
    .update(canonicalize(encodedUnknown(value)))
    .digest('hex');
}

export function pointBalanceUserStateDigest(
  user: PointBalanceUserAuditRecord
): string {
  return digestValue({
    uid: user.uid,
    keyCount: user.keyCount,
    pointBalanceTrustVersion: user.pointBalanceTrustVersion,
    pointBalanceQuarantined: user.pointBalanceQuarantined,
    pointBalanceQuarantineReason: user.pointBalanceQuarantineReason,
    updateTime: user.updateTime,
  });
}

function sortedEvents(
  events: readonly PointEventAuditRecord[]
): PointEventAuditRecord[] {
  return [...events].sort((left, right) => left.id.localeCompare(right.id));
}

export function pointBalanceEvidenceDigest(
  events: readonly PointEventAuditRecord[]
): string {
  return digestValue(sortedEvents(events));
}

function isPositiveSafeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

function isValidMigrationMarker(event: PointEventAuditRecord): boolean {
  return (
    event.eventType === 'grant' &&
    event.amount === 0 &&
    event.balanceBefore === 0 &&
    event.balanceAfter === 0 &&
    event.source === 'onboarding_legacy_balance_v1' &&
    event.migrationMarker === true &&
    event.legacyBalancePreserved === true
  );
}

function eventRelationIsValid(event: PointEventAuditRecord): boolean {
  if (
    typeof event.uid !== 'string' ||
    event.uid.length === 0 ||
    event.timestampNanos === null ||
    !/^(0|[1-9]\d*)$/.test(event.timestampNanos) ||
    !/^(0|[1-9]\d*)$/.test(event.updateTime) ||
    !isValidPointBalance(event.balanceBefore) ||
    !isValidPointBalance(event.balanceAfter)
  ) {
    return false;
  }
  if (isValidMigrationMarker(event)) return true;
  if (!isPositiveSafeInteger(event.amount)) return false;
  if (event.eventType === 'grant') {
    return event.balanceAfter === event.balanceBefore + event.amount;
  }
  if (event.eventType === 'consume') {
    return event.balanceAfter === event.balanceBefore - event.amount;
  }
  return false;
}

export function pointBalanceEvidenceIssue(
  uid: string,
  currentBalance: unknown,
  events: readonly PointEventAuditRecord[]
): PointBalanceQuarantineReason | null {
  if (!isValidPointBalance(currentBalance)) return 'invalid-balance';
  if (events.length === 0) return 'no-server-events';
  if (
    events.some(
      (event) => event.uid !== uid || !eventRelationIsValid(event)
    )
  ) {
    return 'malformed-event';
  }

  const chronological = [...events].sort((left, right) => {
    const timeOrder =
      BigInt(left.updateTime) < BigInt(right.updateTime)
        ? -1
        : BigInt(left.updateTime) > BigInt(right.updateTime)
          ? 1
          : 0;
    return timeOrder || left.id.localeCompare(right.id);
  });
  for (let index = 1; index < chronological.length; index += 1) {
    if (
      chronological[index - 1].updateTime === chronological[index].updateTime
    ) {
      return 'ambiguous-event-order';
    }
  }

  let expectedBalance = 0;
  for (const event of chronological) {
    if (event.balanceBefore !== expectedBalance) {
      return 'event-chain-mismatch';
    }
    expectedBalance = event.balanceAfter as number;
  }
  return expectedBalance === currentBalance ? null : 'event-chain-mismatch';
}

function actionForUser(params: {
  user: PointBalanceUserAuditRecord;
  events: readonly PointEventAuditRecord[];
}): PointBalanceAuditAction | 'healthy-trusted' | 'healthy-quarantined' {
  const { user, events } = params;
  const evidenceIssue = pointBalanceEvidenceIssue(
    user.uid,
    user.keyCount,
    events
  );
  const stateDigest = pointBalanceUserStateDigest(user);
  const evidenceDigest = pointBalanceEvidenceDigest(events);
  const shared = {
    uid: user.uid,
    expectedUserStateDigest: stateDigest,
    expectedEvidenceDigest: evidenceDigest,
    expectedEventCount: events.length,
  };

  if (evidenceIssue === null) {
    if (
      pointBalanceTrustIssue({
        keyCount: user.keyCount,
        pointBalanceTrustVersion: user.pointBalanceTrustVersion,
        pointBalanceQuarantined: user.pointBalanceQuarantined,
      }) === null
    ) {
      return 'healthy-trusted';
    }
    return {
      ...shared,
      action: 'trust',
      reason: 'server-event-evidence',
    };
  }

  if (
    user.pointBalanceQuarantined === true &&
    user.pointBalanceTrustVersion === undefined &&
    user.pointBalanceQuarantineReason === evidenceIssue
  ) {
    return 'healthy-quarantined';
  }
  return {
    ...shared,
    action: 'quarantine',
    reason: evidenceIssue,
  };
}

export function classifyPointBalanceAudit(params: {
  users: readonly PointBalanceUserAuditRecord[];
  pointEvents: readonly PointEventAuditRecord[];
}): PointBalanceAuditClassification {
  const userIds = new Set(params.users.map((user) => user.uid));
  const eventsByUid = new Map<string, PointEventAuditRecord[]>();
  let orphanPointEvents = 0;
  for (const event of params.pointEvents) {
    if (typeof event.uid !== 'string' || !userIds.has(event.uid)) {
      orphanPointEvents += 1;
      continue;
    }
    const existing = eventsByUid.get(event.uid) ?? [];
    existing.push(event);
    eventsByUid.set(event.uid, existing);
  }

  const actions: PointBalanceAuditAction[] = [];
  let healthyTrusted = 0;
  let healthyQuarantined = 0;
  for (const user of [...params.users].sort((left, right) =>
    left.uid.localeCompare(right.uid)
  )) {
    const result = actionForUser({
      user,
      events: eventsByUid.get(user.uid) ?? [],
    });
    if (result === 'healthy-trusted') healthyTrusted += 1;
    else if (result === 'healthy-quarantined') healthyQuarantined += 1;
    else actions.push(result);
  }

  actions.sort((left, right) => left.uid.localeCompare(right.uid));
  return {
    counts: {
      users: params.users.length,
      pointEvents: params.pointEvents.length,
      orphanPointEvents,
      healthyTrusted,
      healthyQuarantined,
      trustActions: actions.filter((item) => item.action === 'trust').length,
      quarantineActions: actions.filter(
        (item) => item.action === 'quarantine'
      ).length,
    },
    actions,
  };
}

export function pointBalanceAuditManifestDigest(
  manifest: PointBalanceAuditManifestUnsigned
): string {
  return digestValue(manifest);
}

export function buildPointBalanceAuditManifest(params: {
  projectId: string;
  createdAt: Date;
  complete: boolean;
  maxUsers: number;
  maxPointEvents: number;
  maxEventsPerUser: number;
  classification: PointBalanceAuditClassification;
}): PointBalanceAuditManifest {
  const unsigned: PointBalanceAuditManifestUnsigned = {
    schemaVersion: POINT_BALANCE_AUDIT_SCHEMA_VERSION,
    kind: POINT_BALANCE_AUDIT_MANIFEST_KIND,
    policyVersion: POINT_BALANCE_AUDIT_POLICY_VERSION,
    projectId: params.projectId,
    createdAt: params.createdAt.toISOString(),
    scan: {
      complete: params.complete,
      maxUsers: params.maxUsers,
      maxPointEvents: params.maxPointEvents,
      maxEventsPerUser: params.maxEventsPerUser,
    },
    counts: params.classification.counts,
    actions: params.complete ? params.classification.actions : [],
  };
  return {
    ...unsigned,
    digest: pointBalanceAuditManifestDigest(unsigned),
  };
}

export function unsignedPointBalanceAuditManifest(
  manifest: PointBalanceAuditManifest
): PointBalanceAuditManifestUnsigned {
  const { digest: _digest, ...unsigned } = manifest;
  return unsigned;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function isPositiveSafeIntegerValue(value: unknown): value is number {
  return isNonNegativeSafeInteger(value) && value > 0;
}

function isHexDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isAction(value: unknown): value is PointBalanceAuditAction {
  const reasons = new Set<PointBalanceAuditAction['reason']>([
    'server-event-evidence',
    'invalid-balance',
    'no-server-events',
    'malformed-event',
    'ambiguous-event-order',
    'event-chain-mismatch',
  ]);
  const actionAndReasonAgree =
    isRecord(value) &&
    ((value.action === 'trust' && value.reason === 'server-event-evidence') ||
      (value.action === 'quarantine' &&
        value.reason !== 'server-event-evidence'));
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'uid',
      'action',
      'reason',
      'expectedUserStateDigest',
      'expectedEvidenceDigest',
      'expectedEventCount',
    ]) &&
    typeof value.uid === 'string' &&
    value.uid.length > 0 &&
    (value.action === 'trust' || value.action === 'quarantine') &&
    typeof value.reason === 'string' &&
    reasons.has(value.reason as PointBalanceAuditAction['reason']) &&
    actionAndReasonAgree &&
    isHexDigest(value.expectedUserStateDigest) &&
    isHexDigest(value.expectedEvidenceDigest) &&
    isNonNegativeSafeInteger(value.expectedEventCount)
  );
}

export function verifyPointBalanceAuditManifest(
  value: unknown
): value is PointBalanceAuditManifest {
  if (!isRecord(value) || !isRecord(value.scan) || !isRecord(value.counts)) {
    return false;
  }
  if (
    !hasExactKeys(value, [
      'schemaVersion',
      'kind',
      'policyVersion',
      'projectId',
      'createdAt',
      'scan',
      'counts',
      'actions',
      'digest',
    ]) ||
    !hasExactKeys(value.scan, [
      'complete',
      'maxUsers',
      'maxPointEvents',
      'maxEventsPerUser',
    ]) ||
    !hasExactKeys(value.counts, [
      'users',
      'pointEvents',
      'orphanPointEvents',
      'healthyTrusted',
      'healthyQuarantined',
      'trustActions',
      'quarantineActions',
    ])
  ) {
    return false;
  }
  const actions = value.actions;
  if (
    value.schemaVersion !== POINT_BALANCE_AUDIT_SCHEMA_VERSION ||
    value.kind !== POINT_BALANCE_AUDIT_MANIFEST_KIND ||
    value.policyVersion !== POINT_BALANCE_AUDIT_POLICY_VERSION ||
    typeof value.projectId !== 'string' ||
    value.projectId.length === 0 ||
    typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    new Date(value.createdAt).toISOString() !== value.createdAt ||
    typeof value.scan.complete !== 'boolean' ||
    !isPositiveSafeIntegerValue(value.scan.maxUsers) ||
    !isPositiveSafeIntegerValue(value.scan.maxPointEvents) ||
    !isPositiveSafeIntegerValue(value.scan.maxEventsPerUser) ||
    !Array.isArray(actions) ||
    !actions.every(isAction) ||
    !isHexDigest(value.digest)
  ) {
    return false;
  }

  const countKeys: Array<keyof PointBalanceAuditCounts> = [
    'users',
    'pointEvents',
    'orphanPointEvents',
    'healthyTrusted',
    'healthyQuarantined',
    'trustActions',
    'quarantineActions',
  ];
  const counts = value.counts as Record<string, unknown>;
  if (countKeys.some((key) => !isNonNegativeSafeInteger(counts[key]))) {
    return false;
  }
  const typedActions = actions as PointBalanceAuditAction[];
  const typedCounts = counts as unknown as PointBalanceAuditCounts;
  const typedScan = value.scan as PointBalanceAuditManifestUnsigned['scan'];
  const classifiedUserCount =
    typedCounts.healthyTrusted +
    typedCounts.healthyQuarantined +
    typedCounts.trustActions +
    typedCounts.quarantineActions;
  if (
    typedCounts.users !== classifiedUserCount ||
    typedCounts.orphanPointEvents > typedCounts.pointEvents ||
    (typedScan.complete &&
      typedActions.length !==
        typedCounts.trustActions + typedCounts.quarantineActions) ||
    typedActions.some(
      (action, index) =>
        (index > 0 &&
          typedActions[index - 1].uid.localeCompare(action.uid) >= 0) ||
        action.expectedEventCount > typedScan.maxEventsPerUser
    ) ||
    new Set(typedActions.map((action) => action.uid)).size !==
      typedActions.length ||
    (!typedScan.complete && typedActions.length > 0)
  ) {
    return false;
  }

  return (
    pointBalanceAuditManifestDigest(
      unsignedPointBalanceAuditManifest(
        value as unknown as PointBalanceAuditManifest
      )
    ) === value.digest
  );
}

export function pointBalanceAuditActionKey(
  action: PointBalanceAuditAction
): string {
  return digestValue(action);
}

export function pointBalanceAuditMatchesManifest(
  manifest: PointBalanceAuditManifest,
  classification: PointBalanceAuditClassification
): boolean {
  return (
    JSON.stringify(classification.counts) === JSON.stringify(manifest.counts) &&
    classification.actions.length === manifest.actions.length &&
    classification.actions.every(
      (action, index) =>
        pointBalanceAuditActionKey(action) ===
        pointBalanceAuditActionKey(manifest.actions[index])
    )
  );
}

export { pointBalanceTrustVersion };
