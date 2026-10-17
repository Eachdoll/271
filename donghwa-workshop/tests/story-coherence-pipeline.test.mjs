import test from 'node:test';
import assert from 'node:assert/strict';
import {getLevelSpec} from '../dist/reading-levels.js';
import {demoOutline,demoProse,demoPagination} from '../dist/story-generation/demo.js';
import {demoPlotContract} from '../dist/story-generation/plot-contract.js';
import {isCoherenceCurrent} from '../dist/story-generation/coherence.js';
import {reviewStoryCoherence,paginateStory} from '../dist/story-generation/pipeline.js';
import {StoryValidationError} from '../dist/story-generation/schemas.js';

const clone=value=>structuredClone(value);
const paragraphs=text=>text.split(/\n\s*\n/);
const reviewRequest=request=>!!request.jsonSchema?.properties?.passed;
function fixture(){
  const input={characters:[{id:'yuha',name:'유하',nameEn:'Yuha'},{id:'green',name:'그린이',nameEn:'Green'}],backgrounds:[{id:'home',name:'유하의 집',type:'home'},{id:'forest',name:'숲길'},{id:'garden',name:'작은 정원'}],topic:'바람 피리',pageCount:12,endingType:'home_sleep',specs:{ko:getLevelSpec('K1'),en:getLevelSpec('E0')}};
  const outline=demoOutline(input);outline.plotContract=demoPlotContract(outline,input);
  const authored=demoProse(outline,input),prose={...authored,paragraphBeats:{ko:outline.beats.map(beat=>beat.index),en:outline.beats.map(beat=>beat.index)}};
  for(const language of ['ko','en'])prose[language]=outline.beats.map(beat=>paragraphs(authored[language]).filter((_,index)=>authored.paragraphBeats[language][index]===beat.index).join(' ')).join('\n\n');
  const pagination=demoPagination(outline,prose,input);
  return {input,outline,prose,pagination};
}
function engine(answer){const calls=[];return {id:'openai',calls,async complete(request){calls.push(request);const value=await answer(request,calls.length);if(value instanceof Error)throw value;return {json:clone(value),usage:{input:10,output:20},costUsdEstimated:.01,meta:{modelId:'coherence-test'}};}};}
function issue(prose,{beatIndex=3,pageNo=null,evidence}={}){return {passed:false,issues:[{code:'state_conflict',beatIndex,pageNo,language:'ko',severity:'error',evidence:evidence||paragraphs(prose.ko)[beatIndex-1],suggestion:'이 비트의 승인된 행동과 소품 상태를 유지하도록 해당 문단만 고쳐 주세요.'}]};}

test('whole-prose review repairs only the evidenced language and beat, then binds the passing report to the result',async()=>{
  const {input,outline,prose}=fixture(),original=clone(prose),target=2,repaired=paragraphs(prose.ko)[target]+' 유하가 작은 통을 꼭 잡아요.';
  let reviews=0;const mock=engine(request=>reviewRequest(request)?++reviews===1?issue(prose):{passed:true,issues:[]}:{paragraphs:[{language:'ko',paragraphIndex:target,beatIndex:3,text:repaired}]});
  const result=await reviewStoryCoherence(outline,prose,null,input,{engine:mock});
  assert.equal(mock.calls.length,3);assert.equal(reviews,2);assert.equal(result.meta.requests,3);assert.equal(result.usage.input,30);assert.equal(result.usage.costUsdEstimated,.03);
  assert.equal(result.data.prose.en,prose.en);assert.equal(paragraphs(result.data.prose.ko)[target],repaired);assert.deepEqual(paragraphs(result.data.prose.ko).filter((_,i)=>i!==target),paragraphs(prose.ko).filter((_,i)=>i!==target));
  assert.deepEqual(prose,original);assert.ok(isCoherenceCurrent(result.meta.coherence,{outline,prose:result.data.prose,stage:'prose'}));
  const repair=mock.calls.find(request=>!reviewRequest(request)),payload=JSON.parse(repair.user);assert.deepEqual(payload.repairTargets.map(({language,paragraphIndex,beatIndex})=>({language,paragraphIndex,beatIndex})),[{language:'ko',paragraphIndex:target,beatIndex:3}]);assert.match(repair.system,/FROZEN_LEVEL_SPECS/);
});

