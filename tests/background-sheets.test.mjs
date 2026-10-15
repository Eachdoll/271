import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {backgroundSettingsKey,backgroundSheetRequest,renderBackgroundSheetActions} from '../dist/background-sheets.js';
import {migrateWorldState,getActiveWorld,getWorldBackgroundSnapshot,captureBookGenerationSnapshot,sceneReferenceRecords,markCharacterSheetConfirmed,updateWorldGenerationSettings} from '../dist/image-generation/world.js';
import {createWorldVariation,activateWorldVariation} from '../dist/world-variations.js';
import {applySeriesContinuity} from '../dist/story-generation/continuity.js';

const IMAGE='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=';
function library(){const state=seedState();migrateWorldState(state);return state;}
function location(state){const b={id:'fixed-room',name:'유하의 방',type:'home',description:'노란 창문과 둥근 책상',layout:'왼쪽 창, 오른쪽 문, 창 아래 낮은 침대',imageUrl:IMAGE};state.backgrounds.push(b);return b;}
function approve(state,b,id){const world=getActiveWorld(state),sheet={id,imageAssetId:id,imageUrl:'asset:'+id,confirmedAt:'2026-10-15T00:00:00.000Z',settings:backgroundSettingsKey(b),seed:4321,meta:{worldId:world.id,worldRevision:world.revision,imageEngine:world.imageEngine,stylePresetId:world.stylePresetId,quality:'final',source:'app-background-sheet'}};b.backgroundSheets||=[];b.backgroundSheets.push(sheet);b.imageAssetId=id;b.imageUrl=sheet.imageUrl;b.backgroundSheetMeta=structuredClone(sheet.meta);return sheet;}

test('an environment sheet preserves place geometry and sends established place plus separate painting reference',()=>{
  const state=library(),b=location(state),request=backgroundSheetRequest(state,b,{seed:923,quality:'draft'});
  assert.equal(request.seed,923);assert.equal(request.quality,'draft');assert.equal(request.size,'1536x1024');
  assert.match(request.prompt,/SAME exact place/);assert.match(request.prompt,/window and door positions/);assert.match(request.prompt,/furniture arrangement/);assert.match(request.prompt,/no people, animals/);assert.match(request.prompt,/no .*words|words, captions/);
  assert.match(request.prompt,/왼쪽 창, 오른쪽 문/);assert.match(request.prompt,/Style images define painting medium only/);
  assert.deepEqual(request.referenceImages.map(x=>x.role),['background','style_sheet']);
  assert.equal(request.referenceImages[0].imageUrl,IMAGE);assert.equal(request.referenceImages[1].imageUrl,'/assets/hero.png');
  const second=backgroundSheetRequest(state,b,{seed:request.seed,quality:'final'});assert.equal(second.seed,923);assert.equal(second.quality,'final');assert.deepEqual(second.referenceImages,request.referenceImages);
});

test('each World restores its own approved place rendering after serialized reload',()=>{
  const state=library(),b=location(state),original=getActiveWorld(state);approve(state,b,'image-room-world-original');
  const next=createWorldVariation(state,original.id,{name:'방의 연필 세계',imageEngine:'openai',stylePresetId:'crayon'});activateWorldVariation(state,next.id);
  assert.equal(getWorldBackgroundSnapshot(state,b).backgroundSheetStale,true);assert.equal(getWorldBackgroundSnapshot(state,b).imageAssetId,undefined);
  approve(state,b,'image-room-world-variation');assert.equal(getWorldBackgroundSnapshot(state,b).imageAssetId,'image-room-world-variation');
  activateWorldVariation(state,original.id);assert.equal(getWorldBackgroundSnapshot(state,b).imageAssetId,'image-room-world-original');
  const loaded=JSON.parse(JSON.stringify(state)),loadedB=loaded.backgrounds.find(x=>x.id===b.id);activateWorldVariation(loaded,next.id);assert.equal(getWorldBackgroundSnapshot(loaded,loadedB).imageAssetId,'image-room-world-variation');
  assert.equal(loadedB.backgroundSheets.length,2);
});

