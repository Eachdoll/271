import {characterSVG} from '../engine.js';
import {getStylePreset, validateStylePreset} from './styles.js';
import {getImageURL} from './assets.js';

const ENGINES = new Set(['google', 'openai', 'bfl', 'fal', 'local', 'sample']);
const clone = value => JSON.parse(JSON.stringify(value));
const uid = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
const now = () => new Date().toISOString();
const svgURL = svg => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const engineId = value => ENGINES.has(value) ? value : 'sample';
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
  if (!url) throw new Error('참조 시트 이미지를 불러오는 중이에요. 잠시 후 다시 시도해 주세요.');
  return url;
}

/** Store durable IDs in snapshots; resolve object URLs only at provider-call time. */
export function getWorldStyleReferenceRecords(state, world = getActiveWorld(state), preset = getStylePreset(world.stylePresetId)) {
  const ids=(world.styleSheetImageIds?.length ? world.styleSheetImageIds : preset.styleRefImageIds || []).filter(id=>world.imageEngine==='sample'||state.styleSheetImages?.find(record=>record.imageAssetId===id||record.id===id)?.meta?.generationMode!=='offline-template').slice(0,2);
  if (ids.length) return ids.map(id => {
    const record=state.styleSheetImages?.find(item=>item.id===id || item.imageAssetId===id);
    const assetId=record?.imageAssetId || id;
    return {...clone(record || {}),imageAssetId:assetId,imageUrl:`asset:${assetId}`};
  });
  return (preset.styleRefImages || []).map(imageUrl=>({imageUrl}));
}

export function getWorldStyleReferences(state, world = getActiveWorld(state), preset = getStylePreset(world.stylePresetId)) {
  return getWorldStyleReferenceRecords(state,world,preset).map((record,index)=>({imageUrl:referenceURL(record),role:'style_sheet',label:`authoritative style ${index+1}`}));
}

function variantForPage(snapshot, characterId, pageNumber) {
  const range=(snapshot.variantPageRanges?.[characterId] || []).find(row=>pageNumber>=row.from && pageNumber<=row.to);
  const id=range ? range.variantId : snapshot.characterVariants?.[characterId];
  return id ? snapshot.variants?.find(variant=>variant.id===id && variant.characterId===characterId) || null : null;
}

function freezeBookVariants(state, book, world, sheets) {
  const characterVariants={},variantPageRanges={},variants=[];
  const count=Number(book.pageCount || book.pages?.length || 12);
  for (const sheet of sheets) {
    const id=sheet.characterId,character=state.characters.find(c=>c.id===id);
    const selected=book.characterVariants?.[id] || null;
    const rows=(book.variantPageRanges?.[id] || []).map(row=>({from:Number(row.from),to:Number(row.to),variantId:row.variantId || null}));
    const sorted=[...rows].sort((a,b)=>a.from-b.from);
    if(rows.some(row=>!Number.isInteger(row.from)||!Number.isInteger(row.to)||row.from<1||row.to<row.from||row.to>count) || sorted.some((row,index)=>index && row.from<=sorted[index-1].to)) throw new Error('옷장 쪽 범위를 확인해 주세요. 범위는 책 안에 있어야 하고 같은 등장인물의 범위끼리 겹칠 수 없어요.');
    characterVariants[id]=selected;variantPageRanges[id]=rows;
    for (const variantId of new Set([selected,...rows.map(row=>row.variantId)].filter(Boolean))) {
      const variant=character?.wardrobe?.find(item=>item.id===variantId && item.characterId===id && !item.archivedAt);
      if(!variant || variant.refImageIds?.length!==2 || variant.refImageIds.some(ref=>!ref) || variant.worldId && variant.worldId!==world.id || variant.worldRevision && variant.worldRevision!==world.revision || variant.sourceSheetId && variant.sourceSheetId!==sheet.id) throw new Error('옷장 모습이 현재 기본 시트와 맞지 않아요. 기본 모습을 고르거나 옷장 모습을 다시 생성해 주세요.');
      variants.push(clone(variant));
    }
  }
  return {characterVariants,variantPageRanges,variants};
}

