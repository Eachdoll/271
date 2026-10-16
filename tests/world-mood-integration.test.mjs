import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {findWorld,worldCoreLines} from '../story-quality/dist/worlds.js';
import {applyOverlay,allWorldStates,generateTopics,expandInventory} from '../story-quality/dist/expand.js';
import {runDistillation,loadExisting} from '../story-quality/dist/distill/generate.js';
import {resolveStoryWorld} from '../dist/story-generation/quality-adapter.js';
import {buildScenePrompt} from '../dist/image-generation/scene-prompt.js';
import {renderImageRequest} from '../dist/image-generation/story-renderer.js';

const read=async name=>JSON.parse(await readFile(new URL(`../story-quality/${name}`,import.meta.url),'utf8'));
const worlds=await read('data/worlds.json'),inventory=await read('data/inventories.json'),patterns=await read('data/plot_patterns.json'),topicSet=await read('distill/topics.json');
const normalized=value=>String(value).normalize('NFKC').replace(/\s+/gu,' ').trim();

test('expanded package has 100 unique world cards, 323 base props and disjoint training, eval and gold topics',async()=>{
  assert.equal(worlds.worlds.length,100);assert.equal(new Set(worlds.worlds.map(world=>world.id)).size,100);assert.equal(new Set(worlds.worlds.map(world=>world.name.ko)).size,100);assert.equal(inventory.plantedObjects.length,323);
  const expanded=expandInventory(inventory);assert.ok(expanded.plantedObjects.length>1000);assert.ok(expanded.creatures.length>2000);assert.equal(new Set(expanded.plantedObjects.map(item=>item.ko)).size,expanded.plantedObjects.length);
  const evaluation=await read('eval/testset.json'),gold=[...await read('gold/gold_outlines_part1.json'),...await read('gold/gold_outlines_part2.json')],training=new Set(topicSet.topics.map(topic=>normalized(topic.topic))),testTopics=new Set(evaluation.topics.map(topic=>normalized(topic.topic)));
  assert.equal(training.size,topicSet.topics.length);assert.equal(topicSet.topics.filter(topic=>topic.source==='hand').length,50);assert.ok(topicSet.topics.length>=1200);assert.equal(testTopics.size,20);assert.equal(gold.length,24);
  for(const topic of evaluation.topics)assert.equal(training.has(normalized(topic.topic)),false,topic.topic);
  for(const topic of gold){assert.equal(training.has(normalized(topic.topic)),false,topic.topic);assert.equal(testTopics.has(normalized(topic.topic)),false,topic.topic);}
  assert.equal(new Set(topicSet.topics.slice(0,200).map(topic=>topic.worldId)).size,100);
});

test('season overlays are deterministic, leave fixed geometry untouched and respect nonseasonal worlds',()=>{
  const source=structuredClone(worlds),kyoto=findWorld(worlds,'kyoto_lane'),first=applyOverlay(worlds,kyoto,'autumn','night'),again=applyOverlay(worlds,kyoto,'autumn','night');
  assert.deepEqual(first,again);assert.equal(first.season,'autumn');assert.equal(first.timeOfDay,'night');assert.deepEqual(first.landmarks,kyoto.landmarks);assert.deepEqual(first.subLocations,kyoto.subLocations);assert.deepEqual(worlds,source);assert.match(worldCoreLines(worlds,first)[0],/가을 밤/u);
  const space=applyOverlay(worlds,findWorld(worlds,'mars_base'),'summer','night');assert.equal(space.season,null);assert.equal(space.timeOfDay,'night');assert.equal(allWorldStates(worlds).length,602);
  const excluded=topicSet.topics.filter(topic=>topic.source==='hand').map(topic=>topic.topic),a=generateTopics(worlds,{perWorld:12,seed:17,exclude:excluded}),b=generateTopics(worlds,{perWorld:12,seed:17,exclude:excluded});assert.deepEqual(a,b);assert.equal(new Set(a.map(topic=>topic.worldId)).size,100);assert.ok(a.every(topic=>!excluded.includes(topic.topic)));
});

