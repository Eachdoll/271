import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {seedState} from '../dist/engine.js';
import {migrateWorldState, createCharacterSheetRequest} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {normalizeStoryInput} from '../dist/story-generation/pipeline.js';
import {demoOutline} from '../dist/story-generation/demo.js';
import {renderPremiseChoiceForm} from '../dist/story-generation/council-room.js';
import {estimateStoryTextCost} from '../dist/text-generation/models.js';
import {createFullAutoJob, runFullAuto, deleteFullAutoJob, roomSheetsToReview, acceptRoomSheets, redrawRoomSheet, SHEETS_REVIEW_STATUS} from '../dist/full-auto.js';
import * as W from '../dist/story-generation/writers-room.js';

/*
 * R60 (2026-11-10): what ten reviewers agreed about the cast and the sheets
 * (STORY_CAST_SHEETS_DEBATE_2026-11-10.md) and the parent approved. A new
 * room draft is weave 5: no cast revision, no habit, optional ties, no look in
 * the twelve premises (the chosen premise's new characters and places are
 * looked at once, in the cast notes, as an instruction to the illustrator),
 * sheets bought for the cards the finished pages need, a body-kind sheet
 * template, the parent's look at new sheets before any page is drawn, and the
 * rewrite told where the things the ending uses are first heard.
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizard = {characterIds: ['yuha', 'mom'], backgroundIds: ['home', 'beach'], topic: '숲속에서 자꾸 숨는 아기 사슴', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual'};
const roomInput = (id) => normalizeStoryInput({...inputFromWizard(setup(), wizard, {layout: 'openings'}).input, bookId: id});
const FAWN = {name: '폴짝이', isNew: true, want: '숨고 싶다', flaw: '겁이 많다', speech: '작게 속삭여요', nameEn: 'Hoppy', kind: 'fawn'};
const PREMISE = {title: '숨바꼭질 사슴', line: '숲에서', engine: 'reader_knows', laugh: '사슴이 유하 뒤에 숨어요', picture: '큰 귀만 보이는 덤불', cast: [{name: '유하', isNew: false, want: '찾고 싶다', flaw: '', speech: '', nameEn: '', kind: ''}, {name: '엄마', isNew: false, want: '', flaw: '', speech: '', nameEn: '', kind: ''}, FAWN],
  places: [{name: '집', isNew: false, nameEn: '', type: ''}, {name: '개울가', isNew: true, nameEn: 'Brookside', type: 'river'}]};
const LOOKS = {looks: [{name: '폴짝이', build: 'four-legged', look: 'a fawn half Yuha\'s height, caramel coat with cream spots on the back, one white ear tip seen front and back, wears nothing'}, {name: '유하', build: 'human', look: 'not a new character'}], placeLooks: [{name: '개울가', look: 'green moss and a blue brook, a flat grey stepping stone', layout: 'left: tall reeds; right: a fallen log; far: a small wooden bridge'}]};

test('R60 the marker and the premises: a new room draft is weave 5; the twelve premises carry no look; the card says "at most"', () => {
  const input = roomInput('p1');
  assert.deepEqual(input.writersRoom, {version: 1, weave: 6});
  assert.equal(W.hasRoomCounted(input) && W.hasRoomLean(input) && W.hasRoomWide(input) && W.hasRoomStages(input), true);
  const req = W.premisesRequest(input);
  const items = req.jsonSchema.properties.premises.items.properties;
  assert.deepEqual(items.cast.items.required, ['name', 'isNew', 'want', 'flaw', 'speech', 'nameEn', 'kind']);
  assert.deepEqual(items.places.items.required, ['name', 'isNew', 'nameEn', 'type']);
  assert.doesNotMatch(req.system, /look\(/, 'no look is asked of the twelve');
  const old = W.premisesRequest({...input, writersRoom: {version: 1, weave: 4}});
  assert.ok(old.jsonSchema.properties.premises.items.properties.cast.items.required.includes('look'), 'a weave 4 job keeps its request');
  const scale = W.premiseScale(PREMISE, {counted: true});
  assert.equal(scale.sheets, 2, 'every new character and place may get a sheet');
  assert.equal(W.premiseScale(PREMISE).sheets, 0, 'the R57 count needed a look');
  const form = renderPremiseChoiceForm({kind: 'writersRoom', version: 1, recommended: 1, pitches: [{title: 't', logline: 'l', scale}]}, {sheetUsd: 0.17});
  assert.match(form, /새 시트 최대 2장 · 그림 요금 최대 \+\$0\.34 \(두 쪽 이상 나오는 인물·장소만\)/);
});

test('R60 the cast notes: no habit, today no longer "unrelated to the hero", ties optional and three at most; the looks of the new characters and places are asked here, once', () => {
  const input = roomInput('p2');
  const req = W.castNotesRequest(input, PREMISE);
  const props = req.jsonSchema.properties;
  assert.deepEqual(props.notes.items.required, ['name', 'today', 'unsaid']);
  assert.equal('habit' in props.notes.items.properties, false);
  assert.equal(props.ties.maxItems, 3);
  assert.deepEqual(req.jsonSchema.required, ['notes', 'ties', 'looks', 'placeLooks']);
  assert.deepEqual(props.looks.items.properties.build.enum, ['human', 'four-legged', 'upright-animal', 'bird', 'object', 'other']);
  assert.doesNotMatch(req.system, /상관없이|habit|버릇/);
  assert.match(req.system, /없어도 되고 셋까지/);
  assert.match(req.system, /폴짝이\)은 그림 시트를 그릴 화가에게/);
  assert.match(req.system, /개울가\)도 화가에게 적어 줘요/);
  assert.match(req.user, /\[새 장소\]\n- 개울가 \(river\)/);
  const settled = W.settleRoomLooks(LOOKS, PREMISE);
  assert.deepEqual(settled.cast.map((l) => [l.name, l.build]), [['폴짝이', 'four-legged']], 'a parent\'s character gets no look');
  assert.equal(settled.places[0].layout, 'left: tall reeds; right: a fallen log; far: a small wooden bridge');
  assert.deepEqual(W.settleRoomLooks(null, PREMISE), {cast: [], places: []});
  const old = W.castNotesRequest({...input, writersRoom: {version: 1, weave: 4}}, PREMISE);
  assert.ok(old.jsonSchema.properties.notes.items.required.includes('habit'), 'a weave 4 job keeps its request');
});

test('R60 the room run: no cast revision; the looks ride on the record; the rewrite is told where the things the ending uses are first heard', async () => {
  const input = roomInput('p3');
  const outline = {...W.roomOutline(input, {premise: PREMISE, pitches: []}), writersRoom: {kind: 'writersRoom', version: 1, chosen: 1, premise: PREMISE, pitches: [], premises: [PREMISE]}};
  const reply = (json) => ({json, usage: {input: 10, output: 5}, meta: {requests: 1, model: 'mock'}});
  const calls = [];
  const kind = (req) => {
    const props = req.jsonSchema?.properties || {}, items = props.pages?.items?.properties || {};
    if (props.ties) return 'cast';
    if (props.notes) return 'castRevise';
    if (props.flow) return 'flow';
    if (props.kept) return 'threads';
    if (props.readers) return props.readers.items.properties.second ? 'flowPick' : 'read';
    if (items.en && !items.ko) return 'english';
    return /\[독자 반응\]/.test(req.user) ? 'rewrite' : 'draft';
  };
  const engine = {id: 'openai', async complete(req) {
    const k = kind(req);
    calls.push({k, req});
    if (k === 'cast') return reply({notes: [{name: '폴짝이', today: '도토리를 모은다', unsaid: '유하를 봤다'}], ties: [], ...LOOKS});
    if (k === 'flow') return reply({flow: '흐름.', plants: [{what: '엄마의 나무 국자', plant: '앞', payoff: '끝'}]});
    if (k === 'flowPick') return reply({readers: ['action', 'laugh', 'heart', 'eye', 'ours', 'parent'].map((reader) => ({reader, favorite: 1, second: 2, why: '궁금', lost: []}))});
    if (k === 'threads') return reply({kept: [], loose: [], unplanted: []});
    if (k === 'read') return reply({readers: ['action', 'laugh', 'heart', 'eye', 'ours', 'parent'].map((reader, i) => ({reader, favorite: 1, again: true, drafts: [{draft: 1, skipPage: i + 1, lostPage: 0, laughPages: [], change: i < 2 ? '3쪽이 길어요' : '', changePage: i < 2 ? 3 : 0, hardPage: 0, mannersPage: 0}]}))});
    if (k === 'english') return reply({pages: Array.from({length: Number(req.jsonSchema.properties.pages.minItems)}, (_, i) => ({en: `Page ${i + 1}.`}))});
    if (k === 'rewrite') return reply({title: '고친 책', pages: Array.from({length: 8}, (_, i) => ({ko: `${i + 1}쪽이에요.`}))});
    return reply({title: '한 권', pages: Array.from({length: 8}, (_, i) => ({ko: i === 7 ? '엄마가 국자를 들어요.' : `${i + 1}쪽이에요. 유하가 걸어요.`, ...(i === 1 ? {art: '엄마가 국자로 웃음을 가려요'} : {})}))});
  }};
  const result = await W.runRoomDrafts(input, outline, {engine, engineId: 'openai', qualityEngines: {prose: engine, cheap: engine}, roomPolish: false}, {engineFor: () => engine});
  assert.equal(calls.some((c) => c.k === 'castRevise'), false, 'no cast revision');
  assert.deepEqual(calls.map((c) => c.k), ['cast', 'flow', 'flow', 'flow', 'flowPick', 'draft', 'read', 'threads', 'rewrite', 'english']);
  assert.deepEqual(result.data.room.looks.cast.map((l) => l.name), ['폴짝이']);
  assert.equal(result.data.room.castRevised, undefined);
  const notes = calls.find((c) => c.k === 'rewrite').req.user;
  assert.match(notes, /끝이 쓰는 것이 글에 처음 들리는 쪽 \(글만 듣는 아이 기준\): 엄마의 나무 국자: 글에는 8쪽에 처음 나와요 — 그 앞은 그림 메모뿐\(2쪽\)/);
  assert.match(calls.find((c) => c.k === 'threads').req.system, /\[그림: …\]에만 있던 것은 글을 듣는 아이에게는 아직 놓이지 않은 것/);
});

test('R60 the first-heard fact on the paid R56 book: the acorns on page 14 and the ladle on page 15, before that only in the art notes', () => {
  const R56 = JSON.parse(readFileSync(new URL('../QA/r56-room-ab/anthropic.json', import.meta.url), 'utf8'));
  const line = W.firstHeardNotes(R56.draft.pages, R56.draft.room.treatments[1].plants.map((p) => p.what), {names: R56.outline.writersRoom.premise.cast.map((c) => c.name)});
  assert.match(line, /도토리 세 알: 글에는 14쪽에 처음 나와요 — 그 앞은 그림 메모뿐\(1쪽\)/);
  assert.match(line, /엄마의 나무 국자: 글에는 15쪽에 처음 나와요 — 그 앞은 그림 메모뿐\(2·10쪽\)/);
  assert.doesNotMatch(line, /장화/, 'the boots are heard on page 1');
  assert.equal(W.firstHeardNotes([{ko: '국자가 있어요.'}, {ko: '가'}, {ko: '나'}, {ko: '다'}, {ko: '라'}, {ko: '국자!'}], ['국자']), '', 'heard early: nothing to say');
});

test('R60 the kit cards and their sheets: no default colours, the look once, a body-kind template; a place sheet of two panels; the sheet choice counts the finished pages', () => {
  const card = W.roomCastRecord(FAWN, {id: 'character-fawn', jobId: 'j', kit: true});
  assert.deepEqual([card.sheetKit, card.build, card.color, card.hairColor, card.skinColor, card.appearance, card.description], [1, 'four-legged', '', '', '', '', 'a fawn']);
  const looked = W.roomCardWithLook(card, W.settleRoomLooks(LOOKS, PREMISE).cast[0]);
  assert.match(looked.description, /^a fawn half Yuha's height/);
  const state = setup();
  state.characters.push(looked);
  const prompt = createCharacterSheetRequest(state, 'character-fawn').prompt;
  assert.match(prompt, /Hoppy, a fawn\. a fawn half Yuha's height.* It is a real animal standing on four legs, with an animal head and muzzle/);
  assert.match(prompt, /two poses \(standing and walking\)/);
  for (const human of [/hairstyle/, /hair color/, /skin color/, /waving/, /#a8bb91/, /clothing color/]) assert.doesNotMatch(prompt, human);
  const old = W.roomCastRecord({...FAWN, look: 'a small fawn'}, {id: 'character-old', jobId: 'j'});
  assert.equal(old.color, '#a8bb91', 'an R54f card keeps its record');
  const place = W.roomCardWithLook(W.roomPlaceRecord(PREMISE.places[1], {id: 'background-brook', jobId: 'j', kit: true}), W.settleRoomLooks(LOOKS, PREMISE).places[0]);
  assert.deepEqual([place.sheetKit, place.description, place.layout], [1, 'green moss and a blue brook, a flat grey stepping stone', 'left: tall reeds; right: a fallen log; far: a small wooden bridge']);
  assert.equal(W.buildOf('robot'), 'object');
  assert.equal(W.buildOf('owl'), 'bird');
  const pages = [
    {scene: {who: ['yuha', 'character-fawn'], where: 'background-brook'}, picturePlan: {shot: 'wide'}},
    {scene: {who: ['yuha', 'character-fawn'], where: 'background-brook'}, picturePlan: {shot: 'close'}},
    {scene: {who: ['yuha', 'character-owl'], where: 'background-brook'}, staging: {shot: 'medium'}},
  ];
  const choice = W.roomSheetChoice(pages, {cast: ['character-fawn', 'character-owl'], places: ['background-brook']});
  assert.deepEqual([choice.cast.keep, choice.cast.drop, choice.places.keep], [['character-fawn'], ['character-owl'], ['background-brook']]);
  assert.deepEqual(choice.places.counts, [{id: 'background-brook', pages: 2}], 'the close picture carries no place sheet and is not counted');
});

/* A FULL AUTO run of a counted room (the R54f harness, weave 5). */
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const run = async (stopBefore, {fawnPages = 99, state = setup(), job = null, weave = null} = {}) => {
  const sheets = [];
  job ||= createFullAutoJob(state, {...wizard, simpleFlow: true}, {allowNew: false, planMode: 'selection', stopBefore});
  // R61: a weave-5 job keeps the R60 behaviour (a one-page character leaves the pages).
  if (weave) job.input.writersRoom = {...job.input.writersRoom, weave};
  job.stopBefore = stopBefore;
  const engine = {id: 'openai', async complete(r) {
    const n = Number(r.jsonSchema.properties.pages.minItems);
    const fawn = (r.system.match(/(character-[0-9a-f-]+) = 폴짝이/) || [])[1];
    return {json: {cover: {title: '숨바꼭질 사슴', sceneAction: 'Yuha alone.'}, pages: Array.from({length: n}, (_, i) => ({pageNo: i + 1, who: fawn && i < fawnPages ? ['yuha', fawn] : ['yuha'], where: 'the forest (beach)', action: `Moment ${i + 1}.`, emotion: 'curious', timeOfDay: 'day', props: ['bush']}))}, usage: {input: 1, output: 1}, meta: {requests: 1}};
  }};
  const draft = {title: '숨바꼭질 사슴', language: 'dual', pages: Array.from({length: 12}, (_, i) => ({pageNo: i + 1, ko: `${i + 1}쪽이에요. 폴짝이가 숨어요.`, en: `Page ${i + 1}.`})), room: {looks: W.settleRoomLooks(LOOKS, PREMISE)}};
  const ops = {
    preflight: async () => {},
    plan: async () => { throw Error('selection mode never plans'); },
    characterSheet: async (s, c) => { sheets.push(c.id); return {imageAssetId: 'image-' + c.id + '-' + sheets.length, imageUrl: image, seed: 1, meta: {quality: 'final', requestedSeed: 1, costUsdEstimated: 0}}; },
    backgroundSheet: async () => { throw Error('no background sheet'); },
    outline: async (input) => ({data: {...demoOutline(input), writersRoom: {kind: 'writersRoom', version: 1, chosen: 1, premise: {...PREMISE, places: []}, pitches: [{title: 't'}], premises: [PREMISE]}}, usage: {input: 1, output: 1}, meta: {stage: 'outline', requests: 1, model: 'mock'}}),
    roomDrafts: async () => ({data: draft, usage: {input: 1, output: 1}, meta: {stage: 'roomDrafts', requests: 1, model: 'mock'}}),
    roomPages: (input, o, d, opts) => W.runRoomPages(input, o, d, {...opts, engine, engineId: 'openai', qualityEngines: {cheap: engine, prose: engine}}, {engineFor: () => engine}),
    briefs: async () => { throw Error('no briefs'); },
    prose: async () => { throw Error('no beat writers'); },
    pagination: async () => { throw Error('no pagination request'); },
    cover: async () => { throw Error('stop here'); },
  };
  await runFullAuto(state, job, {operations: ops, buildBook: (p) => ({id: p.bookId, title: 'x', characterIds: p.wizard.characterIds, backgroundIds: p.wizard.backgroundIds, worldId: p.worldId, storyDraftId: p.id, pages: p.pagination.pages.map((q) => ({...q, ko: q.textKo, en: q.textEn}))}), save: () => true});
  return {state, job, sheets};
};

