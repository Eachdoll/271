import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectChildStory,approvedBookRecord,recordApprovedElements,qualityWeeklyCoachDue,runQualityWeeklyCoach,applyCoachProposals,rollbackQualityRules} from '../dist/story-generation/quality-gates.js';

const clone=value=>JSON.parse(JSON.stringify(value));
const at='2026-10-16T12:00:00.000Z';
function fixture(){
  const outline={plan:{pattern:'discovery',planted:'노란 컵'},logline:'유하가 컵에 빗물을 모아 꽃에 주어요.',want:'유하가 꽃에 빗물을 주고 싶어요.',beats:[
    {index:1,type:'want',summary:'유하가 노란 컵을 정원으로 가져가요.'},
    {index:2,type:'turn',summary:'유하가 빗물이 나뭇잎 끝에 모인 것을 보고 컵을 옮겨요.'},
    {index:3,type:'resolution',summary:'유하가 컵에 모은 빗물을 꽃뿌리에 부어요.'}
  ],quality:{patternId:'discovery',seed:{twist:{id:'move_cup'},subLocation:{ko:'나뭇잎 아래'},creature:{ko:'달팽이'}}}};
  const prose={ko:'유하가 컵을 가져가요. 유하가 비를 바라봐요.\n\n유하가 잎 끝의 빗물을 봐요. 유하가 컵을 옮겨요.\n\n유하가 꽃에 물을 주어요. 유하가 집에서 쉬어요.',en:'Yuha has a cup. Yuha looks at the rain.\n\nYuha sees drops on a leaf. Yuha moves the cup.\n\nYuha waters the flower. Yuha rests at home.',paragraphBeats:{ko:[1,2,3],en:[1,2,3]},usedRefrainAt:[]};
  const pagination={cover:{title:'빗물 한 컵',sceneAction:'Yuha carries a cup.'},pages:prose.ko.split('\n\n').map((textKo,index)=>({pageNo:index+1,beatIndex:index+1,textKo,textEn:prose.en.split('\n\n')[index],scene:{who:['yuha'],where:index===2?'home':'garden',action:'Yuha carries a yellow cup.',props:['yellow cup'],emotion:'curious',timeOfDay:'day'},variantByCharacter:{yuha:null},isRefrainPage:false}))};
  const input={language:'both',storyQuality:{enabled:true,childSimulator:true}};
  return {outline,prose,pagination,input};
}
function curiosity({zero=[],overall=8}={}){return {pages:[1,2,3].map(pageNo=>({pageNo,score:zero.includes(pageNo)?0:2,childQuestion:pageNo===3?null:'다음에는?',why:pageNo===3?'편안한 마무리':'다음 행동 기대'})),dropPages:[...zero],overall};}
function retell({missing=[]}={}){return {retell:['유하가 꽃에게 물을 주고 싶었어요.','유하가 잎 끝으로 컵을 옮겼어요.','유하가 꽃에 빗물을 주었어요.'],coveredBeats:[1,2,3].filter(id=>!missing.includes(['want','turn','resolution'][id-1])),missingCore:[...missing],confusions:[],coherence:2};}
function childEngine({curiosityResults=[curiosity()],retellResults=[retell()]}={}){
  const calls=[];return {id:'fake-cheap',calls,async complete(request){calls.push(request);const source=request.system.includes('다음엔?')?curiosityResults:retellResults;const value=source.length>1?source.shift():source[0];return {json:clone(value),usage:{input:10,output:5},costUsdEstimated:.001,meta:{requests:1,apiKey:'never-save'}};}};
}
const child=(source,options={},services={})=>inspectChildStory(source.outline,source.prose,source.pagination,source.input,{now:at,...options},services);

