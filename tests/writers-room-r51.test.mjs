import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {normalizeStoryInput, generateOutline} from '../dist/story-generation/pipeline.js';
import {leanVisibleInput} from '../dist/story-generation/prompt-diet.js';
import {demoOutline} from '../dist/story-generation/demo.js';
import {isCouncilHold} from '../dist/story-generation/council.js';
import {liveCouncilRecord, renderCouncilRoom, renderCouncilReviewForm, councilRoomBlock, readCouncilChoice} from '../dist/story-generation/council-room.js';
import {getTextGenerationSettings} from '../dist/text-generation/settings-ui.js';
import * as W from '../dist/story-generation/writers-room.js';

/**
 * R51 (2026-11-03). The room's first half runs: premises from the top model,
 * the six readers' reactions from the cheap one, a counted shortlist of
 * three, then the parent's choice on the R22 hold (the same status, the same
 * choice readers), every paid answer journaled so a resumed run buys nothing
 * again. A draft carries the marker only when the parent's 작가실 setting is
 * on (off until R53); the simple ① then hides the nine format selects.
 * The outline is written from the chosen premise (R52 writes whole drafts).
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizard = {characterIds: ['yuha', 'mom'], backgroundIds: ['home', 'beach'], topic: '뽀글머리', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual'};
const roomState = () => { const s = setup(); s.settings.textGeneration = {...(s.settings.textGeneration || {}), writersRoom: true}; return s; };
const premise = (n) => ({title: `전제 ${n}`, line: `${n}번째 이야기: 유하의 머리가 ${n}번 바뀌어요`, engine: n % 2 ? 'three_then_flip' : 'reader_knows', laugh: `엄마 머리가 ${n}번 먼저 뽀글이 돼요`, picture: `거울 앞 ${n}명`, cast: [{name: '보라', isNew: true, want: '쉬고 싶다', flaw: '손이 빠르다', speech: '손님에게 존댓말'}]});
const PREMISES = {premises: Array.from({length: 12}, (_, i) => premise(i + 1))};
const r = (laughed, curious, lost, again) => ({laughed, curious, lost, again, word: laughed ? '깔깔' : ''});
const quiet = r(false, false, false, false);
const REACTIONS = {reactions: Array.from({length: 12}, (_, i) => ({premise: i + 1, action: i === 6 ? r(true, true, false, true) : i === 2 ? r(true, false, false, true) : quiet, laugh: i === 6 || i === 2 || i === 9 ? r(true, true, false, true) : quiet, heart: i === 6 ? r(false, true, false, true) : quiet, eye: quiet, ours: i === 9 ? r(true, false, false, false) : quiet, parent: i === 6 ? r(true, true, false, true) : quiet}))};
const reply = (json) => ({json, usage: {input: 10, output: 5}, meta: {requests: 1, model: 'mock'}});
/** A mock engine that answers by what the request asks for; it counts its calls. */
function mockEngine(input, calls) {
  return {id: 'openai', async complete(req) {
    calls.push(req);
    const schema = req.jsonSchema?.properties || {};
    if (schema.premises) return reply(PREMISES);
    if (schema.reactions) return reply(REACTIONS);
    const o = structuredClone(demoOutline(input));
    o.beats[1].summary += ' 유하의 뽀글머리가 거울에 비쳐요.';
    return reply(o);
  }};
}
const services = (engine) => ({engineFor: () => engine});

test('R51 the marker: only when the parent\'s 작가실 setting is on; kept by normalize, never sent as data; the settings pass it through; K1 stays out for now', () => {
  const plain = normalizeStoryInput({...inputFromWizard(setup(), wizard, {layout: 'openings'}).input, bookId: 'p'});
  assert.equal(plain.writersRoom, undefined);
  const input = normalizeStoryInput({...inputFromWizard(roomState(), wizard, {layout: 'openings'}).input, bookId: 'r'});
  assert.deepEqual(input.writersRoom, {version: 1});
  assert.ok(W.hasWritersRoom(input));
  assert.doesNotMatch(JSON.stringify(leanVisibleInput(input, 'outline')), /writersRoom/);
  assert.equal(normalizeStoryInput({...input, writersRoom: {version: 3}}).writersRoom, undefined);
  assert.equal(getTextGenerationSettings(roomState()).writersRoom, true);
  assert.equal('writersRoom' in getTextGenerationSettings(setup()), false);
  assert.equal(inputFromWizard(roomState(), {...wizard, koreanLevel: 'K1', englishLevel: 'E0', pageCount: 12}, {layout: 'pages'}).input.writersRoom, undefined);
  assert.deepEqual(W.writersRoomFor(roomState()), {version: 1});
  assert.equal(W.writersRoomFor(setup()), null);
});

