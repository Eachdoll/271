import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {seedState} from '../dist/engine.js';
import {migrateWorldState, sceneGenerationRequest} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {normalizeStoryInput} from '../dist/story-generation/pipeline.js';
import {referencePolicy, hasReferencePolicy, hasReferenceHygiene, castWithin} from '../dist/image-generation/reference-policy.js';
import {estimateStoryTextCost, jobTextBudget} from '../dist/text-generation/models.js';
import {layoutOf} from '../dist/book-layout.js';
import * as W from '../dist/story-generation/writers-room.js';

/*
 * R59 (2026-11-10): the parent — "remove the six contradictions, then reduce
 * the three drafts to one". What three reviewers agreed from the paid run:
 * the rewrite was never shown the spread marks (three in, none out), the
 * three drafts were one book, the readers' echo question was answered yes by
 * all six for all three drafts, one reader's complaint erased the book's only
 * line spoken to the child, the cheap reading picked text fields that 4 of 11
 * pictures could hold, every text-field request also said "the text is
 * printed below", and a page with only the fawn named the hero five or six
 * times. A new room draft is weave 4 and pictureRefs 2; older jobs keep their
 * requests (the R53–R58 tests pin them through asR58).
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizard = {characterIds: ['yuha', 'mom'], backgroundIds: ['home', 'forest'], topic: '숲속에서 자꾸 숨는 아기 사슴', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual'};
/* R60 moved new drafts to weave 5; this file pins weave 4 (R59). */
const roomInput = (id) => ((i) => ({...i, writersRoom: {...i.writersRoom, weave: 4}}))(normalizeStoryInput({...inputFromWizard(setup(), wizard, {layout: 'openings'}).input, bookId: id}));
const PREMISE = {title: '쉿, 콩이', line: '콩이는 늘 유하 등 뒤에 있어요', engine: 'reader_knows', laugh: '엄마도 못 찾아요', picture: '등 뒤의 작은 뿔', cast: [
  {name: '유하', isNew: false, want: '콩이를 찾고 싶다', flaw: '뒤를 안 본다', speech: '"어디 갔지?"', nameEn: '', kind: '', look: ''},
  {name: '엄마', isNew: false, want: '빨래를 걷고 싶다', flaw: '바쁘다', speech: '"응, 그래."', nameEn: '', kind: '', look: ''}]};
const outlineOf = (input) => ({...W.roomOutline(input, {premise: PREMISE, pitches: []}), writersRoom: {kind: 'writersRoom', version: 1, chosen: 1, premise: PREMISE, pitches: [], premises: [PREMISE]}});
const R56 = JSON.parse(readFileSync(new URL('../QA/r56-room-ab/anthropic.json', import.meta.url), 'utf8'));
const savedAnswer = (i) => {
  const e = R56.exchanges[i], v = JSON.parse(String(e.answer || e.text)), tool = (v.content || []).find((c) => c.type === 'tool_use');
  if (tool) return tool.input;
  const t = String(e.text || '');
  return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
};

test('R59 the markers: a new room draft is weave 4 (lean, still wide and staged) and pictureRefs 2 (request hygiene); normalize keeps 1–4 and 1–2', () => {
  const input = roomInput('m1');
  assert.deepEqual(input.writersRoom, {version: 1, weave: 4});
  assert.deepEqual(normalizeStoryInput({...inputFromWizard(setup(), wizard, {layout: 'openings'}).input, bookId: 'm1b'}).writersRoom, {version: 1, weave: 6}, 'R60: a new draft is weave 5');
  assert.deepEqual(input.pictureRefs, {version: 2});
  assert.deepEqual(referencePolicy(), {version: 2});
  assert.equal(W.hasRoomLean(input) && W.hasRoomWide(input) && W.hasRoomStages(input) && W.hasRoomWeave(input), true);
  assert.equal(W.hasRoomLean({...input, writersRoom: {version: 1, weave: 3}}), false);
  for (const v of [1, 2]) assert.deepEqual(normalizeStoryInput({...input, pictureRefs: {version: v}}).pictureRefs, {version: v});
  assert.equal(hasReferencePolicy({pictureRefs: {version: 1}}) && hasReferencePolicy({pictureRefs: {version: 2}}), true);
  assert.equal(hasReferenceHygiene({pictureRefs: {version: 1}}), false);
  assert.deepEqual(W.writersRoomRef({version: 1, weave: 4}), {version: 1, weave: 4});
});

