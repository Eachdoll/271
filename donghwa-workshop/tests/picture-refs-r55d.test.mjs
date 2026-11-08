import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {migrateWorldState, captureBookGenerationSnapshot, sceneGenerationRequest, commitSceneResult} from '../dist/image-generation/world.js';
import {previousSceneReferences} from '../dist/image-generation/scene-continuity.js';
import {referencePolicy, hasReferencePolicy, castSheetsForPage, pageCastIds} from '../dist/image-generation/reference-policy.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {normalizeStoryInput} from '../dist/story-generation/pipeline.js';
import {leanVisibleInput} from '../dist/story-generation/prompt-diet.js';

/*
 * R55d (2026-11-08): the roundtable's picture items with no paid cost. Every
 * page request used to carry every drawer sheet (a mother on two of fourteen
 * pages rode on all fourteen), and the recent-scene reference was the latest
 * same-place page from any camera. A pictureRefs book sends the page's cast
 * and prefers the latest same-place page from the same camera. Books without
 * the marker are unchanged.
 */
const png = 'data:image/png;base64,dGVzdA==';
const setup = () => { const s = seedState(); migrateWorldState(s); migrateReadingSettings(s.settings); return s; };

test('R55d helpers: the page cast, the sheets for it, the whole set when the page names nobody the sheets know', () => {
  assert.deepEqual(pageCastIds({scene: {who: ['yuha', 'mom', 'yuha', '']}}), ['yuha', 'mom']);
  assert.deepEqual(pageCastIds({}), []);
  const sheets = [{characterId: 'yuha'}, {characterId: 'mom'}, {characterId: 'greenie'}];
  assert.deepEqual(castSheetsForPage(sheets, {scene: {who: ['mom']}}).map((s) => s.characterId), ['mom']);
  assert.deepEqual(castSheetsForPage(sheets, {scene: {who: ['nobody']}}).map((s) => s.characterId), ['yuha', 'mom', 'greenie'], 'unknown cast: every sheet');
  assert.deepEqual(castSheetsForPage(sheets, {}).map((s) => s.characterId), ['yuha', 'mom', 'greenie']);
});

test('R55d a new draft freezes pictureRefs; normalize keeps it; the text models never see it', () => {
  const state = setup();
  const {input} = inputFromWizard(state, {characterIds: ['yuha', 'mom'], backgroundIds: ['home'], topic: '바닷가', pageCount: 12, koreanLevel: 'K2', englishLevel: 'E2', value: 'none', ending: 'home', language: 'bilingual'}, {layout: 'openings'});
  assert.deepEqual(input.pictureRefs, referencePolicy());
  const normalized = normalizeStoryInput({...input, bookId: 'p'});
  assert.ok(hasReferencePolicy(normalized));
  assert.equal(hasReferencePolicy(leanVisibleInput(normalized)), false);
  assert.equal('pictureRefs' in leanVisibleInput(normalized), false);
  assert.equal(hasReferencePolicy(normalizeStoryInput({...input, bookId: 'q', pictureRefs: undefined})), false, 'a draft without the marker stays without it');
});

function book(state, {marker}) {
  const sheets = captureBookGenerationSnapshot(state, {characterIds: ['yuha', 'mom'], backgroundIds: ['home'], pages: []}).characterSheets;
  assert.equal(sheets.length, 2, 'the seed carries confirmed sheets for yuha and mom');
  const pages = [
    {pageNo: 1, ko: '유하가 거실에서 숨어요.', en: 'Yuha hides.', scene: {who: ['yuha', 'mom'], where: 'home', action: 'Yuha hides behind the sofa while Mom reads.', timeOfDay: 'day'}, staging: {shot: 'wide', characterSide: 'left'}},
    {pageNo: 2, ko: '엄마가 찾아요.', en: 'Mom looks.', scene: {who: ['mom'], where: 'home', action: 'Mom looks under the table.', timeOfDay: 'day'}, staging: {shot: 'medium', characterSide: 'right'}},
    {pageNo: 3, ko: '유하가 웃어요.', en: 'Yuha laughs.', scene: {who: ['yuha'], where: 'home', action: 'Yuha laughs behind the curtain.', timeOfDay: 'day'}, staging: {shot: 'wide', characterSide: 'left'}},
    {pageNo: 4, ko: '둘이 함께 앉아요.', en: 'They sit together.', scene: {who: ['yuha'], where: 'home', action: 'Yuha sits on the sofa.', timeOfDay: 'day'}, staging: {shot: 'wide', characterSide: 'right'}},
  ];
  return {id: 'b-' + (marker ? 'refs' : 'plain'), title: '숨바꼭질', characterIds: ['yuha', 'mom'], backgroundIds: ['home'], language: 'bilingual', pages, ...(marker ? {storyInput: {pictureRefs: referencePolicy()}} : {})};
}

