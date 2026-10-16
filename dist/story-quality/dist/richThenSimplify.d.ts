/**
 * 풍부하게 쓰고 단순화 — 전문을 처음부터 K1으로 쓰지 않고 한 단계 위(K2~K3)로 넉넉히 쓴 뒤,
 * 보급형 모델에게 목표 수준으로 줄이게 한다. 작은 모델은 "단순하게 창작"보다 "있는 글을 단순화"를 훨씬 잘한다.
 */
import type { GestureDictionary, LevelSpecEn, LevelSpecKo, TextEngine } from './types.js';
export type Lang = 'ko' | 'en';
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
    twoPass?: boolean;
    onPass?: (pass: 'rich' | 'simplify' | 'fix', text: string) => void;
}
export interface RichSimplifyResult {
    rich: string;
    simplified: string;
    tellHitsAfter: number;
    calls: number;
    costUsd: number;
}
/** 한 단계 위 수준 라벨: K1→K2, K2→K3, K3→K4 / E0→E2, E1→E2, E2→E3, E3→E4 */
export declare const RICH_LEVEL_OF: Record<string, string>;
export declare function writeRichThenSimplify(input: RichSimplifyInput): Promise<RichSimplifyResult>;
export declare function countDialogue(text: string): number;
