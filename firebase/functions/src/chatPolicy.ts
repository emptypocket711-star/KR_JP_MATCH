export interface StartChatPolicyInput {
  currentPoints: number;
  activePairMatchId?: string;
  activePairMatchValid: boolean;
  legacyMatchId: string;
  legacyMatchValid: boolean;
}

export type StartChatPolicyDecision =
  | {
      action: 'reuse';
      matchId: string;
      pointBalance: number;
      alreadyExists: true;
      source: 'pair' | 'legacy';
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

  if (input.legacyMatchValid) {
    return {
      action: 'reuse',
      matchId: input.legacyMatchId,
      pointBalance: input.currentPoints,
      alreadyExists: true,
      source: 'legacy',
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
