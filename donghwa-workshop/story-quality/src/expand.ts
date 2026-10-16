/**
 * 조합 확장 — 손으로 쓴 인벤토리를 코드가 곱한다.
 *  - expandInventory(): 색·크기 × 물건, 성격 × 생물 → 물건 1,000+, 생물 2,000+ (중복 없이, 결정적)
 *  - applyOverlay(): 세계 카드 × 계절 × 낮/밤 → 세계 100 × 8 = 800가지 모습
 *  - generateTopics(): 세계 × 활동 틀 → 주제 1,000+ (패턴 자동 배정)
 * 원칙: 조합은 '아이가 아는 것 × 아이가 아는 것'만. 말이 안 되는 조합은 규칙(colorableSuffixes)으로 막는다.
 */
import type { Bi, Inventories } from './types.js';
import type { WorldCard, WorldLibrary } from './worlds.js';
import { cleanKoLabel, hashString, josa, makeRng, pickDistinct } from './util.js';

export { josa };

export interface VariantRules {
  objectColors: Bi[];
  colorableSuffixes: string[];
  objectSizes: Bi[];
  creatureTraits: Bi[];
}

export interface ExpandedInventory {
  plantedObjects: Bi[]; // 원본 + 변형
  creatures: Bi[];
  counts: { baseObjects: number; objects: number; baseCreatures: number; creatures: number };
}

/** 영어 관사 정리: "a yellow umbrella" + "red" → "a red yellow umbrella"가 되지 않게 원 관사를 떼고 다시 붙인다. */
function stripArticle(en: string): string {
  return en.replace(/^(a|an|the)\s+/i, '');
}
function withArticle(en: string): string {
  return /^[aeiou]/i.test(en) ? `an ${en}` : `a ${en}`;
}

export function expandInventory(inv: Inventories & { variantRules?: VariantRules }): ExpandedInventory {
  const rules = inv.variantRules;
  const objects: Bi[] = [...inv.plantedObjects];
  const seenO = new Set(objects.map((o) => o.ko));
  const creatures: Bi[] = [...inv.creatures];
  const seenC = new Set(creatures.map((c) => c.ko));
  if (rules) {
    for (const o of inv.plantedObjects) {
      const colorable = rules.colorableSuffixes.some((s) => o.ko.endsWith(s));
      // 이미 색이 붙은 물건("빨간 장화")은 색을 또 붙이지 않는다
      const hasColor = rules.objectColors.some((c) => o.ko.startsWith(c.ko));
      if (colorable && !hasColor) {
        for (const c of rules.objectColors) {
          const ko = `${c.ko} ${o.ko}`;
          if (seenO.has(ko)) continue;
          seenO.add(ko);
          objects.push({ ko, en: withArticle(`${c.en} ${stripArticle(o.en)}`) });
        }
      }
      for (const s of rules.objectSizes) {
        const ko = `${s.ko} ${o.ko}`;
        if (seenO.has(ko)) continue;
        seenO.add(ko);
        objects.push({ ko, en: `${s.en} ${stripArticle(o.en)}` });
      }
    }
    for (const c of inv.creatures) {
      const hasTrait = rules.creatureTraits.some((t) => c.ko.startsWith(t.ko));
      if (hasTrait) continue;
      for (const t of rules.creatureTraits) {
        const ko = `${t.ko} ${c.ko}`;
        if (seenC.has(ko)) continue;
        seenC.add(ko);
        creatures.push({ ko, en: withArticle(`${t.en} ${stripArticle(c.en)}`) });
      }
    }
  }
  return { plantedObjects: objects, creatures, counts: { baseObjects: inv.plantedObjects.length, objects: objects.length, baseCreatures: inv.creatures.length, creatures: creatures.length } };
}

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type TimeOfDay = 'day' | 'night';

export interface Overlays {
  seasons: Record<Season, { ko: string; weather: Bi; props: Bi[]; creatures: Bi[]; sounds: Bi[]; styleHint: string; paletteShift: string[] }>;
  times: Record<TimeOfDay, { ko: string; light: Bi; props?: Bi[]; creatures?: Bi[]; sounds?: Bi[]; styleHint: string; paletteShift?: string[] }>;
  noSeasonEras: string[];
  noSeasonWorldIds: string[];
}

export interface WorldState extends WorldCard {
  season: Season | null;
  timeOfDay: TimeOfDay;
  weather: Bi | null;
  light: Bi;
  stateLabel: { ko: string; en: string }; // 예: "봄 밤" / "spring night"
}

