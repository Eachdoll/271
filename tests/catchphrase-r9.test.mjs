import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';
import {readStoredLibrary,validateStoredLibrary} from '../dist/library-storage.js';
import {inputFromWizard} from '../dist/story-generation/ui.js';
import {normalizeStoryInput,generateOutline,inspectStory} from '../dist/story-generation/pipeline.js';
import {checkStory,catchphrasePolicyFor,omitCatchphrases,storyCatchphrases,characterCatchphrase} from '../dist/story-generation/checker.js';
import {collectBookChecks,renderChecksPanel} from '../dist/checks-panel.js';
import {suggestCompanions} from '../dist/companions.js';
import {sharesCore} from '../dist/story-quality/dist/catchphrase.js';
import {getLevelSpec} from '../dist/reading-levels.js';

const clone=value=>JSON.parse(JSON.stringify(value));
const wizard={characterIds:['yuha','greenie'],backgroundIds:[],topic:'작은 바람',pageCount:12,koreanLevel:'K1',englishLevel:'E0',storyDate:'2026-10-18T09:00:00.000Z'};
function approvedBook(id,approvedAt,texts,characterIds=['yuha','greenie']){
 return {id,approved:true,approvedAt,createdAt:approvedAt,characterIds,pages:texts.map((ko,i)=>({pageNo:i+1,ko,en:'Yuha walks.'}))};
}
function legacyState(){
 const state=seedState();migrateWorldState(state);
 state.characters.find(c=>c.id==='yuha').catchphrase='같이 가자!';
 return state;
}

test('R9-A2 new installs get four different default catchphrases; suggested companions differ too',()=>{
 const byId=Object.fromEntries(seedState().characters.map(c=>[c.id,c.catchphrase]));
 assert.deepEqual(byId,{yuha:'내가 먼저 해 볼래!',greenie:'쿵쿵, 냠냠!',toto:'사뿐사뿐!',mom:'천천히 해도 괜찮아.'});
 const phrases=Object.values(byId);
 for(let i=0;i<phrases.length;i++)for(let j=i+1;j<phrases.length;j++)assert.equal(sharesCore(phrases[i],phrases[j]),false,`${phrases[i]} / ${phrases[j]}`);
 for(const phrase of phrases)assert.equal(sharesCore(phrase,'같이 가자!'),false,phrase);
 const companions=suggestCompanions('달에 놀러 가는 이야기').map(c=>c.catchphrase);
 assert.equal(new Set(companions).size,companions.length);
 assert.ok(!companions.includes('우리 함께 해 보자!'));
});

test('R9-A2 a saved library with 유하 "같이 가자!" loads unchanged (no migration of user characters)',()=>{
 const saved=legacyState(),raw=JSON.stringify(saved);
 const storage={getItem:()=>raw,setItem:()=>assert.fail('reading must not write')};
 const loaded=readStoredLibrary(storage,'donghwa',{validate:validateStoredLibrary,seed:seedState});
 assert.equal(loaded.kind,'ready');
 assert.equal(loaded.state.characters.find(c=>c.id==='yuha').catchphrase,'같이 가자!');
 assert.deepEqual(loaded.state.characters,saved.characters);
});

test('R9-A1 rotation omits a catchphrase used in one of the protagonist\'s two latest approved books and freezes it in the input',()=>{
 const state=legacyState(),before=clone(state.characters);
 state.books.unshift(
  approvedBook('book-new','2026-10-17T09:00:00.000Z',['유하가 바람을 봐요.','유하가 웃어요.']),
  approvedBook('book-mid','2026-10-16T09:00:00.000Z',['유하가 "같이 가자!" 하고 뛰어요.','초록이가 따라와요.']),
  approvedBook('book-old','2026-10-15T09:00:00.000Z',['쿵쿵, 냠냠! 초록이가 웃어요.']),
  approvedBook('book-other','2026-10-18T08:00:00.000Z',['같이 가자! 쿵쿵, 냠냠!'],['greenie','yuha']),
  {...approvedBook('book-unapproved','2026-10-18T07:00:00.000Z',['같이 가자!']),approved:false},
 );
 const prepared=inputFromWizard(state,wizard),policy=prepared.input.catchphrasePolicy;
 assert.deepEqual(policy,{version:1,limit:1,omit:['yuha'],phrases:{yuha:'같이 가자!',greenie:'쿵쿵, 냠냠!'},recentBookIds:['book-new','book-mid']});
 const [yuha,greenie]=prepared.input.characters;
 for(const key of ['catchphrase','speechHabit','vocalHabit'])assert.ok(!(key in yuha),key);
 assert.equal(greenie.catchphrase,'쿵쿵, 냠냠!');
 // The saved characters themselves are untouched.
 assert.deepEqual(state.characters,before);
 // Normalisation keeps the frozen decision verbatim and is idempotent.
 const normalized=normalizeStoryInput(prepared.input);
 assert.deepEqual(normalized.catchphrasePolicy,policy);
 assert.deepEqual(normalizeStoryInput(normalized),normalized);
 assert.ok(!('catchphrase' in normalized.characters[0]));
 assert.deepEqual(storyCatchphrases(normalized),['쿵쿵, 냠냠!','같이 가자!']);
 // A later approved book does not rewrite the decision already frozen in this input.
 state.books.unshift(approvedBook('book-latest','2026-10-19T09:00:00.000Z',['쿵쿵, 냠냠!']));
 assert.deepEqual(normalizeStoryInput(prepared.input).catchphrasePolicy,policy);
 assert.deepEqual(inputFromWizard(state,wizard).input.catchphrasePolicy.omit,['greenie']);
});

