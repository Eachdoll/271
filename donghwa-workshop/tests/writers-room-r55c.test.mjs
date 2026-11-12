import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {migrateWorldState, sceneGenerationRequest} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {normalizeStoryInput, generateOutline, toLegacyPages} from '../dist/story-generation/pipeline.js';
import {assertValid} from '../dist/story-generation/schemas.js';
import {planOf} from '../dist/story-generation/picture-plan.js';
import {pocketOf} from '../dist/text-pocket.js';
import {estimateStoryTextCost} from '../dist/text-generation/models.js';
import * as W from '../dist/story-generation/writers-room.js';

/*
 * R55c (2026-11-08, B-1 of the second A/B's improvements): a room book buys no
 * outline. The paid outline (an 18,000-character request) was never read by the
 * writer — the drafts come from the brief and the premise — and the pages met
 * its beats only by position, so its picture plan (shot, text field, plain
 * backdrop) described beats nobody wrote. Now the app writes a skeleton outline
 * from the chosen premise, the cheap picture reading returns the composition of
 * every page from the finished text, and the outline the pictures read is
 * rebuilt from the pages. The reading also turns staging on: a room book's
 * pages had none and fell back to the old picture prompt.
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizard = {characterIds: ['yuha', 'mom'], backgroundIds: ['home', 'beach'], topic: '바닷가에서 자꾸 숨는 아기 게', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual'};
/* R59 moved new drafts to weave 4 (one draft, the app's text fields) and pictureRefs 2 (request hygiene); this file pins the room as R58 left it. */
const asR58 = (input) => ({...input, writersRoom: {...input.writersRoom, weave: 3}, ...(input.pictureRefs ? {pictureRefs: {version: 1}} : {})});
const roomInput = (id, extra = {}, layout = 'openings') => asR58(normalizeStoryInput({...inputFromWizard(setup(), {...wizard, ...extra}, {layout}).input, bookId: id}));
const PREMISE = {title: '게야, 어디 있니?', line: '바닷가에서 아기 게가 자꾸 숨어요.', engine: 'reader_knows', laugh: '모래 속에서 집게만 보여요', picture: '큰 집게', cast: [{name: '유하', isNew: false, want: '게와 놀고 싶다', flaw: '서두른다', speech: '짧게', nameEn: '', kind: '', look: ''}, {name: '또각이', isNew: true, want: '숨고 싶다', flaw: '겁', speech: '집게만', nameEn: 'Ttogak', kind: 'crab', look: 'tiny red crab'}]};
const record = {premise: PREMISE, pitches: [{title: '게야, 어디 있니?'}, {title: '모래성 손님'}, {title: '파도 세기'}]};
const reply = (json) => ({json, usage: {input: 10, output: 5}, meta: {requests: 1, model: 'mock'}});
const page = (i) => ({ko: `${i}쪽이에요. 또각이가 숨어요.`, en: `Page ${i}. Ttogak hides.`});

test('R55c the skeleton outline: valid for the app\'s checks, the premise\'s titles and places, no model', () => {
  const input = roomInput('c1');
  const outline = W.roomOutline(input, record);
  assert.deepEqual(outline.titleCandidates, ['게야, 어디 있니?', '모래성 손님', '파도 세기']);
  assert.equal(outline.beats.length, 8, 'an openings book of 16 pages has 8 beats');
  assert.deepEqual(outline.beats.map((b) => b.type), ['setup', 'want', 'attempt', 'attempt', 'attempt', 'turn', 'resolution', 'close']);
  assert.ok(outline.settings.every((s) => s.backgroundId === 'home'), 'the parent\'s first place, until the pages say otherwise');
  assert.ok(outline.newWordsKo.length >= 3 && outline.newWordsKo.length <= 5, outline.newWordsKo.join());
  assert.equal(outline.endingType, input.endingType);
  assert.equal(outline.roomOutline.stage, 'skeleton');
  assert.doesNotThrow(() => assertValid('outline', outline, input));
  // A page book of 12 pages: 7 beats.
  const pagesInput = roomInput('c2', {pageCount: 12}, 'pages');
  assert.equal(W.roomOutline(pagesInput, record).beats.length, 7);
  assert.deepEqual(W.evenBeats([1, 2, 3], 7), [1, 1, 1, 2, 2, 3, 3]);
});

