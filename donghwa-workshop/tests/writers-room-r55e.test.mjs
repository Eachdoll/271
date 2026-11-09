import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {normalizeStoryInput} from '../dist/story-generation/pipeline.js';
import {estimateStoryTextCost} from '../dist/text-generation/models.js';
import * as W from '../dist/story-generation/writers-room.js';

/*
 * R55e (2026-11-09): the third paid A/B's remaining fixes. The binding fit had
 * joined Opus's pages into single pages of 8 and 6 sentences (the page check
 * allows 5), the anthropic estimate came out below the real cost for the first
 * time (Opus wrote 1.6× longer), and two of astra's three drafts shared a title.
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizard = {characterIds: ['yuha', 'mom'], backgroundIds: ['home', 'forest'], topic: '숲속에서 자꾸 숨는 아기 사슴', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual'};
/* A job frozen before R55h (no weave): the draft round this file pins has no notes and no treatments before it. */
const preWeave = (input) => { const {weave, ...room} = input.writersRoom; return {...input, writersRoom: room}; };
const roomInput = (id) => preWeave(normalizeStoryInput({...inputFromWizard(setup(), wizard, {layout: 'openings'}).input, bookId: id}));
const pages = (n, sentencesPer, marks) => Array.from({length: n}, (_, i) => ({ko: Array.from({length: sentencesPer}, (_, k) => `${i + 1}쪽 ${k + 1}문장.`).join(' '), ...(marks.includes(i + 1) ? {spread: true} : {})}));
const words = (rows) => rows.map((p) => p.ko).join(' ').replace(/\s+/g, '');

test('R55e the page cap comes from the spec (5 for a picture-led K2 book); a join that would exceed it releases a spread mark instead', () => {
  const input = roomInput('e1');
  assert.equal(W.pageSentenceCap(input.specs.ko), 5);
  assert.equal(W.pageSentenceCap({}), null);
  // Opus's case: 16 entries of 4 sentences, two marks (7, 12) → 14 would need two joins of 8 sentences; both marks are released instead, the words untouched.
  const opus = pages(16, 4, [7, 12]);
  const fit = W.fitSpreadMarks(opus, 8, {cap: 5});
  assert.equal(fit.pages.length, 16);
  assert.equal(fit.marks, 0);
  assert.equal(fit.moved, 2);
  assert.equal(fit.fitted, true);
  assert.equal(words(fit.pages), words(opus));
  assert.ok(fit.pages.every((p) => p.ko.split('문장.').length - 1 <= 5), 'no page over the cap');
  // Without a cap the old behaviour joins (and the result is what the third A/B printed: an 8-sentence page).
  const old = W.fitSpreadMarks(opus, 8);
  assert.equal(old.pages.length, 14);
  assert.ok(old.pages.some((p) => p.ko.split('문장.').length - 1 === 8));
  // Short pages still join: 16 entries of 2 sentences, two marks → 14 with two 4-sentence pages, marks kept.
  const short = W.fitSpreadMarks(pages(16, 2, [7, 12]), 8, {cap: 5});
  assert.equal(short.pages.length, 14);
  assert.equal(short.marks, 2);
  assert.equal(short.moved, 0);
  // Mixed: only pages 1–2 are short enough to join. The first join fits, the second does not, and the parity
  // step cannot split-and-join under the cap either, so marks are released until the count and parity fit —
  // never a page over the cap, never a word moved.
  const mixed = pages(16, 4, [7, 12]).map((p, i) => (i < 2 ? {...p, ko: `${i + 1}쪽 1문장. ${i + 1}쪽 2문장.`} : p));
  const m = W.fitSpreadMarks(mixed, 8, {cap: 5});
  assert.equal(m.fitted, true);
  assert.ok(m.moved >= 1);
  assert.equal(words(m.pages), words(mixed));
  assert.ok(m.pages.every((p) => p.ko.split('문장.').length - 1 <= 5), 'no page over the cap');
  assert.equal(m.pages.length, 16 - m.marks);
});

