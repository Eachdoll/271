import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVEL_SPECS,KOREAN_LEVELS,ENGLISH_LEVELS,getLevelSpec,normalizeReadingLevels,
  freezeReadingLevels,recommendEnglishLevel,getLevelPrompt,rewriteAtLevel,
  applyReadingLevels,validateAndRewriteBook,applyReadingFeedback,acceptReadingSuggestion
} from '../dist/reading-levels.js';
import {analyzeBook} from '../dist/reading-checker.js';

const cast=[{id:'hero',name:'유하',nameEn:'Yuha'},{id:'side',name:'초록이',nameEn:'Greenie'}];
const beats=['depart','discover','hello','problem','search','find','share','play','return','sleep'];
const objects=['leaf','moon','stars','rain','home','footprints','glove','water','boots','rainbow','shell','crab','ball'];
const fixture=()=>({id:'test-book',language:'dual',title:'작은 모험',characterSnapshots:structuredClone(cast),
  pages:beats.map((beat,index)=>({ko:'기존 글은 별도 단계예요.',en:'Existing text will be rewritten.',
    scene:{theme:'dinosaur',beat,object:objects[index]},imageUrl:`asset:image-${index}`,artVariant:2}))});
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const counts=text=>text.split(/[.!?]+/).map(s=>s.trim()).filter(Boolean).map(s=>s.split(/\s+/).length);

test('Nine JSON level specs have independent rules, vocabulary, budgets and clearly estimated English scores',()=>{
  assert.deepEqual(KOREAN_LEVELS,['K1','K2','K3','K4']);
  assert.deepEqual(ENGLISH_LEVELS,['E0','E1','E2','E3','E4']);
  for(const id of [...KOREAN_LEVELS,...ENGLISH_LEVELS]) {
    const spec=JSON.parse(JSON.stringify(LEVEL_SPECS[id]));
    for(const key of ['sentencesPerPage','wordsPerSentence','allowedGrammar','vocabList','newWordsPerBook','repetitionPattern','approxAR','approxLexile'])
      assert.ok(Object.hasOwn(spec,key),`${id} ${key}`);
    assert.equal(spec.vocabularyAvailable,!id.startsWith('K'));assert.ok(id.startsWith('K')?spec.vocabList.length===0:spec.vocabList.length>50);
    assert.ok(spec.wordsPerSentence.min<=spec.wordsPerSentence.max);
    assert.ok(spec.maxOutOfVocabRatio>0 && spec.maxOutOfVocabRatio<=0.2);
    assert.equal(id.startsWith('K')?spec.approxLexile:null,null,'Korean is not presented as official English Lexile');
  }
  const cloned=getLevelSpec('E1');cloned.vocabList.push('mutation');
  assert.equal(LEVEL_SPECS.E1.vocabList.includes('mutation'),false);
  assert.throws(()=>getLevelSpec('E8'),/단계/);
});

test('Migration keeps Korean/English defaults separate and maps earlier repeat/short/chapter preferences',()=>{
  assert.deepEqual(normalizeReadingLevels({englishLevel:'short'},{koreanLevel:'K4'}),{koreanLevel:'K4',englishLevel:'E2'});
  assert.equal(normalizeReadingLevels({englishLevel:'chapter'}).englishLevel,'E4');
  assert.deepEqual(normalizeReadingLevels({koreanLevel:'K3',englishLevel:'E0'}),{koreanLevel:'K3',englishLevel:'E0'});
  assert.deepEqual(normalizeReadingLevels({koreanLevel:'K10',englishLevel:'bad'}),{koreanLevel:'K1',englishLevel:'E0'});
  assert.deepEqual(normalizeReadingLevels({defaultKoreanLevel:'K4',defaultEnglishLevel:'E3'}),{koreanLevel:'K4',englishLevel:'E3'});
});

test('SR thresholds produce suggestions without changing settings',()=>{
 const settings={defaultEnglishLevel:'E0'};
 for(const [value,level] of [['','E0'],[0,'E1'],[199,'E1'],[200,'E2'],[449,'E2'],[450,'E3'],[599,'E3'],[600,'E4'],[1600,'E4']]){const result=recommendEnglishLevel(value);assert.equal(result.englishLevel,level);assert.equal(result.requiresParentConfirmation,true);}
 assert.equal(settings.defaultEnglishLevel,'E0');assert.equal(recommendEnglishLevel('invalid'),null);assert.equal(recommendEnglishLevel(-1),null);
});

