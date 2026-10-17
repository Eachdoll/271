import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {splitSentences} from '../dist/util.js';
import {countSentences,writeRichThenSimplify} from '../dist/richThenSimplify.js';
const cases=JSON.parse(readFileSync(new URL('./fixtures/sentence-cases.json',import.meta.url),'utf8'));
test('R8-2 package uses the same sentence cases as app including closing quotes and labels',()=>{
 for(const item of cases) {assert.deepEqual(splitSentences(item.text),item.sentences,item.text);assert.equal(countSentences(item.text),item.sentences.length);}
});
test('R8-1/4 E0 compression is bounded to one call, preserves labels and explicitly requests says through both passes',async()=>{
 for(const twoPass of [true,false]) {
  const calls=[],long='[Beat 1 · setup] '+Array(12).fill('“I see a cat!”').join(' '),short='[Beat 1 · setup] I see a cat.';
  const engine={id:'mock',complete:async request=>{calls.push(request);return {text:calls.length===(twoPass?3:2)?short:long,usage:{input:1,output:1},costUsd:0};}};
  const result=await writeRichThenSimplify({engine,lang:'en',twoPass,presentTenseOnly:true,charactersCompact:'Yuha',beatsCompact:'1 setup',briefsCompact:'[]',emotions:[],gestureDict:{emotions:[],moral_tails_ko:[]},targetLevel:{label:'E0',sentencesPerPage:[1,2],wordsPerSentence:[4,8],grammar:['present tense only']},richLevel:{label:'E2',sentencesPerPage:[1,2],wordsPerSentence:[5,9]},pageCount:1,condenseOverBudget:true});
  assert.equal(result.condensed,true);assert.equal(result.sentenceCount,1);assert.equal(calls.length,twoPass?3:2);
  for(const request of calls.slice(1)) assert.match(request.system+'\n'+request.user,/Use says, not said\. Use present tense for every narration sentence\./);
 }
});