/** Front identity is always retained. Variants replace only the full-body slot. */
export function sceneReferenceRecords(snapshot, pageIndex) {
  const sheets=snapshot.characterSheets || [], fronts=[], bodies=[];
  for(const sheet of sheets) {
    const label=sheet.characterSnapshot?.nameEn || sheet.characterSnapshot?.name || sheet.characterId;
    fronts.push({imageAssetId:sheet.frontImageAssetId || sheet.imageAssetId || null,imageUrl:sheet.frontImageUrl || sheet.imageUrl,role:'character_front',label:`${label} original face and identity`});
    const variant=variantForPage(snapshot,sheet.characterId,pageIndex+1);
    if(variant) variant.refImageIds.forEach((id,index)=>bodies.push({imageAssetId:id,imageUrl:`asset:${id}`,role:'character_variant',label:`${label}: ${variant.name}, ${index?'full body':'front'}, ${variant.description}`,variantId:variant.id}));
    else bodies.push({imageAssetId:sheet.fullImageAssetId || sheet.imageAssetId || null,imageUrl:sheet.fullImageUrl || sheet.imageUrl,role:'character_full',label:`${label} original full body and clothes`});
  }
  const style=(snapshot.styleReferences || (snapshot.stylePreset?.styleRefImages || []).map(imageUrl=>({imageUrl}))).map((record,index)=>({...clone(record),role:'style_sheet',label:`authoritative rendering style ${index+1}`}));
  const backgrounds=(snapshot.backgrounds || []).filter(background=>background.imageAssetId || background.imageUrl).map(background=>({...clone(background),role:'background',label:`background layout: ${background.nameEn || background.name || 'original place'}`}));
  return [...fronts,...bodies,...style,...backgrounds];
}

export function getCharacterSheet(state, characterId, world = getActiveWorld(state)) {
  const character = characterById(state, characterId);
  if(character?.sheetStale)return null;
  const matches=sheet=>isCurrentSheet(sheet,world)&&(Number(sheet.characterSnapshot?.version)||1)===(Number(character?.version)||1);
  return character?.characterSheets?.findLast?.(matches) || [...(character?.characterSheets || [])].reverse().find(matches) || null;
}

function updateStaleStatus(state, world) {
  world.characterSheetsStale = world.characterIds.some(id => !state.characters.find(c=>c.id===id)?.archivedAt && !getCharacterSheet(state, id, world));
  if(!world.characterSheetsStale)delete world.styleUpgradeNotice;
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
    stylePresetVersion: getStylePreset(state.settings.stylePresetId || state.settings.style).version || 1,
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
    const currentStyleVersion=getStylePreset(world.stylePresetId).version||1;
    if(!legacy&&(world.stylePresetVersion||1)<currentStyleVersion){
      world.revision+=1;
      world.styleUpgradeNotice=world.stylePresetId==='watercolor'?'수채화 기준을 커버의 실제 이미지로 업데이트했어요. 기존 플랫 시트를 새 화풍으로 다시 생성해 주세요.':getStylePreset(world.stylePresetId).name+' 화풍 기준을 업데이트했어요. 캐릭터 시트를 다시 생성해 주세요.';
      world.characterSheetsStale=true;
    }
    world.stylePresetVersion=currentStyleVersion;
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
    if(world.stylePresetId!==preset.id) world.styleSheetImageIds=[...(state.stylePresetSelections?.[world.id]?.[preset.id] || preset.styleRefImageIds || [])].slice(0,2);
    world.imageEngine = nextEngine;
    world.stylePresetId = preset.id;
    world.stylePresetVersion = preset.version || 1;
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
  character.sheetStale = false;
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
    styleReferences: getWorldStyleReferenceRecords(state,world,preset).map(clone),
    ...freezeBookVariants(state,book,world,sheets),
    backgrounds: (book.backgroundIds||[]).map(id=>state.backgrounds?.find(b=>b.id===id)).filter(Boolean).map(clone),
    capturedAt: now()
  };
  return book.generationSnapshot;
}

