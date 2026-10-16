/**
 * 비트 단위 탐색(빔 서치) — 비트마다 후보 3개를 만들고 심사로 하나를 고르며 나아간다.
 * 작은 모델은 "7비트 전체를 일관되게"보다 "지금 비트 하나를 앞에 이어서"를 훨씬 잘한다.
 * 호출 수: 비트 수 × 2 (생성 + 심사). 모두 짧다.
 */
import type { Beat, Inventories, PlotPatternCard, TextEngine } from './types.js';
import type { StorySeed } from './composeSeed.js';
export interface BeamInput {
    engine: TextEngine;
    /** 심사는 더 싼 엔진을 써도 된다. 없으면 engine 사용. */
    judgeEngine?: TextEngine;
    pattern: PlotPatternCard;
    seed: StorySeed;
    inventories: Inventories;
    topic: string;
    charactersCompact: string;
    banListText: string;
    candidatesPerBeat?: number;
    onProgress?: (beatIndex: number, chosen: Beat, scores: Record<string, number>) => void;
}
export interface BeamResult {
    beats: Beat[];
    calls: number;
    costUsd: number;
}
export declare function generateBeatsWithBeam(input: BeamInput): Promise<BeamResult>;
