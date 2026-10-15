import test from 'node:test';
import assert from 'node:assert/strict';
import {getLevelSpec} from '../dist/reading-levels.js';
import {generateOutline,generateProse,paginateStory,rewriteBeat,rewriteParagraph,rewriteStoryPage,repairPagination,mergeStoryUsage,normalizeStoryInput,toLegacyPages,summarizeStory} from '../dist/story-generation/pipeline.js';
import {demoOutline} from '../dist/story-generation/demo.js';
import {validateOutline,validatePagination,StoryValidationError} from '../dist/story-generation/schemas.js';

const clone=value=>JSON.parse(JSON.stringify(value));
function input(){return {characters:[{id:'yuha',name:'유하',nameEn:'Yuha',role:'주인공',traits:['소리를 잘 들어요'],relationships:{green:'친구'},catchphrase:'어디서 나는 소리지?'},{id:'green',name:'초록이',role:'친구',kind:'dinosaur'}],backgrounds:[{id:'forest',name:'숲길',description:'나무와 돌이 있는 길'}],worldNotes:'친구들은 소풍 가방을 함께 써요.',topic:'노래하는 돌을 찾아요',pageCount:12,endingType:'home_sleep',specs:{ko:getLevelSpec('K1'),en:getLevelSpec('E0')},variants:[{id:'raincoat',characterId:'yuha',name:'우비'}],variantByCharacter:{yuha:null,green:null},variantPageRanges:{yuha:[{from:1,to:4,variantId:'raincoat'}]}};}
function fixture(){
  const source=input(),outline=demoOutline(source);
  const ko=['유하가 빨간 가방을 메어요.','초록이가 숲길로 먼저 걸어요.','바위가 나무 밑에 보여요.','작은 손이 돌을 두드려요.','개미들이 도시락 속에서 나와요.','공룡이 바위 앞에서 재채기해요.','빈 통이 틈으로 굴러가요.','바람이 통을 후우 불어요.','유하가 소리를 듣고 웃어요.','둘이 나란히 노래를 만들어요.','집으로 돌아가는 발걸음이 가벼워요.','포근한 이불이 아이를 덮어요.'];
  const nouns=['ball','leaf','bird','tree','bag','moon','star','stone','shell','crab','flower','home'],mapping=[1,1,2,2,3,3,4,5,5,6,6,7];
  const pages=ko.map((textKo,i)=>({pageNo:i+1,beatIndex:mapping[i],textKo,textEn:`I see a ${nouns[i]} here.`,scene:{who:['yuha','green'],where:'forest',action:'Yuha carries a red bag beside a tall tree.',emotion:'curious',timeOfDay:i===11?'night':'day',props:['red bag','tree']},variantByCharacter:{yuha:i<4?'raincoat':null,green:null},isRefrainPage:false}));
  const pagination={cover:{title:'바람과 친구들',sceneAction:'Yuha holds a small box beside a forest stone.'},pages};
  const prose={ko:pages.map(p=>p.textKo).join('\n\n'),en:pages.map(p=>p.textEn).join('\n\n'),usedRefrainAt:[]};return {source,outline,pagination,prose};
}
function fake(outputs,{id='openai',actual=false}={}){
  const calls=[];return {id,calls,async complete(req){calls.push(clone({...req,signal:undefined}));const next=typeof outputs==='function'?await outputs(req,calls.length):outputs.shift();if(next instanceof Error)throw next;return {text:JSON.stringify(next),json:clone(next),usage:{input:100,output:50},costUsdEstimated:.002,...(actual?{costUsd:.003}:{}),meta:{modelId:'test-model',apiKey:'must-not-copy'}};}};
}

