import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {generateQualityProse} from '../dist/story-generation/quality-adapter.js';
import {assertValid} from '../dist/story-generation/schemas.js';
import {normalizeStoryInput, generateProse, budgetFor} from '../dist/story-generation/pipeline.js';
import {demoOutline, demoProse} from '../dist/story-generation/demo.js';
import {freezeReadingLevels, getLevelSpec, KOREAN_LEVELS, ENGLISH_LEVELS} from '../dist/reading-levels.js';
import {openingsLayoutPolicy, textEstimateArgs} from '../dist/book-layout.js';
import * as P from '../dist/story-generation/opening-prose.js';
import {createTextEngine} from '../dist/text-generation/providers.js';
import {estimateStoryTextCost} from '../dist/text-generation/models.js';
import {splitSentences} from '../dist/story-quality/dist/util.js';
import * as qualityModule from '../story-quality/dist/pipeline.js';

/**
 * R12-P3: openings prose is requested at the frozen per-beat (= per-opening)
 * ranges, within token budgets and timeouts sized from the frozen specs, with
 * one journal-recorded length-fit call per language. Page drafts keep every
 * request byte for byte (the P0 'requests' pin proves the bytes).
 */
const clone = value => JSON.parse(JSON.stringify(value));
const read = async file => JSON.parse(await readFile(new URL(`../story-quality/data/${file}.json`, import.meta.url), 'utf8'));
const goldPart = async part => JSON.parse(await readFile(new URL(`../story-quality/gold/gold_outlines_part${part}.json`, import.meta.url), 'utf8'));
const DATA = {inventories: await read('inventories'), gestureDictionary: await read('gesture_dictionary'), plotPatterns: await read('plot_patterns'), worldLibrary: await read('worlds'), goldBooks: [...await goldPart(1), ...await goldPart(2)]};
const V4 = (ko, en) => freezeReadingLevels({koreanLevel: ko, englishLevel: en}, {}, {layout: 'openings'}).specs;
const CAST = [{id: 'yuha', name: '유하', nameEn: 'Yuha', traits: ['관찰하는 아이']}, {id: 'green', name: '그린이', nameEn: 'Green', traits: ['느긋한 친구']}];
const PLACES = [{id: 'home', type: 'home', name: '유하의 집'}, {id: 'garden', name: '꽃 정원'}, {id: 'pond', name: '연못 길'}];
function openingsInput({pageCount = 16, ko = 'K2', en = 'E2', quality = true} = {}) {
  return normalizeStoryInput({
    bookId: 'openings-prose', topic: '비 오는 날', characters: CAST, backgrounds: PLACES, pageCount, endingType: 'home_sleep',
    layoutPolicy: openingsLayoutPolicy(), specs: V4(ko, en), prosePolicy: {version: 1, condenseOverBudget: {ko: true, en: true}},
    storyQuality: quality ? {enabled: true, useBeamSearch: false, twoPass: true, childSimulator: false} : {enabled: false},
  });
}
function legacyInput({pageCount = 16, quality = true} = {}) {
  return normalizeStoryInput({
    bookId: 'legacy-prose', topic: '비 오는 날', characters: CAST, backgrounds: PLACES, pageCount, endingType: 'home_sleep',
    specs: {ko: getLevelSpec('K2'), en: getLevelSpec('E2')},
    storyQuality: quality ? {enabled: true, useBeamSearch: false, twoPass: true, childSimulator: false} : {enabled: false},
  });
}
const outlineFor = input => {
  const count = input.layoutPolicy ? input.pageCount / 2 : 8;
  const types = ['setup', 'want', ...Array.from({length: count - 5}, () => 'attempt'), 'turn', 'resolution', 'close'];
  const base = demoOutline(input);
  return {...base, beats: base.beats.map((beat, i) => ({...beat, type: types[i]})), refrain: null};
};
const koBeat = (count, salt = '') => Array.from({length: count}, (_, i) => `유하가 ${salt}작은 잎을 ${i + 1}번 만져요.`).join(' ');
const enBeat = (count, salt = '') => Array.from({length: count}, (_, i) => `Yuha sees ${salt}a small leaf ${i + 1} times.`).join(' ');
const services = () => ({engineFor: async options => options.engine, qualityData: DATA, qualityModule: async () => qualityModule, baseSystem: 'APP_BASE_RULES', levelRules: () => 'FROZEN_LEVEL_SPECS', assertValid, normalizeStoryInput});