test('Prompt carries both entire level specs and explicit independent English authorship',()=>{
  const text=getLevelPrompt({koreanLevel:'K4',englishLevel:'E0',characters:cast});
  assert.match(text,/Korean level K4/);assert.match(text,/English level E0/);
  assert.match(text,/Do not translate/);assert.match(text,/"newWordsPerBook"/);
  assert.match(text,/Greenie/);assert.match(text,/never official scores/);
});

test('Every scene beat and object stays within sentence and word ranges at all nine stages',()=>{
  for(const id of [...KOREAN_LEVELS,...ENGLISH_LEVELS]) for(const beat of beats) for(const object of objects) {
    const options={characters:cast,koreanLevel:id.startsWith('K')?id:'K2',englishLevel:id.startsWith('E')?id:'E1'};
    const page=rewriteAtLevel({scene:{beat,object}},options), text=id.startsWith('K')?page.ko:page.en;
    const values=counts(text),spec=LEVEL_SPECS[id];
    assert.equal(values.length,spec.sentencesPerPage,`${id}/${beat}/${object}: ${text}`);
    assert.ok(values.every(n=>n>=spec.wordsPerSentence.min && n<=spec.wordsPerSentence.max),`${id}/${beat}/${object}: ${text}`);
  }
});

test('Independent language stages preserve semantic action and never derive English from Korean input',()=>{
  const initial={scene:{beat:'search',object:'glove'},ko:'어떤 한국어도 번역하지 않아요.',en:'Translate me.'};
  const low=rewriteAtLevel(initial,{koreanLevel:'K1',englishLevel:'E3',characters:cast});
  const high=rewriteAtLevel({...initial,ko:'전혀 다른 한국어 입력.'},{koreanLevel:'K4',englishLevel:'E3',characters:cast});
  assert.equal(low.en,high.en);assert.notEqual(low.ko,high.ko);
  assert.match(low.en,/looked for the little glove/);assert.match(low.ko,/찾아요/);
  const hardEnglish=rewriteAtLevel(initial,{koreanLevel:'K1',englishLevel:'E4',characters:cast});
  assert.equal(low.ko,hardEnglish.ko);assert.notEqual(low.en,hardEnglish.en);
  assert.equal(low.readingRewrite.englishMode,'original-controlled-writing');
  assert.match(high.ko,/초록이/);
  assert.match(low.en,/our friend/);
  const consonant=rewriteAtLevel({scene:{beat:'depart',object:'flower'}},{koreanLevel:'K2',englishLevel:'E1',
    characters:[cast[0],{id:'side',name:'태율',nameEn:'Tayul'}]});
  assert.match(consonant.ko,/태율과/);
});

test('Applying stages freezes book specs and keeps art, scenes, title and input unchanged',()=>{
  const input=freeze(fixture()),output=applyReadingLevels(input,{koreanLevel:'K3',englishLevel:'E2'},cast);
  assert.equal(output.pages.length,input.pages.length);
  assert.equal(output.pages[6].scene.beat,'share');
  assert.equal(output.pages[6].imageUrl,input.pages[6].imageUrl);
  assert.equal(output.title,input.title);
  assert.equal(input.pages[0].en,'Existing text will be rewritten.');
  assert.equal(output.readingLevelSnapshot.specs.en.approxLexile,325);
  output.levelSpec.en.vocabList.push('only-the-book');
  assert.equal(output.readingLevelSnapshot.specs.en.vocabList.includes('only-the-book'),false);
  assert.equal(output.readingEstimate.official,false);
});

test('Validation checks every page first, rewrites only failures, and passes on the second inspection',async()=>{
  const input=freeze(applyReadingLevels(fixture(),{koreanLevel:'K1',englishLevel:'E2'},cast));
  let calls=0;const rewritten=[];
  const analyze=async(book,context)=>{
    calls++;assert.equal(book.pages.length,10);assert.equal(context.specs.en.wordsPerSentence.max,9);
    assert.ok(context.allowedNames.includes('Greenie'));
    return {passed:calls===2,pages:book.pages.map((_,i)=>({pageIndex:i,passed:calls===2||i!==3}))};
  };
  const book=await validateAndRewriteBook(input,{analyze,characters:cast,rewrite:(page,options)=>{rewritten.push(options.index);return rewriteAtLevel(page,options);}});
  assert.equal(calls,2);assert.deepEqual(rewritten,[3]);assert.equal(book.readingCheck.passed,true);
  assert.equal(book.readingCheck.rewriteCount,1);assert.equal(book.readingCheck.history.length,2);
  assert.deepEqual(book.pages[2],input.pages[2]);assert.equal(input.readingCheck,undefined);
});

