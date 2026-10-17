import test from 'node:test';
import assert from 'node:assert/strict';
import {renderStoryBeatCard,renderStoryProseParagraphs,selectableBeatBackgrounds,updateStoryBeatLocation,configureStoryUI,resumeStoryDraft,cleanupStoryWorkflow} from '../dist/story-generation/ui.js';

const backgrounds=[{id:'home',name:'유하의 집',type:'home',layout:{door:'round'}},{id:'home2',name:'작은 거실',type:'room'},{id:'forest',name:'숲길',type:'forest'},{id:'garden',name:'정원',type:'garden'}];
function fixture(){
 const types=['setup','want','attempt','attempt','turn','resolution','close'];
 const places=['home','forest','garden','forest','garden','forest','home'];
 const beats=types.map((type,index)=>({index:index+1,type,summary:`유하와 그린이가 바람을 살펴보는 사건 ${index+1}이에요.`,characters:['yuha','green'],settingKey:places[index]}));
 return {id:'draft-ui',stage:'outline_draft',reviewMode:'outline',textSettings:{engine:'openai',providers:{openai:{model:'gpt-6-astra',stageModels:{medium:'gpt-6.1-sol',upper:'gpt-6-astra'}}},hybrid:{enabled:false,finalEngine:'openai'}},input:{topic:'바람',pageCount:12,backgrounds:structuredClone(backgrounds),characters:[{id:'yuha',name:'유하'},{id:'green',name:'그린이'}],specs:{ko:{id:'K1'},en:{id:'E0'}},variants:[]},worldSnapshot:{imageEngine:'openai'},outline:{titleCandidates:['바람의 길','함께 찾은 바람','작은 바람'],logline:'유하와 그린이가 바람을 찾아요.',want:'유하가 바람을 찾아요.',problem:'바람이 보이지 않아요.',twist:'바람은 잎을 움직여요.',beats,settings:beats.map(beat=>({beatIndex:beat.index,backgroundId:beat.settingKey})),emotionArc:types.map(()=> '호기심'),newWordsKo:['바람','나뭇잎','방울'],newWordsEn:['wind'],endingType:'home_sleep'},usage:{calls:[]}};
}

test('drawer chips restrict home endpoints and the paired endpoint keeps the same home',()=>{
 const d=fixture(),before=structuredClone(d);
 assert.deepEqual(selectableBeatBackgrounds(d.input,0,7).map(b=>b.id),['home','home2']);
 assert.deepEqual(selectableBeatBackgrounds(d.input,3,7).map(b=>b.id),['forest','garden']);
 const changed=updateStoryBeatLocation(d.outline,d.input,6,'home2');
 for(const index of [0,6]){assert.equal(changed.beats[index].settingKey,'home2');assert.equal(changed.settings.find(setting=>setting.beatIndex===index+1).backgroundId,'home2');}
 assert.equal(changed.beats[3].settingKey,'forest');assert.deepEqual(d,before);
 assert.throws(()=>updateStoryBeatLocation(d.outline,d.input,0,'forest'),/집/);
 assert.throws(()=>updateStoryBeatLocation(d.outline,d.input,2,'home'),/다른 장소/);
 const legacy=structuredClone(d.outline);legacy.settings[2]={beatIndex:3,newPlace:'옛 설명'};
 const repaired=updateStoryBeatLocation(legacy,d.input,2,'garden');assert.deepEqual(repaired.settings[2],{beatIndex:3,backgroundId:'garden'});
});

test('beat reviews collapse, show one-line event and emotion, and use drawer chips without free place fields',()=>{
 const d=fixture(),html=renderStoryBeatCard(d,2);
 assert.match(html,/<details[^>]+data-beat-details="2"[^>]*>/);assert.doesNotMatch(html,/<details[^>]+\bopen\b/);
 assert.match(html,/story-beat-preview/);assert.match(html,/story-emotion-badge/);assert.match(html,/aria-pressed="true"[^>]+data-story-action="set-beat-location"[^>]+data-background-id="garden"/);
 assert.match(html,/data-story-action="set-beat-emotion"/);assert.doesNotMatch(html,/data-beat-field="settingKey"|data-emotion-index=|data-background-id="home"/);
 assert.match(renderStoryBeatCard(d,0,{open:true}),/<details[^>]+\bopen\b/);
 d.outline.beats[2].summary='<img src=x onerror=bad>';d.input.backgrounds[2].name='<script>bad</script>';
 assert.doesNotMatch(renderStoryBeatCard(d,2),/<script>|<img/);
});