test('R55d a pictureRefs page carries only the sheets of its cast; a book without the marker carries every sheet (byte-identical to before)', () => {
  const state = setup();
  const plain = sceneGenerationRequest(state, book(state, {marker: false}), 1, {quality: 'final'});
  const refs = sceneGenerationRequest(state, book(state, {marker: true}), 1, {quality: 'final'});
  const fronts = (req) => req.referenceImages.filter((r) => r.role === 'character_front').map((r) => r.label);
  assert.deepEqual(fronts(plain), ['Yuha original face and identity', 'Mom original face and identity']);
  assert.deepEqual(fronts(refs), ['Mom original face and identity']);
  assert.match(plain.prompt, /Characters: Yuha \(yuha\): a boy, .*; Mom \(mom\): /);
  assert.match(refs.prompt, /Characters: Mom \(mom\): /);
  assert.doesNotMatch(refs.prompt, /Yuha \(yuha\)/);
  // Page 1 names both: both sheets, as before.
  assert.equal(sceneGenerationRequest(state, book(state, {marker: true}), 0, {quality: 'final'}).referenceImages.filter((r) => r.role === 'character_front').length, 2);
  // The cover is the hero alone either way.
  assert.equal(sceneGenerationRequest(state, book(state, {marker: true}), 0, {cover: true}).referenceImages.filter((r) => r.role === 'character_front').length, 1);
  // The receipt names what was sent.
  const b = book(state, {marker: true});
  commitSceneResult(state, b, 1, {imageUrl: png});
  assert.deepEqual(b.pages[1].imageMeta.referenceImages.filter((r) => r.role === 'character_front').map((r) => r.label), ['Mom original face and identity']);
});

test('R55d the recent-scene reference prefers the latest same-place page from the same camera; without shotOf the choice is the old one', () => {
  const state = setup();
  const b = book(state, {marker: true});
  const snap = captureBookGenerationSnapshot(state, b);
  b.pages.forEach((p, i) => { if (i < 3) p.imageUrl = `https://example.test/${i}.png`; });
  // Page 4 is wide: pages 1 (wide), 2 (medium), 3 (wide) are earlier at home. Old rule: first + latest = 1, 3. Same camera: also 3.
  assert.deepEqual(previousSceneReferences(b, snap, 3).map((r) => r.sourcePageIndex), [0, 2]);
  const shotOf = (p) => p?.staging?.shot || 'wide';
  assert.deepEqual(previousSceneReferences(b, snap, 3, {shotOf}).map((r) => r.sourcePageIndex), [0, 2]);
  // Make page 4 medium: the old rule still says page 3; the same-camera rule says page 2 and labels it.
  b.pages[3].staging.shot = 'medium';
  assert.deepEqual(previousSceneReferences(b, snap, 3).map((r) => r.sourcePageIndex), [0, 2]);
  const same = previousSceneReferences(b, snap, 3, {shotOf});
  assert.deepEqual(same.map((r) => r.sourcePageIndex), [0, 1]);
  assert.match(same[1].label, /^Recent scene from the SAME camera \(medium\) at SAME place, page 2; architecture\/layout only — the closest layout reference for this page/);
  assert.equal(same[0].required, true);
  // No same-camera page: the latest, labelled as before.
  b.pages[3].staging.shot = 'closeup';
  const none = previousSceneReferences(b, snap, 3, {shotOf});
  assert.deepEqual(none.map((r) => r.sourcePageIndex), [0, 2]);
  assert.match(none[1].label, /^Recent scene at SAME place, page 3;/);
  // Through the request: the marker book's page 4 (medium) gets page 2 as its recent scene; the plain book gets page 3.
  b.pages[3].staging.shot = 'medium';
  const viaRequest = sceneGenerationRequest(state, b, 3, {quality: 'final'}).referenceImages.filter((r) => r.sourcePageIndex !== undefined).map((r) => r.sourcePageIndex);
  assert.deepEqual(viaRequest, [0, 1]);
  const plain = book(state, {marker: false});
  plain.pages.forEach((p, i) => { if (i < 3) p.imageUrl = `https://example.test/${i}.png`; });
  plain.pages[3].staging.shot = 'medium';
  assert.deepEqual(sceneGenerationRequest(state, plain, 3, {quality: 'final'}).referenceImages.filter((r) => r.sourcePageIndex !== undefined).map((r) => r.sourcePageIndex), [0, 2]);
});
