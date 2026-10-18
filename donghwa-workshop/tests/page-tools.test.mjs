import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {migrateWorldState,getActiveWorld} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {createFullAutoJob,runFullAuto} from '../dist/full-auto.js';
import {demoOutline,demoProse,demoPagination} from '../dist/story-generation/demo.js';
import {demoSceneBriefs} from '../dist/story-generation/scene-briefs.js';
import {StoryValidationError} from '../dist/story-generation/schemas.js';
import {rewriteBookPage,applyPageText,setPageReviewed,pagesNeedingImages,estimateSimpleCosts,generateBookPageImage,isPageImageStale,isPageOperationBusy} from '../dist/story-generation/page-tools.js';

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
 const redrawn={imageAssetId:'d2',imageMeta:{quality:'final'},imageStale:true,imageStaleAt:'2026-10-18T00:00:00Z',imageStaleAssetId:'d1'};
 const book={pages:[{imageAssetId:'a',imageMeta:{quality:'final'}},{},{imageAssetId:'b',imageMeta:{quality:'draft'}},{imageAssetId:'c',imageMeta:{quality:'final'},imageStale:true,imageStaleAssetId:'c'},redrawn]};
 assert.deepEqual(pagesNeedingImages(book),[1,2,3]);assert.deepEqual(pagesNeedingImages(null),[]);
 // The mark belonged to image d1; d2 was drawn since, so it is neither counted nor kept.
 assert.deepEqual([redrawn.imageStale,redrawn.imageStaleAt,redrawn.imageStaleAssetId],[undefined,undefined,undefined]);
 assert.equal(isPageImageStale(book.pages[3]),true);assert.equal(isPageImageStale({imageAssetId:'x',imageStale:true}),false,'a mark bound to no image is dropped');
});

test('a text edit binds the stale mark to the image it was set on',async()=>{
 const {state,book,save}=await heldBook();
 draw(book.pages[2],'image-page-0002');
 await applyPageText(state,book,2,{ko:'유하가 달을 봐요.',save});
 assert.deepEqual([book.pages[2].imageStale,book.pages[2].imageStaleAssetId],[true,'image-page-0002']);
 await applyPageText(state,book,2,{ko:'유하가 달을 또 봐요.',save});
 assert.equal(book.pages[2].imageStaleAssetId,'image-page-0002','a second edit keeps the original image');
 draw(book.pages[2],'image-page-0002-pro');
 assert.equal(isPageImageStale(book.pages[2]),false);assert.equal(book.pages[2].imageStale,undefined);
});

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const rewritten=(pagination,index,ko)=>{const next=structuredClone(pagination);next.pages[index].textKo=ko;return {data:next,usage:{input:50,output:20,costUsdEstimated:.002},meta:{stage:'page',requests:1,engineId:'openai',model:'mock'}};};

test('one page operation per book: busy while a paid rewrite is in flight, free again afterwards',async()=>{
 const {state,book,save}=await heldBook({stopBefore:'pages'});
 const gate=deferred();let started=0;
 const pending=rewriteBookPage(state,book,3,{save,rewrite:async(pagination)=>{started++;await gate.promise;return rewritten(pagination,3,'유하가 별을 세어요.');}});
 await new Promise(r=>setImmediate(r));
 assert.equal(started,1);assert.equal(isPageOperationBusy(book.id),true);assert.equal(isPageOperationBusy('book-other'),false);
 await assert.rejects(applyPageText(state,book,1,{ko:'x'}),/다른 쪽 작업/);
 await assert.rejects(rewriteBookPage(state,book,4,{rewrite:refuse('second rewrite')}),/다른 쪽 작업/);
 await assert.rejects(generateBookPageImage(state,book,4,{generate:refuse('scene')}),/다른 쪽 작업/);
 assert.notEqual(book.pages[1].ko,'x');
 gate.resolve();
 assert.equal((await pending).changed,true);assert.equal(isPageOperationBusy(book.id),false);
 // A failed request also frees the book.
 await assert.rejects(rewriteBookPage(state,book,4,{save,rewrite:async()=>{throw Error('offline');}}),/offline/);
 assert.equal(isPageOperationBusy(book.id),false);
});

test('a FULL AUTO run that starts during a paid rewrite keeps the cost row but not the new text',async()=>{
 const {state,job,book}=await heldBook({stopBefore:'pages'}),before=book.pages[3].ko,jobBook=job.book;let saves=0;
 const out=rewriteBookPage(state,book,3,{save:()=>{saves++;return true;},rewrite:async(pagination)=>{job.status='running';return rewritten(pagination,3,'달리는 동안 바뀐 글');}});
 await assert.rejects(out,/적용하지 않았어요/);
 assert.equal(book.pages[3].ko,before);assert.equal(book.pagination.pages[3].textKo,before);
 const row=book.textUsage.calls.at(-1);assert.deepEqual([row.action,row.input],['rewrite-page',50]);
 assert.ok(job.usage.calls.some(c=>c.action==='rewrite-page'&&c.input===50));
 assert.equal(saves,1);assert.equal(job.book,jobBook);assert.equal(isPageOperationBusy(book.id),false);
});

test('a paid page image that lands after a run started is still kept and recorded',async()=>{
 const {state,job,book}=await heldBook({stopBefore:'pages'});
 draw(book.pages[6],'image-old-6');Object.assign(book.pages[6],{imageStale:true,imageStaleAssetId:'image-old-6'});
 let saves=0;
 const page=await generateBookPageImage(state,book,6,{save:()=>{saves++;return true;},generate:async(s,b,i)=>{job.status='running';draw(b.pages[i],'image-new-6');return b.pages[i];}});
 assert.equal(page.imageAssetId,'image-new-6');assert.equal(page.imageStale,undefined);assert.equal(page.imageStaleAssetId,undefined);
 assert.ok(job.imageUsage['image-new-6']);assert.equal(saves,1);
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