test('disabled child simulator never resolves an engine; valid and cached checks make exactly two then zero calls',async()=>{
  const source=fixture(),before=clone(source),engine=childEngine();
  const disabled=await child({...source,input:{storyQuality:{enabled:true,childSimulator:false}}},{},{engineFor(){throw Error('should not resolve');}});
  assert.equal(disabled.meta.requests,0);assert.equal(disabled.meta.childGate.skipped,true);
  const result=await child(source,{engine});assert.equal(engine.calls.length,2);assert.equal(result.meta.requests,2);assert.equal(result.meta.childGate.pass,true);assert.equal(result.usage.input,20);
  assert.ok(engine.calls.every(call=>call.jsonSchema&&call.signal===undefined));assert.doesNotMatch(JSON.stringify(result),/never-save|apiKey/);
  const cached=await child(source,{engine,childGateCheckpoint:result.meta.childGate});assert.equal(cached.meta.requests,0);assert.equal(cached.meta.childGate.cached,true);assert.equal(engine.calls.length,2);
  source.pagination.pages[0].textKo+=' 유하가 컵을 잡아요.';await child(source,{engine,childGateCheckpoint:result.meta.childGate});assert.equal(engine.calls.length,4);
  assert.deepEqual(before.prose,result.data.prose);assert.deepEqual(before.pagination,result.data.pagination);
});

test('malformed simulator output cannot exploit package defaults into a false pass and preserves both parallel-call usage',async()=>{
  for(const settings of [{curiosityResults:[{}]},{retellResults:[{}]},{curiosityResults:[{...curiosity(),pages:[]}]},{retellResults:[{...retell(),coveredBeats:[1,3]}]}]){
    const engine=childEngine(settings);
    await assert.rejects(child(fixture(),{engine}),error=>error.usage?.input===20&&error.meta.requests===2&&/검사 결과/.test(error.message));
    assert.equal(engine.calls.length,2);
  }
});

test('only zero-score nonfinal endings change, other language and scene remain exact, and the gate reruns once',async()=>{
  const source=fixture(),before=clone(source),engine=childEngine({curiosityResults:[curiosity({zero:[1,3]}),curiosity({zero:[3]})]}),targets=[],checkpoints=[];
  const result=await child(source,{engine,onCheckpoint:value=>checkpoints.push(clone(value))},{async rewriteStoryPage(pagination,pageNo,outline,prose,input,options){
    targets.push({pageNo,options});const next=clone(pagination);next.pages[0].textKo='다른 머리 문장이에요. 유하가 빗물이 모일 곳을 살펴봐요.';next.pages[0].textEn='Wrong language edit.';next.pages[0].scene.action='A new wizard arrives.';
    return {data:next,usage:{input:7,output:3},meta:{requests:1}};
  }});
  assert.deepEqual(targets.map(target=>target.pageNo),[1]);assert.equal(targets[0].options.keepEndingOnly,true);assert.match(targets[0].options.qualityInstruction,/새 사건/);
  assert.equal(result.data.pagination.pages[0].textKo,'유하가 컵을 가져가요. 유하가 빗물이 모일 곳을 살펴봐요.');
  assert.equal(result.data.pagination.pages[0].textEn,before.pagination.pages[0].textEn);assert.deepEqual(result.data.pagination.pages[0].scene,before.pagination.pages[0].scene);
  assert.deepEqual(result.data.pagination.pages.slice(1),before.pagination.pages.slice(1));assert.deepEqual(result.data.prose,before.prose);assert.deepEqual(source,before);
  assert.equal(result.meta.requests,5);assert.equal(result.usage.input,47);assert.equal(result.meta.childGate.repairPasses,1);assert.equal(result.meta.childGate.pass,true);assert.equal(result.meta.childGate.curiosity.quietFinalPageExempt,true);
  assert.ok(checkpoints.some(checkpoint=>checkpoint.childGateCheckpoint?.contentFingerprint));
});

