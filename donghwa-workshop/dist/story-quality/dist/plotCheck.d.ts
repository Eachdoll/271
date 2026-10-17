/**
 * 인과 검사기 — 모델 호출 없이 줄거리 JSON을 검사한다 (지시서 4의 3절 + 금지 목록 + 조합 재료 준수).
 */
import type { Inventories, StoryOutline } from './types.js';
import type { StorySeed } from './composeSeed.js';
import type { BanList } from './banList.js';
export interface PlotCheckResult {
    ok: boolean;
    /** 수정 패스로 넘길 항목 */
    fix: string[];
    /** 재생성이 필요한 항목 */
    regenerate: string[];
}
export interface PlotCheckInput {
    outline: StoryOutline;
    topic: string;
    protagonistName: string;
    seed?: StorySeed;
    ban?: BanList;
    inventories?: Inventories;
}
export declare function topicKeywords(topic: string): string[];
/** 키워드가 글에 있는지. 3자 이상 키워드는 앞 2자 접두 일치도 인정한다("멋진지" → "멋진"). */
export declare function topicMentioned(text: string, topic: string): boolean;
/** 전체 표기나 머리 명사를 조사 단위로 비교한다. 긴 이름의 일부는 재료로 보지 않는다. */
export declare function containsPlanted(text: string, planted: string): boolean;
export declare function plotCheck(input: PlotCheckInput): PlotCheckResult;
/** 수정 패스에 넣을 지시문. 지적된 항목만 고치게 한다. */
export declare function renderFixInstructions(result: PlotCheckResult): string;
