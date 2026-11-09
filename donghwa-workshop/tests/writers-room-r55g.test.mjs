import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {migrateWorldState, sceneGenerationRequest} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {normalizeStoryInput} from '../dist/story-generation/pipeline.js';
import {picturePlanPictureLine, picturePlanText} from '../dist/story-generation/picture-plan.js';
import * as W from '../dist/story-generation/writers-room.js';

/*
 * R55g (2026-11-09): the paid book's pictures broke the one thing the story
 * stood on — Kongi hides right behind Yuha and only the reader sees it — by
 * drawing the two side by side. The words knew; the picture request did not.
 * The reading (a cheap call over the finished text) now returns, per page and
 * only when the words say so, what the hero does not see and what the next
 * page reveals; the picture request repeats them. No rule reaches the writer.
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizard = {characterIds: ['yuha', 'mom'], backgroundIds: ['home', 'forest'], topic: '숲속에서 자꾸 숨는 아기 사슴', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual'};
const roomInput = (id, extra = {}) => normalizeStoryInput({...inputFromWizard(setup(), {...wizard, ...extra}, {layout: 'openings'}).input, bookId: id});

test('R55g the reading asks, per page, what the hero does not see and what the next page reveals — only for picture-led drafts, "" when the words say nothing', () => {
  const input = roomInput('g1');
  const outline = W.roomOutline(input, {premise: {title: 't', line: 'l', cast: []}, pitches: []});
  const req = W.extractRequest(input, outline, [{ko: '가.'}]);
  const props = req.jsonSchema.properties.pages.items.properties;
  assert.deepEqual([props.hidden.maxLength, props.holdBack.maxLength], [160, 120]);
  assert.ok(req.jsonSchema.properties.pages.items.required.includes('hidden'));
  assert.match(req.system, /hidden \(only when the words say someone does not see or notice something that the reader can/);
  assert.match(req.system, /holdBack \(only when the NEXT page reveals something this page must not show yet/);
  const wordy = roomInput('g2', {bookFormatId: 'wordy'});
  assert.equal('hidden' in W.extractRequest(wordy, outline, [{ko: '가.'}]).jsonSchema.properties.pages.items.properties, false, 'a wordy book plans no picture');
});

test('R55g the page plan carries them; the picture request says them; a page without them is unchanged', () => {
  const state = setup();
  const input = roomInput('g3');
  const outline = W.roomOutline(input, {premise: {title: 't', line: 'l', cast: []}, pitches: []});
  const row = (i, extra = {}) => ({pageNo: i, who: ['yuha'], where: 'forest', action: `Yuha looks for Kongi, page ${i}.`, emotion: 'curious', timeOfDay: 'day', props: [], shot: 'middle', space: 'full', carrier: 'both', focus: 'Yuha', backdrop: 'scene', pocket: 'bottom', hidden: '', holdBack: '', ...extra});
  const settled = W.settleExtraction({pages: [
    row(1, {hidden: 'Kongi crouches directly behind Yuha; Yuha faces forward and cannot see him', holdBack: 'their noses touching'}),
    row(2),
  ]}, input, outline, [{ko: '가.', en: 'A.'}, {ko: '나.', en: 'B.'}], 't');
  const [p1, p2] = settled.pages;
  assert.equal(p1.picturePlan.hidden, 'Kongi crouches directly behind Yuha; Yuha faces forward and cannot see him');
  assert.equal(p1.picturePlan.holdBack, 'their noses touching');
  assert.equal('hidden' in p2.picturePlan, false);
  const line = picturePlanPictureLine(p1.picturePlan);
  assert.match(line, /HIDDEN FROM THE HERO — the reader sees it, the hero does not: Kongi crouches directly behind Yuha; Yuha faces forward and cannot see him; keep it that way \(the hero looks away from it, no eye contact with it\)/);
  assert.match(line, /NOT YET: their noses touching is revealed on the next page — keep it out of this picture/);
  assert.doesNotMatch(picturePlanPictureLine(p2.picturePlan), /HIDDEN|NOT YET/);
  assert.ok(picturePlanText(p1.picturePlan).includes('their noses touching'), 'model-written text rides in the lenient word scope');
  // Through a real picture request.
  const pages = settled.pages.map((p, i) => ({...p, ko: p.textKo, en: p.textEn, staging: {shot: 'medium', characterSide: 'left'}}));
  const book = {id: 'g3', title: 't', characterIds: ['yuha', 'mom'], backgroundIds: ['home', 'forest'], language: 'bilingual', storyInput: input, outline, sceneBriefs: [], pages};
  const prompt = sceneGenerationRequest(state, book, 0, {quality: 'final'}).prompt;
  assert.match(prompt, /^COMPOSITION FIRST[^\n]*HIDDEN FROM THE HERO/);
  assert.match(prompt, /NOT YET: their noses touching/);
  assert.doesNotMatch(sceneGenerationRequest(state, book, 1, {quality: 'final'}).prompt, /HIDDEN FROM THE HERO|NOT YET/);
});
