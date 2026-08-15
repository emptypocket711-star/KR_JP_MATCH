import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { activeAccountIssue, isAccountDeletedOrDeleting } from './callablePolicy';
import { normalizeDirectRoomParticipants } from './directRoomMigrationPolicy';

export const DIRECT_ROOM_REMEDIATION_POLICY_VERSION =
  'direct-room-remediation-v1.2.0';
export const DIRECT_ROOM_REMEDIATION_MANIFEST_KIND =
  'hana.direct-room-remediation';
export const DIRECT_ROOM_REMEDIATION_MANIFEST_SCHEMA_VERSION = 1;

export type ParticipantAccountState =
  | 'active'
  | 'missing'
  | 'deleted'
  | 'ineligible';

export interface ParticipantAccountAuditRecord {
  uid: string;
  state: ParticipantAccountState;
}

export interface RemediationMatchAuditRecord {
  id: string;
  userIds: unknown;
  isActive: unknown;
  pairKey?: unknown;
  directRoomVersion?: unknown;
  hiddenFor?: unknown;
  closedBy?: unknown;
  closedReason?: unknown;
}

export interface RemediationChatPairAuditRecord {
  id: string;
  userIds: unknown;
  pairKey?: unknown;
  activeMatchId?: unknown;
  closedMatchId?: unknown;
  closedReason?: unknown;
}

export type DirectRoomRemediationFindingCode =
  | 'malformed-active-room'
  | 'ambiguous-active-pair'
  | 'normalized-pair-key-collision'
  | 'close-room-state-conflict'
  | 'close-room-participant-state-conflict'
  | 'close-room-pointer-conflict'
  | 'malformed-stale-pointer'
  | 'stale-pointer-identity-conflict'
  | 'stale-pointer-current-room-conflict'
  | 'stale-pointer-history-conflict'
  | 'stale-pointer-participant-state-conflict'
  | 'stale-pointer-duplicate-claim';

export interface DirectRoomRemediationFinding {
  code: DirectRoomRemediationFindingCode;
  matchId?: string;
  closedMatchId?: string;
  pairKey?: string;
  participantKey?: string;
  pointerId?: string;
}

export interface CloseUnavailableRoomCandidate {
  kind: 'close-unavailable-room';
  matchId: string;
  pairKey: string;
  participantKey: string;
  unavailableUid: string;
  unavailableState: 'missing' | 'deleted';
}

export interface ClearStaleClosedPointerCandidate {
  kind: 'clear-stale-closed-pointer';
  matchId: string;
  closedMatchId: string;
  pairKey: string;
  participantKey: string;
  pointerId: string;
  pointerClosedReason: string | undefined;
  historicalClosedReason: string | undefined;
}

export type DirectRoomRemediationCandidate =
  | CloseUnavailableRoomCandidate
  | ClearStaleClosedPointerCandidate;

export interface DirectRoomRemediationClassification {
  closeUnavailableRooms: CloseUnavailableRoomCandidate[];
  clearStaleClosedPointers: ClearStaleClosedPointerCandidate[];
  findings: DirectRoomRemediationFinding[];
  counts: {
    activeMatches: number;
    chatPairs: number;
    participantAccounts: number;
    referencedClosedMatches: number;
    closeUnavailableRooms: number;
    clearStaleClosedPointers: number;
    findings: number;
  };
}

export function participantAccountState(input: {
  exists: boolean;
  userData: Record<string, unknown> | undefined;
}): ParticipantAccountState {
  if (!input.exists) return 'missing';
  const data = input.userData;
  const status = typeof data?.status === 'string' ? data.status : '';
  if (
    isAccountDeletedOrDeleting(data) ||
    data?.deleted === true ||
    status === 'deleted' ||
    status === 'deactivated'
  ) {
    return 'deleted';
  }
  if (status === 'banned') return 'ineligible';
  return activeAccountIssue(input) === null ? 'active' : 'ineligible';
}

function isSupportedRoomMarker(value: unknown): boolean {
  return value === undefined || value === 1;
}

