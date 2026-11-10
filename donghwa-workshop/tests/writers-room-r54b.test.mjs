import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {normalizeStoryInput} from '../dist/story-generation/pipeline.js';
import {demoOutline} from '../dist/story-generation/demo.js';
import {validateOpenings} from '../dist/book-layout.js';
import {createFullAutoJob, runFullAuto} from '../dist/full-auto.js';
import * as W from '../dist/story-generation/writers-room.js';
import {renderSimpleCreate, ensureSimpleWizard} from '../dist/simple-create.js';
import {renderStoryQualitySettings} from '../dist/story-generation/quality-settings.js';
import {getTextGenerationSettings} from '../dist/text-generation/settings-ui.js';

/**
 * R54b (2026-11-04) 펼침 제본. A room draft keeps the layout the screen asked
 * for. An openings book (K2+ dual, 12 or 16 printed pages, C = 6 or 8
 * openings) binds the writer's pages deterministically: the entries are
 * clamped to C..2C (split at sentences, joined by shortest neighbours — the
 * words untouched), dealt into the C openings in order with the doubled
 * openings spread evenly, every entry of opening k on approved beat k. The
 * printed count never changes; the brief tells the writer the binding.
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const roomState = () => { const s = setup(); s.settings.textGeneration = {...(s.settings.textGeneration || {}), writersRoom: true}; return s; };
const wizard = {characterIds: ['yuha', 'mom'], backgroundIds: ['home', 'beach'], topic: '뽀글머리', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual'};
const PREMISE = {title: '파마 날', line: '보라의 가게에서', engine: 'three_then_flip', laugh: '엄마 머리가 먼저 뽀글이 돼요', picture: '거울 앞 세 사람', cast: [{name: '보라', isNew: true, want: '쉬고 싶다'}]};
const reply = (json) => ({json, usage: {input: 10, output: 5}, meta: {requests: 1, model: 'mock'}});
const page = (i) => ({ko: `${i}쪽이에요. 유하가 거울을 봐요. 뽀글머리가 보여요.`, en: `Page ${i}. Yuha looks in the mirror.`});
const roomInput = () => normalizeStoryInput({...inputFromWizard(roomState(), wizard, {layout: 'openings'}).input, bookId: 'r54b'});
const roomOutline = (input) => ({...demoOutline(input), writersRoom: {kind: 'writersRoom', version: 1, chosen: 1, premise: PREMISE, pitches: [{title: '파마 날'}], premises: [PREMISE]}});
const extractor = (calls) => ({id: 'openai', async complete(r) {
  calls.push(r);
  const n = Number(r.jsonSchema.properties.pages.minItems);
  // The model's beat guesses are wrong on purpose: the binding never reads them.
  return reply({cover: {title: '파마 날!', sceneAction: 'Yuha in the salon chair.'}, pages: Array.from({length: n}, (_, i) => ({pageNo: i + 1, beatIndex: 99 - i, who: ['yuha', 'mom'], where: 'the salon (beach)', action: `Yuha looks at page ${i + 1}.`, emotion: 'curious', timeOfDay: 'day', props: ['mirror']}))});
}});

test('R54b the room keeps the asked layout: a K2 dual room draft is an openings book of 16 printed pages, and its brief states the binding', () => {
  const input = roomInput();
  assert.equal(input.writersRoom?.version, 1);
  assert.equal(input.layoutPolicy?.kind, 'openings');
  assert.equal(input.pageCount, 16);
  const brief = W.roomBrief(input);
  assert.match(brief, /\[길이\] 쪽수는 작가가 정해요\. 이야기가 원하는 만큼\. 이 책은 펼침 8개\(16쪽\)로 묶어요 — 글 8~16쪽이 그대로 들어가고/);
  const pages = normalizeStoryInput({...inputFromWizard(roomState(), wizard, {layout: 'pages'}).input, bookId: 'p'});
  assert.doesNotMatch(W.roomBrief(pages), /펼침 \d+개/, 'a page book\'s brief names no binding');
});

test('R54b the binding: entries clamp to C..2C, the doubled openings spread evenly, every entry on its opening\'s beat', () => {
  const beats = [1, 2, 3, 4, 5, 6, 7, 8], input = roomInput();
  assert.deepEqual(W.openingBeats(input, beats, 8), beats, 'eight entries: one per opening');
  assert.deepEqual(W.openingBeats(input, beats, 16), beats.flatMap((b) => [b, b]), 'sixteen: every opening a pair');
  const eleven = W.openingBeats(input, beats, 11);
  assert.equal(eleven.length, 11);
  assert.deepEqual([...new Set(eleven)], beats, 'every opening has an entry, in order');
  const doubled = beats.filter((b) => eleven.filter((x) => x === b).length === 2);
  assert.equal(doubled.length, 3);
  assert.ok(doubled[0] <= 3 && doubled[2] >= 6, 'the three pairs are spread through the book, not bunched');
  assert.equal(W.openingBeats(input, beats, 7), null, 'outside C..2C the caller clamps first');
  assert.equal(W.openingBeats({...input, layoutPolicy: undefined}, beats, 8), null, 'a page book has no openings');
  const bounds = {min: 8, max: 16};
  assert.equal(W.clampPages(Array.from({length: 5}, (_, i) => page(i + 1)), bounds).length, 8, 'five pages split to the floor');
  assert.equal(W.clampPages(Array.from({length: 11}, (_, i) => page(i + 1)), bounds).length, 11, 'eleven stay eleven (the writer\'s count fits)');
  assert.equal(W.clampPages(Array.from({length: 20}, (_, i) => page(i + 1)), bounds).length, 16, 'twenty join down to the ceiling');
  assert.equal(W.clampPages(Array.from({length: 10}, (_, i) => page(i + 1))).length, 12, 'a page book still takes the nearest binding');
});

test('R54b the room pages of an openings book pass the app\'s opening structure check and keep the printed count', async () => {
  const input = roomInput(), outline = roomOutline(input);
  const draft = {title: '파마 날!', language: 'dual', pages: Array.from({length: 11}, (_, i) => ({pageNo: i + 1, ...page(i + 1)}))};
  const calls = [], engine = extractor(calls);
  const result = await W.runRoomPages(input, outline, draft, {engine, engineId: 'openai', qualityEngines: {cheap: engine, prose: engine}}, {engineFor: () => engine});
  assert.equal(calls.length, 1);
  assert.equal(result.meta.pageCount, 16, 'the printed count');
  assert.equal(result.meta.entries, 11);
  assert.equal(result.meta.openings, 8);
  assert.equal(result.meta.clamped, false);
  const pages = result.data.pages;
  const structure = validateOpenings(result.data, {...input, pageCount: 16}, outline);
  assert.deepEqual(structure.errors, [], 'the structure the prints read is valid');
  assert.equal(structure.valid, true);
  assert.equal(new Set(pages.map((p) => p.openingNo)).size, 8, 'every opening has an entry');
  assert.ok(pages.every((p, i) => p.pageNo === i + 1 && (p.kind === 'spread' ? p.side === 'spread' : ['left', 'right'].includes(p.side))));
  assert.ok(pages.every((p) => p.entryId === `b${p.beatIndex}-${p.side}`));
  assert.ok(pages.every((p) => /유하가 거울을 봐요/.test(p.textKo)), 'the words are the writer\'s');
  assert.ok(!result.meta.checks.violations.some((v) => v.kind === 'pagination'), 'no structural violation reported');
});

test('R54b FULL AUTO: a room job of an openings book keeps pageCount 16 after the room pages (its entries are not the printed count)', async () => {
  const state = roomState();
  // The job parks before the pictures ('pages'): the text stage, the room pages included, runs whole.
  const job = createFullAutoJob(state, {...wizard, simpleFlow: true}, {allowNew: false, planMode: 'selection', stopBefore: 'pages'});
  assert.equal(job.input.layoutPolicy?.kind, 'openings');
  assert.equal(job.input.writersRoom?.version, 1);
  const outline = roomOutline(job.input);
  const draft = {title: '파마 날!', language: 'dual', pages: Array.from({length: 11}, (_, i) => ({pageNo: i + 1, ...page(i + 1)}))};
  const calls = [], engine = extractor(calls);
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  const ops = {
    preflight: async () => {},
    plan: async () => { throw Error('selection mode never plans'); },
    characterSheet: async () => ({imageAssetId: 'image-auto-character-0001', imageUrl: image, seed: 1, meta: {quality: 'final', requestedSeed: 1, costUsdEstimated: 0}}),
    backgroundSheet: async () => { throw Error('no background sheet'); },
    outline: async () => ({data: outline, usage: {input: 1, output: 1}, meta: {stage: 'outline', requests: 1, model: 'mock'}}),
    roomDrafts: async () => ({data: draft, usage: {input: 1, output: 1}, meta: {stage: 'roomDrafts', requests: 1, model: 'mock'}}),
    roomPages: (input, o, d, opts) => W.runRoomPages(input, o, d, {...opts, engine, engineId: 'openai', qualityEngines: {cheap: engine, prose: engine}}, {engineFor: () => engine}),
    briefs: async () => { throw Error('a room job has no scene briefs'); },
    prose: async () => { throw Error('a room job has no beat writers'); },
    pagination: async () => { throw Error('a room job has no pagination request'); },
    cover: async () => { throw Error('stop here'); },
  };
  await runFullAuto(state, job, {operations: ops, buildBook: (p) => ({id: p.bookId, title: 'x', characterIds: p.wizard.characterIds, backgroundIds: p.wizard.backgroundIds, worldId: p.worldId, storyDraftId: p.id, pages: p.pagination.pages.map((q) => ({...q, ko: q.textKo, en: q.textEn}))}), save: () => true});
  assert.ok(['parked', 'review', 'paused', 'done'].includes(job.status) || job.failure == null, `the job parked before the pictures (${job.status}: ${job.failure?.message || ''})`);
  assert.equal(calls.length, 1, 'one cheap extraction call');
  assert.equal(job.pagination?.pages?.length, 11, 'eleven entries');
  assert.equal(job.input.pageCount, 16, 'the printed count stays');
  assert.equal(job.sceneBriefs?.length, 0);
});

/* ---------- R54c (2026-11-04): the room is the default; the shelf's diversity line ---------- */
test('R54c the writers\' room is on by default: a plain family state carries the marker, only a stored false turns it off, a stored true still reads as on', () => {
  const plain = setup();
  assert.deepEqual(W.writersRoomFor(plain), {version: 1, weave: 5}, 'on with nothing stored');
  assert.equal(W.writersRoomOn(plain.settings.textGeneration), true);
  assert.deepEqual(normalizeStoryInput({...inputFromWizard(plain, wizard, {layout: 'openings'}).input, bookId: 'd'}).writersRoom, {version: 1, weave: 5});
  const off = setup(); off.settings.textGeneration = {...(off.settings.textGeneration || {}), writersRoom: false};
  assert.equal(W.writersRoomFor(off), null);
  assert.equal(W.writersRoomOn(off.settings.textGeneration), false);
  assert.equal(getTextGenerationSettings(off).writersRoom, false, 'the settings keep the off');
  assert.deepEqual(W.writersRoomFor(roomState()), {version: 1, weave: 5}, 'a stored true (R51–R55a) is still on');
  assert.equal(getTextGenerationSettings(roomState()).writersRoom, undefined, 'and is no longer stored');
  assert.equal(inputFromWizard(plain, {...wizard, koreanLevel: 'K1', englishLevel: 'E0', pageCount: 12}, {layout: 'pages'}).input.writersRoom, undefined, 'K1 stays on the old path');
  assert.match(renderStoryQualitySettings(plain), /id="quality-writers-room"[^>]*checked/, 'the settings switch shows on');
  assert.doesNotMatch(renderStoryQualitySettings(off), /id="quality-writers-room"[^>]*checked/);
});