test('R60 FULL AUTO: the new card gets its look before any sheet; the sheet is bought after the pages; the run parks to show it; "이대로" goes on; a redraw buys one sheet and parks again', async () => {
  const {state, job, sheets} = await run('pages');
  assert.ok(job.failure == null, job.failure?.message || '');
  const id = job.roomCast[0].id, card = state.characters.find((c) => c.id === id);
  assert.match(card.description, /^a fawn half Yuha's height/, 'the cast notes\' look is on the card');
  assert.equal(card.build, 'four-legged');
  assert.equal(job.plan.materialSignatures[id] != null, true);
  assert.deepEqual(sheets, [id], 'its sheet was bought (after the pages)');
  assert.deepEqual(job.roomSheets.cast, [{id, pages: job.pagination.pages.length}]);
  assert.equal(job.status, SHEETS_REVIEW_STATUS, 'parked before any page picture');
  assert.deepEqual(roomSheetsToReview(state, job).map((r) => r.id), [id]);
  // A redraw: the sheet is set aside and one new sheet is bought, then the run parks again.
  redrawRoomSheet(state, job, id);
  const again = await run('pages', {state, job});
  assert.deepEqual(again.sheets, [id]);
  assert.equal(job.status, SHEETS_REVIEW_STATUS);
  // The parent goes on: the card joins the drawer and the run reaches "ready to draw".
  acceptRoomSheets(state, job);
  assert.ok(card.sheetSeenAt);
  const go = await run('pages', {state, job});
  assert.deepEqual(go.sheets, [], 'nothing bought again');
  assert.equal(job.status, 'pages-ready');
});

