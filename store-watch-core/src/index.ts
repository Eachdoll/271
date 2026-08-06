/**
 * 네이버 스마트스토어 최신상품 조회 핵심 로직 — 공개 엔트리.
 *
 * UI·프레임워크에 의존하지 않는 순수 로직만 모여 있습니다.
 * 화면과 저장 방식은 이 위에 자유롭게 얹으면 됩니다.
 */

// 입력 → 스토어 식별자 (외부 요청의 신뢰 경계)
export {
  parseStoreInput,
  toStoreKey,
  buildStoreUrl,
  buildProductUrl,
  type ParseStoreInputResult,
} from "./parseStoreInput";

// 네이버 조회 (폴백 체인 포함)
export {
  fetchLatestProducts,
  setUpstreamFetchInit,
  type SmartStoreClientResult,
} from "./naverClient";

// 응답 해석
export { extractProducts } from "./extractProducts";
export { extractPreloadedState } from "./extractPreloadedState";

// 정렬 · 병합
export { compareByRecency } from "./compareByRecency";
export { mergeStoreFeed } from "./mergeStoreFeed";

// 설정값
export {
  SMART_STORE_ORIGIN,
  SMART_STORE_HOSTNAMES,
  RESERVED_STORE_IDS,
  STORE_ID_PATTERN,
  STORE_ID_PLACEHOLDER,
  STORE_URL_EXAMPLE,
  DEFAULT_PRODUCT_LIMIT,
  MAX_PRODUCT_LIMIT,
  UPSTREAM_TIMEOUT_MS,
  UPSTREAM_REVALIDATE_SEC,
  REQUEST_RATE_LIMIT,
  SMART_STORE_STORAGE_KEY,
} from "./const";

// 타입
export type {
  SmartStoreHost,
  SmartStoreRef,
  SmartStoreInfo,
  SmartStoreProduct,
  SmartStoreFeedProduct,
  SmartStoreSnapshot,
  SmartStoreErrorCode,
  FetchLatestProductsResult,
  StoredSmartStore,
} from "./types";