test('R51 the room runs: premises (top model) → the panel (cheap) → a counted shortlist → the hold; the resumed run replays and buys only the outline', async () => {
  const input = normalizeStoryInput({...inputFromWizard(roomState(), wizard, {layout: 'openings'}).input, bookId: 'run'});
  const calls = [], engine = mockEngine(input, calls), progress = [];
  let checkpoint = null;
  const options = {engine, engineId: 'openai', qualityEngines: {prose: engine, cheap: engine, outline: engine}, councilHold: true, onProgress: (p) => progress.push(p), onCheckpoint: async (cp) => { checkpoint = cp.councilCheckpoint; }};
  await assert.rejects(() => W.runWritersRoom(input, options, services(engine)), (e) => isCouncilHold(e));
  assert.equal(calls.length, 2, 'premises and the panel');
  assert.match(calls[0].system, /전제 12개/);
  assert.match(calls[0].user, /\[꼭 나오는 인물 — 부모님이 골랐어요\]/);
  assert.match(calls[1].system, /여섯 사람/);
  const held = checkpoint.record;
  assert.equal(held.kind, 'writersRoom');
  assert.equal(held.phase, 'review');
  assert.equal(held.premises.length, 12);
  assert.deepEqual(held.shortlist, [7, 3, 10], 'counted: premise 7 pulls most (11), then 3 (5), then 10 (4)');
  assert.deepEqual(held.pitches.map((p) => [p.title, p.laughed, p.again]), [['전제 7', 3, 4], ['전제 3', 2, 2], ['전제 10', 2, 1]]);
  assert.equal(held.recommended, 1);
  assert.deepEqual(progress.filter((p) => p.stage === 'council').map((p) => p.phase), ['premises', 'panel', 'review']);
  // The screens: the room panel while held, the premise form with the R22 names, the folded block afterwards.
  const job = {input, councilCheckpoint: checkpoint};
  assert.equal(liveCouncilRecord(job).kind, 'writersRoom');
  const panel = renderCouncilRoom(liveCouncilRecord(job), {live: true});
  assert.match(panel, /class="council-room writers-room live phase-review"/);
  assert.match(panel, /독자 여섯이 고른 셋이에요\. 부모님의 선택을 기다려요/);
  assert.doesNotMatch(panel, /council-seat|의장/);
  const form = renderCouncilReviewForm(liveCouncilRecord(job));
  assert.match(form, /<input type="radio" name="council-pick" value="1" data-pitch-title="전제 7" checked>/);
  assert.match(form, /독자단 1순위/);
  assert.match(form, /웃음: 엄마 머리가 7번 먼저 뽀글이 돼요/);
  assert.match(form, /새 인물: 보라/);
  assert.match(form, /id="council-note"/);
  assert.doesNotMatch(form, /council-direction|다시 회의/);
  // Resume with the parent's choice (the second card) and a note: both rounds replay, nothing is bought.
  const resumed = [], engine2 = mockEngine(input, resumed);
  const result = await W.runWritersRoom(input, {...options, engine: engine2, qualityEngines: {prose: engine2, cheap: engine2}, councilCheckpoint: checkpoint, councilChoice: {pick: 2, note: '엄마가 더 나오게'}}, services(engine2));
  assert.equal(resumed.length, 0);
  assert.equal(result.meta.resumedCalls, 2);
  assert.equal(result.record.chosen, 2);
  assert.equal(result.record.premise.title, '전제 3');
  assert.deepEqual(result.record.parentChoice, {pick: 2, note: '엄마가 더 나오게'});
  assert.ok(result.record.decisions.some((d) => d.by === '부모' && /한마디/.test(d.what)));
  const block = W.roomPremiseBlock(result.record, input);
  assert.match(block, /^THE WRITERS' ROOM CHOSE THIS PREMISE — write the outline from it, in your own way:\nTitle "전제 3"\. 3번째 이야기/);
  assert.match(block, /Shape: 같은 일이 셋, 넷째가 거꾸로\./);
  assert.match(block, /Cast: 보라 \(new to this book\): wants 쉬고 싶다; flaw 손이 빠르다; speaks 손님에게 존댓말\. A character new to this book is fine; the parent's chosen characters all appear\./);
  assert.match(block, /The parent's note — keep it: 엄마가 더 나오게$/);
  const outline = {...demoOutline(input)};
  W.attachWritersRoom(outline, result);
  assert.equal(outline.writersRoom.chosen, 2);
  assert.equal(outline.bible, undefined, 'no bible: the premise binds the outline request');
  assert.match(W.roomSummaryLine(outline), /^작가실 · '전제 3' \(전제 12개 중 독자단이 셋을 골라 부모가 채택\)$/);
  const done = councilRoomBlock({input, outline});
  assert.match(done, /<summary>작가실 다시 보기 · '전제 3' 채택 · 부모가 고름<\/summary>/);
  assert.match(done, /council-chosen/);
});

test('R51 the outline stage takes the room instead of the council; the sieve drops echoes of the recent books; no choice and no hold picks the first', async () => {
  const input = normalizeStoryInput({...inputFromWizard(roomState(), wizard, {layout: 'openings'}).input, bookId: 'o'});
  const calls = [], engine = mockEngine(input, calls);
  const result = await generateOutline(input, {engine, engineId: 'openai', qualityEngines: {prose: engine, cheap: engine, outline: engine}});
  assert.equal(result.data.writersRoom.chosen, 1);
  assert.equal(result.data.council, undefined, 'the council did not meet');
  assert.equal(result.data.bible, undefined);
  const outlineCall = calls.find((c) => /StoryOutline/.test(c.system));
  assert.match(outlineCall.system, /THE WRITERS' ROOM CHOSE THIS PREMISE[^\n]*\nTitle "전제 7"/);
  assert.doesNotMatch(outlineCall.system, /THE WRITERS' ROOM CHOSE THIS PITCH/);
  assert.equal(result.meta.council.stage, 'council', 'the room reports under the council\'s stage name (the same checkpoint plumbing)');
  assert.equal(result.meta.council.councilCheckpoint.kind, 'writersRoom');
  assert.ok(Number(result.meta.requests) >= 3, `${result.meta.requests} requests: the room's two and the outline`);
  // The sieve: a premise whose engine and laugh echo a recent book is dropped before the panel hears it.
  const records = [{topic: '옛 책', usedElements: {engine: 'reader_knows', humor: ['엄마 머리가 2번 먼저 뽀글이 돼요']}}];
  const sieved = W.sievePremises(PREMISES.premises, records);
  assert.equal(sieved.length, 12 - 6, 'every even premise shares the engine and a near-identical laugh');
});

test('R51 the simple ①: with the room on, the nine format selects are gone and a line says the room decides; off, the panel stays', async () => {
  const {renderSimpleCreate, ensureSimpleWizard} = await import('../dist/simple-create.js');
  const src = readFileSync(new URL('../dist/simple-create.js', import.meta.url), 'utf8');
  assert.match(src, /writersRoomFor\(state\) \? `<p class="small-label simple-defaults-note simple-room-note">작가실이 책의 길이·모양·끝을 정해요/);
  assert.match(src, /action === "toggle-writers-room"/);
  assert.match(src, /label: "작가실"/);
  const sw = readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8');
  assert.ok(Number(sw.match(/const CACHE = "donghwa-shell-v(\d+)";/)?.[1]) >= 101, 'v101 or later');
  const ctxFor = (state, w, step) => ({getState: () => state, getWizard: () => w, setWizard: (v) => { w = v; }, getDraft: () => null, setDraft: () => {}, getEditPage: () => 0, setEditPage: () => {}, isSimpleView: () => true, isSimpleMode: () => true, materialPortrait: (c) => `<svg aria-label="${c.name}"></svg>`, cover: () => '', illustration: () => ''});
  const on = roomState(), off = setup();
  const w = (state) => ensureSimpleWizard(state, {...structuredClone(wizard), simpleStep: 1, simpleFormatOpen: true});
  const roomHtml = renderSimpleCreate(ctxFor(on, w(on), 1)), plainHtml = renderSimpleCreate(ctxFor(off, w(off), 1));
  assert.match(roomHtml, /작가실이 책의 길이·모양·끝을 정해요\. 읽기 등급과 언어는 ‘우리 아이’ 설정을 써요\./);
  assert.doesNotMatch(roomHtml, /simple-format-panel|id="pageCount"|책 형식/);
  assert.match(plainHtml, /id="simple-format-panel"/);
  assert.match(plainHtml, /책 형식/);
  assert.ok((roomHtml.match(/<select /g) || []).length < (plainHtml.match(/<select /g) || []).length - 5, 'the nine selects are gone');
  assert.match(roomHtml, /id="topic"/);
  assert.match(roomHtml, /아이디어 뽑기/);
});
