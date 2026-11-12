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

test('R62 the reading: who is grounded in the words (page ±1), the things that come back keep one look, walk-ons are kept, the body of an unusual move is asked for', () => {
  const req = W.extractRequest(input, outline, [{ko: '유하가 뛰어요.'}]);
  assert.ok(req.jsonSchema.properties.things, 'things asked');
  assert.ok(req.jsonSchema.properties.pages.items.properties.others, 'others asked');
  assert.equal(req.jsonSchema.properties.pages.items.properties.who.minItems, 0, 'an empty picture can say so');
  assert.match(req.system, /which way the chest and face point and which way the feet step/);
  assert.match(req.system, /the look is repeated word for word/);
  const old = W.extractRequest({...input, writersRoom: {version: 1, weave: 6}}, outline, [{ko: '유하가 뛰어요.'}]);
  assert.equal(old.jsonSchema.properties.things, undefined, 'weave 6 unchanged');
  const pages = [
    {ko: '유하가 화살표 밑에 섰어요.', en: 'Yuha is under the arrow.'},
    {ko: '하나, 둘, 셋!', en: 'One, two, three!'},
    {ko: '토토가 손가락을 접어요.', en: 'Toto counts.'},
    {ko: '새로 온 아이가 화살표 밑에 와요.', en: 'A new kid is under the arrow.'},
  ];
  const r = W.settleExtraction({
    things: [{name: 'the upside-down arrow sign', look: 'a weathered wooden board, arrow pointing down, nailed to the old oak at the village gate', pages: [1, 4, 77]}, {name: 'once', look: 'x', pages: [2]}],
    pages: [
      {pageNo: 1, who: ['yuha', 'greenie'], where: 'gate', action: 'Yuha stands under the sign.', emotion: 'happy', timeOfDay: 'day', props: [], others: ''},
      {pageNo: 2, who: ['yuha', 'toto'], where: 'gate', action: 'Yuha runs.', emotion: 'happy', timeOfDay: 'day', props: [], others: ''},
      {pageNo: 3, who: ['toto', 'greenie'], where: 'gate', action: 'Toto counts.', emotion: 'calm', timeOfDay: 'day', props: [], others: ''},
      {pageNo: 4, who: ['yuha'], where: 'gate', action: 'A new kid arrives.', emotion: 'calm', timeOfDay: 'day', props: [], others: 'a small girl in a red cap with a backpack'},
    ],
  }, input, outline, pages, 't');
  assert.deepEqual(r.pages[0].scene.who, ['yuha'], 'the dinosaur is named nowhere near page 1');
  assert.deepEqual(r.pages[1].scene.who, ['yuha', 'toto'], 'Toto is named on the next page');
  assert.deepEqual(r.pages[2].scene.who, ['toto'], 'the hero is never added, the dinosaur dropped');
  assert.deepEqual(r.pages[0].scene.things, [{name: 'the upside-down arrow sign', look: 'a weathered wooden board, arrow pointing down, nailed to the old oak at the village gate'}]);
  assert.equal(r.pages[1].scene.things, undefined);
  assert.equal(r.pages[3].scene.others, 'a small girl in a red cap with a backpack');
  // A weave 6 draft keeps the reading's who as it was.
  const six = W.settleExtraction({pages: [{pageNo: 1, who: ['yuha', 'greenie'], where: 'gate', action: 'x', emotion: 'happy', timeOfDay: 'day', props: []}]}, {...input, writersRoom: {version: 1, weave: 6}}, outline, pages.slice(0, 1), 't');
  assert.deepEqual(six.pages[0].scene.who, ['yuha', 'greenie']);
});

test('R62 the picture request: the thing that comes back is drawn the same, the walk-on is in the picture; a page without them is unchanged', () => {
  const sheet = {characterId: 'yuha', characterSnapshot: {id: 'yuha', name: '유하', nameEn: 'Yuha'}, confirmedAt: 'now', imageUrl: 'x'};
  const ask = (scene) => {
    const book = {storyInput: input, outline, characterIds: ['yuha'], pages: [{ko: '새로 온 아이가 화살표 밑에 와요.', en: 'A new kid is under the arrow.', scene: {who: ['yuha'], where: 'gate', action: 'A new kid arrives under the sign.', emotion: 'calm', timeOfDay: 'day', props: [], ...scene}}]};
    return S.buildScenePrompt({book, page: book.pages[0], pageIndex: 0, snapshot: {characterSheets: [sheet], backgrounds: []}, place: {}, sheets: [sheet]});
  };
  const withBoth = ask({things: [{name: 'the upside-down arrow sign', look: 'a weathered wooden board nailed to the old oak'}], others: 'a small girl in a red cap'});
  assert.match(withBoth, /THE SAME THING ON EVERY PAGE \(drawn exactly so wherever it appears\): the upside-down arrow sign — a weathered wooden board nailed to the old oak\./);
  assert.match(withBoth, /Also in this picture \(not in the cast list; drawn plainly and unlike any cast member\): a small girl in a red cap\./);
  const plain = ask({});
  assert.doesNotMatch(plain, /THE SAME THING ON EVERY PAGE|Also in this picture/);
});

test('R62 the estimate: one listener row (economy) for a new room book; a weave 6 job keeps its room rows (the R61 job estimate counted weaves 1–5 only)', () => {
  const base = {pageCount: 16, diet: true, editor: true, room: true, settings: {engine: 'openai'}};
  const now = estimateStoryTextCost(base), six = estimateStoryTextCost({...base, roomClear: false});
  assert.ok(now.stages.some((s) => s.stage === 'roomListen' && s.requestCount === 1));
  assert.equal(six.stages.some((s) => s.stage === 'roomListen'), false);
  const total = (est) => est.stages.reduce((n, s) => n + (Number(s.costUsd) || 0), 0);
  assert.ok(total(now) - total(six) < 0.01, `the listener costs under a cent (${(total(now) - total(six)).toFixed(4)})`);
  const s = setup();
  const stagesOf = (weave) => jobTextBudget({input: {...input, writersRoom: {version: 1, weave}}, wizard: {pageCount: 16}, usage: {calls: []}, completed: {}, textSettings: s.settings.textGeneration}).stages.map((x) => x.stage);
  assert.ok(stagesOf(6).includes('roomCastNotes') && stagesOf(6).includes('roomThreads'), 'a weave 6 job keeps its staged rows');
  assert.equal(stagesOf(6).includes('roomListen'), false);
  assert.ok(stagesOf(7).includes('roomListen'));
});
