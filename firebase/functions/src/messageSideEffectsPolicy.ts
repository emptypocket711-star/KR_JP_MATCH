export type ChatLanguage = 'ko' | 'ja';
export type DetectedChatLanguage = ChatLanguage | 'unknown';

export interface LanguageProfile {
  nativeLanguage?: unknown;
  nationality?: unknown;
}

export interface MessageSideEffectInput {
  matchActive: boolean;
  senderBlockedRecipient: boolean;
  recipientBlockedSender: boolean;
  recipientExists: boolean;
  recipientBanned: boolean;
}

export interface ChatPushInput {
  fcmToken?: string | null;
  notificationsEnabled?: boolean;
  nightQuietEnabled?: boolean;
  hourKst: number;
}

export interface TranslatedPreviewInput {
  originalText: unknown;
  originalLang: DetectedChatLanguage;
  translations: unknown;
  recipientProfile?: LanguageProfile;
  maxLength?: number;
}

export function canApplyMessageSideEffects(
  input: MessageSideEffectInput
): boolean {
  return (
    input.matchActive &&
    !input.senderBlockedRecipient &&
    !input.recipientBlockedSender &&
    input.recipientExists &&
    !input.recipientBanned
  );
}

export function languageForProfile(
  profile: LanguageProfile | undefined,
  fallback: ChatLanguage = 'ko'
): ChatLanguage {
  if (profile?.nativeLanguage === 'ko' || profile?.nativeLanguage === 'ja') {
    return profile.nativeLanguage;
  }

  if (profile?.nationality === 'JP') return 'ja';
  if (profile?.nationality === 'KR') return 'ko';
  return fallback;
}

export function oppositeChatLanguage(
  language: DetectedChatLanguage
): ChatLanguage {
  return language === 'ko' ? 'ja' : 'ko';
}

export function targetLanguagesForMessage(input: {
  originalLang: DetectedChatLanguage;
  recipientProfile?: LanguageProfile;
  senderProfile?: LanguageProfile;
}): ChatLanguage[] {
  const recipientLanguage = languageForProfile(
    input.recipientProfile,
    oppositeChatLanguage(input.originalLang)
  );
  const senderLanguage = languageForProfile(
    input.senderProfile,
    oppositeChatLanguage(recipientLanguage)
  );
  const languages = new Set<ChatLanguage>([recipientLanguage]);

  if (senderLanguage !== recipientLanguage) {
    languages.add(senderLanguage);
  }

  return Array.from(languages);
}

export function shouldSendChatPush(input: ChatPushInput): boolean {
  if (!input.fcmToken) return false;
  if (input.notificationsEnabled === false) return false;

  const quietEnabled = input.nightQuietEnabled === true;
  const isQuietHour = input.hourKst >= 22 || input.hourKst < 8;
  return !(quietEnabled && isQuietHour);
}

function trimPreview(value: string, maxLength: number): string {
  return value.length > maxLength
    ? value.substring(0, maxLength) + '…'
    : value;
}

export function translatedPreviewForRecipient(
  input: TranslatedPreviewInput
): string | null {
  if (typeof input.originalText !== 'string' || input.originalText.length === 0) {
    return null;
  }

  const maxLength = input.maxLength ?? 60;
  const language = languageForProfile(input.recipientProfile);
  const translations = input.translations;
  if (
    input.originalLang !== language &&
    translations != null &&
    typeof translations === 'object'
  ) {
    const translated = (translations as Record<string, unknown>)[language];
    if (typeof translated === 'string' && translated.trim().length > 0) {
      return trimPreview(translated.trim(), maxLength);
    }
  }

  return trimPreview(input.originalText, maxLength);
}
