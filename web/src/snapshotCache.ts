import { UPSTREAM_REVALIDATE_SEC } from "../../store-watch-core/src/const";
import { toStoreKey } from "../../store-watch-core/src/parseStoreInput";
import type { SmartStoreRef, SmartStoreSnapshot } from "../../store-watch-core/src/types";

/**
 * 스토어별 조회 결과 캐시.
 *
 * 코어는 `setUpstreamFetchInit()` 주입점만 두고 캐시를 갖지 않습니다(프레임워크마다 방식이 달라서).
 * 이 서버는 프레임워크가 없으므로 같은 수명(`UPSTREAM_REVALIDATE_SEC`)의 캐시를 여기서 직접 답니다.
 *
 * 캐시가 없으면 화면을 새로고침할 때마다 네이버를 두드리게 되고, 그게 차단을 앞당깁니다.
 */
interface Entry {
  snapshot: SmartStoreSnapshot;
  expiresAt: number;
}

const entries = new Map<string, Entry>();

export function readCached(ref: SmartStoreRef, now: number): SmartStoreSnapshot | undefined {
  const entry = entries.get(toStoreKey(ref));
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    entries.delete(toStoreKey(ref));
    return undefined;
  }
  return entry.snapshot;
}

export function writeCached(
  ref: SmartStoreRef,
  snapshot: SmartStoreSnapshot,
  now: number,
): void {
  entries.set(toStoreKey(ref), {
    snapshot,
    expiresAt: now + UPSTREAM_REVALIDATE_SEC * 1000,
  });
}

/** 사용자가 "새로고침"을 누르면 캐시를 건너뛰도록 비웁니다. */
export function invalidate(ref: SmartStoreRef): void {
  entries.delete(toStoreKey(ref));
}
