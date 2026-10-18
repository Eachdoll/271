/**
 * 말버릇(캐치프레이즈) 비교 — 앱과 패키지가 같은 규칙으로 센다. 의존성 없음(브라우저에서도 그대로 쓴다).
 *
 * - NFC·소문자로 맞추고 공백·문장부호는 무시한다: "같이 가자!" = "같이 가자" = "같이가자".
 * - 끝의 한국어 종결어미 하나(자·요·야 …)는 떼고 비교한다: "같이 가!" = "같이 가자!" = "같이 가요".
 * - 단어 경계를 지킨다: "같이 가방", "같이 가자고"는 같은 말버릇으로 세지 않는다.
 * - 뜻만 같은 다른 표현("함께 가자")은 같은 말버릇으로 치지 않는다.
 * - 핵심 구절이 2글자보다 짧으면("응!") 세지 않는다(과잉 일치 방지).
 */
const WORD_CHAR = /[\p{L}\p{N}]/u;
const HANGUL = /[ㄱ-ㆎ가-힣]/u;
/** 말버릇 끝에서 떼어 내는 종결어미(한 글자). */
const STRIPPABLE_ENDINGS = new Set(['자', '요', '야', '지', '아', '어', '다', '래', '네', '죠', '니']);
/** 본문에서 핵심 구절 바로 뒤에 붙어도 같은 말버릇으로 보는 종결어미 하나. */
const TEXT_ENDING = '(?:아요|어요|지요|[자요야지아어다래네죠니])';
/** 핵심 구절의 최소 길이(글자). 이보다 짧으면 세지 않는다. */
export const CATCHPHRASE_MIN_CORE = 2;
/** 말버릇 사용 한도(책 전체). */
export const CATCHPHRASE_LIMIT = 1;
/** 줄거리 프롬프트의 등장인물 줄에 붙는 제한 문구. */
export const CATCHPHRASE_ONCE_KO = '책 전체에서 최대 1번, 꼭 쓰지 않아도 된다. 후렴으로 쓰지 않는다';
/** 같은 프롬프트에서 두 번째 인물부터 붙는 짧은 제한 문구(긴 문장은 한 번만 쓴다). */
export const CATCHPHRASE_SHORT_KO = '최대 1번';
/** 최근 책에서 썼으므로 이번 책에서 뺄 때의 문구. */
export const CATCHPHRASE_OMIT_KO = '이번 책에서는 말버릇을 쓰지 않는다';
/** 전문 단계 규칙 한 줄(한글). */
export const CATCHPHRASE_RULE_KO = '말버릇은 책 전체에서 최대 1번만 쓰고, 꼭 쓰지 않아도 된다. 후렴으로 쓰지 않는다.';
/** 전문 단계 규칙 한 줄(영어). */
export const CATCHPHRASE_RULE_EN = "Use each character's catchphrase at most once in the whole book, or not at all.";
const normalize = (value) => String(value ?? '').normalize('NFC').toLowerCase();
const tokensOf = (value) => normalize(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const escapeChar = (ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 프롬프트·수정 항목에 넣을 때 줄바꿈·연속 공백을 한 칸으로 줄인다(한 줄 안에 머물게). */
const oneLine = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim();
function coreShape(phrase) {
    const tokens = tokensOf(phrase);
    if (!tokens.length)
        return null;
    const lastChars = [...tokens[tokens.length - 1]];
    const total = tokens.reduce((n, t) => n + [...t].length, 0);
    const tail = lastChars[lastChars.length - 1];
    if (lastChars.length >= 2 &&
        STRIPPABLE_ENDINGS.has(tail) &&
        HANGUL.test(lastChars[lastChars.length - 2]) &&
        total - 1 >= CATCHPHRASE_MIN_CORE)
        tokens[tokens.length - 1] = lastChars.slice(0, -1).join('');
    const core = tokens.join('');
    if ([...core].length < CATCHPHRASE_MIN_CORE)
        return null;
    return { core, tokens };
}
const patternCache = new Map();
/** 본문에서 말버릇을 찾는 정규식. 앞은 단어 시작, 뒤는 (종결어미 하나 +) 단어 끝이어야 한다. */
function patternFor(phrase) {
    const key = normalize(phrase);
    if (patternCache.has(key))
        return patternCache.get(key);
    const shape = coreShape(phrase);
    let pattern = null;
    if (shape) {
        // 같은 단어 안의 한글 음절 사이에는 띄어쓰기만, 원래 단어 사이에는 공백·문장부호를 허용한다.
        const body = shape.tokens
            .map((token) => {
            const chars = [...token];
            return chars
                .map((ch, i) => escapeChar(ch) + (i < chars.length - 1 && HANGUL.test(ch) && HANGUL.test(chars[i + 1]) ? '\\s*' : ''))
                .join('');
        })
            .join('[^\\p{L}\\p{N}]*');
        const lastChar = [...shape.core].at(-1) ?? '';
        // 앞쪽 경계는 lookbehind 대신 접두 그룹으로 확인한다(구형 브라우저 호환).
        pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${body}${HANGUL.test(lastChar) ? `${TEXT_ENDING}?` : ''}(?![\\p{L}\\p{N}])`, 'gu');
    }
    if (patternCache.size > 500)
        patternCache.clear();
    patternCache.set(key, pattern);
    return pattern;
}
/**
 * 말버릇의 핵심 구절. 공백·문장부호를 빼고 끝의 종결어미 하나를 뗀 글자열이다.
 * "같이 가자!" → "같이가", "같이 가!" → "같이가". 너무 짧으면 빈 문자열.
 */
export function catchphraseCore(phrase) {
    return coreShape(phrase)?.core ?? '';
}
/** 글에서 말버릇이 몇 번 나오는지(겹치지 않게). 핵심 구절이 없으면 0. */
export function countCatchphrase(text, phrase) {
    const pattern = patternFor(phrase);
    const source = normalize(text);
    if (!pattern || !source)
        return 0;
    pattern.lastIndex = 0;
    let count = 0;
    for (const _ of source.matchAll(pattern))
        count++;
    return count;
}
/** 두 구절이 같은 핵심 구절을 쓰는지. 후렴과 말버릇의 겹침 검사용("유하야, 같이 가자!" ↔ "같이 가!"). */
export function sharesCore(a, b) {
    const ca = catchphraseCore(a);
    const cb = catchphraseCore(b);
    if (!ca || !cb)
        return false;
    return ca === cb || countCatchphrase(a, b) > 0 || countCatchphrase(b, a) > 0;
}
/** 핵심 구절이 같은 말버릇은 하나로 합친다(빈 값·너무 짧은 값 제외). 순서는 처음 나온 순서. */
export function uniqueCatchphrases(phrases) {
    const seen = new Set();
    const out = [];
    for (const phrase of phrases ?? []) {
        const text = String(phrase ?? '').trim();
        const core = catchphraseCore(text);
        if (!core || seen.has(core))
            continue;
        seen.add(core);
        out.push(text);
    }
    return out;
}
/**
 * 여러 글(비트 요약, 쪽 글 등)에서 말버릇마다 총 횟수를 센다. 총 횟수가 minCount 이상인 말버릇만 돌려준다.
 * 같은 핵심 구절의 말버릇은 한 번만 센다.
 */
export function catchphraseRepeats(texts, phrases, minCount = CATCHPHRASE_LIMIT + 1) {
    const rows = [];
    for (const phrase of uniqueCatchphrases(phrases)) {
        const at = [];
        let count = 0;
        (texts ?? []).forEach((text, index) => {
            const n = countCatchphrase(text, phrase);
            if (n > 0) {
                count += n;
                at.push(index);
            }
        });
        if (count >= minCount)
            rows.push({ phrase, core: catchphraseCore(phrase), count, at });
    }
    return rows;
}
/**
 * 줄거리 프롬프트의 등장인물 줄에 붙는 말버릇 구절(앞의 ", " 포함). 전부 조건부다.
 * - 말버릇이 있으면: `, 말버릇 "X"(책 전체에서 최대 1번, 꼭 쓰지 않아도 된다. 후렴으로 쓰지 않는다)`
 * - 최근 책과 돌려 쓰느라 뺐으면: `, 이번 책에서는 말버릇을 쓰지 않는다`
 * - 둘 다 아니면 빈 문자열(빈 `말버릇 ""`을 남기지 않는다).
 * - short=true면 긴 제한 문장 대신 `(최대 1번)`만 붙인다. 한 프롬프트에서 긴 문장은 한 번만 쓴다(catchphraseClauses).
 */
export function catchphraseClause(phrase, omitted = false, short = false) {
    if (omitted)
        return `, ${CATCHPHRASE_OMIT_KO}`;
    const text = oneLine(phrase);
    return text ? `, 말버릇 "${text}"(${short ? CATCHPHRASE_SHORT_KO : CATCHPHRASE_ONCE_KO})` : '';
}
/**
 * 한 프롬프트의 등장인물들(프롬프트에 나오는 순서) 말버릇 구절. 말버릇이 있는 첫 인물에게만 긴 제한 문장을 붙이고
 * 나머지는 `(최대 1번)`만 붙인다. 인물이 많아도 줄거리 프롬프트가 길어져 참고 예시가 빠지지 않게 한다.
 */
export function catchphraseClauses(characters) {
    let fullUsed = false;
    return (characters ?? []).map((character) => {
        const clause = catchphraseClause(character?.catchphrase, character?.catchphraseOmitted === true, fullUsed);
        if (clause && character?.catchphraseOmitted !== true)
            fullUsed = true;
        return clause;
    });
}
const beatLabels = (ids) => ids.map((n) => `비트 ${n}`).join('·');
/**
 * plotCheck 수정 항목: 말버릇이 책 전체에서 2회 이상. 앱의 부분 수정(fixedBeatIds)이 고칠 비트를 알 수 있게
 * 비트 번호마다 "비트 N"을 붙인다. 말버릇의 줄바꿈은 한 칸으로 줄여 항목이 항상 한 줄이다.
 */
export function catchphraseRepeatFix(phrase, count, beatIds, inRefrain = false) {
    return `말버릇 "${oneLine(phrase)}" ${count}회(책 전체 최대 ${CATCHPHRASE_LIMIT}회${inRefrain ? ', 후렴 포함' : ''})${beatIds.length ? `: ${beatLabels(beatIds)}` : ''} — 한 곳만 남기고 나머지는 다른 말로 바꾼다`;
}
/** plotCheck 수정 항목: 후렴이 말버릇과 같은 핵심 구절을 쓴다. 후렴·말버릇의 줄바꿈은 한 칸으로 줄인다. */
export function refrainOverlapFix(refrain, phrase, beatIds) {
    return `후렴 "${oneLine(refrain)}"이(가) 말버릇 "${oneLine(phrase)}"과(와) 같은 구절을 씀 — 후렴을 다른 말로 바꾼다${beatIds.length ? `: ${beatLabels(beatIds)}` : ''}`;
}
/** 말버릇 검사에서 나온 수정 항목인지. 앱은 이 항목을 차단 사유가 아닌 권고로 다룬다. 줄바꿈이 섞여도 알아본다. */
export function isCatchphraseFix(message) {
    const text = String(message ?? '');
    return /^말버릇 "[\s\S]*?" \d+회\(책 전체 최대 \d+회/u.test(text) || /^후렴 "[\s\S]*?"이\(가\) 말버릇 "[\s\S]*?"과\(와\) 같은 구절을 씀/u.test(text);
}
