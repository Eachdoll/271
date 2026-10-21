import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {normalizeStoryInput, generateOutline, generateProse, paginateStory} from '../dist/story-generation/pipeline.js';
import {demoOutline} from '../dist/story-generation/demo.js';
import {demoPlotContract} from '../dist/story-generation/plot-contract.js';
import {buildBeatPagePlan} from '../dist/story-generation/pagination.js';
import {hasK1Policy, k1Pagination} from '../dist/story-generation/k1-book.js';
import {craftOutlineRules} from '../dist/story-generation/craft-rules.js';
import {createFullAutoJob, runFullAuto, estimateFullAutoCost} from '../dist/full-auto.js';

/**
 * 2026-10-21 R31a K1 그림책. A new K1 book (Korean in the book, page layout)
 * freezes k1Policy: no writers' room or story spine, the K1 arc on the app
 * outline path, the whole book written page-first in ONE call (then one call
 * for the pages the checks flag), its pages taken as written. A simple-mode
 * story ends where its topic goes (topicEndingPolicy). K2+ and every saved
 * draft are unchanged.
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wiz = (extra = {}) => ({characterIds: ['yuha'], backgroundIds: ['home', 'forest'], topic: '4살 유하가 스쿨버스를 타고 해니를 만나 장난치며 유치원에 가는 이야기', pageCount: 12, koreanLevel: 'K1', englishLevel: 'E0', value: 'none', ending: 'home', language: 'bilingual', ...extra});
const reply = (json) => ({json, usage: {input: 500, output: 300}, meta: {requests: 1, model: 'mock'}});
const GOLDEN = ['오늘은 유치원 가는 날. 유하가 노란 모자를 써요. 분홍 가방도 메요.', '유하가 정류장에 섰어요. 두리번두리번. 노란 버스가 안 와요.', '부릉부릉! 띠리릭! 노란 스쿨버스가 왔어요. 버스가 웃고 있어요.', '유하가 버스에 올라타요. 빈자리에 앉아 창밖을 보아요.', '뒤에서 "안녕!" 해니가 왔어요. 초록 공룡 가방이 아주 커요.', '처음엔 쑥스러워요. 유하가 고개를 숙여요. 해니도 고개를 숙여요.', '유하가 창문에 손을 대요. 우와, 토끼 그림자! 해니가 까르륵 웃어요.', '까마귀도 하고, 강아지도 해요. 둘이서 손그림자 놀이!', '콩닥콩닥 손뼉 놀이. "하나, 둘, 셋!" 둘이서 같이 웃어요.', '띠리리릿! 유치원이 코앞. 아직 놀고 싶은데… 유하가 해니를 보아요.', '유하가 손을 내밀어요. "해니야, 같이 가자!" 해니가 손을 잡아요.', '둘이 손잡고 유치원에 들어가요. "내일도 같이 타요!"'];
const page = (n, ko = GOLDEN[n - 1]) => ({pageNo: n, ko, en: n % 2 ? 'Yuha gets on the yellow bus.' : 'Yuha and Haeni smile at the window.', picture: `Yuha on page ${n}, soft morning light, no text`, feeling: 'happy', who: ['yuha'], timeOfDay: 'morning', props: ['yellow bus']});

test('R31a a new K1 book freezes k1Policy (no room, no spine); K2 and English-only books do not; the K1 craft lines replace suspense and the sound refrain', () => {
  const state = setup();
  const k1 = inputFromWizard(state, wiz()).input;
  assert.deepEqual(k1.k1Policy, {version: 1});
  for (const key of ['arcPolicy', 'councilPolicy', 'councilRecent']) assert.equal(key in k1, false, key);
  assert.ok(k1.specs.ko.shortSentences, 'the K1 short-sentence spec');
  const k2 = inputFromWizard(state, wiz({koreanLevel: 'K2', englishLevel: 'E2'})).input;
  assert.equal('k1Policy' in k2, false);
  assert.ok(k2.arcPolicy && k2.councilPolicy);
  assert.equal('k1Policy' in inputFromWizard(state, wiz({language: 'en'})).input, false);
  // R31b: on the prompt diet the craft block carries no suspense, refrain or sound quota at all.
  const rules = craftOutlineRules(normalizeStoryInput(k1));
  assert.doesNotMatch(rules, /SUSPENSE|SOUND REFRAIN|K1 SOUNDS|at least/u);
  const {promptDiet, ...undieted} = normalizeStoryInput(k1);
  assert.match(craftOutlineRules(normalizeStoryInput(undieted)), /K1 SOUNDS/u, 'without the diet the K1 sound line stays');
});

test('R31a a simple-mode story ends where its topic goes; a pro story keeps its chosen ending; an old simple job keeps its own ending on resume', async () => {
  const state = setup();
  const simple = inputFromWizard(state, wiz({simpleFlow: true})).input;
  assert.equal(simple.endingType, 'custom');
  assert.deepEqual(simple.topicEndingPolicy, {version: 1});
  assert.match(simple.endingNote, /유치원에 가는 이야기/u);
  assert.match(simple.endingNote, /주제에 가는 곳이 없으면 집에서/u);
  const pro = inputFromWizard(state, wiz()).input;
  assert.equal(pro.endingType, 'home_sleep');
  assert.equal('topicEndingPolicy' in pro, false);
  assert.equal(inputFromWizard(state, wiz({simpleFlow: true, ending: 'open'})).input.endingType, 'open');
  // An old simple job (no policy) resumed at the input step keeps home_sleep.
  const job = createFullAutoJob(state, wiz({simpleFlow: true}), {stopBefore: 'text', planMode: 'selection'});
  delete job.input.topicEndingPolicy;
  job.input.endingType = 'home_sleep';
  job.input.endingNote = '';
  await assert.rejects(runFullAuto(state, job, {operations: {preflight: async () => {}, outline: async () => { throw new Error('stop here'); }}}), /stop here/);
  assert.equal(job.input.endingType, 'home_sleep');
  assert.equal(job.input.endingNote, '');
  assert.equal('topicEndingPolicy' in job.input, false);
});

const k1Input = () => normalizeStoryInput({...inputFromWizard(setup(), wiz({simpleFlow: true})).input, bookId: 'k1'});
const outlineFor = (input) => { const o = structuredClone(demoOutline(input)); o.plotContract = demoPlotContract(o, input); o.tension = [1, 2, 3, 3, 4, 2, 1]; return o; };

test('R31a the K1 outline takes the app path with the K1 arc: no room, no spine, the topic ending', async () => {
  const input = k1Input(), calls = [];
  const engine = {id: 'openai', async complete(req) { calls.push(req); return reply(outlineFor(input)); }};
  await generateOutline(input, {engine}).catch(() => {});
  assert.ok(calls.length >= 1);
  const sys = calls[0].system;
  // R31b: a new K1 draft carries the prompt diet — the K1 shape in one paragraph, not the K1 STORY block.
  assert.match(sys, /A small, warm want and ONE small obstacle/u);
  assert.match(sys, /no mystery and no hidden clue/u);
  assert.doesNotMatch(sys, /K1 STORY \(ages 3-4\)/u);
  // A K1 draft saved before R31b (no promptDiet) still gets the R31a K1 STORY block.
  const {promptDiet, ...rest} = input, old = normalizeStoryInput(rest), oldCalls = [];
  await generateOutline(old, {engine: {id: 'openai', async complete(req) { oldCalls.push(req); return reply(outlineFor(old)); }}}).catch(() => {});
  assert.match(oldCalls[0].system, /K1 STORY \(ages 3-4\)/u);
  assert.match(oldCalls[0].system, /No mystery, no hidden clue, no planted-object reveal/u);
  assert.doesNotMatch(oldCalls[0].system, /STORY SPINE/u);
  assert.doesNotMatch(sys, /STORY SPINE/u);
  assert.match(sys, /endingType=custom/u, 'the topic ending');
  assert.match(sys, /K1 SHORT LINES/u);
  assert.equal(calls.some((c) => /기획 회의|피치/u.test(c.system + c.user)), false, 'no writers’ room');
});

test('R31a the K1 book: one call writes every page; one more call for the flagged pages only; the pages become the pagination as written', async () => {
  const input = k1Input(), outline = outlineFor(input), plan = buildBeatPagePlan(outline, 12), calls = [];
  const engine = {id: 'openai', async complete(req) {
    calls.push(req);
    if (/\[고칠 쪽\]/u.test(req.user)) return reply({pages: [page(4, '유하가 버스에 올라타요. 빈자리에 앉아 창밖을 보아요.')]});
    return reply({cover: 'Yuha and Haeni wave from a yellow bus, no text', pages: plan.map((row) => page(row.pageNo, row.pageNo === 4 ? '유하가 아주 커다란 노란 버스에 신나게 올라타서 맨 뒤 빈자리에 앉아요.' : undefined))});
  }};
  const result = await generateProse(outline, input, {engine, qualityEngines: {beatWriter: engine}});
  assert.equal(calls.length, 2, 'the book, then one fix call');
  assert.match(calls[0].system, /만 3~4세 아이에게 읽어 주는 그림책 작가/u);
  assert.match(calls[0].system, /쪽을 넘기고 싶게 써요/u);
  assert.doesNotMatch(calls[0].system, /다섯 개 이상|한 번 이상|FROZEN|vocabGrade|ruleVersion/u, 'no counters, no spec JSON');
  assert.match(calls[0].system, /Korean K1 \(/u);
  assert.ok(calls[0].user.includes(`[쪽 배치 — 그대로] ${plan.map((r) => `${r.pageNo}쪽 → 비트 ${r.beatIndex}`).join(', ')}`));
  assert.match(calls[1].user, /\[고칠 쪽\]\n4쪽: /u);
  assert.doesNotMatch(calls[1].user, /\[고칠 쪽\][^[]*\n3쪽:/u, 'only the flagged page');
  const prose = result.data;
  assert.equal(prose.pages.length, 12);
  assert.equal(prose.pages[3].ko, '유하가 버스에 올라타요. 빈자리에 앉아 창밖을 보아요.');
  assert.deepEqual(prose.paragraphBeats.ko, outline.beats.map((b) => b.index));
  assert.equal(result.meta.requests, 2);
  assert.deepEqual(result.meta.k1Book.warnings, []);
  // Pagination: the pages as written, no request.
  const pagination = k1Pagination(prose, outline, input);
  assert.equal(pagination.pages[2].textKo, GOLDEN[2]);
  assert.equal(pagination.pages[0].scene.action, 'Yuha on page 1, soft morning light, no text');
  assert.equal(pagination.cover.sceneAction, 'Yuha and Haeni wave from a yellow bus, no text');
  const none = {id: 'openai', async complete() { throw new Error('no request expected'); }};
  const quiet = {...input, storyQuality: {...input.storyQuality, childSimulator: false}};
  const paged = await paginateStory(outline, prose, quiet, {engine: none, skipCoherence: true, repair: false});
  assert.equal(paged.meta.requests, 0);
  assert.equal(paged.data.pages[11].textKo, GOLDEN[11]);
  // A parent's prose edit: the pages no longer match, the usual pagination runs.
  const edited = structuredClone(prose);
  edited.ko = edited.ko.replace('유치원에 들어가요', '유치원 문을 열어요');
  assert.equal(k1Pagination(edited, outline, input), null);
});

test('R31a a K1 page that stays off after the fix is kept with a note; the book never stops', async () => {
  const input = k1Input(), outline = outlineFor(input), plan = buildBeatPagePlan(outline, 12);
  const long = '유하가 아주 커다란 노란 버스에 신나게 올라타서 맨 뒤 빈자리에 앉아요.';
  const engine = {id: 'openai', calls: 0, async complete(req) { this.calls++; return /\[고칠 쪽\]/u.test(req.user) ? reply({pages: [page(4, long)]}) : reply({cover: 'c', pages: plan.map((row) => page(row.pageNo, row.pageNo === 4 ? long : undefined))}); }};
  const result = await generateProse(outline, input, {engine, qualityEngines: {beatWriter: engine}});
  assert.equal(engine.calls, 2);
  assert.match(result.meta.k1Book.warnings.join(' '), /^4쪽: /u);
  assert.match(result.meta.softIssues.join(' '), /4쪽/u);
  // A wrong page count is a structure error (with the billed usage).
  const short = {id: 'openai', async complete() { return reply({cover: 'c', pages: [page(1)]}); }};
  await assert.rejects(generateProse(outline, input, {engine: short, qualityEngines: {beatWriter: short}}), (e) => /12쪽이 아니에요/u.test(e.message) && e.usage?.input === 500);
});

test('R31a the K1 estimate: no room, one book call and one fix call, no pagination request; K2 unchanged', () => {
  const state = setup();
  const k1 = estimateFullAutoCost(state, wiz()), k2 = estimateFullAutoCost(state, wiz({koreanLevel: 'K2', englishLevel: 'E2'}));
  assert.ok(k1.textUsd < k2.textUsd, `${k1.textUsd} < ${k2.textUsd}`);
  assert.ok(hasK1Policy(inputFromWizard(state, wiz()).input));
});