/** A mock quality engine: rich/simplify return labeled text with `counts[lang][beat]` sentences. */
function qualityEngine(counts, {fit} = {}) {
  const calls = [];
  return {id: 'openai', calls, async complete(request) {
    const lang = /\[Beat|English/u.test(request.user.slice(0, 400)) || /Target level|Level for this draft|\[Length fit\]/u.test(request.user) ? 'en' : 'ko';
    const kind = /분량만 맞추는|only adjust the length/u.test(request.system) ? 'fit' : /\[목표 수준\]|\[Target level\]/u.test(request.user) ? 'simplify' : 'rich';
    calls.push({kind, lang, request});
    const outline = JSON.parse(request.user.match(/FROZEN_APPROVED_OUTLINE_JSON: (.*)\n/u)?.[1] ?? '{"beats":[]}');
    if (kind === 'fit') return {text: fit(request, lang), usage: {input: 10, output: 5}, meta: {requests: 1}};
    const text = outline.beats.map(beat => `${lang === 'ko' ? `[비트 ${beat.index} · ${beat.type}]` : `[Beat ${beat.index} · ${beat.type}]`} ${(lang === 'ko' ? koBeat : enBeat)(counts[lang][beat.index] ?? counts[lang].default)}`).join('\n\n');
    return {text, usage: {input: 10, output: 5}, meta: {requests: 1}};
  }};
}

test('R12-P3 rich row asks 11~17 sentences per beat at K3 eojeol, simplify 10~16, no [전체 분량] line, APP CANON layout and LAYOUT rule', async () => {
  const input = openingsInput(), outline = outlineFor(input);
  const engine = qualityEngine({ko: {default: 12}, en: {default: 4}});
  const result = await generateQualityProse(outline, input, {engine}, services());
  const rich = engine.calls.find(c => c.kind === 'rich' && c.lang === 'ko').request, simplify = engine.calls.find(c => c.kind === 'simplify' && c.lang === 'ko').request;
  assert.match(rich.user, /문장당 7~10어절, 비트당 11~17문장/u);
  assert.match(simplify.user, /문장당 5~7어절, 비트당 10~16문장/u);
  const enRich = engine.calls.find(c => c.kind === 'rich' && c.lang === 'en').request, enSimplify = engine.calls.find(c => c.kind === 'simplify' && c.lang === 'en').request;
  assert.match(enRich.user, /8~12 words per sentence, 3~6 sentences per beat/u);
  assert.match(enSimplify.user, /5~9 words per sentence, 2~5 sentences per beat/u);
  for (const {request} of engine.calls) {
    assert.doesNotMatch(request.user, /\[전체 분량\]|\[Total length\]/u);
    assert.match(request.system, /APP CANON: .*"pageCount":16,"layout":\{"openings":8,"printedPages":16,"oneBeatPerOpening":true\}/u);
    assert.match(request.system, /LAYOUT: 8 openings = 16 printed pages; each approved beat paragraph is one opening \(Korean 10–15 sentences, target 12; English 2–4 sentences, target 4\)/u);
    assert.equal(request.maxTokens, budgetFor('qualityWrap', input));
    assert.equal(request.timeoutMs, 60000 + 15 * request.maxTokens);
  }
  assert.equal(engine.calls.filter(c => c.kind === 'fit').length, 0, 'all beats in band: no fit call');
  assert.equal(result.meta.requests, 4);
  // A legacy quality draft keeps the page rows, its [전체 분량] line, 12000 tokens and no timeoutMs.
  const legacy = legacyInput(), legacyEngine = qualityEngine({ko: {default: 3}, en: {default: 2}});
  await generateQualityProse(outlineFor(legacy), legacy, {engine: legacyEngine}, services());
  for (const {request} of legacyEngine.calls) {
    assert.equal(request.maxTokens, 12000);
    assert.ok(!('timeoutMs' in request));
    assert.doesNotMatch(request.system, /"layout"|LAYOUT:/u);
  }
  assert.match(legacyEngine.calls.find(c => c.kind === 'simplify' && c.lang === 'ko').request.user, /\[전체 분량\] 16쪽/u);
});

test('R12-P3 budgetFor sizes openings stages from the frozen specs (≥ 1.25 × worst, ≤ 32000); legacy budgets and timeouts unchanged', () => {
  const legacy = {outline: 16000, plotContract: 12000, coherence: 5000, coherenceRepair: 16000, beat: 1300, prose: 12000, pagination: 14000, page: 2000, paragraph: 3000, scene: 500, materials: 7000, sceneBriefs: 14000, sceneBrief: 2000, enrichment: 3000};
  const page = legacyInput({quality: false});
  for (const [stage, tokens] of Object.entries(legacy)) assert.equal(budgetFor(stage, page), tokens, stage);
  assert.deepEqual(P.openingTimeout('pagination', page, 14000), {});
  for (const ko of ['K2', 'K3', 'K4']) for (const en of ENGLISH_LEVELS) for (const pageCount of [12, 16]) {
    const input = openingsInput({ko, en, pageCount, quality: false});
    for (const stage of ['pagination', 'prose', 'coherenceRepair', 'page', 'qualityWrap', 'proseFit']) {
      const worst = P.openingWorstTokens(stage, input), tokens = budgetFor(stage, input);
      assert.ok(worst > 0, `${ko}/${en}/${pageCount}/${stage}`);
      assert.ok(tokens >= 1.25 * worst, `${ko}/${en}/${pageCount}/${stage} ${tokens} < 1.25 × ${worst}`);
      assert.ok(tokens <= 32000, `${stage} ${tokens}`);
      assert.ok(tokens >= (stage === 'qualityWrap' ? 12000 : budgetFor(stage, page) ?? 0));
      if (P.OPENING_TIMEOUT_STAGES.includes(stage)) {
        const {timeoutMs} = P.openingTimeout(stage, input, tokens);
        // 60 s plus 15 ms per token (66.7 tokens per second).
        assert.ok(timeoutMs >= 60000 + (tokens / (1000 / 15)) * 1000 - 1e-6, `${stage} ${timeoutMs}`);
      } else assert.deepEqual(P.openingTimeout(stage, input, tokens), {});
    }
  }
  // The design's reference sizes (K4/E4 and K3/E4 pagination; K2/E2 keeps 14000).
  assert.equal(budgetFor('pagination', openingsInput({ko: 'K4', en: 'E4'})), 23383);
  assert.equal(budgetFor('pagination', openingsInput({ko: 'K3', en: 'E4'})), 20311);
  assert.equal(budgetFor('pagination', openingsInput({ko: 'K2', en: 'E2'})), 14000);
  assert.equal(budgetFor('page', openingsInput({ko: 'K4', en: 'E4'})), 3414);
  assert.ok(budgetFor('qualityWrap', openingsInput({ko: 'K4', en: 'E4'})) <= 12400);
  assert.equal(P.openingTimeoutMs(23383), 410745);
});

test('R12-P3 the non-quality path: per-beat line, budgets and timeouts on prose; one main-engine length fit for an out-of-band beat', async () => {
  const input = openingsInput({quality: false}), outline = outlineFor(input), calls = [];
  const engine = {id: 'openai', async complete(request) {
    calls.push(request);
    const data = JSON.parse(request.user);
    if (request.jsonSchema?.required?.includes('paragraphs')) return {json: {paragraphs: data.beats.map(b => ({beatIndex: b.beatIndex, text: koBeat(12, '젖은 ')}))}, usage: {input: 5, output: 5}, meta: {requests: 1}};
    const ko = outline.beats.map(b => koBeat(b.index === 3 ? 7 : 12)).join('\n\n'), en = outline.beats.map(() => enBeat(4)).join('\n\n');
    return {json: {ko, en, usedRefrainAt: [], paragraphBeats: {ko: outline.beats.map(b => b.index), en: outline.beats.map(b => b.index)}}, usage: {input: 5, output: 5}, meta: {requests: 1}};
  }};
  const result = await generateProse(outline, input, {engine});
  assert.equal(calls.length, 2);
  const [prose, fit] = calls;
  assert.match(prose.system, /Each approved beat paragraph = one opening: Korean 10–15 sentences \(target 12\), English 2–4 sentences \(target 4\) per beat\./u);
  assert.match(prose.system, /LAYOUT: 8 openings = 16 printed pages/u);
  assert.equal(prose.maxTokens, budgetFor('prose', input));
  assert.equal(prose.timeoutMs, 60000 + 15 * prose.maxTokens);
  assert.match(fit.system, /LENGTH FIT \(Korean only\)/u);
  assert.deepEqual(JSON.parse(fit.user).beats.map(b => b.beatIndex), [3]);
  assert.deepEqual(JSON.parse(fit.user).targets, ['[비트 3] 지금 7문장 → 10~15문장(목표 12)']);
  const paragraphs = result.data.ko.split('\n\n');
  assert.equal(splitSentences(paragraphs[2]).length, 12);
  assert.equal(paragraphs[0], koBeat(12));
  assert.deepEqual(result.meta.lengthFit, {ko: {triggered: [3], accepted: true}});
  assert.equal(result.meta.requests, 2);
  // A legacy non-quality draft makes one prose call with today's 12000 tokens and no timeout.
  const legacy = legacyInput({quality: false}), legacyCalls = [];
  await generateProse(outlineFor(legacy), legacy, {engine: {id: 'openai', async complete(request) {
    legacyCalls.push(request);
    const o = outlineFor(legacy);
    return {json: {ko: o.beats.map(() => '유하가 잎을 봐요. 그린이가 웃어요.').join('\n\n'), en: o.beats.map(() => 'Yuha sees a leaf.').join('\n\n'), usedRefrainAt: [], paragraphBeats: {ko: o.beats.map(b => b.index), en: o.beats.map(b => b.index)}}, usage: {input: 1, output: 1}, meta: {requests: 1}};
  }}});
  assert.equal(legacyCalls.length, 1);
  assert.equal(legacyCalls[0].maxTokens, 12000);
  assert.ok(!('timeoutMs' in legacyCalls[0]));
  assert.doesNotMatch(legacyCalls[0].system, /LAYOUT:|one opening/u);
});

test('R12-P3 the length-fit plan fires for a K2 beat of 8 or 17 sentences, not 9-16; English is strict', () => {
  const spec = V4('K2', 'E2');
  const rows = counts => counts.map((count, i) => ({beatIndex: i + 1, text: koBeat(count)}));
  for (const count of [9, 10, 12, 15, 16]) assert.deepEqual(P.lengthFitPlan(rows([12, count, 12, 12, 12, 12, 12, 12]), spec.ko, 'ko', 8).triggered, [], `${count}`);
  for (const count of [8, 17]) assert.deepEqual(P.lengthFitPlan(rows([12, count, 12, 12, 12, 12, 12, 12]), spec.ko, 'ko', 8).triggered, [{beatIndex: 2, count}], `${count}`);
  // A short total with every beat inside the band fires for the beats under min.
  const short = P.lengthFitPlan(rows([9, 9, 9, 9, 9, 9, 12, 12]), spec.ko, 'ko', 8);
  assert.deepEqual(short.triggered.map(r => r.beatIndex), [1, 2, 3, 4, 5, 6]);
  // English: strictly 2-4 sentences per beat at E2.
  const en = counts => counts.map((count, i) => ({beatIndex: i + 1, text: enBeat(count)}));
  assert.deepEqual(P.lengthFitPlan(en([2, 4, 3, 4, 4, 4, 4, 4]), spec.en, 'en', 8).triggered, []);
  assert.deepEqual(P.lengthFitPlan(en([5, 4, 1, 4, 4, 4, 4, 4]), spec.en, 'en', 8).triggered.map(r => r.beatIndex), [1, 3]);
  // Paragraphs of one beat are counted together.
  const split = [{beatIndex: 1, text: koBeat(5)}, {beatIndex: 1, text: koBeat(5)}, ...rows([12, 12]).map(r => ({...r, beatIndex: r.beatIndex + 1}))];
  assert.deepEqual(P.lengthFitPlan(split, spec.ko, 'ko', 3).triggered, []);
});

test('R12-P3 quality length fit: once per language, untriggered paragraphs byte-identical, discarded on label change, a resume makes 0 calls', async () => {
  const input = openingsInput(), outline = outlineFor(input);
  const fit = (request, lang) => {
    const text = request.user.slice(request.user.indexOf(lang === 'ko' ? '[글]\n' : '[Text]\n') + (lang === 'ko' ? 4 : 7));
    // Lengthen beat 3 and (wrongly) touch beat 1: the app keeps beat 1 as it was.
    return text.split('\n\n').map(block => block.startsWith('[비트 3') ? `[비트 3 · attempt] ${koBeat(12, '젖은 ')}` : block.startsWith('[비트 1') ? `${block} 유하가 또 웃어요.` : block).join('\n\n');
  };
  const engine = qualityEngine({ko: {default: 12, 3: 7}, en: {default: 4}}, {fit});
  const saved = [];
  const result = await generateQualityProse(outline, input, {engine, onCheckpoint: c => saved.push(c)}, services());
  const fits = engine.calls.filter(c => c.kind === 'fit');
  assert.equal(fits.length, 1);
  assert.equal(fits[0].lang, 'ko');
  assert.match(fits[0].request.user, /\[비트 3\] 지금 7문장 → 10~15문장\(목표 12\)/u);
  assert.equal(fits[0].request.maxTokens, budgetFor('qualityWrap', input));
  assert.ok(fits[0].request.timeoutMs > 60000);
  const paragraphs = result.data.ko.split('\n\n');
  assert.equal(paragraphs[0], koBeat(12), 'beat 1 kept byte for byte');
  assert.equal(paragraphs[2], koBeat(12, '젖은 '));
  assert.deepEqual(result.meta.quality.languages.ko.lengthFit, {triggered: [3], accepted: true});
  assert.equal(result.meta.quality.languages.en.lengthFit, undefined);
  assert.equal(result.meta.requests, 5);
  // Resume from the saved checkpoint: every call, the fit included, comes from the journal.
  const resumeEngine = qualityEngine({ko: {default: 12, 3: 7}, en: {default: 4}}, {fit});
  const resumed = await generateQualityProse(outline, input, {engine: resumeEngine, qualityCheckpoint: saved.at(-1).qualityCheckpoint}, services());
  assert.equal(resumeEngine.calls.length, 0);
  assert.equal(resumed.data.ko, result.data.ko);
  // A fit that changes the labels is discarded; the prose stays as written.
  const bad = qualityEngine({ko: {default: 12, 3: 7}, en: {default: 4}}, {fit: (request, lang) => fit(request, lang).replace('[비트 5 · attempt]', '[비트 9 · attempt]')});
  const kept = await generateQualityProse(outline, input, {engine: bad}, services());
  assert.deepEqual(kept.meta.quality.languages.ko.lengthFit, {triggered: [3], accepted: false});
  assert.equal(splitSentences(kept.data.ko.split('\n\n')[2]).length, 7);
  // A fit that pushes an in-band beat out of band is discarded too.
  const plan = P.lengthFitPlan(outline.beats.map(b => ({beatIndex: b.index, text: koBeat(b.index === 3 ? 7 : 12)})), input.specs.ko, 'ko', 8);
  assert.equal(P.applyLengthFit(outline.beats.map(b => `[비트 ${b.index} · ${b.type}] ${koBeat(b.index === 3 ? 7 : 12)}`).join('\n\n'), outline.beats.map(b => `[비트 ${b.index} · ${b.type}] ${koBeat(b.index === 3 ? 12 : b.index === 4 ? 3 : 12)}`).join('\n\n'), {...plan, triggered: [...plan.triggered, {beatIndex: 4, count: 12}]}), null);
});

test('R12-P3 providers take the larger of the engine timeout and req.timeoutMs; without it the timeout is unchanged', async () => {
  const delays = [], original = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...rest) => { delays.push(ms); return original(() => {}, 0, ...rest); };
  try {
    const engine = createTextEngine({engine: 'openai', config: {apiKey: 'fixture', fetch: async () => new Response(JSON.stringify({choices: [{message: {content: '{"story":"ok"}'}}], usage: {prompt_tokens: 1, completion_tokens: 1}}), {status: 200, headers: {'content-type': 'application/json'}})}});
    const req = {system: 's', user: 'u', jsonSchema: {type: 'object', properties: {story: {type: 'string'}}, required: ['story']}, temperature: 0.3, maxTokens: 1000};
    await engine.complete(req);
    const base = delays.at(-1);
    await engine.complete({...req, timeoutMs: base + 123456});
    assert.equal(delays.at(-1), base + 123456);
    await engine.complete({...req, timeoutMs: 1000});
    assert.equal(delays.at(-1), base);
  } finally { globalThis.setTimeout = original; }
});

