import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {adaptPatternForBook,beatCountFor,runDistillation,runEval} from '../dist/node.js';
import {beatCountFor as appBeatCount} from '../../dist/story-generation/schemas.js';
const read=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const patterns=read('data/plot_patterns.json'),worlds=read('data/worlds.json'),inventories=read('data/inventories.json');
test('R7-3 package pattern allocation agrees with app for every level/page count without mutating cards',()=>{
 const before=JSON.stringify(patterns);
 for(const level of ['K1','K2','K3','K4']) for(const pages of [8,12,16,24]) for(const pattern of patterns) {
  const adapted=adaptPatternForBook(pattern,pages,level),count=beatCountFor(pages,level);
  assert.equal(count,appBeatCount(pages,level));assert.equal(adapted.beats.length,count);assert.equal(adapted.beats.filter(b=>b.type==='attempt').length,count-5);
  assert.deepEqual(adapted.beats.filter(b=>b.type!=='attempt').map(b=>b.type),['setup','want','turn','resolution','close']);
 }
 assert.equal(JSON.stringify(patterns),before);
});
test('R7-3 distill and evaluator actually send the adapted seven-beat K1 pattern, with no network',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'r7-pattern-')),requests=[];
 const generator={id:'mock',complete:async request=>{requests.push(request);throw Error('captured offline');}},topic={id:'t',topic:'작은 소리',worldId:worlds.worlds[0].id,patternId:patterns[0].id,levelKo:'K1',levelEn:'E0'};
 const common={generator,judge:generator,topics:[topic],pages:16,patterns,worlds,inventories,protagonist:{name:'유하',traits:[]},supporting:[]};
 await runDistillation({...common,levels:[{levelKo:'K1',levelEn:'E0'}],outPath:join(dir,'distill.jsonl'),dryRun:true,onSample:sample=>requests.push(sample.prompt)});
 await runEval({...common,runId:'mock',approvedBooks:[],outDir:dir});
 assert.equal(requests.length,2);
 for(const request of requests) {assert.match(request.user,/→ 비트 7개/);assert.ok(!request.user.includes('"type":"attempt"') || request.user.match(/"type":"attempt"/g).length<=2);}
});