test('persistent low curiosity stays an advisory after one repair, and reapproval does not buy another repair loop',async()=>{
  const source=fixture(),engine=childEngine({curiosityResults:[curiosity({zero:[1]})]});let repairs=0;
  const result=await child(source,{engine},{async rewriteStoryPage(pages){repairs++;return {data:clone(pages),usage:{input:1,output:1},meta:{requests:1}};}});
  assert.equal(repairs,1);assert.equal(engine.calls.length,4);assert.equal(result.meta.childGate.pass,false);assert.equal(result.meta.childGate.advisory,true);
  await child({...source,prose:result.data.prose,pagination:result.data.pagination},{engine,childGateCheckpoint:result.meta.childGate});assert.equal(repairs,1);assert.equal(engine.calls.length,4);
});

test('missing turn rewrites only labeled turn paragraphs in both languages and re-paginates once before recheck',async()=>{
  const source=fixture(),before=clone(source),engine=childEngine({retellResults:[retell({missing:['turn']}),retell()]}),targets=[];let repaginations=0;
  const result=await child(source,{engine},{
    async rewriteParagraph(prose,language,index,outline,input,options){targets.push([language,index]);assert.match(options.qualityInstruction,/반전/);const next=clone(prose),rows=next[language].split('\n\n');rows[index]=language==='ko'?'유하가 잎 끝의 빗물을 보고 컵을 옮겨요.':'Yuha sees drops on the leaf and moves the cup.';next[language]=rows.join('\n\n');return {data:next,usage:{input:2,output:1},meta:{requests:1}};},
    async repaginate(outline,prose,input,options){repaginations++;assert.equal(options.skipChildGate,true);assert.equal(options.repair,false);const pages=clone(source.pagination);for(const language of ['ko','en'])pages.pages[1][language==='ko'?'textKo':'textEn']=prose[language].split('\n\n')[1];return {data:pages,usage:{input:4,output:2},meta:{requests:1}};}
  });
  assert.deepEqual(targets,[['ko',1],['en',1]]);assert.equal(repaginations,1);assert.equal(result.meta.requests,7);assert.equal(result.meta.proseRevised,true);assert.equal(result.meta.childGate.pass,true);
  for(const language of ['ko','en'])assert.deepEqual(result.data.prose[language].split('\n\n').filter((row,index)=>index!==1),before.prose[language].split('\n\n').filter((row,index)=>index!==1));
  assert.deepEqual(source,before);
});

test('cancellation before child gates makes no paid request',async()=>{
  const controller=new AbortController();controller.abort();const engine=childEngine();await assert.rejects(child(fixture(),{engine,signal:controller.signal}),error=>error.name==='AbortError');assert.equal(engine.calls.length,0);
});

test('a paid successful assessor is checkpointed when its sibling fails, and resume buys only the missing result',async()=>{
  const source=fixture();let saved,failure;
  const engine={id:'partial',async complete(request){if(request.system.includes('다음엔?'))return {json:curiosity(),usage:{input:10,output:5}};const error=new Error('retell provider failed');error.usage={input:4,output:2};throw error;}};
  await assert.rejects(child(source,{engine,onCheckpoint:value=>saved=clone(value)}),error=>{failure=error;return error.message==='retell provider failed';});
  assert.equal(failure.meta.requests,2);assert.equal(failure.usage.input,14);assert.deepEqual(failure.childGateCheckpoint.rounds['0'].raw.curiosity,curiosity());assert.equal(failure.childGateCheckpoint.rounds['0'].raw.retell,undefined);
  const resumed=childEngine();const result=await child({...source,prose:saved.prose,pagination:saved.pagination},{engine:resumed,childGateCheckpoint:saved.childGateCheckpoint});
  assert.equal(resumed.calls.length,1);assert.doesNotMatch(resumed.calls[0].system,/다음엔\?/);assert.equal(result.meta.requests,1);assert.equal(result.usage.input,10);assert.equal(result.meta.childGate.pass,true);
});

