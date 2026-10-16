/**
 * 조합형 생성 — 창의성을 모델이 아니라 코드의 무작위 조합이 맡는다.
 * 인벤토리에서 심을 물건·장애물(또는 장소)·반전·생물·웃음·실패 이유를 뽑아 비트 슬롯을 채운다.
 * 모델은 그 재료로 문장만 쓴다. 같은 시드면 같은 재료가 나와 재현·디버깅이 쉽다.
 */
import type { Bi, FailureReason, Inventories, PlotPatternCard } from './types.js';
import type { BanList } from './banList.js';
import type { WorldCard } from './worlds.js';
export type BackgroundType = 'home' | 'kindergarten' | 'forest' | 'sea' | 'dino_land' | 'sky' | (string & {});
export interface StorySeed {
    patternId: string;
    planted: Bi;
    /** 여정형·찾기형에서 attempt 비트 수만큼. 다른 패턴에선 장소 후보로만 쓰인다. */
    obstacles: {
        id: string;
        ko: string;
        en: string;
        sense: string;
        sound: string;
    }[];
    twist: {
        id: string;
        ko: string;
        en: string;
        hint: string;
    };
    creature: Bi;
    humor: Bi;
    subLocations: Bi[];
    failureReasons: FailureReason[];
    rngSeed: number;
}
export interface ComposeOptions {
    pattern: PlotPatternCard;
    inventories: Inventories;
    backgroundType: BackgroundType;
    rngSeed: number;
    ban?: BanList;
    /** 주제에 어울리는 장애물/장소를 우선하고 싶을 때 (예: 비 → puddle, mud). */
    preferObstacleIds?: string[];
    /** 세계 카드가 있으면 세부 장소·생물·심을 물건을 그 세계에서 우선 뽑는다. */
    world?: WorldCard;
    /** 심을 물건·생물에 색/크기/성격 변형을 붙일 확률(0~1). 기본 0.35. inventories.variantRules 가 있을 때만. */
    variantChance?: number;
}
/** 물건에 색(색 붙일 수 있는 물건이면) 또는 크기 변형을, 생물에 성격 변형을 붙인다. 이미 붙어 있으면 그대로. */
export declare function applyVariant(rng: () => number, item: Bi, kind: 'object' | 'creature', rules: NonNullable<Inventories['variantRules']>): Bi;
export declare function composeSeed(opts: ComposeOptions): StorySeed;
/** 프롬프트의 [정해진 재료] 블록. outline.v3.md의 {{seed.*}} 자리에 그대로 들어간다. */
export declare function renderSeedForPrompt(seed: StorySeed, inv: Inventories, pattern: PlotPatternCard): string;
/** 주제 키워드 → 어울리는 장애물 id (비·물·바람·밤 등). 없으면 빈 배열. */
export declare function preferObstaclesForTopic(topic: string): string[];
