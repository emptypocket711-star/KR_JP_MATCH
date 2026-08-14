import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import {
  DIRECT_ROOM_MIGRATION_POLICY_VERSION,
  DirectRoomCandidate,
  DirectRoomClassification,
  DirectRoomFinding,
} from './directRoomMigrationPolicy';

export const DIRECT_ROOM_MANIFEST_KIND = 'hana.direct-room-v1-backfill';
export const DIRECT_ROOM_MANIFEST_SCHEMA_VERSION = 2;

export interface DirectRoomManifestAction {
  matchHash: string;
  pairHash: string;
  participantHash: string;
  pointerHash: string;
  expectedMarker: 'absent';
}

export interface DirectRoomManifestFinding {
  code: DirectRoomFinding['code'];
  matchHash?: string;
  matchHashes?: string[];
  pairHash?: string;
  pointerHash?: string;
}

export interface DirectRoomManifestUnsigned {
  schemaVersion: 2;
  kind: typeof DIRECT_ROOM_MANIFEST_KIND;
  policyVersion: string;
  projectId: string;
  createdAt: string;
  identifierProtection: {
    algorithm: 'hmac-sha256';
    keyId: string;
  };
  scan: {
    complete: boolean;
    pageSize: number;
    maxDocumentsPerCollection: number;
    activeMatchDocuments: number;
    chatPairDocuments: number;
    closedMatchReferencesRequested: number;
    closedMatchDocumentsFound: number;
  };
  counts: DirectRoomClassification['counts'];
  findings: DirectRoomManifestFinding[];
  actions: DirectRoomManifestAction[];
}

export interface DirectRoomManifest extends DirectRoomManifestUnsigned {
  digest: string;
}

export type IdentifierKind =
  | 'match'
  | 'pair'
  | 'participant-tuple'
  | 'pointer';

export interface IdentifierProtector {
  keyId: string;
  hash: (kind: IdentifierKind, value: string) => string;
}

export function createIdentifierProtector(key: Buffer): IdentifierProtector {
  if (key.length < 32) {
    throw new Error('Identifier HMAC key must contain at least 32 bytes');
  }

  const keyId = createHash('sha256').update(key).digest('hex').slice(0, 24);
  return {
    keyId,
    hash: (kind, value) =>
      createHmac('sha256', key)
        .update(`hana-direct-room:${kind}:`)
        .update(value)
        .digest('hex'),
  };
}

export function directRoomManifestActionForCandidate(
  candidate: DirectRoomCandidate,
  protector: IdentifierProtector
): DirectRoomManifestAction {
  return {
    matchHash: protector.hash('match', candidate.matchId),
    pairHash: protector.hash('pair', candidate.pairKey),
    participantHash: protector.hash(
      'participant-tuple',
      candidate.participantKey
    ),
    pointerHash: protector.hash('pointer', candidate.pointerId),
    expectedMarker: 'absent',
  };
}

function hashFinding(
  finding: DirectRoomFinding,
  protector: IdentifierProtector
): DirectRoomManifestFinding {
  return {
    code: finding.code,
    ...(finding.matchId === undefined
      ? {}
      : { matchHash: protector.hash('match', finding.matchId) }),
    ...(finding.matchIds === undefined
      ? {}
      : {
          matchHashes: finding.matchIds
            .map((id) => protector.hash('match', id))
            .sort(),
        }),
    ...(finding.pairKey === undefined
      ? {}
      : { pairHash: protector.hash('pair', finding.pairKey) }),
    ...(finding.pointerId === undefined
      ? {}
      : { pointerHash: protector.hash('pointer', finding.pointerId) }),
  };
}

function compareActions(
  left: DirectRoomManifestAction,
  right: DirectRoomManifestAction
): number {
  return (
    left.pairHash.localeCompare(right.pairHash) ||
    left.matchHash.localeCompare(right.matchHash)
  );
}

