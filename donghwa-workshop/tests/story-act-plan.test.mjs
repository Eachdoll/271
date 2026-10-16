import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBeatPagePlan} from '../dist/story-generation/pagination.js';
import {BEAT_COUNTS} from '../dist/story-generation/schemas.js';

test('causal twelve-page books reserve 2/5/3/2 pages for opening, escalating attempts, turn/resolution and close',()=>{
  const types=['setup','want','attempt','attempt','turn','resolution','close'];
  const outline={plotContract:{version:1},beats:types.map((type,index)=>({index:index+1,type}))};
  const plan=buildBeatPagePlan(outline,12),groups=plan.map(row=>types[row.beatIndex-1]);
  assert.deepEqual(groups,['setup','want','attempt','attempt','attempt','attempt','attempt','turn','turn','resolution','close','close']);
});
test('causal act allocation always retains all beats in order for every supported length',()=>{
  for(const pageCount of [8,12,16,24]){
    const count=BEAT_COUNTS[pageCount],types=['setup','want',...Array(count-5).fill('attempt'),'turn','resolution','close'];
    const plan=buildBeatPagePlan({plotContract:{version:1},beats:types.map((type,index)=>({index:index+1,type}))},pageCount);
    assert.equal(plan.length,pageCount);assert.deepEqual([...new Set(plan.map(row=>row.beatIndex))],Array.from({length:count},(_,i)=>i+1));
    assert.ok(plan.every((row,i)=>row.pageNo===i+1&&(!i||row.beatIndex>=plan[i-1].beatIndex)));
  }
});