export function createCharacterSheetRequest(state, characterId, options = {}) {
  const world = getActiveWorld(state);
  const character = characterById(state, characterId);
  if (!character) throw new Error('캐릭터를 찾을 수 없어요.');
  const preset = getStylePreset(world.stylePresetId);
  const previousSheet = [...(character.characterSheets || [])].reverse().find(sheet => sheet.confirmedAt && sheet.imageUrl && sheet.meta?.source !== 'local-svg' && sheet.meta?.generationMode !== 'offline-template');
  const identity = [character.name, character.nameEn, character.kind, character.description, character.appearance, character.clothes, `body/clothing color ${character.color || ''}`, `hair color ${character.hairColor || ''}`, `skin color ${character.skinColor || ''}`].filter(Boolean).join('; ');
  const styleReferences=getWorldStyleReferences(state,world,preset);
  return {
    prompt: `Create a coherent character reference sheet for this original storybook character: ${identity}. Show a front full-body view, side full-body view, back full-body view, four face expressions (joy, surprise, sadness, upset), and two action poses (walking and waving) on one clean neutral background. Keep the exact face, proportions, hairstyle, requested clothing and colors consistent in every view. ${previousSheet?'The FIRST attached image is identity-only: preserve recognizable facial and clothing features, but do NOT copy its drawing medium, flat geometric simplification, texture, outlines or shading. All later images are authoritative STYLE references.':'All attached images are authoritative STYLE references, not a request to copy their characters, clothes or scene.'} Repaint every view from scratch in the selected visual style. Style reference rendering takes priority over the old sheet rendering. No labels, text, English view names, captions or diagrams.`,
    stylePreset: clone(preset),
    referenceImages: [...(previousSheet?[{imageUrl:referenceURL(previousSheet),role:'character_front',label:`${character.nameEn||character.name} identity, repaint in current style`}]:[]), ...styleReferences],
    seed: seedValue(options.seed ?? character.sheetSeed), size: options.size || '1536x1024', quality: options.quality || 'high',
    ...(world.imageEngine==='sample'?{sampleContext:{kind:'sheet',character:clone({...character,characterSheets:undefined,characterHistory:undefined})}}:{})
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
  const references=sceneReferenceRecords(snapshot,pageIndex);
  const roleDescriptions=references.map((reference,index)=>`Image ${index+1}: ${reference.role}, ${reference.label}`).join('; ');
  const selectedVariants=sheets.map(sheet=>variantForPage(snapshot,sheet.characterId,pageIndex+1)).filter(Boolean);
  return {
    prompt: `Illustrate page ${pageIndex + 1} of an original children's picture book. Scene: ${scene}. Scene context: ${JSON.stringify(page.scene || {})}. Selected original cast: ${cast}. Reference roles in transmission order: ${roleDescriptions}. Keep the exact face, age and body proportions from each character_front reference. Use character_variant clothes, accessories or hair for this page when present, replacing that character's original full-body clothing; otherwise retain original clothes. ${selectedVariants.length?`This page's requested variants: ${selectedVariants.map(v=>`${v.characterId}: ${v.description}`).join('; ')}.`:''} Style references define rendering only; background references define place layout only. Show only the selected cast required by the scene. Character images define appearance, not an instruction to copy an old flat drawing medium. One readable composition with space for separately typeset story text. No words, captions, watermark or logos.`,
    stylePreset: preset,
    referenceImages: references.map(reference=>({imageUrl:referenceURL(reference),role:reference.role,label:reference.label})),
    seed: page.imageSeed, size: options.size || page.imageSize || '1536x1024', quality: options.quality || page.imageQuality || 'high',
    ...(snapshot.imageEngine==='sample'?{sampleContext:{kind:'scene',scene:clone(page.scene||{}),characters:sheets.map(sheet=>{const variant=variantForPage(snapshot,sheet.characterId,pageIndex+1);return clone({...sheet.characterSnapshot,...(variant?{clothes:variant.description,color:variant.color||sheet.characterSnapshot?.color}:{})});})}}:{})
  };
}

/** Persist the returned seed as well as the requested seed and exact references. */
export function commitSceneResult(state, book, pageIndex, result) {
  const page = book.pages?.[pageIndex];
  if (!page || !result?.imageUrl) throw new Error('저장할 장면 이미지가 필요해요.');
  const snapshot = captureBookGenerationSnapshot(state, book);
  const requestedSeed = seedValue(result.meta?.requestedSeed ?? page.imageSeed ?? result.seed);
  const effectiveSeed = result.seed === undefined || result.seed === null ? null : seedValue(result.seed);
  const references=sceneReferenceRecords(snapshot,pageIndex);
  page.imageAssetId = result.imageAssetId || null;
  page.imageUrl = result.imageAssetId ? `asset:${result.imageAssetId}` : result.imageUrl;
  page.imageSeed = requestedSeed;
  page.effectiveImageSeed = effectiveSeed;
  page.imageMeta = {
    ...clone(result.meta || {}), engine: snapshot.imageEngine, worldId: snapshot.worldId,
    worldRevision: snapshot.worldRevision, stylePresetId: snapshot.stylePresetId,
    characterSheetIds: snapshot.characterSheets.map(sheet => sheet.id),
    characterSheetAssetIds: snapshot.characterSheets.map(sheet => sheet.imageAssetId).filter(Boolean),
    characterVariantIds: [...new Set(references.map(ref=>ref.variantId).filter(Boolean))],
    characterVariantAssetIds: references.filter(ref=>ref.role==='character_variant').map(ref=>ref.imageAssetId),
    referenceImages: references.map(ref=>({imageUrl:ref.imageAssetId?`asset:${ref.imageAssetId}`:ref.imageUrl,role:ref.role,label:ref.label})),
    requestedSeed, returnedSeed: effectiveSeed, seed: effectiveSeed, generatedAt: now()
  };
  book.localSample = snapshot.imageEngine==='sample' || result.meta?.generationMode==='offline-template';
  return page;
}