test('persistent semantic contradictions stop after two targeted repairs and retain the latest prose and paid usage',async()=>{
  const {input,outline,prose}=fixture();let latest=clone(prose),repairs=0;
  const mock=engine(request=>{if(reviewRequest(request))return issue(latest);const paragraph=paragraphs(latest.ko)[2]+` 유하가 ${++repairs}번 더 살펴봐요.`;latest.ko=paragraphs(latest.ko).map((row,index)=>index===2?paragraph:row).join('\n\n');return {paragraphs:[{language:'ko',paragraphIndex:2,beatIndex:3,text:paragraph}]};});
  let error;try{await reviewStoryCoherence(outline,prose,null,input,{engine:mock});}catch(value){error=value;}
  assert.ok(error instanceof StoryValidationError);assert.equal(repairs,2);assert.equal(mock.calls.filter(reviewRequest).length,3);assert.equal(mock.calls.length,5);assert.equal(error.usage.input,50);assert.equal(error.meta.requests,5);assert.equal(error.coherence.passed,false);assert.deepEqual(error.prose,latest);assert.equal(error.prose.en,prose.en);
});

test('cancellation after a paid semantic repair checkpoints the latest artifact and resumes with a fresh review',async()=>{
  const {input,outline,prose}=fixture(),controller=new AbortController(),repaired=paragraphs(prose.ko)[2]+' 유하가 통의 빈 안쪽을 봐요.';
  let checkpoint;const mock=engine(request=>reviewRequest(request)?issue(prose):{paragraphs:[{language:'ko',paragraphIndex:2,beatIndex:3,text:repaired}]});
  await assert.rejects(reviewStoryCoherence(outline,prose,null,input,{engine:mock,signal:controller.signal,onCheckpoint:cp=>{checkpoint=clone(cp);if(cp.prose.ko.includes('통의 빈 안쪽'))controller.abort();}}),error=>error.name==='AbortError'&&error.prose.ko.includes('통의 빈 안쪽')&&error.usage.input===20&&error.meta.requests===2);
  assert.equal(mock.calls.length,2);assert.equal(checkpoint.usage.input,20);assert.equal(checkpoint.stage,'coherence');assert.equal(checkpoint.prose.en,prose.en);
  const resumed=engine(()=>({passed:true,issues:[]})),result=await reviewStoryCoherence(outline,checkpoint.prose,null,input,{engine:resumed,proseCoherence:checkpoint.coherence});
  assert.equal(resumed.calls.length,1);assert.deepEqual(result.data.prose,checkpoint.prose);assert.equal(result.meta.coherence.passed,true);
});

test('a current report avoids duplicate review, while an edited prose invalidates it before another stage can use it',async()=>{
  const {input,outline,prose}=fixture(),first=engine(()=>({passed:true,issues:[]})),reviewed=await reviewStoryCoherence(outline,prose,null,input,{engine:first});
  const unused=engine(()=>{throw Error('a current report must not pay for another review');}),reused=await reviewStoryCoherence(outline,prose,null,input,{engine:unused,proseCoherence:reviewed.meta.coherence});assert.equal(unused.calls.length,0);assert.equal(reused.meta.requests,0);
  const changed=clone(prose);changed.ko+=' 유하가 손을 흔들어요.';assert.equal(isCoherenceCurrent(reviewed.meta.coherence,{outline,prose:changed,stage:'prose'}),false);
  const repeat=engine(()=>({passed:true,issues:[]})),result=await reviewStoryCoherence(outline,changed,null,input,{engine:repeat,proseCoherence:reviewed.meta.coherence});assert.equal(repeat.calls.length,1);assert.notEqual(result.meta.coherence.contentFingerprint,reviewed.meta.coherence.contentFingerprint);
});