test('R59 spread marks: the rewrite is shown them, and a page it returned word for word gets its mark back (replayed on the paid R56 run: 0 → 2)', () => {
  const input = roomInput('m2');
  const drafts = [8, 9, 10].map(savedAnswer), rewrite = savedAnswer(13), before = drafts[R56.draft.room.chosen - 1].pages;
  assert.deepEqual(drafts.map((d) => d.pages.filter((p) => p.spread).length), [3, 3, 3], 'the writer marked three spreads in every draft');
  assert.equal(rewrite.pages.filter((p) => p.spread).length, 0, 'the recorded rewrite returned none');
  const req = W.rewriteRequest(input, {title: 't', pages: before}, '(없음)');
  assert.equal((req.user.match(/쪽 \(큰 그림\):/gu) || []).length, 3, 'the manuscript line carries the mark now');
  assert.match(req.system, /\(큰 그림\)은 그 쪽이 두 쪽에 걸친 큰 그림 한 장이라는 표시예요/);
  const old = W.rewriteRequest({...input, writersRoom: {version: 1, weave: 3}}, {title: 't', pages: before}, '(없음)');
  assert.doesNotMatch(old.user, /큰 그림/, 'a weave 3 job keeps its request');
  const kept = W.keepSpreadMarks(before, rewrite.pages);
  assert.equal(kept.restored, 2);
  assert.deepEqual(kept.pages.map((p, i) => (p.spread ? i + 1 : 0)).filter(Boolean), [8, 13]);
  assert.deepEqual(W.keepSpreadMarks([{ko: '가', spread: true}], [{ko: '나'}]), {pages: [{ko: '나'}], restored: 0}, 'a page the rewrite changed is the writer\'s to re-decide');
});

test('R59 the readers: no echo or "would not miss" question, a change names its page and reaches the writer only when two readers name it (the paid run: 6 heard → 1 passed on)', () => {
  const input = roomInput('m3');
  const req = W.panelReadRequest(input, [{title: '책', pages: [{ko: '1쪽'}, {ko: '2쪽'}]}]);
  const item = req.jsonSchema.properties.readers.items.properties.drafts.items;
  assert.ok(item.required.includes('changePage'));
  assert.equal(['echoFrom', 'echoTo', 'echo', 'flat'].some((k) => k in item.properties), false);
  assert.doesNotMatch(req.system, /아, 그거!|빠져도 이야기가 그대로일 인물/);
  assert.match(req.system, /각자 이 책을 또 읽어 달라고 할지/, 'one book: nothing to choose between');
  // The saved R56 answers (three drafts, before changePage): the page each change names stands in for it.
  const read = savedAnswer(11);
  const paged = {readers: read.readers.map((r) => ({...r, drafts: r.drafts.map((d) => ({...d, changePage: Number((/(\d+)쪽/u.exec(d.change || '') || [])[1]) || 0}))}))};
  const before = W.countReadings(read, 3), after = W.countReadings(paged, 3, {agree: true});
  assert.equal(before[0].words.length, 6);
  assert.equal(after[0].words.length, 1);
  assert.match(after[0].words[0], /^5쪽 — /, 'two readers named the same line on page 5');
  assert.equal(after[0].heard, 6);
  assert.deepEqual(before.map((r) => r.echoes), [6, 6, 6], 'every reader answered yes for every draft — the question did not tell drafts apart');
});

