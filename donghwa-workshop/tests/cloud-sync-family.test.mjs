// R11 동기화 안정화: 가족이 한 계정을 아이 태블릿·부모 휴대폰·PC에서 함께 쓸 때.
// 읽기 기록은 변경·충돌로 보지 않고, 샘플만 있는 새 기기는 클라우드를 그대로 받으며,
// 클라우드보다 책이 적은 기기에서 덮어쓰기 전에 권수를 알려 줍니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCloudSync,hashCloudState,mergeReadingStats,isSeedOnlyLibrary,pushBookCountWarning,CLOUD_SYNC_STORAGE_KEY} from '../dist/cloud-sync.js';
import {seedState} from '../dist/engine.js';
import {migrateWorldState} from '../dist/image-generation/world.js';

const copy=value=>JSON.parse(JSON.stringify(value));
const digest=async bytes=>Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const png='data:image/png;base64,iVBORw0KGgo=',imageId='image-family-sheet-0123456789';
const book=(id,title)=>({id,title,pages:[{ko:title+' 첫 쪽이에요.',en:'The first page.'}]});
const library=()=>({books:[book('book-one','우리 집 모험'),book('book-two','달님 산책')],characters:[{id:'child',name:'유하'}],backgrounds:[{id:'home',name:'우리 집'}],worlds:[{id:'world-one',name:'우리 세상'}],settings:{pinHash:'device-pin'},storyDrafts:{},daily:{}});
function memoryStorage(initial={}) {const values=new Map(Object.entries(initial));return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}
async function baseline(state,{revision=1,hash}={}) {return memoryStorage({[CLOUD_SYNC_STORAGE_KEY]:JSON.stringify({accountId:'owner-A',revision,stateHash:hash||await hashCloudState(state),updatedAt:'2026-10-15T00:00:00Z'})});}
// The fingerprint before R11 (reading statistics included) for a state without images or credentials besides the PIN.
const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>key!=='pinHash').map(key=>[key,sorted(value[key])])):value;
const legacyHash=state=>digest(Buffer.from(JSON.stringify(sorted(state))));
const saved=storage=>JSON.parse(storage.getItem(CLOUD_SYNC_STORAGE_KEY));
const today='2026-10-19';
function read(state,id,at='2026-10-19T08:00:00.000Z') {const b=state.books.find(item=>item.id===id);state.daily[today]=(state.daily[today]||0)+1;b.reads=(b.reads||0)+1;b.lastReadAt=at;}
async function until(predicate,ms=1000) {const end=Date.now()+ms;while(!predicate()){if(Date.now()>end)return false;await new Promise(done=>setTimeout(done,5));}return true;}

function server({state=null,revision=state?1:0,manifest=[],assets=[]}={}) {
  const api={user:{id:'owner-A'},state:state&&copy(state),revision,manifest:copy(manifest),assets:new Map(assets.map(item=>[item.asset.id,item])),calls:[],intercept:null};
  api.fetch=async(url,options={})=>{
    const path=String(url).replace('/api/cloud',''),method=options.method||'GET';
    const call={path,method};api.calls.push(call);
    const intercepted=await api.intercept?.(call);if(intercepted)return intercepted;
    if(path==='/session')return json({authenticated:true,user:api.user});
    if(path==='/library?meta=1')return json({exists:Boolean(api.state),revision:api.revision,updatedAt:api.state?'2026-10-15T01:00:00Z':null,summary:{bookCount:api.state?.books?.length||0,characterCount:api.state?.characters?.length||0,backgroundCount:api.state?.backgrounds?.length||0}});
    if(path==='/library'&&method==='GET')return json({exists:Boolean(api.state),revision:api.revision,state:api.state,manifest:api.manifest,updatedAt:api.state?'2026-10-15T01:00:00Z':null});
    if(path==='/library'&&method==='PUT') {
      const body=JSON.parse(options.body);
      if(body.expectedRevision!==api.revision)return json({error:{code:'revision_conflict'},revision:api.revision},409);
      api.state=copy(body.state);api.manifest=copy(body.manifest);api.revision++;return json({revision:api.revision,updatedAt:'2026-10-15T02:00:00Z'});
    }
    if(path.startsWith('/media/')&&method==='GET'){const item=api.assets.get(decodeURIComponent(path.slice(7)));return new Response(item.bytes,{headers:{'Content-Type':item.asset.mimeType}});}
    throw new Error('Unexpected request '+method+' '+path);
  };
  return api;
}
function client(api,initial,{parent=true,available=()=>true,storage=memoryStorage(),makeBackup}={}) {
  const local={state:initial,applies:[]};
  const sync=createCloudSync({getState:()=>local.state,hasLocalData:()=>available(local.state),isParent:()=>parent,canApplyRemote:()=>true,
    storage,fetchImpl:api.fetch,pollInterval:0,eventTarget:null,document:null,debounceMs:100000,
    applyRemote:async candidate=>{local.applies.push(copy(candidate));candidate.settings={...candidate.settings,pinHash:local.state.settings?.pinHash};local.state=candidate;},
    ...(makeBackup?{createLibraryBackup:makeBackup}:{})});
  return {sync,local,storage};
}
const writes=api=>api.calls.filter(call=>call.method==='PUT');

