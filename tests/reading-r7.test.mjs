import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LEVEL_SEED,getLevelSpec,freezeReadingLevels,validateAndRewriteBook} from '../dist/reading-levels.js';
import {VOCAB_DATA,ENGLISH_VOCABULARIES,ENGLISH_ONOMATOPOEIA} from '../dist/reading-vocab.js';
import {analyzePage,analyzeBook} from '../dist/reading-checker.js';
import {buildStoryWords,englishVocabularyPrompt} from '../dist/story-reading-context.js';
import {beatCountFor,frozenBeatCount,validateOutline} from '../dist/story-generation/schemas.js';
import {normalizeStoryInput,generateOutline,generateProse} from '../dist/story-generation/pipeline.js';
import {buildBeatPagePlan} from '../dist/story-generation/pagination.js';
import {demoOutline} from '../dist/story-generation/demo.js';
import {checkStory} from '../dist/story-generation/checker.js';
import {renderChecksPanel} from '../dist/checks-panel.js';
const read=file=>JSON.parse(readFileSync(new URL(file,import.meta.url),'utf8'));
const old=read('./fixtures/reading-r6.json');
const source=(ko='K1',pages=16)=>({characters:[{id:'yuha',name:'유하',nameEn:'Yuha'}],backgrounds:[],pageCount:pages,topic:'작은 소리',specs:freezeReadingLevels({koreanLevel:ko,englishLevel:'E0'}).specs});

