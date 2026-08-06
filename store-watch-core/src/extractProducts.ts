import { compareByRecency } from "./compareByRecency";
import { buildProductUrl } from "./parseStoreInput";
import type {
  SmartStoreProduct,
  SmartStoreRef,
} from "./types";

/**
 * 네이버 응답에서 상품을 추출합니다.
 *
 * 스마트스토어는 공개 API 스펙을 보장하지 않아 응답 경로(`widgetContents.…`,
 * `simpleProducts`, `contents` 등)가 수시로 바뀝니다. 그래서 고정 경로를 따라가는 대신
 * 페이로드 전체를 순회하며 "상품처럼 생긴 객체"를 찾습니다. 경로가 바뀌어도 필드명만
 * 유지되면 계속 동작합니다.
 */

/** 순회 깊이 제한 — 비정상적으로 중첩된 응답에서 스택이 깊어지는 것을 방지 */
const MAX_DEPTH = 14;

/** 순회 노드 수 제한 — 대용량 응답에서 CPU를 태우지 않도록 방어 */
const MAX_NODES = 200_000;

type UnknownRecord = Record<string, unknown>;

/**
 * 페이로드를 순회해 상품 객체 후보를 수집합니다.
 * 상품 번호 기준으로 중복을 제거하고, 최신 등록순으로 정렬해 반환합니다.
 */
export function extractProducts(
  payload: unknown,
  ref: SmartStoreRef,
  limit: number,
): SmartStoreProduct[] {
  const candidates = collectProductLikeNodes(payload);

  const byProductNo = new Map<string, SmartStoreProduct>();
  for (const node of candidates) {
    const product = normalizeProduct(node, ref);
    if (!product) continue;
    // 같은 상품이 여러 위젯에 중복 등장할 수 있어, 정보가 더 채워진 쪽을 남깁니다.
    const existing = byProductNo.get(product.productNo);
    byProductNo.set(
      product.productNo,
      existing ? mergeProduct(existing, product) : product,
    );
  }

  return [...byProductNo.values()].sort(compareByRecency).slice(0, limit);
}

/** 상품처럼 생긴 객체를 너비/깊이 제한 하에 수집 */
function collectProductLikeNodes(payload: unknown): UnknownRecord[] {
  const found: UnknownRecord[] = [];
  const seen = new WeakSet<object>();
  let visited = 0;

  const walk = (node: unknown, depth: number): void => {
    if (depth > MAX_DEPTH || visited > MAX_NODES) return;
    if (node === null || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    visited += 1;

    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }

    const record = node as UnknownRecord;
    if (isProductLike(record)) found.push(record);

    // 상품 객체 안에도 하위 구조(옵션/리뷰 등)가 있으므로 계속 순회합니다.
    for (const value of Object.values(record)) walk(value, depth + 1);
  };

  walk(payload, 0);
  return found;
}

/**
 * 상품 판별 휴리스틱: 상품번호 + 이름 + 가격이 모두 있어야 상품으로 봅니다.
 * 카테고리/배너/리뷰 객체는 이 중 하나가 비어 걸러집니다.
 */
function isProductLike(record: UnknownRecord): boolean {
  return (
    readProductNo(record) !== undefined &&
    readName(record) !== undefined &&
    readSalePrice(record) !== undefined
  );
}

function normalizeProduct(
  record: UnknownRecord,
  ref: SmartStoreRef,
): SmartStoreProduct | null {
  const productNo = readProductNo(record);
  const name = readName(record);
  const salePrice = readSalePrice(record);
  if (!productNo || !name || salePrice === undefined) return null;

  const discounted = readNumber(
    record.discountedSalePrice,
    record.mobileDiscountedSalePrice,
    readNested(record, "benefitsView", "discountedSalePrice"),
  );

  return {
    productNo,
    name,
    url: buildProductUrl(ref, productNo),
    imageUrl: readImageUrl(record),
    salePrice,
    // 할인가가 정가와 같으면 할인 표기를 하지 않습니다.
    discountedPrice:
      discounted !== undefined && discounted < salePrice
        ? discounted
        : undefined,
    registeredAt: readRegisteredAt(record),
    soldOut: readSoldOut(record),
  };
}

