import { mergeStoreFeed } from "./mergeStoreFeed";
import type {
  SmartStoreInfo,
  SmartStoreProduct,
  SmartStoreSnapshot,
} from "./types";

function store(storeId: string, displayName = storeId): SmartStoreInfo {
  return {
    storeId,
    host: "smartstore",
    displayName,
    storeUrl: `https://smartstore.naver.com/${storeId}`,
  };
}

function product(
  productNo: string,
  name: string,
  registeredAt?: string,
): SmartStoreProduct {
  return {
    productNo,
    name,
    url: `https://smartstore.naver.com/x/products/${productNo}`,
    salePrice: 1000,
    registeredAt,
  };
}

function snapshot(
  info: SmartStoreInfo,
  products: SmartStoreProduct[],
): SmartStoreSnapshot {
  return { store: info, products, fetchedAt: "2026-08-06T00:00:00.000Z" };
}

describe("mergeStoreFeed", () => {
  it("여러 스토어 상품을 등록일 최신순으로 섞는다", () => {
    // 통합 피드의 핵심: 스토어 경계를 무시하고 날짜로만 줄을 세워야 합니다.
    const result = mergeStoreFeed([
      snapshot(store("a"), [
        product("1", "A-오래된", "2026-01-01T00:00:00.000Z"),
        product("2", "A-최신", "2026-08-01T00:00:00.000Z"),
      ]),
      snapshot(store("b"), [
        product("3", "B-중간", "2026-05-01T00:00:00.000Z"),
        product("4", "B-가장최신", "2026-08-05T00:00:00.000Z"),
      ]),
    ]);

    expect(result.map((p) => p.name)).toEqual([
      "B-가장최신",
      "A-최신",
      "B-중간",
      "A-오래된",
    ]);
  });

  it("각 상품에 출처 스토어를 붙인다", () => {
    const result = mergeStoreFeed([
      snapshot(store("a", "에이스토어"), [product("1", "상품A")]),
      snapshot(store("b", "비스토어"), [product("2", "상품B")]),
    ]);

    const byName = Object.fromEntries(
      result.map((p) => [p.name, p.store.displayName]),
    );
    expect(byName).toEqual({ 상품A: "에이스토어", 상품B: "비스토어" });
  });

  it("서로 다른 스토어의 같은 상품번호는 각각 남긴다", () => {
    // 상품번호는 스토어를 가로질러 유일하지 않으므로 스토어까지 묶어 판단해야 합니다.
    const result = mergeStoreFeed([
      snapshot(store("a"), [product("100", "A의 100번")]),
      snapshot(store("b"), [product("100", "B의 100번")]),
    ]);

    expect(result).toHaveLength(2);
  });

  it("같은 스토어의 중복 상품은 한 건으로 만든다", () => {
    const result = mergeStoreFeed([
      snapshot(store("a"), [product("100", "상품")]),
      snapshot(store("a"), [product("100", "상품")]),
    ]);

    expect(result).toHaveLength(1);
  });

  it("등록일이 없는 상품은 뒤로 보낸다", () => {
    const result = mergeStoreFeed([
      snapshot(store("a"), [product("999", "날짜없음")]),
      snapshot(store("b"), [
        product("1", "날짜있음", "2020-01-01T00:00:00.000Z"),
      ]),
    ]);

    expect(result.map((p) => p.name)).toEqual(["날짜있음", "날짜없음"]);
  });

  it("limit을 넘기면 상위 N개만 남긴다", () => {
    const result = mergeStoreFeed(
      [
        snapshot(
          store("a"),
          Array.from({ length: 10 }, (_, i) =>
            product(String(i + 1), `상품${i}`),
          ),
        ),
      ],
      3,
    );

    expect(result).toHaveLength(3);
  });

  it("스냅샷이 없거나 상품이 없으면 빈 배열을 반환한다", () => {
    expect(mergeStoreFeed([])).toEqual([]);
    expect(mergeStoreFeed([snapshot(store("a"), [])])).toEqual([]);
  });

  it("스토어별 보기와 같은 정렬 기준을 쓴다", () => {
    // 등록일이 전부 없으면 상품번호가 큰 쪽이 최신 — extractProducts와 동일한 규칙
    const result = mergeStoreFeed([
      snapshot(store("a"), [product("100", "작은번호")]),
      snapshot(store("b"), [product("300", "큰번호")]),
    ]);

    expect(result.map((p) => p.name)).toEqual(["큰번호", "작은번호"]);
  });
});