test('approvals require exact World, revision, image engine, style, and fixed-place facts',()=>{
  const state=library(),b=location(state);approve(state,b,'image-approved-current-room');assert.equal(getWorldBackgroundSnapshot(state,b).backgroundSheetStale,false);
  for(const change of [w=>w.id='different',w=>w.revision++,w=>w.imageEngine='openai',w=>w.stylePresetId='crayon']){
    const world=structuredClone(getActiveWorld(state));change(world);const selected=getWorldBackgroundSnapshot(state,b,world);assert.equal(selected.backgroundSheetStale,true);assert.equal(selected.imageAssetId,undefined);
  }
  b.layout='오른쪽 창, 왼쪽 문';const stale=getWorldBackgroundSnapshot(state,b);assert.equal(stale.backgroundSheetStale,true);assert.equal(stale.imageAssetId,undefined);
  assert.match(renderBackgroundSheetActions(b,state),/이 World의 배경 시트 다시 생성 필요/);
});

test('existing books and subsequent episodes keep the approved room sheet despite new place facts and World settings',()=>{
  const state=library(),b=location(state);approve(state,b,'image-original-approved-room');
  const old={id:'previous-room-book',approved:true,characterIds:['yuha'],backgroundIds:[b.id],pages:[{ko:'노란 창문 아래 잠들어요.',en:'Yuha sleeps under the yellow window.',scene:{where:b.id,action:'Yuha sleeps under the yellow window in the small room.'}}],pageCount:1};
  captureBookGenerationSnapshot(state,old);old.generationSnapshot.backgroundReferenceByPage={0:[b.id]};const frozen=JSON.stringify(old.generationSnapshot);
  b.description='파란 창문과 긴 책상';updateWorldGenerationSettings(state,{imageEngine:'openai',stylePresetId:'crayon'});approve(state,b,'image-new-room-art');
  assert.equal(JSON.stringify(old.generationSnapshot),frozen);
  const next={id:'sequel-room-book',characterIds:['yuha'],backgroundIds:[b.id],pages:[{ko:'아침에 같은 창문을 열어요.',en:'Yuha opens the yellow window.',scene:{where:b.id,action:'Yuha opens the same yellow window beside the low bed.'}}],pageCount:1};
  applySeriesContinuity(state,next,old);const ref=sceneReferenceRecords(next.generationSnapshot,0).find(x=>x.role==='background');
  assert.equal(ref.imageAssetId,'image-original-approved-room');assert.equal(ref.description,'노란 창문과 둥근 책상');assert.equal(next.generationSnapshot.imageEngine,old.generationSnapshot.imageEngine);assert.equal(JSON.stringify(old.generationSnapshot),frozen);
});

test('a new book freezes only the selected World background and a scene receives only its matching location',()=>{
  const state=library(),room=location(state);updateWorldGenerationSettings(state,{imageEngine:'openai'});markCharacterSheetConfirmed(state,'yuha',{imageUrl:IMAGE,seed:null,meta:{requestedSeed:7}});approve(state,room,'image-openai-room-approved');
  const forest={id:'fixed-forest',name:'작은 숲',type:'forest',description:'둥근 나무 세 그루'};state.backgrounds.push(forest);approve(state,forest,'image-openai-forest-approved');
  const book={characterIds:['yuha'],backgroundIds:[room.id,forest.id],pageCount:3,pages:[{scene:{where:room.id}},{scene:{where:forest.id}},{scene:{where:'new-location'}}]};const snapshot=captureBookGenerationSnapshot(state,book);snapshot.backgroundReferenceByPage={0:[room.id],1:[forest.id],2:[]};
  assert.equal(snapshot.backgrounds.find(x=>x.id===room.id).imageAssetId,'image-openai-room-approved');
  assert.deepEqual(sceneReferenceRecords(snapshot,0).filter(x=>x.role==='background').map(x=>x.imageAssetId),['image-openai-room-approved']);
  assert.deepEqual(sceneReferenceRecords(snapshot,1).filter(x=>x.role==='background').map(x=>x.imageAssetId),['image-openai-forest-approved']);
  assert.equal(sceneReferenceRecords(snapshot,2).filter(x=>x.role==='background').length,0);
  assert.equal(sceneReferenceRecords(snapshot,0).filter(x=>x.role==='style_sheet').length,1);assert.equal(sceneReferenceRecords(snapshot,0).filter(x=>x.role.startsWith('character_')).length,2);
});
