import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {normalizeStoryInput} from '../dist/story-generation/pipeline.js';
import * as W from '../dist/story-generation/writers-room.js';
import {topicEndingNote} from '../dist/story-generation/topic-ending.js';

/**
 * R50 (2026-11-03). The parent chose the writers'-room flow from the review
 * and cut the rules to two: the chosen characters appear, and the reading
 * level is a target measured afterwards. No fear list, no page count, no
 * name ban. This is the room's paper: a one-page brief, the cast sheet, an
 * engine menu that is never assigned, a reader panel that reacts, requests
 * for each round, and counting (never scoring) that picks between candidates.
 * Nothing is wired into a draft yet (R51).
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizard = {characterIds: ['yuha', 'mom'], backgroundIds: ['home', 'beach'], topic: '뽀글머리', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual'};
const draft = (state, w = wizard, extra = {}) => normalizeStoryInput({...inputFromWizard(state, w, {layout: 'openings'}).input, bookId: 'r50', ...extra});
const RECORDS = [{topic: '돌돌 말린 길', outline: {logline: '유하가 방석에서 태양계 여행을 떠나요'}, usedElements: {humor: ['꾸러미가 들썩여요'], engine: 'pile_up'}}];

test('R50 the brief: one page, the chosen characters and places, the level as one line; no fear list, no page count, no shape, no names of real books', () => {
  const state = setup(), input = draft(state);
  const brief = W.roomBrief(input, {records: RECORDS});
  assert.ok(brief.length <= 900, `${brief.length} chars`);
  assert.match(brief, /\[꼭 나오는 인물 — 부모님이 골랐어요\]\n- 유하 \(Yuha\) · 아이 · 주인공 · 4세/);
  assert.match(brief, /- 엄마 \(Mom\) · 어른 · 가족/);
  assert.match(brief, /\[고른 장소\] 유하네 집[^\n]*조개빛 바닷가/, 'the chosen two');
  assert.doesNotMatch(brief, /초록빛 숲|반짝이는 달/, 'not the whole drawer');
  assert.match(brief, /5~6세가 듣는 책/);
  assert.match(brief, /\[길이\] 쪽수는 작가가 정해요/);
  assert.match(brief, /\[이 집에서 최근에 만든 책 — 이것과 다르게\]\n- 돌돌 말린 길 — 유하가 방석에서 태양계 여행을 떠나요 — 웃음: 꾸러미가 들썩여요/);
  for (const banned of [/16쪽|16 pages|pageCount/, /괴물|어둠|잔인/, /tryKind|secret|LOGIC|DRAMA|CAST:|PICTURE PLAN/, /점검표가 아니에요 — 더 좋은 길이 보이면/]) if (banned.source.includes('점검표')) assert.match(brief, banned); else assert.doesNotMatch(brief, banned);
  assert.doesNotMatch(W.roomBrief(input), /최근에 만든 책/, 'no records, no block');
  const custom = draft(state, {...wizard, ending: 'custom', endingCustom: '미용실 앞에서 셋이 사진을 찍어요'});
  assert.match(W.roomBrief(custom), /\[끝\] 미용실 앞에서 셋이 사진을 찍어요/);
  assert.doesNotMatch(W.roomBrief(input), /\[끝\]/, 'a home ending is not a rule any more');
  const placeless = {...input, topic: '우주정거장으로 편지 띄우기', endingType: 'custom', endingNote: topicEndingNote('우주정거장으로 편지 띄우기', {change: true})};
  assert.ok(placeless.endingNote);
  assert.doesNotMatch(W.roomBrief(placeless), /\[끝\]/, 'the wizard\'s own R38 note is not the parent\'s wish');
  assert.equal(W.hasWritersRoom(input), false, 'not frozen on drafts yet (R51)');
  assert.deepEqual(W.writersRoomPolicy(), {version: 1});
});

test('R50 the cast sheet, the engine menu and the panel', () => {
  const state = setup(), input = draft(state);
  const sheet = W.castSheet(input);
  assert.deepEqual(sheet.map((c) => [c.name, c.kind, c.role, c.family]), [['유하', '아이', '주인공', false], ['엄마', '어른', '가족', true]]);
  assert.equal(W.ENGINE_MENU.length, 10);
  assert.equal(new Set(W.ENGINE_MENU.map((e) => e.id)).size, 10);
  assert.equal(W.engineById('reader_knows').name, '독자만 아는 비밀');
  assert.equal(W.engineById('nope'), null);
  assert.deepEqual(W.readerPanel(input).map((p) => p.id), ['dino', 'joker', 'quiet', 'parent']);
  assert.match(W.readerPanel(input)[0].name, /5세/);
  assert.match(W.readerPanel({specs: {ko: {id: 'K1'}}})[1].name, /5세/, 'the joker is a year older than the reader');
  assert.equal(W.readerYears({specs: {ko: {id: 'K4'}}}), 9);
});

test('R50 the requests: premises hear the menu as a menu; drafts are whole books of free length; the panel reacts, the room counts', () => {
  const state = setup(), input = draft(state);
  const p = W.premisesRequest(input, {records: RECORDS});
  assert.match(p.system, /전제 12개/);
  assert.match(p.system, /메뉴는 참고일 뿐 안 써도 돼요/);
  assert.match(p.system, /reader_knows · 독자만 아는 비밀/);
  assert.match(p.system, /이 책에만 나오는 새 인물은 자유롭게/);
  assert.equal(p.user, W.roomBrief(input, {records: RECORDS}));
  assert.equal(p.jsonSchema.properties.premises.minItems, 12);
  assert.deepEqual(p.jsonSchema.properties.premises.items.properties.cast.items.required, ['name', 'isNew', 'want', 'flaw', 'speech']);
  assert.equal(p.temperature, 1);
  const premise = {title: '파마 날', line: '보라의 가게에서 유하의 머리가 자꾸 다른 모양이 돼요', engine: 'three_then_flip', laugh: '엄마 머리가 먼저 뽀글이 돼요', picture: '거울 앞 세 사람', cast: [{name: '보라', isNew: true, want: '오늘은 쉬고 싶다', flaw: '손이 빠르다', speech: '손님에게 존댓말'}]};
  const d = W.draftRequest(input, premise);
  assert.match(d.system, /쪽수는 네가 정해요/);
  assert.match(d.user, /\[인물표\]\n- 보라 \(이 책의 새 인물\): 바람 — 오늘은 쉬고 싶다; 결점 — 손이 빠르다; 말투 — 손님에게 존댓말/);
  assert.equal(d.jsonSchema.properties.pages.maxItems, 40);
  assert.doesNotMatch(d.system + d.user, /tryKind|secret|beat/);
  assert.match(d.system, /비트도 설계도 없어요/);
  // The sieve: an engine and a laugh both echoing a recent book drop the premise.
  const echo = {...premise, engine: 'pile_up', laugh: '꾸러미가 들썩들썩해요'};
  assert.deepEqual(W.sievePremises([premise, echo, {...echo, engine: 'wrong_guess'}], RECORDS).map((x) => x.engine), ['three_then_flip', 'wrong_guess']);
  assert.ok(W.similarity('꾸러미가 들썩여요', '꾸러미가 들썩들썩해요') >= 0.5);
  assert.equal(W.similarity('', 'x'), 0);
  // The panel on premises: counted, never scored; ties keep the writer's order.
  const r = (laughed, curious, lost, again, word = '') => ({laughed, curious, lost, again, word});
  const reactions = [
    {premise: 1, dino: r(true, true, false, true, '쿵쿵!'), joker: r(true, false, false, true), quiet: r(false, true, false, false), parent: r(false, true, false, true)},
    {premise: 2, dino: r(false, false, true, false), joker: r(false, false, true, false, '몰라'), quiet: r(false, false, true, false), parent: r(false, false, false, false)},
    {premise: 3, dino: r(true, true, false, true), joker: r(true, true, false, true), quiet: r(true, false, false, true), parent: r(true, true, false, true)},
    {premise: 4, dino: r(true, true, false, true), joker: r(true, false, false, true), quiet: r(false, true, false, false), parent: r(false, true, false, true)},
  ];
  const rows = W.countReactions(reactions);
  assert.deepEqual(rows.map((x) => [x.premise, x.pull, x.again]), [[1, 8, 3], [2, -3, 0], [3, 11, 4], [4, 8, 3]]);
  assert.deepEqual(rows[0].words, ['dino: 쿵쿵!']);
  assert.deepEqual(W.pickPremises(rows), [3, 1, 4]);
  assert.equal(W.panelPremisesRequest(input, [premise]).jsonSchema.properties.reactions.maxItems, 1);
  assert.match(W.panelPremisesRequest(input, [premise]).system, /점수가 아니라 반응이에요/);
  // The panel reads drafts page by page; the notes name the pages that dragged, lost or landed.
  const readings = [
    {draft: 1, pages: [{page: 1, laughed: [], curious: ['dino'], bored: [], lost: []}, {page: 2, laughed: ['dino', 'joker'], curious: [], bored: [], lost: []}, {page: 3, laughed: [], curious: [], bored: ['dino', 'quiet'], lost: ['quiet']}], again: ['dino', 'joker'], words: ['또!']},
    {draft: 2, pages: [{page: 1, laughed: [], curious: [], bored: ['dino', 'joker', 'quiet'], lost: []}], again: [], words: []},
  ];
  const read = W.countReadings(readings);
  assert.deepEqual(read.map((x) => [x.draft, x.pull]), [[1, 1 + 2 + 4 - 2 - 1], [2, -3]]);
  assert.equal(W.pickDraft(read), 1);
  assert.equal(W.rewriteNotes(read[0]), '지루해한 쪽: 3 — 줄이거나 사건을 넣어요.\n무슨 말인지 모른 쪽: 3 — 아이가 따라올 수 있게 보여 줘요.\n웃은 쪽: 2 — 숨 쉴 자리를 주고 건드리지 않아요.\n한마디: 또!');
  const rw = W.rewriteRequest(input, {title: '파마 날', pages: [{ko: '싹둑.'}]}, W.rewriteNotes(read[0]));
  assert.match(rw.user, /\[독자 반응\]\n지루해한 쪽: 3/);
  assert.match(rw.user, /=== 초고 1 · 파마 날 ===\n1쪽: 싹둑\./);
  assert.match(W.panelReadRequest(input, [{title: 'a', pages: [{ko: 'x'}]}]).user, /=== 초고 1 · a ===\n1쪽: x/);
});
