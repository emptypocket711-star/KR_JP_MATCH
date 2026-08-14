export const DIRECT_ROOM_MIGRATION_POLICY_VERSION = 'direct-room-v1.1.0';
export const DIRECT_ROOM_VERSION = 1;
export const MAX_PARTICIPANT_ROOM_DOCUMENTS_PER_APPLY = 200;
export const PARTICIPANT_ROOM_QUERY_LIMIT =
  MAX_PARTICIPANT_ROOM_DOCUMENTS_PER_APPLY + 1;

export interface ActiveMatchAuditRecord {
  id: string;
  userIds: unknown;
  pairKey?: unknown;
  directRoomVersion?: unknown;
}

export interface ChatPairAuditRecord {
  id: string;
  userIds: unknown;
  pairKey?: unknown;
  activeMatchId?: unknown;
  closedMatchId?: unknown;
  closedReason?: unknown;
}

export interface ReferencedClosedMatchAuditRecord {
  id: string;
  userIds: unknown;
  pairKey?: unknown;
  isActive?: unknown;
  closedReason?: unknown;
}

export type DirectRoomFindingCode =
  | 'malformed-active-match'
  | 'duplicate-active-pair'
  | 'normalized-pair-key-collision'
  | 'match-pair-key-mismatch'
  | 'unsupported-direct-room-marker'
  | 'missing-chat-pair'
  | 'malformed-chat-pair'
  | 'duplicate-chat-pair'
  | 'multiple-chat-pair-pointers'
  | 'chat-pair-document-id-mismatch'
  | 'chat-pair-pair-key-mismatch'
  | 'chat-pair-participants-mismatch'
  | 'chat-pair-pointer-mismatch'
  | 'orphan-chat-pair'
  | 'chat-pair-both-active-and-closed'
  | 'chat-pair-neither-active-nor-closed'
  | 'chat-pair-closed-match-missing'
  | 'chat-pair-closed-match-state-mismatch'
  | 'chat-pair-closed-match-pair-mismatch'
  | 'chat-pair-closed-reason-mismatch'
  | 'multiple-closed-chat-pair-pointers';

export interface DirectRoomFinding {
  code: DirectRoomFindingCode;
  matchId?: string;
  matchIds?: string[];
  pairKey?: string;
  pointerId?: string;
}

export interface DirectRoomCandidate {
  matchId: string;
  pairKey: string;
  participantKey: string;
  pointerId: string;
}

export interface DirectRoomHealthyRecord extends DirectRoomCandidate {
  directRoomVersion: 1;
}

export interface DirectRoomHealthyClosedPointer {
  closedMatchId: string;
  pairKey: string;
  participantKey: string;
  pointerId: string;
}

export interface DirectRoomClassification {
  candidates: DirectRoomCandidate[];
  healthy: DirectRoomHealthyRecord[];
  healthyClosed: DirectRoomHealthyClosedPointer[];
  findings: DirectRoomFinding[];
  counts: {
    activeMatches: number;
    chatPairs: number;
    closedMatchReferencesRequested: number;
    closedMatchDocumentsFound: number;
    malformedActiveMatches: number;
    validActiveMatches: number;
    candidateBackfills: number;
    healthyRooms: number;
    healthyClosedPointers: number;
    findings: number;
  };
}

interface NormalizedParticipants {
  userIds: [string, string];
  participantKey: string;
  pairKey: string;
}

interface NormalizedMatch extends ActiveMatchAuditRecord {
  normalized: NormalizedParticipants;
}

function isNonEmptyUid(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim().length > 0;
}

/**
 * Uses the same lexical sort and underscore-joined pair document ID as the
 * production chat contract. participantKey remains collision-safe in memory.
 */
export function normalizeDirectRoomParticipants(
  userIds: unknown
): NormalizedParticipants | null {
  if (
    !Array.isArray(userIds) ||
    userIds.length !== 2 ||
    !userIds.every(isNonEmptyUid) ||
    new Set(userIds).size !== 2
  ) {
    return null;
  }

  const sorted = [...userIds].sort() as [string, string];
  return {
    userIds: sorted,
    participantKey: JSON.stringify(sorted),
    pairKey: sorted.join('_'),
  };
}

/**
 * The apply transaction requests one sentinel document beyond the supported
 * bound. Seeing the sentinel proves the participant-room scan is incomplete.
 */
export function participantRoomScanIsComplete(documentCount: number): boolean {
  return (
    Number.isSafeInteger(documentCount) &&
    documentCount >= 0 &&
    documentCount <= MAX_PARTICIPANT_ROOM_DOCUMENTS_PER_APPLY
  );
}

