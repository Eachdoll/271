/**
 * OpenAI 호환 Chat Completions 어댑터 — OpenAI, 로컬(LM Studio / Ollama / mlx_lm.server), Gemini OpenAI 호환 엔드포인트, 각종 프록시.
 * baseUrl만 바꾸면 된다. 단가는 호출자가 넘긴다(공급자마다 달라 여기서 고정하지 않는다).
 */
import type { CompleteRequest, CompleteResult, TextEngine } from '../types.js';
import { extractJson } from '../util.js';

export interface OpenAICompatOptions {
  baseUrl: string; // 예: https://api.openai.com/v1 | http://localhost:1234/v1 | http://localhost:8080/v1
  model: string;
  apiKey?: string; // 로컬은 없어도 됨
  /** $ per MTok. 로컬이면 {input:0, output:0} */
  price?: { input: number; output: number };
  /** JSON 모드 지원 여부. 로컬 서버는 지원 안 하는 경우가 많아 기본 false → 프롬프트 지시 + 추출로 처리 */
  supportsJsonMode?: boolean;
  retries?: number;
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
}

export function createOpenAICompatEngine(opts: OpenAICompatOptions): TextEngine {
  const base = opts.baseUrl.replace(/\/$/, '');
  const retries = opts.retries ?? 3;
  return {
    id: `openai-compat:${opts.model}`,
    async complete(req: CompleteRequest): Promise<CompleteResult> {
      const body: Record<string, unknown> = {
        model: opts.model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        temperature: req.temperature,
        max_tokens: req.maxTokens,
      };
      if (req.jsonSchema && opts.supportsJsonMode) {
        body.response_format = { type: 'json_schema', json_schema: { name: 'out', schema: req.jsonSchema, strict: false } };
      }
      const headers: Record<string, string> = { 'content-type': 'application/json', ...(opts.extraHeaders ?? {}) };
      if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;

      let lastErr: unknown;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 180_000);
          const res = await fetch(`${base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
          clearTimeout(timer);
          if (res.status === 429 || res.status >= 500) {
            lastErr = new Error(`openai-compat ${res.status}: ${await res.text()}`);
            await sleep(1000 * 2 ** attempt);
            continue;
          }
          if (!res.ok) throw new Error(`openai-compat ${res.status}: ${await res.text()}`);
          const data = (await res.json()) as {
            choices: { message: { content: string | null } }[];
            usage?: { prompt_tokens: number; completion_tokens: number };
          };
          const text = data.choices?.[0]?.message?.content ?? '';
          const usage = { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 };
          const costUsd = opts.price ? (usage.input * opts.price.input + usage.output * opts.price.output) / 1_000_000 : undefined;
          const json = /^\s*[\[{]/.test(text) || req.jsonSchema ? (extractJson(text) ?? undefined) : undefined;
          return { text, json, usage, costUsd };
        } catch (e) {
          lastErr = e;
          if (attempt === retries) break;
          await sleep(1000 * 2 ** attempt);
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    },
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
