import {characterSVG} from '../engine.js';
import {getStylePreset, validateStylePreset} from './styles.js';
import {getImageURL} from './assets.js';

const ENGINES = new Set(['google', 'openai', 'bfl', 'fal', 'local']);
const clone = value => JSON.parse(JSON.stringify(value));
const uid = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
const now = () => new Date().toISOString();
const svgURL = svg => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const engineId = value => ENGINES.has(value) ? value : 'google';
const characterById = (state, input) => typeof input === 'object' ? input : state.characters.find(character => character.id === input);

function newSeed() {
  if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff;
  return Math.floor(Math.random() * 0x7fffffff);
}

function seedValue(value) {
  if (value === undefined || value === null || value === '') return newSeed();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 0x7fffffff) throw new Error('시드는 0부터 2147483647 사이 정수여야 해요.');
  return number;
}

function isCurrentSheet(sheet, world) {
  return sheet?.confirmedAt && sheet.imageUrl && sheet.worldId === world.id && sheet.worldRevision === world.revision && sheet.imageEngine === world.imageEngine && sheet.stylePresetId === world.stylePresetId;
}

function referenceURL(sheet) {
  const assetId = sheet.imageAssetId || (sheet.imageUrl?.startsWith('asset:') ? sheet.imageUrl.slice(6) : null);
  if (!assetId) return sheet.imageUrl;
  const url = getImageURL(assetId);
  if (!url) throw new Error('캐릭터 시트 이미지를 불러오는 중이에요. 잠시 후 다시 시도해 주세요.');
  return url;
}

export function getCharacterSheet(state, characterId, world = getActiveWorld(state)) {
  const character = characterById(state, characterId);
  return character?.characterSheets?.findLast?.(sheet => isCurrentSheet(sheet, world)) || [...(character?.characterSheets || [])].reverse().find(sheet => isCurrentSheet(sheet, world)) || null;
}

function updateStaleStatus(state, world) {
  world.characterSheetsStale = world.characterIds.some(id => !getCharacterSheet(state, id, world));
  return world.characterSheetsStale;
}

/** Upgrade an existing local library without losing its approved sample art. */
export function migrateWorldState(state) {
  state.settings ||= {};
  state.characters ||= [];
  state.books ||= [];
  const legacy = !Array.isArray(state.worlds) || !state.worlds.length;
  if (legacy) state.worlds = [{
    id: 'world-home', name: state.settings.worldName || '우리 집 작은 세계',
    imageEngine: engineId(state.settings.imageEngine), stylePresetId: getStylePreset(state.settings.stylePresetId || state.settings.style).id,
    characterIds: state.characters.map(character => character.id), revision: 1,
    characterSheetsStale: false, createdAt: now()
  }];
  for (const world of state.worlds) {
    world.id ||= uid('world');
    world.name ||= '우리 집 작은 세계';
    world.imageEngine = engineId(world.imageEngine);
    world.stylePresetId = getStylePreset(world.stylePresetId).id;
    world.characterIds = Array.isArray(world.characterIds) ? [...new Set(world.characterIds)] : state.characters.map(character => character.id);
    world.revision = Math.max(1, Math.floor(Number(world.revision) || 1));
    world.createdAt ||= now();
    world.characterSheetsStale = !!world.characterSheetsStale;
  }
  if (!state.worlds.some(world => world.id === state.activeWorldId)) state.activeWorldId = state.worlds[0].id;
  for (const character of state.characters) {
    character.characterSheets = Array.isArray(character.characterSheets) ? character.characterSheets : [];
    if (legacy && character.approved !== false && !character.characterSheets.length) {
      const world = state.worlds[0];
      const requestedSeed = seedValue(character.sheetSeed);
      character.characterSheets.push({
        id: uid('sheet'), characterId: character.id, worldId: world.id, worldRevision: world.revision,
        imageEngine: world.imageEngine, stylePresetId: world.stylePresetId,
        imageUrl: svgURL(characterSVG(character, character.variant || 0)), seed: null, requestedSeed,
        meta: {source: 'local-svg', legacySample: true, originalDrawing: true, requestedSeed, returnedSeed: null, seedSupported: false},
        characterSnapshot: clone({...character, characterSheets: undefined}), confirmedAt: now()
      });
      character.sheetSeed = requestedSeed;
    }
  }
  // Existing books retain the generation settings and cast appearance they had
  // when imported. Later World changes cannot rewrite their reference images.
  if (legacy) for (const book of state.books) {
    book.worldId ||= state.activeWorldId;
    try { captureBookGenerationSnapshot(state, book); } catch { /* incomplete drafts stay unbound */ }
  }
  for (const world of state.worlds) updateStaleStatus(state, world);
  state.version = Math.max(Number(state.version) || 1, 2);
  return state;
}

export function getActiveWorld(state) {
  if (!state.worlds?.length) migrateWorldState(state);
  return state.worlds.find(world => world.id === state.activeWorldId) || state.worlds[0];
}

