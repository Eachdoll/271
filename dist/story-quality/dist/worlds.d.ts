/**
 * 세계 카드 — data/worlds.json. 조합형 생성(composeSeed)과 줄거리 프롬프트([세계관 핵심])에 재료를 준다.
 * 세계는 현재 여러 나라·과거·미래·상상이 섞여 있고, 거실 소파 뒤 모험터널이 공통 출입구다.
 */
import type { Bi } from './types.js';
export type Era = 'present' | 'past' | 'future' | 'fantasy';
export interface WorldCard {
    id: string;
    name: Bi;
    era: Era;
    region: string;
    needsPortal: boolean;
    arrival: string;
    landmarks: Bi[];
    subLocations: Bi[];
    creatures: Bi[];
    props: Bi[];
    sounds: Bi[];
    palette: string[];
    styleHint: string;
    rules: string[];
    avoid: string[];
    returnCue: string;
}
export interface WorldLibrary {
    version: string;
    portal: Bi;
    worlds: WorldCard[];
}
export declare function findWorld(lib: WorldLibrary, id: string): WorldCard | undefined;
/** 프롬프트의 [세계관 핵심] 3줄 — 세계 카드에서 자동으로 만든다. */
export declare function worldCoreLines(lib: WorldLibrary, world: WorldCard & {
    stateLabel?: {
        ko: string;
    };
    weather?: {
        ko: string;
    } | null;
    light?: {
        ko: string;
    };
}): string[];
/** 그림 프롬프트용 세계 묘사 한 줄(영어). 지시서 3의 ImagePromptBuilder 6번 자리에 넣는다. */
export declare function worldStyleLine(world: WorldCard): string;
/** 시리즈 다양성: 최근 쓴 세계를 피해 시대별로 고르게. 주제 키워드로 어울리는 세계를 우선한다. */
export declare function suggestWorlds(lib: WorldLibrary, opts?: {
    topic?: string;
    recentWorldIds?: string[];
    era?: Era;
    k?: number;
}): WorldCard[];
/** 증류·평가용: 시대별로 번갈아 세계를 돌린다(round-robin). */
export declare function cycleWorldsByEra(lib: WorldLibrary, n: number, startSeed?: number): WorldCard[];
