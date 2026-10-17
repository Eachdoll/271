/**
 * 조합 확장 — 손으로 쓴 인벤토리를 코드가 곱한다.
 *  - expandInventory(): 색·크기 × 물건, 성격 × 생물 → 물건 1,000+, 생물 2,000+ (중복 없이, 결정적)
 *  - applyOverlay(): 세계 카드 × 계절 × 낮/밤 → 세계 100 × 8 = 800가지 모습
 *  - generateTopics(): 세계 × 활동 틀 → 주제 1,000+ (패턴 자동 배정)
 * 원칙: 조합은 '아이가 아는 것 × 아이가 아는 것'만. 말이 안 되는 조합은 규칙(colorableSuffixes)으로 막는다.
 */
import type { Bi, Inventories } from './types.js';
import type { WorldCard, WorldLibrary } from './worlds.js';
import { josa } from './util.js';
export { josa };
export interface VariantRules {
    objectColors: Bi[];
    colorableSuffixes: string[];
    objectSizes: Bi[];
    creatureTraits: Bi[];
}
export interface ExpandedInventory {
    plantedObjects: Bi[];
    creatures: Bi[];
    counts: {
        baseObjects: number;
        objects: number;
        baseCreatures: number;
        creatures: number;
    };
}
export declare function expandInventory(inv: Inventories & {
    variantRules?: VariantRules;
}): ExpandedInventory;
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type TimeOfDay = 'day' | 'night';
export interface Overlays {
    seasons: Record<Season, {
        ko: string;
        weather: Bi;
        props: Bi[];
        creatures: Bi[];
        sounds: Bi[];
        styleHint: string;
        paletteShift: string[];
    }>;
    times: Record<TimeOfDay, {
        ko: string;
        light: Bi;
        props?: Bi[];
        creatures?: Bi[];
        sounds?: Bi[];
        styleHint: string;
        paletteShift?: string[];
    }>;
    noSeasonEras: string[];
    noSeasonWorldIds: string[];
}
export interface WorldState extends WorldCard {
    season: Season | null;
    timeOfDay: TimeOfDay;
    weather: Bi | null;
    light: Bi;
    stateLabel: {
        ko: string;
        en: string;
    };
}
/** 세계 카드에 계절·시간을 얹는다. 계절이 없는 세계(우주·상상)는 season=null. */
export declare function applyOverlay(lib: WorldLibrary & {
    overlays?: Overlays;
}, world: WorldCard, season: Season | null, timeOfDay: TimeOfDay): WorldState;
export declare function allWorldStates(lib: WorldLibrary & {
    overlays?: Overlays;
}): WorldState[];
/** "{creature:와}" 같은 자리에 조사를 맞춰 채운다. */
export declare function fillKo(template: string, map: Record<string, string>): string;
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
export declare const TOPIC_TEMPLATES: TopicTemplate[];
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
export declare function generateTopics(lib: WorldLibrary, opts?: {
    perWorld?: number;
    exclude?: string[];
    seed?: number;
}): GeneratedTopic[];
