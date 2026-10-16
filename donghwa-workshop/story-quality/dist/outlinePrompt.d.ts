/**
 * outline.v3 프롬프트 조립 — 패턴 카드 + 조합 재료 + 승인 예시 + 금지 목록 + 규칙을 한 번에 채운다.
 * 반환값을 그대로 TextEngine.complete에 넘기면 된다.
 */
import type { Inventories, PlotPatternCard, BookRecord } from './types.js';
import type { BanList } from './banList.js';
import type { StorySeed } from './composeSeed.js';
export interface Character {
    name: string;
    traits: string[];
    catchphrase?: string;
    role?: string;
}
export interface OutlinePromptInput {
    protagonist: Character;
    supporting: Character[];
    worldCore: string[];
    topic: string;
    value?: string;
    levelKo: string;
    levelEn: string;
    pages: number;
    pattern: PlotPatternCard;
    seed: StorySeed;
    inventories: Inventories;
    ban: BanList;
    approvedBooks: BookRecord[];
    endingType: 'home_sleep' | 'open';
    rules?: string[];
    banExamples?: string[];
    exampleCount?: number;
    excludeBookIds?: string[];
}
export declare const BEATS_FOR_PAGES: Record<number, number>;
export declare function beatCountForPages(pages: number): number;
export declare function buildOutlinePrompt(input: OutlinePromptInput): {
    system: string;
    user: string;
    temperature: number;
    maxTokens: number;
};
/** 대략적인 토큰 수(한글 1자≈1토큰, 영어 4자≈1토큰). 1,800 넘으면 예시를 줄이라는 경고용. */
export declare function roughTokenCount(text: string): number;
