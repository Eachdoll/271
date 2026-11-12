import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {migrateWorldState, sceneGenerationRequest} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {normalizeStoryInput} from '../dist/story-generation/pipeline.js';
import {pictureLettering, picturePlanPictureLine, picturePlanText, planLettering} from '../dist/story-generation/picture-plan.js';
import * as W from '../dist/story-generation/writers-room.js';

/*
 * R58 (2026-11-10): "with that ban the rocket cannot say Apollo 13?" It could
 * not — the picture request has always said "no words", and R56a told the
 * writer so. Two things had been lumped together: explanatory lettering (a
 * caption, a count in a corner) stays out; writing that is on a thing in the
 * story's world (a rocket's name, a bus number, a sign) is allowed, one per
 * picture, in digits and capital Latin letters only (the parent's choice — a
 * picture model garbles Hangul). The reading returns it per page with the
 * thing it is on; the picture request names it as the only writing.
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizard = {characterIds: ['yuha', 'mom'], backgroundIds: ['home', 'forest'], topic: '아폴로 13호 로켓을 타고 달에 가기', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual'};
// R63: pinned to weave 6 — a weave 7 picture request opens with THIS PAGE MUST SHOW (tests/writers-room-r62.test.mjs).
const roomInput = (id, extra = {}) => normalizeStoryInput({...inputFromWizard(setup(), {...wizard, ...extra}, {layout: 'openings'}).input, bookId: id, writersRoom: {version: 1, weave: 6}});

test('R58 lettering is digits and capital Latin letters, twelve at most; Hangul is dropped and a longer string is no lettering at all', () => {
  assert.equal(pictureLettering('Apollo 13'), 'APOLLO 13');
  assert.equal(pictureLettering('13'), '13');
  assert.equal(pictureLettering(' bus-7 '), 'BUS-7');
  assert.equal(pictureLettering('아폴로 13호'), '13', 'the number of a Korean name survives');
  assert.equal(pictureLettering('가나다'), '');
  assert.equal(pictureLettering('A VERY LONG NAME 123'), '', 'never cut — half a name is a wrong name');
  assert.equal(pictureLettering('- -'), '');
  assert.equal(pictureLettering(null), '');
  assert.equal(planLettering({lettering: 'apollo 13', letteringOn: 'on the rocket'}), 'APOLLO 13');
  assert.equal(planLettering({lettering: 'APOLLO 13'}), '', 'lettering without the thing it is on is none');
  assert.equal(planLettering(null), '');
});

test('R58 the writer hears the difference; the reading asks for the lettering and the thing it is on (picture-led drafts only)', () => {
  const input = roomInput('l1');
  const PREMISE = {title: 't', line: 'l', engine: 'e', laugh: 'x', picture: 'y', cast: []};
  for (const system of [W.draftRequest(input, PREMISE).system, W.treatmentRequest(input, PREMISE).system, W.rewriteRequest(input, {title: 't', pages: [{ko: '가.'}]}, '').system]) {
    assert.match(system, /그림에는 설명하는 글자나 숫자\(자막, 귀퉁이의 표시\)를 넣을 수 없어요/);
    assert.match(system, /물건에 원래 적혀 있는 짧은 글자\(로켓의 이름, 버스 번호, 간판\)는 한 그림에 하나까지 돼요 — 숫자와 영문 대문자만, 그림 메모에 따옴표로 그대로 적어요\("13", "APOLLO 13"\)\./);
  }
  const outline = W.roomOutline(input, {premise: PREMISE, pitches: []});
  const req = W.extractRequest(input, outline, [{ko: '가.'}]);
  const props = req.jsonSchema.properties.pages.items.properties;
  assert.deepEqual([props.lettering.maxLength, props.letteringOn.maxLength], [24, 80]);
  assert.match(req.system, /lettering \(only when the words or the art note put writing on a thing in the story's world — a rocket's name, a bus number, a shop sign: the exact characters, digits and capital Latin letters only, 12 at most, one per page; a Korean name is given by its number or its English capitals \(아폴로 13호 → APOLLO 13\); "" otherwise\) and letteringOn \(/);
  assert.equal('lettering' in W.extractRequest(roomInput('l2', {bookFormatId: 'wordy'}), outline, [{ko: '가.'}]).jsonSchema.properties.pages.items.properties, false);
});

test('R58 the page plan carries the lettering; the picture request names it as the only writing and keeps the ban on every other word; a page without it is unchanged', () => {
  const state = setup();
  const input = roomInput('l3');
  const outline = W.roomOutline(input, {premise: {title: 't', line: 'l', cast: []}, pitches: []});
  const row = (i, extra = {}) => ({pageNo: i, who: ['yuha'], where: 'home', action: `Yuha looks up at the rocket, page ${i}.`, emotion: 'excited', timeOfDay: 'day', props: ['rocket'], shot: 'wide', space: 'full', carrier: 'both', focus: 'the rocket', backdrop: 'scene', pocket: 'bottom', hidden: '', holdBack: '', lettering: '', letteringOn: '', ...extra});
  const settled = W.settleExtraction({pages: [
    row(1, {lettering: 'Apollo 13', letteringOn: 'on the side of the rocket'}),
    row(2),
    row(3, {lettering: '아폴로', letteringOn: 'on the side of the rocket'}),
    row(4, {lettering: 'APOLLO 13', letteringOn: ''}),
  ]}, input, outline, [1, 2, 3, 4].map((i) => ({ko: `${i}쪽.`, en: `Page ${i}.`})), 't');
  const [p1, p2, p3, p4] = settled.pages;
  assert.deepEqual([p1.picturePlan.lettering, p1.picturePlan.letteringOn], ['APOLLO 13', 'on the side of the rocket']);
  assert.equal('lettering' in p2.picturePlan, false);
  assert.equal('lettering' in p3.picturePlan, false, 'Hangul only: no lettering');
  assert.equal('lettering' in p4.picturePlan, false, 'no thing to carry it: no lettering');
  assert.match(picturePlanPictureLine(p1.picturePlan), /LETTERING — the only writing in this picture: "APOLLO 13" on the side of the rocket, in plain block capitals, spelled exactly as given; no other letters or numbers anywhere/);
  assert.doesNotMatch(picturePlanPictureLine(p2.picturePlan), /LETTERING/);
  assert.ok(picturePlanText(p1.picturePlan).includes('APOLLO 13'));
  const pages = settled.pages.map((p) => ({...p, ko: p.textKo, en: p.textEn, staging: {shot: 'wide', characterSide: 'left'}}));
  const book = {id: 'l3', title: 't', characterIds: ['yuha', 'mom'], backgroundIds: ['home', 'forest'], language: 'bilingual', storyInput: input, outline, sceneBriefs: [], pages};
  const with13 = sceneGenerationRequest(state, book, 0, {quality: 'final'}).prompt, without = sceneGenerationRequest(state, book, 1, {quality: 'final'}).prompt;
  assert.match(with13, /^COMPOSITION FIRST[^\n]*LETTERING — the only writing in this picture: "APOLLO 13"/);
  assert.match(with13, /No words, captions, watermark or logos other than the one piece of lettering named in the picture plan\./);
  assert.doesNotMatch(with13, /No words, captions, watermark or logos\.(?! other)/);
  assert.match(without, /No words, captions, watermark or logos\./);
  assert.doesNotMatch(without, /LETTERING|other than the one piece/);
});
