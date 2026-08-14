export type ProfileTranslationTarget = 'ko' | 'ja';

export const PROFILE_TRANSLATION_CACHE_VERSION = 2;

export function normalizeProfileTranslationTarget(
  value: unknown
): ProfileTranslationTarget | null {
  return value === 'ko' || value === 'ja' ? value : null;
}

export function resolveViewerProfileLanguage(
  requestedLanguage: unknown,
  storedLanguage: ProfileTranslationTarget
): ProfileTranslationTarget {
  return normalizeProfileTranslationTarget(requestedLanguage) ?? storedLanguage;
}

const jaKeywordMap: Record<string, string> = {
  'K-pop': 'K-pop',
  아이돌: 'アイドル',
  드라마: 'ドラマ',
  영화: '映画',
  애니메이션: 'アニメ',
  만화: 'マンガ',
  게임: 'ゲーム',
  여행: '旅行',
  음식: 'グルメ',
  요리: '料理',
  카페: 'カフェ',
  독서: '読書',
  음악: '音楽',
  악기: '楽器',
  운동: '運動',
  헬스: 'ジム',
  등산: '登山',
  자전거: '自転車',
  수영: '水泳',
  언어교환: '言語交換',
  일본어공부중: '日本語を勉強中',
  한국어공부중: '韓国語を勉強中',
  반려동물: 'ペット',
  패션: 'ファッション',
  사진: '写真',
  그림: '絵',
  댄스: 'ダンス',
  한국문화: '韓国文化',
  일본문화: '日本文化',
  야구: '野球',
  축구: 'サッカー',
};

const koKeywordMap = Object.fromEntries(
  Object.entries(jaKeywordMap).map(([ko, ja]) => [ja, ko])
);

const jaOccupationMap: Record<string, string> = {
  프리랜서: 'フリーランス',
  프래린서: 'フリーランス',
  회사원: '会社員',
  직장인: '会社員',
  학생: '学生',
  대학생: '大学生',
  디자이너: 'デザイナー',
  개발자: 'エンジニア',
  엔지니어: 'エンジニア',
  선생님: '教師',
  교사: '教師',
  자영업: '自営業',
  간호사: '看護師',
  공무원: '公務員',
};

const koOccupationMap = Object.fromEntries(
  Object.entries(jaOccupationMap).map(([ko, ja]) => [ja, ko])
);

const jaPhraseMap: Record<string, string> = {
  이상형의조건이있다면: '理想の相手に求めることは？',
  나를한마디로표현하면: '自分を一言で表すなら？',
  차분한사람: '落ち着いた人',
  인프피임다: 'INFPです',
  인프피입니다: 'INFPです',
  인프피: 'INFP',
};

const koPhraseMap = Object.fromEntries(
  Object.entries(jaPhraseMap).map(([ko, ja]) => [ja, ko])
);

function normalizedKey(value: string): string {
  return value.trim().replace(/[\s,，.。!！?？~〜ー\-_/\\()[\]{}'"]/g, '');
}

function directMap(
  value: string,
  targetLang: ProfileTranslationTarget,
  jaMap: Record<string, string>,
  koMap: Record<string, string>
): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return value;
  const key = normalizedKey(trimmed);
  if (targetLang === 'ja') return jaMap[key] ?? jaMap[trimmed] ?? null;
  return koMap[key] ?? koMap[trimmed] ?? null;
}

export function translateProfileKeyword(
  value: string,
  targetLang: ProfileTranslationTarget
): string | null {
  return directMap(value, targetLang, jaKeywordMap, koKeywordMap);
}

export function translateProfileOccupation(
  value: string,
  targetLang: ProfileTranslationTarget
): string | null {
  return directMap(value, targetLang, jaOccupationMap, koOccupationMap);
}

export function translateProfilePhrase(
  value: string,
  targetLang: ProfileTranslationTarget
): string | null {
  return directMap(value, targetLang, jaPhraseMap, koPhraseMap);
}

export function playfulProfileFallback(
  value: string,
  targetLang: ProfileTranslationTarget
): string | null {
  if (targetLang !== 'ja') return null;
  const compact = value
    .trim()
    .replace(/[\s,，.。!！?？~〜ー\-_/\\()[\]{}'"]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, '');
  if (compact.length < 2) return null;
  if (/^(ㅋ|ㅎ|쿄|쿜|하|히|호|헤)+$/u.test(compact)) {
    const emojis = Array.from(value.matchAll(/[\u{1F300}-\u{1FAFF}]/gu))
      .map((match) => match[0])
      .join('');
    return emojis.length > 0 ? `笑 ${emojis}` : '笑';
  }
  return null;
}
