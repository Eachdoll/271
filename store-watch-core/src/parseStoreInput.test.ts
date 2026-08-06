import {
  buildProductUrl,
  buildStoreUrl,
  parseStoreInput,
  toStoreKey,
} from "./parseStoreInput";

describe("parseStoreInput", () => {
  it("스마트스토어 URL에서 스토어 아이디를 추출한다", () => {
    const result = parseStoreInput("https://smartstore.naver.com/mystore");

    expect(result).toEqual({
      ok: true,
      ref: { storeId: "mystore", host: "smartstore" },
    });
  });

  it("상품 상세 URL에서도 스토어 아이디만 추출한다", () => {
    const result = parseStoreInput(
      "https://smartstore.naver.com/mystore/products/1234567890",
    );

    expect(result).toEqual({
      ok: true,
      ref: { storeId: "mystore", host: "smartstore" },
    });
  });

  it("모바일 도메인과 쿼리스트링을 허용한다", () => {
    const result = parseStoreInput(
      "https://m.smartstore.naver.com/mystore?cp_id=abc&frm=NVSHTIT",
    );

    expect(result).toEqual({
      ok: true,
      ref: { storeId: "mystore", host: "smartstore" },
    });
  });

  it("프로토콜이 없어도 파싱한다", () => {
    expect(parseStoreInput("smartstore.naver.com/mystore")).toEqual({
      ok: true,
      ref: { storeId: "mystore", host: "smartstore" },
    });
  });

  it("브랜드스토어는 brand 호스트로 구분한다", () => {
    expect(parseStoreInput("https://brand.naver.com/somebrand")).toEqual({
      ok: true,
      ref: { storeId: "somebrand", host: "brand" },
    });
  });

  it("아이디만 입력하면 스마트스토어로 간주한다", () => {
    expect(parseStoreInput("  mystore  ")).toEqual({
      ok: true,
      ref: { storeId: "mystore", host: "smartstore" },
    });
  });

  it.each([
    ["빈 문자열", ""],
    ["공백만", "   "],
    ["네이버가 아닌 도메인", "https://example.com/mystore"],
    ["네이버 타 서비스", "https://shopping.naver.com/mystore"],
    ["스토어 아이디가 없는 URL", "https://smartstore.naver.com/"],
    ["예약 경로", "https://smartstore.naver.com/products"],
    ["허용되지 않는 문자", "seoul semi!"],
    ["한 글자 아이디", "a"],
  ])("%s는 거부한다", (_label, input) => {
    expect(parseStoreInput(input)).toEqual({ ok: false });
  });

  it("호스트를 사칭하는 도메인을 거부한다", () => {
    // 접미사만 같은 도메인이 통과하면 SSRF로 이어집니다.
    expect(
      parseStoreInput("https://evil-smartstore.naver.com.attacker.io/x"),
    ).toEqual({ ok: false });
    expect(
      parseStoreInput("https://smartstore.naver.com.attacker.io/x"),
    ).toEqual({
      ok: false,
    });
  });

  it("자격증명이 포함된 URL도 호스트 기준으로만 판단한다", () => {
    expect(
      parseStoreInput("https://attacker.io@smartstore.naver.com/mystore"),
    ).toEqual({ ok: true, ref: { storeId: "mystore", host: "smartstore" } });
    expect(
      parseStoreInput("https://smartstore.naver.com@attacker.io/mystore"),
    ).toEqual({ ok: false });
  });
});

describe("URL 조립", () => {
  const ref = { storeId: "mystore", host: "smartstore" } as const;

  it("스토어 홈 URL을 만든다", () => {
    expect(buildStoreUrl(ref)).toBe("https://smartstore.naver.com/mystore");
  });

  it("상품 상세 URL을 만든다", () => {
    expect(buildProductUrl(ref, "1234567890")).toBe(
      "https://smartstore.naver.com/mystore/products/1234567890",
    );
  });

  it("브랜드스토어는 다른 도메인을 사용한다", () => {
    expect(buildStoreUrl({ storeId: "somebrand", host: "brand" })).toBe(
      "https://brand.naver.com/somebrand",
    );
  });

  it("스토어 키는 호스트와 아이디를 함께 담는다", () => {
    expect(toStoreKey(ref)).toBe("smartstore/mystore");
    expect(toStoreKey({ storeId: "mystore", host: "brand" })).toBe(
      "brand/mystore",
    );
  });
});