test('R55c generateOutline buys nothing for a room book: the room\'s two requests, then the skeleton with the record attached', async () => {
  const input = roomInput('c3');
  const calls = [];
  const engine = {id: 'openai', async complete(req) {
    calls.push(req);
    const props = req.jsonSchema?.properties || {};
    if (props.premises) return reply({premises: Array.from({length: 12}, (_, i) => ({...PREMISE, title: `전제 ${i + 1}`, laugh: `웃음 ${i + 1}`, engine: i % 2 ? 'escalation' : 'reader_knows'}))});
    if (props.readers) return reply({readers: ['action', 'laugh', 'heart', 'eye', 'ours', 'parent'].map((reader) => ({reader, picks: [{premise: 1, why: 'laugh', word: '좋아'}, {premise: 2, why: 'curious', word: '또'}, {premise: 3, why: 'again', word: '응'}]}))});
    throw new Error(`unexpected request: ${req.system.slice(0, 60)}`);
  }};
  const result = await generateOutline(input, {engine, engineId: 'openai', qualityEngines: {prose: engine, cheap: engine, outline: engine}});
  assert.equal(calls.length, 2);
  assert.equal(result.meta.requests, 2);
  assert.equal(result.meta.roomOutline, true);
  assert.equal(result.data.writersRoom.premise.title, '전제 1');
  assert.equal(result.data.titleCandidates[0], '전제 1');
  assert.equal(result.data.roomOutline.stage, 'skeleton');
  assert.deepEqual(result.data.bookFormat, undefined);
  assert.equal(result.data.storyShape?.id, input.storyShape.id, 'the shape rides on it as before');
});

