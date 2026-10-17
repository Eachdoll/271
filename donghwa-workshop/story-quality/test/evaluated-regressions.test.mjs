import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAnthropicEngine} from '../dist/engines/anthropic.js';
import {normalizeFailureReason,plotCheck} from '../dist/plotCheck.js';
import {buildOutlinePrompt} from '../dist/outlinePrompt.js';
import {composeSeed} from '../dist/composeSeed.js';
import {buildBanList} from '../dist/banList.js';
import {judgeOutline} from '../dist/eval/rubricJudge.js';
const read=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const gold=read('gold/gold_outlines_part1.json'),inventories=read('data/inventories.json'),patterns=read('data/plot_patterns.json');

test('real-evaluation Claude fixes preserve a text budget without sending rejected temperature',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(_url,options)=>{calls.push(JSON.parse(options.body));return Response.json({content:[{type:'text',text:'{"story":"hello"}'}],usage:{input_tokens:10,output_tokens:20},stop_reason:'end_turn'});};
 try {
  for(const [model,thinking,maxTokens] of [['claude-haiku-5-5','disabled',500],['claude-sonnet-5-5','between_tools',500],['claude-opus-5-5',null,8500]]){
   const engine=createAnthropicEngine({model,apiKey:'fixture',retries:0});const result=await engine.complete({system:'JSON',user:'original',temperature:.2,maxTokens:500,jsonSchema:{type:'object'}});
   const body=calls.at(-1);assert.equal(body.temperature,undefined);assert.equal(body.max_tokens,maxTokens);assert.equal(body.thinking?.type,thinking??undefined);assert.equal(result.json.story,'hello');assert.ok(Number.isFinite(result.costUsd));
  }
  assert.equal(calls.length,3);
 } finally {globalThis.fetch=original;}
});
test('outline and rubric requests carry the evaluated output budgets',async()=>{
 const ban=buildBanList([]),pattern=patterns[0],seed=composeSeed({pattern,inventories,backgroundType:'forest',rngSeed:12,ban});
 const prompt=buildOutlinePrompt({protagonist:{name:'유하',traits:[]},supporting:[],worldCore:[],topic:'바람',levelKo:'K1',levelEn:'E0',pages:12,pattern,seed,inventories,ban,approvedBooks:[],endingType:'home_sleep'});
 assert.equal(prompt.maxTokens,4000);assert.match(prompt.user,/failureReason.*ID/);
 let calls=0;await judgeOutline({id:'mock',complete:async request=>{calls++;assert.equal(request.maxTokens,1500);return {json:{scores:{event:2,causality:2,repetition:2,twist:2,concreteness:2}},text:'{}',usage:{input:1,output:1}};}},gold[0].outline);assert.equal(calls,1);
});
test('Korean failure labels normalize to IDs before order and uniqueness checks',()=>{
 const ids=['wrong_place','wrong_method','interrupted'],labels=['엉뚱한 장소: 거기엔 없어요','잘못된 방법: 방법이 틀려요','거의 됐는데 방해: 바람이 불어요'];
 assert.deepEqual(labels.map(normalizeFailureReason),ids);assert.equal(normalizeFailureReason(' WRONG_PLACE '),'wrong_place');assert.equal(normalizeFailureReason('새로운 이유'),'새로운 이유');assert.equal(normalizeFailureReason(null),null);
 const outline=structuredClone(gold.find(book=>book.outline.beats.filter(b=>b.type==='attempt').length===3).outline);
 outline.beats.filter(b=>b.type==='attempt').forEach((beat,i)=>{beat.failureReason=labels[i];});
 const pattern=patterns[0],seed=composeSeed({pattern,inventories,backgroundType:'forest',rngSeed:12,ban:buildBanList([])});seed.failureReasons=ids;
 assert.ok(!plotCheck({outline,topic:'바람',protagonistName:'유하',seed}).fix.some(issue=>/실패 이유/.test(issue)));
 outline.beats.filter(b=>b.type==='attempt')[1].failureReason='다른 장소: 문 앞이 아니에요';
 const check=plotCheck({outline,topic:'바람',protagonistName:'유하',seed});assert.ok(check.fix.some(issue=>/실패 이유가 겹침/.test(issue)));assert.ok(check.fix.some(issue=>/실패 이유 순서/.test(issue)));
});

test('R5-1 failure-reason instructions only accompany outputs that contain beat failure reasons',async()=>{
 const prompts=await import('../dist/prompts.js');
 for(const name of ['CHILD_CURIOSITY_USER','CHILD_RETELL_USER','WEEKLY_COACH_USER'])assert.doesNotMatch(prompts[name],/failureReason/,name);
 for(const name of ['OUTLINE_USER','BEAT_CANDIDATES_USER']){
  assert.match(prompts[name],/failureReason은 설명이 아니라 ID 하나만/,name);
  assert.match(prompts[name],/wrong_place.*wrong_method.*interrupted/,name);
 }
});
test('R5-2 fixed test-set description matches the eras of its actual topic worlds',()=>{
 const set=read('eval/testset.json'),worlds=read('data/worlds.json').worlds;
 const counts={present:0,past:0,future:0,fantasy:0};
 for(const topic of set.topics){const world=worlds.find(item=>item.id===topic.worldId);assert.ok(world,topic.worldId);assert.ok(Object.hasOwn(counts,world.era),world.era);counts[world.era]++;}
 const match=set.description.match(/현재\s*(\d+)\s*·\s*과거\s*(\d+)\s*·\s*미래\s*(\d+)\s*·\s*상상\s*(\d+)/);assert.ok(match,'description must declare all four era counts');
 assert.deepEqual(counts,Object.fromEntries(['present','past','future','fantasy'].map((era,i)=>[era,Number(match[i+1])])));
});
