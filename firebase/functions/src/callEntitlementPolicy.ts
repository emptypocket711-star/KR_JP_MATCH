import { createHash } from 'crypto';
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
export const callTokenMaxLeaseSeconds = 60;
export const callRingingTtlSeconds = 60;
export const callNotificationTtlSafetyMillis = 5 * 1000;
export const callExtensionRequestIdMinLength = 16;
export const callExtensionRequestIdMaxLength = 128;

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
  ringingExpiresAtMillis: number | null;
  paidUntilAtMillis: number | null;
  callerActive: boolean;
  calleeActive: boolean;
  matchExists: boolean;
  matchActive: boolean;
  matchParticipantUids: unknown;
  matchPairKey: unknown;
  matchDirectRoomVersion: unknown;
  matchHiddenFor: unknown;
  pairExists: boolean;
  pairId: string;
  pairPairKey: unknown;
  pairActiveMatchId: unknown;
  pairParticipantUids: unknown;
  pairClosedMatchId: unknown;
  pairClosedReason: unknown;
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
  const expectedPairKey = [input.callerUid, input.calleeUid]
    .sort()
    .join('_');

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
    input.callStatus === 'ringing' &&
    (!Number.isSafeInteger(input.ringingExpiresAtMillis) ||
      input.ringingExpiresAtMillis! <= input.nowMillis)
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
    input.matchPairKey !== expectedPairKey ||
    input.matchDirectRoomVersion !== 1 ||
    !Array.isArray(input.matchHiddenFor) ||
    input.matchHiddenFor.length !== 0 ||
    !input.pairExists ||
    input.pairId !== expectedPairKey ||
    input.pairPairKey !== expectedPairKey ||
    input.pairActiveMatchId !== input.callMatchId ||
    !isExactDirectChatParticipants(
      input.pairParticipantUids,
      [input.callerUid, input.calleeUid]
    ) ||
    input.pairClosedMatchId !== undefined ||
    input.pairClosedReason !== undefined ||
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
  return lifetimeSeconds > 0
    ? Math.min(lifetimeSeconds, callTokenMaxLeaseSeconds)
    : null;
}

export function incomingCallNotificationTtlMillis(params: {
  ringingExpiresAtMillis: unknown;
  nowMillis: number;
}): number | null {
  if (
    !Number.isSafeInteger(params.ringingExpiresAtMillis) ||
    !Number.isSafeInteger(params.nowMillis)
  ) {
    return null;
  }
  const ttlMillis =
    (params.ringingExpiresAtMillis as number) -
    params.nowMillis -
    callNotificationTtlSafetyMillis;
  return ttlMillis > 0 ? ttlMillis : null;
}

export type ActiveCallReplacementDecision =
  | 'busy'
  | 'replace-pointer'
  | 'close-stale-ringing'
  | 'close-expired-accepted';

/**
 * Determines whether startCall can replace the room's active-call pointer.
 * Only an exact call belonging to this room is mutated; malformed or foreign
 * pointers are overwritten without touching the referenced call document.
 */
export function decideActiveCallReplacement(params: {
  pointerExists: boolean;
  callExists: boolean;
  callBelongsToRoom: boolean;
  status: unknown;
  ringingExpiresAtMillis: unknown;
  paidUntilAtMillis: unknown;
  nowMillis: number;
}): ActiveCallReplacementDecision {
  if (
    !params.pointerExists ||
    !params.callExists ||
    !params.callBelongsToRoom
  ) {
    return 'replace-pointer';
  }
  if (params.status === 'ringing') {
    return Number.isSafeInteger(params.ringingExpiresAtMillis) &&
      (params.ringingExpiresAtMillis as number) > params.nowMillis
      ? 'busy'
      : 'close-stale-ringing';
  }
  if (params.status === 'accepted') {
    return Number.isSafeInteger(params.paidUntilAtMillis) &&
      (params.paidUntilAtMillis as number) > params.nowMillis
      ? 'busy'
      : 'close-expired-accepted';
  }
  return 'replace-pointer';
}

