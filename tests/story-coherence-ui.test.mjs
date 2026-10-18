import test from 'node:test';
import assert from 'node:assert/strict';
import {renderStoryStructureSelector,renderStoryPlotContract,renderStoryBeatCard,renderStoryCoherence,updateStoryBeatLocation} from '../dist/story-generation/ui.js';
import {STORY_STRUCTURE_PRESETS} from '../dist/story-generation/plot-contract.js';

function fixture(){
 const characters=[{id:'yuha',name:'유하'}],backgrounds=[{id:'home',name:'유하의 집',type:'home'},{id:'garden',name:'꽃 정원',type:'garden'},{id:'pond',name:'연못',type:'pond'}];
 const types=['setup','want','attempt','attempt','turn','resolution','close'],places=['home','garden','garden','pond','pond','garden','home'];
 const state={characters:[{characterId:'yuha',locationId:'garden',knows:['작은 잎으로는 물을 모을 수 없다.']}],props:[{id:'leaf',name:'넓은 잎',ownerId:'yuha',locationId:'garden',condition:'물기가 남아 있다.'}],openPromises:['집에 돌아가 꽃에 물을 준다.']};
 return {input:{topic:'빗방울',characters,backgrounds,pageCount:12},outline:{beats:types.map((type,index)=>({index:index+1,type,summary:`유하가 빗방울을 모으는 사건 ${index+1}`,settingKey:places[index]})),settings:places.map((backgroundId,i)=>({beatIndex:i+1,backgroundId})),plotContract:{version:1,protagonistId:'yuha',goal:'꽃에 줄 빗방울을 모은다.',resolutionCriterion:'유하가 모은 물을 꽃뿌리에 붓는다.',beats:[{beatIndex:3,becauseOfBeatIndex:2,trigger:'작은 잎 밖으로 물이 튄다.',attempt:'유하가 더 넓은 잎을 고른다.',obstacle:'바람에 잎이 흔들린다.',result:'유하가 잎자루를 두 손으로 잡는다.',nextDecision:'유하가 우산을 기울이기로 한다.',stateBefore:state,stateAfter:state,setupIds:['wide-leaf'],payoffIds:[]}]}}};
}

test('structure choices expose automatic and generic patterns with accessible labels',()=>{
 const html=renderStoryStructureSelector({topic:'빗방울'});
 assert.match(html,/for="story-structure-preset"/);assert.match(html,/value="auto" selected/);assert.match(html,/구성 원리만 참고하고 사건과 문장은 새로/);
 for(const preset of STORY_STRUCTURE_PRESETS.filter(preset=>preset.id!=='auto'))assert.ok(html.includes(`value="${preset.id}"`));
 const custom=renderStoryStructureSelector({storyStructurePresetId:STORY_STRUCTURE_PRESETS.find(preset=>preset.id!=='auto').id},{id:'wizard-structure',disabled:true});
 assert.match(custom,/id="wizard-structure"[^>]+disabled/);
});

test('linked plot ledger shows causal steps and named before/after states without editable ledger fields',()=>{
 const draft=fixture(),overview=renderStoryPlotContract(draft),card=renderStoryBeatCard(draft,2,{open:true});
 assert.match(overview,/주인공의 목표/);assert.match(overview,/해결 확인 기준/);assert.doesNotMatch(overview,/<input|<textarea/);
 for(const text of ['비트 2의 결과','주인공의 시도','다음 결정','사건 전 상태','사건 후 상태','넓은 잎','꽃 정원','아는 사실','미해결 약속','단서 심기'])assert.ok(card.includes(text));
 assert.match(card,/data-beat-field="summary"/);assert.doesNotMatch(card,/data-plot-contract-field/);
 draft.outline.plotContract.goal='<img src=x onerror=bad>';draft.outline.plotContract.beats[0].result='<script>bad</script>';
 assert.doesNotMatch(renderStoryPlotContract(draft)+renderStoryBeatCard(draft,2),/<img|<script>/);
 delete draft.outline.plotContract;assert.match(renderStoryPlotContract(draft),/이전에 만든 줄거리/);
});

