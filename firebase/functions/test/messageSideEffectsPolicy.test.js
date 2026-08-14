const assert = require('node:assert/strict');
const test = require('node:test');

const {
  canApplyMessageSideEffects,
  languageForProfile,
  oppositeChatLanguage,
  shouldSendChatPush,
  targetLanguagesForMessage,
  translatedPreviewForRecipient,
} = require('../lib/messageSideEffectsPolicy');

test('allows message side effects only for active unblocked available recipients', () => {
  assert.equal(canApplyMessageSideEffects({
    matchActive: true,
    senderBlockedRecipient: false,
    recipientBlockedSender: false,
    recipientExists: true,
    recipientBanned: false,
  }), true);
});

test('blocks message side effects when room is inactive or either side blocked', () => {
  assert.equal(canApplyMessageSideEffects({
    matchActive: false,
    senderBlockedRecipient: false,
    recipientBlockedSender: false,
    recipientExists: true,
    recipientBanned: false,
  }), false);

  assert.equal(canApplyMessageSideEffects({
    matchActive: true,
    senderBlockedRecipient: true,
    recipientBlockedSender: false,
    recipientExists: true,
    recipientBanned: false,
  }), false);

  assert.equal(canApplyMessageSideEffects({
    matchActive: true,
    senderBlockedRecipient: false,
    recipientBlockedSender: true,
    recipientExists: true,
    recipientBanned: false,
  }), false);
});

test('blocks message side effects for unavailable recipients', () => {
  assert.equal(canApplyMessageSideEffects({
    matchActive: true,
    senderBlockedRecipient: false,
    recipientBlockedSender: false,
    recipientExists: false,
    recipientBanned: false,
  }), false);

  assert.equal(canApplyMessageSideEffects({
    matchActive: true,
    senderBlockedRecipient: false,
    recipientBlockedSender: false,
    recipientExists: true,
    recipientBanned: true,
  }), false);
});

test('resolves profile language from native language, then nationality, then fallback', () => {
  assert.equal(languageForProfile({ nativeLanguage: 'ja', nationality: 'KR' }), 'ja');
  assert.equal(languageForProfile({ nationality: 'JP' }), 'ja');
  assert.equal(languageForProfile({ nationality: 'KR' }, 'ja'), 'ko');
  assert.equal(languageForProfile({}, 'ja'), 'ja');
});

test('chooses opposite language for unknown as Korean-to-Japanese default', () => {
  assert.equal(oppositeChatLanguage('ko'), 'ja');
  assert.equal(oppositeChatLanguage('ja'), 'ko');
  assert.equal(oppositeChatLanguage('unknown'), 'ko');
});

test('targets recipient language and sender language when they differ', () => {
  assert.deepEqual(targetLanguagesForMessage({
    originalLang: 'ko',
    recipientProfile: { nativeLanguage: 'ja' },
    senderProfile: { nativeLanguage: 'ko' },
  }), ['ja', 'ko']);
});

test('targets only one language when both users read the same language', () => {
  assert.deepEqual(targetLanguagesForMessage({
    originalLang: 'unknown',
    recipientProfile: { nationality: 'JP' },
    senderProfile: { nativeLanguage: 'ja' },
  }), ['ja']);
});

test('sends push only with token, enabled notifications, and non-quiet hour', () => {
  assert.equal(shouldSendChatPush({
    fcmToken: 'token',
    notificationsEnabled: true,
    nightQuietEnabled: true,
    hourKst: 12,
  }), true);

  assert.equal(shouldSendChatPush({
    fcmToken: null,
    notificationsEnabled: true,
    nightQuietEnabled: false,
    hourKst: 12,
  }), false);

  assert.equal(shouldSendChatPush({
    fcmToken: 'token',
    notificationsEnabled: false,
    nightQuietEnabled: false,
    hourKst: 12,
  }), false);

  assert.equal(shouldSendChatPush({
    fcmToken: 'token',
    notificationsEnabled: true,
    nightQuietEnabled: true,
    hourKst: 23,
  }), false);
});

test('prefers the recipient language for chat-list and push previews', () => {
  assert.equal(translatedPreviewForRecipient({
    originalText: '안녕하세요',
    originalLang: 'ko',
    translations: { ko: null, ja: 'こんにちは' },
    recipientProfile: { nativeLanguage: 'ja' },
  }), 'こんにちは');

  assert.equal(translatedPreviewForRecipient({
    originalText: '안녕하세요',
    originalLang: 'ko',
    translations: { ko: null, ja: null },
    recipientProfile: { nativeLanguage: 'ja' },
  }), '안녕하세요');
});

test('bounds localized previews and rejects missing source text', () => {
  assert.equal(translatedPreviewForRecipient({
    originalText: 'abcdefgh',
    originalLang: 'ko',
    translations: {},
    recipientProfile: { nativeLanguage: 'ko' },
    maxLength: 5,
  }), 'abcde…');
  assert.equal(translatedPreviewForRecipient({
    originalText: null,
    originalLang: 'unknown',
    translations: {},
  }), null);
});
