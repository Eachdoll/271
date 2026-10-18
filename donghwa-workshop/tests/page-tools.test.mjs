import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../dist/engine.js';
import {migrateWorldState,getActiveWorld} from '../dist/image-generation/world.js';
import {migrateReadingSettings} from '../dist/reading-ui.js';
import {createFullAutoJob,runFullAuto} from '../dist/full-auto.js';
import {demoOutline,demoProse,demoPagination} from '../dist/story-generation/demo.js';
import {demoSceneBriefs} from '../dist/story-generation/scene-briefs.js';
import {StoryValidationError} from '../dist/story-generation/schemas.js';
import {rewriteBookPage,applyPageText,setPageReviewed,pagesNeedingImages,estimateSimpleCosts,generateBookPageImage,isPageImageStale,isPageOperationBusy,claimBookForRun,releaseBookForRun,isBookClaimedForRun} from '../dist/story-generation/page-tools.js';

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

// ---- FIX-IMG: run claims, catchphrase advisory after page edits, billed rewrites without a usable page ----
test('page tools refuse a book a starting FULL AUTO run has claimed, before it is marked running',async()=>{
 const {state,job,book}=await heldBook({stopBefore:'pages'});
 assert.equal(job.status,'pages-ready');
 claimBookForRun(book.id);
 try{
  assert.equal(isBookClaimedForRun(book.id),true);
  await assert.rejects(applyPageText(state,book,0,{ko:'x'}),/만드는 중/);
  await assert.rejects(rewriteBookPage(state,book,0,{rewrite:refuse('rewrite')}),/만드는 중/);
  await assert.rejects(generateBookPageImage(state,book,0,{generate:refuse('scene')}),/만드는 중/);
  assert.notEqual(book.pages[0].ko,'x');
 }finally{releaseBookForRun(book.id);}
 assert.equal(isBookClaimedForRun(book.id),false);
 assert.equal((await applyPageText(state,book,0,{ko:'유하가 문을 열어요.'})).changed,true);
});

test('page edits keep the catchphrase-repeat advisory from the frozen story input',async()=>{
 const {state,job,book,save}=await heldBook(),phrase='같이 가자!';
 for(const input of new Set([book.storyInput,job.input]))input.characters[0].catchphrase=phrase;
 await applyPageText(state,book,0,{ko:`유하가 "${phrase}" 해요.`,save});
 const edited=await applyPageText(state,book,1,{ko:`유하가 또 "${phrase}" 외쳐요.`,save});
 const repeat=check=>(check?.warnings||[]).filter(w=>w.code==='catchphrase-repeat');
 assert.deepEqual(repeat(edited.storyCheck).map(w=>[w.phrase,w.pages]),[[phrase,[1,2]]]);
 assert.equal(edited.storyCheck,book.storyCheck);assert.equal(edited.storyCheck.passed,book.storyCheck.passed);
 // A paid page rewrite rechecks the book the same way.
 const rewrote=await rewriteBookPage(state,book,4,{save,rewrite:async pagination=>rewritten(pagination,4,'유하가 별을 세어요.')});
 assert.equal(rewrote.changed,true);assert.equal(repeat(rewrote.storyCheck).length,1);assert.equal(repeat(rewrote.storyCheck)[0].code,'catchphrase-repeat');
 // A book without its own copy of the input falls back to the job's input.
 const own=book.storyInput;delete book.storyInput;
 try{
  const fallback=await applyPageText(state,book,2,{ko:`유하가 "${phrase}" 하고 웃어요.`,save});
  assert.deepEqual(repeat(fallback.storyCheck).map(w=>w.pages),[[1,2,3]]);
 }finally{book.storyInput=own;}
 // The advisory never blocks: removing the repeat clears it.
 const cleared=await applyPageText(state,book,1,{ko:'유하가 웃어요.',save});
 assert.equal(repeat(cleared.storyCheck).length,1,'pages 1 and 3 still repeat it');
 await applyPageText(state,book,2,{ko:'유하가 하늘을 봐요.',save});
 assert.equal(repeat(book.storyCheck).length,0);
});

