// R62: a book a child can follow from the words alone, and pictures grounded in the words.
// The parent's '빵 냄새는 등 뒤에서' (v66): the village's rule was never said, a humming grandma and the dinosaur
// appeared in pictures the words never mention, the arrow sign changed from page to page, the "new kid" on the last
// page was never drawn, and walking backwards came out as a forward walk with the head turned.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../dist/story-generation/writers-room.js';
import * as S from '../dist/image-generation/scene-prompt.js';
import { seedState } from '../dist/engine.js';
import { migrateWorldState } from '../dist/image-generation/world.js';
import { migrateReadingSettings } from '../dist/reading-ui.js';
import { inputFromWizard } from '../dist/story-generation/ui.js';
import { normalizeStoryInput } from '../dist/story-generation/pipeline.js';
import { estimateStoryTextCost, jobTextBudget } from '../dist/text-generation/models.js';

globalThis.fetch = async () => { throw Error('no network in tests'); };
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizard = {characterIds: ['yuha', 'mom', 'greenie', 'toto'], backgroundIds: ['home', 'forest'], topic: '빵 냄새를 따라가는 날', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', language: 'bilingual', value: 'none', ending: 'home', simpleFlow: true};
const input = normalizeStoryInput({...inputFromWizard(setup(), wizard, {layout: 'openings'}).input, bookId: 'r62'});
const premise = {title: '빵 냄새는 등 뒤에서', line: '거꾸로 마을', engine: 'reader_knows', laugh: '엉덩방아', picture: '화살표', cast: [{name: '유하', isNew: false}, {name: '토토', isNew: false}], places: []};
const outline = {...W.roomOutline(input, {premise, pitches: []}), writersRoom: {kind: 'writersRoom', version: 1, chosen: 1, premise, pitches: [], premises: [premise]}};
const reply = (json) => ({json, usage: {input: 1, output: 1}, meta: {requests: 1, model: 'mock'}});

test('R62 the marker: a new room draft is weave 7 (clear, still kept); normalize keeps 1–7', () => {
  assert.deepEqual(input.writersRoom, {version: 1, weave: 7});
  assert.equal(W.hasRoomClear(input), true);
  assert.equal(W.hasRoomKept(input), true);
  assert.equal(W.hasRoomClear({...input, writersRoom: {version: 1, weave: 6}}), false);
  assert.deepEqual(normalizeStoryInput({...input, writersRoom: {version: 1, weave: 6}}).writersRoom, {version: 1, weave: 6});
});

test('R62 the listener: the words alone — the rule never said, a stranger, a lost page become notes and pages in scope', () => {
  const req = W.listenRequest(input, {title: 't', pages: [{ko: '유하가 뛰어요.', art: 'a goose waddles backwards'}]});
  assert.match(req.system, /그림을 볼 수 없는/);
  assert.doesNotMatch(req.user, /goose/, 'the listener never hears the art notes');
  const listen = W.settleListen({strange: true, rule: '', want: '빵을 먹고 싶어요', who: [{name: '할머니', page: 7, introduced: false}, {name: '토토', page: 5, introduced: true}], lost: [{page: 7, question: '콧노래는 누가 불렀어요?'}, {page: 99, question: 'x'}]}, 16);
  assert.equal(listen.lost.length, 1, 'only real pages');
  assert.equal(W.listenNeedsWork(listen), true);
  const notes = W.listenNotes(listen);
  assert.match(notes, /신기한 일이 왜·어떻게 일어나는지 알 수 없어요/);
  assert.match(notes, /할머니\(7쪽\)/);
  assert.match(notes, /7쪽 — 콧노래는 누가 불렀어요\?/);
  assert.deepEqual(W.rewriteScope({laughPages: [8]}, null, 16, listen).pages, [1, 2, 3, 6, 7], 'the opening for the rule, page 7 and its neighbours, never the laugh page');
  assert.equal(W.listenNeedsWork(W.settleListen({strange: true, rule: '이 마을에선 뒤로 걸어야 앞으로 가요.', want: '', who: [], lost: []}, 16)), false);
  assert.equal(W.settleListen('nonsense', 16), null);
});

test('R62 the room run: the listener hears the chosen draft and starts the rewrite even when the readers asked for nothing', async () => {
  const calls = [];
  const kind = (req) => {
    const p = req.jsonSchema?.properties || {}, items = p.pages?.items?.properties || {};
    if (p.strange) return 'listen';
    if (p.ties) return 'cast';
    if (p.flow) return 'flow';
    if (p.kept) return 'threads';
    if (p.readers) return p.readers.items.properties.second ? 'flowPick' : 'read';
    if (items.en && !items.ko) return 'english';
    return req.user.includes('[독자 반응]') ? 'rewrite' : 'draft';
  };
  const pages = Array.from({length: 8}, (_, i) => ({ko: `유하가 ${i + 1}번 뛰어요.`}));
  let rewriteUser = '';
  const engine = {id: 'openai', async complete(req) {
    const k = kind(req);
    calls.push(k);
    if (k === 'listen') return reply({strange: true, rule: '', want: '빵', who: [{name: '할머니', page: 4, introduced: false}], lost: []});
    if (k === 'cast') return reply({notes: [], ties: [], looks: [], placeLooks: []});
    if (k === 'flow') return reply({flow: '길', plants: []});
    if (k === 'flowPick') return reply({readers: W.PANEL_IDS.map((reader) => ({reader, favorite: 1, second: 0, why: '', lost: []}))});
    if (k === 'read') return reply({readers: W.PANEL_IDS.map((reader) => ({reader, favorite: 1, again: true, drafts: [{draft: 1, skipPage: 0, lostPage: 0, laughPages: [], change: '', changePage: 0, hardPage: 0, mannersPage: 0}]}))});
    if (k === 'english') return reply({pages: pages.map((_, i) => ({pageNo: i + 1, en: `Yuha runs ${i + 1}.`}))});
    if (k === 'rewrite') {
      rewriteUser = req.user;
      const d = structuredClone(pages);
      d[3].ko = '부엉이 할머니가 뒤로 뒤뚱 걸어와요.';
      d[0].ko = '이 마을에선 앞으로 가면 멀어져요.';
      return reply({title: 't', pages: d});
    }
    return reply({title: 't', pages});
  }};
  const r = await W.runRoomDrafts({...input, bookId: 'r62-run'}, outline, {engine, engineId: 'openai', roomFlowCount: 1, roomPolish: false}, {engineFor: () => engine});
  assert.ok(calls.includes('listen'), calls.join(','));
  assert.ok(calls.indexOf('listen') < calls.indexOf('rewrite'), 'the listener comes before the rewrite');
  assert.match(rewriteUser, /누구인지 모른 채 나오는 인물: 할머니\(4쪽\)/);
  assert.equal(r.data.room.rewritten, true);
  assert.equal(r.data.pages[3].ko, '부엉이 할머니가 뒤로 뒤뚱 걸어와요.', 'page 4 is in scope');
  assert.equal(r.data.pages[0].ko, '이 마을에선 앞으로 가면 멀어져요.', 'the opening is in scope (the rule was never said)');
  assert.ok(r.data.room.listen, 'recorded');
  // A weave 6 draft has no listener (and the readers asked for nothing: no rewrite).
  calls.length = 0;
  await W.runRoomDrafts({...input, bookId: 'r62-run6', writersRoom: {version: 1, weave: 6}}, outline, {engine, engineId: 'openai', roomFlowCount: 1, roomPolish: false}, {engineFor: () => engine});
  assert.equal(calls.includes('listen'), false);
  assert.equal(calls.includes('rewrite'), false);
});

test('R62/R63 the reading: who is grounded in the words (page ±1); things, walk-ons (extras) and recurring places (stages) keep one look/map; mustSee and a side-view pose per page', () => {
  const req = W.extractRequest(input, outline, [{ko: '유하가 뛰어요.'}]);
  const props = req.jsonSchema.properties, page = props.pages.items.properties;
  assert.ok(props.things && props.extras && props.stages, 'book-level things, extras, stages');
  assert.deepEqual(['mustSee', 'pose', 'extras', 'stage'].filter((k) => !page[k]), []);
  assert.ok(['mustSee', 'pose', 'extras', 'stage'].every((k) => props.pages.items.required.includes(k)), 'required, not optional');
  assert.ok(req.jsonSchema.required.includes('extras') && req.jsonSchema.required.includes('stages'));
  assert.equal(page.who.minItems, 0, 'an empty picture can say so');
  assert.ok(req.system.indexOf('MOST IMPORTANT') < req.system.indexOf('[cast]'), 'the clear instructions come before the data');
  assert.match(req.system, /seen FROM THE SIDE/);
  assert.doesNotMatch(req.system, /toward the bakery/, 'no book-specific example');
  const old = W.extractRequest({...input, writersRoom: {version: 1, weave: 6}}, outline, [{ko: '유하가 뛰어요.'}]);
  assert.equal(old.jsonSchema.properties.things, undefined, 'weave 6 unchanged');
  const pages = [
    {ko: '유하가 화살표 밑에 섰어요.', en: 'Yuha is under the arrow.'},
    {ko: '하나, 둘, 셋!', en: 'One, two, three!'},
    {ko: '토토가 손가락을 접어요.', en: 'Toto counts.'},
    {ko: '새로 온 아이가 화살표 밑에 와요.', en: 'A new kid is under the arrow.'},
  ];
  const r = W.settleExtraction({
    things: [{name: 'the arrow sign', look: 'one rectangular pale-wood board, one thick red arrow pointing straight down', pages: [1, 4, 77]}, {name: 'once', look: 'x', pages: [2]}],
    extras: [{name: 'new girl', look: 'a girl smaller than Yuha, red cap, blue overalls'}, {name: 'ghost', look: ''}],
    stages: [{name: 'village gate', map: 'the old oak with the sign at the LEFT; the road runs left to right; the bakery at the RIGHT end'}],
    pages: [
      {pageNo: 1, who: ['yuha', 'greenie'], where: 'village gate', action: 'Yuha stands under the sign.', emotion: 'happy', timeOfDay: 'day', props: [], mustSee: ['Yuha under the arrow sign', 'the bakery far away'], pose: '', extras: [], stage: 'village gate'},
      {pageNo: 2, who: ['yuha', 'toto'], where: 'village gate', action: 'Yuha runs.', emotion: 'happy', timeOfDay: 'day', props: [], mustSee: ['Yuha running'], pose: 'seen from the side: faces LEFT, moves RIGHT', extras: [], stage: 'village gate'},
      {pageNo: 3, who: ['toto', 'greenie'], where: 'home', action: 'Toto counts.', emotion: 'calm', timeOfDay: 'day', props: [], mustSee: ['Toto counting'], pose: '', extras: [], stage: 'village gate'},
      {pageNo: 4, who: ['yuha'], where: 'village gate', action: 'A new kid arrives.', emotion: 'calm', timeOfDay: 'day', props: [], mustSee: ['the new girl under the sign'], pose: '', extras: ['New Girl', 'nobody'], stage: 'nowhere'},
    ],
  }, input, outline, pages, 't');
  assert.deepEqual(r.pages[0].scene.who, ['yuha'], 'the dinosaur is named nowhere near page 1');
  assert.deepEqual(r.pages[1].scene.who, ['yuha', 'toto'], 'Toto is named on the next page');
  assert.deepEqual(r.pages[2].scene.who, ['toto'], 'the hero is never added, the dinosaur dropped');
  assert.equal(r.pages[0].scene.things[0].name, 'the arrow sign');
  assert.equal(r.pages[1].scene.things[0].name, 'the arrow sign', 'R63: a stage page whose map names the thing carries its look too');
  assert.equal(r.pages[2].scene.things, undefined, 'a supplied place without the thing');
  assert.deepEqual(r.pages[0].scene.mustSee, ['Yuha under the arrow sign', 'the bakery far away']);
  assert.equal(r.pages[1].scene.pose, 'seen from the side: faces LEFT, moves RIGHT');
  assert.deepEqual(r.pages[3].scene.extras, [{name: 'new girl', look: 'a girl smaller than Yuha, red cap, blue overalls'}], 'the book-level look, by name');
  assert.deepEqual(r.pages[0].scene.stage, {name: 'village gate', map: 'the old oak with the sign at the LEFT; the road runs left to right; the bakery at the RIGHT end'});
  assert.equal(r.pages[2].scene.stage, undefined, 'a supplied place is not a stage');
  assert.equal(r.pages[3].scene.stage, undefined, 'an unknown stage name is dropped');
  const six = W.settleExtraction({pages: [{pageNo: 1, who: ['yuha', 'greenie'], where: 'gate', action: 'x', emotion: 'happy', timeOfDay: 'day', props: []}]}, {...input, writersRoom: {version: 1, weave: 6}}, outline, pages.slice(0, 1), 't');
  assert.deepEqual(six.pages[0].scene.who, ['yuha', 'greenie'], 'weave 6 keeps the reading as it was');
});

test('R63 the picture request of a clear book leads with what the page must show and who is in it; no line below contradicts it; a stage keeps its map and never falls back to the beat\'s place', async () => {
  const {pagePlace} = await import('../dist/image-generation/scene-continuity.js');
  const sheet = {characterId: 'yuha', characterSnapshot: {id: 'yuha', name: '유하', nameEn: 'Yuha'}, confirmedAt: 'now', imageUrl: 'x'};
  const stage = {name: 'village gate', map: 'the old oak with the sign at the LEFT; the bakery at the RIGHT end'};
  const ask = (scene, extra = {}) => {
    const book = {storyInput: input, outline, characterIds: ['yuha'], pages: [{ko: '새로 온 아이가 화살표 밑에 와요.', en: 'A new kid is under the arrow.', scene: {who: ['yuha'], where: 'village gate', action: 'A new girl arrives under the sign.', emotion: 'calm', timeOfDay: 'day', props: [], ...scene}, staging: {shot: 'wide'}, ...extra}]};
    return S.buildScenePrompt({book, page: book.pages[0], pageIndex: 0, snapshot: {characterSheets: [sheet], backgrounds: []}, place: pagePlace(book, {backgrounds: []}, 0), sheets: [sheet], earlierPages: [{scene: {action: 'Yuha waits with one leg up.'}}]});
  };
  const p = ask({mustSee: ['the new girl under the arrow sign', 'Yuha turned away, one leg up'], extras: [{name: 'new girl', look: 'a girl smaller than Yuha, red cap, blue overalls'}], things: [{name: 'the arrow sign', look: 'one pale-wood board, a red arrow pointing down'}], stage, pose: 'seen from the side: faces LEFT, moves RIGHT'});
  assert.match(p, /^THIS PAGE MUST SHOW \(draw exactly\): 1\) the new girl under the arrow sign\. 2\) Yuha turned away, one leg up\. POSE — seen from the side: faces LEFT, moves RIGHT\. Do not turn only the head\. Everyone in this picture: Yuha, new girl\. No other people or animals\. new girl: a girl smaller than Yuha, red cap, blue overalls — the same look on every page, clearly not any cast member\. If any line below disagrees with THIS PAGE MUST SHOW or POSE, follow THIS PAGE MUST SHOW and POSE\./);
  assert.match(p, /Anyone a reference image shows who is not in "Everyone in this picture" is not drawn here\./);
  assert.doesNotMatch(p, /take priority/);
  assert.doesNotMatch(p, /Show only selected characters|never add a new speaking character|ARCHITECTURE LOCK|유하네 집|Earlier pages:/);
  assert.match(p, /Location: village gate\. STAGE MAP \(the same place on every page here\): the old oak with the sign at the LEFT; the bakery at the RIGHT end\. Keep these positions relative to each other; the camera may show only part of the place\. An earlier picture of this place, when attached as the CANONICAL first scene, fixes its layout/);
  assert.match(p, /Just before this page: Yuha waits with one leg up\./);
  assert.match(p, /THE SAME THING ON EVERY PAGE/);
  assert.doesNotMatch(p, /wide establishing/i, 'a pose page is not a far wide shot');
  const free = ask({mustSee: ['Yuha at the road']});
  assert.match(free, /Location: village gate \(draw it from these words; the same way wherever it recurs\)\./);
  // A weave 6 book: no lead line, the old request.
  const six = (() => {
    const book = {storyInput: {...input, writersRoom: {version: 1, weave: 6}}, outline, characterIds: ['yuha'], pages: [{ko: 'x', en: 'x', scene: {who: ['yuha'], where: 'home', action: 'x', emotion: 'calm', timeOfDay: 'day', props: [], mustSee: ['x']}}]};
    return S.buildScenePrompt({book, page: book.pages[0], pageIndex: 0, snapshot: {characterSheets: [sheet], backgrounds: []}, place: {}, sheets: [sheet]});
  })();
  assert.doesNotMatch(six, /THIS PAGE MUST SHOW/);
});