test('editable prose labels follow explicit paragraph-to-beat metadata, with legacy fallback',()=>{
 const d=fixture(),prose={ko:'유하가 집을 나서요.\n\n유하가 풀을 만져요.\n\n유하가 집으로 돌아와요.',en:'Yuha goes.\n\nYuha sees.',paragraphBeats:{ko:[1,3,7]}};
 const html=renderStoryProseParagraphs(prose,'ko',d.outline);
 assert.deepEqual([...html.matchAll(/data-beat-index="(\d+)"/g)].map(match=>Number(match[1])),[1,3,7]);
 assert.match(html,/비트 3 · 시도/);assert.match(html,/비트 7 · 마무리/);
 assert.equal((html.match(/data-prose-paragraph=/g)||[]).length,3);
 const legacy=renderStoryProseParagraphs(prose,'en',d.outline);assert.equal((legacy.match(/data-beat-index=/g)||[]).length,2);assert.doesNotMatch(legacy,/undefined|NaN/);
});

const handlers={};let currentState,html='',settingsId=null,saveCount=0;
const originalDocument=globalThis.document;
globalThis.document={addEventListener:(type,handler)=>handlers[type]=handler,querySelectorAll:()=>[],querySelector:()=>null};
configureStoryUI({getState:()=>currentState,isParent:()=>true,protectedAction:fn=>fn(),save:()=>{saveCount++;return true;},render:()=>{},toast:()=>{},modalHeader:title=>`<h2>${title}</h2>`,showModal:value=>{html=value;},closeModal:()=>{},openTextSettings:id=>{settingsId=id;}});
const click=async(action,data={})=>await handlers.click({target:{closest:()=>({dataset:{storyAction:action,...data}})},preventDefault:()=>{}});
function state(draft){return {settings:{textGeneration:{engine:'google',providers:{google:{stageModels:{medium:'gemini-2.5-flash',upper:'gemini-4-argon'}}}}},backgrounds:[...structuredClone(backgrounds),{id:'pond',name:'연못',type:'pond',imageUrl:'data:image/png;base64,SHOULD_NOT_COPY',layout:{bridge:'wood'}}],storyDrafts:{[draft.id]:draft}};}

test('settings link saves and exits the draft, then explicit settings adoption preserves all story work',async()=>{
 const d=fixture();currentState=state(d);settingsId=null;resumeStoryDraft(d.id);
 assert.equal(currentState.storyDrafts[d.id].input.backgrounds.length,5);assert.equal(currentState.storyDrafts[d.id].input.backgrounds.find(b=>b.id==='pond').imageUrl,undefined);
 assert.deepEqual(currentState.storyDrafts[d.id].input.backgrounds.find(b=>b.id==='home').layout,{door:'round'});
 const savedOutline=structuredClone(d.outline);await click('open-text-settings');assert.equal(settingsId,d.id);assert.ok(saveCount>0);
 assert.deepEqual(currentState.storyDrafts[d.id].outline,savedOutline);
 resumeStoryDraft(d.id,{useCurrentTextSettings:true});assert.equal(currentState.storyDrafts[d.id].textSettings.engine,'google');assert.deepEqual(currentState.storyDrafts[d.id].outline,savedOutline);
 const footer=html.match(/<div class="modal-actions">([\s\S]*?)<\/div>/)?.[1]||'';assert.equal((footer.match(/<button /g)||[]).length,2);assert.doesNotMatch(html,/story-text-engine|story-text-hybrid/);
 cleanupStoryWorkflow();
});