/** Settings are World-scoped; confirmed sheets remain as immutable history. */
export function updateWorldGenerationSettings(state, {imageEngine, stylePresetId}) {
  const world = getActiveWorld(state);
  const nextEngine = imageEngine === undefined ? world.imageEngine : imageEngine;
  if (!ENGINES.has(nextEngine)) throw new Error('지원하지 않는 이미지 엔진이에요.');
  const preset = stylePresetId === undefined ? getStylePreset(world.stylePresetId) : getStylePreset(stylePresetId);
  if (stylePresetId !== undefined && preset.id !== stylePresetId) throw new Error('지원하지 않는 화풍 프리셋이에요.');
  const validation = validateStylePreset(preset);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  const changed = world.imageEngine !== nextEngine || world.stylePresetId !== preset.id;
  const hadConfirmedSheets = world.characterIds.some(id => state.characters.find(character => character.id === id)?.characterSheets?.some(sheet => sheet.worldId === world.id && sheet.confirmedAt));
  if (changed) {
    world.imageEngine = nextEngine;
    world.stylePresetId = preset.id;
    world.revision += 1;
    world.updatedAt = now();
    world.characterSheetsStale = hadConfirmedSheets;
  }
  return {changed, requiresRegeneration: changed && hadConfirmedSheets, world};
}

/** Call only after the parent approves a generated sheet. Never overwrite one. */
export function markCharacterSheetConfirmed(state, characterId, sheetResult) {
  const world = getActiveWorld(state);
  const character = characterById(state, characterId);
  if (!character?.id) throw new Error('캐릭터를 먼저 저장해 주세요.');
  if (!sheetResult?.imageUrl || typeof sheetResult.imageUrl !== 'string') throw new Error('확정할 캐릭터 시트 이미지가 필요해요.');
  const metadata = clone(sheetResult.meta || {});
  if (metadata.worldRevision !== undefined && metadata.worldRevision !== world.revision || metadata.worldId && metadata.worldId !== world.id || metadata.engine && metadata.engine !== world.imageEngine || metadata.stylePresetId && metadata.stylePresetId !== world.stylePresetId) throw new Error('생성 중 세계 설정이 바뀌었어요. 현재 설정으로 시트를 다시 만들어 주세요.');
  const characterSnapshot = metadata.characterSnapshot || {...character, characterSheets: undefined};
  if (metadata.characterSnapshot && ['name', 'nameEn', 'kind', 'description', 'appearance', 'clothes', 'color', 'hairColor', 'skinColor'].some(field => metadata.characterSnapshot[field] !== character[field])) throw new Error('생성 중 캐릭터 모습이 바뀌었어요. 현재 모습으로 시트를 다시 만들어 주세요.');
  const effectiveSeed = sheetResult.seed === undefined || sheetResult.seed === null ? null : seedValue(sheetResult.seed);
  const requestedSeed = seedValue(metadata.requestedSeed ?? effectiveSeed ?? character.sheetSeed);
  metadata.requestedSeed = requestedSeed;
  metadata.returnedSeed = effectiveSeed;
  metadata.seed = effectiveSeed;
  const sheet = {
    id: uid('sheet'), characterId: character.id, worldId: world.id, worldRevision: world.revision,
    imageEngine: world.imageEngine, stylePresetId: world.stylePresetId,
    imageAssetId: sheetResult.imageAssetId || null,
    imageUrl: sheetResult.imageAssetId ? `asset:${sheetResult.imageAssetId}` : sheetResult.imageUrl,
    seed: effectiveSeed, requestedSeed, meta: metadata,
    characterSnapshot: clone(characterSnapshot), confirmedAt: now()
  };
  character.characterSheets ||= [];
  character.characterSheets.push(sheet);
  character.sheetSeed = requestedSeed;
  character.sheetImageUrl = sheet.imageUrl;
  character.sheetConfirmedAt = sheet.confirmedAt;
  if (!world.characterIds.includes(character.id)) world.characterIds.push(character.id);
  updateStaleStatus(state, world);
  return sheet;
}

/** One book locks one World revision, all cast sheets and the exact style row. */
export function captureBookGenerationSnapshot(state, book) {
  if (book.generationSnapshot) return book.generationSnapshot;
  const world = state.worlds?.find(item => item.id === book.worldId) || getActiveWorld(state);
  const ids = [...new Set(book.characterIds || [])];
  if (!ids.length) throw new Error('이야기에 등장할 캐릭터를 먼저 골라 주세요.');
  const sheets = ids.map(id => {
    const sheet = getCharacterSheet(state, id, world);
    if (!sheet) throw new Error('시트 다시 생성 필요: 선택한 캐릭터의 현재 엔진·화풍 시트를 생성하고 확정해 주세요.');
    return clone(sheet);
  });
  const preset = getStylePreset(world.stylePresetId);
  const validation = validateStylePreset(preset);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  book.worldId = world.id;
  book.imageEngine = world.imageEngine;
  book.stylePresetId = world.stylePresetId;
  book.generationSnapshot = {
    worldId: world.id, worldRevision: world.revision, imageEngine: world.imageEngine,
    stylePresetId: world.stylePresetId, stylePreset: clone(preset), characterSheets: sheets,
    capturedAt: now()
  };
  return book.generationSnapshot;
}

