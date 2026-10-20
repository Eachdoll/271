/**
 * 전체 흐름 예시 — 앱의 1단계(줄거리)와 2단계(전문)를 이 패키지로 바꿀 때의 호출 순서.
 * Codex는 이 파일을 참고해 기존 StoryOutline/StoryProse 생성 코드를 교체하면 된다.
 */
import type { BookRecord, GestureDictionary, Inventories, LevelSpecEn, LevelSpecKo, PlotPatternCard, StoryOutline, TextEngine } from './types.js';
import type { WorldCard } from './worlds.js';
import { type BackgroundType, type StorySeed } from './composeSeed.js';
import { type Character } from './outlinePrompt.js';
import type { ExampleStyle } from './retrieval.js';
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
    endingType: 'home_sleep' | 'open' | 'custom';
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
    /** 반복 검사에 쓸 말버릇. 없으면 등장인물의 catchphrase(돌려 쓰느라 뺀 인물 포함)를 쓴다. */
    catchphrases?: string[];
    /**
     * true면 말버릇 항목만으로는 유료 수정 호출을 하지 않는다. 항목은 check.fix에 남아 호출자가 권고로 다룬다.
     * 다른 수정 항목과 함께 있으면 같은 수정 호출에 넣는다. 앱은 true, 평가 하네스·CLI는 기본(false).
     */
    advisoryCatchphrases?: boolean;
    /**
     * true면 R9 이전(r8) 요청을 글자 그대로 보낸다: 등장인물 줄에 사용 한도 문구가 없고, 말버릇 반복 검사를 하지 않아
     * 수정 호출에도 말버릇 항목이 없다. 말버릇 정책 없이 고정된 앱의 기존 초안이 완료한 유료 호출을 재결제하지 않게 한다.
     */
    legacyCatchphrasePrompt?: boolean;
    /** R19 뼈대 카드 예시('arc')와 점수 하한. 없으면 예전 예시 문안 그대로. */
    exampleStyle?: ExampleStyle;
    exampleMinRubric?: number;
    /** R19: 참고 예시를 줄이기 시작하는 대략 토큰 예산(기본 1,800). 뼈대 카드는 더 길어 앱이 올려 준다. */
    exampleTokenBudget?: number;
    /**
     * true면 2026-10-19 견고성 수정 이전의 검사(plotCheck legacyChecks)를 쓴다. 앱이 그 이전에 저장된 유료 체크포인트를 이어 갈 때만 켠다:
     * 검사 결과가 바뀌면 수정 호출 요청이 달라져 이미 산 응답을 다시 쓰지 못하기 때문이다.
     */
    legacyChecks?: boolean;
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
/**
 * 모델이 plan.planted를 시드 재료가 든 설명 문장으로 쓰면("엄마의 커다란 무늬 모자는 안쪽 띠가 좁다. …")
 * 시드 재료 이름으로 되돌린다. 시드 재료가 들어 있지 않은 다른 물건이면 그대로 두어 검사가 잡게 한다.
 */
export declare function plantedFromSeed(outline: StoryOutline, seed: {
    planted?: {
        ko?: string;
    };
} | undefined): StoryOutline;
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
    /** true면 규칙 9(말버릇 한도)가 없는 r8 풍부 쓰기 문안을 쓴다(앱의 기존 초안 재결제 방지). */
    legacyCatchphrasePrompt?: boolean;
    /** R19: 단순화·고침·압축 때 줄이지 말아야 할 줄(뼈대). 없으면 문안 그대로. */
    keepLines?: string;
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
