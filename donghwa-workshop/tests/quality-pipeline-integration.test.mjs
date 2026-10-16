import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {getLevelSpec} from '../dist/reading-levels.js';
import {generateOutline,generateSceneBriefs,generateProse,paginateStory,toLegacyPages} from '../dist/story-generation/pipeline.js';
import {BEAT_COUNTS} from '../dist/story-generation/schemas.js';
import {demoPlotContract} from '../dist/story-generation/plot-contract.js';
import {demoSceneBriefs} from '../dist/story-generation/scene-briefs.js';
import {demoPagination} from '../dist/story-generation/demo.js';
import {isCoherenceCurrent} from '../dist/story-generation/coherence.js';
import {validateImport} from '../dist/output.js';

test('actual app pipeline connects strict quality outline, briefs, two-pass prose, child checks and semantic gates',async()=>{
  const input={bookId:'quality-root-integration',storyDate:'2026-10-17T02:00:00.000Z',topic:'바람 찾기',characters:[{id:'yuha',name:'유하',nameEn:'Yuha'},{id:'green',name:'그린이',nameEn:'Green'}],backgrounds:[{id:'home',type:'home',name:'유하의 집'},{id:'garden',name:'꽃 정원'},{id:'pond',name:'연못 길'}],pageCount:12,endingType:'home_sleep',specs:{ko:getLevelSpec('K1'),en:getLevelSpec('E0')},storyQuality:{enabled:true,useBeamSearch:false,twoPass:true,childSimulator:true,patternId:'journey_repeat',worldId:'kyoto_lane',season:'auto',timeOfDay:'night',approvedBooks:[]}};
  const originalFetch=globalThis.fetch,calls=[],checkpoints=[],counts={outline:0,briefs:0,prose:0,pagination:0,semantic:0,child:0};let outline,prose;
  globalThis.fetch=async url=>{assert.match(String(url),/\/story-quality\/(?:data\/(?:inventories|gesture_dictionary|plot_patterns|worlds)|gold\/gold_outlines_part[12])\.json$/u);return new Response(await readFile(url,'utf8'),{headers:{'Content-Type':'application/json'}});};
  const engine={id:'openai',async complete(request){
    calls.push(request);const schema=request.jsonSchema;let json;
    if(schema?.properties?.plan){
      counts.outline++;const planted=request.user.match(/- 심을 물건: (.*?) —/u)?.[1],creature=request.user.match(/- 배경 생물: (.*?) \(/u)?.[1],reasons=[...request.user.matchAll(/\d차 (잘못된 장소|잘못된 방법|거의 됐는데 방해)/gu)].map(match=>({'잘못된 장소':'wrong_place','잘못된 방법':'wrong_method','거의 됐는데 방해':'interrupted'})[match[1]]);
      assert.ok(planted);assert.ok(creature);const count=BEAT_COUNTS[input.pageCount],types=['setup','want',...Array.from({length:count-5},()=> 'attempt'),'turn','resolution','close'],places=types.map((_,index)=>index===0||index===count-1?'home':index%2?'garden':'pond');let attempt=0;
      json={plan:{pattern:schema.properties.plan.properties.pattern.enum[0],planted,twistReveal:'앞에서 살펴본 물건을 다시 이용해요.',funnyMoment:'바람에 잎이 코에 앉아요.',failureReasons:reasons},titleCandidates:['빗방울의 흔적','바람을 듣는 날','작은 잎의 소리'],logline:'유하와 그린이가 비 오는 날 빗방울의 흔적을 찾아요.',want:'빗방울의 소리를 찾고 싶어요.',problem:'바람 때문에 소리의 위치가 달라져요.',twist:'앞에서 살펴본 물건이 바람을 받아 소리를 냈어요.',beats:types.map((type,index)=>({index:index+1,type,summary:`${index%2?'그린이가':'유하가'} ${['집에서','정원에서','연못에서','돌 옆에서','길에서','집 앞에서','방에서'][index]} ${input.topic}의 흔적을 살펴요. 유하와 그린이가 ${type==='setup'||type==='turn'?planted:'작은 잎'}을 보며 ${type==='turn'?creature:'바람'}의 소리를 들어요.`,characters:['yuha','green'],settingKey:places[index],newElement:`${index+1}번째 젖은 잎`,failureReason:type==='attempt'?reasons[attempt++]:null})),settings:places.map((backgroundId,index)=>({beatIndex:index+1,backgroundId})),emotionArc:types.map(()=> '궁금'),newWordsKo:['빗방울','흔적','바람'],newWordsEn:['rain','leaf','wind'],endingType:'home_sleep'};
      json.plotContract=demoPlotContract(json,input);outline=json;
    }else if(schema?.properties?.briefs){counts.briefs++;json={briefs:demoSceneBriefs(outline,input)};}
    else if(!schema){counts.prose++;const lang=/return English plain/u.test(request.system)?'en':'ko';return {text:outline.beats.map(beat=>`${lang==='ko'?'[비트':'[Beat'} ${beat.index} · ${beat.type}] ${lang==='ko'?`유하가 ${beat.index}번째 작은 잎을 만져요. 그린이가 “나는 바람을 들어요.”라고 말해요.`:`Yuha sees a small leaf near tree ${beat.index}. Green says, “I hear the wind.”`}`).join('\n\n'),usage:{input:10,output:20},meta:{requests:1,modelId:'integration-mock'}};}
    else if(schema.properties.passed){counts.semantic++;json={passed:true,issues:[]};}
    else if(schema.properties.overall){counts.child++;json={pages:Array.from({length:12},(_,index)=>({pageNo:index+1,score:2,childQuestion:index===11?null:'다음에는 어떻게 될까?',why:'앞선 행동과 다음 결과가 이어져요.'})),dropPages:[],overall:8};}
    else if(schema.properties.retell){counts.child++;json={retell:['유하가 소리의 흔적을 찾았어요.','유하가 앞서 본 물건에서 단서를 알았어요.','유하와 그린이가 결과를 확인하고 집으로 돌아왔어요.'],coveredBeats:outline.beats.map(beat=>beat.index),missingCore:[],confusions:[],coherence:2};}
    else if(schema.properties.cover){counts.pagination++;json=demoPagination(outline,prose,input);}
    else throw Error('unhandled integration mock schema');
    return {json,text:JSON.stringify(json),usage:{input:10,output:20},costUsdEstimated:.01,meta:{requests:1,modelId:'integration-mock'}};
  }};
  try{
    const options={engine,onCheckpoint:checkpoint=>checkpoints.push(structuredClone(checkpoint))},a=await generateOutline(input,options);outline=a.data;
    const b=await generateSceneBriefs(outline,input,options),c=await generateProse(outline,input,{...options,sceneBriefs:b.data});prose=c.data;
    const d=await paginateStory(outline,prose,input,{...options,sceneBriefs:b.data,repair:false});
    assert.deepEqual(counts,{outline:1,briefs:1,prose:4,pagination:1,semantic:2,child:2});assert.equal(c.meta.requests,4);assert.equal(a.meta.quality.check.ok,true);assert.equal(a.data.quality.patternId,'journey_repeat');assert.equal(a.data.quality.worldMood.worldId,'kyoto_lane');assert.equal(a.data.quality.worldMood.season,'autumn');assert.equal(a.data.quality.worldMood.timeOfDay,'night');assert.equal(c.meta.quality.twoPass,true);assert.equal(d.meta.childGate.pass,true);assert.equal(d.data.pages.length,12);assert.ok(d.data.pages.every(page=>page.plotContext.scope==='beat'&&page.sceneBrief));assert.ok(isCoherenceCurrent(d.meta.coherence,{outline,prose,pagination:d.data,stage:'pages'}));assert.doesNotMatch(prose.ko+prose.en,/\[(?:비트|Beat)/u);
    assert.ok(checkpoints.some(value=>value.qualityCheckpoint));assert.ok(checkpoints.some(value=>value.childGateCheckpoint));assert.ok(checkpoints.some(value=>value.coherence));
    const book={id:input.bookId,title:d.data.cover.title,characterIds:input.characters.map(character=>character.id),outline,prose,pagination:d.data,pages:toLegacyPages(d.data),storyQuality:a.meta.quality,pageCoherence:d.meta.coherence,childGate:d.meta.childGate};
    const restored=validateImport(JSON.stringify({characters:input.characters,backgrounds:input.backgrounds,books:[book],settings:{storyQuality:input.storyQuality}}));assert.deepEqual(restored.books[0].storyQuality,book.storyQuality);assert.deepEqual(restored.books[0].pageCoherence,book.pageCoherence);assert.equal(restored.books[0].pages.length,12);
    assert.equal(calls.length,11);
  }finally{globalThis.fetch=originalFetch;}
});