test('R54c the simple ①: a K1 story keeps its format panel even with the room on (the room does not write K1); a K2 story shows the room note', () => {
  const state = setup();
  const ctxFor = (w) => ({getState: () => state, getWizard: () => w, setWizard: () => {}, getDraft: () => null, setDraft: () => {}, getEditPage: () => 0, setEditPage: () => {}, isSimpleView: () => true, isSimpleMode: () => true, materialPortrait: () => '', cover: () => '', illustration: () => ''});
  const k1 = ensureSimpleWizard(state, {...structuredClone(wizard), koreanLevel: 'K1', englishLevel: 'E0', pageCount: 8, language: 'dual', simpleStep: 1, simpleFormatOpen: true});
  const k1Html = renderSimpleCreate(ctxFor(k1));
  assert.match(k1Html, /id="simple-format-panel"/);
  assert.doesNotMatch(k1Html, /simple-room-note/);
  const k2 = ensureSimpleWizard(state, {...structuredClone(wizard), simpleStep: 1, simpleFormatOpen: true});
  const k2Html = renderSimpleCreate(ctxFor(k2));
  assert.match(k2Html, /simple-room-note/);
  assert.doesNotMatch(k2Html, /id="simple-format-panel"/);
});

test('R54c the shelf\'s diversity line counts the engines, laughs, new companions and places of the recent room books and names a repeated engine', () => {
  assert.equal(W.roomDiversityLine([]), '');
  assert.equal(W.roomDiversityLine([{usedElements: {humor: ['x']}}]), '', 'no room book, no line');
  const book = (engine, laugh, place, isNew) => ({usedElements: {engine, humor: [laugh], places: [place]}, outline: {writersRoom: {premise: {engine, cast: isNew ? [{name: '보라', isNew: true}] : []}}}});
  const line = W.roomDiversityLine([book('three_then_flip', '엄마 머리', '미용실', true), book('reader_knows', '모자', '바닷가', false), book('two_threads', '모자', '바닷가', true)]);
  assert.equal(line, '최근 작가실 책 3권 · 이야기 장치 3가지 · 웃음 2가지 · 새 인물 2명 · 장소 2곳');
  const leaning = W.roomDiversityLine([book('three_then_flip', 'a', 'p', false), book('reader_knows', 'b', 'q', false), book('three_then_flip', 'c', 'r', false)]);
  assert.match(leaning, /최근 넉 권에 '되풀이 셋·넷째 뒤집기'이 두 번$/);
});

