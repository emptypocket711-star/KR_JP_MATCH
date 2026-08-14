import { isExactDirectChatParticipants } from './chatPolicy';

export const voiceFreeSeconds = 5 * 60;
export const voiceExtensionSeconds = 10 * 60;
export const videoSegmentSeconds = 10 * 60;
export const voiceExtensionPoints = 1;
export const videoSegmentPoints = 3;

// Agora token expiry is calculated from its own wall clock. Leave a small
// server-side margin so RTC privileges cannot cross the paid Firestore
// entitlement boundary when a second rolls during token construction.
export const callTokenExpirySafetySeconds = 5;

export type HanaCallType = 'voice' | 'video';
export type JoinableCallStatus = 'ringing' | 'accepted';

export interface CallEntitlementPolicyInput {
  callExists: boolean;
  callId: string;
  requesterUid: string;
  callerUid: unknown;
  calleeUid: unknown;
  participantUids: unknown;
  callMatchId: unknown;
  callType: unknown;
  roomName: unknown;
  callStatus: unknown;
  paidUntilAtMillis: number | null;
  callerActive: boolean;
  calleeActive: boolean;
  matchExists: boolean;
  matchActive: boolean;
  matchParticipantUids: unknown;
  matchDirectRoomVersion: unknown;
  matchHiddenFor: unknown;
  pairExists: boolean;
  pairActiveMatchId: unknown;
  pairParticipantUids: unknown;
  callerBlockedCallee: boolean;
  calleeBlockedCaller: boolean;
  activeCallExists: boolean;
  activeCallId: unknown;
  activeCallMatchId: unknown;
  activeCallParticipantUids: unknown;
  activeCallStatus: unknown;
  allowedStatuses: readonly JoinableCallStatus[];
  requirePaidEntitlement: boolean;
  nowMillis: number;
}

export type CallEntitlementIssue =
  | 'unavailable'
  | 'closed';

/**
 * Validates the complete server-owned graph that authorizes an RTC token or
 * paid extension. The deliberately coarse result keeps bilateral block and
 * participant-account state private from callable clients.
 */
export function callEntitlementIssue(
  input: CallEntitlementPolicyInput
): CallEntitlementIssue | null {
  if (
    !input.callExists ||
    typeof input.callerUid !== 'string' ||
    typeof input.calleeUid !== 'string' ||
    input.callerUid.length === 0 ||
    input.calleeUid.length === 0 ||
    input.callerUid === input.calleeUid ||
    !isExactDirectChatParticipants(
      input.participantUids,
      [input.callerUid, input.calleeUid]
    ) ||
    !input.participantUids.includes(input.requesterUid) ||
    typeof input.callMatchId !== 'string' ||
    input.callMatchId.length === 0 ||
    (input.callType !== 'voice' && input.callType !== 'video') ||
    typeof input.roomName !== 'string' ||
    input.roomName.length === 0
  ) {
    return 'unavailable';
  }

  if (
    !input.allowedStatuses.includes(input.callStatus as JoinableCallStatus) ||
    !input.activeCallExists ||
    input.activeCallId !== input.callId ||
    input.activeCallMatchId !== input.callMatchId ||
    !isExactDirectChatParticipants(
      input.activeCallParticipantUids,
      [input.callerUid, input.calleeUid]
    ) ||
    input.activeCallStatus !== input.callStatus
  ) {
    return 'closed';
  }

  if (
    !input.callerActive ||
    !input.calleeActive ||
    !input.matchExists ||
    !input.matchActive ||
    !isExactDirectChatParticipants(
      input.matchParticipantUids,
      [input.callerUid, input.calleeUid]
    ) ||
    input.matchDirectRoomVersion !== 1 ||
    !Array.isArray(input.matchHiddenFor) ||
    input.matchHiddenFor.length !== 0 ||
    !input.pairExists ||
    input.pairActiveMatchId !== input.callMatchId ||
    !isExactDirectChatParticipants(
      input.pairParticipantUids,
      [input.callerUid, input.calleeUid]
    ) ||
    input.callerBlockedCallee ||
    input.calleeBlockedCaller
  ) {
    return 'unavailable';
  }

  if (
    input.requirePaidEntitlement &&
    (!Number.isSafeInteger(input.paidUntilAtMillis) ||
      input.paidUntilAtMillis! <= input.nowMillis)
  ) {
    return 'closed';
  }

  return null;
}

export function callTokenLifetimeSeconds(params: {
  paidUntilAtMillis: unknown;
  nowMillis: number;
}): number | null {
  if (
    !Number.isSafeInteger(params.paidUntilAtMillis) ||
    !Number.isSafeInteger(params.nowMillis)
  ) {
    return null;
  }
  const paidUntilAtMillis = params.paidUntilAtMillis as number;
  const remainingWholeSeconds = Math.floor(
    (paidUntilAtMillis - params.nowMillis) / 1000
  );
  const lifetimeSeconds =
    remainingWholeSeconds - callTokenExpirySafetySeconds;
  return lifetimeSeconds > 0 ? lifetimeSeconds : null;
}

export type CallExtensionDecision =
  | {
      action: 'extend';
      chargePoints: number;
      nextBalance: number;
      nextPaidUntilAtMillis: number;
      segmentSeconds: number;
    }
  | { action: 'insufficient-points' }
  | { action: 'closed' };

/**
 * Computes one serialized extension from the transaction's fresh balance and
 * paid boundary. Expired calls cannot be revived and every successful state
 * transition advances time by exactly the segment paired with its charge.
 */
export function decideCallExtension(params: {
  callType: HanaCallType;
  currentBalance: unknown;
  paidUntilAtMillis: unknown;
  nowMillis: number;
}): CallExtensionDecision {
  if (
    !Number.isSafeInteger(params.currentBalance) ||
    (params.currentBalance as number) < 0 ||
    !Number.isSafeInteger(params.paidUntilAtMillis) ||
    (params.paidUntilAtMillis as number) <= params.nowMillis
  ) {
    return { action: 'closed' };
  }

  const chargePoints = params.callType === 'video'
    ? videoSegmentPoints
    : voiceExtensionPoints;
  const segmentSeconds = params.callType === 'video'
    ? videoSegmentSeconds
    : voiceExtensionSeconds;
  const currentBalance = params.currentBalance as number;
  if (currentBalance < chargePoints) {
    return { action: 'insufficient-points' };
  }

  return {
    action: 'extend',
    chargePoints,
    nextBalance: currentBalance - chargePoints,
    nextPaidUntilAtMillis:
      (params.paidUntilAtMillis as number) + segmentSeconds * 1000,
    segmentSeconds,
  };
}

export function canNotifyIncomingCall(
  input: Omit<
    CallEntitlementPolicyInput,
    'allowedStatuses' | 'requirePaidEntitlement' | 'nowMillis'
  >
): boolean {
  return callEntitlementIssue({
    ...input,
    allowedStatuses: ['ringing'],
    requirePaidEntitlement: false,
    nowMillis: 0,
  }) === null;
}