test('three separate calls use stage temperatures, complete prior original prose and no private media/credentials',async()=>{
  const {source,outline,prose,pagination}=fixture();source.previousStory={id:'prior-book',title:'빨간 가방',prose:{ko:'유하는 초록이에게 가방을 맡겼어요. “내일도 같이 쓰자!”',en:'The red bag belongs to both friends now.'},characters:[{id:'yuha',name:'유하',relationships:{green:'가방을 함께 쓰는 친구'},imageUrl:'data:secret-image',apiKey:'forbidden'}],pages:[{scene:{action:'Yuha gives the red bag to Green.',who:['yuha','green']},imageBlob:'private-image'}]};source.characters[0].imageUrl='data:private-photo';source.characters[0].generationSnapshot={apiKey:'hidden-key'};source.apiKey='parent-private';source.config={apiKey:'config-private'};
  const before=clone(source),engine=fake([outline,prose,pagination]);const a=await generateOutline(source,{engine}),b=await generateProse(a.data,source,{engine}),c=await paginateStory(a.data,b.data,source,{engine,repair:false});
  assert.equal(engine.calls.length,3);assert.deepEqual(engine.calls.map(c=>c.temperature),[.9,.8,.3]);assert.ok(engine.calls.every(c=>c.jsonSchema));
  for(const call of engine.calls){assert.match(call.user,/내일도 같이 쓰자/);assert.match(call.user,/가방을 함께 쓰는 친구/);assert.match(call.system,/ORIGINAL prose/);assert.doesNotMatch(call.user,/private-photo|private-image|parent-private|config-private|hidden-key|forbidden|secret-image/);}
  assert.equal(c.data.pages.length,12);assert.equal(c.meta.checks.passed,true);assert.equal(a.meta.previousBookId,'prior-book');assert.equal(a.meta.usedOriginalPreviousStory,true);assert.doesNotMatch(JSON.stringify(a.meta),/must-not-copy/);assert.deepEqual(source,before);
});

test('editing/re-generating only a beat changes only that beat and the prose sees the edit',async()=>{
  const {source,outline,prose}=fixture(),original=clone(outline),beat={...outline.beats[2],summary:'두 친구가 조약돌 대신 나무 문을 두드려요. 문 안에서 작은 종소리가 나요.'};
  const engine=fake([beat,prose]);const edited=await rewriteBeat(outline,2,source,{engine});
  assert.equal(edited.data.beats[2].summary,beat.summary);assert.deepEqual(edited.data.beats.filter((_,i)=>i!==2),outline.beats.filter((_,i)=>i!==2));assert.deepEqual(outline,original);
  await generateProse(edited.data,source,{engine});assert.match(engine.calls[1].user,/나무 문을 두드려요/);assert.equal(engine.calls[0].jsonSchema.properties.index.type,'integer');
});

test('rewriting one Korean paragraph preserves all other paragraphs and English byte for byte',async()=>{
  const {source,outline,prose}=fixture(),before=clone(prose),engine=fake([{paragraph:'초록이가 작은 가방을 열어요.'}]);
  const result=await rewriteParagraph(prose,'ko',1,outline,source,{engine});assert.equal(result.data.en,prose.en);
  const old=prose.ko.split('\n\n'),next=result.data.ko.split('\n\n');assert.equal(next[1],'초록이가 작은 가방을 열어요.');assert.deepEqual(next.filter((_,i)=>i!==1),old.filter((_,i)=>i!==1));assert.deepEqual(prose,before);
});

test('12 to 16 re-pagination calls only stage three and keeps the original prose',async()=>{
  const {source,outline,prose,pagination}=fixture(),before=clone(prose);source.pageCount=16;
  const expanded=clone(pagination);expanded.pages=Array.from({length:16},(_,i)=>({...clone(pagination.pages[Math.min(i,11)]),pageNo:i+1,beatIndex:[1,1,2,2,3,3,3,4,4,5,5,5,6,6,7,7][i]}));
  const engine=fake([expanded]);const result=await paginateStory(outline,prose,source,{engine,repair:false});assert.equal(engine.calls.length,1);assert.equal(engine.calls[0].temperature,.3);assert.equal(result.data.pages.length,16);assert.deepEqual(prose,before);assert.deepEqual(JSON.parse(engine.calls[0].user).approvedOriginalProse,prose);
});