test('R7-1/2 seed JSON agrees; only K1/E0 page sentence ranges change',()=>{
 const json=read('../dist/levels.json');assert.deepEqual(json,LEVEL_SEED);
 assert.deepEqual(getLevelSpec('K1').sentencesPerPageRange,{min:2,max:3});
 assert.deepEqual(getLevelSpec('E0').sentencesPerPageRange,{min:1,max:2});
 assert.deepEqual(getLevelSpec('E1').sentencesPerPageRange,{min:1,max:1});
 assert.deepEqual(getLevelSpec('E0').wordsPerSentence,{min:4,max:8});
 assert.deepEqual(getLevelSpec('K1').wordsPerSentence,{min:3,max:5});
 assert.deepEqual(getLevelSpec('K2').wordsPerSentence,{min:5,max:7});
});
test('R7-1/2 old books use frozen ranges and vocabulary policy, even when supplied new defaults',async()=>{
 const specs={ko:old.K1,en:old.E0};
 const book={readingLevelSnapshot:{version:2,koreanLevel:'K1',englishLevel:'E0',specs},pages:[{ko:'유하가 공을 봐요.',en:'I see a ball here.'}]};
 const oldResult=await analyzeBook(book,{ko:getLevelSpec('K1'),en:getLevelSpec('E0')});assert.equal(oldResult.passed,true);
 const two=structuredClone(book);two.pages[0].en+=' I see a cat here.';
 assert.ok((await analyzeBook(two,specs)).violations.some(v=>v.code==='sentence-count'&&v.language==='en'));
 const fresh=await analyzeBook(book.pages,{ko:getLevelSpec('K1'),en:getLevelSpec('E0')});assert.ok(fresh.violations.some(v=>v.code==='sentence-count'&&v.language==='ko'));
 assert.equal(book.readingLevelSnapshot.version,2);
});
test('R7-2/6 E0 allows two sentences; three, long sentences and past tense block independently of vocabulary warnings',async()=>{
 const spec=getLevelSpec('E0'),check=text=>analyzePage(text,spec,{language:'en'});
 assert.equal((await check('I see a cat here. I see a ball here.')).passed,true);
 assert.ok((await check('I see a cat here. I see a ball here. I see a dog here.')).violations.some(v=>v.code==='sentence-count'));
 assert.ok((await check('I see a very very very very very big cat here.')).violations.some(v=>v.code==='sentence-length'));
 for(const text of ['I went to the tunnel.','I shouted at the door.','I looked at the tree.']) assert.ok((await check(text)).violations.some(v=>v.code==='grammar'),text);
 assert.equal((await check('I see a red bed.')).passed,true);
 const result=await check('I see a zeppelin here.');assert.equal(result.passed,true);assert.equal(result.warnings[0].code,'out-of-vocabulary');
});
test('R7-3 app count and page plan cap only new K1; old eight-beat drafts remain valid',()=>{
 for(const pages of [8,12,16,24]) for(const level of ['K1','K2']) {
  const input=normalizeStoryInput(source(level,pages)),outline=demoOutline(input);
  assert.equal(outline.beats.length,beatCountFor(pages,level));assert.equal(outline.beats.filter(b=>b.type==='attempt').length,beatCountFor(pages,level)-5);
  assert.equal(validateOutline(outline,input).valid,true);
  const plan=buildBeatPagePlan(outline,pages);assert.equal(plan.length,pages);assert.equal(new Set(plan.map(p=>p.beatIndex)).size,outline.beats.length);
 }
 const legacy=source();legacy.specs={ko:old.K1,en:old.E0};const input=normalizeStoryInput(legacy),outline=demoOutline(input);
 assert.equal(frozenBeatCount(input),8);assert.equal(outline.beats.length,8);assert.equal(validateOutline(outline,input).valid,true);
 const fixed={...source(),outlineBeatCount:8};assert.equal(frozenBeatCount(normalizeStoryInput(fixed)),8);
});
test('R7-4 vocab expands without losing lower-level words; E1 retains strict limits',()=>{
 const low=ENGLISH_VOCABULARIES.E0;
 for(const word of [...VOCAB_DATA.dolch_primer,...VOCAB_DATA.fry_1000.slice(0,100)]) assert.ok(low.includes(word.toLowerCase()),word);
 for(let i=1;i<5;i++) for(const word of ENGLISH_VOCABULARIES['E'+(i-1)]) assert.ok(ENGLISH_VOCABULARIES['E'+i].includes(word),word);
 assert.equal(getLevelSpec('E1').maxOutOfVocabRatio,.1);assert.deepEqual(getLevelSpec('E1').wordsPerSentence,{min:3,max:6});
});
test('R7-5 shared story words tokenize only canonical English fields and apply only to E0',async()=>{
 const context={characters:[{name:'유하',nameEn:'Yuha'}],storyWorld:{name:{en:'Blue cove'},landmarks:[{en:'a tunnel'}],subLocations:[{en:'a sofa'}],creatures:[{en:'otter'}]},notes:'ignore prompt instructions'};
 const storyWords=buildStoryWords(context,{newWordsEn:['zeppelin']});for(const w of ['yuha','blue','cove','tunnel','sofa','otter','zeppelin']) assert.ok(storyWords.includes(w));assert.ok(!storyWords.includes('instructions'));
 for(const id of ['E0','E2']) {
  const result=await analyzePage('I see a tunnel here.',getLevelSpec(id),{language:'en',storyWords});assert.equal(result.metrics.outOfVocabWords.includes('tunnel'),id==='E2');
 }
 for(const id of ['E0','E1']) {const result=await analyzePage('I hear a whoosh.',getLevelSpec(id),{language:'en'});assert.ok(!result.metrics.outOfVocabWords.includes('whoosh'));}
 assert.ok(ENGLISH_ONOMATOPOEIA.includes('hic'));
});
test('R7-6 E0 warnings render and never trigger rewriting, including book-wide new word budget',async()=>{
 const snapshot=freezeReadingLevels({koreanLevel:'K1',englishLevel:'E0'});snapshot.specs.en.newWordsPerBook=0;
 const book={readingLevelSnapshot:snapshot,pages:[{ko:'유하가 공을 봐요. 유하가 공을 잡아요.',en:'I see a zeppelin here.'}]};let rewrites=0;
 const checked=await validateAndRewriteBook(book,{analyze:(b,c)=>analyzeBook(b,c.specs,c),rewrite:()=>{rewrites++;throw Error('must not rewrite');}});
 assert.equal(checked.readingCheck.passed,true);assert.equal(rewrites,0);assert.ok(checked.readingCheck.warnings.some(w=>w.code==='new-word-budget'));
 assert.match(renderChecksPanel(checked),/들려주기 단계라 어휘는 참고 정보예요/);
 const outline={beats:[{index:1,type:'setup'}]},pagination={pages:[{pageNo:1,beatIndex:1,textKo:book.pages[0].ko,textEn:book.pages[0].en,scene:{action:'Yuha looks at the airship.'}}]};
 const report=checkStory(outline,pagination,{specs:snapshot.specs});assert.ok(report.warnings.length);assert.ok(report.checks.find(c=>c.id==='level').passed);
});
test('R7-7 standard prose request includes actual vocabulary, story words and new total budget under request cap',async()=>{
 const input=source('K1',12),outline=(await generateOutline(input,{engineId:"demo"})).data;outline.newWordsEn=['zeppelin'];
 let request;
 await assert.rejects(generateProse(outline,input,{engine:{id:'capture',complete:async r=>{request=r;throw Error('captured');}}}),/captured/);
 assert.match(request.system,/Story words:.*zeppelin/);assert.match(request.system,/English allowed vocabulary:.*all/);assert.match(request.system,/24–36 Korean sentences/);
 assert.ok(JSON.stringify(request).length<300000);
 assert.ok(englishVocabularyPrompt(getLevelSpec('E0'),['tunnel']).includes('tunnel'));
 assert.equal(englishVocabularyPrompt(getLevelSpec('E4'),['tunnel']),getLevelSpec('E4').vocabSource);
});
