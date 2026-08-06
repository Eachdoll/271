/**
 * 스마트스토어 스토어 페이지 HTML에 인라인된 초기 상태 JSON을 추출합니다.
 *
 * JSON API 경로가 막히거나 스펙이 바뀌었을 때의 폴백입니다.
 * 페이지가 실제로 렌더링에 쓰는 데이터라서 API 경로보다 수명이 깁니다.
 */

/** 상태 JSON을 담는 전역 변수 이름 후보 */
const STATE_KEYS = [
  "__PRELOADED_STATE__",
  "__INITIAL_STATE__",
  "__NEXT_DATA__",
];

/** 탐색할 HTML 최대 길이 — 비정상적으로 큰 응답 방어 */
const MAX_HTML_LENGTH = 5_000_000;

export function extractPreloadedState(html: string): unknown | null {
  if (!html || html.length > MAX_HTML_LENGTH) return null;

  for (const key of STATE_KEYS) {
    const keyIndex = html.indexOf(key);
    if (keyIndex < 0) continue;

    const braceIndex = html.indexOf("{", keyIndex);
    if (braceIndex < 0) continue;

    const json = sliceBalancedObject(html, braceIndex);
    if (!json) continue;

    try {
      return JSON.parse(json);
    } catch {
      // 다음 후보 키로 계속 시도
    }
  }
  return null;
}

/**
 * `start` 위치의 `{`부터 짝이 맞는 `}`까지 잘라냅니다.
 * 문자열 리터럴 안의 중괄호와 이스케이프를 건너뛰므로 단순 카운팅보다 안전합니다.
 */
function sliceBalancedObject(source: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < source.length; i += 1) {
    const char = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}