test('resuming a stopped repair keeps the two-repair budget instead of restarting it',async()=>{
  const {input,outline,prose}=fixture(),controller=new AbortController();let checkpoint;
  const first=engine(request=>reviewRequest(request)?issue(prose):{paragraphs:[{language:'ko',paragraphIndex:2,beatIndex:3,text:paragraphs(prose.ko)[2]+' 유하가 통을 만져요.'}]});
  await assert.rejects(reviewStoryCoherence(outline,prose,null,input,{engine:first,signal:controller.signal,onCheckpoint:cp=>{checkpoint=clone(cp);if(cp.coherence?.pending)controller.abort();}}),{name:'AbortError'});
  assert.equal(checkpoint.coherence.repairAttempts,1);let latest=checkpoint.prose,repairs=0;
  const resumed=engine(request=>{if(reviewRequest(request))return issue(latest);repairs++;latest={...latest,ko:paragraphs(latest.ko).map((paragraph,index)=>index===2?paragraph+' 유하가 다시 봐요.':paragraph).join('\n\n')};return {paragraphs:[{language:'ko',paragraphIndex:2,beatIndex:3,text:paragraphs(latest.ko)[2]}]};});
  await assert.rejects(reviewStoryCoherence(outline,checkpoint.prose,null,input,{engine:resumed,proseCoherence:checkpoint.coherence}),error=>error instanceof StoryValidationError&&error.coherence.repairAttempts===2&&error.usage.input===30);
  assert.equal(repairs,1);assert.equal(resumed.calls.filter(reviewRequest).length,2);
});

for(const mode of ['invalid-json','provider-failure'])test(`a ${mode} repair spends its persisted attempt before the request and cannot reset the cap by resuming`,async()=>{
  const {input,outline,prose}=fixture();let saved,prior,reviews=0,repairs=0;
  const calls=[],mock={id:'openai',async complete(request){
    calls.push(request);
    if(reviewRequest(request)){reviews++;return {json:issue(prose),usage:{input:10,output:20},costUsdEstimated:.01,meta:{modelId:'coherence-test'}};}
    repairs++;assert.equal(saved.coherence.repairAttempts,repairs,'the attempt must already be durable when a provider starts');assert.deepEqual(saved.prose,prose);
    if(mode==='provider-failure')throw Error('repair provider unavailable');
    return {text:'{not valid JSON',usage:{input:7,output:3},costUsdEstimated:.02,meta:{modelId:'coherence-test'}};
  }};
  const errors=[];
  for(let run=1;run<=3;run++){
    let failure;try{await reviewStoryCoherence(outline,prose,null,input,{engine:mock,proseCoherence:prior,onCheckpoint:checkpoint=>saved=clone(checkpoint)});}catch(error){failure=error;}
    assert.ok(failure);errors.push(failure);assert.deepEqual(failure.prose,prose);assert.equal(failure.coherence.passed,false);assert.equal(failure.coherence.repairAttempts,Math.min(run,2));assert.equal(saved.coherence.repairAttempts,Math.min(run,2));prior=failure.coherence;
    if(run<=2){assert.equal(failure.usage.input,mode==='invalid-json'?17:10);assert.equal(failure.usage.output,mode==='invalid-json'?23:20);assert.equal(failure.meta.requests,mode==='invalid-json'?2:1);assert.equal(failure.usage.costUsdEstimated,mode==='invalid-json'?.03:.01);}
    else {assert.ok(failure instanceof StoryValidationError);assert.equal(failure.usage.input,10);assert.equal(failure.meta.requests,1);}
  }
  assert.equal(reviews,3);assert.equal(repairs,2);assert.equal(calls.length,5);assert.equal(errors.reduce((total,error)=>total+error.usage.input,0),mode==='invalid-json'?44:30);
});

