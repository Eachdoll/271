import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBeatPagePlan,splitPaginationToCount} from '../dist/story-generation/pagination.js';
import {generateOutline,generateProse,paginateStory} from '../dist/story-generation/pipeline.js';
import {demoPagination} from '../dist/story-generation/demo.js';
import {getLevelSpec} from '../dist/reading-levels.js';
const clone=value=>JSON.parse(JSON.stringify(value));
const words=value=>String(value).trim().split(/\s+/u);
async function fixture(){
 const input={characters:[{id:'yuha',name:'유하',nameEn:'Yuha'},{id:'green',name:'그린이',nameEn:'Green'}],backgrounds:[{id:'forest',name:'숲길'}],pageCount:12,endingType:'home_sleep',specs:{ko:getLevelSpec('K1'),en:getLevelSpec('E0')}};
 const outline=(await generateOutline(input,{engineId:'demo'})).data,prose=(await generateProse(outline,input,{engineId:'demo'})).data,pagination=demoPagination(outline,prose,input);
 // Saved books from before causal contracts still recover page counts without
 // paying for a new story review. New contracted books have separate gate tests.
 delete outline.plotContract;
 const seven={...clone(pagination),pages:outline.beats.map((beat,index)=>{
   const matching=pagination.pages.filter(page=>page.beatIndex===beat.index),first=matching[0];
   return {...clone(first),pageNo:index+1,textKo:matching.map(page=>page.textKo).join(' '),textEn:matching.map(page=>page.textEn).join(' '),originPage:index+1};
 })};return {input,outline,prose,pagination,seven};
}
function fake(answer){const calls=[];return {id:'mock',calls,async complete(req){calls.push(req);const value=typeof answer==='function'?answer(req,calls.length):answer;if(value instanceof Error)throw value;return {json:clone(value),usage:{input:10,output:10}};}};}

test('seven beats receive a concrete 12-page plan with turn at two thirds and close last',async()=>{
 const {outline}=await fixture(),plan=buildBeatPagePlan(outline,12);
 assert.equal(plan.length,12);assert.deepEqual(plan.map(page=>page.pageNo),Array.from({length:12},(_,i)=>i+1));
 assert.deepEqual([...new Set(plan.map(page=>page.beatIndex))],outline.beats.map(beat=>beat.index));
 assert.equal(plan.find(page=>page.beatIndex===outline.beats.find(beat=>beat.type==='turn').index).pageNo,8);
 assert.equal(plan.at(-1).beatIndex,outline.beats.at(-1).index);
});

test('parent-requested 7→12 split preserves edited word order, references and wardrobe without blank pages',async()=>{
 const {outline,seven}=await fixture();seven.pages[0].textKo='부모가 직접 고친 한글 문장입니다. 두 친구가 함께 문을 열어요.';seven.pages[0].textEn='This is the parent edited sentence. Two friends open the green door.';
 seven.pages[0].variantByCharacter={yuha:'raincoat',green:null};seven.prose={ko:'approved full prose stays unchanged',en:'also unchanged'};const before=clone(seven);
 const result=splitPaginationToCount(seven,12,{outline});assert.equal(result.pages.length,12);assert.deepEqual(seven,before);assert.deepEqual(result.cover,seven.cover);assert.deepEqual(result.prose,seven.prose);
 for(const language of ['textKo','textEn'])assert.deepEqual(words(result.pages.map(page=>page[language]).join(' ')),words(seven.pages.map(page=>page[language]).join(' ')));
 assert.ok(result.pages.every(page=>page.textKo.trim()&&page.textEn.trim()));
 for(const page of result.pages){const original=seven.pages[page.originPage-1];assert.deepEqual(page.scene,original.scene);assert.deepEqual(page.variantByCharacter,original.variantByCharacter);assert.equal(page.beatIndex,original.beatIndex);}
 assert.deepEqual(result.pages.map(page=>page.pageNo),Array.from({length:12},(_,i)=>i+1));
});

test('manual splitting refuses insufficient text and never shrinks across beats',async()=>{
 const {outline,seven}=await fixture();assert.throws(()=>splitPaginationToCount(seven,6,{outline}),/줄이려면/);
 const short={...seven,pages:seven.pages.map(page=>({...page,textKo:'한글',textEn:'Word'}))};assert.throws(()=>splitPaginationToCount(short,12,{outline}),/기존 글이 짧아/);assert.equal(short.pages.length,7);
});

test('pagination request enforces exact 12-page schema, distinguishes beats from pages and supplies the plan',async()=>{
 const {input,outline,prose,seven}=await fixture(),engine=fake(seven),checkpoints=[];
 const result=await paginateStory(outline,prose,input,{engine,repair:false,onCheckpoint:value=>checkpoints.push(value)}),call=engine.calls[0];
 assert.equal(call.jsonSchema.properties.pages.minItems,12);assert.equal(call.jsonSchema.properties.pages.maxItems,12);assert.match(call.system,/7 outline beats are NOT pages/);assert.deepEqual(JSON.parse(call.user).pagePlan,buildBeatPagePlan(outline,12));
 assert.equal(result.data.pages.length,7);assert.equal(result.meta.checks.passed,false);assert.equal(checkpoints.length,1);assert.equal(checkpoints[0].pagination.pages.length,7);assert.equal(checkpoints[0].repairAttempts,0);
});

test('an engine repeatedly returning seven pages stops after two repairs and remains visibly invalid',async()=>{
 const {input,outline,prose,seven}=await fixture(),engine=fake(seven),checkpoints=[];
 const result=await paginateStory(outline,prose,input,{engine,onCheckpoint:value=>checkpoints.push(value)});
 assert.equal(engine.calls.length,3);assert.equal(result.meta.repairAttempts,2);assert.equal(result.data.pages.length,7);assert.equal(result.meta.checks.passed,false);assert.equal(result.meta.checks.needsRepagination,true);assert.deepEqual(checkpoints.map(value=>value.repairAttempts),[0,1,2]);
});

test('a later API error retains the completed pagination checkpoint for parent recovery',async()=>{
 const {input,outline,prose,seven}=await fixture(),engine=fake((_,count)=>count===1?seven:new Error('temporary provider failure')),checkpoints=[];
 await assert.rejects(paginateStory(outline,prose,input,{engine,onCheckpoint:value=>checkpoints.push(value)}),/temporary provider failure/);
 assert.equal(checkpoints.length,1);assert.deepEqual(checkpoints[0].pagination,seven);assert.equal(checkpoints[0].checks.passed,false);
});

test('each completed page repair is checkpointed before a later repair can fail',async()=>{
 const {input,outline,prose,pagination}=await fixture(),bad=clone(pagination);bad.pages.forEach(page=>page.scene.action='Happy.');const checkpoints=[];
 const engine=fake((req,count)=>{
   if(count===1)return bad;if(count===3)return new Error('second page request failed');
   const action='Yuha carries a green bag beside Green on the forest path.';
   return req.jsonSchema.properties.action?{action}:{...JSON.parse(req.user).targetPage,scene:{...JSON.parse(req.user).targetPage.scene,action}};
 });
 await assert.rejects(paginateStory(outline,prose,input,{engine,onCheckpoint:value=>checkpoints.push(value)}),/second page request failed/);
 assert.equal(checkpoints.length,2);assert.equal(checkpoints[0].repairAttempts,0);assert.equal(checkpoints[1].repairAttempts,1);
 assert.match(checkpoints[1].pagination.pages[0].scene.action,/carries/);assert.equal(checkpoints[0].pagination.pages[0].scene.action,'Happy.');assert.equal(checkpoints[1].pagination.pages[1].scene.action,'Happy.');
});
