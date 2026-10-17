/** Reuse paid outlines; evaluate prose with shared app checks and explicit approximate pagination. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { runProseStage, runChildGate } from '../pipeline.js';
import { hashString } from '../util.js';
const parse = (text) => [...text.matchAll(/^\s*\[(?:비트|Beat)\s+(\d+)[^\]\n]*\]\s*([\s\S]*?)(?=^\s*\[(?:비트|Beat)\s+\d+|$(?![\s\S]))/gimu)].map(m => ({ beat: Number(m[1]), text: m[2].trim().replace(/\s*\n\s*/g, ' ') }));
const clone = (value) => structuredClone(value);
export async function runProseEvaluation(config) {
    if (config.limit !== undefined && (!Number.isInteger(config.limit) || config.limit < 0))
        throw new Error('limit must be a nonnegative integer.');
    if (resolve(config.from) === resolve(config.out))
        throw new Error('Input and output must be different.');
    if (!Number.isInteger(config.pageCount) || config.pageCount < 1 || config.pageCount > 24)
        throw new Error('pageCount must be 1..24.');
    const readingModule = new URL('../../../dist/reading-checker.js', import.meta.url).href;
    const levelsModule = new URL('../../../dist/reading-levels.js', import.meta.url).href;
    const paginationModule = new URL('../../../dist/story-generation/pagination.js', import.meta.url).href;
    const { analyzeEstimatedPage, splitSentences } = await import(readingModule);
    const { freezeReadingLevels, LEVEL_SEED } = await import(levelsModule);
    const { splitPaginationToCount } = await import(paginationModule);
    const inputRows = readFileSync(config.from, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(row => row.outline).slice(0, config.limit && config.limit > 0 ? config.limit : undefined);
    const frozen = freezeReadingLevels({ koreanLevel: 'K1', englishLevel: 'E0' });
    const levels = clone({ ...LEVEL_SEED.ko, ...LEVEL_SEED.en });
    const mode = { stage: 'prose', mock: config.mock === true, budget: config.budget === true || config.condense === true, condense: config.condense === true, pageCount: config.pageCount, generator: config.mock ? 'mock-sonnet' : config.generator?.id, cheap: config.mock ? 'mock-haiku' : config.cheap?.id };
    const signature = JSON.stringify(mode);
    mkdirSync(dirname(config.out), { recursive: true });
    const previous = existsSync(config.out) ? readFileSync(config.out, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
    if (previous.some(row => row.configSignature !== signature))
        throw new Error('Existing output has different options; choose a new --run-id.');
    const done = new Map(previous.map(row => [row.topicId, row]));
    let skipped = 0;
    for (const row of inputRows) {
        const fingerprint = hashString(JSON.stringify(row.outline));
        if (done.has(row.topicId)) {
            if (done.get(row.topicId).outlineFingerprint !== fingerprint)
                throw new Error('Outline changed; choose a new --run-id.');
            skipped++;
            continue;
        }
        const started = Date.now(), outline = row.outline, calls = [];
        const out = { ...mode, runId: config.runId, topicId: row.topicId, topic: row.topic, outlineRun: row.runId, outlineFingerprint: fingerprint, configSignature: signature, pagination: { approximate: true, method: 'app splitPaginationToCount (API-free structural fallback)', note: '근사 쪽 나누기: 앱의 수동 쪽 수 복구 함수를 공유합니다. 실제 AI 쪽 나누기·일관성 검사는 실행하지 않습니다.' } };
        try {
            const generated = {};
            for (const lang of ['ko', 'en']) {
                const mockEngine = { id: 'mock-prose', async complete() { return { text: outline.beats.map(beat => lang === 'ko' ? `[비트 ${beat.index} · ${beat.type}] 유하가 작은 잎을 만져요. 유하가 “나는 바람을 들어요.”라고 말해요.` : `[Beat ${beat.index} · ${beat.type}] Yuha sees a small leaf. Yuha says, “I hear the wind.”`).join('\n\n'), usage: { input: 1, output: 1 }, costUsd: 0 }; } };
                const wrap = (role) => ({ id: config.mock ? 'mock-prose' : (role === 'prose' ? config.generator : config.cheap).id, async complete(request) {
                        const engine = config.mock ? mockEngine : role === 'prose' ? config.generator : config.cheap;
                        const response = await engine.complete({ ...request, system: `${request.system}\nOUTPUT FORMAT OVERRIDE: return ${lang === 'ko' ? 'Korean' : 'English'} plain story text only, NOT JSON, with ${lang === 'ko' ? '[비트 n · 유형]' : '[Beat n · type]'} at each beat paragraph start. Keep labels through rich, simplify and emotion fixes. Follow every approved beat and causal state change. EVERY sentence including dialogue has an explicit grammatical subject. Attribute dialogue to a named speaker. Include at least THREE quoted dialogue turns and one concrete sensory detail per beat. English is original writing at its E level, never a Korean translation.`, user: `${request.user}\nFROZEN_APPROVED_OUTLINE_JSON: ${JSON.stringify(outline)}\nTARGET_LEVEL_SPEC_JSON: ${JSON.stringify(frozen.specs[lang])}`, maxTokens: 12000 });
                        calls.push({ lang, role, input: response.usage.input, output: response.usage.output, costUsd: response.costUsd ?? 0 });
                        return response;
                    } });
                const prose = wrap('prose'), cheap = wrap('cheap');
                const result = await runProseStage({ engines: { outline: prose, prose, cheap }, lang, outline, charactersCompact: '유하 / Yuha: 호기심 많음 · 초록이 / Choroki: 느긋함', briefsCompact: '[]', emotions: [], gestureDict: config.gestureDict, levels, targetLevelId: lang === 'ko' ? 'K1' : 'E0', twoPass: true, ...(config.budget || config.condense ? { pageCount: config.pageCount } : {}), ...(config.condense ? { condenseOverBudget: true } : {}) });
                const paragraphs = parse(result.simplified), ids = new Set(paragraphs.map(p => p.beat));
                if (outline.beats.some(b => !ids.has(b.index)))
                    throw new Error(`${lang} prose is missing beat labels.`);
                generated[lang] = { result, paragraphs };
            }
            const pages = splitPaginationToCount({ cover: { title: outline.titleCandidates?.[0] || row.topic }, pages: outline.beats.map((beat, index) => ({ pageNo: index + 1, beatIndex: beat.index, textKo: generated.ko.paragraphs.filter((p) => p.beat === beat.index).map((p) => p.text).join(' '), textEn: generated.en.paragraphs.filter((p) => p.beat === beat.index).map((p) => p.text).join(' ') })) }, config.pageCount, { outline }).pages;
            for (const lang of ['ko', 'en']) {
                const textKey = lang === 'ko' ? 'textKo' : 'textEn', spec = frozen.specs[lang], checks = pages.map((p) => analyzeEstimatedPage(p[textKey], spec, { language: lang, allowedNames: ['유하', 'Yuha', '초록이', 'Choroki'] }));
                out[lang] = { rich: generated[lang].result.rich, simplified: generated[lang].result.simplified, condensed: generated[lang].result.condensed ?? null, packageSentenceCount: generated[lang].result.sentenceCount ?? null, labeledBeats: generated[lang].paragraphs.length, missingBeats: [], pages: pages.length, pagesPassed: checks.filter((c) => c.passed).length, pageTexts: pages.map((p) => p[textKey]), sentences: pages.reduce((sum, p) => sum + splitSentences(p[textKey]).length, 0), checks };
            }
            const child = { id: config.mock ? 'mock-child' : config.cheap.id, async complete(request) {
                    const curiosity = request.system.includes('다음엔?');
                    const value = curiosity ? { pages: pages.map((p) => ({ pageNo: p.pageNo, score: 2, childQuestion: null, why: '다음 행동 기대' })), dropPages: [], overall: 2 } : { retell: ['유하가 잎을 찾았어요.', '유하가 바람을 들었어요.', '유하가 집에 왔어요.'], coveredBeats: outline.beats.filter(b => ['want', 'turn', 'resolution'].includes(b.type)).map(b => b.index), missingCore: [], confusions: [], coherence: 2 };
                    const response = config.mock ? { text: JSON.stringify(value), json: value, usage: { input: 1, output: 1 }, costUsd: 0 } : await config.cheap.complete({ ...request, maxTokens: curiosity ? Math.max(request.maxTokens, 2000) : request.maxTokens });
                    calls.push({ lang: 'ko', role: 'child', input: response.usage.input, output: response.usage.output, costUsd: response.costUsd ?? 0 });
                    return response;
                } };
            out.child = await runChildGate({ outline: child, prose: child, cheap: child }, pages.map((p) => ({ pageNo: p.pageNo, text: p.textKo })), generated.ko.paragraphs.map((p) => p.text).join('\n\n'), outline);
        }
        catch (error) {
            out.error = error instanceof Error ? error.message : String(error);
        }
        out.calls = calls.length;
        out.costUsd = calls.reduce((sum, call) => sum + call.costUsd, 0);
        out.callLog = calls;
        out.latencyMs = Date.now() - started;
        appendFileSync(config.out, JSON.stringify(out) + '\n');
        done.set(row.topicId, out);
    }
    const selected = inputRows.map(row => done.get(row.topicId)).filter(Boolean);
    const summary = { runId: config.runId, ...mode, pagination: { approximate: true, method: 'app splitPaginationToCount' }, n: selected.length, skipped, errors: selected.filter(row => row.error).length, costUsd: selected.reduce((sum, row) => sum + row.costUsd, 0), curiosityPassCount: selected.filter(row => row.child?.curiosity?.pass).length, retellPassCount: selected.filter(row => row.child?.retell?.pass).length };
    writeFileSync(config.out.replace(/\.jsonl$/, '') + '.summary.json', JSON.stringify(summary, null, 2));
    return summary;
}
