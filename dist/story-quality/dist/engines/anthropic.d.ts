/**
 * Anthropic Messages API 어댑터 — fetch만 사용, SDK 없음.
 * 모델 ID와 단가는 2026-10-17 platform.claude.com 기준 (input/output $ per MTok).
 * 구조화 출력: output_config.format = {type:'json_schema', schema} (베타 헤더 불필요).
 */
import type { TextEngine } from '../types.js';
export declare const ANTHROPIC_MODELS: {
    readonly 'claude-fable-5-1': {
        readonly input: 10;
        readonly output: 50;
        readonly tier: "top";
    };
    readonly 'claude-opus-5-5': {
        readonly input: 4;
        readonly output: 20;
        readonly tier: "top";
    };
    readonly 'claude-sonnet-5-5': {
        readonly input: 2;
        readonly output: 10;
        readonly tier: "mid";
    };
    readonly 'claude-haiku-5-5': {
        readonly input: 0.1;
        readonly output: 0.5;
        readonly tier: "low";
    };
};
export type AnthropicModel = keyof typeof ANTHROPIC_MODELS;
export interface AnthropicEngineOptions {
    apiKey?: string;
    model: AnthropicModel | (string & {});
    baseUrl?: string;
    /** 'low' | 'medium' | 'high' — 짧은 구조화 작업은 low가 싸고 빠르다 */
    effort?: 'low' | 'medium' | 'high';
    /** 재시도 횟수 (429/5xx). 기본 3 */
    retries?: number;
    timeoutMs?: number;
}
export declare function createAnthropicEngine(opts: AnthropicEngineOptions): TextEngine;