test('R55e the anthropic writer\'s room rows are 1.6× longer; openai\'s are as before', () => {
  const openai = estimateStoryTextCost({settings: {engine: 'openai'}, pageCount: 16, diet: true, editor: true, room: true});
  const anthropic = estimateStoryTextCost({settings: {engine: 'anthropic'}, pageCount: 16, diet: true, editor: true, room: true});
  const row = (est, stage) => est.stages.find((s) => s.stage === stage);
  const out = (est, stage) => Number(row(est, stage).outputTokensEstimated);
  // Both providers' writers are reasoning models (×2); the anthropic rows add ×1.6 on top.
  assert.ok(out(anthropic, 'roomDrafts') >= Math.floor(out(openai, 'roomDrafts') * 1.5), `${out(anthropic, 'roomDrafts')} vs ${out(openai, 'roomDrafts')}`);
  const total = (est) => est.stages.reduce((sum, r) => sum + (Number(r.costUsd) || 0), 0);
  assert.ok(total(anthropic) > 0.71 * 1.2, `anthropic K2 16쪽 estimate ${total(anthropic).toFixed(3)} should now sit above the third A/B's $0.71 with room to spare`);
  assert.ok(Math.abs(total(openai) - 1.704) < 0.01, 'openai rows unchanged by R55e (R55h: + the cast notes, $1.188 → $1.288; R56: + the staged room, → $1.704)');
  const before = estimateStoryTextCost({settings: {engine: 'openai'}, pageCount: 16, diet: true, editor: true, room: true, roomWeave: false});
  assert.ok(Math.abs(total(before) - 1.188) < 0.01, 'a room job frozen before R55h is priced as before');
  assert.ok(out(anthropic, 'roomPremises') > out(openai, 'roomPremises'));
  assert.equal(row(openai, 'roomDrafts').requestCount, 3);
});

test('R55e two drafts with the same title are told apart in the record', async () => {
  const input = roomInput('e3');
  const PREMISE = {title: '꽃 뒤에', line: 'l', engine: 'want_try_turn', laugh: 'x', picture: 'y', cast: []};
  const outline = {...W.roomOutline(input, {premise: PREMISE, pitches: []}), writersRoom: {kind: 'writersRoom', version: 1, chosen: 1, premise: PREMISE, pitches: [], premises: [PREMISE]}};
  const reply = (json) => ({json, usage: {input: 1, output: 1}, meta: {requests: 1, model: 'mock'}});
  const page = (i) => ({ko: `${i}쪽이에요.`, en: `Page ${i}.`});
  let n = 0;
  const engine = {id: 'openai', async complete(r) {
    const props = r.jsonSchema?.properties || {};
    if (props.notes) return reply({notes: []}); // R55h: the cast speaks first; nothing readable here leaves the drafts without notes
    if (props.readers) return reply({readers: ['action', 'laugh', 'heart', 'eye', 'ours', 'parent'].map((reader) => ({reader, favorite: 1, again: true, drafts: [1, 2, 3].map((d) => ({draft: d, skipPage: 1, lostPage: 0, laughPages: [], change: '', hardPage: 0, mannersPage: 0}))}))});
    if (props.pages?.items?.properties?.en && !props.pages?.items?.properties?.ko) return reply({pages: Array.from({length: Number(props.pages.minItems)}, (_, i) => ({en: `Page ${i + 1}.`}))});
    n += 1;
    return reply({title: n === 3 ? '다른 제목' : '꽃 뒤에 다 숨었지', pages: [1, 2, 3, 4, 5, 6, 7, 8].map(page)});
  }};
  const result = await W.runRoomDrafts(input, outline, {engine, engineId: 'openai', qualityEngines: {prose: engine, cheap: engine}, roomRewrite: false, roomPolish: false}, {engineFor: () => engine});
  assert.deepEqual(result.data.room.drafts.map((d) => d.title), ['꽃 뒤에 다 숨었지', '꽃 뒤에 다 숨었지 (2)', '다른 제목']);
  assert.equal(result.data.title, '꽃 뒤에 다 숨었지', 'the chosen draft keeps its own title');
});
