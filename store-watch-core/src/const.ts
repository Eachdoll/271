import type { SmartStoreHost } from "./types";

/**
 * 허용된 스토어 도메인.
 *
 * 서버에서 나가는 요청 URL은 항상 이 상수 + 검증된 slug 조합으로만 조립합니다.
 * 사용자 입력 문자열을 그대로 fetch에 넘기지 않아 SSRF를 차단합니다.
 */
export const SMART_STORE_ORIGIN: Record<SmartStoreHost, string> = {
  smartstore: "https://smartstore.naver.com",
  brand: "https://brand.naver.com",
};

/** 입력 URL에서 허용하는 호스트명 → 스토어 종류 매핑 */
export const SMART_STORE_HOSTNAMES: Record<string, SmartStoreHost> = {
  "smartstore.naver.com": "smartstore",
  "m.smartstore.naver.com": "smartstore",
  "brand.naver.com": "brand",
  "m.brand.naver.com": "brand",
};

/** 스토어 ID로 쓸 수 없는 경로 세그먼트 (네이버 예약 경로 및 오입력 방지) */
export const RESERVED_STORE_IDS: ReadonlySet<string> = new Set([
  "i",
  "n",
  "m",
  "www",
  "main",
  "home",
  "products",
  "product",
  "category",
  "best",
  "notice",
  "review",
  "search",
  "event",
  "brand",
  "smartstore",
  "shopping",
  "favorite",
]);

/** 스토어 ID 형식. 영문/숫자로 시작하고 2~40자. */
export const STORE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,39}$/;

/** 기본 조회 개수 */
export const DEFAULT_PRODUCT_LIMIT = 12;

/** 1회 조회 최대 개수 (네이버 부하 및 응답 크기 방어) */
export const MAX_PRODUCT_LIMIT = 40;

/** 네이버 호출 타임아웃 (ms) */
export const UPSTREAM_TIMEOUT_MS = 8_000;

/** 동일 스토어 응답 재사용 시간 (초). 반복 조회로 네이버를 두드리지 않기 위한 캐시. */
export const UPSTREAM_REVALIDATE_SEC = 300;

/** 서버 액션 호출 빈도 제한: windowMs 동안 limit 회 */
export const REQUEST_RATE_LIMIT = { limit: 20, windowMs: 60_000 } as const;

/**
 * 입력 예시로 보여줄 스토어 아이디 형태.
 * 특정 스토어를 기본값으로 넣지 않습니다 — 어떤 스토어를 볼지는 전적으로 사용자가 정합니다.
 */
export const STORE_ID_PLACEHOLDER = "스토어아이디";

/** 입력창/오류 안내에 쓰는 주소 예시 */
export const STORE_URL_EXAMPLE = `https://smartstore.naver.com/${STORE_ID_PLACEHOLDER}`;

/** localStorage 키 */
export const SMART_STORE_STORAGE_KEY = "smartstore:stores";