test('actual location edits stale the linked contract; unchanged selections and legacy outlines do not',()=>{
 const draft=fixture(),before=structuredClone(draft.outline),changed=updateStoryBeatLocation(draft.outline,draft.input,2,'pond');
 assert.equal(changed.plotContractDirty,true);assert.deepEqual(draft.outline,before);assert.match(renderStoryPlotContract({...draft,outline:changed}),/설계 재검사 필요/);
 assert.equal(updateStoryBeatLocation(draft.outline,draft.input,2,'garden').plotContractDirty,undefined);
 const legacy=structuredClone(draft.outline);delete legacy.plotContract;assert.equal(updateStoryBeatLocation(legacy,draft.input,2,'pond').plotContractDirty,undefined);
});

test('coherence review distinguishes current and stale results, and safely quotes failure evidence',()=>{
 const report={stage:'pages',passed:false,issues:[{code:'prop_state',severity:'error',beatIndex:3,pageNo:5,language:'ko',evidence:'<img src=x onerror=bad>',suggestion:'잎을 건넨 사건을 먼저 적어 주세요.'}]};
 const html=renderStoryCoherence(report);assert.match(html,/<details[^>]+open/);assert.match(html,/5쪽 · 비트 3 · 한글 · 소품 상태/);assert.match(html,/오류가 해결되어야 그림 단계/);assert.match(html,/잎을 건넨 사건/);assert.doesNotMatch(html,/<img/);
 assert.match(renderStoryCoherence(report,{dirty:true}),/수정 후 재검사 필요/);assert.match(renderStoryCoherence({passed:true,issues:[]}),/발견된 플롯 연결 오류가 없습니다/);assert.equal(renderStoryCoherence(null),'');
});

import {configureStoryUI,resumeStoryDraft,cleanupStoryWorkflow,applyStoryCheckpoint} from '../dist/story-generation/ui.js';
import {demoOutline,demoProse,demoPagination} from '../dist/story-generation/demo.js';
import {demoPlotContract} from '../dist/story-generation/plot-contract.js';
import {coherenceFingerprint} from '../dist/story-generation/coherence.js';
import {getLevelSpec} from '../dist/reading-levels.js';

const originalDocument=globalThis.document,handlers={};let currentState,rendered='',readyCount=0;
const errorNode={textContent:''};
const defaultDocument={addEventListener:(type,handler)=>{handlers[type]=handler;},querySelectorAll:()=>[],querySelector:selector=>selector==='#story-error'?errorNode:null};
globalThis.document=defaultDocument;
configureStoryUI({getState:()=>currentState,isParent:()=>true,protectedAction:fn=>fn(),save:()=>true,render:()=>{},toast:()=>{},modalHeader:title=>`<h2>${title}</h2>`,showModal:value=>{rendered=value;},closeModal:()=>{},onReady:async()=>{readyCount++;}});
function workflowFixture(){
 const input={characters:[{id:'yuha',name:'유하',nameEn:'Yuha'},{id:'green',name:'그린이',nameEn:'Green'}],backgrounds:[{id:'home',name:'유하의 집',type:'home'},{id:'forest',name:'숲길'},{id:'garden',name:'작은 정원'}],topic:'바람 피리',pageCount:12,endingType:'home_sleep',specs:{ko:getLevelSpec('K1'),en:getLevelSpec('E0')},variants:[]};
 const outline=demoOutline(input);outline.plotContract=demoPlotContract(outline,input);
 const prose=demoProse(outline,input),pagination=demoPagination(outline,prose,input);
 const textSettings={engine:'openai',providers:{openai:{model:'gpt-6-astra',proxyEndpoint:'https://story-proxy.invalid',transport:'proxy'}},hybrid:{enabled:false},storyEnrichment:false};
 const draft={id:'coherence-ui-draft',bookId:'coherence-ui-book',wizard:{},input,outline,prose,pagination,textSettings,worldSnapshot:{imageEngine:'openai'},readingLevels:{specs:input.specs},usage:{calls:[]},stage:'paged',reviewMode:'pages'};
 return {draft,state:{settings:{textGeneration:textSettings},backgrounds:input.backgrounds,storyDrafts:{[draft.id]:draft}}};
}
const click=async(action,data={})=>await handlers.click({target:{closest:()=>({dataset:{storyAction:action,...data}})},preventDefault:()=>{}});

