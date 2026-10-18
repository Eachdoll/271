import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {migrateWorldState,getActiveWorld} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {createFullAutoJob,runFullAuto} from '../dist/full-auto.js';
import {demoOutline,demoProse,demoPagination} from '../dist/story-generation/demo.js';
import {demoSceneBriefs} from '../dist/story-generation/scene-briefs.js';
import {StoryValidationError} from '../dist/story-generation/schemas.js';
import {rewriteBookPage,applyPageText,setPageReviewed,pagesNeedingImages,estimateSimpleCosts,generateBookPageImage} from '../dist/story-generation/page-tools.js';

const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const result=(data,stage)=>({data,usage:{input:10,output:20,costUsdEstimated:.01},meta:{stage,requests:1,model:'mock'}});
const refuse=name=>async()=>{throw Error(name+' must not run here');};
// Text from the fixed demo story, billed like a model; no image operation may run.
const textOps={
 preflight:async()=>{},
 outline:async input=>result(demoOutline(input),'outline'),
 briefs:async(o,i)=>result(demoSceneBriefs(o,i),'sceneBriefs'),
 prose:async(o,i)=>result(demoProse(o,i),'prose'),
 enrichment:async p=>result(p,'enrichment'),
 pagination:async(o,p,i)=>({...result(demoPagination(o,p,i),'pagination'),meta:{requests:1,checks:{passed:true,checks:[]}}}),
 characterSheet:refuse('character sheet'),backgroundSheet:refuse('background sheet'),scene:refuse('scene'),cover:refuse('cover'),
};
// The app builder's shape for the fields page tools read and write.
const buildBook=p=>({id:p.bookId,title:p.outline.titleCandidates[0],characterIds:p.wizard.characterIds,backgroundIds:p.wizard.backgroundIds,
 pages:p.pagination.pages.map(x=>({...x,ko:x.textKo,en:x.textEn})),outline:p.outline,prose:p.prose,pagination:structuredClone(p.pagination),
 storyInput:p.input,sceneBriefs:p.sceneBriefs,textGenerationSettings:p.textSettings,textUsage:p.usage,textDemo:p.demo,
 textCosts:{requestCount:0,estimatedUsd:0,actualUsd:null,actualAvailable:false},readingLevelSnapshot:p.readingLevels,storyCheck:p.storyCheck,
 storyDraftId:p.id,worldId:p.worldId,worldSettingsSnapshot:structuredClone(p.worldSnapshot)});

async function heldBook({stopBefore='text',demo=false}={}){
 const state=seedState();migrateWorldState(state);migrateReadingSettings(state.settings);
 const wizard={characterIds:['yuha'],backgroundIds:[],topic:'유하와 달토끼의 별 찾기',pageCount:12,koreanLevel:'K1',englishLevel:'E0',value:'none',ending:'home',language:'bilingual'};
 const job=createFullAutoJob(state,wizard,{stopBefore,planMode:'selection',demo});
 await runFullAuto(state,job,{operations:demo?{characterSheet:textOps.characterSheet,backgroundSheet:textOps.backgroundSheet,scene:textOps.scene,cover:textOps.cover}:textOps,buildBook});
 let saves=0;const save=()=>{saves++;return true;};
 return {state,job,book:job.book,save,saves:()=>saves};
}
const draw=(page,id)=>Object.assign(page,{imageAssetId:id,imageUrl:'asset:'+id,imageMeta:{quality:'final'}});

