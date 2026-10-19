import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {generateQualityOutline,generateQualityProse,loadStoryQualityData} from '../dist/story-generation/quality-adapter.js';
import {OUTLINE_SCHEMA,BEAT_COUNTS,frozenBeatCount,assertValid} from '../dist/story-generation/schemas.js';
import {demoPlotContract} from '../dist/story-generation/plot-contract.js';
import {getLevelSpec} from '../dist/reading-levels.js';
import * as qualityModule from '../story-quality/dist/pipeline.js';

const clone=value=>JSON.parse(JSON.stringify(value));
const read=async file=>JSON.parse(await readFile(new URL(`../story-quality/data/${file}.json`,import.meta.url),'utf8'));
const goldPart=async part=>JSON.parse(await readFile(new URL(`../story-quality/gold/gold_outlines_part${part}.json`,import.meta.url),'utf8'));
const data={inventories:await read('inventories'),gestureDictionary:await read('gesture_dictionary'),plotPatterns:await read('plot_patterns'),worldLibrary:await read('worlds'),goldBooks:[...await goldPart(1),...await goldPart(2)]};
function fixture(){return {bookId:'quality-book-test',qualitySeedOffset:0,topic:'비 오는 날',characters:[{id:'yuha',name:'유하',nameEn:'Yuha',traits:['관찰하는 아이']},{id:'green',name:'그린이',nameEn:'Green',traits:['느긋한 친구']}],backgrounds:[{id:'home',type:'home',name:'유하의 집'},{id:'garden',name:'꽃 정원'},{id:'pond',name:'연못 길'}],pageCount:12,endingType:'home_sleep',worldNotes:'문은 둥근 초록색 문 하나예요.',moral:'함께 기다리기',specs:{ko:getLevelSpec('K1'),en:getLevelSpec('E0')},storyQuality:{enabled:true,useBeamSearch:false,twoPass:true,patternId:'journey_repeat',approvedBooks:[]}};}
function schema(){const value=clone(OUTLINE_SCHEMA);value.required.push('plotContract');return value;}
const services=engine=>({engineFor:async options=>options.engine||engine,qualityData:data,qualityModule:async()=>qualityModule,outlineRequestSchema:schema,baseSystem:'APP_BASE_RULES',levelRules:input=>`FROZEN_LEVEL_SPECS:${JSON.stringify(input.specs)}`,assertValid,inspectOutlineRules:()=>({valid:true,violations:[]})});
function seedFrom(request,prior={}){
  const planted=request.user.match(/- 심을 물건: (.*?) —/u)?.[1]||request.user.match(/심을 물건 (.*?) \/ 반전/u)?.[1]||prior.planted;
  const creature=request.user.match(/- 배경 생물: (.*?) \(/u)?.[1]||request.user.match(/\/ 생물 (.*?) \/ 웃음/u)?.[1]||prior.creature;
  const reasons=[...request.user.matchAll(/\d차 (잘못된 장소|잘못된 방법|거의 됐는데 방해)/gu)].map(match=>({'잘못된 장소':'wrong_place','잘못된 방법':'wrong_method','거의 됐는데 방해':'interrupted'})[match[1]]);
  return {planted,creature,reasons:reasons.length?reasons:prior.reasons};
}
function makeOutline(input,request,seed){
  const count=frozenBeatCount(input),types=['setup','want',...Array.from({length:count-5},()=> 'attempt'),'turn','resolution','close'],locations=types.map((type,i)=>i===0||i===count-1?'home':i%2?'garden':'pond');
  let attempt=0;const summaries=types.map((type,i)=>`${i%2?'그린이가':'유하가'} ${['집에서','정원에서','연못에서','돌 옆에서','길에서','집 앞에서','방에서','창가에서'][i]} ${input.topic}의 흔적을 살펴요. 유하와 그린이가 ${type==='setup'||type==='turn'?seed.planted:'작은 잎'}을 보며 ${type==='turn'?seed.creature:'바람'}의 소리를 들어요.`);
  const outline={plan:{pattern:request.jsonSchema.properties.plan.properties.pattern.enum[0],planted:seed.planted,twistReveal:'앞에서 본 물건을 다시 이용해요.',funnyMoment:'바람에 잎이 코에 앉아요.',failureReasons:seed.reasons},titleCandidates:['바람을 듣는 날','작은 빗방울','잎에 담긴 소리'],logline:'유하와 그린이가 빗방울의 흔적을 찾아요.',want:'빗방울의 소리를 찾고 싶어요.',problem:'소리의 위치가 달라져요.',twist:'앞서 살펴본 물건이 소리를 냈어요.',beats:types.map((type,i)=>({index:i+1,type,summary:summaries[i],characters:['yuha','green'],settingKey:locations[i],newElement:`${i+1}번째 젖은 잎`,failureReason:type==='attempt'?seed.reasons[attempt++]:null})),settings:locations.map((backgroundId,i)=>({beatIndex:i+1,backgroundId})),emotionArc:types.map(()=> '궁금'),newWordsKo:['빗방울','흔적','바람'],newWordsEn:['rain','leaf','wind'],endingType:input.endingType};
  outline.plotContract=demoPlotContract(outline,input);return outline;
}
function fakeOutlineEngine(input,modify){
  const calls=[];let seed={};const engine={id:'openai',calls,async complete(request){calls.push(request);seed=seedFrom(request,seed);let json;
    if(request.user.startsWith('아래 줄거리 JSON에서'))json=clone(JSON.parse(request.user.split('\n\n').at(-1)));
    else json=makeOutline(input,request,seed);
    if(modify)json=modify(json,request,calls.length);
    return {json,text:JSON.stringify(json),usage:{input:100,output:50},costUsd:.01,meta:{requests:1,modelId:'test-quality-model'}};
  }};return engine;
}
function labeled(outline,lang,tell=false){return outline.beats.map(beat=>`${lang==='ko'?'[비트':'[Beat'} ${beat.index} · ${beat.type}] ${lang==='ko'?`유하가 작은 잎을 만져요. 그린이가 “나는 바람을 들어요.”라고 말해요.${tell?' 유하가 행복했어요.':''}`:'Yuha sees a small leaf. Green says, “I hear the wind.”'}`).join('\n\n');}

test('data loader rejects one-letter bans, retries, then caches all six immutable package data files',async()=>{
  const files={'inventories.json':data.inventories,'gesture_dictionary.json':data.gestureDictionary,'plot_patterns.json':data.plotPatterns,'worlds.json':data.worldLibrary,'gold_outlines_part1.json':await goldPart(1),'gold_outlines_part2.json':await goldPart(2)};
  const fetcher=bad=>async url=>({ok:true,json:async()=>{const name=url.pathname.split('/').at(-1);assert.ok(Object.hasOwn(files,name),name);return name==='inventories.json'&&bad?{...clone(data.inventories),forbiddenKeywords:['피']}:clone(files[name]);}});
  await assert.rejects(loadStoryQualityData(fetcher(true)),/두 글자/);
  let calls=0;const good=fetcher(false),loaded=await loadStoryQualityData(async(...args)=>{calls++;return good(...args);});
  assert.equal(calls,6);assert.equal(await loadStoryQualityData(()=>{throw new Error('must use cache');}),loaded);assert.ok(Object.isFrozen(loaded.inventories.plantedObjects));assert.equal(loaded.worldLibrary.worlds.length,100);assert.equal(loaded.goldBooks.length,24);assert.ok(Object.isFrozen(loaded.worldLibrary.worlds));assert.ok(Object.isFrozen(loaded.goldBooks));
});

test('real package outline pipeline preserves app contract, seed metadata and exact billed model calls',async()=>{
  const input=fixture(),before=clone(input),engine=fakeOutlineEngine(input),saved=[],options={engine,config:{apiKey:'not-to-be-serialized'},onCheckpoint:checkpoint=>saved.push(checkpoint)};
  const result=await generateQualityOutline(input,options,services(engine));
  assert.equal(result.meta.requests,1);assert.deepEqual(result.usage,{input:100,output:50,costUsd:.01});assert.equal(result.meta.quality.check.ok,true);assert.ok(result.data.plotContract);assert.equal(result.meta.quality.seed.twist.id.length>0,true);assert.equal(result.meta.quality.patternId,'journey_repeat');assert.deepEqual(input,before);
  const request=engine.calls[0];assert.equal(request.jsonSchema.properties.beats.items.required.includes('newElement'),true);assert.equal(request.jsonSchema.required.includes('settings'),true);assert.equal(request.maxTokens,16000);assert.match(request.system,/APP_BASE_RULES/);assert.match(request.system,/FROZEN_LEVEL_SPECS/);assert.match(request.system,/exact selected background IDs/);assert.doesNotMatch(JSON.stringify(saved),/not-to-be-serialized/);assert.equal(saved.length,1);
  const rerun=await generateQualityOutline(input,{engine,qualityCheckpoint:result.meta.qualityCheckpoint},services(engine));assert.equal(engine.calls.length,1);assert.equal(rerun.meta.requests,0);assert.equal(rerun.meta.resumedCalls,1);assert.deepEqual(rerun.usage,{input:0,output:0});assert.equal(rerun.meta.quality.seedSummary,result.meta.quality.seedSummary);
});

test('a selected world freezes the creation-date season and reuses the same paid checkpoint without mutating caller input',async()=>{
  const input={...fixture(),storyDate:'2026-10-17T02:00:00.000Z'};input.storyQuality={...input.storyQuality,worldId:'kyoto_lane',season:'auto',timeOfDay:'night'};
  const before=clone(input),engine=fakeOutlineEngine(input),first=await generateQualityOutline(input,{engine},services(engine));assert.equal(first.meta.quality.worldMood.worldId,'kyoto_lane');assert.equal(first.meta.quality.worldMood.season,'autumn');assert.equal(first.meta.quality.worldMood.timeOfDay,'night');assert.equal(first.meta.quality.variantChance,.35);assert.deepEqual(input,before);
  const restoredInput=clone(input),resumed=await generateQualityOutline(restoredInput,{engine,qualityCheckpoint:clone(first.meta.qualityCheckpoint)},services(engine));assert.equal(engine.calls.length,1);assert.equal(resumed.meta.requests,0);assert.equal(resumed.meta.resumedCalls,1);assert.deepEqual(resumed.meta.quality.worldMood,first.meta.quality.worldMood);assert.deepEqual(restoredInput,before);
  const outlines={...first.data,quality:first.meta.quality},plain={id:'openai',calls:0,async complete(request){this.calls++;return {text:labeled(outlines,/return English plain/u.test(request.system)?'en':'ko'),usage:{input:1,output:1}};}};
  await generateQualityProse(outlines,input,{engine:plain},services(plain));assert.equal(plain.calls,4);assert.deepEqual(input,before);
});

test('pattern slots adapt to exact app beat counts and seeded inventory changes only when book/offset changes',async()=>{
  for(const pageCount of [8,16,24]){const input=fixture();input.pageCount=pageCount;const engine=fakeOutlineEngine(input),result=await generateQualityOutline(input,{engine},services(engine));assert.equal(result.data.beats.length,frozenBeatCount(input));assert.equal(result.data.beats.filter(beat=>beat.type==='attempt').length,frozenBeatCount(input)-5);}
  const input=fixture(),engine=fakeOutlineEngine(input),first=await generateQualityOutline(input,{engine},services(engine));input.qualitySeedOffset=1;const second=await generateQualityOutline(input,{engine},services(engine));assert.notEqual(first.meta.quality.seed.rngSeed,second.meta.quality.seed.rngSeed);assert.notEqual(first.meta.quality.seedSummary,second.meta.quality.seedSummary);
});

test('one package fix changes only the flagged beat; an unrelated edit is put back from the original instead of discarding the paid outline',async()=>{
  const input=fixture(),engine=fakeOutlineEngine(input,(outline,request)=>{if(request.user.startsWith('아래 줄거리 JSON에서'))outline.beats[2].newElement='고친 젖은 잎';else outline.beats[2].newElement='';return outline;});
  const result=await generateQualityOutline(input,{engine},services(engine));assert.equal(engine.calls.length,2);assert.equal(result.meta.requests,2);assert.equal(result.data.beats[2].newElement,'고친 젖은 잎');
  const bad=fakeOutlineEngine(input,(outline,request)=>{if(request.user.startsWith('아래 줄거리 JSON에서')){outline.beats[2].newElement='고친 젖은 잎';outline.beats[0].summary='아예 다른 시작';}else outline.beats[2].newElement='';return outline;});
  // The out-of-target edit is restored, the targeted fix is kept, and the recheck passes: no paid outline is lost.
  const kept=await generateQualityOutline(input,{engine:bad},services(bad));
  assert.equal(bad.calls.length,2);assert.equal(kept.meta.requests,2);assert.equal(kept.usage.input,200);
  assert.equal(kept.data.beats[2].newElement,'고친 젖은 잎');assert.notEqual(kept.data.beats[0].summary,'아예 다른 시작');
  assert.deepEqual(kept.meta.quality.untargetedFixRestored.restored,['beat:1']);assert.match(kept.meta.quality.untargetedFixRestored.reason,/1번 비트는 검사에서 지적하지 않았으므로/);
  assert.equal(kept.meta.quality.catchphraseFixFallback,undefined);assert.equal(kept.meta.quality.check.ok,true);
  // A resume (the parent's 다시 시도) replays both paid calls and reaches the same outline with no new call.
  const resumed=await generateQualityOutline(input,{engine:bad,qualityCheckpoint:kept.meta.qualityCheckpoint},services(bad));
  assert.equal(bad.calls.length,2);assert.equal(resumed.meta.requests,0);assert.deepEqual(resumed.data,kept.data);
  // An untargeted setting change is put back too.
  const place=fakeOutlineEngine(input,(outline,request)=>{if(request.user.startsWith('아래 줄거리 JSON에서')){outline.beats[2].newElement='고친 젖은 잎';const row=outline.settings.find(r=>r.beatIndex===1);if(row)row.backgroundId='changed-place';}else outline.beats[2].newElement='';return outline;});
  const placed=await generateQualityOutline(input,{engine:place},services(place));
  assert.notEqual(placed.data.settings.find(r=>r.beatIndex===1)?.backgroundId,'changed-place');
  assert.deepEqual(placed.meta.quality.untargetedFixRestored.restored,['setting:1']);
  // A response that changes the beat count still throws, with paid usage retained.
  const broken=fakeOutlineEngine(input,(outline,request)=>{if(request.user.startsWith('아래 줄거리 JSON에서'))outline.beats.pop();else outline.beats[2].newElement='';return outline;});
  await assert.rejects(generateQualityOutline(input,{engine:broken},services(broken)),error=>error.usage.input===200&&error.meta.requests===2&&/비트 개수/.test(error.message)&&Object.keys(error.qualityCheckpoint.completed).length===2);
});

test('missing topic causes exactly one auxiliary-pattern regeneration, then stops with both calls accounted',async()=>{
  const input={...fixture(),topic:'우산과 빗방울'},engine=fakeOutlineEngine(input,outline=>{outline.beats.forEach((beat,index)=>{beat.summary=`유하와 그린이가 ${index+1}번째 곳에서 주제와 무관한 놀이를 해요. 두 친구가 조용히 손을 흔들어요.`;});return outline;});
  await assert.rejects(generateQualityOutline(input,{engine},services(engine)),error=>error.meta.requests===2&&error.usage.input===200&&/주제 키워드/.test(error.message));assert.equal(engine.calls.length,2);assert.notEqual(engine.calls[0].jsonSchema.properties.plan.properties.pattern.enum[0],engine.calls[1].jsonSchema.properties.plan.properties.pattern.enum[0]);
});

test('two-pass per-language prose strips labels into metadata and resumes completed paid passes',async()=>{
  const input=fixture(),outlineEngine=fakeOutlineEngine(input),outline=(await generateQualityOutline(input,{engine:outlineEngine},services(outlineEngine))).data,controller=new AbortController();let checkpoint,calls=0;
  const engine={id:'openai',async complete(request){calls++;assert.equal(request.jsonSchema,undefined);assert.match(request.system,/EVERY sentence/);assert.match(request.system,/THREE quoted dialogue/);const lang=/return English plain/u.test(request.system)?'en':'ko';return {text:labeled(outline,lang),usage:{input:10,output:20},meta:{requests:1,model:'test-prose'}};}};
  await assert.rejects(generateQualityProse(outline,input,{engine,signal:controller.signal,onCheckpoint:value=>{checkpoint=value.qualityCheckpoint;controller.abort();}},services(engine)),error=>error.name==='AbortError'&&error.usage.input===10&&error.meta.requests===1);
  assert.equal(calls,1);const result=await generateQualityProse(outline,input,{engine,qualityCheckpoint:checkpoint},services(engine));assert.equal(calls,4);assert.equal(result.meta.requests,3);assert.equal(result.meta.resumedCalls,1);assert.equal(result.usage.input,30);assert.deepEqual(result.data.paragraphBeats.ko,[1,2,3,4,5,6,7]);assert.deepEqual(result.data.paragraphBeats.en,[1,2,3,4,5,6,7]);assert.doesNotMatch(result.data.ko,/\[비트/);assert.doesNotMatch(result.data.en,/\[Beat/);
});

test('single-pass option uses target levels and performs only one write per language',async()=>{
  const input=fixture();input.storyQuality.twoPass=false;const outlineEngine=fakeOutlineEngine(input),outline=(await generateQualityOutline(input,{engine:outlineEngine},services(outlineEngine))).data,calls=[];
  const engine={id:'openai',async complete(request){calls.push(request);const lang=/return English plain/u.test(request.system)?'en':'ko';assert.match(request.system,/only writing pass/);assert.match(request.user,new RegExp(input.specs[lang].label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));return {text:labeled(outline,lang),usage:{input:4,output:5}};}};
  const result=await generateQualityProse(outline,input,{engine},services(engine));assert.equal(calls.length,2);assert.equal(result.meta.requests,2);assert.equal(result.meta.quality.twoPass,false);assert.equal(result.usage.input,8);
});

test('real beam package uses candidate and judge schemas, then preserves app fields in its final wrap',async()=>{
  const input=fixture();input.storyQuality.useBeamSearch=true;const calls=[];let seed={reasons:[]};
  const engine={id:'openai',async complete(request){calls.push(request);let json;
    if(request.jsonSchema.properties.candidates){seed=seedFrom(request,seed);const [,index,type]=request.user.match(/\[이번에 쓸 비트\] (\d+) · (\w+)/u),reason=JSON.parse(request.user.match(/"failureReason": (null|"[^"]+")/u)[1]);if(reason)seed.reasons.push(reason);json={candidates:['A','B','C'].map(letter=>({summary:`유하가 ${index}번째 길에서 ${input.topic}을 살펴요. 그린이가 ${seed.planted}을 잡고 ${seed.creature}의 소리를 들어요.`,newElement:`${index}번째 바람 ${letter}`,failureReason:reason}))};}
    else if(request.jsonSchema.properties.best)json={best:'A',scores:{A:9,B:5,C:3},why:'앞선 결과를 이어요'};
    else {json=makeOutline(input,request,seed);const chosen=JSON.parse(request.user.match(/APPROVED_BEAM_BEATS_JSON: (.+)/u)[1]);json.beats=chosen.map((beat,i)=>({...beat,characters:['yuha','green'],settingKey:json.beats[i].settingKey}));json.plotContract=demoPlotContract(json,input);}
    return {json,text:JSON.stringify(json),usage:{input:3,output:2},meta:{requests:1,model:'beam-model'}};
  }};
  const result=await generateQualityOutline(input,{engine},services(engine));assert.equal(calls.length,15);assert.equal(result.meta.requests,15);assert.equal(result.usage.input,45);assert.ok(result.data.plotContract);assert.equal(result.data.settings.length,7);assert.equal(result.data.beats[0].characters[0],'yuha');assert.equal(result.meta.quality.check.ok,true);assert.equal(calls.filter(request=>request.jsonSchema.properties.candidates).length,7);assert.equal(calls.filter(request=>request.jsonSchema.properties.best).length,7);assert.ok(calls.filter(request=>request.jsonSchema.properties.best).every(request=>request.maxTokens>=1500));
});

test('emotion tell repair is bounded to one extra Korean pass and every call is billed once',async()=>{
  const input=fixture(),outlineEngine=fakeOutlineEngine(input),outline=(await generateQualityOutline(input,{engine:outlineEngine},services(outlineEngine))).data;let ko=0;const calls=[];
  const engine={id:'openai',async complete(request){calls.push(request);const lang=/return English plain/u.test(request.system)?'en':'ko';if(lang==='ko')ko++;return {text:labeled(outline,lang,lang==='ko'&&ko===2),usage:{input:10,output:5}};}};
  const result=await generateQualityProse(outline,input,{engine},services(engine));assert.equal(calls.length,5);assert.equal(result.meta.requests,5);assert.equal(result.usage.input,50);assert.equal(result.meta.quality.languages.ko.tellHitsAfter,0);assert.doesNotMatch(result.data.ko,/행복했어요/);
});

test('missing prose labels fail with a resumable paid checkpoint instead of inventing beat metadata',async()=>{
  const input=fixture(),outlineEngine=fakeOutlineEngine(input),outline=(await generateQualityOutline(input,{engine:outlineEngine},services(outlineEngine))).data;let calls=0;
  const engine={id:'openai',async complete(){calls++;return {text:'유하가 작은 잎을 만져요.',usage:{input:2,output:3}};}};
  await assert.rejects(generateQualityProse(outline,input,{engine},services(engine)),error=>/비트 라벨/.test(error.message)&&error.meta.requests===2&&error.usage.input===4&&Object.keys(error.qualityCheckpoint.completed).length===2);assert.equal(calls,2);
});

test('quality role choices override a supplied main engine without leaking credential options',async()=>{
  const input=fixture(),base=fakeOutlineEngine(input),outline=(await generateQualityOutline(input,{engine:base},services(base))).data;const chosen=[];
  const extra={...services(base),async engineFor(options){chosen.push(options.engineId);assert.equal(options.engine,undefined);return {id:options.engineId,async complete(request){assert.doesNotMatch(request.system+request.user,/private-role-key/);return {text:labeled(outline,/return English plain/u.test(request.system)?'en':'ko'),usage:{input:1,output:1}};}};}};
  const result=await generateQualityProse(outline,input,{engine:base,qualityEngines:{prose:{engineId:'google',config:{apiKey:'private-role-key'}},cheap:{engineId:'local',config:{model:'small'}}}},extra);assert.deepEqual(chosen,['google','local']);assert.equal(result.meta.requests,4);assert.deepEqual(result.meta.models.map(model=>model.engineId),['google','local','google','local']);
});

test('approved-book ban retrieval keeps recently used inventory out of the next book',async()=>{
  const input=fixture(),firstEngine=fakeOutlineEngine(input),first=await generateQualityOutline(input,{engine:firstEngine},services(firstEngine));
  input.bookId='quality-next-book';input.storyQuality.patternId='auto';input.storyQuality.approvedBooks=[{bookId:'previous-book',topic:input.topic,patternId:first.meta.quality.patternId,levelKo:'K1',levelEn:'E0',outline:first.data,approved:true,createdAt:'2026-10-16T00:00:00Z',usedElements:{planted:first.meta.quality.seed.planted.ko,creatures:[first.meta.quality.seed.creature.ko],twistTypeId:first.meta.quality.seed.twist.id,patternId:first.meta.quality.patternId,places:first.meta.quality.seed.subLocations.map(place=>place.ko)}}];
  const nextEngine=fakeOutlineEngine(input),next=await generateQualityOutline(input,{engine:nextEngine},services(nextEngine));assert.notEqual(next.meta.quality.seed.planted.ko,first.meta.quality.seed.planted.ko);assert.notEqual(next.meta.quality.seed.creature.ko,first.meta.quality.seed.creature.ko);assert.notEqual(next.meta.quality.seed.twist.id,first.meta.quality.seed.twist.id);assert.notEqual(next.meta.quality.patternId,first.meta.quality.patternId);assert.match(nextEngine.calls[0].user,/최근 책에서 썼으므로 금지/);
});

test('configured material and pattern ban windows govern actual package seeds and auto selection',async()=>{
  const input=fixture(),baselineEngine=fakeOutlineEngine(input),baseline=await generateQualityOutline(input,{engine:baselineEngine},services(baselineEngine)),cards=clone(data.plotPatterns.slice(0,3));cards[0].bestFor=[input.topic];cards[1].bestFor=[];cards[2].bestFor=[];
  const records=[0,1].map(index=>({bookId:`recent-${index}`,topic:input.topic,patternId:cards[index===0?1:0].id,levelKo:'K1',levelEn:'E0',outline:clone(baseline.data),approved:true,createdAt:`2026-10-${16-index}T00:00:00Z`,usedElements:{planted:data.inventories.plantedObjects[index].ko,creatures:[],twistTypeId:data.inventories.twistTypes[index].id,patternId:cards[index===0?1:0].id,places:[]}}));
  input.storyQuality={...input.storyQuality,patternId:'auto',patterns:cards,approvedBooks:records,banWindow:1,patternBanWindow:1};
  const firstEngine=fakeOutlineEngine(input),first=await generateQualityOutline(input,{engine:firstEngine},services(firstEngine)),banLine=firstEngine.calls[0].user.match(/최근 책에서 썼으므로 금지: ([^\n]*)/u)[1];assert.equal(first.meta.quality.patternId,cards[0].id);assert.ok(banLine.includes(records[0].usedElements.planted));assert.ok(!banLine.includes(records[1].usedElements.planted));
  input.storyQuality.banWindow=2;input.storyQuality.patternBanWindow=2;
  const secondEngine=fakeOutlineEngine(input),second=await generateQualityOutline(input,{engine:secondEngine},services(secondEngine)),nextBan=secondEngine.calls[0].user.match(/최근 책에서 썼으므로 금지: ([^\n]*)/u)[1];assert.equal(second.meta.quality.patternId,cards[2].id);assert.ok(nextBan.includes(records[1].usedElements.planted));
});

test('oversized package prompts drop approved examples before adding any paid request',async()=>{
  const input=fixture(),baselineEngine=fakeOutlineEngine(input),baseline=await generateQualityOutline(input,{engine:baselineEngine},services(baselineEngine));
  input.storyQuality.rules=Array.from({length:7},()=> '원인과 결과를 연결하고 새로운 사건을 구성한다. '.repeat(35));
  input.storyQuality.approvedBooks=[{bookId:'approved-example',topic:input.topic,patternId:baseline.meta.quality.patternId,levelKo:'K1',levelEn:'E0',outline:baseline.data,approved:true,createdAt:'2026-10-15T00:00:00Z',usedElements:{planted:baseline.meta.quality.seed.planted.ko,creatures:[],patternId:baseline.meta.quality.patternId,places:[]}}];
  const engine=fakeOutlineEngine(input),result=await generateQualityOutline(input,{engine},services(engine));assert.equal(result.meta.requests,1);assert.doesNotMatch(engine.calls[0].user,/\[참고 예시/);
});

test('failed engine attempts retain their exact request count without inventing billed token usage',async()=>{
  const input=fixture(),engine={id:'openai',async complete(){throw new Error('test network outage');}};
  await assert.rejects(generateQualityOutline(input,{engine},services(engine)),error=>error.meta.requests===1&&error.usage.input===0&&error.usage.output===0&&Object.keys(error.qualityCheckpoint.completed).length===0);
});

test('rich drafting binds the upper rich level and only simplify/fix bind the final frozen target',async()=>{
  const input=fixture(),outlineEngine=fakeOutlineEngine(input),outline=(await generateQualityOutline(input,{engine:outlineEngine},services(outlineEngine))).data,calls=[];
  const engine={id:'openai',async complete(request){calls.push(request);return {text:labeled(outline,/return English plain/u.test(request.system)?'en':'ko'),usage:{input:1,output:1}};}};
  await generateQualityProse(outline,input,{engine},services(engine));
  assert.equal(calls.length,4);
  for(const index of [0,2]){assert.doesNotMatch(calls[index].system,/FROZEN_LEVEL_SPECS/);assert.match(calls[index].system,/RICH DRAFT LEVEL/);assert.match(calls[index].user,/FINAL_TARGET_LEVEL_FOR_LATER_SIMPLIFY_ONLY/);}
  assert.match(calls[0].user,/문장당 5~7어절/);assert.match(calls[2].user,/5~9 words per sentence/);
  for(const index of [1,3]){assert.match(calls[index].system,/FROZEN_LEVEL_SPECS/);assert.match(calls[index].user,/TARGET_LEVEL_SPEC_JSON/);assert.doesNotMatch(calls[index].user,/FINAL_TARGET_LEVEL_FOR_LATER_SIMPLIFY_ONLY/);}
});

test('exhausting all planted inventory fails before a model request and preserves the chosen ban window',async()=>{
  assert.equal(data.inventories.plantedObjects.length,323,'the shipped base pool is expanded, independent of the smaller exhaustion fixture');
  // The parent can retain at most 50 recent books. A finite, explicitly scoped
  // inventory exercises exhaustion without pretending all 323 items fit there.
  const scopedData={...data,inventories:{...data.inventories,plantedObjects:data.inventories.plantedObjects.slice(0,50)}},input=fixture();input.storyQuality.banWindow=50;input.storyQuality.approvedBooks=scopedData.inventories.plantedObjects.map((item,index)=>({bookId:`used-item-${index}`,approved:true,createdAt:new Date(Date.UTC(2026,0,index+1)).toISOString(),usedElements:{planted:item.ko,creatures:[],places:[],patternId:'journey_repeat'}}));
  let calls=0;const engine={id:'openai',async complete(){calls++;throw new Error('must not call');}};
  await assert.rejects(generateQualityOutline(input,{engine},{...services(engine),qualityData:scopedData}),error=>error.meta.requests===0&&error.usage.input===0&&error.usage.output===0&&/반복 제한 범위를 줄여/.test(error.message)&&/심을 물건/.test(error.message));assert.equal(calls,0);assert.equal(input.storyQuality.banWindow,50);
});

test('exhausting all background creatures also fails before a model request',async()=>{
  const input=fixture();input.storyQuality.approvedBooks=[{bookId:'all-creatures',approved:true,createdAt:'2026-10-16T00:00:00Z',usedElements:{planted:'다른 물건',creatures:data.inventories.creatures.map(item=>item.ko),places:[],patternId:'journey_repeat'}}];
  let calls=0;const engine={id:'openai',async complete(){calls++;throw new Error('must not call');}};
  await assert.rejects(generateQualityOutline(input,{engine},services(engine)),error=>error.meta.requests===0&&/배경 생물/.test(error.message));assert.equal(calls,0);
});

test('R8-1 legacy prose forwards pageCount and leaves condensation disabled',async()=>{
 const input=fixture(),engine=fakeOutlineEngine(input),outline=(await generateQualityOutline(input,{engine},services(engine))).data,captured=[];
 const service={...services(engine),qualityModule:async()=>({runProseStage:async args=>{captured.push(args);assert.equal(args.pageCount,12);assert.equal(args.condenseOverBudget,false);return {simplified:labeled(outline,args.lang),rich:labeled(outline,args.lang),tellHitsAfter:0,calls:0,costUsd:0};}})};
 const result=await generateQualityProse(outline,input,{},service);assert.equal(captured.length,2);assert.ok(result.data.ko);assert.ok(result.data.en);
 assert.match(captured.find(args=>args.lang==='en').vocabLabel,/all/);
 assert.ok(captured.find(args=>args.lang==='en').vocabLabel.length>300);
 assert.match(captured.find(args=>args.lang==='en').vocabLabel,/Story words:.*rain/);
});
test('R6-4 reference candidates default to gold, exclude the active topic when opted in and retain gold priority',async()=>{
 const {qualityReferenceBooks}=await import('../dist/story-generation/quality-adapter.js');
 const input=fixture(),distilled=[{...clone(data.goldBooks[0]),bookId:'distilled-same',topic:input.topic},{...clone(data.goldBooks[0]),bookId:'distilled-new',topic:'새로운 다른 모험'}],extra={...data,distilledBooks:distilled};
 assert.deepEqual(qualityReferenceBooks(extra,input.topic,false),data.goldBooks);
 const enabled=qualityReferenceBooks(extra,input.topic,true);assert.ok(!enabled.some(b=>b.bookId==='distilled-same'));assert.equal(enabled.at(-1).bookId,'distilled-new');assert.equal(enabled[0].referenceSource,'gold');
 input.storyQuality.useDistilledExamples=true;const engine=fakeOutlineEngine(input);let references;
 await generateQualityOutline(input,{engine},{...services(engine),qualityData:extra,qualityModule:async()=>({...qualityModule,runOutlineStage:args=>{references=args.referenceBooks;return qualityModule.runOutlineStage(args);}})});
 assert.deepEqual(references,enabled);
});
test('R6-4 distilled examples load only on opt-in and a failed file falls back to gold',async()=>{
 let calls=0;const optional=async url=>{calls++;assert.match(url.pathname,/examples\/approved-books.json$/);return {ok:true,json:async()=>[clone(data.goldBooks[0])]};};
 const base=await loadStoryQualityData(optional);assert.equal(calls,0);assert.equal(base.distilledBooks,undefined);
 const loaded=await loadStoryQualityData(optional,{includeDistilled:true});assert.equal(calls,1);assert.equal(loaded.distilledBooks.length,1);await loadStoryQualityData(optional,{includeDistilled:true});assert.equal(calls,1);
 const fallback=await loadStoryQualityData(async()=>({ok:false}),{includeDistilled:true});assert.deepEqual(fallback.goldBooks,base.goldBooks);assert.deepEqual(fallback.distilledBooks,[]);
});

test('R8-1 frozen language policy is forwarded independently and survives checkpoint resume',async()=>{
 for(const [ko,en] of [['K1','E0'],['K1','E2'],['K2','E0'],['K2','E2']]) {
  const input=fixture();input.specs={ko:getLevelSpec(ko),en:getLevelSpec(en)};
  input.prosePolicy={version:1,condenseOverBudget:{ko:ko==='K1',en:en==='E0'}};
  const engine=fakeOutlineEngine(input),outline=(await generateQualityOutline(input,{engine},services(engine))).data,captured=[];
  const service={...services(engine),qualityModule:async()=>({runProseStage:async args=>{captured.push(args);return {simplified:labeled(outline,args.lang),tellHitsAfter:0,calls:0};}})};
  await generateQualityProse(outline,input,{},service);
  assert.deepEqual(captured.map(args=>args.condenseOverBudget),[ko==='K1',en==='E0']);
  const saved=JSON.parse(JSON.stringify(input));assert.deepEqual(saved.prosePolicy,input.prosePolicy);
  const paid={id:'openai',calls:0,async complete(request){this.calls++;return {text:labeled(outline,/return English plain/u.test(request.system)?'en':'ko'),usage:{input:1,output:1}};}};
  const result=await generateQualityProse(outline,saved,{engine:paid},services(paid)),calls=paid.calls;
  await generateQualityProse(outline,saved,{engine:paid,qualityCheckpoint:result.meta.qualityCheckpoint},services(paid));assert.equal(paid.calls,calls);
 }
});
const policy=(phrases={yuha:'같이 가자!'},omit=[])=>({version:1,limit:1,omit,phrases,recentBookIds:[]});
const isFix=request=>request.user.startsWith('아래 줄거리 JSON에서');
const sayTogether=' 유하가 "같이 가자!" 해요.';
test('R9 fix: a catchphrase-only repeat buys no fix pass; the paid outline is accepted with the item kept as an advisory, also on resume',async()=>{
 const input=fixture();input.characters[0].catchphrase='같이 가자!';input.catchphrasePolicy=policy();
 const inject=(json,request)=>{if(!isFix(request))for(const i of [1,3])json.beats[i].summary+=sayTogether;return json;};
 const engine=fakeOutlineEngine(input,inject),result=await generateQualityOutline(input,{engine},services(engine));
 assert.equal(engine.calls.length,1,'no paid fix pass for an advisory alone');assert.equal(result.meta.requests,1);
 assert.match(engine.calls[0].user,/^\[등장인물\] 유하: 관찰하는 아이, 말버릇 "같이 가자!"\(책 전체에서 최대 1번, 꼭 쓰지 않아도 된다\. 후렴으로 쓰지 않는다\)$/m);
 assert.match(engine.calls[0].system,/CATCHPHRASES: Use each character's catchphrase at most once in the whole book, or not at all\./);
 const advisory=result.meta.quality.check.fix.find(message=>message.startsWith('말버릇'));
 assert.match(advisory,/^말버릇 "같이 가자!" 2회\(책 전체 최대 1회\): 비트 2·비트 4 — /);
 assert.deepEqual(result.meta.quality.catchphraseAdvisories,[advisory]);assert.equal(result.meta.quality.catchphraseFixFallback,undefined);
 assert.equal(result.data.beats.length,frozenBeatCount(input));assert.ok(result.data.beats[1].summary.endsWith(sayTogether));
 const resumed=await generateQualityOutline(input,{engine,qualityCheckpoint:result.meta.qualityCheckpoint},services(engine));
 assert.equal(engine.calls.length,1);assert.equal(resumed.meta.requests,0);assert.deepEqual(resumed.data,result.data);
 // A clean outline is not touched by the new check.
 const clean=fixture();clean.characters[0].catchphrase='같이 가자!';clean.catchphrasePolicy=policy();const plain=fakeOutlineEngine(clean),ok=await generateQualityOutline(clean,{engine:plain},services(plain));
 assert.equal(plain.calls.filter(isFix).length,0);assert.equal(ok.meta.quality.catchphraseAdvisories,undefined);
});
test('R9 fix: if a catchphrase-only fix pass still happens and breaks the targeted-fix rule, the original paid outline is kept and a resume makes 0 calls',async()=>{
 // A package that still sends the catchphrase-only pass (the R9-A behaviour) must not cost the outline.
 const input=fixture();input.characters[0].catchphrase='같이 가자!';input.catchphrasePolicy=policy();
 const inject=(json,request)=>{if(isFix(request)){json.beats[1].summary=json.beats[1].summary.replace(sayTogether,'');json.beats[0].summary+=' 덧붙인 문장.';}else for(const i of [1,3])json.beats[i].summary+=sayTogether;return json;};
 const always={...qualityModule,runOutlineStage:args=>qualityModule.runOutlineStage({...args,advisoryCatchphrases:false})};
 const engine=fakeOutlineEngine(input,inject),svc={...services(engine),qualityModule:async()=>always};
 const result=await generateQualityOutline(input,{engine},svc);
 assert.equal(engine.calls.length,2);assert.equal(engine.calls.filter(isFix).length,1);assert.equal(result.meta.requests,2);
 assert.ok(!result.data.beats[0].summary.includes('덧붙인'));assert.ok(result.data.beats[1].summary.endsWith(sayTogether));
 assert.equal(result.meta.quality.catchphraseFixFallback.mode,'original');assert.match(result.meta.quality.catchphraseFixFallback.reason,/1번 비트는 검사에서 지적하지 않았으므로/);
 assert.ok(result.meta.quality.catchphraseAdvisories.length>=1);
 const resumed=await generateQualityOutline(input,{engine,qualityCheckpoint:result.meta.qualityCheckpoint},svc);
 assert.equal(engine.calls.length,2,'resume replays both cached calls');assert.equal(resumed.meta.requests,0);assert.equal(resumed.meta.resumedCalls,2);assert.deepEqual(resumed.data,result.data);
});
test('R9 fix: in a mixed fix pass an out-of-target catchphrase edit is put back from the original and the targeted fixes are kept',async()=>{
 const input=fixture();input.characters[0].catchphrase='같이 가자!';input.catchphrasePolicy=policy();
 const fixer=extra=>(json,request)=>{
  if(isFix(request)){json.beats[2].newElement='고친 젖은 잎';for(const i of [1,3])json.beats[i].summary=json.beats[i].summary.replace(sayTogether,'');json.beats[0].summary+=extra;}
  else{json.beats[2].newElement='';for(const i of [1,3])json.beats[i].summary+=sayTogether;}
  return json;};
 const engine=fakeOutlineEngine(input,fixer(sayTogether)),result=await generateQualityOutline(input,{engine},services(engine));
 const fix=engine.calls.find(isFix);assert.match(fix.user,/^- 말버릇 "같이 가자!" 2회/m);assert.match(fix.user,/newElement/);
 assert.equal(engine.calls.length,2);assert.equal(result.data.beats[2].newElement,'고친 젖은 잎');
 assert.ok(!result.data.beats[0].summary.includes('같이 가자'),'the untargeted catchphrase edit is restored from the original');
 assert.ok(!result.data.beats[1].summary.includes('같이 가자')&&!result.data.beats[3].summary.includes('같이 가자'));
 assert.deepEqual({mode:result.meta.quality.catchphraseFixFallback.mode,restored:result.meta.quality.catchphraseFixFallback.restored},{mode:'restored',restored:['beat:1']});
 assert.equal(result.meta.quality.check.ok,true);
 const resumed=await generateQualityOutline(input,{engine,qualityCheckpoint:result.meta.qualityCheckpoint},services(engine));
 assert.equal(engine.calls.length,2);assert.equal(resumed.meta.requests,0);assert.deepEqual(resumed.data,result.data);
 // An unrelated (non-catchphrase) edit outside the targets is put back as well, recorded separately.
 const bad=fakeOutlineEngine(input,fixer(' 아예 다른 사건이 생겨요.')),other=await generateQualityOutline(input,{engine:bad},services(bad));
 assert.equal(other.meta.requests,2);assert.ok(!other.data.beats[0].summary.includes('아예 다른 사건'));assert.equal(other.data.beats[2].newElement,'고친 젖은 잎');
 assert.deepEqual(other.meta.quality.untargetedFixRestored.restored,['beat:1']);assert.equal(other.meta.quality.catchphraseFixFallback,undefined);
});
test('R9-A frozen rotation hides the omitted phrase from every quality prompt but still checks it',async()=>{
 const {normalizeStoryInput}=await import('../dist/story-generation/pipeline.js');
 const input=fixture();input.characters[0].catchphrase='같이 가자!';input.catchphrasePolicy={version:1,limit:1,omit:['yuha'],phrases:{yuha:'같이 가자!'},recentBookIds:['book-old']};
 const inject=(json,request)=>{if(!isFix(request))for(const i of [1,3])json.beats[i].summary+=sayTogether;return json;};
 const own=(bookId,phrase)=>{const book={...clone(data.goldBooks[1]),bookId,approved:true,topic:'비 오는 날 산책'};book.outline.beats[0].summary=`유하가 "${phrase}" 하고 웃어요. ${book.outline.beats[0].summary}`;return book;};
 input.storyQuality.approvedBooks=[own('own-omitted','같이 가자!'),own('own-other','사뿐사뿐!')];
 let excluded;const capture={...qualityModule,runOutlineStage:args=>{excluded=args.excludeBookIds;return qualityModule.runOutlineStage(args);}};
 const engine=fakeOutlineEngine(input,inject),result=await generateQualityOutline(input,{engine},{...services(engine),normalizeStoryInput,qualityModule:async()=>capture});
 // A past book that used the omitted phrase is never offered as an example.
 assert.ok(excluded.includes('own-omitted'));assert.ok(!excluded.includes('own-other'));
 const first=engine.calls[0];
 assert.match(first.user,/^\[등장인물\] 유하: 관찰하는 아이, 이번 책에서는 말버릇을 쓰지 않는다$/m);
 assert.match(first.system,/CATCHPHRASE ROTATION: 유하 \(yuha\) used a catchphrase in a recent book, so they use no catchphrase in this book\./);
 assert.doesNotMatch(first.system+first.user,/같이 가자/);
 // Still checked (the omitted phrase is in the frozen policy), but as an advisory without a paid fix pass.
 assert.equal(engine.calls.length,1);
 assert.ok(result.meta.quality.catchphraseAdvisories.some(message=>/^말버릇 "같이 가자!" 2회/.test(message)));
});
test('R9 fix: a draft frozen without a catchphrase policy keeps every pre-R9 outline/prose input (no new text, checks or example filters)',async()=>{
 const input=fixture();input.characters[0].catchphrase='같이 가자!';input.storyQuality.useDistilledExamples=true;
 const repeated={...clone(data.goldBooks[0]),bookId:'distilled-repeat',topic:'다른 주제'};repeated.outline.beats.slice(0,3).forEach(beat=>{beat.summary+=sayTogether;});
 const own={...clone(data.goldBooks[1]),bookId:'own-repeat',approved:true,topic:'비 오는 날 산책'};own.outline.beats.slice(0,2).forEach(beat=>{beat.summary+=sayTogether;});
 input.storyQuality.approvedBooks=[own];
 let args;const capture={...qualityModule,runOutlineStage:value=>{args=value;return qualityModule.runOutlineStage(value);}};
 const inject=(json,request)=>{if(!isFix(request))for(const i of [1,3])json.beats[i].summary+=sayTogether;return json;};
 const engine=fakeOutlineEngine(input,inject),result=await generateQualityOutline(input,{engine},{...services(engine),qualityData:{...data,distilledBooks:[repeated]},qualityModule:async()=>capture});
 assert.equal(args.legacyCatchphrasePrompt,true);assert.deepEqual(args.catchphrases,[]);
 assert.deepEqual(args.excludeBookIds,['quality-book-test']);
 assert.ok(args.referenceBooks.some(book=>book.bookId==='distilled-repeat'),'pre-R9 candidate list');
 assert.match(engine.calls[0].user,/^\[등장인물\] 유하: 관찰하는 아이, 말버릇 "같이 가자!"$/m);
 assert.doesNotMatch(engine.calls[0].system,/CATCHPHRASE/);assert.doesNotMatch(engine.calls[0].user,/최대 1번/);
 assert.equal(result.meta.quality.catchphraseAdvisories,undefined);assert.ok(!result.meta.quality.check.fix.some(message=>message.startsWith('말버릇')));
 const outline={...result.data,quality:result.meta.quality},prose={id:'openai',calls:[],async complete(request){this.calls.push(request);return {text:labeled(outline,/return English plain/u.test(request.system)?'en':'ko'),usage:{input:1,output:1}};}};
 await generateQualityProse(outline,input,{engine:prose},services(prose));
 for(const request of prose.calls)assert.doesNotMatch(request.system+request.user,/CATCHPHRASE|말버릇은 책 전체에서|catchphrase at most once/);
 // The same draft with a policy gets the R9 prose rule.
 const r9={...clone(input),catchphrasePolicy:policy()},prose9={id:'openai',calls:[],async complete(request){this.calls.push(request);return {text:labeled(outline,/return English plain/u.test(request.system)?'en':'ko'),usage:{input:1,output:1}};}};
 await generateQualityProse(outline,r9,{engine:prose9},services(prose9));
 assert.ok(prose9.calls.some(request=>request.user.includes('9 말버릇은 책 전체에서 최대 1번만 쓰고')));
 assert.ok(prose9.calls.some(request=>request.user.includes("9 Use each character's catchphrase at most once")));
});
test('R9-A distilled examples that repeat "같이 가자" or a cast catchphrase are skipped; gold and the source file stay as they are',async()=>{
 const {qualityReferenceBooks,repeatsCatchphrase}=await import('../dist/story-generation/quality-adapter.js');
 const withPhrase=(bookId,count,phrase='같이 가자!')=>{const book={...clone(data.goldBooks[0]),bookId,topic:`다른 주제 ${bookId}`};book.outline.beats.slice(0,count).forEach(beat=>{beat.summary+=` 유하가 "${phrase}" 해요.`;});return book;};
 const three=withPhrase('d-three',3),before=clone(three);
 const extra={...data,distilledBooks:[three,withPhrase('d-one',1),withPhrase('d-cast',2,'쿵쿵, 냠냠!'),withPhrase('d-variant',2,'같이 가!')]};
 const ids=qualityReferenceBooks(extra,'비 오는 날',true).map(book=>book.bookId);
 assert.ok(!ids.includes('d-three'));assert.ok(!ids.includes('d-variant'));assert.ok(ids.includes('d-one'));assert.ok(ids.includes('d-cast'));
 assert.ok(!qualityReferenceBooks(extra,'비 오는 날',true,['쿵쿵, 냠냠!']).some(book=>book.bookId==='d-cast'));
 assert.deepEqual(three,before);
 const refrain=withPhrase('d-refrain',1);refrain.outline.refrain={text:'하나, 둘, 셋, 같이 가자!',usedAtBeats:[2,4]};assert.equal(repeatsCatchphrase(refrain),true);
 assert.deepEqual(qualityReferenceBooks({...data,goldBooks:[withPhrase('g-three',3)],distilledBooks:[]},'x',true).map(book=>book.bookId),['g-three']);
 assert.deepEqual(qualityReferenceBooks(extra,'비 오는 날',false),data.goldBooks);
 const shipped=JSON.parse(await readFile(new URL('../dist/story-quality/examples/approved-books.json',import.meta.url),'utf8'));
 assert.equal(shipped.length,161);assert.equal(shipped.filter(book=>repeatsCatchphrase(book)).length,98);
});