test('editing an event summary preserves the old ledger but immediately changes the approval action to rebuilding it',()=>{
 const {draft,state}=workflowFixture();draft.reviewMode='outline';draft.sceneBriefs=[{beatIndex:1}];currentState=state;
 const originalQueryAll=globalThis.document.querySelectorAll,originalQuery=globalThis.document.querySelector,action={dataset:{storyAction:'generate-prose'},textContent:''},badge={textContent:'',classList:{add:()=>{}}};
 try{
  resumeStoryDraft(draft.id);const before=structuredClone(currentState.storyDrafts[draft.id].outline.plotContract);
  globalThis.document.querySelectorAll=selector=>selector==='[data-beat-field]'?[{dataset:{index:'2',beatField:'summary'},value:'유하가 피리 소리를 듣고 통의 바닥을 살펴봐요.'}]:[];
  globalThis.document.querySelector=selector=>selector.includes('modal-actions')?action:selector==='[data-story-contract-status]'?badge:selector==='#story-error'?errorNode:null;
  handlers.change({target:{closest:()=>true,matches:()=>false,id:''}});
  const saved=currentState.storyDrafts[draft.id];assert.equal(saved.outline.plotContractDirty,true);assert.deepEqual(saved.outline.plotContract,before);assert.equal(saved.sceneBriefs,null);assert.equal(action.dataset.storyAction,'approve-outline');assert.match(action.textContent,/다시 생성/);assert.match(badge.textContent,/재검사 필요/);
 }finally{globalThis.document.querySelectorAll=originalQueryAll;globalThis.document.querySelector=originalQuery;cleanupStoryWorkflow();}
});

test('final approval cannot bypass a persisted hard plot failure even with the warning checkbox selected',async()=>{
 const {draft,state}=workflowFixture(),issue={code:'state_conflict',beatIndex:1,pageNo:1,language:'ko',severity:'error',evidence:draft.pagination.pages[0].textKo,suggestion:'유하가 집에서 시작하는 승인된 행동을 유지해 주세요.'};
 draft.pageCoherence={version:1,stage:'pages',contentFingerprint:coherenceFingerprint({outline:draft.outline,prose:draft.prose,pagination:draft.pagination,stage:'pages'}),passed:false,issues:[issue],repairAttempts:2};
 currentState=state;readyCount=0;errorNode.textContent='';const priorFetch=globalThis.fetch,priorQuery=globalThis.document.querySelector;let requests=0;
 globalThis.document.querySelector=selector=>selector==='#story-accept-failures'?{checked:true}:selector==='#story-error'?errorNode:null;
 globalThis.fetch=async()=>{requests++;return Response.json({json:{passed:false,issues:[issue]},usage:{input:20,output:30}});};
 try{resumeStoryDraft(draft.id);await click('approve-pages');assert.equal(readyCount,0);assert.equal(requests,1);assert.match(errorNode.textContent,/모순|플롯/);assert.equal(currentState.storyDrafts[draft.id].pageCoherence.passed,false);assert.match(rendered,/플롯 일관성 검사/);}
 finally{cleanupStoryWorkflow();globalThis.fetch=priorFetch;globalThis.document.querySelector=priorQuery;}
});

test('semantic repair checkpoints keep the latest paid text and review outside the printable prose',()=>{
 const {draft}=workflowFixture(),prose=structuredClone(draft.prose);prose.ko+=' 유하가 빈 통을 꼭 잡아요.';
 const report={version:1,stage:'prose',passed:false,pending:true,issues:[],repairAttempts:1};
 assert.equal(applyStoryCheckpoint(draft,{stage:'coherence',prose,coherence:report}),'prose');assert.equal(draft.prose.ko,prose.ko);assert.deepEqual(draft.proseCoherence,report);assert.equal('coherence' in draft.prose,false);
});

