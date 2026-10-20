import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {migrateWorldState, getActiveWorld, createCharacterSheetRequest, sceneGenerationRequest, markCharacterSheetConfirmed} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {genderWord, identityLine, GENDER_CHOICES} from '../dist/image-generation/identity.js';
import {createVariantGenerationRequest} from '../dist/wardrobe.js';
import {createPhotoGenerationRequest, photoCandidateContent} from '../dist/photo-materials.js';
import {getStylePreset} from '../dist/image-generation/styles.js';
import {updateCharacter, characterAppearanceChanged} from '../dist/management.js';

/**
 * 2026-10-20 "옷장에 옷을 추가하니 성별이 바뀌어버렸어": the record had a gender
 * but no picture request said it. Now the sheet, the wardrobe views, every
 * scene and the photo sheet carry one identity line, and the forms offer the
 * choice. A record without a gender sends nothing new.
 */
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
function setup() {
  const state = seedState(); migrateWorldState(state); migrateReadingSettings(state.settings);
  return state;
}

test('the gender word reads Korean and English values and follows age for adults; nothing without a value', () => {
  assert.equal(genderWord({gender: '남자아이'}), 'boy');
  assert.equal(genderWord({gender: '여자아이', kind: 'child'}), 'girl');
  assert.equal(genderWord({gender: 'girl'}), 'girl');
  assert.equal(genderWord({gender: '여자', kind: 'adult'}), 'woman');
  assert.equal(genderWord({gender: 'boy', age: 34}), 'man');
  assert.equal(genderWord({gender: '토끼'}), '');
  assert.equal(genderWord({}), '');
  assert.equal(identityLine({}), '');
  assert.match(identityLine({name: '유하', nameEn: 'Yuha', gender: '남자아이'}), /^Yuha is a boy; keep the same boy with the same face, hair and body in every view, whatever the clothes or accessories suggest\.$/);
  assert.deepEqual(GENDER_CHOICES.map(([v]) => v), ['', '남자아이', '여자아이']);
});

test('sheet, wardrobe, scene and photo requests say the gender; a record without one is unchanged', () => {
  const state = setup();
  const yuha = state.characters.find(c => c.id === 'yuha');
  assert.equal(yuha.gender, '남자아이', 'the seed protagonist carries a gender');
  assert.match(createCharacterSheetRequest(state, 'yuha').prompt, /유하; Yuha; child; a boy; /);
  const greenie = state.characters.find(c => c.id === 'greenie');
  assert.equal(greenie.gender, undefined);
  assert.doesNotMatch(createCharacterSheetRequest(state, 'greenie').prompt, /; a (?:boy|girl|man|woman); /);
  // Wardrobe: a dress on the record never redraws the child.
  const variant = {id: 'dress', characterId: 'yuha', name: '분홍 원피스', description: 'a pink dress with a bow', type: 'outfit'};
  const front = createVariantGenerationRequest(state, 'yuha', variant, 'front', 5);
  assert.match(front.prompt, /recognizable identity\. Yuha is a boy; keep the same boy with the same face, hair and body in every view, whatever the clothes or accessories suggest\. Change only the requested clothing: a pink dress with a bow\./);
  assert.doesNotMatch(createVariantGenerationRequest(state, 'greenie', {...variant, characterId: 'greenie'}, 'front', 5).prompt, /is a (?:boy|girl)/);
  // Scenes: the cast line names the gender from the frozen sheet snapshot.
  const book = {id: 'b', title: '유하의 하루', characterIds: ['yuha', 'greenie'], backgroundIds: ['home'], language: 'bilingual', pages: [{pageNo: 1, ko: '유하가 집에서 손을 흔들어요.', en: 'Yuha waves at home.', scene: {who: ['yuha', 'greenie'], where: 'home', action: 'Yuha waves at home while Greenie watches.', timeOfDay: 'day'}}]};
  const scene = sceneGenerationRequest(state, book, 0, {quality: 'final'});
  assert.match(scene.prompt, /1: 유하 \(a boy, 짧은 검은 머리/);
  assert.doesNotMatch(scene.prompt, /2: 초록이 \(a (?:boy|girl)/);
  // Photo sheet: the parent's choice rides in the settings JSON and as a sentence.
  const photo = createPhotoGenerationRequest({kind: 'character', fields: {name: '유하', nameEn: 'Yuha', gender: '여자아이', kind: 'child'}, photos: [png], stylePreset: getStylePreset('watercolor'), seed: 1});
  assert.match(photo.prompt, /"gender":"여자아이"/);
  assert.match(photo.prompt, /Yuha is a girl; keep the same girl/);
  const plain = createPhotoGenerationRequest({kind: 'character', fields: {name: '유하', nameEn: 'Yuha', kind: 'child'}, photos: [png], stylePreset: getStylePreset('watercolor'), seed: 1});
  assert.doesNotMatch(plain.prompt, /is a (?:boy|girl)/);
});

test('changing the gender is a change of look (new sheet); the management editor accepts the field', () => {
  const state = setup();
  assert.equal(characterAppearanceChanged(state.characters.find(c => c.id === 'yuha'), {gender: '여자아이'}), true);
  const next = updateCharacter(state, 'yuha', {gender: '여자아이'});
  const yuha = next.characters.find(c => c.id === 'yuha');
  assert.equal(yuha.gender, '여자아이');
  assert.equal(yuha.sheetStale, true);
  assert.equal(yuha.version, 2);
  assert.equal(characterAppearanceChanged(yuha, {gender: '여자아이'}), false);
});

test('the photo candidate screen shows its own progress while the final render runs, and the buttons come back with an error', () => {
  const session = {kind: 'character', mode: 'photo', fields: {name: '유하'}, candidate: {imageUrl: png, seed: 3, meta: {worldRevision: 1, engine: 'openai', quality: 'draft', requestedSeed: 3}}};
  const idle = photoCandidateContent(session);
  assert.match(idle, /data-photo-action="confirm">최종 화질 생성 · 추가 요청 요금 적용</);
  assert.doesNotMatch(idle, /disabled/);
  assert.doesNotMatch(idle, /photo-progress/);
  const busy = photoCandidateContent(session, {busy: '최종 화질 그림을 만드는 중이에요.'});
  assert.match(busy, /id="photo-progress"[^>]*>최종 화질 그림을 만드는 중이에요\.</);
  assert.match(busy, /data-photo-action="cancel" disabled/);
  assert.match(busy, /data-photo-action="confirm" disabled/);
  const failed = photoCandidateContent(session, {error: '엔진이 <b>거절</b>했어요'});
  assert.match(failed, /id="photo-error"[^>]*>엔진이 &lt;b&gt;거절&lt;\/b&gt;했어요</);
  assert.doesNotMatch(failed, /disabled/);
  const final = photoCandidateContent({...session, candidate: {...session.candidate, meta: {...session.candidate.meta, quality: 'final'}}});
  assert.match(final, /data-photo-action="confirm">이 캐릭터 시트로 확정</);
});
