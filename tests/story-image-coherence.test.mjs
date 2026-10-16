import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {getLevelSpec} from '../dist/reading-levels.js';
import {demoOutline,demoProse,demoPagination} from '../dist/story-generation/demo.js';
import {demoPlotContract} from '../dist/story-generation/plot-contract.js';
import {coherenceFingerprint} from '../dist/story-generation/coherence.js';
import {ensureBookStoryCoherence,currentBookPagination} from '../dist/story-generation/book-coherence.js';
import {toLegacyPages} from '../dist/story-generation/pipeline.js';
import {generateScene,generateCover} from '../dist/image-generation/pipeline.js';

function fixture(){
  const state=seedState(),input={characters:[{id:'yuha',name:'유하',nameEn:'Yuha'}],backgrounds:[{id:'home',type:'home',name:'집'},{id:'forest',name:'숲길'},{id:'garden',name:'정원'}],pageCount:12,topic:'바람 피리',specs:{ko:getLevelSpec('K1'),en:getLevelSpec('E0')},endingType:'home_sleep'};
  const outline=demoOutline(input);outline.plotContract=demoPlotContract(outline,input);const prose=demoProse(outline,input),pagination=demoPagination(outline,prose,input);
  const book={id:'book-coherence-image-test',outline,prose,pagination,pages:toLegacyPages(pagination),storyInput:input,textGenerationSettings:{engine:'openai',providers:{openai:{}},hybrid:{enabled:false}}};
  return {state,book};
}
function report(book,overrides={}){return {version:1,stage:'pages',contentFingerprint:coherenceFingerprint({outline:book.outline,prose:book.prose,pagination:currentBookPagination(book),stage:'pages'}),passed:true,issues:[],repairAttempts:0,...overrides};}

test('a passing current book report survives the display-page aliases without an extra paid review',async()=>{
  const {state,book}=fixture();book.pageCoherence=report(book);let calls=0;
  await ensureBookStoryCoherence(state,book,{review:async()=>{calls++;throw Error('must not review unchanged aliases');}});assert.equal(calls,0);assert.equal(book.textUsage,undefined);
  assert.equal(book.pages[0].scene.index,0);assert.equal(currentBookPagination(book).pages[0].textKo,book.pages[0].ko);
});

test('a parent edit to displayed text triggers review and blocks scene and cover providers on failure',async()=>{
  for(const generate of [(state,book,options)=>generateScene(state,book,0,options),(state,book,options)=>generateCover(state,book,options)]){
    const {state,book}=fixture();book.pageCoherence=report(book);book.pages[0].ko='유하가 앞에 없던 새 성을 만들어요.';let calls=0;
    const error=Object.assign(new Error('이야기 사건이 승인된 플롯과 달라요.'),{coherence:report(book,{passed:false,issues:[]}),usage:{input:12,output:6,costUsdEstimated:.02},meta:{stage:'coherence',requests:1}});
    await assert.rejects(generate(state,book,{review:async(outline,prose,pagination,input,options)=>{calls++;assert.equal(pagination.pages[0].textKo,book.pages[0].ko);assert.equal(options.repair,false);throw error;}}),/승인된 플롯/);
    assert.equal(calls,1);assert.equal(book.pages[0].imageSeed,undefined);assert.equal(book.cover,undefined);assert.equal(book.generationSnapshot,undefined);assert.equal(book.pageCoherence.passed,false);assert.equal(book.textUsage.calls.length,1);assert.equal(book.textUsage.calls[0].input,12);
  }
});

test('a returned stale or failed review cannot authorize a paid image request',async()=>{
  const {state,book}=fixture();let calls=0;
  await assert.rejects(generateScene(state,book,0,{review:async()=>{calls++;return {data:{prose:book.prose,pagination:book.pagination},usage:{input:10,output:5},meta:{requests:1,coherence:report(book,{contentFingerprint:'stale-content'})}};}}),/일관성 검사/);
  assert.equal(calls,1);assert.equal(book.pages[0].imageSeed,undefined);assert.equal(book.generationSnapshot,undefined);assert.equal(book.textUsage.calls.length,1);
});

test('a successful review is stored with its paid usage and reused on the next image preflight',async()=>{
  const {state,book}=fixture();let calls=0;
  const review=async()=>{calls++;return {data:{prose:book.prose,pagination:book.pagination},usage:{input:17,output:8,costUsdEstimated:.03},meta:{stage:'coherence',requests:1,coherence:report(book)}};};
  await ensureBookStoryCoherence(state,book,{review});await ensureBookStoryCoherence(state,book,{review});assert.equal(calls,1);assert.equal(book.pageCoherence.passed,true);assert.equal(book.textUsage.calls.length,1);assert.equal(book.textUsage.calls[0].input,17);assert.equal(book.textUsage.calls[0].costUsdEstimated,.03);
});

test('previously saved legacy books and explicitly labelled demos do not acquire a fabricated semantic pass',async()=>{
  for(const mode of ['legacy','demo']){const {state,book}=fixture();if(mode==='legacy')delete book.outline.plotContract;else book.textDemo=true;await ensureBookStoryCoherence(state,book,{review:async()=>{throw Error('must not review');}});assert.equal(book.pageCoherence,undefined);assert.equal(book.textUsage,undefined);}
});
