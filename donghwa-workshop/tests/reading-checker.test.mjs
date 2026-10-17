import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeBook,analyzeEstimatedPage,estimateReadingScore,readabilityMetrics} from '../dist/reading-checker.js';
import {LEVEL_SPECS,applyReadingLevels,validateAndRewriteBook} from '../dist/reading-levels.js';
import {seedState,generateBook,makeOutline} from '../dist/engine.js';
test('JS FK, Revised Spache and Dale-Chall match independently calculated simple text',()=>{
 const result=readabilityMetrics('I see a cat.');assert.equal(result.fkGrade,-2.23);assert.equal(result.spache,1.14);assert.equal(result.daleChall,.2);
 const harder=readabilityMetrics('I encountered an extraordinary predicament.');assert.ok(harder.daleChall>result.daleChall);assert.ok(harder.spache>result.spache);
});
test('All 20 level combinations pass a full 12-page story without network',async()=>{
 const state=seedState(),old=globalThis.fetch;globalThis.fetch=()=>{throw Error('Unexpected network');};
 try{for(const koreanLevel of ['K1','K2','K3','K4'])for(const englishLevel of ['E0','E1','E2','E3','E4']){
 const options={koreanLevel,englishLevel,characterIds:['yuha','greenie'],topic:'공룡 친구와 소풍',pageCount:12};const input=applyReadingLevels(generateBook(options,makeOutline(options,state.characters),state.characters),options,state.characters);
 const checked=await validateAndRewriteBook(input,{characters:state.characters,analyze:(book,context)=>analyzeBook(book,context.specs,{allowedNames:context.allowedNames})});assert.equal(checked.readingCheck.passed,true,`${koreanLevel}/${englishLevel}`);assert.equal(checked.readingCheck.pages[0].ko.metrics.vocabularySkipped,true);assert.ok(Number.isFinite(checked.readingCheck.pages[0].en.metrics.spache));assert.ok(Number.isFinite(checked.readingCheck.pages[0].en.metrics.daleChall));
 }}finally{globalThis.fetch=old;}
});
test('Missing Korean vocabulary skips only vocabulary; uploaded words detect departures',()=>{
 const spec=LEVEL_SPECS.K1,text='유하가 공을 봐요.';assert.equal(analyzeEstimatedPage(text,spec,{language:'ko'}).metrics.outOfVocabRatio,null);
 const checked=analyzeEstimatedPage(text,spec,{language:'ko',koVocabulary:['보다','봐요'],allowedNames:['유하']});assert.equal(checked.passed,false);assert.ok(checked.violations.some(issue=>issue.code==='out-of-vocabulary'));
});
test('Long sentences and book-wide new word budgets remain visible',async()=>{
 const spec={...LEVEL_SPECS.E1,newWordsPerBook:1,maxOutOfVocabRatio:1};const result=await analyzeBook([{ko:'아이가 공을 봐요.',en:'I see a zebra here.'},{ko:'아이가 공을 봐요.',en:'I see an elephant here.'}],{ko:LEVEL_SPECS.K1,en:spec});assert.ok(result.violations.some(issue=>issue.code==='new-word-budget'));
 const long=analyzeEstimatedPage('I unexpectedly encountered a spectacularly complicated predicament that required extraordinary concentration.',LEVEL_SPECS.E0);assert.equal(long.passed,false);assert.ok(long.violations.some(issue=>issue.code==='sentence-length'));
});
test('Scores are based on English text and nonofficial; abort stops analysis',async()=>{
 const short=estimateReadingScore([{en:'I see a cat.'}]),long=estimateReadingScore([{en:'We carefully considered the extraordinary consequences while examining every available possibility.'}]);assert.ok(long.approxLexile>short.approxLexile);assert.equal(long.official,false);
 const controller=new AbortController();controller.abort();await assert.rejects(analyzeBook([],{ko:LEVEL_SPECS.K1,en:LEVEL_SPECS.E0},{signal:controller.signal}),{name:'AbortError'});
});
