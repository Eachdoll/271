import { REQUEST_RATE_LIMIT } from "../../store-watch-core/src/const";

/**
 * IP 단위 호출 빈도 제한.
 *
 * 코어 README의 설계 규칙 2: 이 서버는 네이버로 나가는 통로이므로 제한이 없으면
 * 누구나 우리 서버를 경유해 네이버로 요청을 흘릴 수 있습니다.
 *
 * 개인 도구라 단일 프로세스를 전제로 메모리에만 둡니다.
 * 여러 인스턴스로 늘릴 일이 생기면 공유 저장소로 옮겨야 합니다.
 */
const hits = new Map<string, number[]>();

export function allowRequest(
  clientKey: string,
  now: number,
): { allowed: boolean; retryAfterSec: number } {
  const { limit, windowMs } = REQUEST_RATE_LIMIT;
  const windowStart = now - windowMs;

  const recent = (hits.get(clientKey) ?? []).filter((at) => at > windowStart);

  if (recent.length >= limit) {
    hits.set(clientKey, recent);
    // 가장 오래된 기록이 창 밖으로 나가면 다시 열립니다.
    const retryAfterMs = recent[0] + windowMs - now;
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }

  recent.push(now);
  hits.set(clientKey, recent);

  // 조용한 클라이언트가 계속 쌓이지 않도록 비어버린 항목은 버립니다.
  if (hits.size > 1000) {
    for (const [key, times] of hits) {
      if (times.every((at) => at <= windowStart)) hits.delete(key);
    }
  }

  return { allowed: true, retryAfterSec: 0 };
}