/* ---------- R54d (2026-11-04): FULL AUTO passes no services to the drafts and pages stages ---------- */
test('R54d the room\'s drafts and pages stages resolve their engines through the pipeline when the caller (FULL AUTO) passes no services', async () => {
  // The paid A/B run stopped at 초고 쓰기 with "services.engineFor is not a function": FULL AUTO calls
  // ops.roomDrafts(input, outline, opts) with the step's text options only, as it calls generateOutline.
  const input = roomInput(), outline = roomOutline(input);
  const calls = [];
  const engine = {id: 'openai', async complete(r) {
    calls.push(r);
    const schema = r.jsonSchema?.properties || {};
    if (schema.readers) return reply({readers: ['action', 'laugh', 'heart', 'eye', 'ours', 'parent'].map((reader) => ({reader, favorite: 1, again: reader === 'ours', drafts: [{draft: 1, skipPage: 1, lostPage: 0, laughPages: [1], change: '또'}]}))});
    if (schema.pages && r.system.includes('return, for every page')) {
      const n = Number(schema.pages.minItems);
      return reply({cover: {title: '파마 날!', sceneAction: 'Yuha in the salon chair.'}, pages: Array.from({length: n}, (_, i) => ({pageNo: i + 1, beatIndex: 1, who: ['yuha'], where: 'the salon', action: `page ${i + 1}`, emotion: 'curious', timeOfDay: 'day', props: ['mirror']}))});
    }
    return reply({title: '파마 날!', pages: Array.from({length: 11}, (_, i) => page(i + 1))});
  }};
  // The step's options as FULL AUTO builds them: a role selection per quality role, no services object.
  const opts = {engineId: 'openai', config: {}, createTextEngine: () => engine, qualityEngines: {outline: {engineId: 'openai', config: {}, createTextEngine: () => engine}, prose: {engineId: 'openai', config: {}, createTextEngine: () => engine}, cheap: {engineId: 'openai', config: {}, createTextEngine: () => engine}}, roomDraftCount: 1, roomRewrite: false, roomPolish: false};
  const drafts = await W.runRoomDrafts(input, outline, opts);
  assert.equal(drafts.data.pages.length, 11);
  const pages = await W.runRoomPages(input, outline, drafts.data, opts);
  assert.equal(pages.meta.pageCount, 16);
  assert.ok(calls.length >= 2, 'the writer and the extraction ran without a services object');
});
