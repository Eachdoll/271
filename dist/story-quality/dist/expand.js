import { cleanKoLabel, hashString, josa, makeRng, pickDistinct } from './util.js';
export { josa };
/** 영어 관사 정리: "a yellow umbrella" + "red" → "a red yellow umbrella"가 되지 않게 원 관사를 떼고 다시 붙인다. */
function stripArticle(en) {
    return en.replace(/^(a|an|the)\s+/i, '');
}
function withArticle(en) {
    return /^[aeiou]/i.test(en) ? `an ${en}` : `a ${en}`;
}
export function expandInventory(inv) {
    const rules = inv.variantRules;
    const objects = [...inv.plantedObjects];
    const seenO = new Set(objects.map((o) => o.ko));
    const creatures = [...inv.creatures];
    const seenC = new Set(creatures.map((c) => c.ko));
    if (rules) {
        for (const o of inv.plantedObjects) {
            const colorable = rules.colorableSuffixes.some((s) => o.ko.endsWith(s));
            // 이미 색이 붙은 물건("빨간 장화")은 색을 또 붙이지 않는다
            const hasColor = rules.objectColors.some((c) => o.ko.startsWith(c.ko));
            if (colorable && !hasColor) {
                for (const c of rules.objectColors) {
                    const ko = `${c.ko} ${o.ko}`;
                    if (seenO.has(ko))
                        continue;
                    seenO.add(ko);
                    objects.push({ ko, en: withArticle(`${c.en} ${stripArticle(o.en)}`) });
                }
            }
            for (const s of rules.objectSizes) {
                const ko = `${s.ko} ${o.ko}`;
                if (seenO.has(ko))
                    continue;
                seenO.add(ko);
                objects.push({ ko, en: `${s.en} ${stripArticle(o.en)}` });
            }
        }
        for (const c of inv.creatures) {
            const hasTrait = rules.creatureTraits.some((t) => c.ko.startsWith(t.ko));
            if (hasTrait)
                continue;
            for (const t of rules.creatureTraits) {
                const ko = `${t.ko} ${c.ko}`;
                if (seenC.has(ko))
                    continue;
                seenC.add(ko);
                creatures.push({ ko, en: withArticle(`${t.en} ${stripArticle(c.en)}`) });
            }
        }
    }
    return { plantedObjects: objects, creatures, counts: { baseObjects: inv.plantedObjects.length, objects: objects.length, baseCreatures: inv.creatures.length, creatures: creatures.length } };
}
/** 세계 카드에 계절·시간을 얹는다. 계절이 없는 세계(우주·상상)는 season=null. */
export function applyOverlay(lib, world, season, timeOfDay) {
    const ov = lib.overlays;
    const noSeason = !ov || ov.noSeasonEras.includes(world.era) || ov.noSeasonWorldIds.includes(world.id);
    const s = !noSeason && season && ov ? ov.seasons[season] : null;
    const t = ov ? ov.times[timeOfDay] : null;
    const props = [...world.props, ...(s?.props ?? []), ...(t?.props ?? [])];
    const creatures = [...world.creatures, ...(s?.creatures ?? []), ...(t?.creatures ?? [])];
    const sounds = [...world.sounds, ...(s?.sounds ?? []), ...(t?.sounds ?? [])];
    const palette = [...world.palette.slice(0, 3), ...(s?.paletteShift ?? []), ...(t?.paletteShift ?? [])].slice(0, 6);
    const styleHint = [world.styleHint, s?.styleHint, t?.styleHint].filter(Boolean).join(', ');
    const seasonKo = s ? s.ko : '';
    const timeKo = t ? t.ko : timeOfDay === 'night' ? '밤' : '낮';
    return {
        ...world,
        props,
        creatures,
        sounds,
        palette,
        styleHint,
        season: s ? season : null,
        timeOfDay,
        weather: s ? s.weather : null,
        light: t ? t.light : { ko: timeKo, en: timeOfDay },
        stateLabel: { ko: `${seasonKo ? seasonKo + ' ' : ''}${timeKo}`, en: `${s ? season + ' ' : ''}${timeOfDay}` },
    };
}
export function allWorldStates(lib) {
    const out = [];
    const seasons = ['spring', 'summer', 'autumn', 'winter'];
    for (const w of lib.worlds) {
        const ov = lib.overlays;
        const noSeason = !ov || ov.noSeasonEras.includes(w.era) || ov.noSeasonWorldIds.includes(w.id);
        const ss = noSeason ? [null] : seasons;
        for (const s of ss)
            for (const t of ['day', 'night'])
                out.push(applyOverlay(lib, w, s, t));
    }
    return out;
}
/** 괄호 설명("(장난감)")은 주제 문장에서 뺀다. */
function cleanName(s) {
    return cleanKoLabel(s);
}
/** "{creature:와}" 같은 자리에 조사를 맞춰 채운다. */
export function fillKo(template, map) {
    return template.replace(/\{(\w+)(?::(와|을|이|은|로))?\}/g, (_, k, p) => {
        const v = cleanName(map[k] ?? '');
        return p ? v + josa(v, p) : v;
    });
}
const NO_SKY = ['undersea_city', 'underwater_volcano_lab', 'space_station', 'star_cruiser_garden', 'moon_base'];
const NO_RAIN = [...NO_SKY, 'mars_base', 'mars_greenhouse_town'];
export const TOPIC_TEMPLATES = [
    // 여정·반복
    { id: 'j1', patternId: 'journey_repeat', ko: '{landmark}까지 가는 길', keywordsFrom: ['landmark'] },
    { id: 'j2', patternId: 'journey_repeat', ko: '{creature:을} 만나러 가기', keywordsFrom: ['creature'] },
    { id: 'j3', patternId: 'journey_repeat', ko: '{prop:을} 들고 {sub}까지', keywordsFrom: ['prop', 'sub'] },
    { id: 'j4', patternId: 'journey_repeat', ko: '{world}에서 {creature}에게 {prop} 가져다주기', keywordsFrom: ['creature', 'prop'], value: '나눔' },
    { id: 'j5', patternId: 'journey_repeat', ko: '길 잃은 {creature:을} 집까지 데려다주기', keywordsFrom: ['creature'], value: '돕기' },
    { id: 'j6', patternId: 'journey_repeat', ko: '{sub}에서 {landmark}까지 편지 전하기', keywordsFrom: ['sub', 'landmark'] },
    // 쌓기
    { id: 'a1', patternId: 'accumulate', ko: '{sub}에서 {prop} 하나씩 모으기', keywordsFrom: ['prop', 'sub'] },
    { id: 'a2', patternId: 'accumulate', ko: '{creature}에게 줄 선물 모으기', keywordsFrom: ['creature'], value: '나눔' },
    { id: 'a3', patternId: 'accumulate', ko: '{landmark} 앞에서 생일 준비', keywordsFrom: ['landmark'] },
    { id: 'a4', patternId: 'accumulate', ko: '{world}의 소리 모으기', keywordsFrom: ['sound', 'world'] },
    { id: 'a5', patternId: 'accumulate', ko: '{creature}네 소풍 가방 채우기', keywordsFrom: ['creature'] },
    { id: 'a6', patternId: 'accumulate', ko: '{sub}에서 {creature:와} 함께 탑 쌓기', keywordsFrom: ['sub', 'creature'], value: '협동' },
    // 찾기·오답
    { id: 's1', patternId: 'search_wrong_answers', ko: '{sub}에서 잃어버린 {prop}', keywordsFrom: ['prop', 'sub'] },
    { id: 's2', patternId: 'search_wrong_answers', ko: '숨어 버린 {creature} 찾기', keywordsFrom: ['creature'] },
    { id: 's3', patternId: 'search_wrong_answers', ko: '{landmark} 어딘가의 {prop}', keywordsFrom: ['landmark', 'prop'] },
    { id: 's4', patternId: 'search_wrong_answers', ko: '{creature:이} 잃어버린 {prop} 찾아주기', keywordsFrom: ['creature', 'prop'], value: '돕기' },
    { id: 's5', patternId: 'search_wrong_answers', ko: '{world}에서 {sound} 소리의 주인 찾기', keywordsFrom: ['sound', 'world'] },
    // 기다리기
    { id: 'w1', patternId: 'waiting', ko: '{sub}에서 엄마 기다리기', keywordsFrom: ['sub'] },
    { id: 'w2', patternId: 'waiting', ko: '{creature:이} 돌아올 때까지', keywordsFrom: ['creature'] },
    { id: 'w3', patternId: 'waiting', ko: '{landmark}에서 해 지기 기다리기', keywordsFrom: ['landmark'], avoidWorldIds: NO_SKY },
    { id: 'w4', patternId: 'waiting', ko: '{sub}에서 비 그치기 기다리기', keywordsFrom: ['sub'], avoidWorldIds: NO_RAIN },
    { id: 'w5', patternId: 'waiting', ko: '{creature:와} 함께 {prop} 차례 기다리기', keywordsFrom: ['creature', 'prop'], value: '차례' },
    // 점점 커지기
    { id: 'e1', patternId: 'escalation', ko: '{creature:와} 누가 더 높이', keywordsFrom: ['creature'] },
    { id: 'e2', patternId: 'escalation', ko: '{creature:와} 누가 더 조용히', keywordsFrom: ['creature'] },
    { id: 'e3', patternId: 'escalation', ko: '{creature:와} 누가 더 멋진 {prop}', keywordsFrom: ['creature', 'prop'] },
    { id: 'e4', patternId: 'escalation', ko: '{sub}에서 누가 더 멀리 보나', keywordsFrom: ['sub'] },
    { id: 'e5', patternId: 'escalation', ko: '{creature:와} 누가 더 크게 웃나', keywordsFrom: ['creature'] },
    { id: 'e6', patternId: 'escalation', ko: '{landmark} 앞에서 {creature:와} 숨바꼭질', keywordsFrom: ['landmark', 'creature'] },
    // 수상한 소리
    { id: 'm1', patternId: 'mystery_sound', ko: '{sub}에서 들리는 {sound} 소리', keywordsFrom: ['sound', 'sub'] },
    { id: 'm2', patternId: 'mystery_sound', ko: '밤에 {landmark}에서 나는 소리', keywordsFrom: ['landmark'] },
    { id: 'm3', patternId: 'mystery_sound', ko: '{prop:이} 내는 이상한 소리', keywordsFrom: ['prop'] },
    { id: 'm4', patternId: 'mystery_sound', ko: '{creature}네 집에서 나는 {sound} 소리', keywordsFrom: ['creature', 'sound'] },
    { id: 'm5', patternId: 'mystery_sound', ko: '{sub} 상자 속에서 나는 소리', keywordsFrom: ['sub'] },
];
/**
 * 세계 × 틀 → 주제. perWorld개씩(기본 12 = 패턴 6 × 2), 세계 카드의 항목을 결정적으로 뽑는다.
 * 100세계 × 12 = 1,200주제. 제외 목록(평가 세트·골드 주제)은 그대로 걸러낸다.
 */
