/** 의존성 없는 공용 유틸: 시드 난수, JSON 추출, 한국어 토큰화, 유사도. */
/** mulberry32 — 같은 시드면 같은 수열. 조합형 생성의 재현성용. */
export function makeRng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/** 문자열 → 32bit 해시 (bookId → 시드). */
export function hashString(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}
export function pick(rng, items) {
    if (items.length === 0)
        throw new Error('pick: empty list');
    return items[Math.floor(rng() * items.length)];
}
export function pickDistinct(rng, items, n, key = (t) => JSON.stringify(t)) {
    const pool = [...items];
    const out = [];
    const seen = new Set();
    while (out.length < n && pool.length > 0) {
        const i = Math.floor(rng() * pool.length);
        const [it] = pool.splice(i, 1);
        const k = key(it);
        if (seen.has(k))
            continue;
        seen.add(k);
        out.push(it);
    }
    return out;
}
export function shuffle(rng, items) {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
/**
 * 모델 출력에서 JSON을 꺼낸다. ```json 펜스, 앞뒤 잡담, 첫 { 또는 [ 부터 짝이 맞는 곳까지.
 * 실패하면 null.
 */
export function extractJson(text) {
    if (!text)
        return null;
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidates = [fenced ? fenced[1] : '', text];
    for (const c of candidates) {
        const s = c.trim();
        if (!s)
            continue;
        const start = Math.min(...['{', '['].map((ch) => (s.indexOf(ch) === -1 ? Infinity : s.indexOf(ch))));
        if (!isFinite(start))
            continue;
        const slice = balancedSlice(s, start);
        if (!slice)
            continue;
        try {
            return JSON.parse(slice);
        }
        catch {
            /* try next */
        }
    }
    return null;
}
function balancedSlice(s, start) {
    const open = s[start];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
            if (esc)
                esc = false;
            else if (ch === '\\')
                esc = true;
            else if (ch === '"')
                inStr = false;
            continue;
        }
        if (ch === '"')
            inStr = true;
        else if (ch === '{' || ch === '[')
            depth++;
        else if (ch === '}' || ch === ']') {
            depth--;
            if (depth === 0)
                return s.slice(start, i + 1);
        }
    }
    return null;
}
/** 한국어·영어 공용 토큰: 어절(공백 분리) + 한글 2음절 n-gram. 형태소 분석기 없이 비슷한 글을 찾는 용도. */
export function tokenize(text) {
    const out = new Set();
    const cleaned = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ');
    for (const w of cleaned.split(/\s+/)) {
        if (!w)
            continue;
        out.add(w);
        if (/[가-힣]/.test(w)) {
            for (let i = 0; i + 2 <= w.length; i++)
                out.add('~' + w.slice(i, i + 2));
        }
    }
    return out;
}
export function jaccard(a, b) {
    if (a.size === 0 && b.size === 0)
        return 1;
    let inter = 0;
    for (const t of a)
        if (b.has(t))
            inter++;
    return inter / (a.size + b.size - inter);
}
/** 문장 분리(한·영). 따옴표 안의 마침표는 대충 무시해도 검사 목적엔 충분하다. */
export function splitSentences(text) {
    return text
        .replace(/\[[^\]]*\]/g, ' ') // 비트 라벨 제거
        .split(/(?<=[.!?。])\s+|\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
}
export function includesAny(text, needles) {
    for (const n of needles)
        if (n && text.includes(n))
            return n;
    return null;
}
export function unique(xs) {
    return [...new Set(xs)];
}