test('reading statistics are left out of the change fingerprint, library content is not',async()=>{
  const state=library(),before=await hashCloudState(state);
  read(state,'book-one');state.books[1].paperReads=2;state.books[1].paperReadAt='2026-10-18T09:00:00Z';
  assert.equal(await hashCloudState(state),before,'daily, reads, lastReadAt, paperReads and paperReadAt are per-device reading counters');
  state.books[0].title='새 제목';
  assert.notEqual(await hashCloudState(state),before);
  state.books[0].title='우리 집 모험';state.books[0].favorite=true;
  assert.notEqual(await hashCloudState(state),before,'a parent favourite is a real change');
});

test('a child device that only reads stays ready and still applies a newer remote',async()=>{
  const state=library(),api=server({state}),{sync,local}=client(api,copy(state),{parent:false,storage:await baseline(state)});
  try {
    await sync.start();assert.equal(sync.getStatus().phase,'ready');assert.equal(sync.getStatus().dirty,false);
    read(local.state,'book-one');read(local.state,'book-one');sync.changed();
    assert.ok(await until(()=>sync.getStatus().dirty===false),'a reading-only save settles back to saved without a request');
    assert.equal(sync.getStatus().phase,'ready');assert.equal(sync.getStatus().reason,null);
    await sync.refresh();assert.equal(sync.getStatus().phase,'ready');assert.equal(sync.getStatus().dirty,false);
    // A parent phone saves a new book.
    api.state.books.push(book('book-three','바닷가 선물'));api.revision=2;
    await sync.refresh();
    assert.equal(sync.getStatus().phase,'ready','not a conflict');assert.equal(sync.getStatus().dirty,false);
    assert.deepEqual(local.state.books.map(b=>b.id),['book-one','book-two','book-three']);
    assert.equal(local.state.books[0].reads,2,"the child's reading count survives the apply");
    assert.equal(local.state.daily[today],2);
    assert.equal(writes(api).length,0,'the child device never uploads');
  } finally {sync.stop();}
});

test('reading statistics survive a remote apply: larger count, later time, larger daily value',async()=>{
  const state=library();state.books[0].reads=5;state.books[0].lastReadAt='2026-10-10T08:00:00Z';state.books[1].reads=1;state.books[1].paperReads=3;state.books[1].paperReadAt='2026-10-19T07:00:00Z';state.daily={'2026-10-10':3,'2026-10-11':1};
  const remote=library();remote.books[0].reads=2;remote.books[0].lastReadAt='2026-10-12T08:00:00Z';remote.books[1].reads=4;remote.books[1].lastReadAt='2026-10-09T08:00:00Z';remote.books[1].title='달님 산책 (고침)';remote.books.push({...book('book-new','새 책'),reads:7});remote.daily={'2026-10-10':1,'2026-10-12':2};
  state.books.push({...book('book-local-only','지운 책'),reads:9});
  const api=server({state:remote,revision:2}),{sync,local}=client(api,state,{storage:await baseline(library())});
  try {
    await sync.start();
    assert.equal(sync.getStatus().phase,'conflict','this device also changed content, so the parent chooses');
    await sync.pull();
    const byId=Object.fromEntries(local.state.books.map(b=>[b.id,b]));
    assert.equal(byId['book-one'].reads,5);assert.equal(byId['book-one'].lastReadAt,'2026-10-12T08:00:00Z');
    assert.equal(byId['book-two'].reads,4);assert.equal(byId['book-two'].lastReadAt,'2026-10-09T08:00:00Z');assert.equal(byId['book-two'].title,'달님 산책 (고침)');
    assert.equal(byId['book-two'].paperReads,3);assert.equal(byId['book-two'].paperReadAt,'2026-10-19T07:00:00Z');
    assert.equal(byId['book-new'].reads,7);assert.equal(byId['book-local-only'],undefined,'only books on both sides are merged');
    assert.deepEqual(local.state.daily,{'2026-10-10':3,'2026-10-11':1,'2026-10-12':2});
    assert.equal(sync.getStatus().dirty,false,'merged statistics do not make the device dirty');
  } finally {sync.stop();}
  const target={books:[{id:'a',reads:'2',lastReadAt:'not a date'}],daily:{}};
  mergeReadingStats(target,{books:[{id:'a',reads:1,lastReadAt:'2026-10-01T00:00:00Z'}],daily:JSON.parse('{"__proto__":5,"2026-10-01":2}')});
  assert.deepEqual(target,{books:[{id:'a',reads:'2',lastReadAt:'2026-10-01T00:00:00Z'}],daily:{'2026-10-01':2}});
});

