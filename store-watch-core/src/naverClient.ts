import { extractPreloadedState } from "./extractPreloadedState";
import { extractProducts } from "./extractProducts";
import { buildStoreUrl } from "./parseStoreInput";
import { SMART_STORE_ORIGIN, UPSTREAM_TIMEOUT_MS } from "./const";
import type {
  SmartStoreErrorCode,
  SmartStoreRef,
  SmartStoreSnapshot,
} from "./types";

/**
 * 네이버 스마트스토어 공개 응답에서 최신 상품을 읽어옵니다.
 *
 * 네이버는 공개 API 스펙을 보장하지 않으므로 한 경로에 의존하지 않고 순서대로 시도합니다.
 *   1) 스토어 메타 JSON (`/i/v1/stores/{storeId}`) — 스토어명 + 상품 위젯이 함께 오는 경우가 많음
 *   2) 채널 상품 목록 JSON (`/i/v2/channels/{uid}/…?sortType=RECENT`)
 *   3) 스토어 페이지 HTML에 인라인된 상태 JSON
 *
 * 어느 단계든 상품을 찾으면 즉시 사용하고, 전부 실패했을 때만 오류를 반환합니다.
 */

type UnknownRecord = Record<string, unknown>;

export type SmartStoreClientResult =
  | { success: true; data: SmartStoreSnapshot }
  | { success: false; code: SmartStoreErrorCode };

/** 브라우저처럼 보이게 하는 최소한의 헤더. 이 값이 없으면 네이버가 즉시 차단합니다. */
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
};

interface UpstreamResponse {
  status: number;
  body: string;
}

/**
 * 프레임워크별 fetch 옵션 주입점.
 *
 * 같은 스토어를 연속 조회할 때 네이버를 반복해서 두드리지 않으려면 응답 캐시가 필요한데,
 * 캐시 방식은 프레임워크마다 다릅니다. 여기서는 기본값을 두지 않고 주입만 받습니다.
 *
 *   // Next.js
 *   setUpstreamFetchInit({ next: { revalidate: UPSTREAM_REVALIDATE_SEC } } as RequestInit)
 *
 * 주입하지 않으면 매 호출마다 네이버로 나갑니다 — 호출 빈도 제한을 반드시 함께 두세요.
 */
let extraFetchInit: RequestInit = {};

export function setUpstreamFetchInit(init: RequestInit): void {
  extraFetchInit = init;
}

/** 요청 자체가 실패했을 때 (타임아웃/네트워크) */
const NETWORK_FAILURE = Symbol("network-failure");

export async function fetchLatestProducts(
  ref: SmartStoreRef,
  limit: number,
): Promise<SmartStoreClientResult> {
  const origin = SMART_STORE_ORIGIN[ref.host];
  const storeUrl = buildStoreUrl(ref);

  let displayName: string | undefined;
  /** 상품을 한 건도 못 찾았을 때 사용자에게 돌려줄 사유 */
  let failureCode: SmartStoreErrorCode | undefined;

  const remember = (code: SmartStoreErrorCode) => {
    // 차단(BLOCKED)은 원인이 가장 구체적이므로 다른 사유로 덮어쓰지 않습니다.
    if (failureCode !== "BLOCKED") failureCode = code;
  };

  // 1) 스토어 메타
  const meta = await requestUpstream(
    `${origin}/i/v1/stores/${ref.storeId}`,
    storeUrl,
  );
  if (meta === NETWORK_FAILURE) {
    remember("UPSTREAM_ERROR");
  } else {
    const code = classifyStatus(meta.status);
    if (code) remember(code);

    const payload = parseJson(meta.body);
    if (payload) {
      displayName = readStoreName(payload);
      const products = extractProducts(payload, ref, limit);
      if (products.length > 0) {
        return ok(ref, storeUrl, displayName, products);
      }

      // 2) 채널 상품 목록
      const channelUid = readChannelUid(payload);
      if (channelUid) {
        const listUrl =
          `${origin}/i/v2/channels/${encodeURIComponent(channelUid)}` +
          `/categories/ALL/products?categorySearchType=DISPCATG` +
          `&sortType=RECENT&page=1&pageSize=${limit}`;

        const list = await requestUpstream(listUrl, storeUrl);
        if (list === NETWORK_FAILURE) {
          remember("UPSTREAM_ERROR");
        } else {
          const listCode = classifyStatus(list.status);
          if (listCode) remember(listCode);

          const listPayload = parseJson(list.body);
          if (listPayload) {
            const listProducts = extractProducts(listPayload, ref, limit);
            if (listProducts.length > 0) {
              return ok(ref, storeUrl, displayName, listProducts);
            }
            // 응답은 정상인데 상품이 비어 있으면 실제로 상품이 없는 스토어입니다.
            remember("EMPTY_RESULT");
          }
        }
      }
    }
  }

  // 3) 스토어 페이지 HTML 폴백
  const page = await requestUpstream(storeUrl, origin, "text/html");
  if (page === NETWORK_FAILURE) {
    remember("UPSTREAM_ERROR");
  } else {
    const code = classifyStatus(page.status);
    if (code) remember(code);

    const state = extractPreloadedState(page.body);
    if (state) {
      displayName = displayName ?? readStoreName(state);
      const products = extractProducts(state, ref, limit);
      if (products.length > 0) {
        return ok(ref, storeUrl, displayName, products);
      }
      remember("EMPTY_RESULT");
    }
  }

  return { success: false, code: failureCode ?? "UPSTREAM_ERROR" };
}

