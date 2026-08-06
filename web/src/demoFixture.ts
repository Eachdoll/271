import { buildProductUrl, buildStoreUrl } from "../../store-watch-core/src/parseStoreInput";
import type { SmartStoreRef, SmartStoreSnapshot } from "../../store-watch-core/src/types";

/**
 * `DEMO=1`로 띄울 때 쓰는 시연용 데이터.
 *
 * 네이버가 이 서버 IP를 차단(429)해서 실제 응답으로 화면을 확인할 수 없기 때문에 둔 장치입니다.
 * 차단이 풀리면 지워도 됩니다 — 조회 경로는 데모 여부와 무관하게 동일합니다.
 *
 * 상품 정보는 전부 가상입니다. 실제 스토어·상품과 무관합니다.
 */
interface DemoItem {
  productNo: string;
  name: string;
  salePrice: number;
  discountedPrice?: number;
  /** 지금으로부터 며칠 전에 등록됐는지 */
  daysAgo: number;
  soldOut?: boolean;
}

interface DemoStore {
  ref: SmartStoreRef;
  displayName: string;
  items: DemoItem[];
}

const DEMO_STORES: DemoStore[] = [
  {
    ref: { storeId: "sample-roastery", host: "smartstore" },
    displayName: "샘플로스터리",
    items: [
      { productNo: "11390284412", name: "에티오피아 예가체프 코체레 워시드 원두 200g", salePrice: 18000, discountedPrice: 14400, daysAgo: 0 },
      { productNo: "11390284390", name: "콜롬비아 수프리모 디카페인 원두 200g", salePrice: 16000, discountedPrice: 13600, daysAgo: 1 },
      { productNo: "11390284355", name: "브라질 세하도 내추럴 드립백 10입 선물세트", salePrice: 21000, daysAgo: 2 },
      { productNo: "11390284301", name: "케냐 AA 니에리 싱글오리진 원두 500g 대용량", salePrice: 32000, discountedPrice: 27200, daysAgo: 4 },
      { productNo: "11390284277", name: "과테말라 안티구아 SHB 홀빈 200g", salePrice: 17500, daysAgo: 6 },
      { productNo: "11390284240", name: "블렌드 하우스 다크 로스트 원두 1kg 업소용", salePrice: 39000, discountedPrice: 35100, daysAgo: 9, soldOut: true },
    ],
  },
  {
    ref: { storeId: "sample-kitchen", host: "smartstore" },
    displayName: "샘플키친하우스",
    items: [
      { productNo: "10884120935", name: "무쇠 주물 프라이팬 20cm 인덕션 겸용", salePrice: 49000, discountedPrice: 34300, daysAgo: 0 },
      { productNo: "10884120901", name: "원목 도마 대형 항균 손잡이형", salePrice: 28000, daysAgo: 3 },
      { productNo: "10884120866", name: "스테인리스 밀폐용기 4종 세트 냉장고 정리", salePrice: 36000, discountedPrice: 25200, daysAgo: 5 },
      { productNo: "10884120812", name: "핸드드립 유리 서버 600ml 내열유리", salePrice: 22000, daysAgo: 8 },
      { productNo: "10884120770", name: "실리콘 주방장갑 내열 220도 2P", salePrice: 12900, discountedPrice: 9900, daysAgo: 11 },
      { productNo: "10884120741", name: "티크 원목 트레이 사각 38cm", salePrice: 31000, daysAgo: 14 },
    ],
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;

export function demoStoreIds(): string[] {
  return DEMO_STORES.map((store) => store.ref.storeId);
}

/** 데모 스토어면 스냅샷을, 아니면 undefined를 돌려줍니다. */
export function demoSnapshot(
  ref: SmartStoreRef,
  limit: number,
  now: number,
): SmartStoreSnapshot | undefined {
  const store = DEMO_STORES.find(
    (candidate) =>
      candidate.ref.storeId === ref.storeId && candidate.ref.host === ref.host,
  );
  if (!store) return undefined;

  return {
    store: {
      ...store.ref,
      displayName: store.displayName,
      storeUrl: buildStoreUrl(store.ref),
    },
    products: store.items.slice(0, limit).map((item) => ({
      productNo: item.productNo,
      name: item.name,
      url: buildProductUrl(store.ref, item.productNo),
      salePrice: item.salePrice,
      discountedPrice: item.discountedPrice,
      registeredAt: new Date(now - item.daysAgo * DAY_MS).toISOString(),
      soldOut: item.soldOut,
    })),
    fetchedAt: new Date(now).toISOString(),
  };
}
