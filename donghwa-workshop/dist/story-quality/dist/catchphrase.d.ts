/**
 * 말버릇(캐치프레이즈) 비교 — 앱과 패키지가 같은 규칙으로 센다. 의존성 없음(브라우저에서도 그대로 쓴다).
 *
 * - NFC·소문자로 맞추고 공백·문장부호는 무시한다: "같이 가자!" = "같이 가자" = "같이가자".
 * - 끝의 한국어 종결어미 하나(자·요·야 …)는 떼고 비교한다: "같이 가!" = "같이 가자!" = "같이 가요".
 * - 단어 경계를 지킨다: "같이 가방", "같이 가자고"는 같은 말버릇으로 세지 않는다.
 * - 뜻만 같은 다른 표현("함께 가자")은 같은 말버릇으로 치지 않는다.
 * - 핵심 구절이 2글자보다 짧으면("응!") 세지 않는다(과잉 일치 방지).
 */
/** 핵심 구절의 최소 길이(글자). 이보다 짧으면 세지 않는다. */
export declare const CATCHPHRASE_MIN_CORE = 2;
/** 말버릇 사용 한도(책 전체). */
export declare const CATCHPHRASE_LIMIT = 1;
/** 줄거리 프롬프트의 등장인물 줄에 붙는 제한 문구. */
export declare const CATCHPHRASE_ONCE_KO = "\uCC45 \uC804\uCCB4\uC5D0\uC11C \uCD5C\uB300 1\uBC88, \uAF2D \uC4F0\uC9C0 \uC54A\uC544\uB3C4 \uB41C\uB2E4. \uD6C4\uB834\uC73C\uB85C \uC4F0\uC9C0 \uC54A\uB294\uB2E4";
/** 최근 책에서 썼으므로 이번 책에서 뺄 때의 문구. */
export declare const CATCHPHRASE_OMIT_KO = "\uC774\uBC88 \uCC45\uC5D0\uC11C\uB294 \uB9D0\uBC84\uB987\uC744 \uC4F0\uC9C0 \uC54A\uB294\uB2E4";
/** 전문 단계 규칙 한 줄(한글). */
export declare const CATCHPHRASE_RULE_KO = "\uB9D0\uBC84\uB987\uC740 \uCC45 \uC804\uCCB4\uC5D0\uC11C \uCD5C\uB300 1\uBC88\uB9CC \uC4F0\uACE0, \uAF2D \uC4F0\uC9C0 \uC54A\uC544\uB3C4 \uB41C\uB2E4. \uD6C4\uB834\uC73C\uB85C \uC4F0\uC9C0 \uC54A\uB294\uB2E4.";
/** 전문 단계 규칙 한 줄(영어). */
export declare const CATCHPHRASE_RULE_EN = "Use each character's catchphrase at most once in the whole book, or not at all.";
/**
 * 말버릇의 핵심 구절. 공백·문장부호를 빼고 끝의 종결어미 하나를 뗀 글자열이다.
 * "같이 가자!" → "같이가", "같이 가!" → "같이가". 너무 짧으면 빈 문자열.
 */
export declare function catchphraseCore(phrase: unknown): string;
/** 글에서 말버릇이 몇 번 나오는지(겹치지 않게). 핵심 구절이 없으면 0. */
export declare function countCatchphrase(text: unknown, phrase: unknown): number;
/** 두 구절이 같은 핵심 구절을 쓰는지. 후렴과 말버릇의 겹침 검사용("유하야, 같이 가자!" ↔ "같이 가!"). */
export declare function sharesCore(a: unknown, b: unknown): boolean;
/** 핵심 구절이 같은 말버릇은 하나로 합친다(빈 값·너무 짧은 값 제외). 순서는 처음 나온 순서. */
export declare function uniqueCatchphrases(phrases: readonly unknown[]): string[];
export interface CatchphraseRepeat {
    phrase: string;
    core: string;
    /** 모든 글에서 나온 총 횟수 */
    count: number;
    /** 한 번 이상 나온 글의 위치(0부터) */
    at: number[];
}
/**
 * 여러 글(비트 요약, 쪽 글 등)에서 말버릇마다 총 횟수를 센다. 총 횟수가 minCount 이상인 말버릇만 돌려준다.
 * 같은 핵심 구절의 말버릇은 한 번만 센다.
 */
export declare function catchphraseRepeats(texts: readonly unknown[], phrases: readonly unknown[], minCount?: number): CatchphraseRepeat[];
/**
 * 줄거리 프롬프트의 등장인물 줄에 붙는 말버릇 구절(앞의 ", " 포함). 전부 조건부다.
 * - 말버릇이 있으면: `, 말버릇 "X"(책 전체에서 최대 1번, 꼭 쓰지 않아도 된다. 후렴으로 쓰지 않는다)`
 * - 최근 책과 돌려 쓰느라 뺐으면: `, 이번 책에서는 말버릇을 쓰지 않는다`
 * - 둘 다 아니면 빈 문자열(빈 `말버릇 ""`을 남기지 않는다).
 */
export declare function catchphraseClause(phrase?: string | null, omitted?: boolean): string;
/**
 * plotCheck 수정 항목: 말버릇이 책 전체에서 2회 이상. 앱의 부분 수정(fixedBeatIds)이 고칠 비트를 알 수 있게
 * 비트 번호마다 "비트 N"을 붙인다.
 */
export declare function catchphraseRepeatFix(phrase: string, count: number, beatIds: readonly number[], inRefrain?: boolean): string;
/** plotCheck 수정 항목: 후렴이 말버릇과 같은 핵심 구절을 쓴다. */
export declare function refrainOverlapFix(refrain: string, phrase: string, beatIds: readonly number[]): string;
/** 말버릇 검사에서 나온 수정 항목인지. 앱은 수정 패스 뒤에도 남은 말버릇 항목을 차단 사유가 아닌 권고로 다룬다. */
export declare function isCatchphraseFix(message: unknown): boolean;