function ok(
  ref: SmartStoreRef,
  storeUrl: string,
  displayName: string | undefined,
  products: SmartStoreSnapshot["products"],
): SmartStoreClientResult {
  return {
    success: true,
    data: {
      store: {
        ...ref,
        displayName: displayName?.trim() || ref.storeId,
        storeUrl,
      },
      products,
      fetchedAt: new Date().toISOString(),
    },
  };
}

/**
 * 단일 요청. 예외를 던지지 않고 상태/본문 또는 NETWORK_FAILURE를 반환합니다.
 * URL은 항상 검증된 storeId로 조립된 값만 들어옵니다.
 */
async function requestUpstream(
  url: string,
  referer: string,
  accept = "application/json, text/plain, */*",
): Promise<UpstreamResponse | typeof NETWORK_FAILURE> {
  try {
    const response = await fetch(url, {
      ...extraFetchInit,
      headers: { ...BROWSER_HEADERS, Accept: accept, Referer: referer },
      redirect: "follow",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    return { status: response.status, body: await response.text() };
  } catch {
    return NETWORK_FAILURE;
  }
}

/** HTTP 상태를 도메인 오류 코드로. 정상(2xx)이면 undefined. */
function classifyStatus(status: number): SmartStoreErrorCode | undefined {
  if (status >= 200 && status < 300) return undefined;
  if (status === 404 || status === 410) return "STORE_NOT_FOUND";
  if (status === 401 || status === 403 || status === 429) return "BLOCKED";
  return "UPSTREAM_ERROR";
}

/**
 * JSON 파싱. 네이버는 차단 시 200 상태로 HTML 에러 페이지를 주기도 해서
 * content-type을 믿지 않고 실제 파싱 성공 여부로 판단합니다.
 */
function parseJson(body: string): unknown | null {
  const trimmed = body?.trim();
  if (!trimmed || !(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/** 상품 목록 조회에 필요한 채널 식별자를 찾습니다. */
function readChannelUid(payload: unknown): string | undefined {
  return findFirstString(payload, (key, value) => {
    if (!/^(channelUid|channelNo|channelId)$/i.test(key)) return false;
    return value.length > 0 && value.length <= 64;
  });
}

/** 스토어 표시명을 찾습니다. */
function readStoreName(payload: unknown): string | undefined {
  return findFirstString(payload, (key, value) => {
    if (!/^(channelName|storeName|windowName)$/i.test(key)) return false;
    return value.trim().length > 0 && value.length <= 100;
  });
}

/**
 * 페이로드를 순회하며 조건에 맞는 첫 문자열 값을 찾습니다.
 * 응답 경로가 바뀌어도 키 이름만 유지되면 계속 동작합니다.
 */
function findFirstString(
  payload: unknown,
  predicate: (key: string, value: string) => boolean,
): string | undefined {
  const seen = new WeakSet<object>();
  const queue: unknown[] = [payload];
  let visited = 0;

  // 너비 우선 — 얕은 곳의 값(스토어 자체 정보)을 먼저 집습니다.
  while (queue.length > 0 && visited < 50_000) {
    const node = queue.shift();
    if (node === null || typeof node !== "object") continue;
    if (seen.has(node)) continue;
    seen.add(node);
    visited += 1;

    if (Array.isArray(node)) {
      queue.push(...node);
      continue;
    }

    for (const [key, value] of Object.entries(node as UnknownRecord)) {
      if (typeof value === "string" && predicate(key, value)) {
        return value.trim();
      }
      if (typeof value === "number" && predicate(key, String(value))) {
        return String(value);
      }
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return undefined;
}
