import type { SmartStoreProduct } from "./types";

/**
 * 최신순 정렬 기준.
 *
 * 스토어 1곳 안에서 정렬할 때와, 여러 스토어 상품을 합친 통합 피드에서 정렬할 때
 * 같은 기준을 써야 두 화면의 순서가 어긋나지 않으므로 한 곳에 모아둡니다.
 *
 * 등록일이 있으면 등록일 기준, 없으면 상품번호가 클수록 최신이라는 성질을 이용합니다.
 * 등록일이 있는 상품을 없는 상품보다 항상 앞에 둡니다 — 서로 다른 스토어를 섞을 때
 * 정보가 있는 쪽을 신뢰하기 위해서입니다.
 */
export function compareByRecency(
  a: SmartStoreProduct,
  b: SmartStoreProduct,
): number {
  if (a.registeredAt && b.registeredAt && a.registeredAt !== b.registeredAt) {
    return a.registeredAt < b.registeredAt ? 1 : -1;
  }
  if (a.registeredAt && !b.registeredAt) return -1;
  if (!a.registeredAt && b.registeredAt) return 1;

  const aNo = Number(a.productNo);
  const bNo = Number(b.productNo);
  if (Number.isFinite(aNo) && Number.isFinite(bNo) && aNo !== bNo) {
    return bNo - aNo;
  }
  return b.productNo.localeCompare(a.productNo);
}