function sameParticipants(
  left: NormalizedParticipants,
  right: NormalizedParticipants
): boolean {
  return left.participantKey === right.participantKey;
}

function closedReasonsAgree(pointerReason: unknown, matchReason: unknown): boolean {
  if (pointerReason === undefined && matchReason === undefined) return true;
  return (
    typeof pointerReason === 'string' &&
    pointerReason.length > 0 &&
    pointerReason === matchReason
  );
}

function addFinding(
  findings: DirectRoomFinding[],
  seen: Set<string>,
  finding: DirectRoomFinding
): void {
  const key = JSON.stringify({
    code: finding.code,
    matchId: finding.matchId ?? '',
    matchIds: [...(finding.matchIds ?? [])].sort(),
    pairKey: finding.pairKey ?? '',
    pointerId: finding.pointerId ?? '',
  });
  if (seen.has(key)) return;
  seen.add(key);
  findings.push(finding);
}

function compareCandidates(
  left: DirectRoomCandidate,
  right: DirectRoomCandidate
): number {
  return (
    left.pairKey.localeCompare(right.pairKey) ||
    left.matchId.localeCompare(right.matchId)
  );
}

/**
 * Pure, fail-closed classification for the directRoomVersion=1 backfill.
 *
 * A missing marker is eligible only when:
 * - the active room has exactly two unique participants;
 * - it is the only valid active room for that exact participant tuple;
 * - its normalized chatPairs document is unambiguous;
 * - that pointer's identity fields match and it points back to this room; and
 * - no conflicting marker or pairKey is present on the room.
 *
 * This policy never proposes repairing duplicate, malformed, or pointer data.
 */
