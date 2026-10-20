/**
 * 승인 줄거리 검색 few-shot — "우리 집에서 통과한 예시"를 새 주제와 가장 비슷한 것 2개 골라 프롬프트에 넣는다.
 * 임베딩 없이 토큰 Jaccard + 패턴·수준 일치로 점수를 낸다. 20편쯤 쌓이면 충분히 잘 맞는다.
 */
import type { BookRecord } from './types.js';
export interface RetrievalQuery {
    topic: string;
    patternId?: string;
    levelKo?: string;
    /** 같은 시리즈의 직전 편은 '이어 만들기' 맥락에서 따로 들어가므로 제외. */
    excludeBookIds?: string[];
}
export interface ScoredRecord {
    record: BookRecord;
    score: number;
}
/** 2026-10-20 R19: 'arc' renders each example as a story-spine card (stakes, rising tries, low point, turn, payoff). */
export type ExampleStyle = 'arc';
export interface RetrieveOptions {
    /** Keep only records whose rubricTotal is at least this (records without a score, e.g. gold, are kept). */
    minRubric?: number;
}
export declare function scoreRecord(record: BookRecord, q: RetrievalQuery): number;
export declare function retrieveExamples(records: BookRecord[], q: RetrievalQuery, k?: number, opts?: RetrieveOptions): ScoredRecord[];
/**
 * 프롬프트용 렌더. 비트는 한 줄 요약(첫 문장)만 넣어 길이를 줄인다.
 * 라벨은 고정: 구조·리듬만 참고, 재사용 금지.
 */
export declare function renderExamplesForPrompt(examples: ScoredRecord[], maxCharsEach?: number, style?: ExampleStyle): string;
