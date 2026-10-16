/**
 * OpenAI 호환 Chat Completions 어댑터 — OpenAI, 로컬(LM Studio / Ollama / mlx_lm.server), Gemini OpenAI 호환 엔드포인트, 각종 프록시.
 * baseUrl만 바꾸면 된다. 단가는 호출자가 넘긴다(공급자마다 달라 여기서 고정하지 않는다).
 */
import type { TextEngine } from '../types.js';
export interface OpenAICompatOptions {
    baseUrl: string;
    model: string;
    apiKey?: string;
    /** $ per MTok. 로컬이면 {input:0, output:0} */
    price?: {
        input: number;
        output: number;
    };
    /** JSON 모드 지원 여부. 로컬 서버는 지원 안 하는 경우가 많아 기본 false → 프롬프트 지시 + 추출로 처리 */
    supportsJsonMode?: boolean;
    retries?: number;
    timeoutMs?: number;
    extraHeaders?: Record<string, string>;
}
export declare function createOpenAICompatEngine(opts: OpenAICompatOptions): TextEngine;
