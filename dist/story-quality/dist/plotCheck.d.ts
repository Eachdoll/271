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
    /** 등장인물 말버릇. 비트 요약+후렴에서 2회 이상이거나 후렴과 핵심 구절을 공유하면 수정 항목. */
    catchphrases?: string[];
    /**
     * true면 2026-10-19 견고성 수정 이전의 검사를 그대로 쓴다(실패 이유 정규화, 금지 소재 부분 문자열 비교, 주제 키워드).
     * 앱은 이 규칙 표시가 없는 저장된 유료 체크포인트를 이어 갈 때만 켜서, 검사 결과가 바뀌어 수정 호출 요청이 달라지지 않게 한다.
     */
    legacyChecks?: boolean;
}
export declare function topicKeywords(topic: string): string[];
/** 키워드가 글에 있는지. 3자 이상 키워드는 앞 2자 접두 일치도 인정한다("멋진지" → "멋진"). */
export declare function topicMentioned(text: string, topic: string): boolean;
/**
 * 앱의 주제 낱말(storyTopicKeywords)처럼 한 글자 명사도 주제 낱말로 본다("달에 놀러 간 날"의 "달", "비 오는 날"의 "비").
 * topicKeywords는 세계 카드 추천에도 쓰이므로 그대로 두고, 검사에서만 낱말 첫머리 일치로 더 본다.
 */
export declare function shortTopicNouns(topic: string): string[];
/** 주제가 비트에 있는지: 기존 키워드 비교 + 한 글자 주제 명사의 낱말 첫머리 일치. */
export declare function topicCovered(text: string, topic: string): boolean;
/**
 * 금지 소재가 글에 있는지. legacy면 예전처럼 부분 문자열로 찾는다.
 * 아니면 낱말 첫머리에서만 찾고, 일상 문맥 항목(때리·쫓아와·칼로)은 그 문장이 일상 문맥이면 넘긴다.
 */
export declare function forbiddenHit(text: string, keyword: string, legacy?: boolean): boolean;
/**
 * 모델이 planted를 "커다란 등불: 거실에 있던 …"처럼 설명과 함께 쓰는 경우가 많다.
 * 설명 구분자(: — ( . 줄바꿈) 앞의 명사구만 쓰고, 뒤의 수량("한 송이")은 뺀다.
 */
export declare function plantedPhrase(planted: string): string;
/** 전체 표기나 머리 명사를 조사 단위로 비교한다. 긴 이름의 일부는 재료로 보지 않는다. 한 글자 머리 명사("빵")도 조사 경계로만 찾는다. */
export declare function containsPlanted(text: string, planted: string): boolean;
/**
 * 모델이 failureReason을 한글 설명("거의 됐는데 방해: …")이나 다른 표기("Wrong place", "wrong-method")로 쓰는 경우가 많아 ID로 정규화한다.
 * legacy면 2026-10-19 이전 규칙만 쓴다.
 */
export declare function normalizeFailureReason(value: unknown, legacy?: boolean): string | null;
export declare function plotCheck(input: PlotCheckInput): PlotCheckResult;
/** 수정 패스에 넣을 지시문. 지적된 항목만 고치게 한다. */
export declare function renderFixInstructions(result: PlotCheckResult): string;
