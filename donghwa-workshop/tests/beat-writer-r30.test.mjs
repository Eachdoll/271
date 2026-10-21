import test from 'node:test';
import assert from 'node:assert/strict';
import {getLevelSpec} from '../dist/reading-levels.js';
import {normalizeStoryInput, generateProse} from '../dist/story-generation/pipeline.js';
import {demoOutline} from '../dist/story-generation/demo.js';
import {demoPlotContract} from '../dist/story-generation/plot-contract.js';
import {beatBudgets, checkBeatText, dialogueShare, hasRefrain, BEAT_WRITER_ATTEMPTS, SUMMARY_SWITCH_TOKENS} from '../dist/story-generation/beat-writer.js';
import {resolveBeatWriterSettings, resolveQualityStageSettings} from '../dist/text-generation/models.js';
import {TEXT_JOURNALS} from '../dist/finalize-cleanup.js';
import {applyStoryCheckpoint} from '../dist/story-generation/ui.js';
import {checkNotes} from '../dist/simple-create.js';
import {buildStopReport, stopReportAvailable} from '../dist/story-generation/stop-report.js';

/**
 * 2026-10-21 R30 정성 모드 비트별 작가: a draft with input.orchestrationPolicy
 * writes its prose one beat at a time per language (ko/en of a beat in
 * parallel) on the beat-writer model, every call seeing the whole map; the
 * refrain is fixed first (voice card); beat 1 is drafted twice and the better
 * voice anchors the book; a beat out of its budget is asked again with the
 * delta at most twice, then the closest attempt is kept with a warning; the
 * dialogue share is a book-level note. Every response is journalled.
 */
