import { createHash, timingSafeEqual } from 'node:crypto';

import {
  StaleReferenceKind,
  isExternalNonFirstPartyHttpsPhotoUrl,
  isSafeDocumentPathForReference,
  isSafeFieldPathForReference,
  isSafeUid,
  knownHanaStorageBucket,
} from './staleProfileMediaReferencePolicy';

export const staleProfileMediaManifestKind =
  'hana.stale-profile-media-reference-remediation';
export const staleProfileMediaManifestSchemaVersion = 1;
export const staleProfileMediaPolicyVersion = '2026-08-13.1';

export type StaleProfileMediaFindingCode =
  | 'scan-incomplete'
  | 'malformed-reference-schema'
  | 'legacy-current-photo-requires-trusted-reupload'
  | 'invalid-current-photo-state'
  | 'current-photo-reference-needs-path-migration'
  | 'missing-user-auth-record-still-exists'
  | 'orphan-post-not-external';

export interface StaleProfileMediaFinding {
  code: StaleProfileMediaFindingCode;
  location: string;
}

export type OwnerExpectation =
  | {
    kind: 'existing-no-current-photo';
    photoUrlsState: 'absent' | 'null' | 'empty-array';
  }
  | {
    kind: 'missing-user-and-auth';
  };

export interface ClearStaleProfileMediaReferenceAction {
  actionType: 'clear-reference';
  referenceKind: StaleReferenceKind;
  documentPath: string;
  fieldPath: string;
  ownerUid: string;
  expectedValue: string;
  ownerExpectation: OwnerExpectation;
}

export interface DeleteOrphanPostTreeAction {
  actionType: 'delete-orphan-post-tree';
  documentPath: string;
  ownerUid: string;
  expectedAuthorPhotoUrl: string;
  ownerExpectation: { kind: 'missing-user-and-auth' };
}

export type StaleProfileMediaAction =
  | ClearStaleProfileMediaReferenceAction
  | DeleteOrphanPostTreeAction;

export interface StaleProfileMediaScanCounts {
  users: number;
  posts: number;
  comments: number;
  replies: number;
  blocks: number;
  matches: number;
  referencedOwners: number;
  missingOwnersCheckedInAuth: number;
  missingOwnersConfirmed: number;
  authRecordsFoundWithoutUser: number;
  deferredFirstPartyReferences: number;
}

export interface StaleProfileMediaManifestUnsigned {
  schemaVersion: 1;
  kind: typeof staleProfileMediaManifestKind;
  policyVersion: typeof staleProfileMediaPolicyVersion;
  projectId: string;
  bucket: string;
  createdAt: string;
  scan: {
    complete: boolean;
    pageSize: number;
    maxDocumentsPerSource: number;
    counts: StaleProfileMediaScanCounts;
  };
  counts: {
    findings: number;
    actions: number;
    clearReferences: number;
    deleteOrphanPostTrees: number;
  };
  findings: StaleProfileMediaFinding[];
  actions: StaleProfileMediaAction[];
}

export interface StaleProfileMediaManifest
  extends StaleProfileMediaManifestUnsigned {
  digest: string;
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function canonicalize(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalize(child)}`)
    .join(',')}}`;
}

export function staleProfileMediaManifestDigest(
  value: StaleProfileMediaManifestUnsigned
): string {
  return createHash('sha256')
    .update(canonicalize(value as unknown as JsonValue))
    .digest('hex');
}

export function unsignedStaleProfileMediaManifest(
  manifest: StaleProfileMediaManifest
): StaleProfileMediaManifestUnsigned {
  const { digest: _digest, ...unsigned } = manifest;
  return unsigned;
}

export function staleProfileMediaActionKey(
  action: StaleProfileMediaAction
): string {
  return createHash('sha256')
    .update(canonicalize(action as unknown as JsonValue))
    .digest('hex');
}

function compareFindings(
  left: StaleProfileMediaFinding,
  right: StaleProfileMediaFinding
): number {
  return left.code.localeCompare(right.code) ||
    left.location.localeCompare(right.location);
}

function compareActions(
  left: StaleProfileMediaAction,
  right: StaleProfileMediaAction
): number {
  return staleProfileMediaActionKey(left).localeCompare(
    staleProfileMediaActionKey(right)
  );
}

