/**
 * 아이 시뮬레이터 — 보급형 모델을 '비평가'로 쓴다.
 *  1) curiosityCheck: 쪽마다 "다음 쪽이 궁금한가" 0~2점 → 0점 쪽만 재작성
 *  2) retellCheck: 4세 아이의 세 문장 되말하기 → want/turn/resolution이 빠지면 두서없는 이야기
 */
import type { Beat, TextEngine } from './types.js';
export interface PageText {
    pageNo: number;
    text: string;
}
export interface CuriosityResult {
    pages: {
        pageNo: number;
        score: 0 | 1 | 2;
        childQuestion: string | null;
        why: string;
    }[];
    dropPages: number[];
    overall: number;
    pass: boolean;
    costUsd: number;
}
export declare function curiosityCheck(engine: TextEngine, pages: PageText[]): Promise<CuriosityResult>;
export interface RetellResult {
    retell: string[];
    coveredBeats: number[];
    missingCore: string[];
    /** 모델이 적었지만 핵심 유형이 아닌 누락(참고용) */
    notedMissing: string[];
    confusions: string[];
    coherence: number;
    pass: boolean;
    /** turn이 빠졌으면 전문의 turn 문단 재작성 권고 */
    recommendTurnRewrite: boolean;
    costUsd: number;
}
export declare function retellCheck(engine: TextEngine, prose: string, beats: Beat[]): Promise<RetellResult>;