test('rewriteBookPage copies back only the chosen page and records its usage on the book and the job',async()=>{
 const {state,job,book,save,saves}=await heldBook();
 draw(book.pages[3],'image-page-0003');book.pages[3].reviewed=true;
 const otherKo=book.pages[1].ko,otherPagination=structuredClone(book.pagination.pages[1]);
 let seen;
 const rewrite=async(pagination,pageNo,outline,prose,input,options)=>{
  seen={pageNo,outline,prose,input,options};
  const next=structuredClone(pagination);
  next.pages[3].textKo='유하가 달빛 아래에서 별을 세어요.';next.pages[3].textEn='Yuha counts stars.';
  next.pages[1].textKo='다른 쪽은 바뀌면 안 돼요.';
  return {data:next,usage:{input:120,output:40,costUsdEstimated:.004},meta:{stage:'page',requests:1,engineId:'openai',model:'mock',checks:{passed:true}}};
 };
 const out=await rewriteBookPage(state,book,3,{save,rewrite});
 assert.equal(out.changed,true);assert.equal(seen.pageNo,4);assert.equal(seen.input,book.storyInput);assert.equal(seen.outline,book.outline);
 assert.equal(seen.options.sceneBriefs,book.sceneBriefs);assert.deepEqual(Object.keys(seen.options.qualityEngines).sort(),['cheap','outline','prose']);
 assert.equal(seen.options.engineId,'openai');assert.equal(seen.options.richness,true);
 const page=book.pages[3];
 assert.deepEqual([page.ko,page.textKo,page.en,page.textEn],['유하가 달빛 아래에서 별을 세어요.','유하가 달빛 아래에서 별을 세어요.','Yuha counts stars.','Yuha counts stars.']);
 assert.equal(book.pagination.pages[3].textKo,'유하가 달빛 아래에서 별을 세어요.');
 assert.equal(book.pages[1].ko,otherKo);assert.deepEqual(book.pagination.pages[1],otherPagination);
 assert.equal(page.reviewed,undefined);assert.equal(page.imageStale,true);assert.equal(out.imageStale,true);
 assert.ok(book.storyCheck?.checks);assert.equal(book.readingCheck,null);
 const row=book.textUsage.calls.at(-1);
 assert.deepEqual([row.action,row.pageNo,row.input,row.requests],['rewrite-page',4,120,1]);assert.equal(row.checks,undefined);
 assert.ok(job.usage.calls.some(c=>c.action==='rewrite-page'&&c.input===120));
 assert.equal(book.textCosts.requestCount,book.textUsage.calls.reduce((n,c)=>n+(Number(c.requests)||1),0));
 assert.equal(state.storyDrafts[book.storyDraftId].pictureBook.pages[3].ko,'유하가 달빛 아래에서 별을 세어요.');
 assert.equal(saves(),1);
});

test('rewriteBookPage keeps the cost row of a failed paid rewrite and leaves the text alone',async()=>{
 const {state,job,book,save}=await heldBook(),before=book.pages[5].ko;
 const billed=Object.assign(Error('engine returned broken JSON'),{usage:{input:90,output:30},meta:{stage:'page',requests:1}});
 await assert.rejects(rewriteBookPage(state,book,5,{save,rewrite:async()=>{throw billed;}}),/broken JSON/);
 const failed=book.textUsage.calls.at(-1);
 assert.deepEqual([failed.failed,failed.input,failed.pageNo],[true,90,6]);
 assert.ok(job.usage.calls.some(c=>c.failed&&c.input===90));
 await assert.rejects(rewriteBookPage(state,book,5,{save,rewrite:async()=>{throw new StoryValidationError('page',['이 쪽 번호와 비트 번호를 유지해 주세요.']);}}),/비트 번호/);
 const unknown=book.textUsage.calls.at(-1);
 assert.deepEqual([unknown.failed,unknown.usageUnknown,unknown.requests],[true,true,1]);
 assert.equal(book.pages[5].ko,before);
});

test('rewriteBookPage runs the real page rewrite with the frozen settings and an injected engine',async()=>{
 const {state,book,save}=await heldBook();
 const requests=[],engine={id:'openai',async complete(req){requests.push(req);const target=JSON.parse(req.user).targetPage;return {json:{...target,textKo:'유하가 작은 별을 찾아요.'},usage:{input:300,output:60}};}};
 const out=await rewriteBookPage(state,book,2,{save,engine});
 assert.equal(requests.length,1);assert.match(requests[0].system,/Rewrite only story page 3/);
 assert.equal(out.changed,true);assert.equal(book.pages[2].ko,'유하가 작은 별을 찾아요.');assert.equal(book.textUsage.calls.at(-1).input,300);
});

test('demo books never request a rewrite',async()=>{
 const {state,book}=await heldBook({demo:true});
 assert.equal(book.textDemo,true);let called=0;
 assert.deepEqual(await rewriteBookPage(state,book,0,{rewrite:async()=>{called++;}}),{changed:false,demo:true});
 assert.equal(called,0);
});

test('applyPageText marks only a drawn page stale, clears its review mark and rechecks the story',async()=>{
 const {state,book,save,saves}=await heldBook();
 draw(book.pages[0],'image-page-0000');book.pages[0].reviewed=true;
 const unchanged=await applyPageText(state,book,0,{ko:book.pages[0].ko,en:book.pages[0].en,save});
 assert.equal(unchanged.changed,false);assert.equal(saves(),0);assert.equal(book.pages[0].reviewed,true);
 const out=await applyPageText(state,book,0,{ko:'유하가 문을 열어요.',save});
 assert.equal(out.changed,true);assert.equal(book.pages[0].imageStale,true);assert.equal(book.pages[0].reviewed,undefined);
 assert.deepEqual([book.pages[0].textKo,book.pagination.pages[0].textKo],['유하가 문을 열어요.','유하가 문을 열어요.']);
 assert.ok(out.storyCheck?.checks);assert.equal(saves(),1);
 const plain=await applyPageText(state,book,1,{en:'Yuha opens the door.',save});
 assert.equal(plain.changed,true);assert.equal(book.pages[1].imageStale,undefined,'no image yet, nothing to redraw');
 await assert.rejects(applyPageText(state,book,12,{ko:'x'}),/쪽을 찾지 못했어요/);
});