test('Noncompliant results stop after exactly two retries and remain visibly failed',async()=>{
  let calls=0;
  const book=await validateAndRewriteBook(applyReadingLevels(fixture(),{englishLevel:'E4'},cast),{
    maxRetries:99,analyze:async()=>{calls++;return {passed:false,violations:['Long sentence on page 2']};},characters:cast});
  assert.equal(calls,3);assert.equal(book.readingCheck.attempts,3);
  assert.equal(book.readingCheck.rewriteCount,2);assert.equal(book.readingCheck.passed,false);
  assert.equal(book.readingCheck.status,'needs-review');assert.match(book.readingCheck.message,/범위/);
  assert.deepEqual(book.readingCheck.violations,['Long sentence on page 2']);
});

test('Unavailable analyzer is recorded without useless retries; cancellation stops before analysis or mutation',async()=>{
  let calls=0;
  const unavailable=await validateAndRewriteBook(fixture(),{analyze:async()=>{calls++;throw Error('missing kiwi');}});
  assert.equal(calls,1);assert.equal(unavailable.readingCheck.status,'unavailable');
  assert.equal(unavailable.readingCheck.passed,false);assert.equal(unavailable.readingCheck.rewriteCount,0);
  const controller=new AbortController();controller.abort();
  const input=freeze(fixture());
  await assert.rejects(validateAndRewriteBook(input,{signal:controller.signal,analyze:async()=>{calls++;return {passed:true};}}),{name:'AbortError'});
  assert.equal(calls,1);assert.equal(input.readingCheck,undefined);
  const late=new AbortController();
  await assert.rejects(validateAndRewriteBook(input,{signal:late.signal,analyze:async()=>{late.abort();return {passed:true};}}),{name:'AbortError'});
});

test('A no-retry failure does not claim that two rewrites ran; vocabulary exceptions include only the cast',async()=>{
  const input={...fixture(),characterIds:['hero']};
  const checked=await validateAndRewriteBook(input,{maxRetries:0,characters:cast,analyze:async(_,context)=>{
    assert.deepEqual(context.allowedNames,['유하','Yuha']);return {passed:false};}});
  assert.equal(checked.readingCheck.rewriteCount,0);
  assert.doesNotMatch(checked.readingCheck.message,/재작성 후/);
});

test('Book frozen specs are reused during future validation, independent of changed parent defaults',async()=>{
  const book=applyReadingLevels(fixture(),{koreanLevel:'K1',englishLevel:'E0'},cast);
  book.koreanLevel='K4';book.englishLevel='E4';
  const checked=await validateAndRewriteBook(book,{analyze:async(_,context)=>{
    assert.equal(context.levels.koreanLevel,'K1');assert.equal(context.specs.en.approxLexile,100);return {passed:true};}});
  assert.equal(checked.readingLevelSnapshot.englishLevel,'E0');
});

test('A real vocabulary-guided retry uses the book CSV and preserves the passing English',async()=>{
  const input=applyReadingLevels({...fixture(),pages:[{ko:'',en:'',scene:{beat:'discover',object:'ball'}}]},
    {koreanLevel:'K1',englishLevel:'E0',koVocabulary:['공','보다']},cast);
  input.pages[0].ko='유하가 굉장히 복잡하고 어려운 구조를 관찰합니다.';
  const originalEnglish=input.pages[0].en;
  const calls=[];
  const checked=await validateAndRewriteBook(input,{characters:cast,
    analyze:(book,context)=>analyzeBook(book,context.specs,{allowedNames:context.allowedNames}),
    rewrite:(page,options)=>{calls.push(options);return rewriteAtLevel(page,options);}});
  assert.equal(checked.readingCheck.passed,true);
  assert.equal(checked.pages[0].en,originalEnglish);
  assert.deepEqual(calls[0].failedLanguages,['ko']);
  assert.deepEqual(calls[0].specs.ko.vocabList,['공','보다']);
  assert.equal(calls[0].specs.ko.vocabularyAvailable,true);
  assert.match(checked.pages[0].ko,/공을 보아요/);
  assert.equal(checked.readingCheck.pages[0].ko.metrics.outOfVocabRatio,0);
  assert.notEqual(checked.pages[0].ko,input.pages[0].ko);
});

