import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
 assert.match(sw,/const CACHE = "donghwa-shell-v28";/);
 assert.ok(sw.includes('"./story-quality/dist/catchphrase.js"'));
});