function isValidHiddenFor(value: unknown, requireEmpty: boolean): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    return false;
  }
  return !requireEmpty || value.length === 0;
}

function normalizedIdentity(record: { userIds: unknown }) {
  return normalizeDirectRoomParticipants(record.userIds);
}

function sameParticipants(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizeDirectRoomParticipants(left);
  const normalizedRight = normalizeDirectRoomParticipants(right);
  return normalizedLeft !== null &&
    normalizedRight !== null &&
    normalizedLeft.participantKey === normalizedRight.participantKey;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isSupportedClosedReason(value: unknown): value is string | undefined {
  return value === undefined || isNonEmptyString(value);
}

function closedReasonPairIsSafeToClear(
  pointerReason: unknown,
  matchReason: unknown
): boolean {
  if (!isSupportedClosedReason(pointerReason) ||
      !isSupportedClosedReason(matchReason)) {
    return false;
  }
  if (pointerReason === undefined) {
    // Legacy active pointers sometimes omitted the reason while the referenced
    // inactive room retained its valid non-empty reason.
    return true;
  }
  return pointerReason === matchReason;
}

function findingKey(finding: DirectRoomRemediationFinding): string {
  return JSON.stringify({
    code: finding.code,
    matchId: finding.matchId ?? '',
    closedMatchId: finding.closedMatchId ?? '',
    pairKey: finding.pairKey ?? '',
    participantKey: finding.participantKey ?? '',
    pointerId: finding.pointerId ?? '',
  });
}

function addFinding(
  findings: DirectRoomRemediationFinding[],
  keys: Set<string>,
  finding: DirectRoomRemediationFinding
): void {
  const key = findingKey(finding);
  if (keys.has(key)) return;
  keys.add(key);
  findings.push(finding);
}

/**
 * Selects only the two reviewed staging repairs. Every other malformed or
 * ambiguous state remains a finding for operator review and is never mutated.
 */
export function classifyDirectRoomRemediation(input: {
  activeMatches: readonly RemediationMatchAuditRecord[];
  chatPairs: readonly RemediationChatPairAuditRecord[];
  participantAccounts: readonly ParticipantAccountAuditRecord[];
  referencedClosedMatches?: readonly RemediationMatchAuditRecord[];
}): DirectRoomRemediationClassification {
  const findings: DirectRoomRemediationFinding[] = [];
  const findingKeys = new Set<string>();
  const accounts = new Map(input.participantAccounts.map((entry) => [
    entry.uid,
    entry.state,
  ]));
  const closedMatches = new Map(
    (input.referencedClosedMatches ?? []).map((match) => [match.id, match])
  );

  const normalizedMatches = input.activeMatches.flatMap((match) => {
    const normalized = normalizedIdentity(match);
    if (normalized === null || match.isActive !== true) {
      addFinding(findings, findingKeys, {
        code: 'malformed-active-room',
        matchId: match.id,
      });
      return [];
    }
    return [{ match, normalized }];
  });

  const matchesByParticipant = new Map<string, typeof normalizedMatches>();
  const participantKeysByPairKey = new Map<string, Set<string>>();
  for (const entry of normalizedMatches) {
    const group = matchesByParticipant.get(entry.normalized.participantKey) ?? [];
    group.push(entry);
    matchesByParticipant.set(entry.normalized.participantKey, group);
    const participantKeys =
      participantKeysByPairKey.get(entry.normalized.pairKey) ?? new Set<string>();
    participantKeys.add(entry.normalized.participantKey);
    participantKeysByPairKey.set(entry.normalized.pairKey, participantKeys);
  }

  const pointersByParticipant = new Map<string, RemediationChatPairAuditRecord[]>();
  const pointersByPairKey = new Map<string, RemediationChatPairAuditRecord[]>();
  const pointersByActiveMatch = new Map<string, RemediationChatPairAuditRecord[]>();
  const pointersByClosedMatch = new Map<string, RemediationChatPairAuditRecord[]>();
  const pointersById = new Map<string, RemediationChatPairAuditRecord>();
  for (const pointer of input.chatPairs) {
    pointersById.set(pointer.id, pointer);
    const normalized = normalizedIdentity(pointer);
    if (normalized !== null) {
      const group = pointersByParticipant.get(normalized.participantKey) ?? [];
      group.push(pointer);
      pointersByParticipant.set(normalized.participantKey, group);
    }
    if (isNonEmptyString(pointer.pairKey)) {
      const group = pointersByPairKey.get(pointer.pairKey) ?? [];
      group.push(pointer);
      pointersByPairKey.set(pointer.pairKey, group);
    }
    if (isNonEmptyString(pointer.activeMatchId)) {
      const group = pointersByActiveMatch.get(pointer.activeMatchId) ?? [];
      group.push(pointer);
      pointersByActiveMatch.set(pointer.activeMatchId, group);
    }
    if (isNonEmptyString(pointer.closedMatchId)) {
      const group = pointersByClosedMatch.get(pointer.closedMatchId) ?? [];
      group.push(pointer);
      pointersByClosedMatch.set(pointer.closedMatchId, group);
    }
  }

  const closeUnavailableRooms: CloseUnavailableRoomCandidate[] = [];
  for (const entry of normalizedMatches) {
    const { match, normalized } = entry;
    const states = normalized.userIds.map((uid) => accounts.get(uid) ?? 'missing');
    const ineligibleIndexes = states.flatMap((state, index) =>
      state === 'ineligible' ? [index] : []
    );
    if (ineligibleIndexes.length > 0) {
      addFinding(findings, findingKeys, {
        code: 'close-room-participant-state-conflict',
        matchId: match.id,
        pairKey: normalized.pairKey,
        participantKey: normalized.participantKey,
      });
      continue;
    }
    const unavailableIndexes = states.flatMap((state, index) =>
      state === 'missing' || state === 'deleted' ? [index] : []
    );
    const activeIndexes = states.flatMap((state, index) =>
      state === 'active' ? [index] : []
    );
    if (unavailableIndexes.length === 0) continue;
    if (unavailableIndexes.length !== 1 || activeIndexes.length !== 1) {
      addFinding(findings, findingKeys, {
        code: 'close-room-participant-state-conflict',
        matchId: match.id,
        pairKey: normalized.pairKey,
        participantKey: normalized.participantKey,
      });
      continue;
    }

    let safe = true;
    if ((matchesByParticipant.get(normalized.participantKey)?.length ?? 0) !== 1) {
      safe = false;
      addFinding(findings, findingKeys, {
        code: 'ambiguous-active-pair',
        matchId: match.id,
        pairKey: normalized.pairKey,
        participantKey: normalized.participantKey,
      });
    }
    if ((participantKeysByPairKey.get(normalized.pairKey)?.size ?? 0) !== 1) {
      safe = false;
      addFinding(findings, findingKeys, {
        code: 'normalized-pair-key-collision',
        matchId: match.id,
        pairKey: normalized.pairKey,
        participantKey: normalized.participantKey,
      });
    }
    if (
      (match.pairKey !== undefined && match.pairKey !== normalized.pairKey) ||
      !isSupportedRoomMarker(match.directRoomVersion) ||
      !isValidHiddenFor(match.hiddenFor, false)
    ) {
      safe = false;
      addFinding(findings, findingKeys, {
        code: 'close-room-state-conflict',
        matchId: match.id,
        pairKey: normalized.pairKey,
        participantKey: normalized.participantKey,
      });
    }

    const pointerConflict =
      pointersById.has(normalized.pairKey) ||
      (pointersByParticipant.get(normalized.participantKey)?.length ?? 0) > 0 ||
      (pointersByPairKey.get(normalized.pairKey)?.length ?? 0) > 0 ||
      (pointersByActiveMatch.get(match.id)?.length ?? 0) > 0 ||
      (pointersByClosedMatch.get(match.id)?.length ?? 0) > 0;
    if (pointerConflict) {
      safe = false;
      addFinding(findings, findingKeys, {
        code: 'close-room-pointer-conflict',
        matchId: match.id,
        pairKey: normalized.pairKey,
        participantKey: normalized.participantKey,
      });
    }
    if (!safe) continue;

    const unavailableIndex = unavailableIndexes[0];
    closeUnavailableRooms.push({
      kind: 'close-unavailable-room',
      matchId: match.id,
      pairKey: normalized.pairKey,
      participantKey: normalized.participantKey,
      unavailableUid: normalized.userIds[unavailableIndex],
      unavailableState: states[unavailableIndex] as 'missing' | 'deleted',
    });
  }

  const clearStaleClosedPointers: ClearStaleClosedPointerCandidate[] = [];
  for (const pointer of input.chatPairs) {
    const hasActive = isNonEmptyString(pointer.activeMatchId);
    const hasClosed = isNonEmptyString(pointer.closedMatchId);
    if (!hasActive && !hasClosed) continue;
    if (!hasActive || !hasClosed || !isSupportedClosedReason(pointer.closedReason)) {
      // Only a pointer carrying both room IDs is in this remediation scope.
      // A normal active-only or closed-only pointer is intentionally ignored.
      if ((hasActive && pointer.closedMatchId !== undefined) ||
          (hasClosed && pointer.activeMatchId !== undefined)) {
        addFinding(findings, findingKeys, {
          code: 'malformed-stale-pointer',
          pointerId: pointer.id,
        });
      }
      continue;
    }
    const activeMatchId = pointer.activeMatchId as string;
    const closedMatchId = pointer.closedMatchId as string;
    const pointerClosedReason = pointer.closedReason;

    const normalized = normalizedIdentity(pointer);
    if (normalized === null) {
      addFinding(findings, findingKeys, {
        code: 'malformed-stale-pointer',
        pointerId: pointer.id,
      });
      continue;
    }

    let safe = true;
    if (
      pointer.id !== normalized.pairKey ||
      pointer.pairKey !== normalized.pairKey ||
      activeMatchId === closedMatchId ||
      (participantKeysByPairKey.get(normalized.pairKey)?.size ?? 0) !== 1
    ) {
      safe = false;
      addFinding(findings, findingKeys, {
        code: 'stale-pointer-identity-conflict',
        matchId: activeMatchId,
        closedMatchId,
        pairKey: normalized.pairKey,
        participantKey: normalized.participantKey,
        pointerId: pointer.id,
      });
    }

    const activeGroup = matchesByParticipant.get(normalized.participantKey) ?? [];
    const activeMatch = activeGroup.length === 1
      ? activeGroup[0].match
      : undefined;
    if (
      activeMatch === undefined ||
      activeMatch.id !== activeMatchId ||
      activeMatch.pairKey !== undefined && activeMatch.pairKey !== normalized.pairKey ||
      !isSupportedRoomMarker(activeMatch.directRoomVersion) ||
      !isValidHiddenFor(activeMatch.hiddenFor, true)
    ) {
      safe = false;
      addFinding(findings, findingKeys, {
        code: 'stale-pointer-current-room-conflict',
        matchId: activeMatchId,
        pairKey: normalized.pairKey,
        participantKey: normalized.participantKey,
        pointerId: pointer.id,
      });
    }

    const closedMatch = closedMatches.get(closedMatchId);
    if (
      closedMatch === undefined ||
      closedMatch.isActive !== false ||
      !sameParticipants(closedMatch.userIds, normalized.userIds) ||
      closedMatch.pairKey !== normalized.pairKey ||
      !closedReasonPairIsSafeToClear(
        pointerClosedReason,
        closedMatch.closedReason
      )
    ) {
      safe = false;
      addFinding(findings, findingKeys, {
        code: 'stale-pointer-history-conflict',
        matchId: activeMatchId,
        closedMatchId,
        pairKey: normalized.pairKey,
        participantKey: normalized.participantKey,
        pointerId: pointer.id,
      });
    }

    if (normalized.userIds.some((uid) => accounts.get(uid) !== 'active')) {
      safe = false;
      addFinding(findings, findingKeys, {
        code: 'stale-pointer-participant-state-conflict',
        matchId: activeMatchId,
        closedMatchId,
        pairKey: normalized.pairKey,
        participantKey: normalized.participantKey,
        pointerId: pointer.id,
      });
    }

    if (
      (pointersByParticipant.get(normalized.participantKey)?.length ?? 0) !== 1 ||
      (pointersByPairKey.get(normalized.pairKey)?.length ?? 0) !== 1 ||
      (pointersByActiveMatch.get(activeMatchId)?.length ?? 0) !== 1 ||
      (pointersByClosedMatch.get(closedMatchId)?.length ?? 0) !== 1
    ) {
      safe = false;
      addFinding(findings, findingKeys, {
        code: 'stale-pointer-duplicate-claim',
        matchId: activeMatchId,
        closedMatchId,
        pairKey: normalized.pairKey,
        participantKey: normalized.participantKey,
        pointerId: pointer.id,
      });
    }
    if (!safe) continue;

    const historicalClosedReason = closedMatch?.closedReason;
    if (!isSupportedClosedReason(historicalClosedReason)) continue;

    clearStaleClosedPointers.push({
      kind: 'clear-stale-closed-pointer',
      matchId: activeMatchId,
      closedMatchId,
      pairKey: normalized.pairKey,
      participantKey: normalized.participantKey,
      pointerId: pointer.id,
      pointerClosedReason,
      historicalClosedReason,
    });
  }

  closeUnavailableRooms.sort((left, right) =>
    left.pairKey.localeCompare(right.pairKey) ||
    left.matchId.localeCompare(right.matchId)
  );
  clearStaleClosedPointers.sort((left, right) =>
    left.pairKey.localeCompare(right.pairKey) ||
    left.matchId.localeCompare(right.matchId)
  );
  findings.sort((left, right) => findingKey(left).localeCompare(findingKey(right)));

  return {
    closeUnavailableRooms,
    clearStaleClosedPointers,
    findings,
    counts: {
      activeMatches: input.activeMatches.length,
      chatPairs: input.chatPairs.length,
      participantAccounts: input.participantAccounts.length,
      referencedClosedMatches: input.referencedClosedMatches?.length ?? 0,
      closeUnavailableRooms: closeUnavailableRooms.length,
      clearStaleClosedPointers: clearStaleClosedPointers.length,
      findings: findings.length,
    },
  };
}

type IdentifierKind =
  | 'match'
  | 'closed-match'
  | 'pair'
  | 'participant-tuple'
  | 'participant'
  | 'pointer'
  | 'pointer-closed-reason'
  | 'historical-closed-reason';

export interface RemediationIdentifierProtector {
  keyId: string;
  hash: (kind: IdentifierKind, value: string) => string;
}

export function createRemediationIdentifierProtector(
  key: Buffer
): RemediationIdentifierProtector {
  if (key.length < 32) {
    throw new Error('Identifier HMAC key must contain at least 32 bytes');
  }
  return {
    keyId: createHash('sha256').update(key).digest('hex').slice(0, 24),
    hash: (kind, value) => createHmac('sha256', key)
      .update(`hana-direct-room-remediation:${kind}:`)
      .update(value)
      .digest('hex'),
  };
}

export interface CloseUnavailableRoomManifestAction {
  kind: 'close-unavailable-room';
  matchHash: string;
  pairHash: string;
  participantHash: string;
  unavailableParticipantHash: string;
  unavailableState: 'missing' | 'deleted';
  expectedPointerState: 'absent';
}

export interface ClearStaleClosedPointerManifestAction {
  kind: 'clear-stale-closed-pointer';
  matchHash: string;
  closedMatchHash: string;
  pairHash: string;
  participantHash: string;
  pointerHash: string;
  pointerClosedReasonHash: string;
  pointerClosedReasonState: 'absent' | 'present';
  historicalClosedReasonHash: string;
  historicalClosedReasonState: 'absent' | 'present';
  expectedPointerState: 'active-and-closed';
}

export type DirectRoomRemediationManifestAction =
  | CloseUnavailableRoomManifestAction
  | ClearStaleClosedPointerManifestAction;

export interface DirectRoomRemediationManifestFinding {
  code: DirectRoomRemediationFindingCode;
  matchHash?: string;
  closedMatchHash?: string;
  pairHash?: string;
  participantHash?: string;
  pointerHash?: string;
}

export interface DirectRoomRemediationManifestUnsigned {
  schemaVersion: 1;
  kind: typeof DIRECT_ROOM_REMEDIATION_MANIFEST_KIND;
  policyVersion: typeof DIRECT_ROOM_REMEDIATION_POLICY_VERSION;
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
    participantReferencesRequested: number;
    participantDocumentsFound: number;
    closedMatchReferencesRequested: number;
    closedMatchDocumentsFound: number;
  };
  counts: DirectRoomRemediationClassification['counts'];
  findings: DirectRoomRemediationManifestFinding[];
  actions: DirectRoomRemediationManifestAction[];
  auditDigest: string;
}

