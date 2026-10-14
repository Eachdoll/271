import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState,makeOutline} from '../dist/engine.js';
import {getStylePreset,validateStylePreset} from '../dist/image-generation/styles.js';
import {migrateWorldState,getActiveWorld,createCharacterSheetRequest,getCharacterSheet,markCharacterSheetConfirmed,captureBookGenerationSnapshot,updateWorldGenerationSettings} from '../dist/image-generation/world.js';
import {updateCharacter} from '../dist/management.js';
import {suggestCompanions} from '../dist/companions.js';
import {generateImage} from '../dist/image-generation/providers.js';

test('cover watercolor uses the actual cover; old flat sheets do not anchor new AI sheets',()=>{
  const state=seedState();migrateWorldState(state);const world=getActiveWorld(state),preset=getStylePreset('watercolor');
  assert.equal(preset.styleRefImages[0],'/assets/hero.png');assert.equal(validateStylePreset(preset).valid,true);
  const request=createCharacterSheetRequest(state,'yuha');assert.deepEqual(request.referenceImages.map(ref=>ref.imageUrl),preset.styleRefImages);
  state.characters[0].characterSheets.push({confirmedAt:'now',imageUrl:'data:image/png;base64,template',meta:{generationMode:'offline-template'}});
  updateWorldGenerationSettings(state,{imageEngine:'google',stylePresetId:'watercolor'});
  assert.deepEqual(createCharacterSheetRequest(state,'yuha').referenceImages.map(ref=>ref.imageUrl),preset.styleRefImages);
  state.characters[0].characterSheets.push({confirmedAt:'now',imageUrl:'data:image/png;base64,real',meta:{source:'photo-stylized'}});
  assert.deepEqual(createCharacterSheetRequest(state,'yuha').referenceImages.map(ref=>ref.imageUrl),['data:image/png;base64,real',...preset.styleRefImages]);
});
test('old watercolor Worlds upgrade once and preserve frozen books',()=>{
  const state=seedState();migrateWorldState(state);const world=getActiveWorld(state);
  const book={characterIds:['yuha']};captureBookGenerationSnapshot(state,book);const before=structuredClone(book.generationSnapshot);
  delete world.stylePresetVersion;migrateWorldState(state);assert.equal(world.revision,2);assert.equal(getCharacterSheet(state,'yuha'),null);
  migrateWorldState(state);assert.equal(world.revision,2);assert.deepEqual(book.generationSnapshot,before);
});
test('editing one character invalidates only that character sheet',()=>{
  const state=seedState();migrateWorldState(state);const edited=updateCharacter(state,'yuha',{name:'유하 새 이름'});
  assert.equal(getCharacterSheet(edited,'yuha'),null);assert.ok(getCharacterSheet(edited,'greenie'));
  markCharacterSheetConfirmed(edited,'yuha',{imageUrl:'data:image/png;base64,real',seed:4,meta:{requestedSeed:4}});assert.ok(getCharacterSheet(edited,'yuha'));
});
test('free sample is deterministic, makes no requests, and rejects photo conversion',async()=>{
  const old=globalThis.fetch;globalThis.fetch=()=>{throw Error('unexpected network');};
  try{const preset=getStylePreset('watercolor'),request={prompt:'sample',stylePreset:preset,referenceImages:preset.styleRefImages,seed:55,size:'1024x1024',quality:'high',sampleContext:{kind:'sheet',character:{name:'Jo',kind:'rabbit',color:'#bbaa99'}}};
    const first=await generateImage(request,{engine:'sample'}),second=await generateImage(request,{engine:'sample'});assert.equal(first.imageUrl,second.imageUrl);assert.equal(first.seed,55);assert.equal(first.meta.referenceImagesUsed,false);
    await assert.rejects(generateImage({...request,sampleContext:{kind:'photo'}},{engine:'sample'}),/사진|photo/i);
  }finally{globalThis.fetch=old;}
});
test('topic suggestions avoid duplicate names and chosen companions appear in story text',()=>{
  const suggestions=suggestCompanions('달에 놀러 가는 이야기',[{name:'달토'}]);assert.equal(suggestions.length,3);assert.equal(suggestions[0].name,'달토2');assert.equal(suggestions[0].role,'조연');
  const state=seedState(),friend=suggestCompanions('바닷속 보물 찾기')[0];state.characters.push(friend);
  const outline=makeOutline({characterIds:['yuha',friend.id],topic:'바닷속 보물 찾기',pageCount:8},state.characters);assert.ok(outline.some(page=>page.ko.includes(friend.name)));
});
