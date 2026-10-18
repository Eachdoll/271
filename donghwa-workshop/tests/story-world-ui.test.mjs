import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {configureStoryQualityUI,renderQualityWorldSelectors,storyWorldTopic,renderStoryQualitySettings,cleanupStoryQualityUI} from '../dist/story-generation/quality-settings.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {seedState} from '../dist/engine.js';
import {migrateWorldState,getActiveWorld} from '../dist/image-generation/world.js';

const worldLibrary=JSON.parse(await readFile(new URL('../dist/story-quality/data/worlds.json',import.meta.url),'utf8'));
const patterns=JSON.parse(await readFile(new URL('../dist/story-quality/data/plot_patterns.json',import.meta.url),'utf8'));
const qualityData={worldLibrary,plotPatterns:patterns,goldBooks:[],inventories:{twistTypes:[]}};
const originalDocument=globalThis.document,handlers={};let state={settings:{storyQuality:{}}},topic='내가 직접 적은 주제',topicChanges=0;
globalThis.document={addEventListener:(name,handler)=>{handlers[name]=handler;},querySelector:()=>null,querySelectorAll:()=>[]};
configureStoryQualityUI({qualityData,getState:()=>state,isParent:()=>true,save:()=>true,render:()=>{},toast:()=>{},setWizardTopic:value=>{topic=value;topicChanges++;}});

function field(html,name){return html.match(new RegExp(`<select[^>]+id="${name}"[^>]*>([\\s\\S]*?)<\\/select>`))?.[1]||'';}

test('adventure-stage selector lists the real 100 cards by era and preserves the existing-background default',()=>{
 const html=renderQualityWorldSelectors({}, {state});
 assert.equal((field(html,'storyWorldId').match(/<option /g)||[]).length,101);for(const name of ['현재','과거','미래','상상'])assert.ok(html.includes(`<optgroup label="${name}">`));
 assert.match(field(html,'storyWorldId'),/value="drawer" selected/);assert.match(field(html,'storySeason'),/value="auto" selected/);assert.match(field(html,'storyTimeOfDay'),/value="auto" selected/);assert.match(html,/data-quality-action="world-topic" disabled/);
 const chosen=worldLibrary.worlds.find(world=>world.era==='future'),explicit=renderQualityWorldSelectors({storyWorldId:chosen.id,storySeason:'winter',storyTimeOfDay:'night'},{state});
 assert.ok(field(explicit,'storyWorldId').includes(`value="${chosen.id}" selected`));assert.match(field(explicit,'storySeason'),/value="winter" selected/);assert.match(field(explicit,'storyTimeOfDay'),/value="night" selected/);assert.match(explicit,/엔진과 화풍은 현재 월드 설정/);
 const parent=renderStoryQualitySettings(state);assert.match(parent,/id="quality-default-storyWorldId"/);assert.match(parent,/id="quality-variant-chance"[^>]+value="35"/);
});

test('world selection never replaces a typed topic, image engine, style or custom background drawer',()=>{
 state=seedState();migrateWorldState(state);state.settings.storyQuality={variantChance:0};const active=getActiveWorld(state),before=structuredClone(active),backgrounds=structuredClone(state.backgrounds);
 const chosen=worldLibrary.worlds.find(world=>world.era==='fantasy'),wizard={characterIds:['yuha'],backgroundIds:[],topic,storyWorldId:chosen.id,storySeason:'summer',storyTimeOfDay:'night',storyDate:'2026-10-17T09:00:00.000Z',pageCount:12,koreanLevel:'K1',englishLevel:'E0'};
 const prepared=inputFromWizard(state,wizard);assert.equal(prepared.input.storyQuality.worldId,chosen.id);assert.equal(prepared.input.storyQuality.season,'summer');assert.equal(prepared.input.storyQuality.timeOfDay,'night');assert.equal(prepared.input.storyQuality.variantChance,0);assert.equal(prepared.input.storyDate,wizard.storyDate);assert.equal(prepared.input.topic,topic);assert.deepEqual(getActiveWorld(state),before);assert.deepEqual(state.backgrounds,backgrounds);
 const hint={textContent:''},button={disabled:true,dataset:{}},status={textContent:''},container={querySelector:selector=>selector==='[data-quality-world-hint]'?hint:selector==='[data-quality-topic-status]'?status:button};
 handlers.change({target:{dataset:{qualityWorldField:'storyWorldId'},value:chosen.id,closest:()=>container}});assert.equal(topicChanges,0);assert.equal(topic,wizard.topic);assert.equal(button.disabled,false);
});

test('world labels and hints are escaped, while disabled selectors stay read only',()=>{
 const malicious=structuredClone(qualityData);malicious.worldLibrary.worlds[0].name.ko='<img src=x onerror=bad>';malicious.worldLibrary.worlds[0].arrival='<script>bad</script>';
 configureStoryQualityUI({qualityData:malicious,getState:()=>state,isParent:()=>true});
 try{const html=renderQualityWorldSelectors({storyWorldId:malicious.worldLibrary.worlds[0].id},{state,disabled:true});assert.doesNotMatch(html,/<img|<script>/);assert.equal((html.match(/data-quality-world-field="[^"]+" disabled/g)||[]).length,3);assert.match(html,/&lt;script/);}
 finally{configureStoryQualityUI({qualityData,getState:()=>state,isParent:()=>true,save:()=>true,render:()=>{},toast:()=>{},setWizardTopic:value=>{topic=value;topicChanges++;}});}
});

test('explicit world-theme requests are deterministic, cycle to another idea and make no model calls',async()=>{
 const chosen=worldLibrary.worlds.find(world=>world.id==='forest')||worldLibrary.worlds.find(world=>world.era==='present'),before=structuredClone(qualityData),priorFetch=globalThis.fetch;let network=0;
 globalThis.fetch=()=>{network++;throw Error('No paid or network call for theme templates');};
 try{const first=await storyWorldTopic(chosen.id,{season:'autumn',timeOfDay:'day',offset:0,data:qualityData}),same=await storyWorldTopic(chosen.id,{season:'autumn',timeOfDay:'day',offset:0,data:qualityData}),next=await storyWorldTopic(chosen.id,{season:'autumn',timeOfDay:'day',offset:1,data:qualityData});assert.deepEqual(first,same);assert.notEqual(first.topic,next.topic);assert.equal(first.worldId,chosen.id);assert.ok(first.topic.length>0);assert.equal(network,0);assert.deepEqual(qualityData,before);await assert.rejects(storyWorldTopic('drawer',{data:qualityData}),/모험 무대/);}
 finally{globalThis.fetch=priorFetch;}
});

test.after(()=>{cleanupStoryQualityUI();globalThis.document=originalDocument;});

test('R8-1 only newly prepared drafts freeze language-specific compression policy',()=>{
 const state=seedState();migrateWorldState(state);
 for(const [koreanLevel,englishLevel] of [['K1','E0'],['K1','E2'],['K2','E0'],['K2','E2']]) {
  const prepared=inputFromWizard(state,{characterIds:['yuha'],backgroundIds:[],topic:'작은 바람',pageCount:12,koreanLevel,englishLevel});
  assert.deepEqual(prepared.input.prosePolicy,{version:1,condenseOverBudget:{ko:koreanLevel==='K1',en:englishLevel==='E0'}});
 }
});
