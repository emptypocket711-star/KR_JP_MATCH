export interface StartChatPolicyInput {
  currentPoints: number;
  activePairMatchId?: string;
  activePairMatchValid: boolean;
}

export type StartChatPolicyDecision =
  | {
      action: 'reuse';
      matchId: string;
      pointBalance: number;
      alreadyExists: true;
      source: 'pair';
    }
  | {
      action: 'create';
      pointBalance: number;
      alreadyExists: false;
    }
  | {
      action: 'insufficient-points';
    };

export function decideStartChatPolicy(
  input: StartChatPolicyInput
): StartChatPolicyDecision {
  if (
    input.activePairMatchValid &&
    typeof input.activePairMatchId === 'string' &&
    input.activePairMatchId.length > 0
  ) {
    return {
      action: 'reuse',
      matchId: input.activePairMatchId,
      pointBalance: input.currentPoints,
      alreadyExists: true,
      source: 'pair',
    };
  }

  if (input.currentPoints <= 0) {
    return { action: 'insufficient-points' };
  }

  return {
    action: 'create',
    pointBalance: input.currentPoints - 1,
    alreadyExists: false,
  };
}

export interface ReusableDirectRoomInput {
  matchId: string;
  matchExists: boolean;
  matchActive: boolean;
  matchUserIds?: unknown;
  matchPairKey?: unknown;
  directRoomVersion?: unknown;
  hiddenFor?: unknown;
  expectedUserIds: readonly string[];
  pointerExists: boolean;
  pointerId: string;
  pointerUserIds?: unknown;
  pointerPairKey?: unknown;
  pointerActiveMatchId?: unknown;
  pointerClosedMatchId?: unknown;
  pointerClosedReason?: unknown;
}

/**
 * A room is reusable only after the explicit V1 migration has completed and
 * the one current pair pointer still names that exact, fully visible room.
 * Historical rooms with any hidden participant are never reactivated.
 */
export function isReusableDirectRoom(
  input: ReusableDirectRoomInput
): boolean {
  if (
    input.expectedUserIds.length !== 2 ||
    !input.matchExists ||
    !input.matchActive ||
    input.directRoomVersion !== 1 ||
    input.matchPairKey !== input.pointerId ||
    !Array.isArray(input.hiddenFor) ||
    input.hiddenFor.length !== 0 ||
    !isExactDirectChatParticipants(
      input.matchUserIds,
      input.expectedUserIds
    )
  ) {
    return false;
  }

  return (
    input.pointerExists &&
    input.pointerId === input.matchPairKey &&
    input.pointerPairKey === input.matchPairKey &&
    input.pointerActiveMatchId === input.matchId &&
    input.pointerClosedMatchId === undefined &&
    input.pointerClosedReason === undefined &&
    isExactDirectChatParticipants(
      input.pointerUserIds,
      input.expectedUserIds
    )
  );
}

export const MAX_ACTIVE_PAIR_ROOMS_PER_SAFETY_ACTION = 100;

/**
 * Validates a bounded canonical-pair query and returns every exact active room.
 * The caller must abort when the sentinel makes `scanComplete` false.
 */
export function activePairRoomIdsForSafety(input: {
  records: readonly {
    id: string;
    isActive: unknown;
    userIds: unknown;
  }[];
  actorUid: string;
  targetUid: string;
}): { scanComplete: boolean; matchIds: string[] } {
  const scanComplete =
    input.records.length <= MAX_ACTIVE_PAIR_ROOMS_PER_SAFETY_ACTION;
  if (!scanComplete) return { scanComplete: false, matchIds: [] };

  return {
    scanComplete: true,
    matchIds: input.records
      .filter((record) =>
        record.isActive === true &&
        isExactDirectChatParticipants(record.userIds, [
          input.actorUid,
          input.targetUid,
        ])
      )
      .map((record) => record.id)
      .filter((id) => id.length > 0)
      .sort(),
  };
}

export function isExactDirectChatParticipants(
  userIds: unknown,
  expectedUids?: readonly string[]
): userIds is string[] {
  if (
    !Array.isArray(userIds) ||
    userIds.length !== 2 ||
    userIds.some((uid) => typeof uid !== 'string') ||
    new Set(userIds).size !== 2
  ) {
    return false;
  }
  return expectedUids == null ||
    (expectedUids.length === 2 &&
      expectedUids.every((uid) => userIds.includes(uid)));
}

export interface CloseActiveChatPolicyInput {
  matchId: string;
  matchExists: boolean;
  matchActive: boolean;
  matchUserIds?: unknown;
  actorUid: string;
  targetUid: string;
  pairActiveMatchId?: unknown;
}

export interface CloseActiveChatPolicyDecision {
  closeMatch: boolean;
  clearPairPointer: boolean;
}

/**
 * A safety action closes only the verified active room for this exact pair.
 * The pair pointer is cleared only if it still points at that same room; a
 * concurrently-created replacement room must never be cleared.
 */
export function decideCloseActiveChatPolicy(
  input: CloseActiveChatPolicyInput
): CloseActiveChatPolicyDecision {
  const participants = Array.isArray(input.matchUserIds)
    ? input.matchUserIds.filter(
        (uid): uid is string => typeof uid === 'string'
      )
    : [];
  const exactPair =
    participants.length === 2 &&
    new Set(participants).size === 2 &&
    participants.includes(input.actorUid) &&
    participants.includes(input.targetUid);
  const closeMatch =
    input.matchId.length > 0 &&
    input.matchExists &&
    input.matchActive &&
    exactPair;

  return {
    closeMatch,
    clearPairPointer:
      closeMatch && input.pairActiveMatchId === input.matchId,
  };
}