test('R60 FULL AUTO: a new character on one page only gets no sheet, leaves the cast and the pages, and its card is archived; a text hold buys nothing', async () => {
  const one = await run('pages', {fawnPages: 1, weave: 5});
  assert.ok(one.job.failure == null, one.job.failure?.message || '');
  const id = one.job.roomSheets.cast[0].id, card = one.state.characters.find((c) => c.id === id);
  assert.equal(one.job.roomSheets.cast[0].pages, 1);
  assert.deepEqual(one.sheets, []);
  assert.ok(card.archivedAt, 'the unseen card is archived');
  assert.equal(one.job.plan.characterIds.includes(id), false);
  assert.equal(one.job.pagination.pages.some((p) => p.scene.who.includes(id)), false);
  assert.ok(one.job.notes.some((n) => /한 쪽에만 나와 시트를 사지 않고/.test(n)));
  assert.equal(one.job.status, 'pages-ready', 'no new sheet, nothing to look at');
  const text = await run('text');
  assert.deepEqual(text.sheets, []);
  assert.equal(text.job.status, 'text-review');
  // Deleting the job archives the card the parent never saw.
  const card2 = text.state.characters.find((c) => c.id === text.job.roomCast[0].id);
  assert.equal(card2.archivedAt, undefined);
  deleteFullAutoJob(text.state, text.job.id);
  assert.ok(card2.archivedAt);
});