test('pagination receives a final semantic review and repairs a changed event on only its target page',async()=>{
  const {input,outline,prose,pagination}=fixture(),approved=await reviewStoryCoherence(outline,prose,null,input,{engine:engine(()=>({passed:true,issues:[]}))}),drifted=clone(pagination);
  drifted.pages[0].textKo='유하가 갑자기 새 성을 지어요.';let pageReviews=0;
  const mock=engine(request=>{
    if(reviewRequest(request))return ++pageReviews===1?issue(prose,{beatIndex:1,pageNo:1,evidence:drifted.pages[0].textKo}):{passed:true,issues:[]};
    if(request.jsonSchema.properties.cover)return drifted;
    return {pages:[{...pagination.pages[0],textEn:'The repair must not replace the unaffected English event.'}]};
  });
  const result=await paginateStory(outline,prose,input,{engine:mock,repair:false,proseCoherence:approved.meta.coherence});
  assert.equal(pageReviews,2);assert.equal(mock.calls.length,4);assert.equal(result.data.pages[0].textKo,pagination.pages[0].textKo);assert.equal(result.data.pages[0].textEn,pagination.pages[0].textEn);assert.deepEqual(result.data.pages.slice(1).map(page=>page.textKo),pagination.pages.slice(1).map(page=>page.textKo));assert.deepEqual(prose,approved.data.prose);
  assert.ok(isCoherenceCurrent(result.meta.coherence,{outline,prose,pagination:result.data,stage:'pages'}));
});

test('legacy saved outlines remain readable without a fabricated semantic pass or paid migration',async()=>{
  const {input,outline,prose}=fixture();delete outline.plotContract;const unused=engine(()=>{throw Error('legacy review must be explicit');});
  const result=await reviewStoryCoherence(outline,prose,null,input,{engine:unused});assert.equal(unused.calls.length,0);assert.equal(result.meta.requests,0);assert.equal(result.meta.skipped,true);assert.equal(result.meta.coherence,null);assert.deepEqual(result.data.prose,prose);
});

test('A-4 child turn repair pays for exactly one final page coherence review',async()=>{
 const {finalizeStoryPagination}=await import('../dist/story-generation/pipeline.js');
 const {input,outline,prose,pagination}=fixture();input.storyQuality={enabled:true,childSimulator:true};let retells=0,semanticReviews=0,repaginations=0;
 const mock=engine(request=>{
  const schema=request.jsonSchema?.properties || {};
  if(schema.passed){semanticReviews++;return {passed:true,issues:[]};}
  if(schema.retell){retells++;return {retell:['유하가 바람의 노래를 찾아요.','유하가 빈 통을 불어요.','유하가 통을 가지고 집으로 돌아와요.'],coveredBeats:outline.beats.filter(b=>retells!==1 || b.type!=="turn").map(b=>b.index),missingCore:retells===1?['turn']:[],confusions:[],coherence:2};}
  if(schema.paragraph){const data=JSON.parse(request.user);return {paragraph:data.targetParagraph};}
  if(schema.pages && schema.overall)return {pages:pagination.pages.map(page=>({pageNo:page.pageNo,score:2,childQuestion:page.pageNo===12?null:'다음에는?',why:'다음 행동 기대'})),dropPages:[],overall:8};
  if(schema.pages){repaginations++;return clone(pagination);}
  throw new Error('Unexpected mocked schema: '+Object.keys(schema).join(','));
 });
 const result=await finalizeStoryPagination(outline,prose,pagination,input,{engine:mock,repair:false});
 assert.equal(repaginations,1);assert.equal(retells,2);assert.equal(semanticReviews,1);assert.ok(isCoherenceCurrent(result.meta.coherence,{outline,prose:result.meta.approvedProse,pagination:result.data,stage:'pages'}));
});
