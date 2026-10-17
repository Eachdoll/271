/**
 * 전문 단계 실측: 기존 줄거리(JSONL)를 재사용해 풍부→단순화(ko K1·en E0) → 근사 쪽 나누기 → 읽기 검사 → 아이 시뮬레이터.
 * 앱 quality-adapter의 전문 호출 규칙(비트 라벨·대화 3회·감각·12,000토큰)을 그대로 덧붙인다. 쪽 나누기는 앱 단계 대신
 * 수준별 쪽당 최대 문장 수로 자른 근사치다.
 * 사용: node eval/trial-2026-10-17/prose-trial.mjs <outlineRunId> <outRunId> [--limit N] [--mock] [--budget]
 *   --budget: 패키지 전문 단계에 pageCount(12)를 넘겨 전체 문장 예산을 건다(2026-10-17 r6 수정 검증용).
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { runProseStage, runChildGate } from '../../dist/pipeline.js';
import { createAnthropicEngine } from '../../dist/engines/anthropic.js';
import { splitSentences, analyzeEstimatedPage } from '../../../dist/reading-checker.js';
import { freezeReadingLevels, LEVEL_SEED } from '../../../dist/reading-levels.js';

const [inRun, outRun] = process.argv.slice(2);
const limit = Number(process.argv[process.argv.indexOf('--limit') + 1]) || 20;
const mock = process.argv.includes('--mock');
const BUDGET = process.argv.includes('--budget');
const CHILD_MAX = process.argv.includes('--package-child-budget') ? 0 : 4000;
const here = new URL('./', import.meta.url), root = new URL('../../', import.meta.url);
const gestureDict = JSON.parse(readFileSync(new URL('data/gesture_dictionary.json', root), 'utf8'));
const rows = readFileSync(new URL(`${inRun}.jsonl`, here), 'utf8').trim().split('\n').map(JSON.parse).filter((r) => r.outline).slice(0, limit);
const outPath = new URL(`${outRun}.jsonl`, here);
const done = new Set(existsSync(outPath) ? readFileSync(outPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).topicId) : []);
const frozen = freezeReadingLevels({ koreanLevel: 'K1', englishLevel: 'E0' });
const levels = Object.fromEntries([...Object.entries(LEVEL_SEED.ko), ...Object.entries(LEVEL_SEED.en)].map(([id, s]) => [id, structuredClone(s)]));
const characters = [{ name: '유하', nameEn: 'Yuha', traits: ['호기심 많음', '씩씩함'] }, { name: '초록이', nameEn: 'Choroki', traits: ['느긋함', '먹보'] }];
const charactersCompact = characters.map((c) => `${c.name} / ${c.nameEn}: ${c.traits.join('·')}`).join(' / ');
const names = characters.flatMap((c) => [c.name, c.nameEn]);

function mockEngine(id) {
  return { id, async complete(req) {
    const isKo = /[가-힣]{4}/.test(req.user.slice(0, 400));
    if (/JSON/.test(req.system) && /pages|retell/.test(req.user)) return { text: '{"pages":[{"pageNo":1,"score":2,"childQuestion":null,"why":"ok"}],"dropPages":[],"overall":8,"retell":["a","b","c"],"coveredBeats":[1,2,3,4,5,6,7,8],"missingCore":[],"confusions":[],"coherence":8}', json: undefined, usage: { input: 1, output: 1 }, costUsd: 0 };
    const beats = [...req.user.matchAll(/^(\d+) \[/gm)].map((m) => m[1]);
    const body = (beats.length ? beats : ['1', '2']).map((n) => isKo ? `[비트 ${n}]\n유하가 웃어요. "가자!" 초록이가 말해요.` : `[Beat ${n}]\nYuha runs. "Go!" says Choroki.`).join('\n\n');
    return { text: body, usage: { input: 1, output: 1 }, costUsd: 0 };
  } };
}
const sonnet = mock ? mockEngine('mock-sonnet') : createAnthropicEngine({ model: 'claude-sonnet-5-5' });
const haiku = mock ? mockEngine('mock-haiku') : createAnthropicEngine({ model: 'claude-haiku-5-5' });

function wrap(engine, lang, outline, role) {
  const labels = lang === 'ko' ? '[비트 n · 유형]' : '[Beat n · type]';
  const rules = `OUTPUT FORMAT OVERRIDE: return ${lang === 'ko' ? 'Korean' : 'English'} plain story text only, NOT JSON, with ${labels} at each beat paragraph start. Keep labels through rich, simplify and emotion fixes. Follow every approved beat, all causal state changes, without introducing new events. EVERY sentence, including dialogue, has an explicit grammatical subject. Attribute dialogue to a selected named speaker. Include at least THREE quoted dialogue turns in this language and one concrete sensory detail per beat. English is original writing at its E level, never a Korean translation. ${role === 'prose' ? 'Rich draft may use the package rich level for syntax; simplify/fix must return to the frozen target level without removing causal events.' : ''}`;
  const spec = frozen.specs[lang], specLite = { id: spec.id, label: spec.label, sentencesPerPage: spec.sentencesPerPage, wordsPerSentence: spec.wordsPerSentence };
  return { id: engine.id, async complete(req) {
    const t0 = Date.now();
    const r = await engine.complete({ ...req, system: `${req.system}\n${rules}`, user: `${req.user}\n\nFROZEN_APPROVED_OUTLINE_JSON: ${JSON.stringify(outline)}\n${role === 'prose' ? 'FINAL_TARGET_LEVEL_FOR_LATER_SIMPLIFY_ONLY' : 'TARGET_LEVEL_SPEC_JSON'}: ${JSON.stringify(specLite)}`, maxTokens: 12000 });
    calls.push({ lang, role, ms: Date.now() - t0, out: r.usage?.output, cost: r.costUsd ?? 0 });
    return r;
  } };
}
let calls = [];
function parseLabeled(text) {
  const parts = String(text || '').split(/^\s*\[(?:비트|Beat)\s+(\d+)[^\]\n]*\]\s*/gimu);
  const paras = [];
  for (let i = 1; i < parts.length; i += 2) paras.push({ beat: Number(parts[i]), text: parts[i + 1].trim().replace(/\s*\n\s*/g, ' ') });
  return paras;
}
function sentencesOf(text) {
  const out = []; let cur = '', open = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]; cur += ch;
    if (ch === '"' ) open = !open; else if (ch === '“') open = true; else if (ch === '”') open = false;
    const next = text[i + 1];
    const end = /[.!?。]/.test(ch) && !open && (next === undefined || /\s/.test(next));
    const quoteEnd = /["”]/.test(ch) && !open && /[.!?]/.test(text[i - 1] || '') && (next === undefined || (/\s/.test(next) && !/[a-z]/.test(text[i + 2] || '')));
    if (end || quoteEnd) { if (cur.trim()) out.push(cur.trim()); cur = ''; }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function paginate(paras, pageCount) {
  const all = paras.flatMap((p) => sentencesOf(p.text).map((t) => ({ beat: p.beat, t })));
  const pages = [];
  for (let i = 0; i < pageCount; i++) { const a = Math.round((i * all.length) / pageCount), b = Math.round(((i + 1) * all.length) / pageCount); const chunk = all.slice(a, b); if (chunk.length) pages.push({ beat: chunk[0].beat, text: chunk.map((c) => c.t).join(' ') }); }
  return pages.map((p, i) => ({ pageNo: i + 1, ...p }));
}
const PAGE_COUNT = JSON.parse(readFileSync(new URL('eval/testset.json', root), 'utf8')).pages || 12;
const quoteCount = (t) => (t.match(/["“][^"”]+["”]/g) || []).length;

for (const row of rows) {
  if (done.has(row.topicId)) continue;
  calls = []; const t0 = Date.now(); const out = { runId: outRun, topicId: row.topicId, topic: row.topic, outlineRun: inRun };
  try {
    const outline = row.outline;
    for (const lang of ['ko', 'en']) {
      const target = lang === 'ko' ? 'K1' : 'E0';
      const res = await runProseStage({ engines: { outline: wrap(sonnet, lang, outline, 'outline'), prose: wrap(sonnet, lang, outline, 'prose'), cheap: wrap(haiku, lang, outline, 'cheap') }, lang, outline, charactersCompact, briefsCompact: '[]', emotions: [], gestureDict, levels, targetLevelId: target, vocabLabel: lang === 'ko' ? 'frozen selected vocabulary' : 'dolch_preprimer+everyday_nouns', twoPass: true, ...(BUDGET ? { pageCount: PAGE_COUNT } : {}) });
      const paras = parseLabeled(res.simplified), richParas = parseLabeled(res.rich);
      const spec = frozen.specs[lang], perPage = spec.sentencesPerPage?.max ?? (Array.isArray(spec.sentencesPerPage) ? spec.sentencesPerPage[1] : 2);
      const pages = paginate(paras, PAGE_COUNT);
      const checks = pages.map((p) => analyzeEstimatedPage(p.text, spec, { language: lang, allowedNames: names }));
      const violations = {}; for (const c of checks) for (const v of c.violations) { const k = typeof v === 'string' ? v.split(/[:(]/)[0] : (v.code || v.type || JSON.stringify(v).slice(0, 40)); violations[k] = (violations[k] || 0) + 1; }
      const beatsCovered = new Set(paras.map((p) => p.beat));
      out[lang] = { rich: res.rich, simplified: res.simplified, calls: res.calls, tellHitsAfter: res.tellHitsAfter, condensed: res.condensed ?? null, packageSentenceCount: res.sentenceCount ?? null,
        labeledBeats: beatsCovered.size, outlineBeats: outline.beats.length, missingBeats: outline.beats.map((b) => b.index).filter((i) => !beatsCovered.has(i)),
        richChars: res.rich.length, simplifiedChars: res.simplified.length, sentences: pages.reduce((n, p) => n + sentencesOf(p.text).length, 0),
        dialogue: quoteCount(res.simplified), richDialogue: quoteCount(res.rich), richParagraphs: richParas.length,
        pages: pages.length, pagesPassed: checks.filter((c) => c.passed).length, violations,
        avgWordsPerSentence: +(checks.reduce((s, c) => s + c.metrics.averageWordsPerSentence, 0) / Math.max(1, checks.length)).toFixed(2),
        outOfVocabRatio: lang === 'en' ? +(checks.reduce((s, c) => s + (c.metrics.outOfVocabCount || 0), 0) / Math.max(1, checks.reduce((s, c) => s + c.metrics.wordCount, 0))).toFixed(3) : null,
        pageTexts: pages.map((p) => p.text), sentenceBudget: PAGE_COUNT * perPage, sentencesPerPageMax: perPage };
      if (lang === 'ko') {
        const childEngine = { id: haiku.id, async complete(req) { const r = await haiku.complete({ ...req, maxTokens: Math.max(req.maxTokens, CHILD_MAX) }); calls.push({ lang, role: 'child-call', requested: req.maxTokens, out: r.usage?.output, cost: r.costUsd ?? 0 }); return r; } };
        const gate = await runChildGate({ outline: childEngine, prose: childEngine, cheap: childEngine }, pages.map((p) => ({ pageNo: p.pageNo, text: p.text })), paras.map((p) => p.text).join('\n\n'), outline);
        
        out.child = { pass: gate.pass, curiosityOverall: gate.curiosity.overall, curiosityPass: gate.curiosity.pass, dropPages: gate.rewritePages, zeroPages: gate.curiosity.pages.filter((p) => p.score === 0).length, scoredPages: gate.curiosity.pages.length, retell: gate.retell.retell, retellCoherence: gate.retell.coherence, retellPass: gate.retell.pass, missingCore: gate.retell.missingCore, turnRewrite: gate.rewriteTurnParagraph };
      }
    }
  } catch (e) { out.error = String(e?.message || e); }
  out.calls = calls.length; out.costUsd = calls.reduce((s, c) => s + (c.cost || 0), 0); out.latencyMs = Date.now() - t0; out.callLog = calls;
  appendFileSync(outPath, JSON.stringify(out) + '\n');
  console.log(`${row.topicId} ${out.error ? 'ERR ' + out.error : `ko ${out.ko.pagesPassed}/${out.ko.pages}p en ${out.en.pagesPassed}/${out.en.pages}p child ${out.child.pass ? '✓' : '✗'} cur ${out.child.curiosityOverall} ret ${out.child.retellCoherence}`} $${out.costUsd.toFixed(3)} ${Math.round(out.latencyMs / 1000)}s`);
}