test('cancellation after one paid assessor result retains it while its pending sibling can resume independently',async()=>{
  const source=fixture(),controller=new AbortController();let saved,failure;
  const engine={id:'cancel-sibling',async complete(request){
    if(request.system.includes('다음엔?'))return {json:curiosity(),usage:{input:12,output:6}};
    return new Promise((resolve,reject)=>{if(request.signal.aborted)reject(new DOMException('stopped','AbortError'));else request.signal.addEventListener('abort',()=>reject(new DOMException('stopped','AbortError')),{once:true});});
  }};
  await assert.rejects(child(source,{engine,signal:controller.signal,onCheckpoint:value=>{saved=clone(value);if(value.childGateCheckpoint.rounds['0']?.raw.curiosity&&!value.childGateCheckpoint.rounds['0']?.raw.retell)controller.abort();}}),error=>{failure=error;return error.name==='AbortError';});
  assert.equal(failure.usage.input,12);assert.equal(failure.meta.requests,2);assert.ok(saved.childGateCheckpoint.rounds['0'].raw.curiosity);
  const resumed=childEngine();const result=await child({...source,prose:saved.prose,pagination:saved.pagination},{engine:resumed,childGateCheckpoint:saved.childGateCheckpoint});assert.equal(resumed.calls.length,1);assert.equal(result.meta.childGate.pass,true);
});

test('cancellation between page targets resumes the remaining target and retains the one-pass repair budget',async()=>{
  const source=fixture(),controller=new AbortController(),engine=childEngine({curiosityResults:[curiosity({zero:[1,2]})]});let saved;const targets=[];
  const services={async rewriteStoryPage(pages,pageNo){targets.push(pageNo);const next=clone(pages);next.pages[pageNo-1].textKo=next.pages[pageNo-1].textKo.replace(/[^.!?。！？]+[.!?。！？]$/u,' 유하가 다음 행동을 살펴봐요.');return {data:next,usage:{input:3,output:2},meta:{requests:1}};}};
  await assert.rejects(child(source,{engine,signal:controller.signal,onCheckpoint:value=>{saved=clone(value);if(value.childGateCheckpoint.repairs.pages.some(target=>target.pageNo===1&&target.status==='done'))controller.abort();}},services),error=>error.name==='AbortError');
  assert.deepEqual(targets,[1]);assert.equal(saved.childGateCheckpoint.repairPasses,1);assert.equal(saved.childGateCheckpoint.phase,'repair');assert.equal(engine.calls.length,2);
  const resumed=childEngine();const result=await child({...source,prose:saved.prose,pagination:saved.pagination},{engine:resumed,childGateCheckpoint:saved.childGateCheckpoint},services);
  assert.deepEqual(targets,[1,2]);assert.equal(resumed.calls.length,2);assert.equal(result.meta.requests,3);assert.equal(result.usage.input,23);assert.equal(result.meta.childGate.repairPasses,1);assert.deepEqual(result.meta.childGate.repairedPages,[1,2]);
});

test('a consumed page repair that failed after a paid request is never automatically retried on resume',async()=>{
  const source=fixture(),engine=childEngine({curiosityResults:[curiosity({zero:[1]})]});let saved,repairs=0;
  const services={async rewriteStoryPage(){repairs++;const error=new DOMException('interrupted paid repair','AbortError');error.usage={input:7,output:3};throw error;}};
  await assert.rejects(child(source,{engine,onCheckpoint:value=>saved=clone(value)},services),error=>error.name==='AbortError'&&error.meta.requests===3&&error.usage.input===27);
  assert.equal(saved.childGateCheckpoint.repairs.pages[0].status,'consumed');assert.equal(saved.childGateCheckpoint.repairPasses,1);
  const resumed=childEngine({curiosityResults:[curiosity({zero:[1]})]});const result=await child({...source,prose:saved.prose,pagination:saved.pagination},{engine:resumed,childGateCheckpoint:saved.childGateCheckpoint},services);
  assert.equal(repairs,1);assert.equal(resumed.calls.length,2);assert.equal(result.meta.childGate.pass,false);assert.equal(result.meta.childGate.repairPasses,1);assert.equal(result.meta.requests,2);
});

