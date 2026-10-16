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
export declare function plotCheck(input: PlotCheckInput): PlotCheckResult;
/** 수정 패스에 넣을 지시문. 지적된 항목만 고치게 한다. */
export declare function renderFixInstructions(result: PlotCheckResult): string;