test('scene-only repair changes only the action and never sends text through a template',async()=>{
  const {source,outline,prose,pagination}=fixture();pagination.pages[5].scene.action='Happy.';const before=clone(pagination),engine=fake([{action:'Green lifts a small stone beside Yuha on the forest path.'}]);
  const result=await repairPagination(outline,prose,pagination,source,{engine});assert.equal(engine.calls.length,1);assert.equal(engine.calls[0].temperature,.3);assert.deepEqual(Object.keys(engine.calls[0].jsonSchema.properties),['action']);assert.equal(result.meta.checks.passed,true);assert.equal(result.meta.repairAttempts,1);
  const expected=clone(before);expected.pages[5].scene.action='Green lifts a small stone beside Yuha on the forest path.';assert.deepEqual(result.data,expected);assert.deepEqual(pagination,before);
});

test('targeted failed language repair preserves passing language, other pages and frozen level rules',async()=>{
  const {source,outline,prose,pagination}=fixture();pagination.pages[2].textKo=pagination.pages[0].textKo;const prior=clone(pagination),good={...clone(pagination.pages[2]),textKo:'바위가 나무 밑에 보여요.',textEn:'Do not keep this engine mistake.'},engine=fake([good]);
  const result=await repairPagination(outline,prose,pagination,source,{engine});assert.equal(engine.calls.length,1);assert.equal(result.data.pages[2].textEn,prior.pages[2].textEn);assert.deepEqual(result.data.pages.filter((_,i)=>i!==2),prior.pages.filter((_,i)=>i!==2));assert.equal(result.meta.checks.passed,true);assert.match(engine.calls[0].user,/sentence/);assert.match(engine.calls[0].user,/K1/);
});

test('automatic repair stops after two attempts and exposes remaining failure badges',async()=>{
  const {source,outline,prose,pagination}=fixture();pagination.pages[4].scene.action='Happy.';const engine=fake(()=>({action:'Happy.'}));const result=await repairPagination(outline,prose,pagination,source,{engine});
  assert.equal(engine.calls.length,2);assert.equal(result.meta.repairAttempts,2);assert.equal(result.meta.requests,engine.calls.length);assert.equal(result.meta.checks.passed,false);assert.deepEqual(result.meta.checks.failedPageNos,[5]);assert.equal(result.meta.checks.checks.length,7);
});

test('structural repairs re-paginate from the original prose instead of rewriting page templates',async()=>{
  const {source,outline,prose,pagination}=fixture(),bad=clone(pagination);bad.pages[8].beatIndex=3;const engine=fake([pagination]);const result=await repairPagination(outline,prose,bad,source,{engine});assert.equal(engine.calls.length,1);assert.equal(engine.calls[0].jsonSchema.properties.pages.type,'array');assert.deepEqual(JSON.parse(engine.calls[0].user).approvedOriginalProse,prose);assert.equal(result.meta.checks.passed,true);
});

test('API failure/cancellation never silently switches to demo',async()=>{
  const source=input(),engine=fake([new Error('provider unavailable')]);await assert.rejects(generateOutline(source,{engine}),/provider unavailable/);assert.equal(engine.calls.length,1);
  const controller=new AbortController();controller.abort();const unused=fake([]);await assert.rejects(generateOutline(source,{engine:unused,signal:controller.signal}),e=>e.name==='AbortError');assert.equal(unused.calls.length,0);
});