test('a paid rewrite without a usable page keeps its cost row as failed and saves it before throwing',async()=>{
 const {state,job,book,save,saves}=await heldBook(),before=book.pages[5].ko,count=book.textUsage.calls.length;
 const missing=async()=>({data:{pages:[]},usage:{input:70,output:10,costUsdEstimated:.003},meta:{stage:'page',requests:1,engineId:'openai',model:'mock'}});
 await assert.rejects(rewriteBookPage(state,book,5,{save,rewrite:missing}),/받지 못했어요.*비용은 기록했어요/);
 assert.equal(book.textUsage.calls.length,count+1);
 const row=book.textUsage.calls.at(-1);
 assert.deepEqual([row.action,row.pageNo,row.failed,row.input,row.requests],['rewrite-page',6,true,70,1]);
 assert.ok(job.usage.calls.some(c=>c.failed&&c.input===70&&c.action==='rewrite-page'));
 assert.equal(saves(),1,'the billed row is saved before the error');
 assert.equal(book.textCosts.requestCount,book.textUsage.calls.reduce((n,c)=>n+(Number(c.requests)||1),0));
 // A page that came back without any text is not usable either.
 const blank=async pagination=>{const next=structuredClone(pagination);next.pages[5].textKo='';next.pages[5].textEn='  ';return {data:next,usage:{input:71,output:5},meta:{stage:'page',requests:1}};};
 await assert.rejects(rewriteBookPage(state,book,5,{save,rewrite:blank}),/받지 못했어요/);
 assert.deepEqual([book.textUsage.calls.at(-1).failed,book.textUsage.calls.at(-1).input],[true,71]);assert.equal(saves(),2);
 assert.equal(book.pages[5].ko,before);assert.equal(book.pagination.pages[5].textKo,before);
 // A response that cost nothing records nothing and saves nothing.
 await assert.rejects(rewriteBookPage(state,book,5,{save,rewrite:async()=>({data:{pages:[]},meta:{requests:0}})}),/^Error: 다시 쓴 쪽을 받지 못했어요\.$/);
 assert.equal(book.textUsage.calls.length,count+2);assert.equal(saves(),2);
});

// ---- FIX-IMG-2: malformed or one-language rewrites, real usage on a failed validation, the cross-tab run lock ----
test('a paid rewrite with a malformed page list or one blank language keeps the failed row and the page text',async()=>{
 const {state,job,book,save,saves}=await heldBook(),before={ko:book.pages[5].ko,en:book.pages[5].en},count=book.textUsage.calls.length;
 const billed=data=>async()=>({data,usage:{input:80,output:9,costUsdEstimated:.002},meta:{stage:'page',requests:1,engineId:'openai',model:'mock'}});
 // data.pages that is not an array is a billed response without a usable page, not a TypeError.
 for(const pages of ['oops',{6:{textKo:'가',textEn:'a'}},7])
  await assert.rejects(rewriteBookPage(state,book,5,{save,rewrite:billed({pages})}),/받지 못했어요.*비용은 기록했어요/);
 assert.equal(book.textUsage.calls.length,count+3);assert.ok(book.textUsage.calls.slice(count).every(c=>c.failed&&c.input===80));
 assert.equal(job.usage.calls.filter(c=>c.failed&&c.input===80).length,3);assert.equal(saves(),3);
 // Every page carries both languages: one blank language would wipe that side of the page.
 for(const [ko,en] of [['','Yuha counts stars.'],['유하가 별을 세어요.','   '],['유하가 별을 세어요.',undefined]]){
  const one=async pagination=>{const next=structuredClone(pagination);next.pages[5].textKo=ko;next.pages[5].textEn=en;return {data:next,usage:{input:81,output:9},meta:{stage:'page',requests:1}};};
  await assert.rejects(rewriteBookPage(state,book,5,{save,rewrite:one}),/받지 못했어요/);
  assert.deepEqual([book.textUsage.calls.at(-1).failed,book.textUsage.calls.at(-1).input],[true,81]);
 }
 assert.deepEqual({ko:book.pages[5].ko,en:book.pages[5].en},before);
 assert.equal(book.pagination.pages[5].textKo,before.ko);assert.equal(book.pagination.pages[5].textEn,before.en);
 assert.equal(isPageOperationBusy(book.id),false);
});