test('turn repair resume preserves the finished Korean paragraph, rewrites English once and repaginates once',async()=>{
  const source=fixture(),controller=new AbortController(),engine=childEngine({retellResults:[retell({missing:['turn']})]});let saved,repaginations=0;const targets=[];
  const services={
    async rewriteParagraph(prose,language,index){targets.push(language);const next=clone(prose),rows=next[language].split('\n\n');rows[index]=language==='ko'?'유하가 잎 끝을 보고 컵을 옮겨요.':'Yuha sees the leaf and moves the cup.';next[language]=rows.join('\n\n');return {data:next,usage:{input:2,output:1},meta:{requests:1}};},
    async repaginate(outline,prose){repaginations++;const pages=clone(source.pagination);for(const language of ['ko','en'])pages.pages[1][language==='ko'?'textKo':'textEn']=prose[language].split('\n\n')[1];return {data:pages,usage:{input:5,output:2},meta:{requests:1}};}
  };
  await assert.rejects(child(source,{engine,signal:controller.signal,onCheckpoint:value=>{saved=clone(value);if(value.childGateCheckpoint.repairs.turns.some(target=>target.language==='ko'&&target.status==='done'))controller.abort();}},services),error=>error.name==='AbortError');
  assert.deepEqual(targets,['ko']);const korean=saved.prose.ko;assert.equal(saved.childGateCheckpoint.proseRevised,true);
  const resumed=childEngine();const result=await child({...source,prose:saved.prose,pagination:saved.pagination},{engine:resumed,childGateCheckpoint:saved.childGateCheckpoint},services);
  assert.deepEqual(targets,['ko','en']);assert.equal(result.data.prose.ko,korean);assert.equal(repaginations,1);assert.equal(resumed.calls.length,2);assert.equal(result.meta.requests,4);assert.equal(result.meta.childGate.repairPasses,1);assert.equal(result.meta.childGate.pass,true);
});

test('partial final recheck resumes its missing assessor without replaying targets or the successful final result',async()=>{
  const source=fixture();let saved,curiosityCalls=0,retellCalls=0,repairs=0;
  const engine={id:'final-partial',async complete(request){
    if(request.system.includes('다음엔?')){curiosityCalls++;return {json:curiosityCalls===1?curiosity({zero:[1]}):curiosity(),usage:{input:10,output:5}};}
    retellCalls++;if(retellCalls===2)throw Error('final retell failed');return {json:retell(),usage:{input:10,output:5}};
  }};
  const services={async rewriteStoryPage(pages){repairs++;return {data:clone(pages),usage:{input:2,output:1},meta:{requests:1}};}};
  await assert.rejects(child(source,{engine,onCheckpoint:value=>saved=clone(value)},services),/final retell failed/);
  assert.equal(saved.childGateCheckpoint.phase,'final-check');assert.ok(saved.childGateCheckpoint.rounds['1'].raw.curiosity);assert.equal(repairs,1);
  const resumed=childEngine();const result=await child({...source,prose:saved.prose,pagination:saved.pagination},{engine:resumed,childGateCheckpoint:saved.childGateCheckpoint},services);
  assert.equal(resumed.calls.length,1);assert.equal(repairs,1);assert.equal(result.meta.requests,1);assert.equal(result.meta.childGate.phase,'complete');
});

function book(id='b1',date='2026-10-15T12:00:00.000Z'){
  const source=fixture();source.outline.apiKey='private';source.outline.imageUrl='private-image';return {id,approved:true,createdAt:date,topic:'비 오는 날',outline:source.outline,sceneBriefs:[{creature:{ko:'작은 달팽이'},subLocation:{ko:'잎 아래'}}],koreanLevel:'K1',englishLevel:'E0',feedback:{difficulty:'hard',rubricTotal:8}};
}
function coachState(){return {books:[book('b1'),book('b2'),book('b3')],settings:{storyQuality:{enabled:true,weeklyCoach:true,rules:['기존 규칙'],banExamples:['✗ 기존 예시']}}};}
function proposal(overrides={}){return {recurringWeaknesses:[{pattern:'행동 연결 보완',seenIn:['b1','b2'],evidence:'유하가 노란 컵을 정원으로 가져가요.'}],proposedBanExamples:[{text:'✗ 이유 없이 컵이 순간이동해요.',replaces:null}],proposedRules:[{text:'앞선 관찰을 다음 행동의 이유로 명시한다.',replaces:null,why:'인과 연결'}],patternNotes:[{patternId:'discovery',note:'관찰과 반전 사이의 이유를 명시한다.'}],keep:'주인공의 목표는 분명해요.',...overrides};}
function coachEngine(output=proposal()){
  const calls=[];return {id:'fake-coach',calls,async complete(request){calls.push(request);return {json:clone(output),usage:{input:30,output:20},costUsdEstimated:.01,meta:{apiKey:'never-save'}};}};
}