test('R63 the art director corrects the picture fields only: a shifted action, a missing counter (named in the words), a missing pose; never a name the words do not have', () => {
  const pages = [
    {textKo: '토토가 손가락을 접으며 셌어요. "하나… 두울…"', textEn: 'Toto counts.', scene: {who: ['yuha'], action: 'Yuha bites a bun.', mustSee: ['a bun']}},
    {textKo: '유하도 뒤로 휙 돌아 뛰었어요.', textEn: 'Yuha runs backwards.', scene: {who: ['yuha'], action: 'Yuha runs.', mustSee: ['Yuha']}, backdrop: 'plain'},
  ];
  const req = W.directorRequest(input, pages);
  assert.match(req.user, /1쪽: 토토가 손가락을/);
  assert.match(req.system, /never the words/);
  const r = W.applyDirector(pages, {fixes: [
    {page: 1, action: 'Toto folds her fingers counting while Yuha dashes off.', mustSee: ['Toto counting on her fingers'], pose: '', addWho: ['토토', '초록이'], scene: false, why: 'the action was the bun page'},
    {page: 2, action: '', mustSee: [], pose: 'seen from the side: faces LEFT, moves RIGHT', addWho: [], scene: true, why: 'pose'},
  ], notes: ['마을의 규칙이 글에 없어요.']}, input);
  assert.equal(pages[0].scene.action, 'Toto folds her fingers counting while Yuha dashes off.');
  assert.deepEqual(pages[0].scene.who, ['yuha', 'toto'], 'Toto is named in the words; Greenie is not');
  assert.ok(r.refused.some((x) => /초록이/.test(x)));
  assert.equal(pages[1].scene.pose, 'seen from the side: faces LEFT, moves RIGHT');
  assert.equal(pages[1].backdrop, undefined, 'a pose page is drawn at its place');
  assert.equal(pages[0].textKo, '토토가 손가락을 접으며 셌어요. "하나… 두울…"', 'the words are never touched');
  assert.deepEqual(r.notes, ['마을의 규칙이 글에 없어요.']);
  assert.deepEqual(W.applyDirector(pages, null, input).fixed, [], 'an unreadable answer changes nothing');
});

