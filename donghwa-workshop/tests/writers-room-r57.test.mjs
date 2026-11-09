import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {getActiveWorld, migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {normalizeStoryInput} from '../dist/story-generation/pipeline.js';
import {demoOutline} from '../dist/story-generation/demo.js';
import {createFullAutoJob, runFullAuto} from '../dist/full-auto.js';
import {estimateStoryTextCost} from '../dist/text-generation/models.js';
import {renderCouncilReviewForm, renderWritersRoomPanel} from '../dist/story-generation/council-room.js';
import * as W from '../dist/story-generation/writers-room.js';

/*
 * R57 (2026-11-09): "the cast and the places are too few and the stories too
 * alike." More cards do not make a story wide — the kind of story does. The
 * twelve premises span three widths and name the places they go; the three
 * the parent sees are of different widths, each with its cast, places and new
 * sheets counted on the card (choosing a premise is confirming them); a new
 * place gets a drawer card and a place sheet like a new character. A job
 * frozen before R57 keeps its own requests and the three it was shown.
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizard = {characterIds: ['yuha', 'mom'], backgroundIds: ['home', 'forest'], topic: '할머니 댁에 호박 가져다 드리기', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual'};
const roomInput = (id) => normalizeStoryInput({...inputFromWizard(setup(), wizard, {layout: 'openings'}).input, bookId: id});
const preWide = (input) => ({...input, writersRoom: {...input.writersRoom, weave: 2}});
const who = (name, isNew = false, look = '') => ({name, isNew, want: `${name}의 바람`, flaw: '', speech: '', nameEn: isNew ? `${name}En` : '', kind: isNew ? 'animal' : '', look});
const place = (name, isNew = false, look = '') => ({name, isNew, nameEn: isNew ? `${name} place` : '', type: isNew ? 'stream' : '', look});
const premise = (title, cast, places) => ({title, line: `${title}의 한 줄`, engine: 'want_try_turn', laugh: `${title}의 웃음`, picture: `${title}의 그림`, cast, places});
const SMALL = (n) => premise(`작은 ${n}`, [who('유하'), who('엄마')], [place('집')]);
const JOURNEY = (n) => premise(`길 ${n}`, [who('유하'), who('엄마'), who('두더지', true, 'a small grey mole with a red scarf')], [place('집'), place('숲'), place('개울가', true, 'a shallow stream with three flat stepping stones and a leaning willow on the left bank'), place('할머니 댁', true, 'a low house with a blue gate and a persimmon tree')]);
const ENSEMBLE = (n) => premise(`여럿 ${n}`, [who('유하'), who('엄마'), who('곰', true, 'a big brown bear in a yellow apron'), who('토끼', true, 'a white rabbit with a bell'), who('까치', true, '')], [place('집'), place('숲')]);

test('R57 the marker: a new room draft is weave 3 (wide, and still staged); a weave 2 job is staged but not wide', () => {
  const input = roomInput('w1');
  assert.deepEqual(input.writersRoom, {version: 1, weave: 3});
  assert.deepEqual([W.hasRoomWeave(input), W.hasRoomStages(input), W.hasRoomWide(input)], [true, true, true]);
  assert.deepEqual([W.hasRoomStages(preWide(input)), W.hasRoomWide(preWide(input))], [true, false]);
  assert.deepEqual(W.writersRoomRef({version: 1, weave: 3}), {version: 1, weave: 3});
});

test('R57 the twelve premises span three widths and name the places they go (a new place with what a place sheet needs); an older job is asked as before', () => {
  const input = roomInput('w2');
  const req = W.premisesRequest(input);
  const item = req.jsonSchema.properties.premises.items;
  assert.deepEqual(item.required, ['title', 'line', 'engine', 'laugh', 'picture', 'cast', 'places']);
  assert.deepEqual(item.properties.places.items.required, ['name', 'isNew', 'nameEn', 'type', 'look']);
  assert.equal(item.properties.places.maxItems, 5);
  assert.match(req.system, /가는 곳도 적어요\(places — 이 이야기가 실제로 가는 곳을 가는 순서대로, 다섯 곳까지; 부모님이 고른 곳은 이름만/);
  assert.match(req.system, /새 장소\(isNew true\)는 nameEn\(영어 이름\)·type\([^)]*\)·look\(장소 시트용 생김새 한 줄, 영어/);
  assert.match(req.system, /12개는 폭도 서로 달라요: 넷쯤은 한 곳에서 벌어지는 작은 이야기, 넷쯤은 서너 곳을 지나가는 이야기\([^)]*\), 넷쯤은 네다섯이 저마다 제 볼일로 움직이는 이야기 — 새 인물과 새 장소를 아끼지 않아도 돼요\./);
  assert.equal(req.maxTokens, 11000);
  const old = W.premisesRequest(preWide(input));
  assert.equal('places' in old.jsonSchema.properties.premises.items.properties, false);
  assert.doesNotMatch(old.system, /places|폭도 서로 달라요/);
  assert.equal(old.maxTokens, 9000);
});

test('R57 the width of a premise is counted from its own cast and places — never asked', () => {
  assert.deepEqual(W.premiseScale(SMALL(1)), {cast: 2, newCast: [], places: 1, newPlaces: [], sheets: 0, kind: 'small'});
  assert.deepEqual(W.premiseScale(JOURNEY(1)), {cast: 3, newCast: ['두더지'], places: 4, newPlaces: ['개울가', '할머니 댁'], sheets: 3, kind: 'journey'});
  assert.deepEqual(W.premiseScale(ENSEMBLE(1)), {cast: 5, newCast: ['곰', '토끼', '까치'], places: 2, newPlaces: [], sheets: 2, kind: 'ensemble'}, 'a new character without a look buys no sheet');
  const both = premise('둘 다', [who('a'), who('b'), who('c'), who('d')], [place('가'), place('나'), place('다'), place('라'), place('마')]);
  assert.equal(W.premiseScale(both).kind, 'journey', 'five places against four characters: the places say more');
  assert.equal(W.premiseScale({title: 'x', cast: [who('유하'), who('유하'), {name: ''}]}).cast, 1, 'one per name');
  assert.deepEqual(W.premisePlaces({places: [place('숲'), place('숲'), {name: ''}, 3, place('a'), place('b'), place('c'), place('d'), place('e')]}).map((p) => p.name), ['숲', 'a', 'b', 'c', 'd']);
  assert.equal(W.premiseScale({title: 'x', cast: [who('유하'), who('엄마')]}).kind, 'small', 'a premise without places (an older answer) is judged by its cast');
});

test('R57 the three shown are of different widths when the twelve are — the panel\'s best of each, in the panel\'s order', () => {
  // 1–6 small, 7–9 journey, 10–12 ensemble; the panel loved the small ones.
  const premises = [...[1, 2, 3, 4, 5, 6].map(SMALL), ...[7, 8, 9].map(JOURNEY), ...[10, 11, 12].map(ENSEMBLE)];
  const rows = premises.map((_, i) => ({premise: i + 1, pull: [9, 8, 7, 3, 2, 1, 0, 4, 0, 2, 0, 5][i], again: 0}));
  assert.deepEqual(W.pickPremises(rows, 3), [1, 2, 3], 'before: three small stories');
  assert.deepEqual(W.pickPremisesWide(rows, premises, 3), [1, 12, 8], 'the readers\' first, then the best ensemble and the best journey in the readers\' order');
  // Twelve of one width: the panel's top three, as before.
  const allSmall = Array.from({length: 12}, (_, i) => SMALL(i + 1));
  assert.deepEqual(W.pickPremisesWide(rows, allSmall, 3), [1, 2, 3]);
  // Two widths only: the best of each, then the panel's next.
  assert.deepEqual(W.pickPremisesWide(rows, [...[1, 2, 3, 4, 5, 6].map(SMALL), ...[7, 8, 9, 10, 11, 12].map(JOURNEY)], 3), [1, 2, 12]);
  assert.deepEqual(W.pickPremisesWide(rows.slice(0, 2), premises.slice(0, 2), 2), [1, 2]);
});

test('R57 the room run: the held record carries each shown premise\'s width, places and new sheets; the parent\'s choice is that premise; a weave 2 job keeps the panel\'s top three', async () => {
  const premises = [...[1, 2, 3, 4, 5, 6].map(SMALL), ...[7, 8, 9].map(JOURNEY), ...[10, 11, 12].map(ENSEMBLE)];
  const reply = (json) => ({json, usage: {input: 10, output: 5}, meta: {requests: 1, model: 'mock'}});
  // Every reader picks premises 1, 2, 3 in order; one also loves 8 (journey) and 12 (ensemble).
  const engine = {id: 'openai', async complete(req) {
    if (req.jsonSchema.properties.premises) return reply({premises});
    return reply({readers: ['action', 'laugh', 'heart', 'eye', 'ours', 'parent'].map((reader, i) => ({reader, picks: (i === 5 ? [8, 12, 1] : [1, 2, 3]).map((p) => ({premise: p, why: 'laugh', word: '좋아'}))}))});
  }};
  const options = {engine, engineId: 'openai', qualityEngines: {outline: engine, prose: engine, cheap: engine}, councilHold: true};
  const input = roomInput('w5');
  let held;
  await assert.rejects(W.runWritersRoom(input, {...options, onCheckpoint: async (cp) => { held = cp.councilCheckpoint?.record; }}, {engineFor: () => engine}), (e) => e.name === 'CouncilHold');
  assert.deepEqual(held.shortlist, [1, 8, 12]);
  assert.deepEqual(held.pitches.map((p) => p.scale.kind), ['small', 'journey', 'ensemble']);
  assert.deepEqual(held.pitches[1].places, [{name: '집', isNew: false}, {name: '숲', isNew: false}, {name: '개울가', isNew: true}, {name: '할머니 댁', isNew: true}]);
  assert.deepEqual([held.pitches[1].scale.cast, held.pitches[1].scale.newCast, held.pitches[1].scale.sheets], [3, ['두더지'], 3]);
  assert.deepEqual(held.scales.filter((k) => k === 'journey').length, 3);
  assert.equal(held.recommended, 1, 'the readers\' first is still first');
  const older = [];
  await assert.rejects(W.runWritersRoom({...preWide(input), bookId: 'w5b'}, {...options, onCheckpoint: async (cp) => older.push(cp.councilCheckpoint?.record)}, {engineFor: () => engine}), (e) => e.name === 'CouncilHold');
  assert.deepEqual(older.at(-1).shortlist, [1, 2, 3]);
  assert.equal('scale' in older.at(-1).pitches[0], false);
  // The cards: the width tag, the counts, the new sheets and their price; an older record shows what it showed.
  const form = renderCouncilReviewForm(held, {sheetUsd: 0.17});
  assert.match(form, /폭이 다른 이야기를 섞어 보여 드려요 — 고르신 이야기의 새 인물과 새 장소는 카드와 시트를 만들어요\./);
  assert.match(form, /<span class="pitch-tag pitch-scale">여러 곳을 다니는 이야기<\/span>/);
  assert.match(form, /<span class="pitch-materials pitch-scale-line">인물 3명 \(새 인물 1: 두더지\) · 장소 4곳 \(새 장소 2: 개울가, 할머니 댁\) · 새 시트 3장 · 그림 요금 약 \+\$0\.51<\/span>/);
  assert.match(form, /<span class="pitch-materials pitch-scale-line">인물 2명 · 장소 1곳 · 새 시트 없음<\/span>/);
  assert.match(renderCouncilReviewForm(held), /새 시트 3장<\/span>/, 'no price when the screen has none');
  assert.equal((form.match(/<button/g) || []).length, 0, 'the form adds no button');
  const oldForm = renderCouncilReviewForm(older.at(-1), {sheetUsd: 0.17});
  assert.match(oldForm, /독자 여섯이 가장 끌린 순서예요\. 하나를 고르거나 그대로 두세요\./);
  assert.doesNotMatch(oldForm, /pitch-scale/);
  // The parent chooses the journey.
  const done = await W.runWritersRoom(input, {...options, councilCheckpoint: {record: held}, councilChoice: {pick: 2, note: ''}}, {engineFor: () => engine});
  assert.equal(done.record.premise.title, '길 8');
  assert.match(renderWritersRoomPanel(done.record), /pitch-scale/);
});

test('R57 a new place of the chosen premise becomes a drawer card: only new ones with a look that the drawer does not have', () => {
  const outline = {writersRoom: {premise: JOURNEY(1)}};
  const input = {backgrounds: [{id: 'home', name: '집'}, {id: 'forest', name: '숲'}]};
  assert.deepEqual(W.roomNewPlaces(outline, input).map((p) => p.name), ['개울가', '할머니 댁']);
  assert.deepEqual(W.roomNewPlaces(outline, {backgrounds: [...input.backgrounds, {id: 'b1', name: '개울가'}]}).map((p) => p.name), ['할머니 댁'], 'a place already in the drawer is not made twice');
  assert.deepEqual(W.roomNewPlaces({writersRoom: {premise: premise('x', [], [place('이름만', true, '')])}}, input), [], 'no look, no card');
  const record = W.roomPlaceRecord(W.roomNewPlaces(outline, input)[0], {id: 'background-1', jobId: 'auto-1', now: '2026-11-09T00:00:00.000Z'});
  assert.deepEqual(record, {id: 'background-1', name: '개울가', nameEn: '개울가 place', type: 'stream', description: 'a shallow stream with three flat stepping stones and a leaning willow on the left bank', layout: 'a shallow stream with three flat stepping stones and a leaning willow on the left bank', version: 1, source: 'writers-room', autoRunId: 'auto-1', autoReviewPending: true, createdAt: '2026-11-09T00:00:00.000Z'});
  assert.equal(W.roomPlaceRecord({name: '곳', look: 'x', type: '"><b>'}, {id: 'b'}).type, 'b', 'the type keeps letters only');
  assert.equal(W.roomPlaceRecord({name: '곳', look: 'x', type: ''}, {id: 'b'}).type, 'place');
});

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const run = async (stopBefore, bought, calls) => {
  const state = setup();
  getActiveWorld(state).imageEngine = 'openai'; // a paid picture engine buys place sheets (the free sample draws none)
  const job = createFullAutoJob(state, {...wizard, simpleFlow: true}, {allowNew: false, planMode: 'selection', stopBefore});
  const names = Object.fromEntries(state.backgrounds.map((b) => [b.id, b.name]));
  const PREMISE = premise('호박 길', [who('유하'), who('엄마')], [place(names.home), place(names.forest), place('개울가', true, 'a shallow stream with three flat stepping stones and a leaning willow on the left bank'), place('이름만 새 곳', true, '')]);
  const reply = (json) => ({json, usage: {input: 10, output: 5}, meta: {requests: 1, model: 'mock'}});
  const engine = {id: 'openai', async complete(r) {
    calls.push(r);
    const n = Number(r.jsonSchema.properties.pages.minItems), stream = (r.system.match(/(background-[0-9a-f-]+) = 개울가/) || [])[1];
    return reply({cover: {title: '호박 길', sceneAction: 'Yuha with a pumpkin.'}, pages: Array.from({length: n}, (_, i) => ({pageNo: i + 1, who: ['yuha'], where: i % 2 && stream ? `at the stream (${stream})` : 'forest', action: `Yuha carries the pumpkin, page ${i + 1}.`, emotion: 'happy', timeOfDay: 'day', props: ['pumpkin'], shot: 'middle', space: 'full', carrier: 'both', focus: 'pumpkin', backdrop: 'scene', pocket: 'bottom', hidden: '', holdBack: ''}))});
  }};
  const draft = {title: '호박 길', language: 'dual', pages: Array.from({length: 12}, (_, i) => ({pageNo: i + 1, ko: `${i + 1}쪽이에요. 유하가 호박을 들고 가요.`, en: `Page ${i + 1}. Yuha carries the pumpkin.`}))};
  const ops = {
    preflight: async () => {},
    plan: async () => { throw Error('selection mode never plans'); },
    characterSheet: async (s, c) => ({imageAssetId: 'image-' + c.id, imageUrl: image, seed: 1, meta: {quality: 'final', requestedSeed: 1, costUsdEstimated: 0}}),
    backgroundSheet: async (s, b) => { bought.push(b.id); return {imageAssetId: 'image-' + b.id, imageUrl: image, seed: 1, meta: {quality: 'final', requestedSeed: 1, costUsdEstimated: 0}}; },
    outline: async (input) => ({data: {...demoOutline(input), writersRoom: {kind: 'writersRoom', version: 1, chosen: 1, premise: PREMISE, pitches: [{title: '호박 길'}], premises: [PREMISE]}}, usage: {input: 1, output: 1}, meta: {stage: 'outline', requests: 1, model: 'mock'}}),
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

test('R57 FULL AUTO (full run): the chosen premise\'s new place gets a drawer card, joins the plan, the wizard and the job input, gets a place sheet, and the pages name it by ID', async () => {
  const bought = [], calls = [];
  const {state, job} = await run('pages', bought, calls);
  assert.ok(job.failure == null, job.failure?.message || '');
  assert.equal(job.roomPlaces?.length, 1, 'the place without a look gets no card');
  const id = job.roomPlaces[0].id;
  assert.match(id, /^background-/);
  const card = state.backgrounds.find((b) => b.id === id);
  assert.deepEqual([card.name, card.type, card.source, card.autoRunId], ['개울가', 'stream', 'writers-room', job.id]);
  assert.ok(job.plan.backgroundIds.includes(id) && job.plan.newBackgrounds.some((b) => b.id === id) && job.plan.materialSignatures[id]);
  assert.ok(job.wizard.backgroundIds.includes(id));
  assert.ok(job.input.backgrounds.some((b) => b.id === id) && job.input.preferredBackgroundIds.includes(id), 'the job input carries the place (the brief\'s chosen places, the reading\'s IDs)');
  assert.ok(bought.includes(id), 'its place sheet is bought');
  assert.ok(card.imageAssetId, 'and stored on the card');
  assert.match(W.roomBrief(job.input), /\[고른 장소\][^\n]*개울가/);
  assert.match(calls[0].system, new RegExp(`${id} = 개울가`), 'the reading lists it by ID');
  assert.ok(job.pagination.pages.some((p) => p.scene.where === id), 'pages at the stream carry its ID — the pictures get its place reference');
  assert.ok(job.book.backgroundIds.includes(id));
  assert.equal(job.notes.filter((n) => /장소 상한/.test(n)).length, 0);
});

test('R57 FULL AUTO (text hold): the place card is made but no sheet is bought until the hold is released', async () => {
  const bought = [], calls = [];
  const {state, job} = await run('text', bought, calls);
  assert.ok(job.failure == null, job.failure?.message || '');
  assert.equal(job.roomPlaces?.length, 1);
  assert.ok(state.backgrounds.some((b) => b.id === job.roomPlaces[0].id));
  assert.deepEqual(bought, [], 'a text hold buys no sheet');
});

test('R57 the estimate: the wider premise answer is priced; a staged job frozen before R57 is priced as it was', () => {
  const base = {settings: {engine: 'openai'}, pageCount: 16, diet: true, editor: true, room: true};
  const total = (est) => est.stages.reduce((n, s) => n + (Number(s.costUsd) || 0), 0), requests = (est) => est.stages.reduce((n, s) => n + s.requestCount, 0);
  const wide = estimateStoryTextCost(base), staged = estimateStoryTextCost({...base, roomWide: false});
  assert.equal(requests(wide), requests(staged), 'no new call');
  assert.ok(Math.abs(total(staged) - 1.704) < 0.01 && Math.abs(total(wide) - 1.788) < 0.01, `${total(staged).toFixed(3)} ${total(wide).toFixed(3)}`);
});
