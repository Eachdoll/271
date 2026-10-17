import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAnthropicEngine} from '../dist/engines/anthropic.js';
import {normalizeFailureReason,plotCheck,containsPlanted,plantedPhrase} from '../dist/plotCheck.js';
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

test('planted descriptions match by their leading noun phrase without loosening unrelated words',()=>{
 assert.equal(plantedPhrase('커다란 등불: 거실 소파 옆에 있던 불 꺼진 등불. 유하가 들고 간다.'),'커다란 등불');
 assert.equal(plantedPhrase('커다란 보라 꽃 한 송이. 유하가 꽂는다.'),'커다란 보라 꽃');
 assert.equal(plantedPhrase('아주 작은 팬파이프 — 주머니 끈에 건 피리'),'아주 작은 팬파이프');
 assert.ok(containsPlanted('유하가 머리 위 빵을 내려요.','커다란 납작한 빵'));
 assert.ok(containsPlanted('결승선에 꽂았던 보라 꽃 한 송이가 자랐어요.','커다란 보라 꽃 한 송이. 유하가 꽂는다.'));
 assert.ok(!containsPlanted('빵빵 소리가 나요.','커다란 빵'));
 assert.ok(!containsPlanted('모자 위에서 반짝임이 보여요.','빛나는 단추'));
});

test('prose simplify carries a whole-book sentence budget and limits question endings when pageCount is known',async()=>{
 const {writeRichThenSimplify,sentenceBudget}=await import('../dist/richThenSimplify.js');
 const level={label:'K1',sentencesPerPage:[1,2],eojeolPerSentence:[3,5]};
 assert.deepEqual(sentenceBudget(level,12),{min:12,max:24});assert.equal(sentenceBudget(level,undefined),null);
 const seen=[];const engine={id:'mock',complete:async req=>{seen.push(req);return {text:'[비트 1 · setup]\n유하가 "가자!" 하고 말해요. "응!" 초록이가 말해요. "좋아!" 유하가 웃어요. "와!" 초록이가 뛰어요.',usage:{input:1,output:1},costUsd:0};}};
 const gestureDict={emotions:[],moral_tails_ko:[]};
 const base={engine,lang:'ko',charactersCompact:'유하',beatsCompact:'1 [setup] 시작',briefsCompact:'[]',emotions:[],gestureDict,targetLevel:level,richLevel:{label:'K2',sentencesPerPage:[2,3],eojeolPerSentence:[5,7]}};
 await writeRichThenSimplify({...base,pageCount:12});
 assert.match(seen[1].user,/전체 12~24문장/);assert.match(seen[1].user,/질문으로 끝나는 비트는 책 전체에서 2개까지/);assert.match(seen[0].user,/질문으로 끝나는 비트는 책 전체에서 2개까지/);
 seen.length=0;await writeRichThenSimplify(base);assert.doesNotMatch(seen[1].user,/전체 분량/);
});

test('curiosity overall is derived from page scores on the 0-10 scale, not the model free-form number',async()=>{
 const {curiosityCheck}=await import('../dist/childSimulator.js');
 const engine={id:'mock',complete:async()=>({text:'{"pages":[{"pageNo":1,"score":2,"why":"a"},{"pageNo":2,"score":2,"why":"b"},{"pageNo":3,"score":1,"why":"c"}],"dropPages":[],"overall":1.7}',usage:{input:1,output:1},costUsd:0})};
 const r=await curiosityCheck(engine,[{pageNo:1,text:'a'},{pageNo:2,text:'b'},{pageNo:3,text:'c'}]);
 assert.equal(r.overall,8.3);assert.equal(r.pass,true);
});
