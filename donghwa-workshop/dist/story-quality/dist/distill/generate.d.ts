import type { BookRecord, Inventories, PlotPatternCard, StoryOutline, TextEngine } from '../types.js';
import type { WorldLibrary } from '../worlds.js';
import { type Character } from '../outlinePrompt.js';
export interface DistillTopic {
    id: string;
    topic: string;
    worldId: string;
    patternId: string;
    keywords?: string[];
    value?: string | null;
}
export interface DistillConfig {
    generator: TextEngine;
    judge: TextEngine;
    fixer?: TextEngine;
    topics: DistillTopic[];
    levels: {
        levelKo: string;
        levelEn: string;
    }[];
    pages: number;
    patterns: PlotPatternCard[];
    worlds: WorldLibrary;
    inventories: Inventories;
    protagonist: Character;
    supporting: Character[];
    outPath: string;
    /** 주제당 변형 수(시드만 다르게). 기본 1. 400편이 필요하면 50주제 × 2수준 × 4변형 */
    variantsPerCell?: number;
    /** 승인 예시 검색에 쓸 기존 승인 책(골드 등). 없으면 데이터셋 안에서 자란다. */
    seedBooks?: BookRecord[];
    concurrency?: number;
    onSample?: (s: DistillSample) => void;
    dryRun?: boolean;
}
export interface DistillSample {
    sampleId: string;
    topicId: string;
    topic: string;
    worldId: string;
    patternId: string;
    levelKo: string;
    levelEn: string;
    variant: number;
    worldState?: {
        season: string | null;
        timeOfDay: string;
        label: string;
    };
    prompt: {
        system: string;
        user: string;
    };
    outline: StoryOutline | null;
    plotCheck: {
        ok: boolean;
        fix: string[];
        regenerate: string[];
    };
    rubric: {
        total: number;
        pass: boolean;
        scores: Record<string, number>;
    } | null;
    approved: boolean;
    fixed: boolean;
    usage: {
        input: number;
        output: number;
    };
    costUsd: number;
    generatorId: string;
    createdAt: string;
    dryRun?: boolean;
    error?: string;
}
export declare function loadExisting(outPath: string): Map<string, DistillSample>;
export declare function sampleToBookRecord(s: DistillSample): BookRecord | null;
export declare function runDistillation(cfg: DistillConfig): Promise<{
    total: number;
    approved: number;
    costUsd: number;
    skipped: number;
}>;
/** 비용·토큰 추정 (호출 전 표시용). 샘플당 입력≈프롬프트, 출력≈1,200토큰, 수정 30%, 판정 1회. */
export declare function estimateDistillCost(cells: number, promptTokens: number, price: {
    input: number;
    output: number;
}, judgePrice: {
    input: number;
    output: number;
}): {
    tokensIn: number;
    tokensOut: number;
    usd: number;
    breakdown: {
        gen: number;
        fix: number;
        judge: number;
    };
};
