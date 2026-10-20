/*
 * 멈추지 않는 책 (R25): a provider that answers "busy" (HTTP 429 rate limit,
 * 500/502/503/504, Anthropic's 529 overloaded) has not produced anything we
 * pay for, so the same request is sent again after a short wait instead of
 * stopping the book. Bounded: two more tries (3 s, then 8 s, or the server's
 * Retry-After up to 30 s). Never retried:
 * - a request that never got an answer (network error, timeout, abort) — the
 *   provider may have finished and billed it, so buying it twice is possible;
 * - a 429 that says the balance or quota is used up (waiting will not help);
 * - every other status (401/403/404/400…), which needs the parent.
 * The response that ends the loop is returned unchanged, so the caller's
 * error wording stays as before.
 */
export const RETRY_STATUSES = Object.freeze(new Set([429, 500, 502, 503, 504, 529]));
export const RETRY_DELAYS_MS = Object.freeze([3000, 8000]);
export const RETRY_AFTER_MAX_MS = 30000;
const QUOTA_WORDS = /insufficient_quota|billing|credit balance|quota exceeded|exceeded your current quota/i;

const defaultSleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener?.("abort", stop);
      resolve();
    }
    function stop() {
      clearTimeout(timer);
      reject(abortError());
    }
    signal?.addEventListener?.("abort", stop, { once: true });
  });
function abortError() {
  return typeof DOMException === "function"
    ? new DOMException("요청을 중지했어요.", "AbortError")
    : Object.assign(new Error("요청을 중지했어요."), { name: "AbortError" });
}
/** Seconds or an HTTP date in Retry-After, capped; null when absent or invalid. */
export function retryAfterMs(response, now = Date.now()) {
  const value = response?.headers?.get?.("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.min(RETRY_AFTER_MAX_MS, ms);
}
/** A 429 that reports an empty balance or used-up quota is not worth waiting for. */
async function quotaExhausted(response) {
  if (response.status !== 429 || typeof response.clone !== "function") return false;
  try {
    return QUOTA_WORDS.test(await response.clone().text());
  } catch {
    return false;
  }
}
export function isRetryableStatus(status) {
  return RETRY_STATUSES.has(Number(status));
}
/**
 * fetch(url, options) with the bounded busy-retry above. `retry: false` (or
 * `delays: []`) sends exactly one request. `onRetry({status, attempt, waitMs})`
 * lets the caller say "잠시 기다렸다가 다시 보내요".
 */
export async function fetchWithRetry(
  fetchImpl,
  url,
  options = {},
  { signal = options.signal, delays = RETRY_DELAYS_MS, sleep = defaultSleep, onRetry } = {},
) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetchImpl(url, options);
    if (
      response?.ok ||
      !isRetryableStatus(response?.status) ||
      attempt >= delays.length ||
      (await quotaExhausted(response))
    )
      return response;
    const waitMs = retryAfterMs(response) ?? delays[attempt];
    onRetry?.({ status: response.status, attempt: attempt + 1, waitMs });
    // The busy answer's body is not needed; free the connection.
    try {
      await response.body?.cancel?.();
    } catch {}
    await sleep(waitMs, signal);
  }
}