test('R62 the estimate: one listener row (economy) for a new room book; a weave 6 job keeps its room rows (the R61 job estimate counted weaves 1–5 only)', () => {
  const base = {pageCount: 16, diet: true, editor: true, room: true, settings: {engine: 'openai'}};
  const now = estimateStoryTextCost(base), six = estimateStoryTextCost({...base, roomClear: false});
  assert.ok(now.stages.some((s) => s.stage === 'roomListen' && s.requestCount === 1));
  assert.equal(six.stages.some((s) => s.stage === 'roomListen'), false);
  const total = (est) => est.stages.reduce((n, s) => n + (Number(s.costUsd) || 0), 0);
  const row = (est, stage) => est.stages.find((s) => s.stage === stage);
  assert.ok(Number(row(now, 'roomListen').costUsd) < 0.01, 'the listener costs under a cent');
  assert.ok(row(now, 'roomPageEdit') && row(now, 'roomPageEdit').requestCount === 1, 'R63: one page editor call (the writer)');
  assert.ok(row(now, 'roomDirector') && row(now, 'roomDirector').requestCount === 1, 'R63: one art director call (the middle model)');
  assert.ok(Math.abs(total(now) - total(six) - ['roomListen', 'roomPageEdit', 'roomDirector'].reduce((n, k) => n + Number(row(now, k).costUsd), 0)) < 1e-9, 'the three rows are the whole difference');
  const s = setup();
  const stagesOf = (weave) => jobTextBudget({input: {...input, writersRoom: {version: 1, weave}}, wizard: {pageCount: 16}, usage: {calls: []}, completed: {}, textSettings: s.settings.textGeneration}).stages.map((x) => x.stage);
  assert.ok(stagesOf(6).includes('roomCastNotes') && stagesOf(6).includes('roomThreads'), 'a weave 6 job keeps its staged rows');
  assert.equal(stagesOf(6).includes('roomListen'), false);
  assert.ok(stagesOf(7).includes('roomListen'));
});

