const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PROFILE_TRANSLATION_CACHE_VERSION,
  normalizeProfileTranslationTarget,
  playfulProfileFallback,
  resolveViewerProfileLanguage,
  translateProfileKeyword,
  translateProfileOccupation,
  translateProfilePhrase,
} = require('../lib/profileTranslationPolicy');

test('normalizes supported profile translation targets', () => {
  assert.equal(normalizeProfileTranslationTarget('ko'), 'ko');
  assert.equal(normalizeProfileTranslationTarget('ja'), 'ja');
  assert.equal(normalizeProfileTranslationTarget('en'), null);
  assert.equal(normalizeProfileTranslationTarget(undefined), null);
});

test('uses explicit viewer UI language before stored profile language', () => {
  assert.equal(resolveViewerProfileLanguage('ja', 'ko'), 'ja');
  assert.equal(resolveViewerProfileLanguage('ko', 'ja'), 'ko');
});

test('falls back to stored profile language when request is invalid', () => {
  assert.equal(resolveViewerProfileLanguage('en', 'ja'), 'ja');
  assert.equal(resolveViewerProfileLanguage(null, 'ko'), 'ko');
});

test('keeps profile translation cache version explicit', () => {
  assert.equal(PROFILE_TRANSLATION_CACHE_VERSION, 2);
});

test('maps profile keywords before machine translation', () => {
  assert.equal(translateProfileKeyword('애니메이션', 'ja'), 'アニメ');
  assert.equal(translateProfileKeyword('음식', 'ja'), 'グルメ');
  assert.equal(translateProfileKeyword('언어교환', 'ja'), '言語交換');
  assert.equal(translateProfileKeyword('アニメ', 'ko'), '애니메이션');
});

test('maps common occupation typos and labels before machine translation', () => {
  assert.equal(translateProfileOccupation('프리랜서', 'ja'), 'フリーランス');
  assert.equal(translateProfileOccupation('프래린서', 'ja'), 'フリーランス');
  assert.equal(translateProfileOccupation('회사원', 'ja'), '会社員');
});

test('maps common profile Q&A phrases before machine translation', () => {
  assert.equal(
    translateProfilePhrase('이상형의 조건이 있다면?', 'ja'),
    '理想の相手に求めることは？'
  );
  assert.equal(translateProfilePhrase('나를 한 마디로 표현하면?', 'ja'), '自分を一言で表すなら？');
  assert.equal(translateProfilePhrase('인프피임다', 'ja'), 'INFPです');
});

test('uses a calm fallback for low-signal playful Korean text', () => {
  assert.equal(playfulProfileFallback('쿄쿄쿄쿄쿜ㅋㅋㅋ,😁😄', 'ja'), '笑 😁😄');
  assert.equal(playfulProfileFallback('차분한사람', 'ja'), null);
});