export function generateTopics(lib, opts = {}) {
    const per = opts.perWorld ?? 12;
    const exclude = new Set(opts.exclude ?? []);
    const out = [];
    const seen = new Set();
    for (const w of lib.worlds) {
        const rng = makeRng((opts.seed ?? 1) ^ hashString(w.id));
        const allowed = TOPIC_TEMPLATES.filter((t) => !t.avoidWorldIds?.includes(w.id));
        const tpl = pickDistinct(rng, allowed, per, (t) => t.id);
        // 패턴 균형: 각 패턴 최소 1개 — 빠진 패턴은 가장 많이 뽑힌 패턴의 틀 하나를 바꿔 넣는다.
        const PATTERNS = ['journey_repeat', 'accumulate', 'search_wrong_answers', 'waiting', 'escalation', 'mystery_sound'];
        for (const pid of PATTERNS) {
            if (tpl.some((t) => t.patternId === pid))
                continue;
            const cand = allowed.filter((t) => t.patternId === pid && !tpl.includes(t));
            if (!cand.length)
                continue;
            const counts = new Map();
            for (const t of tpl)
                counts.set(t.patternId, (counts.get(t.patternId) ?? 0) + 1);
            const most = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
            const idx = tpl.findIndex((t) => t.patternId === most);
            tpl[idx] = cand[Math.floor(rng() * cand.length)];
        }
        const usedTpl = new Set(tpl.map((t) => t.id));
        const tryFill = (t) => {
            // 같은 문장이 다른 세계에서 이미 나왔으면(같은 생물·소품을 공유) 재료를 다시 뽑아 본다
            for (let attempt = 0; attempt < 4; attempt++) {
                const landmark = w.landmarks[Math.floor(rng() * w.landmarks.length)].ko;
                const sub = w.subLocations[Math.floor(rng() * w.subLocations.length)].ko;
                const creature = w.creatures[Math.floor(rng() * w.creatures.length)].ko;
                const prop = w.props[Math.floor(rng() * w.props.length)].ko;
                const sound = w.sounds[Math.floor(rng() * w.sounds.length)].ko;
                const fillMap = { landmark, sub, creature, prop, sound, world: w.name.ko };
                const topic = fillKo(t.ko, fillMap).replace(/\s{2,}/g, ' ').trim();
                if (seen.has(topic) || exclude.has(topic))
                    continue;
                return { topic, keywords: t.keywordsFrom.map((k) => cleanName(fillMap[k] ?? '')).filter(Boolean) };
            }
            return null;
        };
        for (let t of tpl) {
            let filled = tryFill(t);
            if (!filled) {
                // 그래도 겹치면 같은 패턴의 안 쓴 틀로 바꾼다
                const alt = allowed.filter((x) => x.patternId === t.patternId && !usedTpl.has(x.id));
                for (const x of alt) {
                    filled = tryFill(x);
                    if (filled) {
                        t = x;
                        usedTpl.add(x.id);
                        break;
                    }
                }
            }
            if (!filled)
                continue;
            seen.add(filled.topic);
            out.push({ id: `g-${w.id}-${t.id}`, topic: filled.topic, worldId: w.id, patternId: t.patternId, keywords: filled.keywords, value: t.value ?? null, templateId: t.id });
        }
    }
    return out;
}