test('app atmosphere uses the frozen Seoul creation date and adds no catalogue geometry or style override to artwork',()=>{
  const library=structuredClone(worlds),card=findWorld(library,'kyoto_lane');card.landmarks=[{ko:'선택하지 않은 탑 88',en:'UNSELECTED_TOWER_88'}];card.arrival='UNSELECTED_PORTAL_88';card.styleHint='FORBIDDEN_STYLE_OVERRIDE_88';
  const source={storyDate:'2026-02-28T15:01:00.000Z',storyQuality:{worldId:'kyoto_lane',season:'auto',timeOfDay:'night'}},before=structuredClone(source),{world,mood}=resolveStoryWorld(source,{worldLibrary:library});
  assert.equal(mood.season,'spring','the frozen UTC instant is March 1 in Seoul');assert.equal(mood.timeOfDay,'night');assert.deepEqual(resolveStoryWorld(source,{worldLibrary:library}).mood,mood);assert.deepEqual(source,before);assert.deepEqual(world.landmarks,card.landmarks);assert.doesNotMatch(mood.styleLine,/UNSELECTED|FORBIDDEN/u);assert.match(mood.worldCore.join(' '),/선택하지 않은 탑 88/u);
  const page={pageNo:1,beatIndex:1,ko:'유하가 둥근 문 앞에서 잎을 들어요.',en:'Yuha lifts a leaf by the round door.',scene:{timeOfDay:'morning',action:'Yuha lifts a leaf beside the same round green door.'}},book={characterIds:['yuha'],outline:{quality:{worldMood:mood}}},prompt=buildScenePrompt({book,page,pageIndex:0,snapshot:{characterSheets:[]},place:{background:{name:'선택한 집',layout:'one round green door, one square yellow window'}}});
  assert.match(prompt,/Seasonal atmosphere only/u);assert.match(prompt,/one round green door/u);assert.match(prompt,/current page time \(morning\).*take precedence/u);assert.doesNotMatch(prompt,/UNSELECTED|FORBIDDEN|선택하지 않은 탑 88/u);
  const style='  original watercolor paper\nsoft pigment  ',rendered=renderImageRequest({prompt,stylePreset:{stylePrompt:style,negativePrompt:'no new buildings'},referenceImages:[]});assert.ok(rendered.composedPrompt.startsWith(style+'\n\n'));assert.match(rendered.composedPrompt,/ARCHITECTURE LOCK/u);assert.doesNotMatch(rendered.composedPrompt,/UNSELECTED|FORBIDDEN/u);
  assert.equal(resolveStoryWorld({storyDate:source.storyDate,storyQuality:{worldId:'mars_base',season:'spring',timeOfDay:'night'}},{worldLibrary:library}).mood.season,null);assert.deepEqual(resolveStoryWorld({storyQuality:{worldId:'drawer'}},{worldLibrary:library}),{world:null,mood:null});assert.throws(()=>resolveStoryWorld({storyQuality:{worldId:'unknown-world'}},{worldLibrary:library}),/선택한 모험 무대/u);
});

test('distillation dry run selects stable cell seasons and alternating day/night without touching model engines',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'donghwa-world-cell-'));let modelCalls=0;
  const blocked={id:'blocked-model',async complete(){modelCalls++;throw Error('dry run must never call a model');}},topic={...topicSet.topics.find(topic=>topic.worldId==='kyoto_lane')},config={generator:blocked,judge:blocked,topics:[topic],levels:[{levelKo:'K1',levelEn:'E0'}],pages:12,patterns,worlds,inventories:inventory,protagonist:{name:'유하',traits:['관찰']},supporting:[],variantsPerCell:2,concurrency:1,dryRun:true};
  try{await runDistillation({...config,outPath:join(directory,'first.jsonl')});await runDistillation({...config,outPath:join(directory,'repeat.jsonl')});const a=[...loadExisting(join(directory,'first.jsonl')).values()],b=[...loadExisting(join(directory,'repeat.jsonl')).values()];assert.equal(modelCalls,0);assert.equal(a.length,2);assert.deepEqual(a.map(row=>row.worldState),b.map(row=>row.worldState));assert.deepEqual(a.map(row=>row.worldState.timeOfDay),['day','night']);assert.ok(a.every(row=>row.outline===null&&row.costUsd===0));}finally{await rm(directory,{recursive:true,force:true});}
});

test('the cost estimate CLI exits without credentials, provider calls or a generated dataset',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'donghwa-estimate-')),output=join(directory,'must-not-generate.jsonl'),block='data:text/javascript,globalThis.fetch=()=>{throw new Error("estimate attempted network")};';
  try{const result=execFileSync(process.execPath,['--import',block,'dist/cli/distill.js','--estimate','--limit','2','--out',output],{cwd:new URL('../story-quality/',import.meta.url),env:{...process.env,ANTHROPIC_API_KEY:'',OPENAI_API_KEY:''},encoding:'utf8'});assert.match(result,/cells=4/u);assert.match(result,/est\. cost/u);await assert.rejects(access(output),{code:'ENOENT'});}finally{await rm(directory,{recursive:true,force:true});}
});