test.after(()=>{cleanupStoryWorkflow();globalThis.document=originalDocument;});

test('final approval resumes a pending child simulation before semantic approval without rewriting pagination',async()=>{
 const {draft,state}=workflowFixture();draft.input.storyQuality={enabled:true,childSimulator:true,twoPass:true};draft.childGatePending=true;
 currentState=state;readyCount=0;errorNode.textContent='';const priorFetch=globalThis.fetch,priorQuery=globalThis.document.querySelector,calls=[];
 globalThis.document.querySelector=selector=>selector==='#story-accept-failures'?{checked:true}:selector==='#story-error'?errorNode:null;
 globalThis.fetch=async(_url,request)=>{const body=JSON.parse(request.body);calls.push(body.jsonSchema);let json;
  if(body.jsonSchema.properties.overall)json={pages:draft.pagination.pages.map(page=>({pageNo:page.pageNo,score:2,childQuestion:null,why:'다음 행동이 자연스럽게 이어져요.'})),dropPages:[],overall:8};
  else if(body.jsonSchema.properties.retell)json={retell:['유하가 바람의 소리를 찾으려고 해요.','유하가 통을 살펴 바람 소리의 이유를 알아요.','유하가 통으로 소리를 내고 집으로 돌아와요.'],coveredBeats:draft.outline.beats.map(beat=>beat.index),missingCore:[],confusions:[],coherence:2};
  else json={passed:true,issues:[]};
  return Response.json({json,usage:{input:20,output:30}});
 };
 try{resumeStoryDraft(draft.id);await click('approve-pages');assert.equal(readyCount,1,errorNode.textContent);assert.equal(calls.length,3);assert.equal(calls.filter(schema=>schema.properties.pages&&!schema.properties.overall).length,0);const saved=currentState.storyDrafts[draft.id];assert.equal(saved.childGatePending,false);assert.equal(saved.childGateCheckpoint.phase,'complete');assert.equal(saved.pageCoherence.passed,true);}
 finally{cleanupStoryWorkflow();globalThis.fetch=priorFetch;globalThis.document.querySelector=priorQuery;}
});

test('FIX-IMG-3: the first parent edit of the cover action keeps the planned one outside the reviewed content',()=>{
 const {draft,state}=workflowFixture();currentState=state;
 const planned=draft.pagination.cover.sceneAction,fingerprint=coherenceFingerprint({outline:draft.outline,prose:draft.prose,pagination:draft.pagination,stage:'pages'});
 const originalQueryAll=globalThis.document.querySelectorAll;
 const edit=value=>{globalThis.document.querySelectorAll=selector=>selector==='[data-cover-field]'?[{dataset:{coverField:'title'},value:currentState.storyDrafts[draft.id].pagination.cover.title},{dataset:{coverField:'sceneAction'},value}]:[];handlers.change({target:{closest:()=>true,matches:()=>false,id:''}});};
 try{
  resumeStoryDraft(draft.id);
  // Re-reading the unchanged form records nothing.
  edit(planned);let saved=currentState.storyDrafts[draft.id];
  assert.equal(saved.pagination.coverSceneActionGenerated,undefined);
  edit('A girl in a blue gown like Frozen');saved=currentState.storyDrafts[draft.id];
  assert.equal(saved.pagination.cover.sceneAction,'A girl in a blue gown like Frozen');
  assert.equal(saved.pagination.coverSceneActionGenerated,planned);
  // A second edit keeps the planned original, and the record never changes the reviewed-content fingerprint.
  edit('Yuha on the frozen lake');saved=currentState.storyDrafts[draft.id];
  assert.equal(saved.pagination.coverSceneActionGenerated,planned);
  edit(planned);saved=currentState.storyDrafts[draft.id];
  assert.equal(coherenceFingerprint({outline:saved.outline,prose:saved.prose,pagination:saved.pagination,stage:'pages'}),fingerprint);
 }finally{globalThis.document.querySelectorAll=originalQueryAll;cleanupStoryWorkflow();}
});
