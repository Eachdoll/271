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
/** Generator-only usage means from distill/runs/2026-10-17/outlines.jsonl.
 * Opus 39 rows; Sonnet 161 rows. Output includes billed thinking tokens.
 * Fix/judge usage is estimated separately; original row.usage records the generator only.
 */
export declare const DISTILL_USAGE_PROFILES: Record<string, {
    input: number;
    output: number;
    fixRate: number;
}>;
export declare function estimateDistillCost(cells: number, promptTokens: number, price: {
    input: number;
    output: number;
}, judgePrice: {
    input: number;
    output: number;
}, model?: string): {
    tokensIn: number;
    tokensOut: number;
    usd: number;
    breakdown: {
        gen: number;
        fix: number;
        judge: number;
    };
    model: string | undefined;
    basis: string;
};
