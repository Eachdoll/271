/** 의존성 없는 공용 유틸: 시드 난수, JSON 추출, 한국어 토큰화, 유사도. */
/** mulberry32 — 같은 시드면 같은 수열. 조합형 생성의 재현성용. */
export declare function makeRng(seed: number): () => number;
/** 문자열 → 32bit 해시 (bookId → 시드). */
export declare function hashString(s: string): number;
export declare function pick<T>(rng: () => number, items: readonly T[]): T;
export declare function pickDistinct<T>(rng: () => number, items: readonly T[], n: number, key?: (t: T) => string): T[];
export declare function shuffle<T>(rng: () => number, items: readonly T[]): T[];
/**
 * 모델 출력에서 JSON을 꺼낸다. ```json 펜스, 앞뒤 잡담, 첫 { 또는 [ 부터 짝이 맞는 곳까지.
 * 실패하면 null.
 */
export declare function extractJson<T = unknown>(text: string): T | null;
/** 한국어·영어 공용 토큰: 어절(공백 분리) + 한글 2음절 n-gram. 형태소 분석기 없이 비슷한 글을 찾는 용도. */
export declare function tokenize(text: string): Set<string>;
export declare function jaccard(a: Set<string>, b: Set<string>): number;
/** 문장 분리(한·영). 따옴표 안의 마침표는 대충 무시해도 검사 목적엔 충분하다. */
export declare function splitSentences(text: string): string[];
export declare function includesAny(text: string, needles: string[]): string | null;
export declare function unique<T>(xs: T[]): T[];