test('a real page rewrite that fails validation after a paid response keeps its real tokens and cost',async()=>{
 const {state,job,book,save}=await heldBook(),before=book.pages[2].ko,usdBefore=book.textUsage.calls.reduce((n,c)=>n+(Number(c.costUsdEstimated)||0),0);
 let calls=0;
 const engine=patch=>({id:'openai',async complete(req){calls++;const target=JSON.parse(req.user).targetPage;return {json:{...target,...patch},usage:{input:4321,output:765,costUsdEstimated:.0123}};}});
 // The engine answered for another page: StoryValidationError after the paid request.
 await assert.rejects(rewriteBookPage(state,book,2,{save,engine:engine({pageNo:99})}),error=>error.name==='StoryValidationError'&&error.usage?.input===4321&&error.meta?.requests===1);
 let row=book.textUsage.calls.at(-1);
 assert.deepEqual([row.action,row.pageNo,row.failed,row.input,row.output,row.usageUnknown],['rewrite-page',3,true,4321,765,undefined]);
 assert.equal(row.costUsdEstimated,.0123,'the billed cost is kept');
 const estimated=book.textUsage.calls.reduce((n,c)=>n+(Number(c.costUsdEstimated)||0),0);
 assert.ok(Math.abs(book.textCosts.estimatedUsd-estimated)<1e-9&&Math.abs(estimated-usdBefore-.0123)<1e-9,'the book cost includes the failed request');
 assert.ok(job.usage.calls.some(c=>c.failed&&c.input===4321));
 // A page that fails the page schema after the request is billed the same way.
 await assert.rejects(rewriteBookPage(state,book,2,{save,engine:engine({textKo:''})}),{name:'StoryValidationError'});
 row=book.textUsage.calls.at(-1);
 assert.deepEqual([row.failed,row.input,row.usageUnknown],[true,4321,undefined]);
 assert.equal(calls,2);assert.equal(book.pages[2].ko,before);
});

test('page tools refuse to buy while another tab holds the job\'s FULL AUTO run lock',async()=>{
 const {state,job,book,save}=await heldBook({stopBefore:'pages'});
 assert.equal(job.status,'pages-ready');
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 const useLocks=locks=>Object.defineProperty(globalThis,'navigator',{value:{locks},configurable:true,writable:true});
 let queries=0,rewrites=0,draws=0;
 const rewrite=async pagination=>{rewrites++;return rewritten(pagination,3,'유하가 별을 세어요.');};
 const generate=async(s,b,i)=>{draws++;draw(b.pages[i],'image-tab-'+draws);return b.pages[i];};
 const held=names=>({query:async()=>{queries++;return {held:names.map(name=>({name,mode:'exclusive',clientId:'tab-b'})),pending:[]};}});
 try{
  // Another tab runs this job: no paid page tool starts, nothing is billed or saved.
  useLocks(held(['donghwa-full-auto-'+job.id]));
  const rows=book.textUsage.calls.length;
  await assert.rejects(rewriteBookPage(state,book,3,{save,rewrite}),/FULL AUTO가 이 책을 만드는 중/);
  await assert.rejects(generateBookPageImage(state,book,3,{save,generate}),/FULL AUTO가 이 책을 만드는 중/);
  assert.deepEqual([rewrites,draws,queries],[0,0,2]);assert.equal(book.textUsage.calls.length,rows);
  assert.equal(isPageOperationBusy(book.id),false);
  // A run that starts in this tab while the query is pending is caught after it.
  useLocks({query:async()=>{job.status='running';return {held:[],pending:[]};}});
  await assert.rejects(generateBookPageImage(state,book,3,{save,generate}),/만드는 중/);
  job.status='pages-ready';
  // Another job's lock, an unavailable query or no query at all never block the parent.
  useLocks(held(['donghwa-full-auto-other-job']));
  assert.equal((await rewriteBookPage(state,book,3,{save,rewrite})).changed,true);
  useLocks({query:async()=>{throw Error('locks unavailable');}});
  assert.equal((await generateBookPageImage(state,book,3,{save,generate})).imageAssetId,'image-tab-1');
  useLocks({request:async()=>{}});
  assert.equal((await generateBookPageImage(state,book,4,{save,generate})).imageAssetId,'image-tab-2');
  assert.deepEqual([rewrites,draws],[1,2]);
  // A demo book never pays for a rewrite, so it needs no lock check.
  useLocks(held(['donghwa-full-auto-'+job.id]));queries=0;
  book.textDemo=true;
  assert.deepEqual(await rewriteBookPage(state,book,3,{save,rewrite}),{changed:false,demo:true});assert.equal(queries,0);
 }finally{
  if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;
 }
});