test('R55c the reading asks for the picture of every page (picture-led drafts only) and no beat; the finished outline is rebuilt from the pages; the pages get staging and the picture request reads the plan', async () => {
  const input = roomInput('c4');
  const outline = {...W.roomOutline(input, record), writersRoom: {kind: 'writersRoom', version: 1, chosen: 1, premise: PREMISE, pitches: record.pitches, premises: [PREMISE]}};
  const req = W.extractRequest(input, outline, [page(1)]);
  assert.deepEqual(req.jsonSchema.properties.pages.items.required, ['pageNo', 'who', 'where', 'action', 'emotion', 'timeOfDay', 'props', 'shot', 'space', 'carrier', 'focus', 'backdrop', 'pocket', 'hidden', 'holdBack', 'lettering', 'letteringOn']);
  assert.match(req.system, /shot \(wide = small figures in a big world; middle; close = faces and hands fill the frame/);
  assert.match(req.system, /pocket \(where the printed words sit on the picture/);
  assert.doesNotMatch(req.system, /beatIndex|\[beats\]/);
  const wordy = roomInput('c5', {bookFormatId: 'wordy'});
  assert.deepEqual(W.extractRequest(wordy, outline, [page(1)]).jsonSchema.properties.pages.items.required, ['pageNo', 'who', 'where', 'action', 'emotion', 'timeOfDay', 'props'], 'a wordy book plans no picture');
  // The run: 12 entries of a 16-page openings book (8 openings, 4 pairs).
  const calls = [];
  const engine = {id: 'openai', async complete(r) {
    calls.push(r);
    const n = Number(r.jsonSchema?.properties?.pages?.minItems || 0);
    return reply({cover: {title: '다른 제목', sceneAction: 'Yuha alone on the sand.'}, pages: Array.from({length: n}, (_, i) => ({
      pageNo: i + 1, who: i % 3 === 1 ? ['yuha', 'mom'] : ['yuha'], where: i < 4 ? 'home' : 'the beach (beach)', action: `Yuha looks for the crab, page ${i + 1}.`, emotion: i === 0 ? 'curious' : 'happy', timeOfDay: 'day', props: ['bucket'],
      shot: ['wide', 'middle', 'close'][i % 3], space: i % 2 ? 'airy' : 'full', carrier: i === 5 ? 'words' : 'both', focus: `the crab ${i + 1}`, backdrop: i === 6 || i === 11 ? 'plain' : 'scene', pocket: i === 2 ? 'none' : ['left', 'right', 'top', 'bottom'][i % 4],
    }))});
  }};
  const draft = {title: '게야, 어디 있니?', language: 'dual', pages: Array.from({length: 12}, (_, i) => ({pageNo: i + 1, ...page(i + 1), ...(i === 7 ? {spread: true} : {})}))};
  const result = await W.runRoomPages(input, outline, draft, {engine, engineId: 'openai', qualityEngines: {cheap: engine, prose: engine}}, {engineFor: () => engine});
  const shaped = result.meta.outline;
  assert.equal(shaped.roomOutline.stage, 'pages');
  assert.equal(shaped.beats.length, 8);
  assert.doesNotThrow(() => assertValid('outline', shaped, {...input, pageCount: result.meta.pageCount}));
  // Beat summaries are the pages' Korean; the places follow the pages (home first, then the beach).
  assert.match(shaped.beats[0].summary, /^1쪽이에요\. 또각이가 숨어요\./);
  assert.equal(shaped.settings[0].backgroundId, 'home');
  assert.equal(shaped.settings.at(-1).backgroundId, 'beach');
  assert.equal(shaped.beats.at(-1).settingKey, 'beach');
  assert.equal(shaped.emotionArc[0], 'curious');
  // The per-beat plan is the reading of the beat's first page (shot names mapped, pockets kept, the plain backdrop capped and never at the edges).
  // (The two-sentence pages with one spread mark were fitted to 15 entries, so the beats' first pages are not the mock's indexes 0, 1, 2 …)
  const pages = result.data.pages;
  const plans = shaped.beats.map((b) => planOf(shaped, b.index));
  assert.ok(plans.every(Boolean), 'every beat has a plan');
  const mockShot = ['wide', 'middle', 'close'], mockPocket = ['left', 'right', 'top', 'bottom'];
  shaped.beats.forEach((b, k) => {
    const first = pages.findIndex((p) => p.beatIndex === b.index);
    assert.ok(first >= 0);
    assert.ok(plans[k].shot === undefined || plans[k].shot === mockShot[first % 3], `beat ${b.index}: shot ${plans[k].shot} from page ${first + 1}`);
    assert.equal(plans[k].pocket, first === 2 ? undefined : mockPocket[first % 4], `beat ${b.index}: pocket from page ${first + 1}`);
    assert.equal(plans[k].carrier, first === 5 ? 'words' : 'both');
    assert.equal(plans[k].focus, `the crab ${first + 1}`);
  });
  assert.ok(plans.some((p) => p.shot !== undefined), 'shots survive the variety guard');
  assert.ok(plans.filter((p) => p.backdrop === 'plain').length <= 2);
  assert.equal(plans.at(-1).backdrop, undefined, 'the last beat is never plain');
  assert.equal(plans[0].backdrop, undefined, 'nor the first');
  // The pages carry staging (the picture requests' camera, side and light) and the dealt beats never go backwards.
  assert.ok(pages.every((p) => p.staging && p.staging.shot), 'R55c: staging on for room pages');
  for (let i = 1; i < pages.length; i++) assert.ok(pages[i].beatIndex >= pages[i - 1].beatIndex);
  assert.equal(result.data.cover.title, '게야, 어디 있니?');
  // A picture request for such a book reads the composition and the text field (not the old fallback prompt).
  const state = setup();
  const book = {id: 'c4', title: draft.title, characterIds: ['yuha', 'mom'], backgroundIds: ['home', 'beach'], language: 'bilingual', storyInput: {...input, pageCount: result.meta.pageCount}, outline: shaped, pagination: result.data, pages: toLegacyPages(result.data), sceneBriefs: []};
  const pocketed = book.pages.findIndex((p) => pocketOf(book, p));
  assert.ok(pocketed >= 0, 'some page has a text field');
  const prompt = sceneGenerationRequest(state, book, pocketed, {quality: 'final'}).prompt;
  assert.match(prompt, /^COMPOSITION FIRST \(decided with the story/);
  assert.match(prompt, /PICTURE PLAN \(decided with the story\)/);
  assert.match(prompt, /TEXT FIELD: leave the (?:left|right|top|bottom) \d{1,3}%/);
  assert.doesNotMatch(prompt, /^Illustrate page/);
});

test('R55c the estimate has no outline row for a room book; the old path keeps its outline row', () => {
  const room = estimateStoryTextCost({settings: {engine: 'openai'}, pageCount: 16, diet: true, editor: true, room: true});
  assert.ok(!room.stages.some((s) => s.stage === 'outline'));
  assert.equal(room.stages.length, 13, 'R55h: + the cast notes row; R56: + the flows, their pick, the revised cast, the thread check; R60: − the revised cast; R62: + the listener');
  const plain = estimateStoryTextCost({settings: {engine: 'openai'}, pageCount: 16, diet: true, editor: true, council: true, orchestration: true});
  assert.ok(plain.stages.some((s) => s.stage === 'outline'));
});

test('R55c-2 the reading\'s cast by name: a reader that writes "kongi" or "Uncle Bear" instead of the card ID still puts the character on the page (the third A/B\'s haiku did)', () => {
  const input = {...roomInput('c6'), characters: [{id: 'yuha', name: '유하', nameEn: 'Yuha'}, {id: 'mom', name: '엄마', nameEn: 'Mom'}, {id: 'character-1', name: '콩이', nameEn: 'Kongi'}, {id: 'character-2', name: '곰돌 아저씨', nameEn: 'Uncle Bear'}]};
  const outline = W.roomOutline(input, record);
  const raw = {pages: [{pageNo: 1, who: ['yuha', 'kongi'], where: 'home', action: 'a', emotion: 'happy', timeOfDay: 'day', props: []}, {pageNo: 2, who: ['uncle bear', 'Kongi', '곰돌 아저씨', 'nobody'], where: 'home', action: 'b', emotion: 'happy', timeOfDay: 'day', props: []}, {pageNo: 3, who: ['nobody'], where: 'home', action: 'c', emotion: 'happy', timeOfDay: 'day', props: []}]};
  const settled = W.settleExtraction(raw, input, outline, [page(1), page(2), page(3)], 't');
  assert.deepEqual(settled.pages.map((p) => p.scene.who), [['yuha', 'character-1'], ['character-2', 'character-1'], ['yuha']]);
});