test('approved elements come only from confirmed books, retain seed and brief facts, remove secrets, and update without duplicates',()=>{
  const state=coachState(),source=book(),record=approvedBookRecord(source);assert.equal(record.patternId,'discovery');assert.equal(record.usedElements.planted,'노란 컵');assert.deepEqual(record.usedElements.creatures,['작은 달팽이','달팽이']);assert.deepEqual(record.usedElements.places,['잎 아래','나뭇잎 아래']);assert.equal(record.usedElements.twistTypeId,'move_cup');assert.doesNotMatch(JSON.stringify(record),/private|apiKey|imageUrl/);
  assert.equal(approvedBookRecord({...source,approved:false}),null);assert.equal(approvedBookRecord({...source,approved:undefined}),null);assert.equal(recordApprovedElements(state,{...source,approved:false}),null);
  recordApprovedElements(state,source,{now:at});source.outline.plan.planted='초록 컵';recordApprovedElements(state,source,{now:at});assert.equal(state.settings.storyQuality.approvedBooks.length,1);assert.equal(state.settings.storyQuality.approvedBooks[0].usedElements.planted,'초록 컵');assert.deepEqual(source.usedElements,state.settings.storyQuality.approvedBooks[0].usedElements);
});

test('weekly coach skips fewer than three recent approvals, runs when due, and never auto-applies proposals',async()=>{
  const small=coachState();small.books[0].createdAt='2026-09-01T00:00:00.000Z';const engine=coachEngine();
  const skipped=await runQualityWeeklyCoach(small,{engine,now:at});assert.equal(skipped.meta.requests,0);assert.equal(engine.calls.length,0);assert.equal(qualityWeeklyCoachDue(small,{now:at}),false);
  const state=coachState(),before=clone(state.settings.storyQuality);const result=await runQualityWeeklyCoach(state,{engine,now:at});assert.equal(result.meta.requests,1);assert.equal(engine.calls.length,1);assert.ok(engine.calls[0].jsonSchema);assert.deepEqual(state.settings.storyQuality.rules,before.rules);assert.deepEqual(state.settings.storyQuality.banExamples,before.banExamples);assert.equal(state.settings.storyQuality.coachProposal.keep,'주인공의 목표는 분명해요.');assert.doesNotMatch(JSON.stringify(state),/never-save/);
  assert.equal(qualityWeeklyCoachDue(state,{now:'2026-10-22T12:00:00Z'}),false);assert.equal(qualityWeeklyCoachDue(state,{now:'2026-10-23T12:00:00Z'}),true);
  const cached=await runQualityWeeklyCoach(state,{engine,now:at});assert.equal(cached.meta.requests,0);assert.equal(engine.calls.length,1);
});

