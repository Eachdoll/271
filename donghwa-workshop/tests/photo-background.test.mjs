import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhotoGenerationRequest,createPhotoBackgroundMaterial,validatePhotoFiles} from '../dist/photo-materials.js';
import {getStylePreset} from '../dist/image-generation/styles.js';
import {renderImageRequest} from '../dist/image-generation/story-renderer.js';
import {seedState} from '../dist/engine.js';
import {migrateWorldState,getActiveWorld,getWorldBackgroundSnapshot,captureBookGenerationSnapshot,sceneReferenceRecords} from '../dist/image-generation/world.js';
import {backgroundSettingsKey} from '../dist/background-sheets.js';
import {createWorldVariation,activateWorldVariation} from '../dist/world-variations.js';

const fields={name:'우리 방',nameEn:'Our Room',type:'home',description:'노란 창문과 초록 책장',layout:'왼쪽 창 아래 침대, 오른쪽 문 옆 책장'};
function library(){const state=seedState();migrateWorldState(state);return state;}
function candidate(world,patch={}){return {imageAssetId:'image-photo-room-final',imageUrl:'blob:approved-drawing-preview',seed:null,meta:{worldId:world.id,worldRevision:world.revision,engine:world.imageEngine,stylePresetId:world.stylePresetId,quality:'final',source:'photo-stylized',requestedSeed:920,photoReferenceCount:2,referenceCount:3},...patch};}

test('place photos use background roles and keep separate authoritative painting references',()=>{
  const photos=[new Blob(['room view'],{type:'image/png'}),new Blob(['room detail'],{type:'image/png'})],style=getStylePreset('watercolor');
  const request=createPhotoGenerationRequest({kind:'background',fields,photos,stylePreset:style,seed:920});
  assert.deepEqual(Object.keys(request).sort(),['prompt','stylePreset','referenceImages','seed','size','quality'].sort());
  assert.deepEqual(request.referenceImages.map(x=>x.role),['background','background','style_sheet']);
  assert.equal(request.referenceImages[0].blob,photos[0]);assert.equal(request.referenceImages[1].blob,photos[1]);
  assert.equal(request.referenceImages[2].imageUrl,'/assets/hero.png');
  assert.equal(request.seed,920);assert.equal(request.quality,'draft');assert.equal(request.size,'1536x1024');
  assert.match(request.prompt,/References labeled source place layout photo define the photographed place/);
  assert.doesNotMatch(request.prompt,/first \d|after the first|later references/i);
  const rendered=renderImageRequest(request,{maxReferenceImages:14});
  assert.deepEqual(rendered.referenceImages.map(x=>x.role),['style_sheet','background','background']);
  assert.match(rendered.composedPrompt,/Image 1 is authoritative style 1: authoritative rendering style/);
  assert.match(rendered.composedPrompt,/Image 2 is source place layout photo 1: background layout and setting/);
  assert.match(rendered.composedPrompt,/Image 3 is source place layout photo 2: background layout and setting/);
  assert.match(rendered.composedPrompt,/regardless of attachment order/);
  assert.doesNotMatch(rendered.composedPrompt,/Only the first|All references after/);
  assert.match(request.prompt,/wide establishing view plus closer detail panels/);
  assert.match(request.prompt,/SAME exact photographed place/);assert.match(request.prompt,/window and door positions, furniture arrangement/);
  assert.match(request.prompt,/Do not invent unobserved rooms/);assert.match(request.prompt,/omit that detail rather than guessing/);
  assert.match(request.prompt,/왼쪽 창 아래 침대/);assert.match(request.prompt,/remove people, animals, faces, addresses/);
  assert.match(request.prompt,/painting medium and palette only, never place geometry/);
  assert.match(request.prompt,/No words, captions, labels, arrows/);
  assert.deepEqual(style,getStylePreset('watercolor'));
});

test('character identity references retain their existing role and multi-view sheet instructions',()=>{
  const request=createPhotoGenerationRequest({kind:'character',fields:{name:'유하'},photos:['data:image/png;base64,test'],stylePreset:getStylePreset('watercolor'),seed:0});
  assert.deepEqual(request.referenceImages.map(x=>x.role),['character_front','style_sheet']);
  assert.match(request.prompt,/front full-body view, side full-body view, back full-body view/);
  assert.match(request.prompt,/simplified facial details/);assert.doesNotMatch(request.prompt,/unobserved rooms/);
});