test('R9-A1 no recent use keeps the catchphrase in the prompt with the once-per-book limit',()=>{
 const state=legacyState();
 const prepared=inputFromWizard(state,wizard);
 assert.deepEqual(prepared.input.catchphrasePolicy.omit,[]);
 assert.equal(prepared.input.characters[0].catchphrase,'같이 가자!');
 assert.deepEqual(catchphrasePolicyFor([],[]),{version:1,limit:1,omit:[],phrases:{},recentBookIds:[]});
 assert.equal(characterCatchphrase({speechHabit:'음음'}),'음음');
 const stripped=omitCatchphrases([{id:'a',catchphrase:'x',speechHabit:'y',vocalHabit:'z',name:'A'},{id:'b',catchphrase:'q'}],{omit:['a']});
 assert.deepEqual(stripped,[{id:'a',name:'A'},{id:'b',catchphrase:'q'}]);
});

test('R9-A1 general path: the system prompt limits catchphrases and the model never sees an omitted phrase',async()=>{
 const state=legacyState();
 state.books.unshift(approvedBook('book-mid','2026-10-16T09:00:00.000Z',['유하가 "같이 가자!" 해요.']));
 const prepared=inputFromWizard(state,wizard);prepared.input.storyQuality={enabled:false};
 const requests=[];const engine={id:'fake',async complete(request){requests.push(request);return {text:'not json',usage:{input:0,output:0}};}};
 await assert.rejects(generateOutline(prepared.input,{engine}));
 assert.ok(requests.length>=1);
 for(const request of requests){
  assert.match(request.system,/CATCHPHRASES: Use each character's catchphrase at most once in the whole book, or not at all\./);
  assert.doesNotMatch(request.system+request.user,/같이 가자/);
  const sent=JSON.parse(request.user).input;
  assert.deepEqual(sent.catchphrasePolicy,{limit:1,omit:['yuha']});
  assert.ok(!('catchphrase' in sent.characters[0]));
 }
 // An existing draft without a policy sends the same input shape as before.
 const legacy=clone(prepared.input);delete legacy.catchphrasePolicy;legacy.characters[0].catchphrase='같이 가자!';
 const normalized=normalizeStoryInput(legacy);
 assert.ok(!('catchphrasePolicy' in normalized));
 assert.equal(normalized.characters[0].catchphrase,'같이 가자!');
 requests.length=0;await assert.rejects(generateOutline(legacy,{engine}));
 assert.ok(!('catchphrasePolicy' in JSON.parse(requests[0].user).input));
});

function pagination(texts){
 return {koreanLevel:'K1',englishLevel:'E0',pages:texts.map((ko,i)=>({pageNo:i+1,beatIndex:Math.min(7,i+1),textKo:ko,textEn:`Yuha sees leaf ${i+1}.`,scene:{action:'Yuha holds a small green leaf near the open garden gate today'}}))};
}
const outline={beats:[1,2,3,4,5,6,7].map(index=>({index,type:'setup',summary:'유하'})),refrain:{text:'토독토독 비가 와요.',usedAtBeats:[2,4]}};
const specs={ko:getLevelSpec('K1'),en:getLevelSpec('E0')};

test('R9-A3 checkStory reports a repeated catchphrase as a non-blocking warning only',()=>{
 const texts=['유하가 "같이 가자!" 해요.','초록이가 웃어요.','유하가 "같이 가!" 외쳐요.','유하가 같이 가방을 메요.','유하가 같이 가자고 했어요.','유하가 "같이 가자!" 해요.','토토가 봐요.','엄마가 와요.'];
 const plain=checkStory(outline,pagination(texts),{specs,allowedNames:['유하','초록이','토토','엄마']});
 const flagged=checkStory(outline,pagination(texts),{specs,allowedNames:['유하','초록이','토토','엄마'],catchphrases:['같이 가자!']});
 assert.equal(flagged.checks.length,7);
 for(const key of ['passed','checks','violations','failedPageNos','needsRepagination'])assert.deepEqual(flagged[key],plain[key],key);
 const extra=flagged.warnings.filter(w=>w.code==='catchphrase-repeat');
 assert.equal(extra.length,1);
 assert.deepEqual({language:extra[0].language,pages:extra[0].pages,pageNo:extra[0].pageNo,count:extra[0].count,severity:extra[0].severity},{language:'ko',pages:[1,3,6],pageNo:3,count:3,severity:'warning'});
 assert.match(extra[0].message,/말버릇 "같이 가자!"이\(가\) 3번 나와요\(1·3·6쪽\)/);
 assert.deepEqual(flagged.warnings.filter(w=>w.code!=='catchphrase-repeat'),plain.warnings);
 const once=checkStory(outline,pagination(['유하가 "같이 가자!" 해요.','유하가 같이 가방을 메요.']),{specs,catchphrases:['같이 가자!']});
 assert.ok(!once.warnings.some(w=>w.code==='catchphrase-repeat'));
});

test('R9-A3 inspectStory uses the cast and frozen omitted phrases; the checks panel shows it as advisory',()=>{
 const input={characters:[{id:'yuha',name:'유하'},{id:'greenie',name:'초록이',catchphrase:'쿵쿵, 냠냠!'}],catchphrasePolicy:{version:1,limit:1,omit:['yuha'],phrases:{yuha:'같이 가자!'},recentBookIds:[]},specs,pageCount:3};
 const report=inspectStory(outline,pagination(['같이 가자!','쿵쿵, 냠냠! 쿵쿵 냠냠','같이 가!']),input);
 assert.deepEqual(report.warnings.filter(w=>w.code==='catchphrase-repeat').map(w=>[w.phrase,w.count]),[['쿵쿵, 냠냠!',2],['같이 가자!',2]]);
 assert.ok(!report.violations.some(v=>/말버릇/.test(v.message)));
 const book={pages:[{},{},{}],storyCheck:report};
 const groups=Object.fromEntries(collectBookChecks(book).map(group=>[group.id,group.items]));
 assert.ok(!groups.reading.some(item=>item.code==='catchphrase-repeat'));
 const events=groups.events.filter(item=>item.code==='catchphrase-repeat');
 assert.equal(events.length,2);assert.ok(events.every(item=>item.severity==='warning'));
 const html=renderChecksPanel(book,{tab:'events'});
 assert.match(html,/check-advisory"><span>확인 권장 · 한글 말버릇 &quot;쿵쿵, 냠냠!&quot;이\(가\) 2번 나와요\(2쪽\)/);
 assert.doesNotMatch(html,/check-blocked/);
});

test('R9-A service worker precaches the shared catchphrase module under the v28 shell',()=>{
 const sw=readFileSync(new URL('../dist/sw.js',import.meta.url),'utf8');
 // v28 shipped the catchphrase module; later shells (R9-B2 v29) keep precaching it.
 assert.ok(Number(sw.match(/const CACHE = "donghwa-shell-v(\d+)";/)?.[1])>=28);
 assert.ok(sw.includes('"./story-quality/dist/catchphrase.js"'));
});

// ---- R9 수정(FIX-A) ----

test('R9 fix: new drafts always freeze a catchphrase policy, even with nothing to rotate or no catchphrase at all',()=>{
 const state=legacyState();
 for(const character of state.characters){delete character.catchphrase;delete character.speechHabit;delete character.vocalHabit;}
 const prepared=inputFromWizard(state,wizard),{recentBookIds,...policy}=prepared.input.catchphrasePolicy;
 assert.deepEqual(policy,{version:1,limit:1,omit:[],phrases:{}});assert.ok(Array.isArray(recentBookIds));
 assert.deepEqual(normalizeStoryInput(prepared.input).catchphrasePolicy,prepared.input.catchphrasePolicy);
});

test('R9 fix: checkStory takes the frozen storyInput for the advisory, and the editor syncDraft passes it',()=>{
 const input={characters:[{id:'yuha',name:'유하',catchphrase:'같이 가자!'}],catchphrasePolicy:{version:1,limit:1,omit:[],phrases:{yuha:'같이 가자!'},recentBookIds:[]}};
 const pages=pagination(['같이 가자!','유하가 웃어요.','같이 가!']);
 const viaInput=checkStory(outline,pages,{specs,storyInput:input}),viaList=checkStory(outline,pages,{specs,catchphrases:storyCatchphrases(input)});
 assert.deepEqual(viaInput,viaList);assert.equal(viaInput.warnings.filter(w=>w.code==='catchphrase-repeat').length,1);
 // The editor's page edit (syncDraft) rechecks with the frozen story input, so the advisory survives every edit.
 const app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
 assert.match(app,/draft\.storyCheck = checkStory\(draft\.outline, draft\.pagination, \{\n\s+storyInput: draft\.storyInput,\n\s+specs: draft\.readingLevelSnapshot\.specs,/);
});

import {configureStoryUI,resumeStoryDraft,cleanupStoryWorkflow} from '../dist/story-generation/ui.js';
import {demoOutline,demoProse,demoPagination} from '../dist/story-generation/demo.js';
import {demoPlotContract} from '../dist/story-generation/plot-contract.js';
const storyUI={ready:[],error:{textContent:''},handlers:{}};
function configureUI(state){
 globalThis.document={addEventListener:(type,handler)=>{storyUI.handlers[type]=handler;},querySelectorAll:()=>[],querySelector:selector=>selector==='#story-accept-failures'?{checked:true}:selector==='#story-error'?storyUI.error:null};
 configureStoryUI({getState:()=>state,isParent:()=>true,protectedAction:fn=>fn(),save:()=>true,render:()=>{},toast:()=>{},modalHeader:title=>`<h2>${title}</h2>`,showModal:()=>{},closeModal:()=>{},onReady:async payload=>{storyUI.ready.push(payload);}});
}
const clickStory=async action=>await storyUI.handlers.click({target:{closest:()=>({dataset:{storyAction:action}})},preventDefault:()=>{}});
function wizardDraft(pageCount=12){
 const input={characters:[{id:'yuha',name:'유하',nameEn:'Yuha',catchphrase:'같이 가자!'},{id:'green',name:'그린이',nameEn:'Green'}],backgrounds:[{id:'home',name:'유하의 집',type:'home'},{id:'forest',name:'숲길'},{id:'garden',name:'작은 정원'}],topic:'바람 피리',pageCount:12,endingType:'home_sleep',specs,variants:[],catchphrasePolicy:{version:1,limit:1,omit:[],phrases:{yuha:'같이 가자!'},recentBookIds:[]}};
 const outline=demoOutline(input);outline.plotContract=demoPlotContract(outline,input);
 const prose=demoProse(outline,input),pagination=demoPagination(outline,prose,input);
 pagination.pages=pagination.pages.slice(0,pageCount);
 for(const index of [0,2]){const page=pagination.pages[index];page.textKo=`${page.textKo} 유하가 "같이 가자!" 해요.`;}
 const textSettings={engine:'openai',providers:{openai:{model:'gpt-6-astra',proxyEndpoint:'https://story-proxy.invalid',transport:'proxy'}},hybrid:{enabled:false},storyEnrichment:false};
 const draft={id:'r9-wizard-draft',bookId:'r9-wizard-book',wizard:{},input,outline,prose,pagination,textSettings,worldSnapshot:{imageEngine:'openai'},readingLevels:{specs},usage:{calls:[]},stage:'paged',reviewMode:'pages',demo:true};
 return {draft,state:{settings:{textGeneration:textSettings},backgrounds:input.backgrounds,storyDrafts:{[draft.id]:draft}}};
}

test('R9 fix: a wizard-approved draft keeps the catchphrase-repeat advisory in its storyCheck (approve-pages and fit-page-count)',async()=>{
 const priorDocument=globalThis.document;
 try{
  const {draft,state}=wizardDraft();configureUI(state);storyUI.ready.length=0;
  resumeStoryDraft(draft.id);await clickStory('approve-pages');
  assert.equal(storyUI.ready.length,1,storyUI.error.textContent);
  const payload=storyUI.ready[0],advisory=payload.storyCheck.warnings.filter(w=>w.code==='catchphrase-repeat');
  assert.deepEqual(advisory.map(w=>[w.language,w.phrase,w.count,w.pages]),[['ko','같이 가자!',2,[1,3]]]);
  assert.equal(payload.storyCheck.checks.length,7);
  cleanupStoryWorkflow();

  const short=wizardDraft(11);configureUI(short.state);
  resumeStoryDraft(short.draft.id);await clickStory('fit-page-count');
  const fitted=short.state.storyDrafts[short.draft.id];
  assert.equal(fitted.pagination.pages.length,12);
  assert.ok(fitted.storyCheck.warnings.some(w=>w.code==='catchphrase-repeat'&&w.phrase==='같이 가자!'),JSON.stringify(fitted.storyCheck.warnings));
 }finally{cleanupStoryWorkflow();globalThis.document=priorDocument;}
});

/**
 * Pre-R9 byte identity for drafts frozen without a catchphrase policy: the same
 * legacy input goes through the real app pipeline (quality outline incl. its
 * fix pass, scene briefs, two-pass quality prose, and the plain outline path)
 * and every request sent to the engine is recorded. The pinned hash is this
 * function run against commit 873bc2e. To compare directly with a checkout:
 * PRE_R9_APP_ROOT=/abs/path/to/873bc2e/donghwa-workshop node --test tests/catchphrase-r9.test.mjs
 */
async function legacyAppRequests(rootUrl){
 const load=path=>import(new URL(path,rootUrl).href);
 const pipeline=await load('dist/story-generation/pipeline.js'),{getLevelSpec:level}=await load('dist/reading-levels.js'),{demoPlotContract:contract}=await load('dist/story-generation/plot-contract.js'),{BEAT_COUNTS}=await load('dist/story-generation/schemas.js'),{demoSceneBriefs}=await load('dist/story-generation/scene-briefs.js');
 const input={bookId:'r8-legacy-draft',storyDate:'2026-10-17T02:00:00.000Z',topic:'바람 찾기',characters:[{id:'yuha',name:'유하',nameEn:'Yuha',traits:['씩씩함'],catchphrase:'같이 가자!'},{id:'green',name:'그린이',nameEn:'Green',catchphrase:'쿵쿵, 냠냠!'}],backgrounds:[{id:'home',type:'home',name:'유하의 집'},{id:'garden',name:'꽃 정원'},{id:'pond',name:'연못 길'}],pageCount:12,endingType:'home_sleep',specs:{ko:level('K1'),en:level('E0')},storyQuality:{enabled:true,useBeamSearch:false,twoPass:true,patternId:'journey_repeat',approvedBooks:[]}};
 const requests=[],priorFetch=globalThis.fetch;let outline;
 globalThis.fetch=async url=>new Response(readFileSync(url,'utf8'),{headers:{'Content-Type':'application/json'}});
 const engine={id:'openai',async complete(request){
  requests.push({system:request.system,user:request.user,jsonSchema:request.jsonSchema??null,temperature:request.temperature??null,maxTokens:request.maxTokens??null});
  const schema=request.jsonSchema;let json;
  if(request.user.startsWith('아래 줄거리 JSON에서')){json=JSON.parse(request.user.split('\n\n').at(-1));json.beats[2].newElement='고친 젖은 잎';}
  else if(schema?.properties?.plan){
   const planted=request.user.match(/- 심을 물건: (.*?) —/u)?.[1],creature=request.user.match(/- 배경 생물: (.*?) \(/u)?.[1],reasons=[...request.user.matchAll(/\d차 (잘못된 장소|잘못된 방법|거의 됐는데 방해)/gu)].map(match=>({'잘못된 장소':'wrong_place','잘못된 방법':'wrong_method','거의 됐는데 방해':'interrupted'})[match[1]]);
   const count=BEAT_COUNTS[input.pageCount],types=['setup','want',...Array.from({length:count-5},()=>'attempt'),'turn','resolution','close'],places=types.map((_,index)=>index===0||index===count-1?'home':index%2?'garden':'pond');let attempt=0;
   json={plan:{pattern:schema.properties.plan.properties.pattern.enum[0],planted,twistReveal:'앞에서 살펴본 물건을 다시 이용해요.',funnyMoment:'바람에 잎이 코에 앉아요.',failureReasons:reasons},titleCandidates:['빗방울의 흔적','바람을 듣는 날','작은 잎의 소리'],logline:'유하와 그린이가 비 오는 날 빗방울의 흔적을 찾아요.',want:'빗방울의 소리를 찾고 싶어요.',problem:'바람 때문에 소리의 위치가 달라져요.',twist:'앞에서 살펴본 물건이 바람을 받아 소리를 냈어요.',beats:types.map((type,index)=>({index:index+1,type,summary:`${index%2?'그린이가':'유하가'} ${['집에서','정원에서','연못에서','돌 옆에서','길에서','집 앞에서','방에서'][index]} ${input.topic}의 흔적을 살펴요. 유하와 그린이가 ${type==='setup'||type==='turn'?planted:'작은 잎'}을 보며 ${type==='turn'?creature:'바람'}의 소리를 들어요.${index===1||index===3?' 유하가 "같이 가자!" 해요.':''}`,characters:['yuha','green'],settingKey:places[index],newElement:index===2?'':`${index+1}번째 젖은 잎`,failureReason:type==='attempt'?reasons[attempt++]:null})),settings:places.map((backgroundId,index)=>({beatIndex:index+1,backgroundId})),emotionArc:types.map(()=>'궁금'),newWordsKo:['빗방울','흔적','바람'],newWordsEn:['rain','leaf','wind'],endingType:'home_sleep'};
   json.plotContract=contract(json,input);
  }else if(schema?.properties?.briefs)json={briefs:demoSceneBriefs(outline,input)};
  else if(!schema){const lang=/return English plain/u.test(request.system)?'en':'ko';return {text:outline.beats.map(beat=>`${lang==='ko'?'[비트':'[Beat'} ${beat.index} · ${beat.type}] ${lang==='ko'?`유하가 ${beat.index}번째 작은 잎을 만져요. 그린이가 “나는 바람을 들어요.”라고 말해요.`:`Yuha sees a small leaf near tree ${beat.index}. Green says, “I hear the wind.”`}`).join('\n\n'),usage:{input:1,output:1},meta:{requests:1}};}
  else throw new Error('unhandled legacy mock schema');
  return {json,text:JSON.stringify(json),usage:{input:1,output:1},meta:{requests:1}};
 }};
 try{
  const a=await pipeline.generateOutline(clone(input),{engine});outline=a.data;
  const b=await pipeline.generateSceneBriefs(outline,clone(input),{engine});
  await pipeline.generateProse(outline,clone(input),{engine,sceneBriefs:b.data});
  const plain=clone(input);plain.storyQuality={enabled:false};
  await pipeline.generateOutline(plain,{engine:{id:'openai',async complete(request){requests.push({system:request.system,user:request.user,jsonSchema:request.jsonSchema??null,temperature:request.temperature??null,maxTokens:request.maxTokens??null});return {text:'not json',usage:{input:0,output:0}};}}}).catch(()=>{});
 }finally{globalThis.fetch=priorFetch;}
 return requests;
}
const PRE_R9_APP_REQUESTS_SHA256='2c0b9c8c0508eb26b00c783187447cbf8a0914ec2d19d707bab52f0002d28f48';

test('R9 fix: a draft without a catchphrase policy sends byte-identical pre-R9 requests through the real app pipeline',async()=>{
 const requests=await legacyAppRequests(new URL('../',import.meta.url));
 assert.ok(requests.some(request=>request.user.startsWith('아래 줄거리 JSON에서')),'the quality fix pass is part of the snapshot');
 // quality outline + its fix pass, scene briefs, rich/simplify × ko/en, three plain outline attempts
 assert.equal(requests.length,1+1+1+4+3);
 for(const request of requests)assert.doesNotMatch(`${request.system}\n${request.user}`,/CATCHPHRASE|catchphrase at most once|최대 1번|말버릇은 책 전체|catchphrasePolicy/);
 if(process.env.PRE_R9_APP_ROOT){
  const expected=await legacyAppRequests(pathToFileURL(`${process.env.PRE_R9_APP_ROOT.replace(/\/$/,'')}/`));
  console.log(`pre-R9 app requests sha256 ${createHash('sha256').update(JSON.stringify(expected)).digest('hex')} (${expected.length} requests)`);
  assert.deepEqual(requests,expected);
 }
 assert.equal(createHash('sha256').update(JSON.stringify(requests)).digest('hex'),PRE_R9_APP_REQUESTS_SHA256);
});