test('weekly proposals reject empty defaults, fabricated evidence, unknown books, excessive rules and invalid replacement indices',async()=>{
  const invalid=[{},proposal({recurringWeaknesses:[{pattern:'새 문제',seenIn:['unknown'],evidence:'유하가 노란 컵을 정원으로 가져가요.'}]}),proposal({recurringWeaknesses:[{pattern:'새 문제',seenIn:['b1'],evidence:'실제로 없는 실패 문장'}]}),proposal({proposedRules:Array.from({length:8},(_,index)=>({text:`규칙 ${index}`,replaces:null,why:'보완'}))}),proposal({proposedRules:[{text:'새 규칙',replaces:8,why:'보완'}]})];
  for(const output of invalid){const state=coachState();await assert.rejects(runQualityWeeklyCoach(state,{engine:coachEngine(output),now:at}),error=>error.usage?.input===30&&error.meta.requests===1);assert.equal(state.settings.storyQuality.coachProposal,undefined);assert.deepEqual(state.settings.storyQuality.rules,['기존 규칙']);}
});

test('only explicitly selected coach proposals apply with caps, version zero remains restorable, and stale basis is rejected',async()=>{
  const state=coachState();state.settings.storyQuality.rules=Array.from({length:7},(_,i)=>`규칙 ${i+1}`);state.settings.storyQuality.banExamples=Array.from({length:4},(_,i)=>`✗ 예시 ${i+1}`);
  const output=proposal({proposedRules:[{text:'선택한 새 규칙',replaces:null,why:'보완'},{text:'선택하지 않은 규칙',replaces:2,why:'보완'}],proposedBanExamples:[{text:'✗ 선택한 예시',replaces:1}]});
  await runQualityWeeklyCoach(state,{engine:coachEngine(output),now:at});const original=clone(state.settings.storyQuality.rules);
  const applied=applyCoachProposals(state,{ruleIndices:[0],banIndices:[0],now:at});assert.equal(applied.version,1);assert.equal(state.settings.storyQuality.rules.length,7);assert.equal(state.settings.storyQuality.banExamples.length,4);assert.ok(state.settings.storyQuality.rules.includes('선택한 새 규칙'));assert.equal(state.settings.storyQuality.rules.includes('선택하지 않은 규칙'),false);assert.equal(state.settings.storyQuality.banExamples[0],'✗ 선택한 예시');assert.deepEqual(state.settings.storyQuality.ruleVersions[0].rules,original);
  assert.throws(()=>applyCoachProposals(state,{ruleIndices:[1]}),/새 코치 제안/);
  const restored=rollbackQualityRules(state,{version:0,now:'2026-10-17T12:00:00Z'});assert.equal(restored.version,2);assert.equal(restored.restoredFrom,0);assert.deepEqual(state.settings.storyQuality.rules,original);
  await runQualityWeeklyCoach(state,{engine:coachEngine(),now:at,force:true});state.settings.storyQuality.rules[0]='부모가 직접 바꿈';assert.throws(()=>applyCoachProposals(state,{ruleIndices:[0]}),/규칙이 바뀌었/);
});

test('simultaneous weekly due checks share one request and cancellation leaves no applied rules',async()=>{
  const state=coachState(),engine=coachEngine();const [first,second]=await Promise.all([runQualityWeeklyCoach(state,{engine,now:at}),runQualityWeeklyCoach(state,{engine,now:at})]);assert.equal(engine.calls.length,1);assert.equal(first.data.id,second.data.id);
  const stopped=coachState(),controller=new AbortController();controller.abort();await assert.rejects(runQualityWeeklyCoach(stopped,{engine,now:at,signal:controller.signal}),error=>error.name==='AbortError');assert.equal(stopped.settings.storyQuality.coachProposal,undefined);
});

test('rule performance uses the existing approved-book baseline and suggests restoring earlier rules after a drop',async()=>{
  const state=coachState();await runQualityWeeklyCoach(state,{engine:coachEngine(),now:at});applyCoachProposals(state,{ruleIndices:[0],now:at});assert.equal(state.settings.storyQuality.ruleVersions[0].rubricAvgAfter,8);
  const later=book('b4','2026-10-17T12:00:00Z');later.feedback.rubricTotal=6;recordApprovedElements(state,later,{now:'2026-10-17T12:00:00Z'});
  assert.equal(state.settings.storyQuality.ruleVersions.at(-1).rubricAvgAfter,6);assert.equal(state.settings.storyQuality.rollbackSuggested,true);
});