test('an approved photo background registers a World-specific immutable sheet without keeping source files or preview URLs',()=>{
  const state=library(),world=getActiveWorld(state),result=candidate(world),before=JSON.stringify(result);
  const item=createPhotoBackgroundMaterial({fields:{...fields,photos:['blob:private-source-photo']},candidate:result,world,confirmedAt:'2026-10-15T09:00:00.000Z'});
  assert.equal(JSON.stringify(result),before);assert.equal(item.layout,fields.layout);assert.equal(item.photoBased,true);assert.equal(item.importedIllustration,false);
  assert.equal(item.imageUrl,'asset:image-photo-room-final');assert.equal(item.backgroundSheetSettingsKey,backgroundSettingsKey(item));
  assert.equal(item.backgroundSheetSeed,null);assert.equal(item.imageSeed,920);assert.equal(item.backgroundSheetMeta.returnedSeed,null);
  assert.equal(item.backgroundSheets.length,1);const sheet=item.backgroundSheets[0];
  assert.equal(sheet.settings,backgroundSettingsKey(item));assert.equal(sheet.confirmedAt,item.backgroundSheetConfirmedAt);
  assert.deepEqual({engine:sheet.meta.imageEngine,worldId:sheet.meta.worldId,revision:sheet.meta.worldRevision,style:sheet.meta.stylePresetId,quality:sheet.meta.quality},{engine:world.imageEngine,worldId:world.id,revision:world.revision,style:world.stylePresetId,quality:'final'});
  assert.equal(JSON.stringify(item).includes('blob:'),false);assert.equal(Object.hasOwn(item,'photos'),false);
  sheet.meta.quality='changed-test-value';assert.equal(item.backgroundSheetMeta.quality,'final');
});

test('photo-created background is selected in its World, frozen into books, and invalidated when fixed layout changes',()=>{
  const state=library(),world=getActiveWorld(state),item=createPhotoBackgroundMaterial({fields,candidate:candidate(world),world});state.backgrounds.push(item);
  assert.equal(getWorldBackgroundSnapshot(state,item).backgroundSheetStale,false);
  const book={characterIds:['yuha'],backgroundIds:[item.id],pageCount:1,pages:[{scene:{where:item.id}}]};
  const snapshot=captureBookGenerationSnapshot(state,book);snapshot.backgroundReferenceByPage={0:[item.id]};
  const frozen=JSON.stringify(snapshot),ref=sceneReferenceRecords(snapshot,0).find(x=>x.role==='background');
  assert.equal(ref.imageAssetId,item.imageAssetId);assert.equal(ref.layout,fields.layout);
  const variation=createWorldVariation(state,world.id,{name:'다른 그림 세계',imageEngine:'openai',stylePresetId:'crayon'});activateWorldVariation(state,variation.id);
  assert.equal(getWorldBackgroundSnapshot(state,item).backgroundSheetStale,true);assert.equal(getWorldBackgroundSnapshot(state,item).imageAssetId,undefined);
  activateWorldVariation(state,world.id);assert.equal(getWorldBackgroundSnapshot(state,item).imageAssetId,item.imageAssetId);
  item.layout='오른쪽 창, 왼쪽 문';assert.equal(getWorldBackgroundSnapshot(state,item).backgroundSheetStale,true);
  assert.equal(JSON.stringify(snapshot),frozen);
});

test('finished illustration import registers a free reusable background with unknown generation seed',()=>{
  const state=library(),world=getActiveWorld(state),result=candidate(world);delete result.meta.quality;result.meta.source='imported-illustration';result.meta.requestedSeed=null;
  const item=createPhotoBackgroundMaterial({fields,candidate:result,world,mode:'import'});state.backgrounds.push(item);
  assert.equal(item.importedIllustration,true);assert.equal(item.photoBased,false);assert.equal(item.backgroundSheetMeta.quality,'imported');assert.equal(item.backgroundSheetSeed,null);
  assert.equal(getWorldBackgroundSnapshot(state,item).backgroundSheetStale,false);
});

test('draft approval, mismatched World approval, and invalid photo uploads stop before persistence',()=>{
  const state=library(),world=getActiveWorld(state),result=candidate(world),draft=structuredClone(result);draft.meta.quality='draft';
  assert.throws(()=>createPhotoBackgroundMaterial({fields,candidate:draft,world}),/최종 화질/);
  for(const key of ['worldId','worldRevision','engine','stylePresetId']){const stale=structuredClone(result);stale.meta[key]='mismatch';assert.throws(()=>createPhotoBackgroundMaterial({fields,candidate:stale,world}),/현재 World/);}
  assert.throws(()=>validatePhotoFiles([]),/1~3/);assert.throws(()=>validatePhotoFiles(Array(4).fill({type:'image/png',size:12})),/1~3/);
  assert.throws(()=>validatePhotoFiles([{type:'image/svg+xml',size:12}]),/JPG/);assert.throws(()=>validatePhotoFiles([{type:'image/png',size:11*1024*1024}]),/10MB/);
  assert.equal(state.backgrounds.some(x=>x.name===fields.name),false);
});
