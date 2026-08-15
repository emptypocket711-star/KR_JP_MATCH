export const translationMaxTextCharacters = 1000;
export const translationMinuteRequestLimit = 20;
export const translationDailyCharacterLimit = 20_000;

export type TranslationTargetLanguage = 'ko' | 'ja';

export type TranslationRequestValidation =
  | {
      ok: true;
      text: string;
      targetLang: TranslationTargetLanguage;
    }
  | {
      ok: false;
      reason: 'empty-text' | 'text-too-long' | 'invalid-target-language';
    };

export function validateTranslationRequest(
  text: unknown,
  targetLang: unknown
): TranslationRequestValidation {
  const normalizedText = typeof text === 'string' ? text.trim() : '';
  if (normalizedText.length === 0) {
    return { ok: false, reason: 'empty-text' };
  }
  if (normalizedText.length > translationMaxTextCharacters) {
    return { ok: false, reason: 'text-too-long' };
  }
  if (targetLang !== 'ko' && targetLang !== 'ja') {
    return { ok: false, reason: 'invalid-target-language' };
  }
  return { ok: true, text: normalizedText, targetLang };
}

export interface TranslationUsageSnapshot {
  dailyCharacters?: unknown;
  minuteKey?: unknown;
  minuteRequests?: unknown;
}

export type TranslationQuotaDecision =
  | {
      allowed: true;
      dailyCharacters: number;
      minuteKey: string;
      minuteRequests: number;
    }
  | {
      allowed: false;
      reason: 'minute-request-limit' | 'daily-character-limit';
    };

export function translationQuotaKeys(date: Date): {
  dayKey: string;
  minuteKey: string;
} {
  const iso = date.toISOString();
  return {
    dayKey: iso.slice(0, 10),
    minuteKey: iso.slice(0, 16),
  };
}

export function decideTranslationQuota(input: {
  current: TranslationUsageSnapshot | undefined;
  requestCharacters: number;
  minuteKey: string;
}): TranslationQuotaDecision {
  const dailyCharacters =
    typeof input.current?.dailyCharacters === 'number' &&
    Number.isFinite(input.current.dailyCharacters)
      ? Math.max(0, Math.floor(input.current.dailyCharacters))
      : 0;
  const minuteRequests =
    input.current?.minuteKey === input.minuteKey &&
    typeof input.current?.minuteRequests === 'number' &&
    Number.isFinite(input.current.minuteRequests)
      ? Math.max(0, Math.floor(input.current.minuteRequests))
      : 0;

  if (minuteRequests >= translationMinuteRequestLimit) {
    return { allowed: false, reason: 'minute-request-limit' };
  }

  if (
    input.requestCharacters <= 0 ||
    dailyCharacters + input.requestCharacters > translationDailyCharacterLimit
  ) {
    return { allowed: false, reason: 'daily-character-limit' };
  }

  return {
    allowed: true,
    dailyCharacters: dailyCharacters + input.requestCharacters,
    minuteKey: input.minuteKey,
    minuteRequests: minuteRequests + 1,
  };
}
