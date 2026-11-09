import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {normalizeStoryInput} from '../dist/story-generation/pipeline.js';
import {demoOutline} from '../dist/story-generation/demo.js';
import {estimateStoryTextCost, jobTextBudget} from '../dist/text-generation/models.js';
import {estimateFullAutoCost, createFullAutoJob} from '../dist/full-auto.js';
import * as W from '../dist/story-generation/writers-room.js';

/**
 * R53 (2026-11-03). The room's finished text becomes the pages every later
 * stage reads: clamped to the binding (8–24 pages, the words untouched), read
 * once by the cheap model for what the pictures need (who, where, the action,
 * a feeling, the hour, props, the beat), settled against the cast and beats,
 * then through the app's own page acceptor and story checks. A room draft is
 * a page book (the writer sets the length). FULL AUTO skips the scene briefs,
 * the beat writers and the pagination request for a room job; a demo job
 * keeps the old path. The estimate prices the room's rounds.
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); s.settings.textGeneration = {...(s.settings.textGeneration || {}), writersRoom: false}; /* R54c: off (the old path / the 'off' case) */ return s; };
const wizard = {characterIds: ['yuha', 'mom'], backgroundIds: ['home', 'beach'], topic: '뽀글머리', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual'};
const roomState = () => { const s = setup(); s.settings.textGeneration = {...(s.settings.textGeneration || {}), writersRoom: true}; return s; };
const PREMISE = {title: '파마 날', line: '보라의 가게에서', engine: 'three_then_flip', laugh: '엄마 머리가 먼저 뽀글이 돼요', picture: '거울 앞 세 사람', cast: [{name: '보라', isNew: true, want: '쉬고 싶다', flaw: '손이 빠르다', speech: '손님에게 존댓말'}]};
const reply = (json) => ({json, usage: {input: 10, output: 5}, meta: {requests: 1, model: 'mock'}});
const page = (i) => ({ko: `${i}쪽이에요. 유하가 거울을 봐요. 뽀글머리가 보여요.`, en: `Page ${i}. Yuha looks in the mirror.`});

test('R53 the binding: 8, 12, 16 or 24 pages, the words untouched — a short book is split at sentences, a long one joins its shortest neighbours', () => {
  assert.deepEqual(W.PAGE_COUNTS, [8, 12, 16, 24]);
  const few = W.clampPages([{ko: '하나예요. 둘이에요. 셋이에요. 넷이에요. 다섯이에요.', en: 'One. Two. Three. Four. Five.'}, {ko: '여섯이에요. 일곱이에요. 여덟이에요.', en: 'Six. Seven. Eight.'}, {ko: '아홉이에요. 열이에요.'}]);
  assert.equal(few.length, 8);
  assert.equal(few.map((p) => p.ko).join(' '), '하나예요. 둘이에요. 셋이에요. 넷이에요. 다섯이에요. 여섯이에요. 일곱이에요. 여덟이에요. 아홉이에요. 열이에요.', 'nothing lost, nothing added');
  assert.ok(few.every((p) => p.ko));
  assert.equal(few.filter((p) => p.en !== undefined).map((p) => p.en).join(' '), 'One. Two. Three. Four. Five. Six. Seven. Eight.');
  assert.equal(W.clampPages(Array.from({length: 10}, (_, i) => page(i + 1))).length, 12, 'ten pages go up to twelve');
  assert.equal(W.clampPages(Array.from({length: 20}, (_, i) => page(i + 1))).length, 24, 'a tie goes up');
  assert.equal(W.clampPages(Array.from({length: 13}, (_, i) => page(i + 1))).length, 12);
  const many = W.clampPages(Array.from({length: 30}, (_, i) => ({ko: i % 7 === 3 ? '짧아요.' : `${i + 1}쪽의 긴 문장이 여기에 있어요.`})));
  assert.equal(many.length, 24);
  assert.equal(many.map((p) => p.ko).join(' ').split(' ').length, Array.from({length: 30}, (_, i) => (i % 7 === 3 ? '짧아요.' : `${i + 1}쪽의 긴 문장이 여기에 있어요.`)).join(' ').split(' ').length, 'every word kept');
  assert.equal(W.clampPages([{ko: '한 문장뿐이에요.'}]).length, 1, 'a page that cannot split stays (the acceptor reports it)');
  assert.deepEqual(W.clampPages(Array.from({length: 12}, (_, i) => page(i + 1))).length, 12, 'inside the binding nothing moves');
});

test('R53 the extraction: the cheap call names cast IDs, places and beats; made-up IDs and beats fall back; the acceptor builds the pagination; the page count follows the book', async () => {
  // R54b: a room draft keeps the asked layout; this is the page-book case (openings: tests/writers-room-r54b.test.mjs).
  const input = normalizeStoryInput({...inputFromWizard(roomState(), wizard, {layout: 'pages'}).input, bookId: 'x'});
  assert.equal(input.layoutPolicy, undefined, 'a page book');
  assert.equal(input.pageCount, 16);
  const outline = {...demoOutline(input), writersRoom: {kind: 'writersRoom', version: 1, chosen: 1, premise: PREMISE, pitches: [{title: '파마 날'}], premises: [PREMISE]}};
  const draft = {title: '파마 날!', language: 'dual', pages: Array.from({length: 10}, (_, i) => ({pageNo: i + 1, ...page(i + 1)}))};
  const req = W.extractRequest(input, outline, draft.pages);
  assert.match(req.system, /\[cast\] yuha = 유하 \(Yuha\) — boy, he, mom = 엄마 \(Mom\) — woman, she/);
  assert.match(req.system, /보라 are new to this book and have no ID/);
  // R55c: no beats in the reading (the app deals the pages over its own beats); a picture-led draft's reading carries the picture fields.
  assert.doesNotMatch(req.system, /\[beats\]/);
  assert.deepEqual(req.jsonSchema.properties.pages.items.required, ['pageNo', 'who', 'where', 'action', 'emotion', 'timeOfDay', 'props', 'shot', 'space', 'carrier', 'focus', 'backdrop', 'pocket', 'hidden', 'holdBack']);
  assert.equal(req.jsonSchema.properties.pages.minItems, 10, 'the request itself takes what it is given');
  assert.match(req.user, /^1쪽: 1쪽이에요\. 유하가 거울을 봐요\. 뽀글머리가 보여요\.\n   EN: Page 1\./);
  const calls = [];
  const engine = {id: 'openai', async complete(r) {
    calls.push(r);
    const n = Number(r.jsonSchema.properties.pages.minItems);
    return reply({cover: {title: '파마 날!', sceneAction: 'Yuha in the salon chair under a cape.'}, pages: Array.from({length: n}, (_, i) => ({pageNo: i + 1, beatIndex: i === 3 ? 2 : i === n - 1 ? 99 : Math.min(8, Math.floor(i / n * 8) + 1), who: i === 0 ? ['yuha', 'ghost'] : i === 1 ? ['nobody'] : ['yuha', 'mom'], where: 'the salon (home)', action: `Yuha looks into the mirror on page ${i + 1}.`, emotion: i === 2 ? 'very happy' : 'curious', timeOfDay: i === 4 ? 'noon' : 'day', props: ['mirror', 'cape']}))});
  }};
  const result = await W.runRoomPages(input, outline, draft, {engine, engineId: 'openai', qualityEngines: {cheap: engine, prose: engine}}, {engineFor: () => engine});
  assert.equal(calls.length, 1, 'one cheap call');
  const pages = result.data.pages;
  assert.equal(pages.length, 12, 'ten pages became twelve (the nearest binding, ties up)');
  assert.equal(result.meta.pageCount, 12);
  assert.equal(result.meta.clamped, true);
  assert.equal(calls[0].jsonSchema.properties.pages.minItems, 12, 'the extraction read the clamped pages');
  assert.deepEqual(pages[0].scene.who, ['yuha'], 'a made-up ID is dropped');
  assert.deepEqual(pages[1].scene.who, ['yuha'], 'no valid ID: the first of the cast');
  assert.equal(pages[2].scene.emotion, 'calm', 'two words are not one');
  assert.equal(pages[4].scene.timeOfDay, 'day', 'an unknown hour');
  assert.ok(pages[3].beatIndex >= pages[2].beatIndex, 'beats never go backwards');
  assert.ok(pages[11].beatIndex <= 8 && pages[11].beatIndex >= pages[10].beatIndex, 'a beat the outline lacks falls back');
  assert.equal(pages.map((p) => p.textKo).join(' '), draft.pages.map((p) => p.ko).join(' '), 'every Korean word in order');
  assert.equal(pages.map((p) => p.textEn).join(' '), draft.pages.map((p) => p.en).join(' '), 'every English word in order');
  assert.equal(result.data.cover.title, '파마 날!', 'R54f-2: the cover title is the writer\'s (the reader\'s own title is ignored)');
  assert.ok(result.meta.checks && typeof result.meta.checks.passed === 'boolean', 'the story checks ran (advisory)');
  // A Korean-only edition fills the English slot with the Korean so the page validator is satisfied; a book with nothing cannot start.
  const settled = W.settleExtraction({pages: []}, input, outline, [{ko: '한글만.'}], '제목');
  assert.equal(settled.pages[0].textEn, '한글만.');
  assert.equal(settled.cover.sceneAction, '한글만.');
  await assert.rejects(() => W.runRoomPages(input, outline, {pages: []}, {engine}, {engineFor: () => engine}), /작가실 글이 없어요/);
});

test('R53 the estimate prices the room\'s rounds (no council, no briefs, no beat writers, no pagination request); a parked room owes nothing for the premises and the panel; a demo job keeps the old path', () => {
  const settings = {engine: 'openai'};
  const room = estimateStoryTextCost({settings, pageCount: 16, diet: true, editor: true, room: true});
  assert.deepEqual(room.stages.map((s) => s.stage), ['roomPremises', 'roomPanel', 'roomCastNotes', 'roomDrafts', 'roomRead', 'roomRewrite', 'roomEnglish', 'roomPolish', 'roomPages'], 'R54e: no read-through row — the room pages skip it; R55c: no outline row — the outline is the app\'s');
  assert.equal(room.stages.find((s) => s.stage === 'roomDrafts').requestCount, 3);
  assert.equal(room.room, true);
  const plain = estimateStoryTextCost({settings, pageCount: 16, diet: true, editor: true, council: true, orchestration: true});
  assert.ok(plain.stages.some((s) => s.stage === 'sceneBriefs') && !plain.stages.some((s) => /^room/.test(s.stage)));
  const state = roomState();
  const est = estimateFullAutoCost(state, wizard, {planMode: 'selection'}), plainEst = estimateFullAutoCost(setup(), wizard, {planMode: 'selection'});
  assert.notEqual(est.textUsd, plainEst.textUsd, 'a new story is priced by the room\'s rounds while the setting is on');
  const job = {status: 'council-review', input: {writersRoom: {version: 1}, promptDiet: {version: 1}, editorPolicy: {version: 1}, pageCount: 16}, completed: {}, textSettings: settings, usage: {calls: []}};
  const budget = jobTextBudget(job);
  assert.ok(!budget.stages.some((s) => s.stage === 'roomPremises' || s.stage === 'roomPanel'), 'already paid');
  assert.ok(budget.stages.some((s) => s.stage === 'roomDrafts'));
  const demo = createFullAutoJob(state, {...wizard, simpleFlow: true}, {allowNew: false, stopBefore: 'text', planMode: 'selection', demo: true});
  assert.equal(demo.demo, true);
  assert.equal(demo.input.writersRoom?.version, 1, 'the marker is on the input');
  assert.equal(demo.input.layoutPolicy?.kind, 'openings', 'R54b: the layout follows the screen (K2 dual is an openings book)');
});
