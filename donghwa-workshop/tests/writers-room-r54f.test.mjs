import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {normalizeStoryInput} from '../dist/story-generation/pipeline.js';
import {demoOutline} from '../dist/story-generation/demo.js';
import {createFullAutoJob, runFullAuto} from '../dist/full-auto.js';
import * as W from '../dist/story-generation/writers-room.js';

/*
 * R54f (2026-11-04): the A/B report's item 3-8. The room's new characters
 * (isNew) had no drawer card, so the extraction described them inside the
 * action and the pictures drew them from the page text alone — a fawn that
 * looks different on every page. Now the premise carries nameEn/kind/look for
 * a new character, FULL AUTO makes a drawer card for each after the outline
 * (no paid call), joins them to the job's cast, and buys their sheets like a
 * plan's new companions (a text hold buys none; the release buys the missing).
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizard = {characterIds: ['yuha', 'mom'], backgroundIds: ['home', 'beach'], topic: '숲속에서 자꾸 숨는 아기 사슴', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual'};
const FAWN = {name: '폴짝이', isNew: true, want: '숨고 싶다', flaw: '겁이 많다', speech: '작게 속삭여요', nameEn: 'Hoppy', kind: 'fawn', look: 'a small spotted fawn with very big ears and a white tail tuft'};
const PREMISE = {title: '숨바꼭질 사슴', line: '숲에서', engine: 'reader_knows', laugh: '사슴이 유하 뒤에 숨어요', picture: '큰 귀만 보이는 덤불', cast: [{name: '유하', isNew: false, want: '', flaw: '', speech: '', nameEn: '', kind: '', look: ''}, FAWN, {name: '그림자', isNew: true, want: '', flaw: '', speech: '', nameEn: '', kind: '', look: ''}]};
const reply = (json) => ({json, usage: {input: 10, output: 5}, meta: {requests: 1, model: 'mock'}});
const page = (i) => ({ko: `${i}쪽이에요. 폴짝이가 숨어요. 유하가 찾아요.`, en: `Page ${i}. Hoppy hides. Yuha looks.`});
const roomOutline = (input) => ({...demoOutline(input), writersRoom: {kind: 'writersRoom', version: 1, chosen: 1, premise: PREMISE, pitches: [{title: '숨바꼭질 사슴'}], premises: [PREMISE]}});
const extractor = (calls) => ({id: 'openai', async complete(r) {
  calls.push(r);
  const n = Number(r.jsonSchema.properties.pages.minItems);
  const fawn = (r.system.match(/(character-[0-9a-f-]+) = 폴짝이/) || [])[1];
  return reply({cover: {title: '숨바꼭질 사슴', sceneAction: 'Yuha in the forest.'}, pages: Array.from({length: n}, (_, i) => ({pageNo: i + 1, beatIndex: 1, who: fawn ? ['yuha', fawn] : ['yuha'], where: 'the forest (beach)', action: `Hoppy hides on page ${i + 1}.`, emotion: 'curious', timeOfDay: 'day', props: ['bush']}))});
}});
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const run = async (stopBefore, sheets, calls) => {
  const state = setup();
  const job = createFullAutoJob(state, {...wizard, simpleFlow: true}, {allowNew: false, planMode: 'selection', stopBefore});
  job.input.writersRoom = {...job.input.writersRoom, weave: 4};
  const engine = extractor(calls);
  const draft = {title: '숨바꼭질 사슴', language: 'dual', pages: Array.from({length: 12}, (_, i) => ({pageNo: i + 1, ...page(i + 1)}))};
  const ops = {
    preflight: async () => {},
    plan: async () => { throw Error('selection mode never plans'); },
    characterSheet: async (s, c) => { sheets.push(c.id); return {imageAssetId: 'image-' + c.id, imageUrl: image, seed: 1, meta: {quality: 'final', requestedSeed: 1, costUsdEstimated: 0}}; },
    backgroundSheet: async () => { throw Error('no background sheet'); },
    outline: async (input) => ({data: roomOutline(input), usage: {input: 1, output: 1}, meta: {stage: 'outline', requests: 1, model: 'mock'}}),
    roomDrafts: async () => ({data: draft, usage: {input: 1, output: 1}, meta: {stage: 'roomDrafts', requests: 1, model: 'mock'}}),
    roomPages: (input, o, d, opts) => W.runRoomPages(input, o, d, {...opts, engine, engineId: 'openai', qualityEngines: {cheap: engine, prose: engine}}, {engineFor: () => engine}),
    briefs: async () => { throw Error('a room job has no scene briefs'); },
    prose: async () => { throw Error('a room job has no beat writers'); },
    pagination: async () => { throw Error('a room job has no pagination request'); },
    cover: async () => { throw Error('stop here'); },
  };
  await runFullAuto(state, job, {operations: ops, buildBook: (p) => ({id: p.bookId, title: 'x', characterIds: p.wizard.characterIds, backgroundIds: p.wizard.backgroundIds, worldId: p.worldId, storyDraftId: p.id, pages: p.pagination.pages.map((q) => ({...q, ko: q.textKo, en: q.textEn}))}), save: () => true});
  return {state, job};
};

test('R54f the premise cast carries a new character\'s card (nameEn, kind, look); roomNewCast lists only new ones with a look and no drawer card; roomCastRecord is a drawer record', () => {
  // R60: this file pins the room before R60 (weave 4 — the look in the premises, the sheet bought right after the cards).
  const schema = W.premisesRequest(((i) => ({...i, writersRoom: {...i.writersRoom, weave: 4}}))(normalizeStoryInput({...inputFromWizard(setup(), wizard, {layout: 'openings'}).input, bookId: 'x'}))).jsonSchema;
  const cast = schema.properties.premises.items.properties.cast.items;
  assert.deepEqual(cast.required, ['name', 'isNew', 'want', 'flaw', 'speech', 'nameEn', 'kind', 'look']);
  assert.match(W.premisesRequest({characters: [], specs: {}}).system, /nameEn\(영어 이름\)·kind\(child, adult, 또는 동물·존재의 영어 한 단어\)·look\(/);
  const outline = {writersRoom: {premise: PREMISE}};
  assert.deepEqual(W.roomNewCast(outline, {characters: [{id: 'yuha', name: '유하'}]}).map((c) => c.name), ['폴짝이'], 'the parent\'s character and the look-less one are not cards');
  assert.deepEqual(W.roomNewCast(outline, {characters: [{id: 'yuha', name: '유하'}, {id: 'c1', name: '폴짝이'}]}), [], 'a character already in the cast is not made twice');
  const record = W.roomCastRecord(W.roomNewCast(outline, {characters: []})[0], {id: 'character-1', jobId: 'auto-1', now: '2026-11-04T00:00:00.000Z'});
  assert.equal(record.id, 'character-1');
  assert.equal(record.nameEn, 'Hoppy');
  assert.equal(record.kind, 'fawn');
  // R55f: an animal card says it is a real animal (the paid book's fawn had a child's face) and carries no hair or skin colour.
  assert.equal(record.description, `${FAWN.look} — a real fawn: animal head, face and body (no human face, hair or skin)`);
  assert.equal(record.appearance, record.description);
  assert.deepEqual([record.hairColor, record.skinColor], ['', '']);
  assert.equal(record.role, '조연');
  assert.equal(record.source, 'writers-room');
  assert.equal(record.autoReviewPending, true);
  assert.deepEqual(record.characterSheets, []);
  assert.equal(W.roomCastRecord({name: '꼬마', look: 'x', kind: 'Boy'}, {id: 'c'}).kind, 'child', 'kind words fold to the drawer\'s child/adult');
});

test('R54f FULL AUTO (full run): the room\'s new character gets a drawer card after the outline, joins the plan, wizard and input cast, gets a sheet, and the extraction names it by ID', async () => {
  const sheets = [], calls = [];
  const {state, job} = await run('pages', sheets, calls);
  assert.ok(job.failure == null, job.failure?.message || '');
  assert.equal(job.roomCast?.length, 1);
  const id = job.roomCast[0].id;
  assert.match(id, /^character-/);
  const card = state.characters.find((c) => c.id === id);
  assert.ok(card, 'the drawer has the card');
  assert.equal(card.name, '폴짝이');
  assert.match(card.description, /^a small spotted fawn with very big ears and a white tail tuft — a real fawn/);
  assert.equal(card.autoRunId, job.id);
  assert.ok(job.plan.characterIds.includes(id), 'the plan counts it');
  assert.ok(job.plan.newCharacters.some((c) => c.id === id));
  assert.ok(job.wizard.characterIds.includes(id));
  assert.ok(job.input.characters.some((c) => c.id === id && c.name === '폴짝이'), 'the job input carries the card');
  assert.ok(job.plan.materialSignatures[id], 'the card is signed like every material');
  assert.deepEqual(sheets, [id], 'its sheet is bought (the seeded parents\' sheets already exist), before the drafts\' pages');
  assert.equal(calls.length, 1);
  assert.match(calls[0].system, new RegExp(`${id} = 폴짝이 \\(Hoppy\\)`), 'the extraction lists it by ID');
  assert.doesNotMatch(calls[0].system, /폴짝이 are new to this book/);
  assert.match(calls[0].system, /그림자 are new to this book and have no ID/, 'the look-less one is still described inside action');
  assert.ok(job.pagination.pages.every((p) => p.scene.who.includes(id)), 'the pages carry the ID');
  assert.ok(job.book.characterIds.includes(id), 'the book names it');
  assert.equal(job.notes.filter((n) => /상한/.test(n)).length, 0);
});

test('R54f FULL AUTO (text hold): the card is made but no sheet is bought until the hold is released', async () => {
  const sheets = [], calls = [];
  const {state, job} = await run('text', sheets, calls);
  assert.ok(job.failure == null, job.failure?.message || '');
  assert.equal(job.status, 'text-review');
  assert.equal(job.roomCast?.length, 1);
  assert.ok(state.characters.some((c) => c.id === job.roomCast[0].id));
  assert.deepEqual(sheets, [], 'a text hold buys no sheet');
  assert.ok(job.plan.characterIds.includes(job.roomCast[0].id), 'the release buys it with the plan\'s other missing sheets');
});