export function buildStaleProfileMediaManifest(params: {
  projectId: string;
  bucket: string;
  createdAt: Date;
  pageSize: number;
  maxDocumentsPerSource: number;
  scanComplete: boolean;
  scanCounts: StaleProfileMediaScanCounts;
  findings: readonly StaleProfileMediaFinding[];
  actions: readonly StaleProfileMediaAction[];
}): StaleProfileMediaManifest {
  const findings = [...params.findings].sort(compareFindings);
  const actions = params.scanComplete
    ? [...params.actions].sort(compareActions)
    : [];
  const unsigned: StaleProfileMediaManifestUnsigned = {
    schemaVersion: staleProfileMediaManifestSchemaVersion,
    kind: staleProfileMediaManifestKind,
    policyVersion: staleProfileMediaPolicyVersion,
    projectId: params.projectId,
    bucket: params.bucket,
    createdAt: params.createdAt.toISOString(),
    scan: {
      complete: params.scanComplete,
      pageSize: params.pageSize,
      maxDocumentsPerSource: params.maxDocumentsPerSource,
      counts: { ...params.scanCounts },
    },
    counts: {
      findings: findings.length,
      actions: actions.length,
      clearReferences: actions.filter(
        (action) => action.actionType === 'clear-reference'
      ).length,
      deleteOrphanPostTrees: actions.filter(
        (action) => action.actionType === 'delete-orphan-post-tree'
      ).length,
    },
    findings,
    actions,
  };
  return {
    ...unsigned,
    digest: staleProfileMediaManifestDigest(unsigned),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0;
}

function positiveInteger(value: unknown): value is number {
  return nonNegativeInteger(value) && value > 0;
}

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function validOwnerExpectation(value: unknown): value is OwnerExpectation {
  if (!isRecord(value)) return false;
  if (value.kind === 'missing-user-and-auth') {
    return exactKeys(value, ['kind']);
  }
  return value.kind === 'existing-no-current-photo' &&
    exactKeys(value, ['kind', 'photoUrlsState']) &&
    ['absent', 'null', 'empty-array'].includes(String(value.photoUrlsState));
}

function validFinding(value: unknown): value is StaleProfileMediaFinding {
  if (!isRecord(value) || !exactKeys(value, ['code', 'location'])) return false;
  return [
    'scan-incomplete',
    'malformed-reference-schema',
    'legacy-current-photo-requires-trusted-reupload',
    'invalid-current-photo-state',
    'current-photo-reference-needs-path-migration',
    'missing-user-auth-record-still-exists',
    'orphan-post-not-external',
  ].includes(String(value.code)) && boundedString(value.location, 2048);
}

function allowedBucketsForProject(projectId: string): readonly string[] {
  const bucket = knownHanaStorageBucket(projectId);
  return bucket === null ? [] : [bucket];
}

function validAction(
  value: unknown,
  projectId: string
): value is StaleProfileMediaAction {
  if (!isRecord(value)) return false;
  if (value.actionType === 'clear-reference') {
    if (!exactKeys(value, [
      'actionType',
      'referenceKind',
      'documentPath',
      'fieldPath',
      'ownerUid',
      'expectedValue',
      'ownerExpectation',
    ])) return false;
    const kind = value.referenceKind as StaleReferenceKind;
    return [
      'post-author',
      'comment-author',
      'reply-author',
      'block-target',
      'match-photoUrl',
      'match-myPhotoUrl',
      'match-partnerFor-photoUrl',
    ].includes(String(kind)) &&
      typeof value.documentPath === 'string' &&
      isSafeDocumentPathForReference(kind, value.documentPath) &&
      typeof value.fieldPath === 'string' &&
      isSafeFieldPathForReference(kind, value.fieldPath) &&
      isSafeUid(value.ownerUid) &&
      boundedString(value.expectedValue, 2048) &&
      validOwnerExpectation(value.ownerExpectation);
  }
  if (value.actionType === 'delete-orphan-post-tree') {
    return exactKeys(value, [
      'actionType',
      'documentPath',
      'ownerUid',
      'expectedAuthorPhotoUrl',
      'ownerExpectation',
    ]) &&
      typeof value.documentPath === 'string' &&
      isSafeDocumentPathForReference('post-author', value.documentPath) &&
      isSafeUid(value.ownerUid) &&
      isExternalNonFirstPartyHttpsPhotoUrl(
        value.expectedAuthorPhotoUrl,
        allowedBucketsForProject(projectId)
      ) &&
      isRecord(value.ownerExpectation) &&
      exactKeys(value.ownerExpectation, ['kind']) &&
      value.ownerExpectation.kind === 'missing-user-and-auth';
  }
  return false;
}

function validScanCounts(value: unknown): value is StaleProfileMediaScanCounts {
  if (!isRecord(value) || !exactKeys(value, [
    'users',
    'posts',
    'comments',
    'replies',
    'blocks',
    'matches',
    'referencedOwners',
    'missingOwnersCheckedInAuth',
    'missingOwnersConfirmed',
    'authRecordsFoundWithoutUser',
    'deferredFirstPartyReferences',
  ])) return false;
  return Object.values(value).every(nonNegativeInteger);
}

export function verifyStaleProfileMediaManifest(
  value: unknown
): value is StaleProfileMediaManifest {
  if (!isRecord(value) || !exactKeys(value, [
    'schemaVersion',
    'kind',
    'policyVersion',
    'projectId',
    'bucket',
    'createdAt',
    'scan',
    'counts',
    'findings',
    'actions',
    'digest',
  ])) return false;
  const manifest = value as unknown as StaleProfileMediaManifest;
  if (
    manifest.schemaVersion !== staleProfileMediaManifestSchemaVersion ||
    manifest.kind !== staleProfileMediaManifestKind ||
    manifest.policyVersion !== staleProfileMediaPolicyVersion ||
    !boundedString(manifest.projectId, 128) ||
    manifest.bucket !== knownHanaStorageBucket(manifest.projectId) ||
    !boundedString(manifest.createdAt, 64) ||
    !Number.isFinite(Date.parse(manifest.createdAt)) ||
    !isRecord(manifest.scan) ||
    !exactKeys(manifest.scan as unknown as Record<string, unknown>, [
      'complete', 'pageSize', 'maxDocumentsPerSource', 'counts',
    ]) ||
    typeof manifest.scan.complete !== 'boolean' ||
    !positiveInteger(manifest.scan.pageSize) ||
    !positiveInteger(manifest.scan.maxDocumentsPerSource) ||
    !validScanCounts(manifest.scan.counts) ||
    !isRecord(manifest.counts) ||
    !exactKeys(manifest.counts as unknown as Record<string, unknown>, [
      'findings', 'actions', 'clearReferences', 'deleteOrphanPostTrees',
    ]) ||
    !Object.values(manifest.counts).every(nonNegativeInteger) ||
    !Array.isArray(manifest.findings) ||
    !manifest.findings.every(validFinding) ||
    !Array.isArray(manifest.actions) ||
    !manifest.actions.every((action) => validAction(action, manifest.projectId)) ||
    typeof manifest.digest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(manifest.digest)
  ) return false;

  if (!manifest.scan.complete && manifest.actions.length !== 0) return false;
  if (
    manifest.scan.counts.missingOwnersConfirmed +
      manifest.scan.counts.authRecordsFoundWithoutUser !==
        manifest.scan.counts.missingOwnersCheckedInAuth ||
    manifest.scan.counts.missingOwnersCheckedInAuth >
      manifest.scan.counts.referencedOwners
  ) return false;
  if (
    manifest.counts.findings !== manifest.findings.length ||
    manifest.counts.actions !== manifest.actions.length ||
    manifest.counts.clearReferences !== manifest.actions.filter(
      (action) => action.actionType === 'clear-reference'
    ).length ||
    manifest.counts.deleteOrphanPostTrees !== manifest.actions.filter(
      (action) => action.actionType === 'delete-orphan-post-tree'
    ).length
  ) return false;

  const actionKeys = manifest.actions.map(staleProfileMediaActionKey);
  if (new Set(actionKeys).size !== actionKeys.length) return false;
  const referenceFieldKeys = manifest.actions
    .filter((action) => action.actionType === 'clear-reference')
    .map((action) => `${action.documentPath}\u0000${action.fieldPath}`);
  if (new Set(referenceFieldKeys).size !== referenceFieldKeys.length) return false;
  const deletePaths = manifest.actions
    .filter((action) => action.actionType === 'delete-orphan-post-tree')
    .map((action) => action.documentPath);
  if (
    new Set(deletePaths).size !== deletePaths.length ||
    manifest.actions.some((action) =>
      action.actionType === 'clear-reference' &&
      deletePaths.some((postPath) =>
        action.documentPath === postPath ||
        action.documentPath.startsWith(`${postPath}/`)
      )
    )
  ) return false;
  if (manifest.findings.some((finding, index, values) =>
    index > 0 && compareFindings(values[index - 1], finding) > 0
  )) return false;
  if (manifest.actions.some((action, index, values) =>
    index > 0 && compareActions(values[index - 1], action) > 0
  )) return false;

  const computed = staleProfileMediaManifestDigest(
    unsignedStaleProfileMediaManifest(manifest)
  );
  const actualBuffer = Buffer.from(manifest.digest, 'hex');
  const computedBuffer = Buffer.from(computed, 'hex');
  return actualBuffer.length === computedBuffer.length &&
    timingSafeEqual(actualBuffer, computedBuffer);
}