test('R12-P3 demo openings prose fits the per-beat ranges at 12 and 16 pages; the openings estimate is at least today\'s', () => {
  for (const pageCount of [12, 16]) {
    const input = openingsInput({pageCount, quality: false}), outline = demoOutline(input), prose = demoProse(outline, input);
    assert.equal(outline.beats.length, pageCount / 2);
    assert.deepEqual(prose.paragraphBeats.ko, outline.beats.map(b => b.index));
    assertValid('prose', prose, input, outline);
    for (const [lang, band] of [['ko', [10, 15]], ['en', [2, 4]]]) {
      const plan = P.lengthFitPlan(prose[lang].split('\n\n').map((text, i) => ({beatIndex: i + 1, text})), input.specs[lang], lang, pageCount / 2);
      assert.deepEqual(plan.triggered, [], `${lang} ${pageCount}`);
      for (const count of plan.counts.values()) assert.ok(count >= band[0] && count <= band[1], `${lang} ${count}`);
    }
    // A page draft of the same size keeps today's demo prose.
    const legacy = legacyInput({pageCount, quality: false});
    assert.notEqual(demoProse(demoOutline(legacy), legacy).ko, prose.ko);
  }
  const settings = {engine: 'anthropic', storyQuality: {enabled: true}};
  const today = estimateStoryTextCost({settings, pageCount: 16});
  for (const [ko, en] of [['K2', 'E2'], ['K3', 'E3'], ['K4', 'E4']]) {
    const openings = estimateStoryTextCost({settings, pageCount: 16, layout: 'openings', specs: V4(ko, en)});
    assert.ok(openings.costUsd >= today.costUsd, `${ko}/${en}`);
    assert.equal(openings.beatCount, 8);
  }
  assert.equal(estimateStoryTextCost({settings, pageCount: 12, layout: 'openings', specs: V4('K2', 'E2')}).beatCount, 6);
  // A page book or wizard adds nothing to the estimate call (K1 and English-only are
  // page wizards with the flag on; a K2 wizard is one only with the flag off).
  assert.deepEqual(textEstimateArgs({koreanLevel: 'K1', englishLevel: 'E2', language: 'bilingual', pageCount: 16}, freezeReadingLevels), {});
  assert.deepEqual(textEstimateArgs({koreanLevel: 'K2', englishLevel: 'E2', language: 'en', pageCount: 16}, freezeReadingLevels), {});
  {
    const had = Object.hasOwn(globalThis, '__DONGHWA_R12_OPENINGS__'), previous = globalThis.__DONGHWA_R12_OPENINGS__;
    globalThis.__DONGHWA_R12_OPENINGS__ = false;
    try { assert.deepEqual(textEstimateArgs({koreanLevel: 'K2', englishLevel: 'E2', language: 'bilingual', pageCount: 16}, freezeReadingLevels), {}); }
    finally { if (had) globalThis.__DONGHWA_R12_OPENINGS__ = previous; else delete globalThis.__DONGHWA_R12_OPENINGS__; }
  }
  assert.equal(textEstimateArgs({koreanLevel: 'K2', englishLevel: 'E2', language: 'bilingual', pageCount: 16}, freezeReadingLevels).layout, 'openings', 'flag on (P8)');
  assert.deepEqual(textEstimateArgs({storyInput: legacyInput(), pages: []}), {});
});
