/**
 * 네이버 스마트스토어 최신상품 조회 도메인 타입.
 *
 * 이 기능은 DB에 저장하지 않고 실시간 조회만 수행합니다.
 * 추가한 스토어 목록은 브라우저 localStorage에만 보관됩니다.
 */

/** 스토어 종류. 스마트스토어와 브랜드스토어는 도메인만 다르고 응답 구조가 동일합니다. */
export type SmartStoreHost = "smartstore" | "brand";

/** 스토어를 가리키는 최소 식별 정보 */
export interface SmartStoreRef {
  /** URL 경로 slug. 예: `mystore` */
  storeId: string;
  host: SmartStoreHost;
}

/** 조회된 스토어 메타 정보 */
export interface SmartStoreInfo extends SmartStoreRef {
  /** 스토어 표시명. 조회 실패 시 storeId로 대체됩니다. */
  displayName: string;
  /** 스토어 홈 URL */
  storeUrl: string;
}

/** 정규화된 상품 1건 */
export interface SmartStoreProduct {
  /** 스마트스토어 상품 번호 (문자열로 보관 — 자릿수가 커서 number 정밀도 손실 위험) */
  productNo: string;
  name: string;
  /** 상품 상세 페이지 URL */
  url: string;
  imageUrl?: string;
  /** 정가 */
  salePrice?: number;
  /** 할인가. 정가와 같으면 undefined로 정규화됩니다. */
  discountedPrice?: number;
  /** 등록일 ISO 문자열 */
  registeredAt?: string;
  soldOut?: boolean;
}

/**
 * 통합 피드용 상품.
 * 여러 스토어 상품이 섞이므로 어느 스토어에서 왔는지를 함께 들고 다닙니다.
 */
export interface SmartStoreFeedProduct extends SmartStoreProduct {
  store: SmartStoreInfo;
}

/** 한 번의 조회 결과 스냅샷 */
export interface SmartStoreSnapshot {
  store: SmartStoreInfo;
  products: SmartStoreProduct[];
  /** 조회 시각 ISO 문자열 */
  fetchedAt: string;
}

/**
 * 실패 사유 코드.
 * UI는 이 코드로 사용자 안내 문구를 결정합니다.
 */
export type SmartStoreErrorCode =
  /** 입력한 주소/아이디가 스마트스토어 형식이 아님 */
  | "INVALID_INPUT"
  /** 스토어가 존재하지 않거나 폐점 */
  | "STORE_NOT_FOUND"
  /** 네이버가 요청을 차단 (403/429) — 서버 IP 차단이 대표적인 원인 */
  | "BLOCKED"
  /** 네이버 응답이 실패했거나 형식이 바뀌어 해석 불가 */
  | "UPSTREAM_ERROR"
  /** 응답은 정상이지만 노출 중인 상품이 없음 */
  | "EMPTY_RESULT"
  /** 우리 서버의 호출 빈도 제한에 걸림 */
  | "RATE_LIMITED";

export type FetchLatestProductsResult =
  | { success: true; data: SmartStoreSnapshot }
  | { success: false; code: SmartStoreErrorCode; error: string };

/** localStorage에 보관되는 스토어 엔트리 */
export interface StoredSmartStore extends SmartStoreRef {
  /** `${host}/${storeId}` 형태의 고유 키 */
  key: string;
  /** 추가한 시각 ISO 문자열 */
  addedAt: string;
}
