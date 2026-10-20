import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {migrateWorldState, getActiveWorld} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {PLACE_TYPE_CHOICES, PLACE_TYPE_CUSTOM, PLACE_TYPE_MAX, readPlaceType, normalizePlaceType, isValidPlaceType, isPresetPlaceType, placeTypeLabel, placeTypePrompt, placeEmoji, placeTypeCustomField} from '../dist/place-types.js';
import {updateBackground} from '../dist/management.js';
import {backgroundSheetRequest} from '../dist/background-sheets.js';
import {placeKeywords, recommendPlaces} from '../dist/simple-create.js';

/**
 * 2026-10-20 "배경 시트 카테고리가 너무 단조로워": a place's kind was one of
 * five ids. The forms now offer more presets and a typed kind ("도시"), which
 * is stored as written, drawn as written, and shown with a guessed emoji.
 */
test('a typed kind wins over the preset select; empty, overlong and marked-up kinds are refused', () => {
  assert.equal(readPlaceType('forest', ''), 'forest');
  assert.equal(readPlaceType('forest', '  도시 '), '도시');
  assert.equal(readPlaceType(PLACE_TYPE_CUSTOM, '사막  오아시스'), '사막 오아시스');
  assert.throws(() => readPlaceType(PLACE_TYPE_CUSTOM, ''), /아래 칸에 적어 주세요/);
  assert.throws(() => normalizePlaceType(''), /골라 주세요/);
  assert.throws(() => normalizePlaceType('x'.repeat(PLACE_TYPE_MAX + 1)), /이내로/);
  assert.throws(() => normalizePlaceType('<b>도시</b>'), /글자와 숫자만/);
  assert.throws(() => normalizePlaceType(PLACE_TYPE_CUSTOM));
  assert.equal(isValidPlaceType('동굴'), true);
  assert.equal(isValidPlaceType('"도시"'), false);
  assert.equal(isPresetPlaceType('city'), true);
  assert.equal(isPresetPlaceType('도시'), false);
  assert.deepEqual(PLACE_TYPE_CHOICES.slice(0, 5).map(([id]) => id), ['home', 'school', 'forest', 'sea', 'space'], 'the five old ids come first');
  assert.equal(PLACE_TYPE_CHOICES.at(-1)[0], PLACE_TYPE_CUSTOM);
  assert.ok(PLACE_TYPE_CHOICES.some(([id, label]) => id === 'city' && /도시/.test(label)));
});

test('labels, prompt words and emoji: old ids unchanged, new presets in English, typed kinds as written', () => {
  assert.equal(placeTypePrompt('forest'), 'forest');
  assert.equal(placeTypePrompt('sea'), 'sea');
  assert.equal(placeTypePrompt('city'), 'city street');
  assert.equal(placeTypePrompt('도시'), '도시');
  assert.equal(placeTypeLabel('city'), '도시 · 거리');
  assert.equal(placeTypeLabel('사막'), '사막');
  assert.equal(placeEmoji('home'), '🏡');
  assert.equal(placeEmoji('city'), '🏙️');
  assert.equal(placeEmoji('도시'), '🏙️');
  assert.equal(placeEmoji('사막'), '🏜️');
  assert.equal(placeEmoji('구름 왕국'), '🌿');
  const field = placeTypeCustomField('b-type-custom');
  assert.match(field, /id="b-type-custom"/);
  assert.doesNotMatch(field, /name=/);
  assert.match(placeTypeCustomField('management-typeCustom', {name: 'typeCustom', value: '도시'}), /name="typeCustom"[^>]*value="도시"/);
  assert.match(placeTypeCustomField('x', {value: 'forest'}), /value=""/, 'a preset is not echoed into the free field');
});

test('a background may carry a typed kind: it is stored, drawn and recommended by that word', () => {
  const state = seedState(); migrateWorldState(state); migrateReadingSettings(state.settings);
  state.backgrounds.push({id: 'city-1', name: '큰 거리', type: 'forest', description: '높은 건물과 신호등', layout: '왼쪽 횡단보도, 오른쪽 버스 정류장', version: 1});
  const next = updateBackground(state, 'city-1', {type: '도시'});
  const city = next.backgrounds.find(b => b.id === 'city-1');
  assert.equal(city.type, '도시');
  assert.equal(city.version, 2, 'a new kind is a new look');
  const world = getActiveWorld(next); world.imageEngine = 'openai';
  const request = backgroundSheetRequest(next, city, {quality: 'draft', seed: 7});
  assert.match(request.prompt, /큰 거리; type 도시; 높은 건물과 신호등/);
  assert.ok(request.forbiddenWordCheck.text.includes('도시'), 'the typed kind is parent text for the word check');
  const preset = updateBackground(state, 'city-1', {type: 'city'});
  assert.match(backgroundSheetRequest(preset, preset.backgrounds.find(b => b.id === 'city-1'), {quality: 'draft', seed: 7}).prompt, /type city street;/);
  assert.ok(placeKeywords(city).includes('도시'));
  assert.deepEqual(recommendPlaces('도시 구경 가는 날', next.backgrounds).slice(0, 1), ['city-1']);
});
