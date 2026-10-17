/**
 * Anthropic Messages API 어댑터 — fetch만 사용, SDK 없음.
 * 모델 ID와 단가는 2026-10-17 platform.claude.com 기준 (input/output $ per MTok).
 * 구조화 출력: output_config.format = {type:'json_schema', schema} (베타 헤더 불필요).
 */
import type { CompleteRequest, CompleteResult, TextEngine } from '../types.js';
import { extractJson } from '../util.js';

export const ANTHROPIC_MODELS = {
  'claude-fable-5-1': { input: 10, output: 50, tier: 'top' },
  'claude-opus-5-5': { input: 4, output: 20, tier: 'top' },
  'claude-sonnet-5-5': { input: 2, output: 10, tier: 'mid' },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, tier: 'low' },
} as const;

export type AnthropicModel = keyof typeof ANTHROPIC_MODELS;

export interface AnthropicEngineOptions {
  apiKey?: string; // 기본 process.env.ANTHROPIC_API_KEY
  model: AnthropicModel | (string & {});
  baseUrl?: string; // 기본 https://api.anthropic.com
  /** 'low' | 'medium' | 'high' — 짧은 구조화 작업은 low가 싸고 빠르다 */
  effort?: 'low' | 'medium' | 'high';
  thinkingHeadroom?: number;
  /** 재시도 횟수 (429/5xx). 기본 3 */
  retries?: number;
  timeoutMs?: number;
}

export function createAnthropicEngine(opts: AnthropicEngineOptions): TextEngine {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY가 없습니다. 환경변수 또는 opts.apiKey로 넘기세요.');
  const base = (opts.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');
  const price = (ANTHROPIC_MODELS as Record<string, { input: number; output: number }>)[opts.model];
  const retries = opts.retries ?? 3;

  return {
    id: `anthropic:${opts.model}`,
    async complete(req: CompleteRequest): Promise<CompleteResult> {
      const body: Record<string, unknown> = {
        model: opts.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
        // Claude 5.5 계열은 temperature를 거부하므로(400) 보내지 않습니다.
      };
      // 5.5 계열은 사고(thinking)가 기본으로 켜져 있어 작은 max_tokens를 사고 토큰이 모두 소진합니다.
      // 끌 수 있는 모델은 끄고, 끌 수 없는 모델(Opus 5.5 등)은 사고 여유분을 더해 본문이 잘리지 않게 합니다.
      const thinkingOff: Record<string, unknown> = { 'claude-haiku-5-5': { type: 'disabled' }, 'claude-sonnet-5-5': { type: 'between_tools' } };
      if (thinkingOff[opts.model]) body.thinking = thinkingOff[opts.model];
      else body.max_tokens = req.maxTokens + (opts.thinkingHeadroom ?? 8000);
      if (opts.effort) body.output_config = { ...(body.output_config as object | undefined), effort: opts.effort };
      if (req.jsonSchema) body.output_config = { ...(body.output_config as object | undefined), format: { type: 'json_schema', schema: req.jsonSchema } };

      let lastErr: unknown;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 120_000);
          const res = await fetch(`${base}/v1/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify(body),
            signal: ctrl.signal,
          });
          clearTimeout(timer);
          if (res.status === 429 || res.status >= 500) {
            lastErr = new Error(`anthropic ${res.status}: ${await res.text()}`);
            await sleep(1000 * 2 ** attempt);
            continue;
          }
          if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
          const data = (await res.json()) as {
            content: { type: string; text?: string }[];
            usage: { input_tokens: number; output_tokens: number };
            stop_reason: string;
          };
          const text = data.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
          if (process.env.STORY_QUALITY_DEBUG) console.error('[anthropic]', JSON.stringify({ model: opts.model, stop: data.stop_reason, usage: data.usage }));
          const usage = { input: data.usage.input_tokens, output: data.usage.output_tokens };
          const costUsd = price ? (usage.input * price.input + usage.output * price.output) / 1_000_000 : undefined;
          const json = req.jsonSchema || /^\s*[\[{]/.test(text) ? (extractJson(text) ?? undefined) : undefined;
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