export function createCharacterSheetRequest(state, characterId, options = {}) {
  const world = getActiveWorld(state);
  const character = characterById(state, characterId);
  if (!character) throw new Error('캐릭터를 찾을 수 없어요.');
  const preset = getStylePreset(world.stylePresetId);
  const previousSheet = [...(character.characterSheets || [])].reverse().find(sheet => sheet.confirmedAt && sheet.imageUrl);
  const identityReference = previousSheet ? referenceURL(previousSheet) : svgURL(characterSVG(character, character.variant || 0));
  const identity = [character.name, character.nameEn, character.kind, character.description, character.appearance, character.clothes, `body/clothing color ${character.color || ''}`, `hair color ${character.hairColor || ''}`, `skin color ${character.skinColor || ''}`].filter(Boolean).join('; ');
  return {
    prompt: `Create a coherent character reference sheet for this original storybook character: ${identity}. Show a front full-body view, side full-body view, back full-body view, four face expressions (joy, surprise, sadness, upset), and two action poses (walking and waving) on one clean neutral background. Keep the exact face, proportions, hairstyle, clothing and colors consistent in every view. Use the attached character identity reference when supplied. No labels, text or captions.`,
    stylePreset: clone(preset),
    referenceImages: [identityReference, ...preset.styleRefImages],
    seed: seedValue(options.seed ?? character.sheetSeed), size: options.size || '1536x1024', quality: options.quality || 'high'
  };
}

/** Every scene sends all selected character sheets AND original style images. */
export function sceneGenerationRequest(state, book, pageIndex, options = {}) {
  const page = book.pages?.[pageIndex];
  if (!page) throw new Error('이야기 쪽을 찾을 수 없어요.');
  const snapshot = captureBookGenerationSnapshot(state, book);
  const preset = clone(snapshot.stylePreset || getStylePreset(snapshot.stylePresetId));
  const validation = validateStylePreset(preset);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  const sheets = snapshot.characterSheets;
  if (!Array.isArray(sheets) || !sheets.length || sheets.some(sheet => !sheet.confirmedAt || !sheet.imageUrl)) throw new Error('확정된 캐릭터 시트가 모두 필요해요.');
  const cast = sheets.map((sheet, index) => `${index + 1}: ${sheet.characterSnapshot?.name || sheet.characterSnapshot?.nameEn || sheet.characterId} (${sheet.characterSnapshot?.description || sheet.characterSnapshot?.kind || 'original storybook character'})`).join('; ');
  const scene = page.imagePrompt || page.scene?.prompt || page.ko || page.en || book.topic || '';
  page.imageSeed = seedValue(options.seed ?? page.imageSeed);
  return {
    prompt: `Illustrate page ${pageIndex + 1} of an original children's picture book. Scene: ${scene}. Scene context: ${JSON.stringify(page.scene || {})}. Characters, matching the first ${sheets.length} attached reference sheets in this order: ${cast}. Preserve every referenced character's identity, face, proportions, clothing and colors; show only the selected cast required by the scene. Remaining reference images show the visual style. One readable composition with space for separately typeset story text. No words, captions, watermark or logos.`,
    stylePreset: preset,
    referenceImages: [...sheets.map(referenceURL), ...preset.styleRefImages],
    seed: page.imageSeed, size: options.size || page.imageSize || '1536x1024', quality: options.quality || page.imageQuality || 'high'
  };
}

/** Persist the returned seed as well as the requested seed and exact references. */
export function commitSceneResult(state, book, pageIndex, result) {
  const page = book.pages?.[pageIndex];
  if (!page || !result?.imageUrl) throw new Error('저장할 장면 이미지가 필요해요.');
  const snapshot = captureBookGenerationSnapshot(state, book);
  const requestedSeed = seedValue(result.meta?.requestedSeed ?? page.imageSeed ?? result.seed);
  const effectiveSeed = result.seed === undefined || result.seed === null ? null : seedValue(result.seed);
  page.imageAssetId = result.imageAssetId || null;
  page.imageUrl = result.imageAssetId ? `asset:${result.imageAssetId}` : result.imageUrl;
  page.imageSeed = requestedSeed;
  page.effectiveImageSeed = effectiveSeed;
  page.imageMeta = {
    ...clone(result.meta || {}), engine: snapshot.imageEngine, worldId: snapshot.worldId,
    worldRevision: snapshot.worldRevision, stylePresetId: snapshot.stylePresetId,
    characterSheetIds: snapshot.characterSheets.map(sheet => sheet.id),
    characterSheetAssetIds: snapshot.characterSheets.map(sheet => sheet.imageAssetId).filter(Boolean),
    referenceImages: [...snapshot.characterSheets.map(sheet => sheet.imageUrl), ...snapshot.stylePreset.styleRefImages],
    requestedSeed, returnedSeed: effectiveSeed, seed: effectiveSeed, generatedAt: now()
  };
  book.localSample = false;
  return page;
}
