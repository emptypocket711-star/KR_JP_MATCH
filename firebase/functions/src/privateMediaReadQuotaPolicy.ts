export const privateMediaReadMinuteLimit = 60;
export const privateMediaReadDailyRequestLimit = 2000;
export const privateMediaReadDailyByteLimit = 250 * 1024 * 1024;

export interface PrivateMediaReadQuotaSnapshot {
  dayKey?: unknown;
  dailyRequests?: unknown;
  dailyBytes?: unknown;
  minuteKey?: unknown;
  minuteRequests?: unknown;
}

export interface PrivateMediaReadRequestAttemptQuotaUpdate {
  dayKey: string;
  dailyRequests: number;
  minuteKey: string;
  minuteRequests: number;
}

export interface PrivateMediaReadByteQuotaUpdate {
  dayKey: string;
  dailyBytes: number;
}

export function privateMediaReadQuotaKeys(date: Date): {
  dayKey: string;
  minuteKey: string;
} {
  const iso = date.toISOString();
  return { dayKey: iso.slice(0, 10), minuteKey: iso.slice(0, 16) };
}

/**
 * Returns the minute and daily request-counter patch for one read attempt.
 *
 * Call this before reading protected object metadata and persist the returned
 * fields with merge semantics in a transaction. A denied attempt still leaves
 * any earlier successful attempt charge in place.
 */
export function nextPrivateMediaReadRequestAttemptQuota(input: {
  current: PrivateMediaReadQuotaSnapshot | undefined;
  dayKey: string;
  minuteKey: string;
}): PrivateMediaReadRequestAttemptQuotaUpdate | null {
  const dailyRequests = input.current?.dayKey === input.dayKey &&
    typeof input.current?.dailyRequests === 'number' &&
    Number.isFinite(input.current.dailyRequests)
    ? Math.max(0, Math.floor(input.current.dailyRequests))
    : 0;
  const minuteRequests = input.current?.minuteKey === input.minuteKey &&
    typeof input.current?.minuteRequests === 'number' &&
    Number.isFinite(input.current.minuteRequests)
    ? Math.max(0, Math.floor(input.current.minuteRequests))
    : 0;

  if (
    minuteRequests >= privateMediaReadMinuteLimit ||
    dailyRequests >= privateMediaReadDailyRequestLimit
  ) {
    return null;
  }

  return {
    dayKey: input.dayKey,
    dailyRequests: dailyRequests + 1,
    minuteKey: input.minuteKey,
    minuteRequests: minuteRequests + 1,
  };
}

/**
 * Returns the daily-byte patch for metadata whose size is already known.
 *
 * Persist only these fields with merge semantics in a separate transaction.
 * This stage intentionally does not touch the minute request counter.
 */
export function nextPrivateMediaReadByteQuota(input: {
  current: PrivateMediaReadQuotaSnapshot | undefined;
  dayKey: string;
  byteLength: number;
}): PrivateMediaReadByteQuotaUpdate | null {
  if (!Number.isSafeInteger(input.byteLength) || input.byteLength <= 0) {
    return null;
  }

  const dailyBytes = input.current?.dayKey === input.dayKey &&
    typeof input.current?.dailyBytes === 'number' &&
    Number.isFinite(input.current.dailyBytes)
    ? Math.max(0, Math.floor(input.current.dailyBytes))
    : 0;

  if (dailyBytes + input.byteLength > privateMediaReadDailyByteLimit) {
    return null;
  }

  return {
    dayKey: input.dayKey,
    dailyBytes: dailyBytes + input.byteLength,
  };
}

/**
 * Compatibility adapter for the existing single-transaction caller.
 *
 * New integrations must use the two stage-specific functions above. Do not
 * call this adapter after an attempt has already been charged, or the minute
 * counter would be charged twice.
 */
export function nextPrivateMediaReadQuota(input: {
  current: PrivateMediaReadQuotaSnapshot | undefined;
  dayKey: string;
  minuteKey: string;
  byteLength: number;
}): { dailyBytes: number; minuteRequests: number } | null {
  const requestUpdate = nextPrivateMediaReadRequestAttemptQuota({
    current: input.current,
    dayKey: input.dayKey,
    minuteKey: input.minuteKey,
  });
  const byteUpdate = nextPrivateMediaReadByteQuota({
    current: input.current,
    dayKey: input.dayKey,
    byteLength: input.byteLength,
  });

  if (requestUpdate == null || byteUpdate == null) {
    return null;
  }

  return {
    dailyBytes: byteUpdate.dailyBytes,
    minuteRequests: requestUpdate.minuteRequests,
  };
}