const input = (extra = {}) => normalizeStoryInput({bookId: 'r30', characters: [{id: 'yuha', name: '유하', nameEn: 'Yuha'}], backgrounds: [{id: 'home', name: '집', type: 'home'}, {id: 'forest', name: '숲길'}], topic: '비 오는 날 달팽이 찾기', pageCount: 12, language: 'bilingual', endingType: 'home_sleep', specs: {ko: getLevelSpec('K2'), en: getLevelSpec('E2')}, craftPolicy: {version: 1}, arcPolicy: {version: 1}, orchestrationPolicy: {version: 1, writerTier: 'medium'}, ...extra});
const outlineOf = (inp, {refrain = true} = {}) => {
  const o = structuredClone(demoOutline(inp));
  o.plotContract = demoPlotContract(o, inp);
  o.tension = [1, 2, 3, 3, 4, 2, 1];
  if (refrain) o.refrain = {text: '천천히, 천천히 보자.', usedAtBeats: [2, 4, 6]};
  return o;
};
const reply = (json) => ({json, usage: {input: 100, output: 50}, meta: {requests: 1, model: 'mock'}});
const sentences = (lang, n, extra = '') => Array.from({length: n}, (_, i) => (lang === 'ko' ? `유하가 젖은 잎을 ${i + 1}번 살짝 만져요.` : `Yuha taps leaf ${i + 1}.`)).join(' ') + extra;
/** A mock writer: the target count (with the refrain where asked), or a scripted reply per beat. */
function writer({script = {}, sniff = 2} = {}) {
  return {id: 'mock-writer', calls: [], async complete(req) {
    this.calls.push(req);
    const user = String(req.user), system = String(req.system);
    if (/되풀이 말을 다른 언어로/u.test(system)) return reply({text: 'Slowly, slowly, look!'});
    if (/첫 장면의 두 초안/u.test(system)) return reply({pick: sniff, reason: '리듬이 살아 있어요'});
    const lang = /picture-book author writing original English/u.test(system) ? 'en' : 'ko',
      beat = Number(/\[이번 비트\] (\d+)/u.exec(user)[1]),
      target = Number(/이 비트는 (\d+)문장 안팎/u.exec(user)[1]),
      refrain = lang === 'ko' ? /\[되풀이 말 — 글자 그대로 한 번\] (.+)/u.exec(user)?.[1] : /\[Refrain — use this exact line once\] (.+)/u.exec(user)?.[1],
      attempt = /\[이전 시도의 문제/u.test(user) ? 'retry' : /\[초안 2\]/u.test(user) ? 'draft2' : 'first';
    const custom = script[`${lang}:${beat}:${attempt}`] ?? script[`${lang}:${beat}`];
    if (custom !== undefined) return reply({text: typeof custom === 'function' ? custom(target) : custom});
    return reply({text: sentences(lang, refrain ? target - 1 : target, refrain ? ` ${refrain}` : '')});
  }};
}
const run = (inp, outline, engine, extra = {}) => generateProse(outline, inp, {engineId: 'openai', engine: {id: 'base', complete: () => { throw new Error('the base prose engine is never called'); }}, qualityEngines: {beatWriter: engine, cheap: engine}, ...extra});

test('R30 beat budgets follow pages and tension; checks count, length and the refrain', () => {
  const inp = input(), o = outlineOf(inp), budgets = beatBudgets(o, inp);
  assert.equal(budgets.length, 7);
  assert.equal(budgets.reduce((n, b) => n + b.pages, 0), 12, 'every page belongs to one beat');
  for (const b of budgets) for (const lang of ['ko', 'en']) assert.ok(b[lang].min <= b[lang].target && b[lang].target <= b[lang].max);
  const hot = beatBudgets({...o, tension: [1, 2, 3, 3, 4, 2, 1]}, inp)[4].ko.target, cold = beatBudgets({...o, tension: [1, 2, 3, 3, 0, 2, 1]}, inp)[4].ko.target;
  assert.ok(hot > cold, 'a tense beat gets more sentences than a calm one with the same pages');
  const spec = inp.specs.ko, b = budgets[2].ko;
  assert.deepEqual(checkBeatText(sentences('ko', b.target), 'ko', b, spec).problems, []);
  assert.match(checkBeatText(sentences('ko', 1), 'ko', b, spec).problems.join(' '), /적어요/);
  assert.match(checkBeatText(sentences('ko', b.max + 3), 'ko', b, spec).problems.join(' '), /많아요/);
  assert.match(checkBeatText(sentences('ko', b.target), 'ko', b, spec, {refrain: '천천히, 천천히 보자.', needsRefrain: true}).problems.join(' '), /되풀이 말/);
  assert.ok(hasRefrain('유하가 말해요. "천천히 천천히 보자!"', '천천히, 천천히 보자.'), 'punctuation and quotes do not matter');
  assert.ok(!hasRefrain('천천히 보자.', '천천히, 천천히 보자.'));
  assert.equal(dialogueShare(['"안녕!" 유하가 말해요. 비가 와요.', '달팽이가 기어요.']), 0.25);
  assert.equal(BEAT_WRITER_ATTEMPTS, 3);
  assert.equal(SUMMARY_SWITCH_TOKENS, 4000);
  // Openings books keep the frozen per-opening unit range.
  const ob = beatBudgets({beats: o.beats}, {...inp, layoutPolicy: {kind: 'openings'}, specs: {ko: {...spec, units: {opening: {min: 10, max: 15, target: 12}}}, en: {...inp.specs.en, units: {opening: {min: 6, max: 9, target: 8}}}}});
  assert.deepEqual([ob[0].ko.min, ob[0].ko.max, ob[0].en.min, ob[0].en.max], [10, 15, 6, 9]);
});

test('R30 a policy draft writes beat by beat on the beat-writer model, with the map, the voice card and the anchor', async () => {
  const inp = input(), o = outlineOf(inp), engine = writer();
  const result = await run(inp, o, engine);
  const prose = result.data;
  assert.deepEqual(prose.paragraphBeats, {ko: [1, 2, 3, 4, 5, 6, 7], en: [1, 2, 3, 4, 5, 6, 7]});
  assert.equal(prose.ko.split(/\n\s*\n/).length, 7);
  assert.deepEqual(prose.usedRefrainAt, [2, 4, 6]);
  const beatCalls = engine.calls.filter((c) => /\[이번 비트\]/u.test(c.user));
  // 7 beats × 2 languages + beat 1's second draft per language; all pass, so one sniff per language + the voice card.
  assert.equal(beatCalls.length, 16);
  assert.equal(engine.calls.length, 16 + 2 + 1);
  assert.equal(result.meta.requests, 19);
  for (const c of beatCalls) {
    assert.match(c.user, /\[전체 지도 — 모든 비트/u, 'every beat sees the whole map');
    assert.match(c.user, /\[결말 상태\]/u);
    for (const beat of o.beats) assert.ok(c.user.includes(`${beat.index} ${beat.type}`));
    assert.match(c.system, /FROZEN (KOREAN|ENGLISH) LEVEL/u);
    assert.match(c.system, /explicit grammatical subject/u);
  }
  const later = beatCalls.filter((c) => /\[이번 비트\] 3 /u.test(c.user));
  assert.equal(later.length, 2);
  for (const c of later) {
    assert.match(c.user, /\[문체 기준 — 이 책의 첫 비트/u, 'later beats carry the chosen beat-1 voice');
    assert.match(c.user, /\[앞 비트까지 쓴 글/u);
  }
  assert.ok(later.some((c) => /Taps leaf|taps leaf/u.test(c.user)) && later.some((c) => /살짝 만져요/u.test(c.user)), 'each language sees its own earlier text');
  const en4 = beatCalls.find((c) => /\[이번 비트\] 4 /u.test(c.user) && /original English/u.test(c.system));
  assert.match(en4.user, /\[Refrain — use this exact line once\] Slowly, slowly, look!/u, 'the English refrain is the voice card line');
  assert.deepEqual(result.meta.writer.refrain.voiceCard, {ko: '천천히, 천천히 보자.', en: 'Slowly, slowly, look!'});
  assert.deepEqual(result.meta.writer.anchor.ko, {pick: 2, reason: '리듬이 살아 있어요', judged: true});
  assert.ok(result.meta.writerCheckpoint?.completed && Object.keys(result.meta.writerCheckpoint.completed).length === 19);
  // The book-level dialogue share is a note, never a retry.
  assert.match(result.meta.softIssues.join(' '), /대화 비율/u);
});

test('R30 a beat out of budget is asked again with the delta; after three attempts the closest is kept with a warning', async () => {
  const inp = input(), o = outlineOf(inp, {refrain: false});
  const fixed = writer({script: {'ko:3:first': (t) => sentences('ko', 1), 'ko:3:retry': (t) => sentences('ko', t)}});
  const r1 = await run(inp, o, fixed);
  const retry = fixed.calls.find((c) => /\[이번 비트\] 3 /u.test(c.user) && /\[이전 시도의 문제/u.test(c.user));
  assert.match(retry.user, /\[고칠 양\] 지금 1문장 → \d+문장으로 \d+문장 늘려 주세요/u);
  assert.match(retry.user, /\[이전 시도\]\n유하가/u);
  assert.equal(r1.meta.writer.attempts['ko:3'], 2);
  assert.equal(r1.meta.writer.warnings.filter((w) => /3비트/u.test(w)).length, 0);
  let n = 0;
  const stubborn = writer({script: {'en:5': () => sentences('en', [20, 14, 17][n++ % 3])}});
  const r2 = await run(inp, o, stubborn);
  assert.equal(r2.meta.writer.attempts['en:5'], 3, 'three attempts, never more');
  assert.match(r2.meta.writer.warnings.join(' '), /영어 5비트: .*세 번 써서 가장 가까운 글/u);
  assert.equal(r2.data.en.split(/\n\s*\n/)[4].split('. ').length, 14, 'the attempt closest to the budget is kept');
});

test('R30 beat 1: when only one draft passes it is the anchor without a sniff', async () => {
  const inp = input(), o = outlineOf(inp, {refrain: false});
  const engine = writer({script: {'ko:1:draft2': () => sentences('ko', 12)}});
  const r = await run(inp, o, engine);
  assert.deepEqual(r.meta.writer.anchor.ko, {pick: 1, judged: false});
  assert.equal(engine.calls.filter((c) => /첫 장면의 두 초안/u.test(c.system)).length, 1, 'English still judged');
  // Both fail: the closer one goes on to the retries, no sniff.
  const both = writer({script: {'ko:1:draft2': () => sentences('ko', 9), 'ko:1:first': () => sentences('ko', 12), 'ko:1:retry': (t) => sentences('ko', t)}});
  const rb = await run(inp, o, both);
  assert.deepEqual(rb.meta.writer.anchor.ko, {pick: 2, judged: false});
  assert.equal(rb.meta.writer.attempts['ko:1'], 2);
  const retry = both.calls.find((c) => /\[이번 비트\] 1 /u.test(c.user) && /\[이전 시도의 문제/u.test(c.user));
  assert.match(retry.user, /지금 9문장/u, 'the closer draft (9 of 12) is the one retried');
  // The notes reach ③ and the check report.
  const job = {status: 'text-review', input: {topic: '달팽이'}, writerReport: rb.meta.writer};
  rb.meta.writer.warnings.push('영어 5비트: 문장이 많아요 (세 번 써서 가장 가까운 글을 썼어요)');
  assert.match(checkNotes(job).join(' '), /정성 모드 작가 참고 \d+건/u);
  assert.ok(stopReportAvailable(job));
  const report = buildStopReport(job);
  assert.match(report, /### 정성 모드 비트별 작가/u);
  assert.match(report, /다시 쓴 비트: ko:1 2번/u);
  assert.match(report, /첫 비트\(한글\) 기준 글: 초안 2 · 검사 결과로 선택/u);
  assert.match(report, /대화 비율\(책 전체\)/u);
  assert.match(report, /영어 5비트: 문장이 많아요/u);
});

test('R30 the writer journal replays on resume and long books switch to summaries past the threshold', async () => {
  const inp = input(), o = outlineOf(inp);
  const first = writer(), saved = {};
  await run(inp, o, first, {onCheckpoint: (cp) => { if (cp.writerCheckpoint) saved.cp = cp.writerCheckpoint; }});
  const again = writer();
  const r = await run(inp, o, again, {writerCheckpoint: saved.cp});
  assert.equal(again.calls.length, 0, 'nothing is bought twice');
  assert.equal(r.meta.resumedCalls, 19);
  const long = writer({script: Object.fromEntries([1, 2, 3, 4, 5, 6].flatMap((b) => [[`ko:${b}`, (t) => sentences('ko', t) + ' ' + '빗방울이 톡톡 떨어져요. '.repeat(160)]]))});
  const lr = await run(inp, outlineOf(inp, {refrain: false}), long);
  const k7 = long.calls.find((c) => /\[이번 비트\] 7 /u.test(c.user) && !/original English/u.test(c.system));
  assert.match(k7.user, /앞부분은 줄거리 요약/u);
  assert.match(k7.user, /\[1\] \(요약\)/u);
  assert.ok(lr.meta.writer.summarized);
});

test('R30 the writer model: medium unless the draft froze upper; demo and policy-less drafts keep their path; the journal is pruned with the others', async () => {
  const settings = {engine: 'anthropic', providers: {}};
  const medium = resolveBeatWriterSettings(settings, {}, 'medium'), upper = resolveBeatWriterSettings(settings, {}, 'upper');
  assert.deepEqual(medium, resolveQualityStageSettings(settings, 'prose', {}));
  assert.notEqual(upper.config.model, medium.config.model);
  assert.ok(TEXT_JOURNALS.includes('writerCheckpoint'));
  const draft = {};
  applyStoryCheckpoint(draft, {stage: 'beatWriter', writerCheckpoint: {version: 1, completed: {a: 1}}});
  assert.deepEqual(draft.writerCheckpoint, {version: 1, completed: {a: 1}}, 'a pro draft keeps the writer journal too');
  const inp = input(), o = outlineOf(inp), engine = writer();
  const demo = await generateProse(o, inp, {engineId: 'demo', qualityEngines: {beatWriter: engine}});
  assert.equal(engine.calls.length, 0);
  assert.ok(demo.data.ko);
  const plain = input({orchestrationPolicy: undefined});
  let called = 0;
  await assert.rejects(generateProse(outlineOf(plain), plain, {engine: {id: 'x', complete: async () => { called++; throw new Error('base path'); }}, qualityEngines: {beatWriter: engine}}), /base path/);
  assert.equal(called, 1);
  assert.equal(engine.calls.length, 0, 'a draft without the policy never meets the beat writer');
});

import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {createFullAutoJob, runFullAuto, estimateFullAutoCost} from '../dist/full-auto.js';
import {demoSceneBriefs} from '../dist/story-generation/scene-briefs.js';
import {estimateStoryTextCost} from '../dist/text-generation/models.js';
import {getTextGenerationSettings} from '../dist/text-generation/settings-ui.js';

test('R30 FULL AUTO hands the beat writer its model and journal, keeps the journal across a stop, and prices a new job with the writer', async () => {
  const state = seedState(); migrateWorldState(state); migrateReadingSettings(state.settings);
  const wizard = {characterIds: ['yuha'], backgroundIds: [], topic: '바람 피리', pageCount: 12, koreanLevel: 'K1', englishLevel: 'E0', value: 'none', ending: 'home', language: 'bilingual'};
  const job = createFullAutoJob(state, wizard, {stopBefore: 'text', planMode: 'selection'});
  assert.deepEqual(job.input.orchestrationPolicy, {version: 1, writerTier: 'medium'});
  const res = (data, stage) => ({data, usage: {input: 10, output: 20}, meta: {stage, requests: 1, model: 'mock'}});
  const seen = [];
  const ops = {
    preflight: async () => {},
    outline: async (input) => { const o = demoOutline(input); o.plotContract = demoPlotContract(o, input); return res(o, 'outline'); },
    briefs: async (outline, input) => res(demoSceneBriefs(outline, input), 'sceneBriefs'),
    prose: async (outline, input, opts) => {
      seen.push(opts);
      await opts.onCheckpoint({stage: 'beatWriter', writerCheckpoint: {version: 1, kind: 'beatWriter', contextFingerprint: 'f', completed: {a: {role: 'beatWriter', response: {text: '{}'}}}}, usage: {input: 1, output: 1}, meta: {stage: 'beatWriter', requests: 1}});
      throw Object.assign(new Error('잠시 멈춤'), {writerCheckpoint: {version: 1, kind: 'beatWriter', contextFingerprint: 'f', completed: {a: {}, b: {}}}});
    },
  };
  await assert.rejects(runFullAuto(state, job, {operations: ops}), /잠시 멈춤/);
  const medium = resolveBeatWriterSettings(job.textSettings, job.input.storyQuality || {}, 'medium');
  assert.deepEqual(seen[0].qualityEngines.beatWriter, medium, 'the medium model by default');
  assert.equal(seen[0].writerCheckpoint, undefined);
  assert.deepEqual(Object.keys(job.writerCheckpoint.completed), ['a', 'b'], 'the journal of a stopped run is kept');
  job.status = 'paused';
  job.input.orchestrationPolicy.writerTier = 'upper';
  await assert.rejects(runFullAuto(state, job, {operations: ops}), /잠시 멈춤/);
  assert.deepEqual(Object.keys(seen[1].writerCheckpoint.completed), ['a', 'b'], 'a resumed run hands it back');
  assert.deepEqual(seen[1].qualityEngines.beatWriter, resolveBeatWriterSettings(job.textSettings, job.input.storyQuality || {}, 'upper'));
  // A job without the policy gets no beat-writer engine.
  const plain = createFullAutoJob(state, wizard, {stopBefore: 'text', planMode: 'selection'});
  delete plain.input.orchestrationPolicy;
  seen.length = 0;
  await assert.rejects(runFullAuto(state, plain, {operations: ops}), /잠시 멈춤/);
  assert.equal('beatWriter' in seen[0].qualityEngines, false);
  // Estimates: the beat writer's rows replace the rich/simplify prose rows; the upper writer costs more.
  const settings = getTextGenerationSettings({settings: {textGeneration: {engine: 'openai'}}});
  const e = estimateStoryTextCost({settings, pageCount: 12, council: true, editor: true, orchestration: true});
  const row = (s) => e.stages.find((r) => r.stage === s);
  assert.equal(row('prose').qualityRole, 'beatWriter');
  assert.equal(row('prose').requestCount, 7 * 2 + 2);
  assert.equal(row('beatRetries').requestCount, 4);
  assert.equal(row('beatVoice').requestCount, 3);
  assert.equal(row('simplification'), undefined);
  assert.ok(estimateStoryTextCost({settings, pageCount: 12, council: true, editor: true, orchestration: true, writerTier: 'upper'}).costUsd > e.costUsd);
  const newJob = estimateFullAutoCost(state, wizard), frozen = estimateFullAutoCost(state, wizard, {job});
  assert.ok(frozen.textUsd > newJob.textUsd, 'the job froze the upper writer');
});