test('R59 one draft: cast → three flows → the pick → the cast revised → ONE draft → the read; the thread check runs only when the readers asked for a rewrite and cannot start one', async () => {
  const input = roomInput('m4'), outline = outlineOf(input);
  const reply = (json) => ({json, usage: {input: 10, output: 5}, meta: {requests: 1, model: 'mock'}});
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
  const run = async ({twoOnPage3}) => {
    const calls = [];
    const engine = {id: 'openai', async complete(req) {
      const k = kind(req);
      calls.push({k, req});
      if (k === 'cast') return reply({notes: [{name: '유하', today: '도토리를 줍는다', unsaid: '어제 울었다', habit: '돌멩이'}, {name: '엄마', today: '빨래', unsaid: '봤다', habit: '국자'}], ties: []});
      if (k === 'flow') return reply({flow: `흐름 ${/\[흐름 (\d)\/3/.exec(req.user)[1]}.`, plants: []});
      if (k === 'flowPick') return reply({readers: ['action', 'laugh', 'heart', 'eye', 'ours', 'parent'].map((reader) => ({reader, favorite: 2, second: 1, why: '궁금', lost: []}))});
      if (k === 'castRevise') return reply({notes: [{name: '유하', today: '도토리', unsaid: '울었다', habit: '돌멩이', turn: '뒤를 본다'}]});
      if (k === 'threads') return reply({kept: [], loose: [{what: '돌멩이', page: 2}], unplanted: []});
      if (k === 'read') return reply({readers: ['action', 'laugh', 'heart', 'eye', 'ours', 'parent'].map((reader, i) => ({reader, favorite: 1, again: true, drafts: [{draft: 1, skipPage: i + 1, lostPage: 0, laughPages: [], change: twoOnPage3 && i < 2 ? '3쪽 말이 길어요' : '', changePage: twoOnPage3 && i < 2 ? 3 : 0, hardPage: 0, mannersPage: 0}]}))});
      if (k === 'english') return reply({pages: Array.from({length: Number(req.jsonSchema.properties.pages.minItems)}, (_, i) => ({en: `Page ${i + 1}.`}))});
      if (k === 'rewrite') return reply({title: '고친 책', pages: Array.from({length: 8}, (_, i) => ({ko: i === 2 ? '짧아졌어요.' : `${i + 1}쪽이에요. 유하가 걸어요.`}))});
      return reply({title: '한 권', pages: Array.from({length: 8}, (_, i) => ({ko: `${i + 1}쪽이에요. 유하가 걸어요.`, ...(i === 1 ? {spread: true} : {})}))});
    }};
    const result = await W.runRoomDrafts(input, outline, {engine, engineId: 'openai', qualityEngines: {prose: engine, cheap: engine}, roomPolish: false}, {engineFor: () => engine});
    return {calls, result};
  };
  const quiet = await run({twoOnPage3: false});
  assert.deepEqual(quiet.calls.map((c) => c.k), ['cast', 'flow', 'flow', 'flow', 'flowPick', 'castRevise', 'draft', 'read', 'english'], 'one draft; the readers asked for nothing, so no thread check and no rewrite');
  assert.doesNotMatch(quiet.calls.find((c) => c.k === 'draft').req.user, /\[초고 \d\/\d/, 'one draft carries no "draft n of m" tail');
  assert.equal(quiet.result.data.room.rewriteSkipped, true);
  assert.equal(quiet.result.data.room.drafts.length, 1);
  assert.match(W.roomDraftLine(quiet.result.data), /^작가실 · 초고를 독자단이 읽고 고칠 곳이 없어 그대로 두고/);
  const asked = await run({twoOnPage3: true});
  assert.deepEqual(asked.calls.map((c) => c.k), ['cast', 'flow', 'flow', 'flow', 'flowPick', 'castRevise', 'draft', 'read', 'threads', 'rewrite', 'english']);
  const notes = asked.calls.find((c) => c.k === 'rewrite').req.user;
  assert.match(notes, /바꾸고 싶은 것: 3쪽 — 3쪽 말이 길어요 \/ 3쪽 말이 길어요/);
  assert.match(notes, /놓기만 하고 다시 쓰지 않은 것: 돌멩이/, 'the thread check rides along once the readers asked');
  assert.match(notes, /2쪽 \(큰 그림\):/);
  assert.deepEqual(asked.result.data.pages.map((p) => !!p.spread), [false, true, false, false, false, false, false, false], 'the unchanged page 2 keeps its mark');
  assert.deepEqual(asked.result.data.room.spreadMarks, {before: 1, after: 1, restored: 1});
});

test('R59 the text field is the app\'s: the reading is not asked for one; a wide page with short words gets the side away from the figure; others print below', () => {
  const input = roomInput('m5');
  const req = W.extractRequest(input, outlineOf(input), [{ko: '숲이에요.'}, {ko: '유하가 걸어요.'}]);
  assert.equal('pocket' in req.jsonSchema.properties.pages.items.properties, false);
  assert.ok('pocket' in W.extractRequest({...input, writersRoom: {version: 1, weave: 3}}, outlineOf(input), [{ko: '숲.'}]).jsonSchema.properties.pages.items.properties, 'a weave 3 job still asks');
  const page = (ko, shot, side, extra = {}) => ({textKo: ko, textEn: 'x', kind: 'page', side: 'left', picturePlan: {version: 1, carrier: 'both', shot, pocket: 'top'}, staging: {characterSide: side}, ...extra});
  const pagination = {pages: [page('숲이 조용해요.', 'wide', 'left'), page('숲이 조용해요.', 'wide', 'right'), page('숲이 조용해요.', 'close', 'left'), page('가'.repeat(80), 'wide', 'left'), page('숲.', 'wide', 'left', {backdrop: 'plain'})]};
  assert.equal(W.placeRoomPockets(pagination, input), 2);
  assert.deepEqual(pagination.pages.map((p) => p.picturePlan.pocket), ['right', 'left', undefined, undefined, undefined]);
});

test('R59 picture-request hygiene (pictureRefs 2): an earlier page rides along only when its cast is on this page; nobody absent is named; each thing is said once; version 1 keeps its request', async () => {
  const state = setup();
  const input = roomInput('m6');
  const outline = outlineOf(input);
  // A real openings pagination from the room's own page stage (a fake reading), so the opening sentences are the ones a book sends.
  const who = (i) => (i === 0 ? ['yuha', 'mom'] : i === 3 ? ['mom'] : ['yuha']);
  const engine = {id: 'openai', async complete(req) {
    const n = (req.user.match(/^\d+쪽:/gmu) || []).length;
    return {json: {title: 't', pages: Array.from({length: n}, (_, i) => ({pageNo: i + 1, who: who(i), where: 'home', action: `Moment ${i + 1}.`, emotion: 'calm', timeOfDay: 'day', props: ['ball'], shot: i === 2 ? 'close' : 'wide', space: 'airy', carrier: 'both', focus: i === 1 ? 'Mom at the door' : '', backdrop: 'scene', hidden: '', holdBack: '', lettering: '', letteringOn: ''})), cover: {title: 't', sceneAction: 'Yuha alone.'}}, usage: {input: 1, output: 1}, meta: {requests: 1}};
  }};
  const draft = {title: 't', pages: Array.from({length: 16}, (_, i) => ({ko: '유하가 걸어요.', en: 'Yuha walks.'}))};
  const pages = await W.runRoomPages(input, outline, draft, {engine, engineId: 'openai', qualityEngines: {cheap: engine}}, {engineFor: () => engine});
  const book = (refs) => ({id: 'b', title: 't', characterIds: ['yuha', 'mom'], backgroundIds: ['home'], language: 'bilingual', outline: pages.meta.outline, storyInput: {...input, pictureRefs: refs}, sceneBriefs: [],
    pages: pages.data.pages.map((p, i) => ({...p, ...(i < 4 ? {imageUrl: 'data:image/png;base64,dGVzdA=='} : {})}))});
  const v2 = book({version: 2}), v1 = book({version: 1});
  assert.equal(layoutOf(v2), 'openings');
  assert.equal(castWithin(v2.pages[0], v2.pages[4]), false, 'page 1 shows Mom, page 5 does not');
  const earlier = (req) => req.referenceImages.filter((r) => /SAME place, page/.test(r.label || '')).map((r) => r.sourcePageIndex ?? r.label);
  const r2 = sceneGenerationRequest(state, v2, 4, {quality: 'final'}), r1 = sceneGenerationRequest(state, v1, 4, {quality: 'final'});
  assert.ok(r1.referenceImages.some((r) => /CANONICAL first scene at SAME place, page 1/.test(r.label)), 'version 1: page 1 (with Mom) is the canonical reference');
  assert.equal(r2.referenceImages.some((r) => /page 1;/.test(r.label)), false, 'version 2: page 1 does not ride along');
  assert.ok(earlier(r2).length >= 1, 'an earlier page with only Yuha still does');
  assert.match(r1.prompt, /Not in this picture: Mom/);
  assert.doesNotMatch(r2.prompt, /\bMom\b/, 'version 2 names nobody who is not on the page');
  assert.match(r2.prompt, /Nobody else is in this picture/);
  assert.doesNotMatch(r2.prompt, /CAMERA VARIETY/);
  assert.equal((r2.prompt.replace(/FACING PAGE:[^.]*\./u, '').match(/wide establishing shot/g) || []).length, 1, 'this page\'s camera is said once (the facing page is named by its own camera)');
  assert.match(r1.prompt, /wide establishing shot; Yuha on the left side/, 'version 1 says it again in the opening sentence');
  assert.doesNotMatch(r2.prompt, /wide establishing shot; Yuha/);
  // A close view gets no earlier page at all.
  const close = sceneGenerationRequest(state, v2, 2, {quality: 'final'});
  assert.deepEqual(earlier(close), []);
  // A focus that names someone absent is dropped (page 2 shows Yuha; its focus named Mom).
  assert.doesNotMatch(sceneGenerationRequest(state, v2, 1, {quality: 'final'}).prompt, /Mom at the door/);
  assert.match(sceneGenerationRequest(state, v1, 1, {quality: 'final'}).prompt, /Mom at the door/);
  // A page with a text field is not also told that its words are printed below.
  const fielded = v2.pages.findIndex((p) => p.picturePlan?.pocket);
  assert.ok(fielded >= 0, 'the app gave at least one wide, short page a field');
  const fp = sceneGenerationRequest(state, v2, fielded, {quality: 'final'}).prompt;
  assert.match(fp, /TEXT FIELD: leave the (left|right) /);
  assert.doesNotMatch(fp, /Story text is printed below/);
});

test('R59 counted from the Korean words (the paid R56 book): who is named where, companions, words first heard in the last four pages, the flows\' likeness', () => {
  const cast = R56.outline.writersRoom.premise.cast.map((c, i) => ({id: `c${i}`, name: c.name}));
  const t = W.textWeave(R56.draft.pages, {cast});
  assert.deepEqual(t.castText.map((c) => [c.name, c.pages.length]), [['유하', 11], ['엄마', 3], ['콩콩이', 5]]);
  assert.deepEqual(t.castText[2].artOnly, [4, 8, 9, 11, 13, 15]);
  assert.equal(t.companions.length, 8);
  for (const w of ['도토리', '국자', '참나무']) assert.ok(t.lateWords.some((x) => x.word === w && x.artFirst), `${w}: first heard at the end, only in an art note before`);
  assert.equal(t.artShare, 1.34);
  const flows = R56.draft.room.treatments.map((x) => x.flow);
  assert.deepEqual([W.textLikeness(flows[0], flows[1]), W.textLikeness(flows[0], flows[2]), W.textLikeness(flows[1], flows[2])], [0.33, 0.3, 0.26]);
  assert.equal(W.weaveReport([], {returning: false}).returning, undefined, 'a lean room does not make the English last-word count');
});

test('R59 the estimate: one draft and a shorter read — 17 → 15 requests, openai $1.788 → $1.508, anthropic $1.319 → $1.114; a job frozen before R59 is priced as it was', () => {
  const base = {pageCount: 16, diet: true, editor: true, room: true};
  const total = (est) => est.stages.reduce((n, s) => n + (Number(s.costUsd) || 0), 0), requests = (est) => est.stages.reduce((n, s) => n + s.requestCount, 0);
  // R60: a weave 4 job (roomCounted: false) — a new job also drops the revised cast.
  const lean = estimateStoryTextCost({...base, settings: {engine: 'openai'}, roomCounted: false}), wide = estimateStoryTextCost({...base, settings: {engine: 'openai'}, roomLean: false});
  assert.deepEqual([requests(wide), requests(lean)], [17, 15]);
  assert.ok(Math.abs(total(wide) - 1.788) < 0.01 && Math.abs(total(lean) - 1.508) < 0.01, `${total(wide).toFixed(3)} ${total(lean).toFixed(3)}`);
  const a = estimateStoryTextCost({...base, settings: {engine: 'anthropic'}, roomCounted: false});
  assert.ok(Math.abs(total(a) - 1.114) < 0.01, total(a).toFixed(3));
  const job = (room) => ({status: 'running', input: {writersRoom: room, promptDiet: {version: 1}, pageCount: 16}, completed: {}, textSettings: {engine: 'openai'}, usage: {calls: []}});
  assert.ok(jobTextBudget(job({version: 1, weave: 3})).remainingUsd > jobTextBudget(job({version: 1, weave: 4})).remainingUsd);
});
