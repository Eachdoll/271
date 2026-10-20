import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {migrateWorldState, getActiveWorld, getCharacterSheet, getWorldBackgroundSnapshot, sameBackgroundLook, backgroundSheetFacts} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {updateCharacter, updateBackground, characterAppearanceChanged, backgroundAppearanceChanged, CHARACTER_APPEARANCE_FIELDS} from '../dist/management.js';
import {backgroundSettingsKey} from '../dist/background-sheets.js';
import {materialSignature, materialSignatureMatches} from '../dist/story-generation/auto-materials.js';
import {createFullAutoJob, runFullAuto} from '../dist/full-auto.js';

/**
 * 2026-10-20 "재료의 이름을 바꾸면 재료가 사라지거나 만든 그림이 사라져": a
 * rename bumped the version every sheet is matched by and marked the sheet
 * stale, and a place sheet was keyed to a JSON that included the name. Now
 * only a changed look (kind, colours, description, clothes; type, features,
 * layout) invalidates a picture, and a run in progress is not stopped by a
 * rename either.
 */
function setup() {
  const state = seedState(); migrateWorldState(state); migrateReadingSettings(state.settings);
  return state;
}

test('renaming a character keeps its approved sheet, version and the World; changing its look still invalidates only that sheet', () => {
  const state = setup(), before = getCharacterSheet(state, 'yuha');
  assert.ok(before, 'the seed protagonist has a confirmed sheet');
  const renamed = updateCharacter(state, 'yuha', {name: '유하 새 이름', nameEn: 'Yuha II', role: '주인공', traits: '호기심, 용기', catchphrase: '가자!'});
  const yuha = renamed.characters.find(c => c.id === 'yuha');
  assert.equal(yuha.name, '유하 새 이름');
  assert.equal(yuha.version, state.characters.find(c => c.id === 'yuha').version || 1, 'the version follows the look');
  assert.equal(yuha.sheetStale, undefined);
  assert.equal(getCharacterSheet(renamed, 'yuha')?.id, before.id, 'the same sheet is still current');
  assert.equal(getActiveWorld(renamed).characterSheetsStale, false);
  assert.equal(yuha.characterHistory.at(-1).name, '유하', 'the old name is kept in the history');
  assert.equal(characterAppearanceChanged(state.characters.find(c => c.id === 'yuha'), {name: 'x', traits: 'a, b', age: String(state.characters.find(c => c.id === 'yuha').age || 4)}), false, 'form strings that equal the stored values are not a change');
  for (const field of ['kind', 'color', 'description', 'clothes']) assert.ok(CHARACTER_APPEARANCE_FIELDS.has(field));
  const recoloured = updateCharacter(renamed, 'yuha', {color: '#112233'});
  assert.equal(getCharacterSheet(recoloured, 'yuha'), null);
  assert.equal(recoloured.characters.find(c => c.id === 'yuha').sheetStale, true);
  assert.equal(getActiveWorld(recoloured).characterSheetsStale, true);
  assert.ok(getCharacterSheet(recoloured, 'greenie'), 'the other cast keep their sheets');
});