test('opening a book during a remote download no longer cancels the apply',async()=>{
  const bytes=Buffer.from(png.slice(png.indexOf(',')+1),'base64'),asset={id:imageId,kind:'image',mimeType:'image/png',size:bytes.length,sha256:await digest(bytes)};
  const state=library(),remote=library();remote.characters[0].sheet={imageAssetId:imageId,imageUrl:'asset:'+imageId};
  const api=server({state:remote,revision:2,manifest:[asset],assets:[{asset,bytes}]}),gate=deferred(),entered=deferred();
  api.intercept=async call=>{if(call.path.startsWith('/media/')){entered.resolve();await gate.promise;}};
  const {sync,local}=client(api,copy(state),{parent:false,storage:await baseline(state)}),opening=sync.start();
  await entered.promise;read(local.state,'book-two');sync.changed();gate.resolve();
  try {await opening;assert.equal(sync.getStatus().phase,'ready');assert.equal(local.applies.length,1);assert.equal(local.state.characters[0].sheet.imageAssetId,imageId);assert.equal(local.state.books[1].reads,1);}
  finally {sync.stop();}
});

test('a baseline saved before R11 upgrades silently instead of uploading or conflicting',async()=>{
  const state=library();read(state,'book-one');
  // Untouched device: the old fingerprint still matches.
  {const api=server({state}),storage=await baseline(state,{hash:await legacyHash(state)}),{sync}=client(api,copy(state),{storage});
    try {await sync.start();assert.equal(sync.getStatus().phase,'ready');assert.equal(sync.getStatus().dirty,false);assert.equal(writes(api).length,0);assert.equal(api.calls.filter(c=>c.path==='/library').length,0);assert.equal(saved(storage).hashVersion,2);assert.equal(saved(storage).stateHash,await hashCloudState(state));}
    finally {sync.stop();}}
  // Child tablet that read since its last sync: content equals the cloud, so it upgrades and keeps receiving.
  {const api=server({state}),storage=await baseline(state,{hash:await legacyHash(state)}),child=copy(state);read(child,'book-one');
    const {sync,local}=client(api,child,{parent:false,storage});
    try {await sync.start();assert.equal(sync.getStatus().phase,'ready');assert.equal(sync.getStatus().dirty,false);assert.equal(saved(storage).hashVersion,2);
      api.state.books[1].title='새 이야기';api.revision=2;await sync.refresh();assert.equal(sync.getStatus().phase,'ready');assert.equal(local.state.books[1].title,'새 이야기');assert.equal(local.state.books[0].reads,2);assert.equal(writes(api).length,0);}
    finally {sync.stop();}}
});

test('a real edit on both sides is still a conflict, worded as another device having just saved',async()=>{
  const state=library(),api=server({state}),{sync,local}=client(api,copy(state),{storage:await baseline(state)});
  try {await sync.start();local.state.characters[0].name='기기 편집';sync.changed();api.state.characters[0].name='다른 기기 편집';api.revision=2;await sync.refresh();
    assert.equal(sync.getStatus().phase,'conflict');assert.match(sync.getStatus().error,/^다른 기기에서 방금 저장했어요\./);assert.equal(writes(api).length,0);}
  finally {sync.stop();}
});

// The sample library as dist/app.js holds it after the parent sets a PIN on a new phone.
function samplePhone() {
  const state=seedState(),types={home:'home',forest:'forest',moon:'space',garden:'forest',beach:'sea'};
  state.backgrounds=state.backgrounds.map(b=>({...b,type:b.type||types[b.id]||'forest'}));
  state.daily={};migrateWorldState(state);
  state.settings={...state.settings,pinHash:'phone-pin',defaultPages:12,dailyLimit:3,textGeneration:{engine:'openai'}};
  return copy(state);
}
const sampleReference=(()=>{const seed=seedState(),types={home:'home',forest:'forest',moon:'space',garden:'forest',beach:'sea'};seed.backgrounds=seed.backgrounds.map(b=>({...b,type:b.type||types[b.id]||'forest'}));return seed;})();