/** 같은 상품의 두 표현을 합쳐 빈 필드를 채웁니다. */
function mergeProduct(
  base: SmartStoreProduct,
  incoming: SmartStoreProduct,
): SmartStoreProduct {
  return {
    ...base,
    imageUrl: base.imageUrl ?? incoming.imageUrl,
    discountedPrice: base.discountedPrice ?? incoming.discountedPrice,
    registeredAt: base.registeredAt ?? incoming.registeredAt,
    soldOut: base.soldOut ?? incoming.soldOut,
  };
}

/* ------------------------------------------------------------------ */
/* 필드 리더 — 네이버가 쓰는 여러 이름을 순서대로 시도합니다.             */
/* ------------------------------------------------------------------ */

function readProductNo(record: UnknownRecord): string | undefined {
  const raw =
    record.channelProductNo ??
    record.productNo ??
    record.originProductNo ??
    record.id;

  if (typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0) {
    return String(raw);
  }
  // 상품번호는 숫자로만 이루어집니다. slug/uuid 형태의 id는 상품이 아니므로 배제합니다.
  // (숫자 타입과 판정 기준을 동일하게 유지 — 자릿수로 거르지 않습니다.)
  if (typeof raw === "string" && /^\d{1,20}$/.test(raw.trim())) {
    return raw.trim();
  }
  return undefined;
}

function readName(record: UnknownRecord): string | undefined {
  const raw = record.name ?? record.productName ?? record.title;
  if (typeof raw !== "string") return undefined;
  const name = raw.trim();
  return name.length > 0 ? name : undefined;
}

function readSalePrice(record: UnknownRecord): number | undefined {
  return readNumber(
    record.salePrice,
    record.price,
    readNested(record, "productPrice", "salePrice"),
  );
}

function readImageUrl(record: UnknownRecord): string | undefined {
  const direct = firstString(
    record.representativeImageUrl,
    record.imageUrl,
    readNested(record, "representImage", "url"),
    readNested(record, "representativeImage", "url"),
  );
  if (direct) return toHttpsUrl(direct);

  // images / productImages 배열의 첫 항목
  for (const key of ["images", "productImages"]) {
    const list = record[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const url =
        typeof item === "string"
          ? item
          : item && typeof item === "object"
            ? firstString(
                (item as UnknownRecord).imageUrl,
                (item as UnknownRecord).url,
                (item as UnknownRecord).src,
              )
            : undefined;
      const normalized = url ? toHttpsUrl(url) : undefined;
      if (normalized) return normalized;
    }
  }
  return undefined;
}

/** 프로토콜 상대 URL(`//…`)을 https로 보정하고, http(s)가 아닌 값은 버립니다. */
function toHttpsUrl(value: string): string | undefined {
  const url = value.startsWith("//") ? `https:${value}` : value;
  return /^https?:\/\//i.test(url) ? url : undefined;
}

function readRegisteredAt(record: UnknownRecord): string | undefined {
  const raw = firstDefined(
    record.regDate,
    record.registerDate,
    record.registrationDate,
    record.saleStartDate,
    record.createdDate,
  );

  if (typeof raw === "number") {
    // epoch(ms/s) 모두 대응
    const ms = raw > 1e12 ? raw : raw * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof raw === "string" && raw.trim()) {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  return undefined;
}

function readSoldOut(record: UnknownRecord): boolean | undefined {
  if (typeof record.soldOut === "boolean") return record.soldOut;

  const status = record.saleStatus ?? record.statusType ?? record.productStatus;
  if (typeof status === "string") {
    const normalized = status.toUpperCase();
    if (normalized === "SALE" || normalized === "ONSALE") return false;
    if (
      normalized === "SUSPENSION" ||
      normalized === "OUTOFSTOCK" ||
      normalized === "SOLDOUT"
    ) {
      return true;
    }
  }

  const stock = readNumber(record.stockQuantity);
  if (stock !== undefined) return stock <= 0;
  return undefined;
}

function readNested(
  record: UnknownRecord,
  key: string,
  childKey: string,
): unknown {
  const child = record[key];
  if (child && typeof child === "object" && !Array.isArray(child)) {
    return (child as UnknownRecord)[childKey];
  }
  return undefined;
}

function readNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
    if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim())) {
      return Number(value);
    }
  }
  return undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function firstDefined(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}