/** 세계 카드에 계절·시간을 얹는다. 계절이 없는 세계(우주·상상)는 season=null. */
export function applyOverlay(lib: WorldLibrary & { overlays?: Overlays }, world: WorldCard, season: Season | null, timeOfDay: TimeOfDay): WorldState {
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

export function allWorldStates(lib: WorldLibrary & { overlays?: Overlays }): WorldState[] {
  const out: WorldState[] = [];
  const seasons: (Season | null)[] = ['spring', 'summer', 'autumn', 'winter'];
  for (const w of lib.worlds) {
    const ov = lib.overlays;
    const noSeason = !ov || ov.noSeasonEras.includes(w.era) || ov.noSeasonWorldIds.includes(w.id);
    const ss: (Season | null)[] = noSeason ? [null] : seasons;
    for (const s of ss) for (const t of ['day', 'night'] as TimeOfDay[]) out.push(applyOverlay(lib, w, s, t));
  }
  return out;
}

/** 괄호 설명("(장난감)")은 주제 문장에서 뺀다. */
function cleanName(s: string): string {
  return cleanKoLabel(s);
}

/** "{creature:와}" 같은 자리에 조사를 맞춰 채운다. */
export function fillKo(template: string, map: Record<string, string>): string {
  return template.replace(/\{(\w+)(?::(와|을|이|은|로))?\}/g, (_, k: string, p?: '와' | '을' | '이' | '은' | '로') => {
    const v = cleanName(map[k] ?? '');
    return p ? v + josa(v, p) : v;
  });
}

/** 주제 생성 틀. {landmark} {sub} {creature} {prop} {sound} {world} 자리는 세계 카드에서 채운다. {key:와}처럼 조사를 붙인다. */
export interface TopicTemplate {
  id: string;
  patternId: string;
  ko: string;
  keywordsFrom: ('landmark' | 'sub' | 'creature' | 'prop' | 'sound' | 'world')[];
  value?: string;
  /** 이 틀이 말이 안 되는 세계(바닷속에서 해 지기, 우주에서 비 그치기). */
  avoidWorldIds?: string[];
}

const NO_SKY = ['undersea_city', 'underwater_volcano_lab', 'space_station', 'star_cruiser_garden', 'moon_base'];
const NO_RAIN = [...NO_SKY, 'mars_base', 'mars_greenhouse_town'];

export const TOPIC_TEMPLATES: TopicTemplate[] = [
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

export interface GeneratedTopic {
  id: string;
  topic: string;
  worldId: string;
  patternId: string;
  keywords: string[];
  value: string | null;
  templateId: string;
  season?: Season | null;
  timeOfDay?: TimeOfDay;
}

/**
 * 세계 × 틀 → 주제. perWorld개씩(기본 12 = 패턴 6 × 2), 세계 카드의 항목을 결정적으로 뽑는다.
 * 100세계 × 12 = 1,200주제. 제외 목록(평가 세트·골드 주제)은 그대로 걸러낸다.
 */
export function generateTopics(lib: WorldLibrary, opts: { perWorld?: number; exclude?: string[]; seed?: number } = {}): GeneratedTopic[] {
  const per = opts.perWorld ?? 12;
  const exclude = new Set(opts.exclude ?? []);
  const out: GeneratedTopic[] = [];
  const seen = new Set<string>();
  for (const w of lib.worlds) {
    const rng = makeRng((opts.seed ?? 1) ^ hashString(w.id));
    const allowed = TOPIC_TEMPLATES.filter((t) => !t.avoidWorldIds?.includes(w.id));
    const tpl = pickDistinct(rng, allowed, per, (t) => t.id);
    // 패턴 균형: 각 패턴 최소 1개 — 빠진 패턴은 가장 많이 뽑힌 패턴의 틀 하나를 바꿔 넣는다.
    const PATTERNS = ['journey_repeat', 'accumulate', 'search_wrong_answers', 'waiting', 'escalation', 'mystery_sound'];
    for (const pid of PATTERNS) {
      if (tpl.some((t) => t.patternId === pid)) continue;
      const cand = allowed.filter((t) => t.patternId === pid && !tpl.includes(t));
      if (!cand.length) continue;
      const counts = new Map<string, number>();
      for (const t of tpl) counts.set(t.patternId, (counts.get(t.patternId) ?? 0) + 1);
      const most = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const idx = tpl.findIndex((t) => t.patternId === most);
      tpl[idx] = cand[Math.floor(rng() * cand.length)];
    }
    const usedTpl = new Set(tpl.map((t) => t.id));
    const tryFill = (t: TopicTemplate): { topic: string; keywords: string[] } | null => {
      // 같은 문장이 다른 세계에서 이미 나왔으면(같은 생물·소품을 공유) 재료를 다시 뽑아 본다
      for (let attempt = 0; attempt < 4; attempt++) {
        const landmark = w.landmarks[Math.floor(rng() * w.landmarks.length)].ko;
        const sub = w.subLocations[Math.floor(rng() * w.subLocations.length)].ko;
        const creature = w.creatures[Math.floor(rng() * w.creatures.length)].ko;
        const prop = w.props[Math.floor(rng() * w.props.length)].ko;
        const sound = w.sounds[Math.floor(rng() * w.sounds.length)].ko;
        const fillMap: Record<string, string> = { landmark, sub, creature, prop, sound, world: w.name.ko };
        const topic = fillKo(t.ko, fillMap).replace(/\s{2,}/g, ' ').trim();
        if (seen.has(topic) || exclude.has(topic)) continue;
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
          if (filled) { t = x; usedTpl.add(x.id); break; }
        }
      }
      if (!filled) continue;
      seen.add(filled.topic);
      out.push({ id: `g-${w.id}-${t.id}`, topic: filled.topic, worldId: w.id, patternId: t.patternId, keywords: filled.keywords, value: t.value ?? null, templateId: t.id });
    }
  }
  return out;
}