test('manual approval rejects a missing topic or character before any generation request',async()=>{
 const d=fixture();d.input.topic='무지개';currentState=state(d);const priorFetch=globalThis.fetch;let calls=0;
 const errorNode={textContent:''};globalThis.document.querySelector=selector=>selector==='#story-error'?errorNode:null;
 globalThis.fetch=()=>{calls++;throw new Error('Unexpected request');};
 try{resumeStoryDraft(d.id);await click('approve-outline');assert.equal(calls,0);assert.match(errorNode.textContent,/무지개/);assert.equal(d.stage,'outline_draft');}
 finally{cleanupStoryWorkflow();globalThis.fetch=priorFetch;globalThis.document.querySelector=()=>null;}
});

test('exhausted paid outline retries retain one cumulative failed usage record in the draft',async()=>{
 const d=fixture();d.input.topic='무지개';d.textSettings.providers.openai.proxyEndpoint='https://story-proxy.invalid';d.textSettings.providers.openai.transport='proxy';currentState=state(d);
 const priorFetch=globalThis.fetch;let calls=0;const beforeSaves=saveCount,errorNode={textContent:''};
 globalThis.document.querySelector=selector=>selector==='#story-error'?errorNode:null;
 globalThis.fetch=async()=>{calls++;return Response.json({json:structuredClone(d.outline),usage:{input:20,output:30},costUsd:0.01});};
 try{resumeStoryDraft(d.id);await click('regenerate-outline');const saved=currentState.storyDrafts[d.id];assert.equal(calls,3);assert.equal(saved.usage.calls.length,1);const usage=saved.usage.calls[0];assert.equal(usage.input,60);assert.equal(usage.output,90);assert.equal(usage.costUsd,0.03);assert.equal(usage.failed,true);assert.equal(usage.requests,3);assert.equal(usage.repairAttempts,2);assert.ok(saveCount>beforeSaves);assert.match(errorNode.textContent,/무지개/);}
 finally{cleanupStoryWorkflow();globalThis.fetch=priorFetch;globalThis.document.querySelector=()=>null;}
});

test.after(()=>{cleanupStoryWorkflow();globalThis.document=originalDocument;});

test('R2-1 a compact final header rebuilds the revision workflow from the saved book',async()=>{
 const {syncStoryDraft}=await import('../dist/story-generation/ui.js');
 const d=fixture(),original=structuredClone(d),header={id:d.id,stage:'final',input:d.input,wizard:{step:4},usage:d.usage};
 currentState=state(header);
 const book={id:'revision',storyDraftId:d.id,title:'바람의 길 (수정본)',outline:original.outline,prose:{ko:'유하가 걸어요.',en:'Yuha walks.'},storyInput:original.input,worldSettingsSnapshot:{id:'saved-world',imageEngine:'openai'},textGenerationSettings:original.textSettings,textDemo:true,readingLevelSnapshot:{koreanLevel:'K1',englishLevel:'E0',specs:original.input.specs},pagination:{cover:{title:'원본',sceneAction:'walking'},pages:[{pageNo:1,beatIndex:1,textKo:'옛 글',textEn:'Old.',scene:{settingKey:'home'}}]},sceneBriefs:[{beatIndex:1,pose:'walking'}],pages:[{ko:'유하가 새 길을 걸어요.',en:'Yuha walks.',beatIndex:1,scene:{settingKey:'forest'},staging:{shot:'wide'}}]};
 assert.equal(syncStoryDraft(book,currentState),true);const rebuilt=currentState.storyDrafts[d.id];
 assert.equal(rebuilt.worldSnapshot.id,'saved-world');assert.equal(rebuilt.pagination.pages[0].textKo,book.pages[0].ko);assert.equal(rebuilt.pagination.pages[0].scene.settingKey,'forest');assert.equal(rebuilt.pagination.cover.title,book.title);assert.equal(rebuilt.demo,true);assert.equal(rebuilt.textSettings.engine,'openai');assert.deepEqual(rebuilt.sceneBriefs,book.sceneBriefs);assert.equal(rebuilt.stage,'paged');assert.equal(rebuilt.reviewMode,'pages');
 resumeStoryDraft(d.id);assert.match(html,/쪽 나누기/);assert.match(html,/data-story-page/);assert.doesNotMatch(html,/undefined/);cleanupStoryWorkflow();assert.equal(header.worldSnapshot,undefined,'the original compact header is not mutated');
});
