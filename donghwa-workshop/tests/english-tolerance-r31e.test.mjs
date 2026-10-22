import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
globalThis.__DONGHWA_R12_OPENINGS__ = false;
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {normalizeStoryInput, inspectStory, generateProse, generateOutline, generateSceneBriefs, repairPagination, reviewStoryCoherence} from '../dist/story-generation/pipeline.js';
import {pageReadingSpec} from '../dist/story-generation/checker.js';
import {beatBudgets, checkBeatText} from '../dist/story-generation/beat-writer.js';
import {analyzeEstimatedPage, mergeDialogueTags, leanEnglishLevel} from '../dist/reading-checker.js';
import {describeReadingViolation} from '../dist/reading-messages.js';
import {unitSpec} from '../dist/book-layout.js';
import {leanOutlineView, leanPageView, writerBriefView} from '../dist/story-generation/prompt-diet.js';
import {estimateStoryTextCost} from '../dist/text-generation/models.js';
import {demoProse} from '../dist/story-generation/demo.js';

/**
 * 2026-10-22 R31e 영어 허용 범위·장부 없음. The r31d paid K2 book (QA/r31d-ab)
 * was retried nine times at the writer and had all six English beats rewritten
 * at pagination, because the English rules refused what a picture book wants:
 * a one-word "Peekaboo!" (too short), a speech tag after a quote counted as a
 * two-word sentence, one 10-word line among three, ordinary words over a 15%
 * list cap — and the writer's retry said "keep the sentence count" while
 * complaining the two sentences were long. On the diet an E2+ unit now takes
 * the Korean unit tolerance, counts a speech tag with its quote and reports
 * the out-of-list share as a note; the writer's check is the same rule and
 * its retry names the long sentences; the writer sees the brief's story-carrying
 * fields only; a diet outline has no event ledger (so no ledger reviews); diet
 * requests carry a lean outline and lean pages. E0/E1 and drafts without the
 * policy are unchanged.
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const PAID = new URL('../QA/r31d-ab/K2-diet.json', import.meta.url);
const paid = () => JSON.parse(readFileSync(PAID, 'utf8'));
const reply = (json) => ({json, usage: {input: 10, output: 5}, meta: {requests: 1, model: 'mock'}});
const NAMES = ['유하', 'Yuha', '해니', 'Haeni'];
const LONG = 'Mom hid behind the yellow handkerchief and peeked out; Yuha did it too, and they giggled. “For Haeni,” said Yuha, taking the handkerchief beside his open bag with a little ball inside.';
const GOOD = 'Mom hid behind the yellow cloth. Peekaboo! Yuha laughed and laughed. “I will do it for Haeni,” he said.';

test('R31e the paid K2 book replayed: the writer’s six English beats under the lean check — five pass as written, beat 1 is told which sentences are long; the strict check keeps its two misfires', () => {
  assert.ok(existsSync(PAID));
  const j = paid(), budgets = beatBudgets(j.outline, j.input), spec = j.input.specs.en, beats = String(j.writerOriginal.en).split(/\n\s*\n/u);
  assert.equal(beats.length, 6);
  const lean = beats.map((t, i) => checkBeatText(t, 'en', budgets[i].en, spec, {lean: true}));
  assert.deepEqual(lean.slice(1).map((c) => c.problems), [[], [], [], [], []], 'beats 2–6 pass as written');
  assert.equal(lean[0].problems.length, 1);
  assert.match(lean[0].problems[0], /평균 16단어로 길어요.*긴 문장: ".+"\(16단어\), ".+"\(16단어\)/u);
  assert.deepEqual(lean[0].words, [16, 16]);
  assert.equal(lean[3].sentences, 4, 'the speech tag after the quote counts with its sentence');
  const old = beats.map((t, i) => checkBeatText(t, 'en', budgets[i].en, spec));
  assert.match(old[0].problems[0], /긴 문장이 2개예요/u);
  assert.equal(old[3].sentences, 5);
  assert.match(old[3].problems[0], /문장이 5개로 많아요/u, 'the strict count still splits the tag off');
});

test('R31e lean page checks (E2 and up on the diet): a speech tag counts with its quote, short lines never block, one 10-word line among three passes, the out-of-list share is a note; a long unit still blocks; E0 and the strict spec are unchanged', () => {
  const j = paid(), page = j.pagination.pages[0];
  const lean = pageReadingSpec(j.input.specs, 'en', page, {lean: true}), strict = pageReadingSpec(j.input.specs, 'en', page, {lean: false});
  assert.deepEqual(strict, unitSpec(j.input.specs.en, 'spread'), 'without the policy the unit spec as before');
  assert.equal(lean.leanTolerance, true); assert.equal(lean.dialogueTags, true); assert.equal(lean.vocabularyAdvisory, true); assert.ok(lean.unitTolerance);
  assert.ok(leanEnglishLevel({id: 'E2'}) && leanEnglishLevel({id: 'E3'}) && !leanEnglishLevel({id: 'E1'}) && !leanEnglishLevel({id: 'E0'}));
  const check = (spec, text) => analyzeEstimatedPage(text, spec, {language: 'en', allowedNames: NAMES});
  const tag = check(lean, '“Not my ball—you’re playing peekaboo!” said Yuha.');
  assert.equal(tag.metrics.sentenceCount, 1); assert.deepEqual(tag.violations, []);
  assert.equal(check(strict, '“Not my ball—you’re playing peekaboo!” said Yuha.').metrics.sentenceCount, 2);
  assert.deepEqual(mergeDialogueTags(['“Peekaboo!”', 'Yuha said.', 'Then Yuha laughed.']), ['“Peekaboo!” Yuha said.', 'Then Yuha laughed.']);
  const peek = check(lean, 'Peekaboo! Yuha hid behind the yellow cloth. Haeni peeked in.');
  assert.deepEqual(peek.violations, [], 'short lines never block');
  const note = peek.warnings.find((w) => w.code === 'out-of-vocabulary');
  assert.equal(note?.advisory, true);
  assert.match(describeReadingViolation(note), /^영어 등급 외 어휘 \d+(\.\d+)?% · 참고 \(목록 밖: /u);
  assert.ok(check(strict, 'Peekaboo! Yuha hid behind the yellow cloth. Haeni peeked in.').violations.length >= 2, 'the strict spec blocks the exclamation and the vocabulary');
  const three = check(lean, 'On the bus, their seat belts went click! Haeni puffed his cheeks and laughed. Yuha lifted it, but Haeni’s hand made a bump underneath.');
  assert.deepEqual(three.violations, [], 'one 10-word line among three is fine');
  assert.ok(check(strict, 'On the bus, their seat belts went click! Haeni puffed his cheeks and laughed. Yuha lifted it, but Haeni’s hand made a bump underneath.').violations.some((v) => v.code === 'sentence-length'));
  const long = check(lean, LONG);
  assert.deepEqual(long.violations.map((v) => v.code), ['unit-mean-length', 'unit-long-sentences']);
  assert.match(describeReadingViolation(long.violations[0]), /^영어 펼침면 문장 평균 16단어 \(허용 4\.5~9\.5단어\)/u);
  const e0 = pageReadingSpec({en: {...j.input.specs.en, id: 'E0'}}, 'en', page, {lean: true});
  assert.equal(e0.leanTolerance, undefined); assert.equal(e0.dialogueTags, undefined); assert.equal(e0.storyWordsAllowed, true);
});

test('R31e inspectStory with the writer’s original English on the spreads: on the diet only beat 1 blocks and beats 2–3 carry their out-of-list words as notes; without the policy five entries fail; the final book still passes', () => {
  const j = paid(), originals = String(j.writerOriginal.en).split(/\n\s*\n/u);
  const pagination = {...j.pagination, pages: j.pagination.pages.map((p, i) => ({...p, textEn: originals[i]}))};
  const en = (r) => r.violations.filter((v) => v.language === 'en');
  const lean = inspectStory(j.outline, pagination, {...j.input, promptDiet: {version: 1}});
  assert.deepEqual([...new Set(en(lean).map((v) => v.pageNo))], [1]);
  assert.ok(en(lean).every((v) => /평균 16단어|긴 문장 2개/u.test(v.message)), en(lean).map((v) => v.message).join(' / '));
  const notes = lean.warnings.filter((w) => w.code === 'out-of-vocabulary');
  assert.deepEqual(notes.map((w) => w.pageNo), [2, 3]);
  assert.match(notes[0].message, /18\.5% · 참고 \(목록 밖: click, puffed, cheeks/u);
  const {promptDiet, ...plain} = j.input;
  const old = inspectStory(j.outline, pagination, plain);
  assert.ok(new Set(en(old).map((v) => v.pageNo)).size >= 5, `${en(old).length} strict English violations`);
  const final = inspectStory(j.outline, j.pagination, {...j.input, promptDiet: {version: 1}});
  assert.equal(final.passed, true); assert.deepEqual(en(final), []);
});

test('R31e the beat writer on the diet: the English line gives the range and the role, the brief shows sounds and props but not light or weather, a retry for long sentences says split (never “keep the count”), every attempt is logged; without the policy the old lines and the old delta', async () => {
  const j = paid();
  const KO = '유하가 노란 버스를 탔어요. 해니가 옆에 앉았어요. 둘이 안전띠를 맸어요. 버스가 부릉부릉 달렸어요. 창밖에 하늘이 파랬어요. 유하가 손수건을 꺼냈어요. 해니가 볼을 부풀렸어요. 유하가 하하 웃었어요. 손수건이 팔랑 흔들렸어요. 해니가 손을 쏙 넣었어요. 손수건이 불룩 솟았어요. 유하가 가만히 보았어요.';
  const run = async (input) => {
    const calls = [];
    const writer = {id: 'openai', async complete(req) {
      calls.push(req);
      const ko = /한국어 그림책 작가/u.test(req.system), retry = /\[이전 시도의 문제/u.test(req.user), first = /\[이번 비트\] 1 /u.test(req.user);
      return reply({text: ko ? KO : first && !retry ? LONG : GOOD, pick: 1, reason: 'x'});
    }};
    const result = await generateProse(j.outline, input, {engineId: 'openai', engine: writer, qualityEngines: {beatWriter: writer, cheap: writer}, sceneBriefs: j.sceneBriefs}).catch((error) => ({error}));
    return {calls, result};
  };
  const diet = await run({...j.input, promptDiet: {version: 1}});
  assert.ok(diet.result.meta?.writer, diet.result.error?.message);
  const isWriter = (c) => /picture-book author writing original English/u.test(c.system);
  const en = diet.calls.filter(isWriter);
  assert.ok(en.length >= 7);
  assert.ok(en.every((c) => /The English is the short telling of the same beat/u.test(c.system)));
  assert.ok(en.every((c) => /\[분량\] 이 비트의 영어는 2~4문장, 한 문장 5~9 words\./u.test(c.user)));
  assert.ok(en.every((c) => /\[장면 디테일 — 글에 쓸 것: 소리·소품·동작·대사·웃음 포인트/u.test(c.user) && !/"light"|"weather"|"creature"|"smellOrTouch"/u.test(c.user)));
  assert.ok(en.every((c) => /"sounds"|"props"/u.test(c.user)));
  const retry = en.find((c) => /\[이전 시도의 문제/u.test(c.user));
  assert.ok(retry, 'beat 1 was asked again');
  assert.match(retry.user, /긴 문장: ".+"\(16단어\)/u);
  assert.match(retry.user, /\[고칠 양\] 긴 문장은 짧은 문장 여러 개로 나누세요\(이 비트는 4문장까지 괜찮아요\)/u);
  assert.doesNotMatch(retry.user, /문장 수는 그대로/u);
  const report = diet.result.meta.writer;
  assert.equal(report.attempts['en:1'], 2);
  assert.equal(report.attemptLog['en:1'].length, 3, 'two drafts and one retry logged');
  assert.deepEqual(report.attemptLog['en:1'][0].words, [16, 16]);
  assert.equal(report.attemptLog['en:1'][2].retry, true); assert.deepEqual(report.attemptLog['en:1'][2].problems, []);
  assert.deepEqual(report.warnings.filter((w) => /영어 \d비트/u.test(w)), []);
  const {promptDiet, ...plain} = j.input;
  const old = await run(plain);
  assert.ok(old.result.meta?.writer, old.result.error?.message);
  const oldEn = old.calls.filter(isWriter);
  assert.ok(oldEn.every((c) => /\[장면 디테일\(그림과 같아야 함\)\]/u.test(c.user) && /\[분량\] 이 비트는 \d문장 안팎\(범위 2~4\)\. 한 문장 9 words 안팎\./u.test(c.user)));
  assert.ok(oldEn.every((c) => !/short telling/u.test(c.system)));
  const oldRetry = oldEn.find((c) => /\[이전 시도의 문제/u.test(c.user));
  assert.match(oldRetry.user, /문장 수는 그대로 두고/u);
  assert.equal(old.result.meta.writer.attemptLog, undefined);
});

test('R31e a diet K2 outline has no event ledger: not asked for, not in the schema, a volunteered one dropped, no repair call; the ledger reviews are skipped; the estimate has no review rows (a job with a ledger keeps them)', async () => {
  const j = paid();
  const input = normalizeStoryInput({...j.input, councilPolicy: undefined, orchestrationPolicy: undefined});
  assert.deepEqual(input.promptDiet, {version: 1});
  const calls = [];
  const engine = {id: 'openai', async complete(req) { calls.push(req); return reply(structuredClone(j.outline)); }};
  const result = await generateOutline(input, {engineId: 'openai', engine});
  assert.equal(calls.length, 1, 'no repair call for a missing ledger');
  assert.doesNotMatch(calls[0].system, /plotContract/u);
  assert.equal(calls[0].jsonSchema.required.includes('plotContract'), false);
  assert.equal(calls[0].jsonSchema.properties.plotContract, undefined);
  assert.ok(j.outline.plotContract, 'the mock reply volunteers the paid ledger');
  assert.equal(result.data.plotContract, undefined, 'the volunteered ledger is dropped');
  assert.equal(result.data.beats.length, j.outline.beats.length);
  const review = await reviewStoryCoherence(result.data, demoProse(result.data, input), null, input, {engineId: 'openai', engine});
  assert.equal(review.meta.skipped, true); assert.equal(review.meta.requests, 0);
  assert.equal(calls.length, 1, 'no review bought');
  const settings = setup().settings.textGeneration || {};
  const estimate = (opts) => estimateStoryTextCost({settings, pageCount: 12, layout: 'openings', specs: j.input.specs, editor: true, council: true, orchestration: true, ...opts});
  const diet = estimate({diet: true}), withLedger = estimate({diet: true, ledger: true}), legacy = estimate({});
  assert.equal(diet.stages.some((row) => row.stage === 'coherence'), false);
  assert.ok(withLedger.stages.some((row) => row.stage === 'coherence') && legacy.stages.some((row) => row.stage === 'coherence'));
  assert.equal(withLedger.requestCount - diet.requestCount, 2);
  assert.ok(withLedger.costUsd > diet.costUsd);
  assert.doesNotMatch(diet.note, /일관성 검사/u); assert.match(withLedger.note, /일관성 검사 총 2회/u);
});

test('R31e diet requests show the lean outline (no room record, bible or ledger) and lean pages (no plot context, staging, brief copy or richness report); drafts without the policy send the whole records', async () => {
  const j = paid();
  const view = leanOutlineView(j.outline);
  assert.deepEqual(Object.keys(view), ['titleCandidates', 'logline', 'want', 'problem', 'beats', 'twist', 'newWordsKo', 'newWordsEn', 'settings', 'emotionArc', 'endingType', 'tension']);
  assert.ok(JSON.stringify(view).length < 3000 && JSON.stringify(j.outline).length > 25000, 'the record is a tenth of the outline');
  const page = leanPageView(j.pagination.pages[0]);
  assert.deepEqual(Object.keys(page), ['pageNo', 'beatIndex', 'kind', 'openingNo', 'side', 'entryId', 'cue', 'textKo', 'textEn', 'scene', 'variantByCharacter', 'isRefrainPage']);
  assert.deepEqual(Object.keys(writerBriefView((j.sceneBriefs.briefs || j.sceneBriefs)[0])), ['sounds', 'props', 'pose', 'dialogueLine', 'humor']);
  // The scene-brief request.
  const briefs = async (input) => {
    const calls = [];
    const engine = {id: 'openai', async complete(req) { calls.push(req); return reply({briefs: structuredClone(j.sceneBriefs.briefs || j.sceneBriefs)}); }};
    await generateSceneBriefs(j.outline, input, {engineId: 'openai', engine}).catch(() => {});
    return calls;
  };
  const diet = JSON.parse((await briefs({...j.input, promptDiet: {version: 1}}))[0].user);
  assert.equal(diet.approvedOutline.council, undefined); assert.equal(diet.approvedOutline.plotContract, undefined); assert.equal(diet.approvedOutline.bible, undefined);
  assert.ok(Array.isArray(diet.approvedOutline.beats) && diet.approvedOutline.beats.length === 6);
  const {promptDiet, ...plain} = j.input;
  const old = JSON.parse((await briefs(plain))[0].user);
  assert.ok(old.approvedOutline.council && old.approvedOutline.plotContract, 'the whole outline as before');
  // A page fix: the writer's long English on spread 1 is fixed once; the request carries the lean page.
  const fix = async (input) => {
    const calls = [];
    const engine = {id: 'openai', async complete(req) {
      calls.push(req);
      const data = JSON.parse(req.user), required = req.jsonSchema?.required || [];
      if (required.includes('action') && !required.includes('textKo')) return reply({action: data.targetPage.scene.action});
      return reply({...data.targetPage, textEn: GOOD});
    }};
    const pages = {...j.pagination, pages: j.pagination.pages.map((p, i) => (i === 0 ? {...p, textEn: LONG} : p))};
    await repairPagination(j.outline, j.prose, pages, input, {engine, sceneBriefs: j.sceneBriefs, skipChildGate: true, skipCoherence: true, revise: false}).catch(() => {});
    return calls.map((c) => JSON.parse(c.user));
  };
  const dietFix = await fix({...j.input, promptDiet: {version: 1}});
  assert.equal(dietFix.length, 1, 'one page fix on the diet');
  assert.equal(dietFix[0].targetPage.pageNo, 1);
  for (const key of ['plotContext', 'staging', 'sceneBrief', 'richnessCheck']) assert.equal(key in dietFix[0].targetPage, false, key);
  assert.ok(dietFix[0].targetPage.scene && dietFix[0].targetPage.textKo);
  assert.equal(dietFix[0].approvedOutline.council, undefined);
  const oldFix = await fix(plain);
  assert.ok(oldFix.length >= 1);
  assert.ok('plotContext' in oldFix[0].targetPage && oldFix[0].approvedOutline.plotContract, 'the whole page and outline as before');
});

const script = fileURLToPath(new URL('../scripts/r31b-ab.mjs', import.meta.url));
test('R31e the A/B runner (demo K2 run) measures the way the app does and keeps the richer records: the repair history carries violations with language and message and the page texts, outline repairs are recorded', () => {
  const out = mkdtempSync(join(tmpdir(), 'r31e-ab-'));
  const result = spawnSync(process.execPath, [script, 'K2', 'diet', out, '--demo'], {encoding: 'utf8', timeout: 180000});
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const j = JSON.parse(readFileSync(join(out, 'K2-diet.json'), 'utf8'));
  assert.equal(j.status, 'text-review');
  assert.ok(Array.isArray(j.outlineRepairs));
  assert.ok(j.repairHistory.length >= 1);
  assert.ok(j.repairHistory.every((h) => Array.isArray(h.texts) && h.violations.every((v) => typeof v === 'object' && 'language' in v && 'message' in v)));
  assert.ok(j.measured.rows.every((r) => Array.isArray(r.enNotes) && Array.isArray(r.koNotes)));
  const md = readFileSync(join(out, 'K2-diet.md'), 'utf8');
  assert.match(md, /## 수정 기록/u);
  assert.doesNotMatch(readFileSync(join(out, 'K2-diet.json'), 'utf8'), /apiKey|api_key|secret|password|authorization/iu);
});
