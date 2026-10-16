/**
 * 루브릭 판정기 — 지시서 4의 5항목(사건성·인과·반복·반전·구체성) 0~2점.
 * 증류 필터(≥8점만 저장)와 평가 하네스(버전 비교) 양쪽에서 쓴다. 보급형 모델로 충분하다.
 */
import type { StoryOutline, TextEngine } from '../types.js';
export interface RubricScores {
    event: number;
    causality: number;
    repetition: number;
    twist: number;
    concreteness: number;
}
export interface RubricResult {
    scores: RubricScores;
    total: number;
    pass: boolean;
    worst2: string[];
    fixes: string[];
    raw?: unknown;
    costUsd: number;
}
export declare const RUBRIC_SYSTEM = "\uB108\uB294 \uADF8\uB9BC\uCC45 \uD3B8\uC9D1\uC790\uB2E4. 3~7\uC138 \uADF8\uB9BC\uCC45 \uC904\uAC70\uB9AC\uB97C \uC544\uB798 5\uD56D\uBAA9\uC73C\uB85C 0~2\uC810 \uCC44\uC810\uD55C\uB2E4. \uAD00\uB300\uD558\uC9C0 \uB9D0\uACE0, \uADFC\uAC70\uB97C \uBE44\uD2B8 \uBC88\uD638\uB85C \uB304\uB2E4. JSON\uC73C\uB85C\uB9CC \uB2F5\uD55C\uB2E4.";
export declare const RUBRIC_USER = "[\uC904\uAC70\uB9AC JSON]\n{{outline}}\n\n[\uCC44\uC810 \uAE30\uC900]\n- event(\uC0AC\uAC74\uC131): 0 = \uC0C1\uD669\uC774 \uBC14\uB00C\uC9C0 \uC54A\uB294 \uBE44\uD2B8\uAC00 2\uAC1C \uC774\uC0C1 / 1 = 1\uAC1C / 2 = \uBAA8\uB4E0 \uBE44\uD2B8\uC5D0\uC11C \uC0C1\uD669\uC774 \uBC14\uB010\uB2E4\n- causality(\uC778\uACFC): 0 = \uBE44\uD2B8 \uC21C\uC11C\uB97C \uBC14\uAFD4\uB3C4 \uB9D0\uC774 \uB41C\uB2E4 / 1 = \uC77C\uBD80\uB9CC \uC774\uC5B4\uC9C4\uB2E4 / 2 = \uC55E \uBE44\uD2B8\uC758 \uACB0\uACFC\uAC00 \uB2E4\uC74C \uBE44\uD2B8\uC758 \uC6D0\uC778\uC774\uB2E4\n- repetition(\uBC18\uBCF5): 0 = \uC758\uB3C4\uD558\uC9C0 \uC54A\uC740 \uBC18\uBCF5 \uBB38\uC7A5\u00B7\uAF2C\uB9AC\uB9D0\uC774 \uC788\uB2E4 / 1 = \uAC19\uC740 \uBB38\uD615\uC774 \uB208\uC5D0 \uB748\uB2E4 / 2 = \uD6C4\uB834 \uC678 \uBC18\uBCF5\uC774 \uC5C6\uB2E4\n- twist(\uBC18\uC804): 0 = \uBC18\uC804\uC774 \uC5C6\uAC70\uB098 \uC55E\uACFC \uBB34\uAD00 / 1 = \uBC18\uC804\uC740 \uC788\uC73C\uB098 \uC2EC\uC740 \uAC83\uACFC \uC57D\uD558\uAC8C \uC5F0\uACB0 / 2 = \uC55E\uC5D0 \uC2EC\uC740 \uAC83\uC774 \uC7AC\uD574\uC11D\uB41C\uB2E4\n- concreteness(\uAD6C\uCCB4\uC131): 0 = \uCD94\uC0C1\uC5B4\u00B7\uC77C\uBC18 \uBA85\uC0AC \uC704\uC8FC / 1 = \uC808\uBC18\uCBE4 \uAD6C\uCCB4\uC801 / 2 = \uBB3C\uAC74\u00B7\uC7A5\uC18C\u00B7\uC0DD\uBB3C\uC774 \uAD6C\uCCB4\uC801\uC774\uB2E4\n\n[\uCD9C\uB825] JSON\uB9CC.\n{\"scores\": {\"event\": 0, \"causality\": 0, \"repetition\": 0, \"twist\": 0, \"concreteness\": 0},\n \"worst2\": [\"\uAC00\uC7A5 \uB0AE\uC740 \uD56D\uBAA9 2\uAC1C \uC774\uB984\"],\n \"fixes\": [\"\uBE44\uD2B8 n: \uACE0\uCE60 \uB0B4\uC6A9 \uD55C \uC904\", \"...\"]}";
export declare function judgeOutline(engine: TextEngine, outline: StoryOutline): Promise<RubricResult>;