export interface DirectRoomRemediationManifest
  extends DirectRoomRemediationManifestUnsigned {
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

function sha256(value: JsonValue): string {
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}

export function remediationManifestActionForCandidate(
  candidate: DirectRoomRemediationCandidate,
  protector: RemediationIdentifierProtector
): DirectRoomRemediationManifestAction {
  if (candidate.kind === 'close-unavailable-room') {
    return {
      kind: candidate.kind,
      matchHash: protector.hash('match', candidate.matchId),
      pairHash: protector.hash('pair', candidate.pairKey),
      participantHash: protector.hash('participant-tuple', candidate.participantKey),
      unavailableParticipantHash: protector.hash(
        'participant',
        candidate.unavailableUid
      ),
      unavailableState: candidate.unavailableState,
      expectedPointerState: 'absent',
    };
  }
  return {
    kind: candidate.kind,
    matchHash: protector.hash('match', candidate.matchId),
    closedMatchHash: protector.hash('closed-match', candidate.closedMatchId),
    pairHash: protector.hash('pair', candidate.pairKey),
    participantHash: protector.hash('participant-tuple', candidate.participantKey),
    pointerHash: protector.hash('pointer', candidate.pointerId),
    pointerClosedReasonHash: protector.hash(
      'pointer-closed-reason',
      candidate.pointerClosedReason === undefined
        ? 'state:absent'
        : `state:present:${candidate.pointerClosedReason}`
    ),
    pointerClosedReasonState: candidate.pointerClosedReason === undefined
      ? 'absent'
      : 'present',
    historicalClosedReasonHash: protector.hash(
      'historical-closed-reason',
      candidate.historicalClosedReason === undefined
        ? 'state:absent'
        : `state:present:${candidate.historicalClosedReason}`
    ),
    historicalClosedReasonState: candidate.historicalClosedReason === undefined
      ? 'absent'
      : 'present',
    expectedPointerState: 'active-and-closed',
  };
}

function manifestFinding(
  finding: DirectRoomRemediationFinding,
  protector: RemediationIdentifierProtector
): DirectRoomRemediationManifestFinding {
  return {
    code: finding.code,
    ...(finding.matchId === undefined
      ? {}
      : { matchHash: protector.hash('match', finding.matchId) }),
    ...(finding.closedMatchId === undefined
      ? {}
      : { closedMatchHash: protector.hash('closed-match', finding.closedMatchId) }),
    ...(finding.pairKey === undefined
      ? {}
      : { pairHash: protector.hash('pair', finding.pairKey) }),
    ...(finding.participantKey === undefined
      ? {}
      : {
          participantHash: protector.hash(
            'participant-tuple',
            finding.participantKey
          ),
        }),
    ...(finding.pointerId === undefined
      ? {}
      : { pointerHash: protector.hash('pointer', finding.pointerId) }),
  };
}

function manifestAuditPayload(manifest: {
  scan: DirectRoomRemediationManifestUnsigned['scan'];
  counts: DirectRoomRemediationManifestUnsigned['counts'];
  findings: DirectRoomRemediationManifestUnsigned['findings'];
  actions: DirectRoomRemediationManifestUnsigned['actions'];
}): JsonValue {
  return {
    scan: manifest.scan as unknown as JsonValue,
    counts: manifest.counts as unknown as JsonValue,
    findings: manifest.findings as unknown as JsonValue,
    actions: manifest.actions as unknown as JsonValue,
  };
}

export function buildDirectRoomRemediationManifest(params: {
  projectId: string;
  createdAt: Date;
  pageSize: number;
  maxDocumentsPerCollection: number;
  scanComplete: boolean;
  participantReferencesRequested: number;
  participantDocumentsFound: number;
  closedMatchReferencesRequested: number;
  closedMatchDocumentsFound: number;
  classification: DirectRoomRemediationClassification;
  protector: RemediationIdentifierProtector;
}): DirectRoomRemediationManifest {
  const actions = params.scanComplete
    ? [
        ...params.classification.closeUnavailableRooms,
        ...params.classification.clearStaleClosedPointers,
      ].map((candidate) => remediationManifestActionForCandidate(
        candidate,
        params.protector
      )).sort((left, right) => actionKey(left).localeCompare(actionKey(right)))
    : [];
  const findings = params.classification.findings
    .map((finding) => manifestFinding(finding, params.protector))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const scan: DirectRoomRemediationManifestUnsigned['scan'] = {
    complete: params.scanComplete,
    pageSize: params.pageSize,
    maxDocumentsPerCollection: params.maxDocumentsPerCollection,
    activeMatchDocuments: params.classification.counts.activeMatches,
    chatPairDocuments: params.classification.counts.chatPairs,
    participantReferencesRequested: params.participantReferencesRequested,
    participantDocumentsFound: params.participantDocumentsFound,
    closedMatchReferencesRequested: params.closedMatchReferencesRequested,
    closedMatchDocumentsFound: params.closedMatchDocumentsFound,
  };
  const auditDigest = sha256(manifestAuditPayload({
    scan,
    counts: params.classification.counts,
    findings,
    actions,
  }));
  const unsigned: DirectRoomRemediationManifestUnsigned = {
    schemaVersion: DIRECT_ROOM_REMEDIATION_MANIFEST_SCHEMA_VERSION,
    kind: DIRECT_ROOM_REMEDIATION_MANIFEST_KIND,
    policyVersion: DIRECT_ROOM_REMEDIATION_POLICY_VERSION,
    projectId: params.projectId,
    createdAt: params.createdAt.toISOString(),
    identifierProtection: {
      algorithm: 'hmac-sha256',
      keyId: params.protector.keyId,
    },
    scan,
    counts: params.classification.counts,
    findings,
    actions,
    auditDigest,
  };
  return { ...unsigned, digest: sha256(unsigned as unknown as JsonValue) };
}

export function actionKey(action: DirectRoomRemediationManifestAction): string {
  return action.kind === 'close-unavailable-room'
    ? [
        action.kind,
        action.matchHash,
        action.pairHash,
        action.participantHash,
        action.unavailableParticipantHash,
        action.unavailableState,
      ].join(':')
    : [
        action.kind,
        action.matchHash,
        action.closedMatchHash,
        action.pairHash,
        action.participantHash,
        action.pointerHash,
        action.pointerClosedReasonHash,
        action.pointerClosedReasonState,
        action.historicalClosedReasonHash,
        action.historicalClosedReasonState,
      ].join(':');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isDigest(value: unknown, length = 64): value is string {
  return typeof value === 'string' &&
    new RegExp(`^[a-f0-9]{${length}}$`).test(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validAction(value: unknown): value is DirectRoomRemediationManifestAction {
  if (!isRecord(value)) return false;
  if (
    !isDigest(value.matchHash) ||
    !isDigest(value.pairHash) ||
    !isDigest(value.participantHash)
  ) return false;
  if (value.kind === 'close-unavailable-room') {
    return isDigest(value.unavailableParticipantHash) &&
      (value.unavailableState === 'missing' || value.unavailableState === 'deleted') &&
      value.expectedPointerState === 'absent';
  }
  if (value.kind === 'clear-stale-closed-pointer') {
    return isDigest(value.closedMatchHash) &&
      isDigest(value.pointerHash) &&
      isDigest(value.pointerClosedReasonHash) &&
      (value.pointerClosedReasonState === 'absent' ||
        value.pointerClosedReasonState === 'present') &&
      isDigest(value.historicalClosedReasonHash) &&
      (value.historicalClosedReasonState === 'absent' ||
        value.historicalClosedReasonState === 'present') &&
      value.expectedPointerState === 'active-and-closed';
  }
  return false;
}

export function unsignedDirectRoomRemediationManifest(
  manifest: DirectRoomRemediationManifest
): DirectRoomRemediationManifestUnsigned {
  const { digest: _digest, ...unsigned } = manifest;
  return unsigned;
}

export function verifyDirectRoomRemediationManifest(
  value: unknown
): value is DirectRoomRemediationManifest {
  if (!isRecord(value)) return false;
  const manifest = value as unknown as DirectRoomRemediationManifest;
  if (
    manifest.schemaVersion !== DIRECT_ROOM_REMEDIATION_MANIFEST_SCHEMA_VERSION ||
    manifest.kind !== DIRECT_ROOM_REMEDIATION_MANIFEST_KIND ||
    manifest.policyVersion !== DIRECT_ROOM_REMEDIATION_POLICY_VERSION ||
    typeof manifest.projectId !== 'string' || manifest.projectId.length === 0 ||
    typeof manifest.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(manifest.createdAt)) ||
    !isRecord(manifest.identifierProtection) ||
    manifest.identifierProtection.algorithm !== 'hmac-sha256' ||
    !isDigest(manifest.identifierProtection.keyId, 24) ||
    !isRecord(manifest.scan) ||
    typeof manifest.scan.complete !== 'boolean' ||
    !nonNegativeInteger(manifest.scan.pageSize) ||
    !nonNegativeInteger(manifest.scan.maxDocumentsPerCollection) ||
    !nonNegativeInteger(manifest.scan.activeMatchDocuments) ||
    !nonNegativeInteger(manifest.scan.chatPairDocuments) ||
    !nonNegativeInteger(manifest.scan.participantReferencesRequested) ||
    !nonNegativeInteger(manifest.scan.participantDocumentsFound) ||
    manifest.scan.participantDocumentsFound >
      manifest.scan.participantReferencesRequested ||
    !nonNegativeInteger(manifest.scan.closedMatchReferencesRequested) ||
    !nonNegativeInteger(manifest.scan.closedMatchDocumentsFound) ||
    manifest.scan.closedMatchDocumentsFound >
      manifest.scan.closedMatchReferencesRequested ||
    !isRecord(manifest.counts) ||
    !Object.values(manifest.counts).every(nonNegativeInteger) ||
    !Array.isArray(manifest.findings) ||
    !Array.isArray(manifest.actions) ||
    !manifest.actions.every(validAction) ||
    !isDigest(manifest.auditDigest) ||
    !isDigest(manifest.digest) ||
    (!manifest.scan.complete && manifest.actions.length !== 0) ||
    new Set(manifest.actions.map(actionKey)).size !== manifest.actions.length
  ) return false;

  try {
    const expectedAuditDigest = sha256(manifestAuditPayload(manifest));
    const expectedDigest = sha256(
      unsignedDirectRoomRemediationManifest(manifest) as unknown as JsonValue
    );
    const auditExpected = Buffer.from(expectedAuditDigest, 'hex');
    const auditActual = Buffer.from(manifest.auditDigest, 'hex');
    const digestExpected = Buffer.from(expectedDigest, 'hex');
    const digestActual = Buffer.from(manifest.digest, 'hex');
    return auditExpected.length === auditActual.length &&
      timingSafeEqual(auditExpected, auditActual) &&
      digestExpected.length === digestActual.length &&
      timingSafeEqual(digestExpected, digestActual);
  } catch {
    return false;
  }
}