test('Persistent failure makes two distinct metric-guided retries and keeps its failure visible',async()=>{
  const input=applyReadingLevels({...fixture(),pages:[{ko:'',en:'',scene:{beat:'discover',object:'boat'}}]},
    {koreanLevel:'K1',englishLevel:'E0'},cast);
  input.pages[0].en='I observed the enormous boat from a particularly extraordinary position near the water.';
  const originalKorean=input.pages[0].ko,seen=[];
  const checked=await validateAndRewriteBook(input,{characters:cast,analyze:async book=>{
    seen.push(book.pages[0].en);
    return {passed:false,pages:[{pageIndex:0,passed:false,ko:{passed:true},en:{passed:false,metrics:{sentenceCount:1,wordsPerSentence:[12]}}}],
      violations:[{language:'en',pageIndex:0,code:'sentence-length'}]};
  }});
  assert.equal(seen.length,3);assert.notEqual(seen[0],seen[1]);assert.notEqual(seen[1],seen[2]);
  assert.ok(seen.slice(1).every(text=>/boat/.test(text)),'same scene object is preserved');
  assert.ok(seen.slice(1).every(text=>counts(text).every(count=>count>=4&&count<=8)));
  assert.equal(checked.pages[0].ko,originalKorean);
  assert.equal(checked.readingCheck.status,'needs-review');assert.equal(checked.readingCheck.rewrites,2);
});

test('Adaptive English uses its scene and own text, independent of Korean wording',()=>{
  const options={koreanLevel:'K1',englishLevel:'E0',attempt:1,failedLanguages:['en'],
    specs:{ko:LEVEL_SPECS.K1,en:LEVEL_SPECS.E0},characters:cast,
    pageReport:{en:{metrics:{sentenceCount:1,wordsPerSentence:[11]}}}};
  const page={ko:'전혀 다른 장면의 글이에요.',en:'I observed a little shell while walking near the sea today.',scene:{beat:'discover'}};
  const first=rewriteAtLevel(page,options),second=rewriteAtLevel({...page,ko:'나는 이 문장을 영어로 번역하면 안 돼요.'},options);
  assert.equal(first.en,second.en);assert.match(first.en,/shell/);assert.equal(first.ko,page.ko);
});

test('An older book retains its frozen names when materials are renamed later',async()=>{
  const input={...fixture(),characterIds:['hero','side']};
  const renamed=[{...cast[0],name:'민재',nameEn:'Minjae'},{...cast[1],name:'파랑이',nameEn:'Bluey'}];
  const leveled=applyReadingLevels(input,{koreanLevel:'K2',englishLevel:'E2'},renamed);
  assert.match(leveled.pages[0].ko,/유하가 초록이와/);
  await validateAndRewriteBook(leveled,{characters:renamed,analyze:async(_,context)=>{
    assert.ok(context.allowedNames.includes('Yuha'));assert.ok(context.allowedNames.includes('Greenie'));
    assert.equal(context.allowedNames.includes('Minjae'),false);return {passed:true};}});
});

test('Two matching feedback events only propose a change; parent confirmation changes one default',()=>{
 const initial=freeze({defaultKoreanLevel:'K2',defaultEnglishLevel:'E1',pinHash:'keep'});
 const one=applyReadingFeedback(initial,{language:'ko',feedback:'easy',bookId:'one'});assert.equal(one.defaultKoreanLevel,'K2');assert.equal(one.pendingReadingSuggestions.ko,undefined);
 const two=applyReadingFeedback(one,{language:'ko',feedback:'easy',bookId:'two'});assert.equal(two.defaultKoreanLevel,'K2');assert.equal(two.pendingReadingSuggestions.ko.to,'K3');
 const accepted=acceptReadingSuggestion(two,'ko');assert.equal(accepted.defaultKoreanLevel,'K3');assert.equal(accepted.defaultEnglishLevel,'E1');assert.equal(accepted.pinHash,'keep');assert.equal(accepted.pendingReadingSuggestions.ko,undefined);assert.ok(accepted.readingFeedback.every(event=>event.consumed));
 const mixed=applyReadingFeedback(one,{language:'ko',feedback:'hard'});assert.equal(mixed.pendingReadingSuggestions.ko,undefined);
 const right=applyReadingFeedback(two,{language:'ko',feedback:'just-right'});assert.equal(right.pendingReadingSuggestions.ko,undefined);assert.equal(right.defaultKoreanLevel,'K2');
 assert.equal(initial.readingFeedback,undefined);assert.throws(()=>applyReadingFeedback(initial,{feedback:'unknown'}),/느낌/);
});