test('setPageReviewed persists the mark in the story draft',async()=>{
 const {state,book,save,saves}=await heldBook();
 await setPageReviewed(state,book,6,true,{save});
 assert.equal(book.pages[6].reviewed,true);assert.equal(state.storyDrafts[book.storyDraftId].pictureBook.pages[6].reviewed,true);assert.equal(saves(),1);
 await setPageReviewed(state,book,6,false,{save});
 assert.equal(book.pages[6].reviewed,false);assert.equal(book.pages[6].reviewedAt,undefined);
});

test('pagesNeedingImages lists missing, draft-quality and stale pages',()=>{
 const book={pages:[{imageAssetId:'a',imageMeta:{quality:'final'}},{},{imageAssetId:'b',imageMeta:{quality:'draft'}},{imageAssetId:'c',imageMeta:{quality:'final'},imageStale:true}]};
 assert.deepEqual(pagesNeedingImages(book),[1,2,3]);assert.deepEqual(pagesNeedingImages(null),[]);
});

test('estimateSimpleCosts follows the wizard before a book exists and the remaining work after',async()=>{
 const {state,book}=await heldBook({stopBefore:'pages'});
 getActiveWorld(state).imageEngine='openai';
 const wizard={pageCount:12},plan=estimateSimpleCosts(state,wizard),free=estimateSimpleCosts(state,wizard,{planMode:'selection'});
 assert.ok(plan.textUsd>free.textUsd);assert.equal(plan.imagesUsd,13*plan.imageUnitUsd);assert.equal(plan.sheetsUpperUsd,10*plan.imageUnitUsd);assert.ok(plan.pageTextUsd>0);
 assert.equal(estimateSimpleCosts(state,wizard,{demo:true}).textUsd,0);
 // The book keeps its frozen sample engine; only the 12 missing pages and the cover remain.
 const left=estimateSimpleCosts(state,book);
 assert.equal(left.imageEngine,'sample');assert.equal(left.imagesNeeded,13);assert.equal(left.sheetsUpperUsd,0);assert.ok(left.textUsd>0&&left.pageTextUsd>0);
 draw(book.pages[0],'image-page-0000');
 assert.equal(estimateSimpleCosts(state,book).imagesNeeded,12);
});

test('generateBookPageImage needs the frozen snapshot, draws at final quality and records the image on the job',async()=>{
 const text=await heldBook();let drawn=0;
 const generate=async(s,b,i,o)=>{drawn++;draw(b.pages[i],'image-new-'+drawn);return b.pages[i];};
 await assert.rejects(generateBookPageImage(text.state,text.book,0,{generate}),/그림 준비/);assert.equal(drawn,0);
 const {state,job,book,save,saves}=await heldBook({stopBefore:'pages'});
 assert.ok(book.generationSnapshot);
 draw(book.pages[4],'image-old-4');book.pages[4].imageStale=true;
 let options;
 const page=await generateBookPageImage(state,book,4,{save,changeComposition:true,generate:async(s,b,i,o)=>{options=o;return generate(s,b,i,o);}});
 assert.deepEqual([options.quality,options.changeComposition],['final',true]);
 assert.equal(page.imageAssetId,'image-new-1');assert.equal(page.imageStale,undefined);
 assert.ok(job.imageUsage['image-new-1']);assert.equal(state.storyDrafts[book.storyDraftId].pictureBook.pages[4].imageAssetId,'image-new-1');assert.equal(saves(),1);
 // A paid image that arrives before a stop is kept, recorded and saved.
 book.pages[5].imageStale=true;
 await assert.rejects(generateBookPageImage(state,book,5,{save,generate:async(s,b,i)=>{draw(b.pages[i],'image-paid-5');throw new DOMException('stop','AbortError');}}),{name:'AbortError'});
 assert.equal(book.pages[5].imageStale,undefined);assert.ok(job.imageUsage['image-paid-5']);assert.equal(saves(),2);
});

test('page tools refuse to change a book while its FULL AUTO run is live',async()=>{
 const {state,job,book}=await heldBook({stopBefore:'pages'});
 job.status='running';
 await assert.rejects(applyPageText(state,book,0,{ko:'x'}),/만드는 중/);
 await assert.rejects(rewriteBookPage(state,book,0,{rewrite:refuse('rewrite')}),/만드는 중/);
 await assert.rejects(generateBookPageImage(state,book,0,{generate:refuse('scene')}),/만드는 중/);
});
