import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {seedState} from '../dist/engine.js';
import {migrateWorldState, sceneGenerationRequest} from '../dist/image-generation/world.js';
import {effectiveStaging, pagePlan} from '../dist/image-generation/scene-prompt.js';
import {referencePolicy} from '../dist/image-generation/reference-policy.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {normalizeStoryInput} from '../dist/story-generation/pipeline.js';
import {pocketOf} from '../dist/text-pocket.js';
import {plainBackdropFor} from '../dist/story-generation/story-drama.js';
import * as W from '../dist/story-generation/writers-room.js';

/*
 * R55f (2026-11-09): Codex's paid illustrated book (R55e, 'rhsdl') read on paper
 * and in pictures: the binding joined the last two pages into 5 Korean / 6
 * English sentences (the join checked Korean only); the fawn's card carried a
 * human hair and skin colour and its sheet came out as a child's face on a
 * deer; an absent character stood in 5 of 15 pictures; fifteen pictures used
 * three cameras because the plan was per beat and every "middle" became the
 * same medium shot; the forest page took the home reference because the beat's
 * place was home.
 */
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };
const wizard = {characterIds: ['yuha', 'mom'], backgroundIds: ['home', 'forest'], topic: '숲속에서 자꾸 숨는 아기 사슴', pageCount: 16, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual'};
/* R59 moved new drafts to weave 4 (one draft, the app's text fields) and pictureRefs 2 (request hygiene); this file pins the room as R58 left it. */
const asR58 = (input) => ({...input, writersRoom: {...input.writersRoom, weave: 3}, ...(input.pictureRefs ? {pictureRefs: {version: 1}} : {})});
const roomInput = (id) => asR58(normalizeStoryInput({...inputFromWizard(setup(), wizard, {layout: 'openings'}).input, bookId: id}));
const sentences = (t) => String(t || '').split(/(?<=[.!?…][”"]?)\s+/u).filter(Boolean).length;

test('R55f the binding caps the English of a joined page too (Codex\'s manuscript: no page over 5 Korean or 4 English sentences, every word kept)', () => {
  const f = JSON.parse(readFileSync(new URL('../QA/r55e-paid/source-draft.json', import.meta.url), 'utf8'));
  assert.deepEqual([f.koCap, f.enCap, f.openings], [5, 4, 8]);
  const old = W.fitSpreadMarks(structuredClone(f.draft), f.openings, {cap: f.koCap});
  assert.equal(Math.max(...old.pages.map((p) => sentences(p.en))), 6, 'the defect: 6 English sentences on one page');
  const fit = W.fitSpreadMarks(structuredClone(f.draft), f.openings, {cap: f.koCap, capEn: f.enCap});
  assert.ok(Math.max(...fit.pages.map((p) => sentences(p.ko))) <= 5);
  assert.ok(Math.max(...fit.pages.map((p) => sentences(p.en))) <= 4);
  assert.equal(fit.fitted, true);
  const words = (rows, k) => rows.map((p) => p[k]).join(' ').replace(/\s+/g, '');
  assert.equal(words(fit.pages, 'ko'), words(f.draft, 'ko'));
  assert.equal(words(fit.pages, 'en'), words(f.draft, 'en'));
  const input = roomInput('f1');
  assert.equal(W.pageSentenceCap(input.specs.en), 4, 'E2 page cap from the spec');
});

test('R55f an animal card carries no human hair or skin colour and says it is a real animal; a child card is as before', () => {
  const fawn = W.roomCastRecord({name: '콩이', nameEn: 'Kongi', kind: 'deer', look: 'tiny fawn, tan coat with white spots', want: 'w', flaw: 'f'}, {id: 'c1', jobId: 'j', now: '2026-11-09T00:00:00.000Z'});
  assert.equal(fawn.kind, 'deer');
  assert.equal(fawn.hairColor, '');
  assert.equal(fawn.skinColor, '');
  assert.match(fawn.description, /^tiny fawn, tan coat with white spots — a real deer: animal head, face and body \(no human face, hair or skin\)$/);
  assert.equal(fawn.appearance, fawn.description);
  const kid = W.roomCastRecord({name: '솔이', nameEn: 'Sol', kind: 'child', look: 'small girl with two braids'}, {id: 'c2', jobId: 'j'});
  assert.deepEqual([kid.kind, kid.hairColor, kid.skinColor, kid.description], ['child', '#493b34', '#edceb3', 'small girl with two braids']);
});

test('R55f the reading settles per page: the first-named supplied place becomes the page\'s place id and each page keeps its own picture plan', () => {
  const input = roomInput('f2');
  assert.equal(W.placeIdIn('forest and home', input.backgrounds), 'forest');
  assert.equal(W.placeIdIn('home, by the window', input.backgrounds), 'home');
  assert.equal(W.placeIdIn('the salon', input.backgrounds), '');
  const outline = W.roomOutline(input, {premise: {title: 't', line: 'l', cast: []}, pitches: []});
  const row = (i, extra) => ({pageNo: i, who: ['yuha'], where: i === 2 ? 'forest and home' : 'home', action: `a ${i}`, emotion: 'happy', timeOfDay: 'day', props: [], shot: 'middle', space: 'full', carrier: 'both', focus: `f ${i}`, backdrop: 'scene', pocket: 'left', ...extra});
  const settled = W.settleExtraction({pages: [row(1, {}), row(2, {shot: 'close', pocket: 'none'}), row(3, {backdrop: 'plain', carrier: 'words'})]}, input, outline, [{ko: '가.'}, {ko: '나.'}, {ko: '다.'}], 't');
  assert.deepEqual(settled.pages.map((p) => p.scene.where), ['home', 'forest', 'home']);
  assert.deepEqual(settled.pages.map((p) => p.picturePlan.shot), ['middle', 'close', 'middle']);
  assert.deepEqual(settled.pages.map((p) => p.picturePlan.pocket), ['left', undefined, 'left'], 'none is no pocket');
  assert.deepEqual(settled.pages.map((p) => p.picturePlan.backdrop), [undefined, undefined, 'plain']);
  assert.equal(settled.pages[2].picturePlan.carrier, 'words');
});

test('R55f the picture request reads the page\'s own plan, keeps the rotation\'s camera for a middle distance, and names the characters that are not on the page', () => {
  const state = setup();
  const input = roomInput('f3');
  const page = (i, who, shot, extra = {}) => ({pageNo: i, ko: `${i}쪽.`, en: `Page ${i}.`, beatIndex: 1, scene: {who, where: 'home', action: `a ${i}`, emotion: 'happy', timeOfDay: 'day', props: []}, staging: {shot, characterSide: 'left'}, ...extra});
  const outline = {beats: [{index: 1, type: 'setup', summary: 's', settingKey: 'home', characters: ['yuha'], picturePlan: {version: 1, carrier: 'both', shot: 'close', pocket: 'right'}}], settings: [{beatIndex: 1, backgroundId: 'home'}]};
  const mk = (marker) => ({id: 'b', title: 't', characterIds: ['yuha', 'mom'], backgroundIds: ['home'], language: 'bilingual', outline, storyInput: {...input, ...(marker ? {} : {pictureRefs: undefined})}, sceneBriefs: [],
    pages: [page(1, ['yuha'], 'high_angle', {picturePlan: {version: 1, carrier: 'both', shot: 'middle', pocket: 'left', focus: 'the gate'}}), page(2, ['yuha', 'mom'], 'wide', {picturePlan: {version: 1, carrier: 'picture', shot: 'wide', backdrop: 'plain'}, backdrop: 'plain'})]});
  const refs = mk(true), plain = mk(false);
  assert.equal(pagePlan(refs, refs.pages[0]).pocket, 'left', 'the page plan wins over the beat plan');
  assert.equal(pocketOf(refs, refs.pages[0]).side, 'left');
  assert.equal(effectiveStaging(refs, refs.pages[0]).shot, 'high_angle', 'middle keeps the rotation camera on a pictureRefs book');
  assert.equal(effectiveStaging(plain, plain.pages[0]).shot, 'medium', 'a book without the marker maps middle to medium as before');
  assert.equal(plainBackdropFor(refs, refs.pages[1]), true);
  const req = sceneGenerationRequest(state, refs, 0, {quality: 'final'});
  assert.match(req.prompt, /Not in this picture: Mom — the earlier-page and style reference images may show them; draw none of them here\./);
  assert.match(req.prompt, /gentle high-angle shot/);
  assert.doesNotMatch(sceneGenerationRequest(state, refs, 1, {quality: 'final'}).prompt, /Not in this picture/, 'both on the page: nobody absent');
  assert.doesNotMatch(sceneGenerationRequest(state, plain, 0, {quality: 'final'}).prompt, /Not in this picture/, 'no marker: unchanged');
});
