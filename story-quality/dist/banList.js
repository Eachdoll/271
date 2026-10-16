import { cleanKoLabel, unique } from './util.js';
export function buildBanList(records, opts = {}) {
    const n = opts.recentBooks ?? 10;
    const np = opts.recentBooksForPattern ?? 3;
    let list = records.filter((r) => r.approved);
    if (opts.sameSeriesOnly)
        list = list.filter((r) => r.seriesId === opts.sameSeriesOnly);
    list = [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const recent = list.slice(0, n);
    const recentP = list.slice(0, np);
    return {
        plantedObjects: unique(recent.map((r) => r.usedElements.planted).filter(Boolean)),
        creatures: unique(recent.flatMap((r) => r.usedElements.creatures ?? [])),
        twistTypes: unique(recent.map((r) => r.usedElements.twistTypeId ?? '').filter(Boolean)),
        patterns: unique(recentP.map((r) => r.usedElements.patternId ?? r.patternId).filter(Boolean)),
        places: unique(recent.flatMap((r) => r.usedElements.places ?? [])),
    };
}
/**
 * 프롬프트의 [이번에 쓰지 않는 것] 한 줄. 비어 있으면 빈 문자열(코드가 줄을 지운다).
 * 조합 재료(seed)가 이미 금지 항목을 피해 뽑히므로, 프롬프트에는 짧은 상기용으로만 넣는다(기본 물건 6·생물 5·반전 3, 장소는 생략).
 */
export function renderBanListForPrompt(ban, inventories, max = { planted: 6, creatures: 5, twists: 3, places: 0 }) {
    const parts = [];
    if (ban.plantedObjects.length && max.planted)
        parts.push(`물건: ${ban.plantedObjects.slice(0, max.planted).join(', ')}`);
    if (ban.creatures.length && max.creatures)
        parts.push(`생물: ${ban.creatures.slice(0, max.creatures).join(', ')}`);
    if (ban.twistTypes.length && inventories && max.twists) {
        const names = ban.twistTypes.slice(0, max.twists).map((id) => inventories.twistTypes.find((t) => t.id === id)?.ko ?? id);
        parts.push(`반전 유형: ${names.join(', ')}`);
    }
    if (ban.places.length && max.places)
        parts.push(`장소: ${ban.places.slice(0, max.places).join(', ')}`);
    return parts.join(' / ');
}
/** 인벤토리에서 금지 항목을 뺀다. 다 빠지면(금지가 전부면) 원본을 돌려줘 생성이 멈추지 않게 한다. */
/** 머리 명사: "빨간 우산" → "우산", "나무 방패(장난감)" → "방패". 두 글자 미만이면 전체. */
const COUNTERS = new Set(['짝', '개', '통', '장', '마리', '하나', '한', '두', '세', '권', '병', '송이', '조각', '켤레']);
export function headNoun(ko) {
    const clean = cleanKoLabel(ko);
    const toks = clean.split(/\s+/).filter((t) => !COUNTERS.has(t));
    const last = toks.length ? toks[toks.length - 1] : clean;
    return last.length >= 2 ? last : clean;
}
/** 두 글자 이상 머리 명사를 조사와 함께 찾되 긴 고유명사의 일부는 잡지 않는다. */
export function containsMaterial(text, material) {
    const noun = headNoun(material);
    if (!noun)
        return false;
    const escaped = noun.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const particles = '(?:(?:에게|한테|께서|에서|부터|까지|처럼|보다|이랑|하고|으로|랑|와|과|의|을|를|이|가|은|는|도|만|에|로){1,3})?';
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}${particles}(?=$|[^\\p{L}\\p{N}])`, 'u').test(cleanKoLabel(text));
}
/** 금지 목록과 같은 항목 또는 같은 머리 명사("빨간 우산"이 금지면 "우산"·"파란 우산"도)를 뺀다. 전부 빠지면 원본을 돌려준다. */
export function filterBanned(items, banned) {
    const set = new Set(banned);
    const heads = new Set(banned.map(headNoun));
    const out = items.filter((it) => !set.has(it.ko) && !heads.has(headNoun(it.ko)));
    return out.length > 0 ? out : [...items];
}
export function filterBannedById(items, bannedIds) {
    const set = new Set(bannedIds);
    const out = items.filter((it) => !set.has(it.id));
    return out.length > 0 ? out : [...items];
}
/** 생성 결과가 금지 목록을 어겼는지 (사후 검사). */
export function violatesBanList(outline, ban) {
    const hits = [];
    if (ban.plantedObjects.some((p) => headNoun(p) === headNoun(outline.plan.planted)))
        hits.push(`심은 물건 반복: ${outline.plan.planted}`);
    const all = outline.beats.map((b) => b.summary).join(' ');
    for (const c of ban.creatures)
        if (containsMaterial(all, c))
            hits.push(`생물 반복: ${c}`);
    return hits;
}
