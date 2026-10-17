/**
 * 풍부하게 쓰고 단순화 — 전문을 처음부터 K1으로 쓰지 않고 한 단계 위(K2~K3)로 넉넉히 쓴 뒤,
 * 보급형 모델에게 목표 수준으로 줄이게 한다. 작은 모델은 "단순하게 창작"보다 "있는 글을 단순화"를 훨씬 잘한다.
 */
import type { GestureDictionary, LevelSpecEn, LevelSpecKo, TextEngine } from "./types.js";
export type Lang = "ko" | "en";
export interface RichSimplifyInput {
    engine: TextEngine;
    simplifyEngine?: TextEngine;
    lang: Lang;
    charactersCompact: string;
    beatsCompact: string;
    briefsCompact: string;
    emotions: string[];
    gestureDict: GestureDictionary;
    targetLevel: LevelSpecKo | LevelSpecEn;
    richLevel: LevelSpecKo | LevelSpecEn;
    refrainText?: string;
    refrainBeats?: number[];
    styleSamples?: string[];
    vocabLabel?: string;
    decodable?: boolean;
    presentTenseOnly?: boolean;
    twoPass?: boolean;
    /** 책 쪽 수. 주어지면 단순화 단계에 전체 문장 수 예산(쪽 수 × 목표 수준의 쪽당 문장)을 건다. */
    pageCount?: number;
    /** 예산을 20% 넘으면 비트별 압축 1회(호출자가 선택). 앱 r8은 새 K1/E0 초안에서 언어별 기본 켬. */
    condenseOverBudget?: boolean;
    onPass?: (pass: "rich" | "simplify" | "fix" | "condense", text: string) => void;
}
export interface RichSimplifyResult {
    rich: string;
    simplified: string;
    tellHitsAfter: number;
    /** 예산이 있을 때 최종 문장 수와 압축 단계 실행 여부 */
    sentenceCount?: number;
    condensed?: boolean;
    calls: number;
    costUsd: number;
}
/** 한 단계 위 수준 라벨: K1→K2, K2→K3, K3→K4 / E0→E2, E1→E2, E2→E3, E3→E4 */
export declare const RICH_LEVEL_OF: Record<string, string>;
export declare function writeRichThenSimplify(input: RichSimplifyInput): Promise<RichSimplifyResult>;
/** 라벨을 뺀 문장 수. 따옴표 대화도 한 문장으로 센다. */
export declare function countSentences(text: string): number;
/** 전체 문장 예산: 쪽 수 × 쪽당 문장 범위. 쪽 수가 없으면 null(기존 동작). */
export declare function sentenceBudget(level: LevelSpecKo | LevelSpecEn, pageCount?: number): {
    min: number;
    max: number;
} | null;
export declare function countDialogue(text: string): number;