test('R63 the page editor: a boundary moves by one sentence within the cap, a small fix is taken, a big one, a laughed page and a spread are refused, a continuity note joins the art', () => {
  const pages = [
    {ko: '토토가 물었어요. "어디 가?"'},
    {ko: '"빵집!" 유하가 대답했어요. 둘이 걸었어요.'},
    {ko: '하나, 둘, 셋! 빵집이 멀어졌어요.', art: 'the bakery shrinks'},
    {ko: '쿵! 엉덩방아를 찧었어요.'},
    {ko: '큰 그림이에요.', spread: true},
  ];
  const raw = {
    moves: [{after: 1, shift: 1}, {after: 4, shift: 1}, {after: 9, shift: 1}],
    fixes: [
      {page: 3, ko: '유하가 화살표 밑에서 뛰었어요. 하나, 둘, 셋! 빵집이 멀어졌어요.', why: '누가 뛰는지 없었어요'},
      {page: 4, ko: '완전히 다른 이야기예요. 외계인이 왔어요. 화성에 갔어요.', why: 'x'},
    ],
    art: [{page: 3, note: 'same village gate as page 2; Toto still beside Yuha'}, {page: 99, note: 'x'}],
  };
  const r = W.applyPageEdit(pages, raw, {cap: 5, guarded: []});
  assert.equal(r.pages[0].ko, '토토가 물었어요. "어디 가?" "빵집!"', 'the answer joins its question');
  assert.equal(r.pages[1].ko, '유하가 대답했어요. 둘이 걸었어요.');
  assert.deepEqual(r.applied.moves, [{after: 1, shift: 1}]);
  assert.ok(r.refused.some((x) => /큰 그림/.test(x)), 'never across a spread');
  assert.equal(r.pages[2].ko, '유하가 화살표 밑에서 뛰었어요. 하나, 둘, 셋! 빵집이 멀어졌어요.');
  assert.equal(r.pages[3].ko, '쿵! 엉덩방아를 찧었어요.', 'a rewrite of the page is refused');
  assert.equal(r.pages[2].art, 'the bakery shrinks / same village gate as page 2; Toto still beside Yuha');
  assert.equal(r.applied.art, 1);
  const guarded = W.applyPageEdit(pages, {moves: [], fixes: [raw.fixes[0]], art: []}, {cap: 5, guarded: ['하나, 둘, 셋! 빵집이 멀어졌어요.']});
  assert.equal(guarded.pages[2].ko, pages[2].ko, 'a page the readers laughed at keeps its words');
  assert.deepEqual(W.applyPageEdit(pages, null).pages, pages, 'an unreadable answer changes nothing');
  const req = W.pageEditRequest(input, pages, [{name: '토토', who: '친구'}]);
  assert.match(req.system, /한 쪽을 듣고 쪽을 넘겨요/);
  assert.match(req.user, /5쪽 \(큰 그림\): 큰 그림이에요\./);
  assert.match(req.user, /\[인물\]\n토토 — 친구/);
});

