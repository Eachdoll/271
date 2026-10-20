/**
 * outline.v3 프롬프트 조립 — 패턴 카드 + 조합 재료 + 승인 예시 + 금지 목록 + 규칙을 한 번에 채운다.
 * 반환값을 그대로 TextEngine.complete에 넘기면 된다.
 */
import type { Inventories, PlotPatternCard, BookRecord } from './types.js';
import type { BanList } from './banList.js';
import type { StorySeed } from './composeSeed.js';
import type { ExampleStyle } from './retrieval.js';
export interface Character {
    name: string;
    traits: string[];
    catchphrase?: string;
    /** 최근 책과 돌려 쓰느라 이번 책에서는 말버릇을 쓰지 않는다. true면 catchphrase가 있어도 프롬프트에 넣지 않는다. */
    catchphraseOmitted?: boolean;
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
    endingType: 'home_sleep' | 'open' | 'custom';
    rules?: string[];
    banExamples?: string[];
    exampleCount?: number;
    excludeBookIds?: string[];
    /** R19: 'arc'면 참고 예시를 뼈대 카드(위기·바닥·반전·되돌아옴)로 그린다. 없으면 예전 한 줄 비트 목록(바이트 동일). */
    exampleStyle?: ExampleStyle;
    /** R19: 이 점수 미만의 증류 예시는 후보에서 뺀다(점수 없는 골드는 유지). */
    exampleMinRubric?: number;
    /**
     * true면 R9 이전(r8) 등장인물 줄을 글자 그대로 쓴다: 말버릇 사용 한도 문구 없음, 주인공은 빈 말버릇도 `말버릇 ""`로.
     * 말버릇 정책 없이 고정된 앱의 기존 초안이 같은 요청을 보내 완료한 유료 호출을 다시 결제하지 않게 한다.
     */
    legacyCatchphrasePrompt?: boolean;
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