function compareFindings(
  left: DirectRoomManifestFinding,
  right: DirectRoomManifestFinding
): number {
  return (
    left.code.localeCompare(right.code) ||
    (left.pairHash ?? '').localeCompare(right.pairHash ?? '') ||
    (left.matchHash ?? '').localeCompare(right.matchHash ?? '') ||
    (left.pointerHash ?? '').localeCompare(right.pointerHash ?? '')
  );
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

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

export function computeDirectRoomManifestDigest(
  manifest: DirectRoomManifestUnsigned
): string {
  return createHash('sha256')
    .update(canonicalize(manifest as unknown as JsonValue))
    .digest('hex');
}

export function buildDirectRoomManifest(params: {
  projectId: string;
  createdAt: Date;
  pageSize: number;
  maxDocumentsPerCollection: number;
  scanComplete: boolean;
  classification: DirectRoomClassification;
  protector: IdentifierProtector;
}): DirectRoomManifest {
  const unsigned: DirectRoomManifestUnsigned = {
    schemaVersion: DIRECT_ROOM_MANIFEST_SCHEMA_VERSION,
    kind: DIRECT_ROOM_MANIFEST_KIND,
    policyVersion: DIRECT_ROOM_MIGRATION_POLICY_VERSION,
    projectId: params.projectId,
    createdAt: params.createdAt.toISOString(),
    identifierProtection: {
      algorithm: 'hmac-sha256',
      keyId: params.protector.keyId,
    },
    scan: {
      complete: params.scanComplete,
      pageSize: params.pageSize,
      maxDocumentsPerCollection: params.maxDocumentsPerCollection,
      activeMatchDocuments: params.classification.counts.activeMatches,
      chatPairDocuments: params.classification.counts.chatPairs,
      closedMatchReferencesRequested:
        params.classification.counts.closedMatchReferencesRequested,
      closedMatchDocumentsFound:
        params.classification.counts.closedMatchDocumentsFound,
    },
    counts: params.classification.counts,
    findings: params.classification.findings
      .map((finding) => hashFinding(finding, params.protector))
      .sort(compareFindings),
    actions: params.scanComplete
      ? params.classification.candidates
          .map((candidate) =>
            directRoomManifestActionForCandidate(candidate, params.protector)
          )
          .sort(compareActions)
      : [],
  };

  return {
    ...unsigned,
    digest: computeDirectRoomManifestDigest(unsigned),
  };
}

export function unsignedDirectRoomManifest(
  manifest: DirectRoomManifest
): DirectRoomManifestUnsigned {
  const { digest: _digest, ...unsigned } = manifest;
  return unsigned;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isHexDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isManifestAction(value: unknown): value is DirectRoomManifestAction {
  return (
    isRecord(value) &&
    isHexDigest(value.matchHash) &&
    isHexDigest(value.pairHash) &&
    isHexDigest(value.participantHash) &&
    isHexDigest(value.pointerHash) &&
    value.expectedMarker === 'absent'
  );
}

export function verifyDirectRoomManifest(
  value: unknown
): value is DirectRoomManifest {
  if (!isRecord(value)) return false;
  const manifest = value as unknown as DirectRoomManifest;
  if (
    manifest.schemaVersion !== DIRECT_ROOM_MANIFEST_SCHEMA_VERSION ||
    manifest.kind !== DIRECT_ROOM_MANIFEST_KIND ||
    manifest.policyVersion !== DIRECT_ROOM_MIGRATION_POLICY_VERSION ||
    typeof manifest.projectId !== 'string' ||
    manifest.projectId.length === 0 ||
    typeof manifest.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(manifest.createdAt)) ||
    !isRecord(manifest.identifierProtection) ||
    manifest.identifierProtection.algorithm !== 'hmac-sha256' ||
    typeof manifest.identifierProtection.keyId !== 'string' ||
    !/^[a-f0-9]{24}$/.test(manifest.identifierProtection.keyId) ||
    !isRecord(manifest.scan) ||
    manifest.scan.complete !== true && manifest.scan.complete !== false ||
    !isNonNegativeInteger(manifest.scan.activeMatchDocuments) ||
    !isNonNegativeInteger(manifest.scan.chatPairDocuments) ||
    !isNonNegativeInteger(manifest.scan.closedMatchReferencesRequested) ||
    !isNonNegativeInteger(manifest.scan.closedMatchDocumentsFound) ||
    manifest.scan.closedMatchDocumentsFound >
      manifest.scan.closedMatchReferencesRequested ||
    !isRecord(manifest.counts) ||
    !Array.isArray(manifest.findings) ||
    !Array.isArray(manifest.actions) ||
    !manifest.actions.every(isManifestAction) ||
    !isHexDigest(manifest.digest)
  ) {
    return false;
  }

  try {
    const calculated = computeDirectRoomManifestDigest(
      unsignedDirectRoomManifest(manifest)
    );
    const expectedBuffer = Buffer.from(manifest.digest, 'hex');
    const calculatedBuffer = Buffer.from(calculated, 'hex');
    return (
      expectedBuffer.length === calculatedBuffer.length &&
      timingSafeEqual(expectedBuffer, calculatedBuffer)
    );
  } catch {
    return false;
  }
}