export function classifyDirectRoomMigration(
  activeMatches: readonly ActiveMatchAuditRecord[],
  chatPairs: readonly ChatPairAuditRecord[],
  referencedClosedMatches: readonly ReferencedClosedMatchAuditRecord[] = []
): DirectRoomClassification {
  const findings: DirectRoomFinding[] = [];
  const findingKeys = new Set<string>();
  const malformedMatchIds = new Set<string>();
  const normalizedMatches: NormalizedMatch[] = [];
  const matchesByParticipant = new Map<string, NormalizedMatch[]>();
  const participantKeysByPairKey = new Map<string, Set<string>>();

  for (const match of activeMatches) {
    const normalized = normalizeDirectRoomParticipants(match.userIds);
    if (!match.id || normalized === null) {
      malformedMatchIds.add(match.id);
      addFinding(findings, findingKeys, {
        code: 'malformed-active-match',
        matchId: match.id,
      });
      continue;
    }

    const normalizedMatch: NormalizedMatch = { ...match, normalized };
    normalizedMatches.push(normalizedMatch);

    const group = matchesByParticipant.get(normalized.participantKey) ?? [];
    group.push(normalizedMatch);
    matchesByParticipant.set(normalized.participantKey, group);

    const participants =
      participantKeysByPairKey.get(normalized.pairKey) ?? new Set<string>();
    participants.add(normalized.participantKey);
    participantKeysByPairKey.set(normalized.pairKey, participants);
  }

  const pointersById = new Map<string, ChatPairAuditRecord>();
  const pointersByParticipant = new Map<string, ChatPairAuditRecord[]>();
  const pointersByActiveMatchId = new Map<string, ChatPairAuditRecord[]>();
  const pointersByClosedMatchId = new Map<string, ChatPairAuditRecord[]>();
  const pointersByClaimedPairKey = new Map<string, ChatPairAuditRecord[]>();
  for (const pointer of chatPairs) {
    pointersById.set(pointer.id, pointer);
    const normalized = normalizeDirectRoomParticipants(pointer.userIds);
    if (normalized !== null) {
      const participantPointers =
        pointersByParticipant.get(normalized.participantKey) ?? [];
      participantPointers.push(pointer);
      pointersByParticipant.set(
        normalized.participantKey,
        participantPointers
      );
    }
    if (
      typeof pointer.activeMatchId === 'string' &&
      pointer.activeMatchId.length > 0
    ) {
      const matchPointers = pointersByActiveMatchId.get(pointer.activeMatchId) ?? [];
      matchPointers.push(pointer);
      pointersByActiveMatchId.set(pointer.activeMatchId, matchPointers);
    }
    if (
      typeof pointer.closedMatchId === 'string' &&
      pointer.closedMatchId.length > 0
    ) {
      const matchPointers = pointersByClosedMatchId.get(pointer.closedMatchId) ?? [];
      matchPointers.push(pointer);
      pointersByClosedMatchId.set(pointer.closedMatchId, matchPointers);
    }
    if (typeof pointer.pairKey === 'string' && pointer.pairKey.length > 0) {
      const claimedPointers = pointersByClaimedPairKey.get(pointer.pairKey) ?? [];
      claimedPointers.push(pointer);
      pointersByClaimedPairKey.set(pointer.pairKey, claimedPointers);
    }
  }

  const requestedClosedMatchIds = new Set(
    chatPairs.flatMap((pointer) =>
      typeof pointer.closedMatchId === 'string' &&
      pointer.closedMatchId.length > 0
        ? [pointer.closedMatchId]
        : []
    )
  );
  const closedMatchesById = new Map<string, ReferencedClosedMatchAuditRecord>();
  for (const match of referencedClosedMatches) {
    if (requestedClosedMatchIds.has(match.id) && !closedMatchesById.has(match.id)) {
      closedMatchesById.set(match.id, match);
    }
  }

  const unsafeParticipantKeys = new Set<string>();
  for (const [participantKey, group] of matchesByParticipant) {
    const pairKey = group[0].normalized.pairKey;
    if (group.length > 1) {
      unsafeParticipantKeys.add(participantKey);
      addFinding(findings, findingKeys, {
        code: 'duplicate-active-pair',
        matchIds: group.map((match) => match.id).sort(),
        pairKey,
      });
    }

    if ((participantKeysByPairKey.get(pairKey)?.size ?? 0) > 1) {
      unsafeParticipantKeys.add(participantKey);
      addFinding(findings, findingKeys, {
        code: 'normalized-pair-key-collision',
        matchIds: group.map((match) => match.id).sort(),
        pairKey,
      });
    }
  }

  const candidates: DirectRoomCandidate[] = [];
  const healthy: DirectRoomHealthyRecord[] = [];

  for (const [participantKey, group] of matchesByParticipant) {
    if (group.length !== 1 || unsafeParticipantKeys.has(participantKey)) {
      continue;
    }

    const match = group[0];
    const { normalized } = match;
    let safe = true;

    if (match.pairKey !== undefined && match.pairKey !== normalized.pairKey) {
      safe = false;
      addFinding(findings, findingKeys, {
        code: 'match-pair-key-mismatch',
        matchId: match.id,
        pairKey: normalized.pairKey,
      });
    }

    if (
      match.directRoomVersion !== undefined &&
      match.directRoomVersion !== DIRECT_ROOM_VERSION
    ) {
      safe = false;
      addFinding(findings, findingKeys, {
        code: 'unsupported-direct-room-marker',
        matchId: match.id,
        pairKey: normalized.pairKey,
      });
    }

    const pointer = pointersById.get(normalized.pairKey);
    const participantPointers =
      pointersByParticipant.get(normalized.participantKey) ?? [];
    const claimedPairPointers =
      pointersByClaimedPairKey.get(normalized.pairKey) ?? [];
    if (
      participantPointers.length !== 1 ||
      claimedPairPointers.length !== 1 ||
      claimedPairPointers[0]?.id !== normalized.pairKey
    ) {
      safe = false;
      addFinding(findings, findingKeys, {
        code: 'duplicate-chat-pair',
        matchId: match.id,
        pairKey: normalized.pairKey,
      });
    }

    const roomPointers = pointersByActiveMatchId.get(match.id) ?? [];
    if (roomPointers.length !== 1) {
      safe = false;
      addFinding(findings, findingKeys, {
        code: 'multiple-chat-pair-pointers',
        matchId: match.id,
        pairKey: normalized.pairKey,
      });
    }

    if (pointer === undefined) {
      safe = false;
      addFinding(findings, findingKeys, {
        code: 'missing-chat-pair',
        matchId: match.id,
        pairKey: normalized.pairKey,
      });
    } else {
      if (pointer.closedMatchId !== undefined) {
        safe = false;
        addFinding(findings, findingKeys, {
          code:
            typeof pointer.closedMatchId === 'string' &&
            pointer.closedMatchId.length > 0
              ? 'chat-pair-both-active-and-closed'
              : 'malformed-chat-pair',
          matchId: match.id,
          pairKey: normalized.pairKey,
          pointerId: pointer.id,
        });
      }
      const pointerParticipants = normalizeDirectRoomParticipants(pointer.userIds);
      if (pointerParticipants === null) {
        safe = false;
        addFinding(findings, findingKeys, {
          code: 'malformed-chat-pair',
          matchId: match.id,
          pairKey: normalized.pairKey,
          pointerId: pointer.id,
        });
      } else if (!sameParticipants(normalized, pointerParticipants)) {
        safe = false;
        addFinding(findings, findingKeys, {
          code: 'chat-pair-participants-mismatch',
          matchId: match.id,
          pairKey: normalized.pairKey,
          pointerId: pointer.id,
        });
      }

      if (pointer.id !== normalized.pairKey) {
        safe = false;
        addFinding(findings, findingKeys, {
          code: 'chat-pair-document-id-mismatch',
          matchId: match.id,
          pairKey: normalized.pairKey,
          pointerId: pointer.id,
        });
      }

      if (pointer.pairKey !== normalized.pairKey) {
        safe = false;
        addFinding(findings, findingKeys, {
          code: 'chat-pair-pair-key-mismatch',
          matchId: match.id,
          pairKey: normalized.pairKey,
          pointerId: pointer.id,
        });
      }

      if (pointer.activeMatchId !== match.id) {
        safe = false;
        addFinding(findings, findingKeys, {
          code: 'chat-pair-pointer-mismatch',
          matchId: match.id,
          pairKey: normalized.pairKey,
          pointerId: pointer.id,
        });
      }
    }

    if (!safe) continue;

    const base: DirectRoomCandidate = {
      matchId: match.id,
      pairKey: normalized.pairKey,
      participantKey,
      pointerId: normalized.pairKey,
    };
    if (match.directRoomVersion === DIRECT_ROOM_VERSION) {
      healthy.push({ ...base, directRoomVersion: DIRECT_ROOM_VERSION });
    } else {
      candidates.push(base);
    }
  }

  const healthyClosed: DirectRoomHealthyClosedPointer[] = [];
  for (const pointer of chatPairs) {
    const normalized = normalizeDirectRoomParticipants(pointer.userIds);
    if (normalized === null) {
      addFinding(findings, findingKeys, {
        code: 'malformed-chat-pair',
        pointerId: pointer.id,
      });
      continue;
    }

    let identitySafe = true;
    if (pointer.id !== normalized.pairKey) {
      identitySafe = false;
      addFinding(findings, findingKeys, {
        code: 'chat-pair-document-id-mismatch',
        pairKey: normalized.pairKey,
        pointerId: pointer.id,
      });
    }

    if (pointer.pairKey !== normalized.pairKey) {
      identitySafe = false;
      addFinding(findings, findingKeys, {
        code: 'chat-pair-pair-key-mismatch',
        pairKey: normalized.pairKey,
        pointerId: pointer.id,
      });
    }

    const participantPointers =
      pointersByParticipant.get(normalized.participantKey) ?? [];
    const claimedPairPointers =
      pointersByClaimedPairKey.get(normalized.pairKey) ?? [];
    if (
      participantPointers.length !== 1 ||
      claimedPairPointers.length !== 1 ||
      claimedPairPointers[0]?.id !== normalized.pairKey
    ) {
      identitySafe = false;
      addFinding(findings, findingKeys, {
        code: 'duplicate-chat-pair',
        pairKey: normalized.pairKey,
        pointerId: pointer.id,
      });
    }

    const activeDefined = pointer.activeMatchId !== undefined;
    const closedDefined = pointer.closedMatchId !== undefined;
    const activeMatchId =
      typeof pointer.activeMatchId === 'string' &&
      pointer.activeMatchId.length > 0
        ? pointer.activeMatchId
        : null;
    const closedMatchId =
      typeof pointer.closedMatchId === 'string' &&
      pointer.closedMatchId.length > 0
        ? pointer.closedMatchId
        : null;

    if (
      (activeDefined && activeMatchId === null) ||
      (closedDefined && closedMatchId === null)
    ) {
      addFinding(findings, findingKeys, {
        code: 'malformed-chat-pair',
        pairKey: normalized.pairKey,
        pointerId: pointer.id,
      });
      continue;
    }
    if (activeMatchId !== null && closedMatchId !== null) {
      addFinding(findings, findingKeys, {
        code: 'chat-pair-both-active-and-closed',
        pairKey: normalized.pairKey,
        pointerId: pointer.id,
      });
      continue;
    }
    if (activeMatchId === null && closedMatchId === null) {
      addFinding(findings, findingKeys, {
        code: 'chat-pair-neither-active-nor-closed',
        pairKey: normalized.pairKey,
        pointerId: pointer.id,
      });
      continue;
    }

    const activeGroup =
      matchesByParticipant.get(normalized.participantKey) ?? [];
    if (activeMatchId !== null) {
      if (activeGroup.length === 0) {
        addFinding(findings, findingKeys, {
          code: 'orphan-chat-pair',
          pairKey: normalized.pairKey,
          pointerId: pointer.id,
        });
      }
      if (activeGroup.length !== 1 || activeMatchId !== activeGroup[0]?.id) {
        addFinding(findings, findingKeys, {
          code: 'chat-pair-pointer-mismatch',
          matchIds: activeGroup.map((match) => match.id).sort(),
          pairKey: normalized.pairKey,
          pointerId: pointer.id,
        });
      }
      continue;
    }

    let closedSafe = identitySafe;
    if (activeGroup.length !== 0) {
      closedSafe = false;
      addFinding(findings, findingKeys, {
        code: 'chat-pair-closed-match-state-mismatch',
        matchIds: activeGroup.map((match) => match.id).sort(),
        pairKey: normalized.pairKey,
        pointerId: pointer.id,
      });
    }

    const closedPointers = pointersByClosedMatchId.get(closedMatchId!) ?? [];
    if (closedPointers.length !== 1) {
      closedSafe = false;
      addFinding(findings, findingKeys, {
        code: 'multiple-closed-chat-pair-pointers',
        matchId: closedMatchId!,
        pairKey: normalized.pairKey,
        pointerId: pointer.id,
      });
    }

    const closedMatch = closedMatchesById.get(closedMatchId!);
    if (closedMatch === undefined) {
      closedSafe = false;
      addFinding(findings, findingKeys, {
        code: 'chat-pair-closed-match-missing',
        matchId: closedMatchId!,
        pairKey: normalized.pairKey,
        pointerId: pointer.id,
      });
    } else {
      if (closedMatch.isActive !== false) {
        closedSafe = false;
        addFinding(findings, findingKeys, {
          code: 'chat-pair-closed-match-state-mismatch',
          matchId: closedMatch.id,
          pairKey: normalized.pairKey,
          pointerId: pointer.id,
        });
      }
      const closedParticipants = normalizeDirectRoomParticipants(
        closedMatch.userIds
      );
      if (
        closedParticipants === null ||
        !sameParticipants(normalized, closedParticipants) ||
        closedMatch.pairKey !== normalized.pairKey
      ) {
        closedSafe = false;
        addFinding(findings, findingKeys, {
          code: 'chat-pair-closed-match-pair-mismatch',
          matchId: closedMatch.id,
          pairKey: normalized.pairKey,
          pointerId: pointer.id,
        });
      }
      if (!closedReasonsAgree(pointer.closedReason, closedMatch.closedReason)) {
        closedSafe = false;
        addFinding(findings, findingKeys, {
          code: 'chat-pair-closed-reason-mismatch',
          matchId: closedMatch.id,
          pairKey: normalized.pairKey,
          pointerId: pointer.id,
        });
      }
    }

    if (closedSafe) {
      healthyClosed.push({
        closedMatchId: closedMatchId!,
        pairKey: normalized.pairKey,
        participantKey: normalized.participantKey,
        pointerId: pointer.id,
      });
    }
  }

  candidates.sort(compareCandidates);
  healthy.sort(compareCandidates);
  healthyClosed.sort((left, right) =>
    left.pairKey.localeCompare(right.pairKey) ||
    left.closedMatchId.localeCompare(right.closedMatchId)
  );
  findings.sort((left, right) => {
    return (
      left.code.localeCompare(right.code) ||
      (left.pairKey ?? '').localeCompare(right.pairKey ?? '') ||
      (left.matchId ?? '').localeCompare(right.matchId ?? '') ||
      (left.pointerId ?? '').localeCompare(right.pointerId ?? '')
    );
  });

  return {
    candidates,
    healthy,
    healthyClosed,
    findings,
    counts: {
      activeMatches: activeMatches.length,
      chatPairs: chatPairs.length,
      closedMatchReferencesRequested: requestedClosedMatchIds.size,
      closedMatchDocumentsFound: closedMatchesById.size,
      malformedActiveMatches: malformedMatchIds.size,
      validActiveMatches: normalizedMatches.length,
      candidateBackfills: candidates.length,
      healthyRooms: healthy.length,
      healthyClosedPointers: healthyClosed.length,
      findings: findings.length,
    },
  };
}
