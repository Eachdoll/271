/**
 * 주간 코치 패스 — 상위 모델을 매 책이 아니라 주 1회 '규칙 갱신'에만 쓴다.
 * 결과는 제안일 뿐이며, 부모가 승인한 것만 mergeRules로 프롬프트에 반영한다. 규칙 7개·금지 예시 4개 상한은 코드가 강제한다.
 */
import type { BookRecord, TextEngine } from './types.js';
export interface CoachProposal {
    recurringWeaknesses: {
        pattern: string;
        seenIn: string[];
        evidence: string;
    }[];
    proposedBanExamples: {
        text: string;
        replaces: number | null;
    }[];
    proposedRules: {
        text: string;
        replaces: number | null;
        why: string;
    }[];
    patternNotes: {
        patternId: string;
        note: string;
    }[];
    keep: string;
    costUsd: number;
    skipped?: string;
}
export interface CoachInput {
    engine: TextEngine;
    recentBooks: BookRecord[];
    currentRules: string[];
    currentBanExamples: string[];
    minBooks?: number;
}
export declare function runWeeklyCoach(input: CoachInput): Promise<CoachProposal>;
/**
 * 부모가 승인한 제안을 현재 목록에 반영한다. 상한을 넘기지 않는다.
 * replaces가 있으면 그 번호(1-based)를 교체, 없으면 끝에 추가하되 상한을 넘으면 가장 오래된(첫) 항목을 민다.
 */
export declare function mergeRules(current: string[], approved: {
    text: string;
    replaces: number | null;
}[], max: number): string[];
/** 규칙 버전 기록 — 되돌리기용. 앱의 저장소에 그대로 넣으면 된다. */
export interface RuleVersion {
    version: number;
    appliedAt: string;
    rules: string[];
    banExamples: string[];
    rubricAvgBefore?: number;
    rubricAvgAfter?: number;
}
export declare function shouldSuggestRollback(prev: RuleVersion | undefined, current: RuleVersion): boolean;
