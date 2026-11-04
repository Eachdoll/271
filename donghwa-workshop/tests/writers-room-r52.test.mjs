import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {normalizeStoryInput} from '../dist/story-generation/pipeline.js';
import {demoOutline} from '../dist/story-generation/demo.js';
import {approvedBookRecord} from '../dist/story-generation/quality-gates.js';
import * as W from '../dist/story-generation/writers-room.js';

/**
 * R52 (2026-11-03). The room's second half: three whole drafts from the chosen
 * premise (the top model, in parallel), the six readers' page-by-page reading
 * (the cheap model), the counted pick, one rewrite on their notes, then the
 * English edition written after the Korean is final (the parent: "Korean
 * first, English as its translation, choose the edition") and one polish of
 * the pages the level checker names — advisory, never a loop. Journaled under
 * writerCheckpoint; a resumed run replays and buys nothing.
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizard = {characterIds: ['yuha', 'mom'], backgroundIds: ['home', 'beach'], topic: '뽀글머리', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual'};
const roomState = () => { const s = setup(); s.settings.textGeneration = {...(s.settings.textGeneration || {}), writersRoom: true}; return s; };
const PREMISE = {title: '파마 날', line: '보라의 가게에서 유하의 머리가 자꾸 다른 모양이 돼요', engine: 'three_then_flip', laugh: '엄마 머리가 먼저 뽀글이 돼요', picture: '거울 앞 세 사람', cast: [{name: '보라', isNew: true, want: '쉬고 싶다', flaw: '손이 빠르다', speech: '손님에게 존댓말'}]};
const LONG = '유하는 거울 앞에 앉아서 보라 아줌마가 가위를 들고 머리를 자르는 동안 엄마가 망토를 접었다 폈다 하는 것을 보면서 창밖의 참새가 빗방울 정원 쪽으로 날아가는 것까지 하나도 빠짐없이 전부 다 보고 있었어요.';
const draft = (n, long = false) => ({title: `파마 날 ${n}`, pages: Array.from({length: 8}, (_, i) => ({ko: i === 1 && long ? LONG : `${n}권 ${i + 1}쪽. 싹둑! 유하가 거울을 봐요.`}))});
const reply = (json) => ({json, usage: {input: 10, output: 5}, meta: {requests: 1, model: 'mock'}});
function mockEngine(calls, {longDraft = 1} = {}) {
  return {id: 'openai', async complete(req) {
    calls.push(req);
    const props = req.jsonSchema?.properties || {}, items = props.pages?.items?.properties || {};
    // R54e: the readers choose draft 2 (favourite × 5, again × 3); draft 2's page 5 is skipped by three and lost by one, page 2 landed with four.
    if (props.readers) return reply({readers: ['action', 'laugh', 'heart', 'eye', 'ours', 'parent'].map((reader, i) => ({reader, favorite: i === 3 ? 3 : 2, again: i < 3, drafts: [1, 2, 3].map((d) => ({draft: d, skipPage: d === 2 ? 5 : d === 3 ? 2 : 1, lostPage: d === 2 && i === 2 ? 5 : 0, laughPages: d === 2 && i < 4 ? [2] : [], word: d === 2 && i === 0 ? '또!' : ''}))}))});
    if (items.en && !items.ko) return reply({pages: Array.from({length: Number(props.pages.minItems)}, (_, i) => ({en: `Snip! Page ${i + 1}.`}))});
    if (items.ko && items.en) return reply({pages: Array.from({length: Number(props.pages.minItems)}, (_, i) => ({ko: i === 1 ? '유하가 큰 거울을 가만히 봐요. 작은 참새가 창밖으로 포르르 날아가요.' : `고친 ${i + 1}쪽.`, en: `Fixed ${i + 1}.`}))});
    const m = /\[초고 (\d)\/(\d)/.exec(req.user);
    if (m) return reply(draft(Number(m[1]), Number(m[1]) === longDraft));
    if (/\[독자 반응\]/.test(req.user)) return reply({title: '파마 날!', pages: [{ko: '싹둑.'}, {ko: LONG}, {ko: '엄마가 웃어요.'}]});
    throw new Error(`unexpected request: ${req.system.slice(0, 40)}`);
  }};
}
const services = (engine) => ({engineFor: () => engine});
const roomInput = (bookId) => normalizeStoryInput({...inputFromWizard(roomState(), wizard, {layout: 'openings'}).input, bookId});
const roomOutline = (input) => ({...demoOutline(input), writersRoom: {kind: 'writersRoom', version: 1, chosen: 1, premise: PREMISE, pitches: [{title: PREMISE.title}], premises: [PREMISE]}});

test('R52 the marker carries the recent books (line, engine, laugh); the brief and the sieve read them from the marker; an approved room book records its engine', () => {
  const records = [{bookId: 'old', approved: true, createdAt: '2026-10-29T00:00:00.000Z', topic: '돌돌 말린 길', outline: {beats: [{index: 1}], logline: '유하가 방석에서 태양계 여행을 떠나요', writersRoom: {premise: {engine: 'pile_up'}}}, usedElements: {humor: ['꾸러미가 들썩여요']}}];
  const policy = W.writersRoomPolicy(records);
  assert.deepEqual(policy, {version: 1, recent: [{line: '돌돌 말린 길 — 유하가 방석에서 태양계 여행을 떠나요 — 웃음: 꾸러미가 들썩여요', engine: 'pile_up', laugh: '꾸러미가 들썩여요'}]});
  assert.deepEqual(W.writersRoomRef({version: 1, recent: [{line: ' a ', engine: 'x'}, {line: ''}, 3]}), {version: 1, recent: [{line: 'a', engine: 'x'}]});
  assert.equal(W.writersRoomRef({version: 2}), null);
  const input = {...roomInput('m'), writersRoom: policy};
  assert.match(W.roomBrief(input), /\[이 집에서 최근에 만든 책 — 이것과 다르게\]\n- 돌돌 말린 길 — 유하가/);
  const echo = {...PREMISE, engine: 'pile_up', laugh: '꾸러미가 들썩들썩해요'};
  assert.deepEqual(W.sievePremises([PREMISE, echo], policy.recent).map((p) => p.engine), ['three_then_flip']);
  const state = roomState(); state.settings.storyQuality = {...(state.settings.storyQuality || {}), approvedBooks: records};
  assert.ok(inputFromWizard(state, wizard, {layout: 'openings'}).input.writersRoom.recent.length >= 1, 'the wizard freezes the family\'s records');
  const book = {id: 'b', approved: true, approvedAt: '2026-11-03T00:00:00.000Z', topic: '파마 날', outline: roomOutline(roomInput('q')), pages: []};
  assert.equal(approvedBookRecord(book)?.usedElements.engine, 'three_then_flip');
});

test('R52 the drafts round: three whole drafts in parallel, the panel reads, the counted pick, one rewrite, the English edition after, one polish of the pages the checker names; the resumed run buys nothing', async () => {
  const input = roomInput('d'), outline = roomOutline(input);
  const calls = [], engine = mockEngine(calls), progress = [];
  let checkpoint = null;
  const options = {engine, engineId: 'openai', qualityEngines: {prose: engine, cheap: engine}, onProgress: (p) => progress.push(p), onCheckpoint: async (cp) => { checkpoint = cp.writerCheckpoint; }};
  const result = await W.runRoomDrafts(input, outline, options, services(engine));
  const kinds = calls.map((c) => /\[초고 (\d)/.exec(c.user)?.[1] ? `draft${/\[초고 (\d)/.exec(c.user)[1]}` : c.jsonSchema.properties.readers ? 'read' : /\[독자 반응\]/.test(c.user) ? 'rewrite' : c.jsonSchema.properties.pages.items.properties.en && !c.jsonSchema.properties.pages.items.properties.ko ? 'english' : 'polish');
  assert.deepEqual(kinds, ['draft1', 'draft2', 'draft3', 'read', 'rewrite', 'english', 'polish']);
  assert.match(calls[0].system, /쪽수는 네가 정해요/);
  assert.match(calls[0].user, /\[인물표\]\n- 보라 \(이 책의 새 인물\)/);
  assert.match(calls[3].system, /여섯 사람이에요\. 아래 초고를 한 쪽씩/);
  assert.match(calls[4].user, /\[독자 반응\]\n넘기고 싶어한 쪽: 5 — 줄이거나 사건을 넣어요\.\n무슨 말인지 모른 쪽: 5 — 아이가 따라올 수 있게 보여 줘요\.\n웃은 쪽: 2 — 숨 쉴 자리를 주고 건드리지 않아요\.\n한마디: 또!/);
  assert.match(calls[5].system, /^You are a picture-book author writing the English edition of a finished Korean picture book, page by page\. English E2/);
  assert.match(calls[5].user, /^\[cast\] 유하 \(Yuha\) — boy, he; .*\n\n1쪽: 싹둑\.\n2쪽: 유하는 거울 앞에/, 'R54e: the English edition request opens with the cast line (gender, pronoun) and then the numbered Korean pages');
  assert.match(calls[6].system, /그 쪽만 등급 안에서 다시 쓰고/);
  assert.match(calls[6].user, /\[등급 참고\]\n[\s\S]*?2쪽 \(한글\): /);
  const room = result.data.room;
  assert.deepEqual(room.drafts, [{title: '파마 날 1', pages: 8}, {title: '파마 날 2', pages: 8}, {title: '파마 날 3', pages: 8}]);
  assert.equal(room.chosen, 2, 'the readers laughed and asked again at draft 2');
  assert.equal(room.rewritten, true);
  assert.equal(room.english, true);
  assert.ok(room.levelNotes.some((n) => n.pageNo === 2 && n.language === 'ko'), 'the long sentence on page 2 is named');
  assert.equal(room.polished, true);
  assert.deepEqual(room.levelNotesAfter.filter((n) => n.pageNo === 2 && n.language === 'ko'), [], 'the polish cleared page 2');
  assert.equal(result.data.title, '파마 날!');
  assert.equal(result.data.language, 'dual', 'the Korean book and its English edition; the parent picks the edition when reading or printing');
  assert.deepEqual(result.data.pages.map((p) => [p.pageNo, p.ko, p.en]), [[1, '고친 1쪽.', 'Fixed 1.'], [2, '유하가 큰 거울을 가만히 봐요. 작은 참새가 창밖으로 포르르 날아가요.', 'Fixed 2.'], [3, '고친 3쪽.', 'Fixed 3.']]);
  assert.deepEqual(progress.filter((p) => p.phase !== 'request').map((p) => p.phase), ['drafts', 'read', 'rewrite', 'english', 'polish', 'done']);
  assert.ok(progress.some((p) => p.phase === 'request' && p.stage === 'roomDrafts'), 'the journal reports each paid call');
  assert.equal(result.meta.stage, 'roomDrafts');
  assert.equal(result.meta.requests, 7);
  assert.match(W.roomDraftLine(result.data), /^작가실 · 초고 3권 중 독자단이 2번을 골라 고쳐 쓰고 영어판을 쓰고 등급 참고 \d+건 중 다듬어 \d+건 남음 · 3쪽$/);
  // Resume: every answer replays from the checkpoint; nothing is bought.
  const again = [], engine2 = mockEngine(again);
  const replay = await W.runRoomDrafts(input, outline, {...options, engine: engine2, qualityEngines: {prose: engine2, cheap: engine2}, writerCheckpoint: checkpoint}, services(engine2));
  assert.equal(again.length, 0);
  assert.equal(replay.meta.resumedCalls, 7);
  assert.deepEqual(replay.data.pages, result.data.pages);
  // A Korean-only book skips the English edition; a draft without the premise cannot start.
  const koCalls = [], koEngine = mockEngine(koCalls);
  const ko = await W.runRoomDrafts({...input, language: 'ko'}, outline, {engine: koEngine, qualityEngines: {prose: koEngine, cheap: koEngine}, roomPolish: false}, services(koEngine));
  assert.equal(ko.data.language, 'ko');
  assert.equal(koCalls.length, 5, 'three drafts, the reading, the rewrite');
  assert.equal(ko.data.room.polished, false);
  await assert.rejects(() => W.runRoomDrafts(input, demoOutline(input), {engine: koEngine}, services(koEngine)), /작가실이 고른 전제가 없어요/);
});
