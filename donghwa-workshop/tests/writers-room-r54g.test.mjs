import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {normalizeStoryInput} from '../dist/story-generation/pipeline.js';
import {demoOutline} from '../dist/story-generation/demo.js';
import * as W from '../dist/story-generation/writers-room.js';

/*
 * R54g (2026-11-05): the second paid A/B (astra · Opus) read from its own
 * exchanges — astra's rewrite replaced all 14 pages of the draft the panel had
 * chosen (7% of the words kept) and doubled the density; the readers' one-
 * word remarks were all praise; the three drafts shared one title; the cheap
 * reader wrote "behind her" for the boy and put the fawn on the cover; Opus's
 * spread marks (10, 14) did not fit the binding and came out as 13·14.
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizard = {characterIds: ['yuha', 'mom'], backgroundIds: ['home', 'beach'], topic: '숲속에서 자꾸 숨는 아기 사슴', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual'};
const roomInput = (id) => normalizeStoryInput({...inputFromWizard(setup(), wizard, {layout: 'openings'}).input, bookId: id});
const PREMISE = {title: '내 뒤에 누가 있게?', line: '숲에서', engine: 'reader_knows', laugh: '뒤에 숨어요', picture: '큰 귀', cast: [{name: '콩이', isNew: true, want: '놀고 싶다', flaw: '겁', speech: '귀만', nameEn: 'Kongi', kind: 'fawn', look: 'tiny fawn'}]};
const roomOutline = (input) => ({...demoOutline(input), writersRoom: {kind: 'writersRoom', version: 1, chosen: 1, premise: PREMISE, pitches: [{title: '내 뒤에 누가 있게?'}], premises: [PREMISE]}});
const reply = (json) => ({json, usage: {input: 10, output: 5}, meta: {requests: 1, model: 'mock'}});
const page = (i) => ({ko: `${i}쪽이에요.\n콩이가 숨어요.`, en: `Page ${i}. Kongi hides.`});
const services = (engine) => ({engineFor: () => engine});

test('R54g rewriteChange measures pages kept and changed (whitespace-insensitive); nothingToRewrite is true only with no skipped, lost or named change', () => {
  const chosen = [{ko: '가.'}, {ko: '나.'}, {ko: '다.'}];
  assert.deepEqual(W.rewriteChange(chosen, [{ko: '가.'}, {ko: ' 나.\n'}, {ko: '라.'}, {ko: '마.'}]), {before: 3, after: 4, kept: 2, changed: 2, share: 0.5});
  assert.equal(W.nothingToRewrite({boredPages: [], lostPages: [], words: []}), true);
  assert.equal(W.nothingToRewrite({boredPages: [], lostPages: [], words: ['']}), true);
  assert.equal(W.nothingToRewrite({boredPages: [5], lostPages: [], words: []}), false);
  assert.equal(W.nothingToRewrite({boredPages: [], lostPages: [], words: ['2쪽을 짧게']}), false);
});

test('R54g the panel names one thing to change per draft (change, not a one-word remark); the notes carry it; the targeted rewrite request says what to leave alone', () => {
  const input = roomInput('g1');
  const schema = W.panelReadRequest(input, [{title: 'a', pages: [page(1)]}, {title: 'b', pages: [page(1)]}]).jsonSchema;
  const draft = schema.properties.readers.items.properties.drafts.items;
  assert.deepEqual(draft.required, ['draft', 'skipPage', 'lostPage', 'laughPages', 'change', 'hardPage', 'mannersPage'], 'R55d: the adult reader\'s two pages');
  assert.match(W.panelReadRequest(input, [{title: 'a', pages: [page(1)]}]).system, /바꾸고 싶은 것 하나\*\*\(change/);
  const rows = W.countReadings({readers: [{reader: 'ours', favorite: 1, again: true, drafts: [{draft: 1, skipPage: 2, lostPage: 0, laughPages: [], change: '2쪽 되풀이를 줄여요'}]}, {reader: 'parent', favorite: 1, again: false, drafts: [{draft: 1, skipPage: 2, lostPage: 0, laughPages: [], word: '옛 답도 읽어요'}]}]}, 1);
  assert.deepEqual(rows[0].words, ['2쪽 되풀이를 줄여요', '옛 답도 읽어요'], 'change, and word for an answer journaled before R54g');
  assert.match(W.rewriteNotes(rows[0]), /^넘기고 싶어한 쪽: 2 — [^\n]*\n바꾸고 싶은 것: 2쪽 되풀이를 줄여요 \/ 옛 답도 읽어요$/);
  const req = W.rewriteRequest(input, {title: 't', pages: [page(1)]}, '넘기고 싶어한 쪽: 2');
  assert.match(req.system, /가리킨 쪽\(넘기고 싶어한 쪽·모른 쪽·읽기 힘든 쪽·말높임이 어색한 쪽·바꾸고 싶은 것\)과 그 앞뒤 한 쪽만 손대고, 웃은 쪽은 글자 하나 바꾸지 않고/);
  assert.match(req.system, /분량은 늘리지 않아요/);
  assert.match(W.draftRequest(input, PREMISE).system, /이 초고만의 제목으로\(전제 제목과 달라도 돼요\)/);
});

test('R54g runRoomDrafts: the rewrite is skipped when the panel named nothing to fix; when it runs, the change is measured against the chosen draft', async () => {
  const input = roomInput('g2'), outline = roomOutline(input);
  const make = ({fix}) => {
    const calls = [];
    const engine = {id: 'openai', async complete(req) {
      calls.push(req);
      const props = req.jsonSchema?.properties || {};
      if (props.readers) return reply({readers: ['action', 'laugh', 'heart', 'eye', 'ours', 'parent'].map((reader, i) => ({reader, favorite: 2, again: true, drafts: [1, 2, 3].map((d) => ({draft: d, skipPage: fix && d === 2 ? 3 : i + 1, lostPage: 0, laughPages: d === 2 ? [2] : [], change: ''}))}))});
      if (/\[독자 반응\]/.test(req.user)) return reply({title: '고친 제목', pages: [{ko: '1쪽이에요. 콩이가 숨어요.'}, {ko: '2쪽이에요.\n콩이가 숨어요.'}, {ko: '셋째 쪽은 새로 썼어요.'}, ...[4, 5, 6, 7, 8].map((i) => ({ko: `${i}쪽이에요.\n콩이가 숨어요.`}))]});
      if (props.pages?.items?.properties?.en && !props.pages?.items?.properties?.ko) return reply({pages: Array.from({length: Number(props.pages.minItems)}, (_, i) => ({en: `Page ${i + 1}. Kongi hides.`}))});
      if (/\[등급 참고\]/.test(req.user)) return reply({pages: Array.from({length: Number(props.pages.minItems)}, (_, i) => ({ko: i === 0 ? '1쪽이에요. 콩이가 숨어요. 짧게.' : `${i + 1}쪽이에요. 콩이가 숨어요.`, en: `Page ${i + 1}. Kongi hides.`}))});
      const n = Number(/\[초고 (\d)/.exec(req.user)?.[1] || 1);
      return reply({title: `초고 ${n}`, pages: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ko: `${i}쪽이에요.\n콩이가 숨어요.`}))});
    }};
    return {calls, engine};
  };
  // Nothing to fix: no rewrite call.
  const quiet = make({fix: false});
  const r1 = await W.runRoomDrafts(input, outline, {engine: quiet.engine, engineId: 'openai', qualityEngines: {prose: quiet.engine, cheap: quiet.engine}, roomPolish: false}, services(quiet.engine));
  assert.equal(quiet.calls.filter((c) => /\[독자 반응\]/.test(c.user)).length, 0, 'no rewrite call');
  assert.equal(r1.data.room.rewriteSkipped, true);
  assert.equal(r1.data.room.rewritten, false);
  assert.equal(r1.data.title, '초고 2', 'the panel\'s pick stands as written');
  assert.match(W.roomDraftLine(r1.data), /고칠 곳이 없어 그대로 두고/);
  // Something to fix: the rewrite runs; one page changed, the rest came back the same (whitespace folded by the app either way).
  const busy = make({fix: true});
  const r2 = await W.runRoomDrafts(input, outline, {engine: busy.engine, engineId: 'openai', qualityEngines: {prose: busy.engine, cheap: busy.engine}, roomPolish: false}, services(busy.engine));
  assert.equal(r2.data.room.rewritten, true);
  assert.equal(r2.data.pages[2].ko, '셋째 쪽은 새로 썼어요.');
  assert.deepEqual(r2.data.room.rewriteChange, {before: 8, after: 8, kept: 7, changed: 1, share: 0.13});
  assert.match(W.roomDraftLine(r2.data), /고쳐 쓰고\(8쪽 중 1쪽 손봄\)/);
});

test('R54g fitSpreadMarks: Opus\'s marks (10, 14 of 14 entries, 8 openings) now stay spreads with the words unchanged; a fitting book is untouched; marks beyond C are dropped; an unsplittable book is left for the binding', () => {
  const pages = (n, sentencesPer, marks) => Array.from({length: n}, (_, i) => ({ko: Array.from({length: sentencesPer}, (_, k) => `${i + 1}쪽 ${k + 1}문장.`).join(' '), ...(marks.includes(i + 1) ? {spread: true} : {})}));
  const words = (rows) => rows.map((p) => p.ko).join(' ').replace(/\s+/g, '');
  const opus = pages(14, 3, [10, 14]);
  const fit = W.fitSpreadMarks(opus, 8);
  assert.equal(fit.fitted, true);
  assert.equal(fit.pages.length, 14);
  assert.equal(words(fit.pages), words(opus), 'no word changes');
  const marks = fit.pages.map((p, i) => (p.spread ? i + 1 : 0)).filter(Boolean);
  assert.equal(marks.length, 2);
  const beats = W.openingBeats({layoutPolicy: {kind: 'openings'}, pageCount: 16}, [1, 2, 3, 4, 5, 6, 7, 8], 14, fit.pages.map((p) => p.spread === true));
  for (const m of marks) assert.equal(beats.filter((b) => b === beats[m - 1]).length, 1, `marked entry ${m} stands alone in its opening`);
  const astra = pages(14, 2, [9, 12]);
  assert.deepEqual(W.fitSpreadMarks(astra, 8).pages, astra, 'already fits: untouched');
  assert.equal(W.fitSpreadMarks(pages(12, 2, []), 8).fitted, true, 'no marks: nothing to fit');
  const many = W.fitSpreadMarks(pages(12, 2, [1, 2, 3, 4, 5, 6, 7, 8, 9]), 8);
  assert.ok(many.moved >= 1, 'the ninth mark is dropped (R55e: two more are released rather than joining four pages into one)');
  assert.equal(W.fitSpreadMarks(pages(12, 2, [1, 2, 3, 4, 5, 6, 7, 8, 9]), 8, {cap: 5}).moved, 3);
  const short = W.fitSpreadMarks(pages(9, 1, [9]), 8);
  assert.equal(short.fitted, false, 'one-sentence pages cannot be split: left to the binding');
  assert.equal(short.pages.length, 9);
});

test('R54g the extraction names gender and pronoun per character and keeps the cover to the hero alone', () => {
  const input = roomInput('g3');
  const req = W.extractRequest(input, roomOutline(input), [page(1)]);
  assert.match(req.system, /\[cast\] yuha = 유하 \(Yuha\) — boy, he/);
  assert.match(req.system, /sceneAction \(one English sentence for the cover picture: 유하 alone — no companion on the cover\)/);
});