test('schemas reject unsupported cast and wardrobe IDs, and allow object-shaped page range IDs',()=>{
  const {source,outline,pagination}=fixture();assert.equal(validateOutline(outline,source).valid,true);assert.equal(validatePagination(pagination,source,outline).valid,true);
  let bad=clone(pagination);bad.pages[0].scene.who.push('invented-friend');assert.equal(validatePagination(bad,source,outline).valid,false);bad=clone(pagination);bad.pages[0].variantByCharacter.yuha='nonexistent-outfit';assert.equal(validatePagination(bad,source,outline).valid,false);
  const malformed=clone(outline);malformed.beats[0].summary='어린이를 때리고 체벌을 해요.';assert.equal(validateOutline(malformed,source).valid,false);
});

test('actual costs exist only if reported, estimates remain separate, and legacy page aliases preserve scene data',()=>{
  const partial=mergeStoryUsage([{usage:{input:10,output:5,costUsdEstimated:.1}},{usage:{input:20,output:8,costUsd:.2,costUsdEstimated:.2}}]);assert.equal(partial.input,30);assert.equal(partial.output,13);assert.ok(Math.abs(partial.costUsdEstimated-.3)<1e-10);assert.equal('costUsd'in partial,false);
  assert.equal(mergeStoryUsage([{usage:{input:1,output:1,costUsd:.2}},{usage:{input:2,output:2,costUsd:.3}}]).costUsd,.5);
  const {source,outline,prose,pagination}=fixture(),pages=toLegacyPages(pagination);assert.equal(pages[0].ko,pages[0].textKo);assert.equal(pages[0].scene.action,pagination.pages[0].scene.action);assert.deepEqual(pages[0].scene.who,['yuha','green']);assert.equal(pages[0].scene.setting,'forest');
  const summary=summarizeStory(outline,{...source,prose,pagination});assert.match(summary,/反|반전/);assert.match(summary,/포근한 이불/);assert.doesNotMatch(summary,/apiKey|endpoint/);
});

test('explicit demo uses an authored causal plot and labels its honest checks, with no API invocation',async()=>{
  const source=input(),a=await generateOutline(source,{engineId:'demo'}),b=await generateProse(a.data,source,{engineId:'demo'}),c=await paginateStory(a.data,b.data,source,{engineId:'demo'});
  assert.equal(a.meta.demo,true);assert.equal(c.meta.engineId,'demo');assert.equal(c.data.pages.length,12);assert.equal(new Set(c.data.pages.map(p=>p.textKo)).size,12);assert.equal(new Set(c.data.pages.map(p=>p.textEn)).size,12);assert.match(a.data.twist,/도시락 통/);assert.equal(c.data.pages[7].beatIndex,a.data.beats.find(b=>b.type==='turn').index);assert.equal(c.data.pages.at(-1).beatIndex,a.data.beats.at(-1).index);assert.equal(c.meta.checks.checks.length,7);assert.equal(c.meta.repairAttempts,0);
});

test('bad engine stage responses fail validation and never become image-ready scene data',async()=>{
  const {source,outline,prose,pagination}=fixture(),bad=clone(pagination);bad.pages[0].scene.who=['injected-unknown-cast'];await assert.rejects(paginateStory(outline,prose,source,{engine:fake([bad])}),StoryValidationError);
  const engine=fake([{index:99,type:'close',summary:'changed',characters:['yuha'],settingKey:'forest'}]);await assert.rejects(rewriteBeat(outline,2,source,{engine}),StoryValidationError);
});


test('expanding a demo to 16 or 24 pages preserves both approved prose word sequences without blank pages',async()=>{
 const source=input(),outline=(await generateOutline(source,{engineId:'demo'})).data,prose=(await generateProse(outline,source,{engineId:'demo'})).data;
 for(const count of [16,24]){const result=await paginateStory(outline,prose,{...source,pageCount:count},{engineId:'demo'});assert.equal(result.data.pages.length,count);for(const language of ['Ko','En']){assert.ok(result.data.pages.every(page=>page['text'+language].trim()));assert.equal(result.data.pages.map(page=>page['text'+language]).join(' ').replace(/\s+/g,' ').trim(),prose[language.toLowerCase()].replace(/\s+/g,' ').trim());}}
});
