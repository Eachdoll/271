import { compareByRecency } from "./compareByRecency";
import type {
  SmartStoreFeedProduct,
  SmartStoreSnapshot,
} from "./types";

/**
 * 여러 스토어의 조회 결과를 하나의 최신순 목록으로 합칩니다.
 *
 * 스토어별 보기와 동일한 정렬 기준(`compareByRecency`)을 쓰므로 두 화면의
 * 순서가 어긋나지 않습니다.
 *
 * 순수 함수로 분리한 이유: 통합 피드의 핵심 동작이 "제대로 섞였는가"인데,
 * 컴포넌트 안에 두면 검증하기 어렵습니다.
 */
export function mergeStoreFeed(
  snapshots: SmartStoreSnapshot[],
  limit?: number,
): SmartStoreFeedProduct[] {
  const merged: SmartStoreFeedProduct[] = [];

  for (const snapshot of snapshots) {
    for (const product of snapshot.products) {
      // 어느 스토어 상품인지 카드에서 보여줘야 하므로 스토어 정보를 붙여둡니다.
      merged.push({ ...product, store: snapshot.store });
    }
  }

  // 서로 다른 스토어가 같은 상품번호를 쓸 수 있으므로 스토어까지 포함해 중복을 판단합니다.
  const deduped = new Map<string, SmartStoreFeedProduct>();
  for (const product of merged) {
    const key = `${product.store.host}/${product.store.storeId}/${product.productNo}`;
    if (!deduped.has(key)) deduped.set(key, product);
  }

  const sorted = [...deduped.values()].sort(compareByRecency);
  return typeof limit === "number" ? sorted.slice(0, limit) : sorted;
}