test('renaming a place keeps its approved World picture (also one approved under the old name), changing its layout does not', () => {
  const state = setup(), world = getActiveWorld(state);
  const place = {id: 'moon-hill', name: '달 언덕', type: 'space', description: '둥근 돌 세 개', layout: '낮은 길, 건물 없음', version: 1};
  place.backgroundSheets = [{id: 'sheet-moon', imageAssetId: 'image-moon-0001', imageUrl: 'asset:image-moon-0001', confirmedAt: '2026-10-20T00:00:00Z', seed: 7, meta: {worldId: world.id, worldRevision: world.revision, imageEngine: world.imageEngine, stylePresetId: world.stylePresetId}, settings: backgroundSettingsKey(place)}];
  state.backgrounds.push(place);
  assert.equal(getWorldBackgroundSnapshot(state, place).imageAssetId, 'image-moon-0001');
  const renamed = updateBackground(state, 'moon-hill', {name: '달빛 언덕'});
  const after = renamed.backgrounds.find(b => b.id === 'moon-hill');
  assert.equal(after.version, 1, 'a rename does not move the version');
  assert.equal(getWorldBackgroundSnapshot(renamed, after).imageAssetId, 'image-moon-0001', 'the sheet approved under the old name still shows');
  assert.equal(sameBackgroundLook(backgroundSettingsKey(place), backgroundSheetFacts(after)), true);
  assert.equal(backgroundAppearanceChanged(place, {name: '다른 이름'}), false);
  const relaid = updateBackground(renamed, 'moon-hill', {layout: '큰 바위 하나, 동굴 입구'});
  const changed = relaid.backgrounds.find(b => b.id === 'moon-hill');
  assert.equal(changed.version, 2);
  assert.equal(getWorldBackgroundSnapshot(relaid, changed).imageAssetId, undefined, 'a new layout needs a new picture');
  assert.equal(sameBackgroundLook('not json', backgroundSheetFacts(after)), false);
  // An imported picture (no sheet rows) survives a rename too.
  const imported = {id: 'sea', name: '바닷가', type: 'sea', description: '모래와 파도', version: 1, imageAssetId: 'image-sea-0001', imageMeta: {worldId: world.id, worldRevision: world.revision, engine: world.imageEngine, stylePresetId: world.stylePresetId}};
  state.backgrounds.push(imported);
  const seaRenamed = updateBackground(state, 'sea', {name: '조개 바닷가'});
  assert.equal(getWorldBackgroundSnapshot(seaRenamed, seaRenamed.backgrounds.find(b => b.id === 'sea')).imageAssetId, 'image-sea-0001');
  const seaChanged = updateBackground(state, 'sea', {description: '바위와 등대'});
  assert.equal(getWorldBackgroundSnapshot(seaChanged, seaChanged.backgrounds.find(b => b.id === 'sea')).imageAssetId, undefined);
});

test('a run in progress goes on after a rename and still stops after a changed look', async () => {
  const state = setup();
  const yuha = state.characters.find(c => c.id === 'yuha'), stored = materialSignature(yuha);
  assert.equal(materialSignatureMatches({...yuha, name: '새 이름', nameEn: 'New', traits: ['x']}, stored), true);
  assert.equal(materialSignatureMatches({...yuha, description: '다른 옷'}, stored), false);
  assert.equal(materialSignatureMatches({...yuha, version: 2}, stored), false);
  assert.equal(materialSignatureMatches(null, stored), false);
  assert.equal(materialSignatureMatches(yuha, 'not json'), false);
  // The runner: a paused job resumes after the protagonist was renamed.
  const wizard = {characterIds: ['yuha'], backgroundIds: [], topic: '달에 놀러 간 날', pageCount: 12, koreanLevel: 'K1', englishLevel: 'E0', value: 'none', ending: 'home', language: 'bilingual', simpleFlow: true};
  const job = createFullAutoJob(state, wizard, {stopBefore: 'text', planMode: 'selection'});
  let outlines = 0;
  const ops = {preflight: async () => {}, outline: async () => { outlines++; throw new DOMException('pause', 'AbortError'); }};
  await assert.rejects(runFullAuto(state, job, {operations: ops, buildBook: () => ({})}), {name: 'AbortError'});
  assert.equal(outlines, 1);
  Object.assign(state, updateCharacter(state, 'yuha', {name: '유하 새 이름'}));
  await assert.rejects(runFullAuto(state, job, {operations: ops, buildBook: () => ({})}), {name: 'AbortError'});
  assert.equal(outlines, 2, 'the renamed protagonist did not stop the resume');
  Object.assign(state, updateCharacter(state, 'yuha', {description: '파란 옷'}));
  await assert.rejects(runFullAuto(state, job, {operations: ops, buildBook: () => ({})}), /수정·삭제되었어요/);
  assert.equal(outlines, 2);
});
