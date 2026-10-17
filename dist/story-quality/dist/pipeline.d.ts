/**
 * 전체 흐름 예시 — 앱의 1단계(줄거리)와 2단계(전문)를 이 패키지로 바꿀 때의 호출 순서.
 * Codex는 이 파일을 참고해 기존 StoryOutline/StoryProse 생성 코드를 교체하면 된다.
 */
import type { BookRecord, GestureDictionary, Inventories, LevelSpecEn, LevelSpecKo, PlotPatternCard, StoryOutline, TextEngine } from './types.js';
import type { WorldCard } from './worlds.js';
import { type BackgroundType, type StorySeed } from './composeSeed.js';
import { type Character } from './outlinePrompt.js';
import { plotCheck } from './plotCheck.js';
import { type PageText } from './childSimulator.js';
export interface Engines {
    outline: TextEngine;
    prose: TextEngine;
    cheap: TextEngine;
}
export interface OutlineStageInput {
    engines: Engines;
    bookId: string;
    protagonist: Character;
    supporting: Character[];
    worldCore: string[];
    topic: string;
    value?: string;
    levelKo: string;
    levelEn: string;
    pages: number;
    pattern: PlotPatternCard;
    backgroundType: BackgroundType;
    inventories: Inventories;
    approvedBooks: BookRecord[];
    endingType: 'home_sleep' | 'open';
    rules?: string[];
    banExamples?: string[];
    /** 보급형 모델로 줄거리를 만들 때 ON 권장 */
    useBeamSearch?: boolean;
    seriesId?: string;
    banWindow?: number;
    patternBanWindow?: number;
    excludeBookIds?: string[];
    referenceBooks?: BookRecord[];
    world?: WorldCard;
    variantChance?: number;
}
export interface OutlineStageResult {
    outline: StoryOutline;
    check: ReturnType<typeof plotCheck>;
    seedSummary: string;
    seed: StorySeed;
    calls: number;
    costUsd: number;
}
export declare function runOutlineStage(input: OutlineStageInput): Promise<OutlineStageResult>;
export interface ProseStageInput {
    engines: Engines;
    lang: 'ko' | 'en';
    outline: StoryOutline;
    charactersCompact: string;
    briefsCompact: string;
    emotions: string[];
    gestureDict: GestureDictionary;
    levels: Record<string, LevelSpecKo | LevelSpecEn>;
    targetLevelId: string;
    styleSamples?: string[];
    vocabLabel?: string;
    twoPass?: boolean;
    /** 책 쪽 수. 전체 문장 예산에 쓴다. */
    pageCount?: number;
    condenseOverBudget?: boolean;
}
export declare function runProseStage(input: ProseStageInput): Promise<import("./richThenSimplify.js").RichSimplifyResult>;
/** 쪽 나누기 뒤 게이트: 호기심 + 되말하기. 둘 다 보급형(하) 엔진. */
export declare function runChildGate(engines: Engines, pages: PageText[], prose: string, outline: StoryOutline): Promise<{
    curiosity: import("./childSimulator.js").CuriosityResult;
    retell: import("./childSimulator.js").RetellResult;
    pass: boolean;
    rewritePages: number[];
    rewriteTurnParagraph: boolean;
    costUsd: number;
}>;
