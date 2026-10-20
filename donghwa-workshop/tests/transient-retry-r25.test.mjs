import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchWithRetry, retryAfterMs, RETRY_DELAYS_MS} from '../dist/transient-retry.js';
import {createTextEngine} from '../dist/text-generation/providers.js';

/** R25 멈추지 않는 책: a busy provider is asked again; nothing paid is bought twice. */
const busy = (status, body = '', headers = {}) => new Response(body, {status, headers});
const ok = () => new Response('{}', {status: 200});
const noSleep = (waits) => async (ms) => { waits.push(ms); };

test('R25 429/5xx/529 are retried twice with 3 s and 8 s waits, then the last answer is returned', async () => {
  assert.deepEqual([...RETRY_DELAYS_MS], [3000, 8000]);
  for (const status of [429, 500, 502, 503, 504, 529]) {
    let calls = 0; const waits = [];
    const response = await fetchWithRetry(async () => (++calls < 3 ? busy(status) : ok()), 'u', {}, {sleep: noSleep(waits)});
    assert.equal(response.status, 200); assert.equal(calls, 3); assert.deepEqual(waits, [3000, 8000]);
  }
  let calls = 0;
  const last = await fetchWithRetry(async () => { calls++; return busy(503); }, 'u', {}, {sleep: noSleep([])});
  assert.equal(last.status, 503); assert.equal(calls, 3);
});

test('R25 never retried: other statuses, an empty balance, and a request that got no answer', async () => {
  for (const status of [400, 401, 403, 404, 422]) {
    let calls = 0;
    const response = await fetchWithRetry(async () => { calls++; return busy(status); }, 'u', {}, {sleep: noSleep([])});
    assert.equal(response.status, status); assert.equal(calls, 1);
  }
  let calls = 0;
  const quota = await fetchWithRetry(async () => { calls++; return busy(429, '{"error":{"code":"insufficient_quota"}}'); }, 'u', {}, {sleep: noSleep([])});
  assert.equal(quota.status, 429); assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(fetchWithRetry(async () => { calls++; throw new TypeError('Failed to fetch'); }, 'u', {}, {sleep: noSleep([])}), /Failed to fetch/);
  assert.equal(calls, 1);
});

test('R25 Retry-After is honoured up to 30 s, and stopping during the wait aborts', async () => {
  assert.equal(retryAfterMs(busy(429, '', {'Retry-After': '5'})), 5000);
  assert.equal(retryAfterMs(busy(429, '', {'Retry-After': '600'})), 30000);
  assert.equal(retryAfterMs(busy(429)), null);
  const waits = [];
  await fetchWithRetry(async () => (waits.length ? ok() : busy(429, '', {'Retry-After': '2'})), 'u', {}, {sleep: noSleep(waits)});
  assert.deepEqual(waits, [2000]);
  const controller = new AbortController();
  const pending = fetchWithRetry(async () => busy(503), 'u', {}, {signal: controller.signal, delays: [60000]});
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, (error) => error.name === 'AbortError');
});

test('R25 the text engine sends a busy request again and returns the answer, with one billed request', async () => {
  const reply = {content: [{type: 'text', text: '{"a":1}'}], stop_reason: 'end_turn', usage: {input_tokens: 10, output_tokens: 20}};
  let http = 0;
  const engine = createTextEngine({engine: 'anthropic', config: {apiKey: 'sk-ant-test-fake', model: 'claude-opus-5-5', retryDelaysMs: [0, 0], fetch: async () => (++http === 1 ? busy(529) : new Response(JSON.stringify(reply), {status: 200}))}});
  const result = await engine.complete({system: 's', user: 'u', jsonSchema: {type: 'object'}, maxTokens: 100});
  assert.equal(http, 2); assert.deepEqual(result.json, {a: 1}); assert.equal(result.meta.requests, 1);
  // A 401 still stops at once with the same wording as before.
  http = 0;
  const denied = createTextEngine({engine: 'anthropic', config: {apiKey: 'sk-ant-test-fake', model: 'claude-opus-5-5', retryDelaysMs: [0, 0], fetch: async () => { http++; return busy(401); }}});
  await assert.rejects(denied.complete({system: 's', user: 'u', jsonSchema: {type: 'object'}, maxTokens: 100}), /인증에 실패했어요[\s\S]*HTTP 401/);
  assert.equal(http, 1);
  // Still busy after the two retries: one clear message, three requests sent.
  http = 0;
  const swamped = createTextEngine({engine: 'anthropic', config: {apiKey: 'sk-ant-test-fake', model: 'claude-opus-5-5', retryDelaysMs: [0, 0], fetch: async () => { http++; return busy(503); }}});
  await assert.rejects(swamped.complete({system: 's', user: 'u', jsonSchema: {type: 'object'}, maxTokens: 100}), /지금 바빠요[\s\S]*HTTP 503/);
  assert.equal(http, 3);
});