test('a library that only holds the samples is not local data; anything the family made is',()=>{
  const phone=samplePhone();
  assert.equal(isSeedOnlyLibrary(phone,sampleReference),true);
  const usage=copy(phone);usage.books[0].reads=20;usage.books[0].lastReadAt='2026-10-19T08:00:00Z';usage.books[2].favorite=true;usage.books[3].printedAt='2026-10-19T08:00:00Z';usage.daily[today]=2;usage.storyDrafts={};usage.settings.worldMemo='우리 가족 규칙';usage.worlds[0].imageEngine='openai';
  assert.equal(isSeedOnlyLibrary(usage,sampleReference),true,'reading, favourites, printing, settings and the sample World binding do not count');
  const edits={
    'a user-made book':s=>s.books.push({...s.books[0],id:'book-family',title:'우리 아이 이야기'}),
    'a renamed sample character':s=>{s.characters[0].name='민준';},
    'a generated character sheet':s=>{s.characters[0].characterSheets.push({id:'sheet-paid',imageUrl:'asset:image-paid-0000000001',meta:{source:'openai'}});},
    'a sample page with a new picture':s=>{s.books[0].pages[0].imageUrl='asset:image-page-0000000001';},
    'a new background':s=>s.backgrounds.push({id:'park',name:'놀이터',type:'forest'}),
    'a deleted sample':s=>s.books.pop(),
    'a story draft':s=>{s.storyDrafts={'draft-1':{prose:'초안'}};},
    'a FULL AUTO job':s=>{s.fullAutoJobs=[{id:'job-1'}];},
    'a custom style':s=>{s.stylePresets=[{id:'custom'}];},
    'a second World':s=>s.worlds.push({...s.worlds[0],id:'world-two'}),
    'an unknown collection':s=>{s.props=[{id:'prop-1',name:'빨간 우산'}];},
  };
  for(const [name,edit] of Object.entries(edits)){const changed=copy(phone);edit(changed);assert.equal(isSeedOnlyLibrary(changed,sampleReference),false,name);}
  assert.equal(isSeedOnlyLibrary(null,sampleReference),false);assert.equal(isSeedOnlyLibrary(phone,null),false);
});

test('a sample-only phone with a PIN takes the family cloud automatically',async()=>{
  const family=library(),api=server({state:family,revision:4}),phone=samplePhone();
  const {sync,local,storage}=client(api,phone,{available:state=>!isSeedOnlyLibrary(state,sampleReference)});
  try {
    await sync.start();
    assert.equal(local.applies.length,1,'no source choice: the cloud library is applied');
    assert.equal(sync.getStatus().phase,'ready');assert.deepEqual(local.state.books.map(b=>b.id),['book-one','book-two']);
    assert.equal(local.state.settings.pinHash,'phone-pin');assert.equal(writes(api).length,0,'the samples never replace the family cloud');assert.equal(saved(storage).revision,4);
  } finally {sync.stop();}
});

test('a phone with one book of its own still gets the explicit source choice',async()=>{
  const family=library(),api=server({state:family,revision:4}),phone=samplePhone();phone.books.push({...phone.books[0],id:'book-phone',title:'휴대폰에서 만든 책',localSample:false});
  const {sync,local}=client(api,phone,{available:state=>!isSeedOnlyLibrary(state,sampleReference)});
  try {await sync.start();assert.equal(sync.getStatus().phase,'choice');assert.equal(sync.getStatus().reason,'choose-source');assert.equal(sync.getStatus().dirty,true);assert.equal(local.applies.length,0);assert.equal(writes(api).length,0);}
  finally {sync.stop();}
});

test('the push confirmation names both book counts when this device has fewer books',()=>{
  assert.equal(pushBookCountWarning(1,5),'클라우드에는 책이 5권, 이 기기에는 1권 있어요. 저장하면 클라우드의 책장이 이 기기 것으로 바뀌어요.');
  assert.equal(pushBookCountWarning(0,2),'클라우드에는 책이 2권, 이 기기에는 0권 있어요. 저장하면 클라우드의 책장이 이 기기 것으로 바뀌어요.');
  for(const [device,cloud] of [[5,5],[6,5],[3,0],[3,undefined]])assert.equal(pushBookCountWarning(device,cloud),'');
  const app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8'),confirm=app.slice(app.indexOf('function confirmCloudChange'),app.indexOf('async function applyCloudLibrary'));
  assert.match(confirm,/pushBookCountWarning\(local\.bookCount, remote\.bookCount\)/,'the existing push confirm shows the warning');
  assert.match(confirm,/role="alert"/);
  assert.match(app,/hasLocalData: \(\) =>[\s\S]{0,200}onlySamples\(\)/,'the app treats a sample-only library as no local data');
});
