import { unique } from './util.js';
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
/** 프롬프트의 [이번에 쓰지 않는 것] 한 줄. 비어 있으면 빈 문자열(코드가 줄을 지운다). */
export function renderBanListForPrompt(ban, inventories) {
    const parts = [];
    if (ban.plantedObjects.length)
        parts.push(`물건: ${ban.plantedObjects.join(', ')}`);
    if (ban.creatures.length)
        parts.push(`생물: ${ban.creatures.join(', ')}`);
    if (ban.twistTypes.length && inventories) {
        const names = ban.twistTypes.map((id) => inventories.twistTypes.find((t) => t.id === id)?.ko ?? id);
        parts.push(`반전 유형: ${names.join(', ')}`);
    }
    if (ban.places.length)
        parts.push(`장소: ${ban.places.join(', ')}`);
    return parts.join(' / ');
}
/** 인벤토리에서 금지 항목을 뺀다. 다 빠지면(금지가 전부면) 원본을 돌려줘 생성이 멈추지 않게 한다. */
export function filterBanned(items, banned) {
    const set = new Set(banned);
    const out = items.filter((it) => !set.has(it.ko));
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
    if (ban.plantedObjects.some((p) => outline.plan.planted.includes(p)))
        hits.push(`심은 물건 반복: ${outline.plan.planted}`);
    const all = outline.beats.map((b) => b.summary).join(' ');
    for (const c of ban.creatures)
        if (all.includes(c))
            hits.push(`생물 반복: ${c}`);
    return hits;
}