export function normalizeCallExtensionRequestId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (
    value.length < callExtensionRequestIdMinLength ||
    value.length > callExtensionRequestIdMaxLength ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    return null;
  }
  return value;
}

export function callExtensionOperationId(params: {
  callId: string;
  uid: string;
  clientRequestId: string;
}): string {
  const digest = createHash('sha256')
    .update(params.callId)
    .update('\0')
    .update(params.uid)
    .update('\0')
    .update(params.clientRequestId)
    .digest('hex');
  return `call_extension_${digest}`;
}

export interface CallExtensionReplayRecord {
  operationId: unknown;
  callId: unknown;
  uid: unknown;
  clientRequestId: unknown;
  matchId: unknown;
  callType: unknown;
  roomName: unknown;
  paidUntilAtMillis: unknown;
  chargedPoints: unknown;
  keyCount: unknown;
  pointEventId: unknown;
  status: unknown;
}

export interface CallExtensionReplayEvent {
  uid: unknown;
  callId: unknown;
  matchId: unknown;
  eventType: unknown;
  source: unknown;
  reason: unknown;
  amount: unknown;
  balanceBefore: unknown;
  balanceAfter: unknown;
  clientRequestId: unknown;
}

export type CallExtensionReplayDecision =
  | { action: 'new' }
  | { action: 'inconsistent' }
  | {
      action: 'replay';
      paidUntilAtMillis: number;
      chargedPoints: number;
      keyCount: number;
    };

export function decideCallExtensionReplay(params: {
  operationExists: boolean;
  operation?: CallExtensionReplayRecord;
  eventExists: boolean;
  event?: CallExtensionReplayEvent;
  expected: {
    operationId: string;
    callId: string;
    uid: string;
    clientRequestId: string;
    matchId: string;
    callType: HanaCallType;
    roomName: string;
  };
}): CallExtensionReplayDecision {
  if (!params.operationExists) {
    return params.eventExists ? { action: 'inconsistent' } : { action: 'new' };
  }
  const operation = params.operation;
  const event = params.event;
  if (
    operation == null ||
    !params.eventExists ||
    event == null ||
    operation.status !== 'committed' ||
    operation.operationId !== params.expected.operationId ||
    operation.callId !== params.expected.callId ||
    operation.uid !== params.expected.uid ||
    operation.clientRequestId !== params.expected.clientRequestId ||
    operation.matchId !== params.expected.matchId ||
    operation.callType !== params.expected.callType ||
    operation.roomName !== params.expected.roomName ||
    operation.pointEventId !== params.expected.operationId ||
    !Number.isSafeInteger(operation.paidUntilAtMillis) ||
    (operation.paidUntilAtMillis as number) <= 0 ||
    !Number.isSafeInteger(operation.chargedPoints) ||
    operation.chargedPoints !== (
      params.expected.callType === 'video'
        ? videoSegmentPoints
        : voiceExtensionPoints
    ) ||
    !Number.isSafeInteger(operation.keyCount) ||
    (operation.keyCount as number) < 0 ||
    event.uid !== params.expected.uid ||
    event.callId !== params.expected.callId ||
    event.matchId !== params.expected.matchId ||
    event.eventType !== 'consume' ||
    event.source !== 'extendCall' ||
    event.reason !== (
      params.expected.callType === 'video'
        ? 'video_call_extension'
        : 'voice_call_extension'
    ) ||
    event.amount !== operation.chargedPoints ||
    event.balanceBefore !==
      (operation.keyCount as number) + (operation.chargedPoints as number) ||
    event.balanceAfter !== operation.keyCount ||
    event.clientRequestId !== params.expected.clientRequestId
  ) {
    return { action: 'inconsistent' };
  }
  return {
    action: 'replay',
    paidUntilAtMillis: operation.paidUntilAtMillis as number,
    chargedPoints: operation.chargedPoints as number,
    keyCount: operation.keyCount as number,
  };
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
    'allowedStatuses' | 'requirePaidEntitlement'
  >
): boolean {
  return callEntitlementIssue({
    ...input,
    allowedStatuses: ['ringing'],
    requirePaidEntitlement: false,
  }) === null;
}