test('R63 the room run: binding, then the editor (the writer\'s model), then the English; a weave 6 draft has no editor', async () => {
  const order = [];
  const kind = (req) => {
    const p = req.jsonSchema?.properties || {}, items = p.pages?.items?.properties || {};
    if (p.moves) return 'pageEdit';
    if (p.strange) return 'listen';
    if (p.ties) return 'cast';
    if (p.flow) return 'flow';
    if (p.kept) return 'threads';
    if (p.readers) return p.readers.items.properties.second ? 'flowPick' : 'read';
    if (items.en && !items.ko) return 'english';
    return req.user.includes('[독자 반응]') ? 'rewrite' : 'draft';
  };
  const pages = Array.from({length: 8}, (_, i) => ({ko: `유하가 ${i + 1}번 뛰어요.`}));
  const engine = {id: 'openai', async complete(req) {
    const k = kind(req);
    order.push(k);
    if (k === 'pageEdit') return reply({moves: [], fixes: [{page: 2, ko: '유하가 화살표 밑에서 2번 뛰어요.', why: '어디인지'}], art: [{page: 2, note: 'still at the village gate'}]});
    if (k === 'listen') return reply({strange: false, rule: '', want: '빵', who: [], lost: []});
    if (k === 'cast') return reply({notes: [], ties: [], looks: [], placeLooks: []});
    if (k === 'flow') return reply({flow: '길', plants: []});
    if (k === 'flowPick') return reply({readers: W.PANEL_IDS.map((reader) => ({reader, favorite: 1, second: 0, why: '', lost: []}))});
    if (k === 'read') return reply({readers: W.PANEL_IDS.map((reader) => ({reader, favorite: 1, again: true, drafts: [{draft: 1, skipPage: 0, lostPage: 0, laughPages: [], change: '', changePage: 0, hardPage: 0, mannersPage: 0}]}))});
    if (k === 'english') return reply({pages: Array.from({length: req.jsonSchema.properties.pages.minItems}, (_, i) => ({pageNo: i + 1, en: `Yuha runs ${i + 1}.`}))});
    return reply({title: 't', pages});
  }};
  const r = await W.runRoomDrafts({...input, bookId: 'r63-run'}, outline, {engine, engineId: 'openai', roomFlowCount: 1, roomPolish: false}, {engineFor: () => engine});
  assert.ok(order.indexOf('pageEdit') > 0 && order.indexOf('pageEdit') < order.indexOf('english'), order.join(','));
  const at = r.data.pages.findIndex((p) => p.ko === '유하가 화살표 밑에서 2번 뛰어요.');
  assert.ok(at >= 0, 'the fix is in the book');
  assert.match(r.data.pages[at].art || '', /still at the village gate/);
  assert.deepEqual(r.data.room.pageEdit.fixes, [{page: 2, why: '어디인지'}]);
  order.length = 0;
  await W.runRoomDrafts({...input, bookId: 'r63-run6', writersRoom: {version: 1, weave: 6}}, outline, {engine, engineId: 'openai', roomFlowCount: 1, roomPolish: false}, {engineFor: () => engine});
  assert.equal(order.includes('pageEdit'), false);
});
