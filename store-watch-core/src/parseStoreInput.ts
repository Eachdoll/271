import {
  RESERVED_STORE_IDS,
  SMART_STORE_HOSTNAMES,
  SMART_STORE_ORIGIN,
  STORE_ID_PATTERN,
} from "./const";
import type {
  SmartStoreHost,
  SmartStoreRef,
} from "./types";

export type ParseStoreInputResult =
  | { ok: true; ref: SmartStoreRef }
  | { ok: false };

/**
 * 사용자가 입력한 문자열에서 스토어 식별자를 추출합니다.
 *
 * 허용 입력 예:
 * - `https://smartstore.naver.com/mystore`
 * - `https://smartstore.naver.com/mystore/products/1234567`
 * - `m.smartstore.naver.com/mystore?cp_id=x`
 * - `https://brand.naver.com/somebrand`
 * - `mystore` (아이디만 입력)
 *
 * 반환된 `ref`만으로 요청 URL을 조립하므로, 이 함수가 외부 요청의 신뢰 경계입니다.
 */
export function parseStoreInput(input: string): ParseStoreInputResult {
  const trimmed = input?.trim();
  if (!trimmed) return { ok: false };

  // 프로토콜이 없어도 URL로 다룰 수 있게 보정 (`naver.com/x`, `//naver.com/x` 형태 포함)
  const looksLikeUrl = /[./]/.test(trimmed);
  if (!looksLikeUrl) {
    return toRef(trimmed, "smartstore");
  }

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed.replace(/^\/+/, "")}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return { ok: false };
  }

  const host = SMART_STORE_HOSTNAMES[url.hostname.toLowerCase()];
  if (!host) return { ok: false };

  const firstSegment = url.pathname.split("/").filter(Boolean)[0];
  if (!firstSegment) return { ok: false };

  return toRef(decodeSegment(firstSegment), host);
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function toRef(candidate: string, host: SmartStoreHost): ParseStoreInputResult {
  const storeId = candidate.trim();
  if (!STORE_ID_PATTERN.test(storeId)) return { ok: false };
  if (RESERVED_STORE_IDS.has(storeId.toLowerCase())) return { ok: false };
  return { ok: true, ref: { storeId, host } };
}

/** `${host}/${storeId}` — 목록 중복 판단 및 React key로 사용 */
export function toStoreKey(ref: SmartStoreRef): string {
  return `${ref.host}/${ref.storeId}`;
}

/** 스토어 홈 URL */
export function buildStoreUrl(ref: SmartStoreRef): string {
  return `${SMART_STORE_ORIGIN[ref.host]}/${ref.storeId}`;
}

/** 상품 상세 URL */
export function buildProductUrl(ref: SmartStoreRef, productNo: string): string {
  return `${buildStoreUrl(ref)}/products/${productNo}`;
}
