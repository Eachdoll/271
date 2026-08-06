import { extractProducts } from "./extractProducts";
import type { SmartStoreRef } from "./types";

const REF: SmartStoreRef = { storeId: "mystore", host: "smartstore" };

describe("extractProducts", () => {
  it("깊이 중첩된 위젯 안의 상품도 찾아낸다", () => {
    // 네이버 응답은 상품이 어디에 들어있는지 보장하지 않으므로,
    // 고정 경로가 아니라 전체 순회로 찾아야 합니다.
    const payload = {
      widgetContents: {
        wholeProductWidget: {
          A: {
            data: [
              {
                id: 1000000001,
                name: "텀블러 500ml",
                salePrice: 12000,
                representativeImageUrl: "https://shop-phinf.pstatic.net/a.jpg",
                regDate: "2026-08-01T09:00:00.000Z",
              },
            ],
          },
        },
      },
    };

    expect(extractProducts(payload, REF, 10)).toEqual([
      {
        productNo: "1000000001",
        name: "텀블러 500ml",
        url: "https://smartstore.naver.com/mystore/products/1000000001",
        imageUrl: "https://shop-phinf.pstatic.net/a.jpg",
        salePrice: 12000,
        discountedPrice: undefined,
        registeredAt: "2026-08-01T09:00:00.000Z",
        soldOut: undefined,
      },
    ]);
  });

  it("등록일 기준 최신순으로 정렬한다", () => {
    const payload = [
      { id: 1, name: "오래된 상품", salePrice: 1000, regDate: "2026-01-01" },
      { id: 2, name: "최신 상품", salePrice: 1000, regDate: "2026-08-01" },
      { id: 3, name: "중간 상품", salePrice: 1000, regDate: "2026-04-01" },
    ];

    expect(extractProducts(payload, REF, 10).map((p) => p.name)).toEqual([
      "최신 상품",
      "중간 상품",
      "오래된 상품",
    ]);
  });

  it("등록일이 없으면 상품번호가 큰 순으로 정렬한다", () => {
    const payload = [
      { productNo: "100", name: "A", salePrice: 1000 },
      { productNo: "300", name: "B", salePrice: 1000 },
      { productNo: "200", name: "C", salePrice: 1000 },
    ];

    expect(extractProducts(payload, REF, 10).map((p) => p.name)).toEqual([
      "B",
      "C",
      "A",
    ]);
  });

  it("limit 개수만큼만 반환한다", () => {
    const payload = Array.from({ length: 30 }, (_, index) => ({
      productNo: String(1000 + index),
      name: `상품 ${index}`,
      salePrice: 1000,
    }));

    expect(extractProducts(payload, REF, 5)).toHaveLength(5);
  });

  it("여러 위젯에 중복 등장한 상품을 합쳐 한 건으로 만든다", () => {
    const payload = {
      widgetA: [{ productNo: "777777", name: "중복 상품", salePrice: 5000 }],
      widgetB: [
        {
          productNo: "777777",
          name: "중복 상품",
          salePrice: 5000,
          representativeImageUrl: "https://shop-phinf.pstatic.net/b.jpg",
        },
      ],
    };

    const products = extractProducts(payload, REF, 10);

    expect(products).toHaveLength(1);
    // 정보가 더 채워진 쪽의 이미지가 살아남아야 합니다.
    expect(products[0].imageUrl).toBe("https://shop-phinf.pstatic.net/b.jpg");
  });

  it("할인가가 정가보다 쌀 때만 할인가를 남긴다", () => {
    const payload = [
      {
        productNo: "1",
        name: "할인 상품",
        salePrice: 10000,
        discountedSalePrice: 8000,
      },
      {
        productNo: "2",
        name: "할인 없는 상품",
        salePrice: 10000,
        discountedSalePrice: 10000,
      },
    ];

    const [discounted, notDiscounted] = extractProducts(payload, REF, 10).sort(
      (a, b) => Number(a.productNo) - Number(b.productNo),
    );

    expect(discounted.discountedPrice).toBe(8000);
    expect(notDiscounted.discountedPrice).toBeUndefined();
  });

  it("상품이 아닌 객체는 걸러낸다", () => {
    const payload = {
      // 가격이 없는 카테고리
      categories: [{ id: 111111, name: "생활용품" }],
      // 이름이 없는 이미지 배너
      banners: [{ id: 222222, salePrice: 0, imageUrl: "https://x/y.jpg" }],
      // 상품번호가 숫자가 아닌 배너
      promotions: [{ id: "promo-abc", name: "여름 행사", salePrice: 1000 }],
      products: [{ id: 333333, name: "진짜 상품", salePrice: 1000 }],
    };

    expect(extractProducts(payload, REF, 10).map((p) => p.name)).toEqual([
      "진짜 상품",
    ]);
  });

  it("품절 상태를 여러 표현에서 읽는다", () => {
    const payload = [
      { productNo: "1", name: "판매중", salePrice: 1000, saleStatus: "SALE" },
      {
        productNo: "2",
        name: "판매중지",
        salePrice: 1000,
        saleStatus: "SUSPENSION",
      },
      { productNo: "3", name: "재고없음", salePrice: 1000, stockQuantity: 0 },
    ];

    const byName = Object.fromEntries(
      extractProducts(payload, REF, 10).map((p) => [p.name, p.soldOut]),
    );

    expect(byName).toEqual({
      판매중: false,
      판매중지: true,
      재고없음: true,
    });
  });

  it("프로토콜 상대 이미지 URL을 https로 보정한다", () => {
    const payload = [
      {
        productNo: "1",
        name: "상품",
        salePrice: 1000,
        representativeImageUrl: "//shop-phinf.pstatic.net/a.jpg",
      },
    ];

    expect(extractProducts(payload, REF, 10)[0].imageUrl).toBe(
      "https://shop-phinf.pstatic.net/a.jpg",
    );
  });

  it("순환 참조가 있어도 무한 루프에 빠지지 않는다", () => {
    const payload: Record<string, unknown> = {
      products: [{ productNo: "1", name: "상품", salePrice: 1000 }],
    };
    payload.self = payload;

    expect(extractProducts(payload, REF, 10)).toHaveLength(1);
  });

  it("상품이 없으면 빈 배열을 반환한다", () => {
    expect(extractProducts({ foo: "bar" }, REF, 10)).toEqual([]);
    expect(extractProducts(null, REF, 10)).toEqual([]);
  });
});
