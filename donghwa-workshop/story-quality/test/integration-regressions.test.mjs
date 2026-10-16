import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {cleanKoLabel,josa,fillKo,generateTopics,headNoun,filterBanned,violatesBanList,containsPlanted,plotCheck,composeSeed,hashString,runOutlineStage} from '../dist/index.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=name=>JSON.parse(readFileSync(resolve(root,name),'utf8'));
const inventories=read('data/inventories.json'),worlds=read('data/worlds.json'),patterns=read('data/plot_patterns.json'),gold=read('gold/gold_outlines_part1.json');
const clone=value=>JSON.parse(JSON.stringify(value));
const emptyBan=()=>({plantedObjects:[],creatures:[],twistTypes:[],patterns:[],places:[]});

test('Korean label annotation cleanup preserves nouns and selects the correct particle',()=>{
  assert.equal(cleanKoLabel('나무 방패（장난감） [파란색]'), '나무 방패');
  assert.equal(cleanKoLabel('바다표범(관찰용(작은))'), '바다표범');
  assert.equal(josa('바다표범 [친구]', '와'),'과');
  assert.equal(josa('마을（세계 카드）','로'),'로');
  assert.equal(fillKo('{creature:와} {prop:을} 찾기',{creature:'바다표범【관찰용】',prop:'나무 방패(장난감)'}),'바다표범과 나무 방패를 찾기');
});

test('space and underwater worlds exclude outdoor rain and sunset waiting templates',()=>{
  const topics=generateTopics(worlds,{perWorld:33,seed:17}),noSky=new Set(['space_station','star_cruiser_garden','moon_base','undersea_city','underwater_volcano_lab']);
  for(const topic of topics){if(noSky.has(topic.worldId))assert.ok(!['w3','w4'].includes(topic.templateId),`${topic.worldId}: ${topic.topic}`);if(['mars_base','mars_greenhouse_town'].includes(topic.worldId))assert.notEqual(topic.templateId,'w4');assert.doesNotMatch(topic.topic,/[()[\]{}]|（|）|【|】/);}
});

test('head-noun bans agree before selection and after generation without name substring matches',()=>{
  const ban={...emptyBan(),plantedObjects:['빨간 우산'],creatures:['아기 토끼']};
  const pool=[{ko:'파란 우산'},{ko:'우산'},{ko:'나뭇잎'}];assert.deepEqual(filterBanned(pool,ban.plantedObjects),[{ko:'나뭇잎'}]);
  assert.equal(headNoun('나무 방패（장난감）'),'방패');
  const repeated={plan:{planted:'파란 우산'},beats:[{summary:'유하가 토끼에게는 나뭇잎을 줘요.'}]};assert.deepEqual(violatesBanList(repeated,ban),['심은 물건 반복: 파란 우산','생물 반복: 아기 토끼']);
  const different={plan:{planted:'나뭇잎'},beats:[{summary:'유하가 토끼별이와 우산마을에 가요. 유하가 피리를 불어요.'}]};assert.deepEqual(violatesBanList(different,ban),[]);assert.deepEqual(violatesBanList(different,{...emptyBan(),creatures:['피']}),[]);
  assert.equal(containsPlanted('유하가 우산마을로 걸어요.','우산'),false);assert.equal(containsPlanted('유하가 파란 우산을 펼쳐요.','빨간 우산'),true);
});

test('one-letter forbidden keywords cannot falsely flag innocent compound words',()=>{
  const book=clone(gold[0]);book.outline.beats[0].summary+=' 유하가 피리와 죽순을 보아요.';
  const check=plotCheck({outline:book.outline,topic:book.topic,protagonistName:'유하',inventories:{...inventories,forbiddenKeywords:['피','죽']}});
  assert.ok(check.regenerate.every(issue=>!issue.startsWith('금지 소재:')));
});

test('browser index has no transitive Node development-tool dependency',()=>{
  const seen=new Set();const visit=file=>{if(seen.has(file))return;seen.add(file);const source=readFileSync(file,'utf8');assert.doesNotMatch(source,/(?:from\s*|import\s*\()['"]node:/);for(const match of source.matchAll(/(?:import|export)[^;]*?from\s*['"]([^'"]+)['"]/g)){if(match[1].startsWith('.'))visit(resolve(dirname(file),match[1]));}};
  visit(resolve(root,'dist/index.js'));assert.ok(![...seen].some(file=>/\/(?:distill|finetune)\//.test(file)||file.endsWith('/eval/harness.js')));
});

test('app pipeline forwards world and variant choice while reference books remain retrieval-only',async()=>{
  const world=worlds.worlds.find(item=>item.id==='mars_base'),pattern=patterns[0],bookId='reference-world-forwarding',expected=composeSeed({pattern,inventories,backgroundType:'mars_base',rngSeed:hashString(bookId),world,variantChance:0}),reference=clone(gold[0]);
  reference.bookId='retrieval-only';reference.usedElements.planted=expected.planted.ko;reference.usedElements.creatures=[expected.creature.ko];reference.outline.plan.planted=expected.planted.ko;
  const requests=[],engine={id:'fake',async complete(request){requests.push(request);return {json:reference.outline,text:JSON.stringify(reference.outline),usage:{input:1,output:1}};}};
  const result=await runOutlineStage({engines:{outline:engine,prose:engine,cheap:engine},bookId,protagonist:{name:'유하',traits:[]},supporting:[],worldCore:[],topic:'화성 탐험',levelKo:'K1',levelEn:'E0',pages:12,pattern,backgroundType:'mars_base',inventories,approvedBooks:[],referenceBooks:[reference],endingType:'home_sleep',rules:[],banExamples:[],world,variantChance:0});
  assert.deepEqual(result.seed,expected);assert.ok(result.seed.subLocations.every(item=>world.subLocations.some(location=>location.ko===item.ko)));assert.match(requests[0].user,/참고 예시/);const banLine=requests[0].user.match(/최근 책에서 썼으므로 금지: ([^\n]*)/)?.[1]||'';assert.ok(!banLine.includes(expected.planted.ko));
});

test('when every world creature head is banned, seed selection falls back to an eligible common creature',()=>{
  const world=worlds.worlds.find(item=>item.id==='mars_base'),banned=world.creatures.map(item=>`아기 ${item.ko}`),ban={...emptyBan(),creatures:banned},seed=composeSeed({pattern:patterns[0],inventories,backgroundType:'mars_base',world,ban,rngSeed:57,variantChance:0});
  const forbidden=new Set(banned.map(headNoun));assert.ok(!forbidden.has(headNoun(seed.creature.ko)));assert.ok(inventories.creatures.some(item=>item.ko===seed.creature.ko));
});