test('R60 the estimate: no revised cast — 15 → 14 requests, openai $1.508 → $1.424, anthropic $1.114 → $1.056', () => {
  const base = {pageCount: 16, diet: true, editor: true, room: true};
  const total = (est) => est.stages.reduce((n, s) => n + (Number(s.costUsd) || 0), 0), requests = (est) => est.stages.reduce((n, s) => n + s.requestCount, 0);
  const now = estimateStoryTextCost({...base, settings: {engine: 'openai'}}), was = estimateStoryTextCost({...base, settings: {engine: 'openai'}, roomCounted: false});
  assert.deepEqual([requests(was), requests(now)], [15, 14]);
  assert.equal(now.stages.some((s) => s.stage === 'roomCastRevise'), false);
  assert.ok(Math.abs(total(was) - 1.508) < 0.01 && Math.abs(total(now) - 1.424) < 0.01, `${total(was).toFixed(3)} ${total(now).toFixed(3)}`);
  assert.ok(Math.abs(total(estimateStoryTextCost({...base, settings: {engine: 'anthropic'}})) - 1.056) < 0.01);
});

test('R60 the screens: ④ shows the new sheet with "다시 그리기" and "이대로 그림 만들기"; ② leaves out a card whose sheet nobody has seen', async () => {
  const {renderSimpleCreate} = await import('../dist/simple-create.js');
  const ctxFor = (state, wizard, draft = null) => {
    let w = wizard, d = draft, page = 0;
    return {getState: () => state, getWizard: () => w, setWizard: (v) => { w = v; }, getDraft: () => d, setDraft: (v) => { d = v; }, getEditPage: () => page, setEditPage: (v) => { page = v; }, isSimpleView: () => true, isSimpleMode: () => true,
      materialPortrait: (c) => `<svg aria-label="${c.name}"></svg>`, cover: () => '<div class="book-cover"></div>', illustration: () => '<img alt="">'};
  };
  const {state, job} = await run('pages');
  assert.equal(job.status, SHEETS_REVIEW_STATUS);
  const review = renderSimpleCreate(ctxFor(state, {...structuredClone(job.wizard), simpleStep: 4, simpleJobId: job.id}, job.book));
  assert.match(review, /새 인물·장소 시트를 먼저 보여 드려요/);
  assert.match(review, new RegExp(`data-simple-action="sheet-redraw" data-id="${job.roomCast[0].id}"`));
  assert.match(review, /data-simple-action="sheet-accept"/);
  const buttons = [...review.matchAll(/<button\b[^>]*>/g)].map((m) => m[0]).filter((tag) => !/simple-card/.test(tag) && !/data-simple-nav=/.test(tag));
  assert.ok(buttons.length <= 12, `④ buttons ${buttons.length}`);
  const pick = () => renderSimpleCreate(ctxFor(state, {simpleStep: 2, topic: '숲 소풍', characterIds: ['yuha'], backgroundIds: ['home']}));
  assert.doesNotMatch(pick(), /폴짝이/, 'an unseen card is not offered in ②');
  acceptRoomSheets(state, job);
  assert.match(pick(), /폴짝이/, 'once seen it joins the drawer');
});
