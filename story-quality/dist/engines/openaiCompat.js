import { extractJson } from '../util.js';
export function createOpenAICompatEngine(opts) {
    const base = opts.baseUrl.replace(/\/$/, '');
    const retries = opts.retries ?? 3;
    return {
        id: `openai-compat:${opts.model}`,
        async complete(req) {
            const body = {
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
            const headers = { 'content-type': 'application/json', ...(opts.extraHeaders ?? {}) };
            if (opts.apiKey)
                headers.authorization = `Bearer ${opts.apiKey}`;
            let lastErr;
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
                    if (!res.ok)
                        throw new Error(`openai-compat ${res.status}: ${await res.text()}`);
                    const data = (await res.json());
                    const text = data.choices?.[0]?.message?.content ?? '';
                    const usage = { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 };
                    const costUsd = opts.price ? (usage.input * opts.price.input + usage.output * opts.price.output) / 1_000_000 : undefined;
                    const json = /^\s*[\[{]/.test(text) || req.jsonSchema ? (extractJson(text) ?? undefined) : undefined;
                    return { text, json, usage, costUsd };
                }
                catch (e) {
                    lastErr = e;
                    if (attempt === retries)
                        break;
                    await sleep(1000 * 2 ** attempt);
                }
            }
            throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
        },
    };
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
