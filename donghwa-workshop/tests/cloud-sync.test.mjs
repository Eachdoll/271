import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudSync,hashCloudState,CLOUD_SYNC_STORAGE_KEY} from '../dist/cloud-sync.js';

const copy=value=>JSON.parse(JSON.stringify(value));
const png='data:image/png;base64,iVBORw0KGgo=';
const imageId='image-family-sheet-0123456789',audioId='audio-family-recording-0123456789';
const digest=async bytes=>Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
const library=(name='유하')=>({books:[{id:'book-one',title:'우리 집 모험',pages:[{ko:'유하가 문을 열어요.',en:'Yuha opens the door.'}]}],characters:[{id:'child',name}],backgrounds:[{id:'home',name:'우리 집',layout:'왼쪽 노란 문'}],worlds:[{id:'world-one',name:'우리 세상'}],settings:{pinHash:'device-pin',readingKoLevel:'K2'},storyDrafts:{}});
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function memoryStorage(initial={}) {const values=new Map(Object.entries(initial));return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}
async function baseline(state,revision=1,accountId='owner-A') {return {[CLOUD_SYNC_STORAGE_KEY]:JSON.stringify({accountId,revision,stateHash:await hashCloudState(state),updatedAt:'2026-10-15T00:00:00Z'})};}
async function media(id,dataUrl,kind='image') {
  const comma=dataUrl.indexOf(','),bytes=Buffer.from(dataUrl.slice(comma+1),'base64'),mimeType=dataUrl.slice(5,dataUrl.indexOf(';')).toLowerCase();
  return {asset:{id,kind,mimeType,size:bytes.length,sha256:await digest(bytes)},bytes};
}
function server({state=null,revision=state?1:0,manifest=[],assets=[]}={}) {
  const api={user:{id:'owner-A',email:'family@example.test'},state:state&&copy(state),revision,manifest:copy(manifest),assets:new Map(assets.map(item=>[item.asset.id,item])),calls:[],intercept:null};
  api.fetch=async(url,options={})=>{
    const path=String(url).replace('/api/cloud',''),method=options.method||'GET',headers=new Headers(options.headers);
    const call={path,method,headers,body:options.body,signal:options.signal};api.calls.push(call);
    const intercepted=await api.intercept?.(call);if(intercepted)return intercepted;
    if(options.signal?.aborted)throw new DOMException('cancelled','AbortError');
    if(path==='/session')return json(api.user?{authenticated:true,user:api.user}:{authenticated:false,signInPath:'/signin-with-chatgpt?return_to=%2F'});
    if(!api.user)return json({error:{code:'unauthenticated'}},401);
    assert.equal(headers.get('X-Cloud-Account-ID'),api.user.id,'all library/media requests are tied to the signed-in account');
    if(path==='/library?meta=1')return json({exists:Boolean(api.state),revision:api.revision,updatedAt:api.state?'2026-10-15T01:00:00Z':null,summary:{bookCount:api.state?.books?.length||0,characterCount:api.state?.characters?.length||0,backgroundCount:api.state?.backgrounds?.length||0}});
    if(path==='/library' && method==='GET')return json({exists:Boolean(api.state),revision:api.revision,state:api.state,manifest:api.manifest,updatedAt:api.state?'2026-10-15T01:00:00Z':null});
    if(path==='/library' && method==='PUT') {
      const body=JSON.parse(options.body);
      if(body.expectedRevision!==api.revision)return json({error:{code:'revision_conflict'},revision:api.revision},409);
      api.state=copy(body.state);api.manifest=copy(body.manifest);api.revision++;
      return json({revision:api.revision,updatedAt:'2026-10-15T02:00:00Z'});
    }
    if(path.startsWith('/media/')) {
      const id=decodeURIComponent(path.slice(7));
      if(method==='PUT') {
        const bytes=new Uint8Array(await options.body.arrayBuffer()),sha256=await digest(bytes);
        assert.equal(headers.get('X-Content-SHA256'),sha256);
        const asset={id,kind:id.startsWith('image-')?'image':'audio',mimeType:headers.get('Content-Type'),size:bytes.length,sha256};
        api.assets.set(id,{asset,bytes});return json({asset},201);
      }
      const item=api.assets.get(id);return item?new Response(item.bytes,{headers:{'Content-Type':item.asset.mimeType}}):json({error:{code:'not_found'}},404);
    }
    throw new Error('Unexpected request '+method+' '+path);
  };
  return api;
}
function client(api,initial=library(),options={}) {
  const local={state:initial,available:true,parent:true,canApply:true,applies:[],changes:[],...options.local};
  const storage=options.storage||memoryStorage();
  const sync=createCloudSync({getState:()=>local.state,hasLocalData:()=>local.available,isParent:()=>local.parent,canApplyRemote:()=>local.canApply,
    storage,fetchImpl:api.fetch,pollInterval:0,eventTarget:null,document:null,debounceMs:100000,
    onChange:status=>{local.changes.push(status);options.onChange?.(status);},
    applyRemote:async(candidate,meta)=>{local.applies.push({candidate,meta});if(options.applyRemote)return options.applyRemote(candidate,meta,local);local.state=candidate;local.available=true;},
    ...(options.makeBackup?{createLibraryBackup:options.makeBackup}:{})});
  return {sync,local,storage};
}
const writes=api=>api.calls.filter(call=>call.method==='PUT');

test('state fingerprints ignore credentials, device PINs and image object URLs but retain prose changes',async()=>{
  const first=library();first.characters[0].sheet={imageAssetId:imageId,imageUrl:'blob:first'};
  first.settings.api_key='secret-one';first.settings.parent_pin_salt='device-one';
  const other=copy(first);other.characters[0].sheet.imageUrl='blob:second';other.settings.api_key='secret-two';other.settings.pinHash='device-two';other.settings.parent_pin_salt='device-two';
  assert.equal(await hashCloudState(first),await hashCloudState(other));
  other.books[0].pages[0].ko+=' 작은 노란 문이에요.';
  assert.notEqual(await hashCloudState(first),await hashCloudState(other));
});

test('a first local library waits for explicit upload and keeps PINs and credentials out of the cloud',async()=>{
  const api=server(),state=library();state.settings.apiKey='never-upload';state.worlds[0].parent_pin_verifier='device-only';
  const {sync,storage}=client(api,state);
  try {
    await sync.start();assert.equal(sync.getStatus().phase,'choice');assert.equal(sync.getStatus().reason,'initial-upload');assert.equal(writes(api).length,0);
    await sync.push();assert.equal(sync.getStatus().phase,'ready');assert.equal(api.revision,1);
    assert.equal(api.state.settings.pinHash,undefined);assert.equal(api.state.settings.apiKey,undefined);assert.equal(api.state.worlds[0].parent_pin_verifier,undefined);
    const saved=JSON.parse(storage.getItem(CLOUD_SYNC_STORAGE_KEY));assert.equal(saved.accountId,'owner-A');assert.equal(saved.revision,1);assert.equal(saved.stateHash,await hashCloudState(state));
  } finally {sync.stop();}
});

test('a fresh second device downloads verified media and hands it to the atomic local apply callback',async()=>{
  const asset=await media(imageId,png),remote=library('클라우드 유하');remote.characters[0].sheet={imageAssetId:imageId,imageUrl:'asset:'+imageId};delete remote.settings.pinHash;
  const api=server({state:remote,manifest:[asset.asset],assets:[asset]});
  const {sync,local,storage}=client(api,library(),{local:{available:false},applyRemote:async(candidate,meta,local)=>{
    assert.equal(local.state.characters[0].name,'유하','live state is untouched until caller backs it up and restores media');
    assert.deepEqual(candidate._restoreAssets,[{id:imageId,dataUrl:png}]);assert.equal(meta.user.id,'owner-A');assert.equal(meta.signal.aborted,false);
    assert.equal(Object.keys(candidate).includes('_restoreAssets'),false);
    candidate.settings.pinHash=local.state.settings.pinHash;local.state=candidate;
  }});
  try {await sync.start();assert.equal(local.state.characters[0].name,'클라우드 유하');assert.equal(local.state.settings.pinHash,'device-pin');assert.equal(local.applies.length,1);assert.equal(writes(api).length,0);assert.equal(sync.getStatus().phase,'ready');assert.equal(JSON.parse(storage.getItem(CLOUD_SYNC_STORAGE_KEY)).stateHash,await hashCloudState(local.state));}
  finally {sync.stop();}
});

test('unconnected local and cloud libraries require a deliberate source choice',async()=>{
  const api=server({state:library('원격')}),{sync,local}=client(api,library('기기'));
  try {await sync.start();assert.equal(sync.getStatus().reason,'choose-source');assert.equal(local.state.characters[0].name,'기기');await assert.rejects(sync.push(),{code:'CONFLICT'});assert.equal(api.state.characters[0].name,'원격');await sync.push({force:true});assert.equal(api.state.characters[0].name,'기기');assert.equal(api.revision,2);}
  finally {sync.stop();}
});

test('a connected local edit uploads once, while a clean device automatically receives a newer revision',async()=>{
  const state=library(),api=server({state}),{sync,local}=client(api,state,{storage:memoryStorage(await baseline(state))});
  try {
    await sync.start();assert.equal(writes(api).length,0);
    local.state.backgrounds[0].layout='오른쪽 둥근 창';sync.changed();await sync.refresh();assert.equal(api.revision,2);assert.equal(api.state.backgrounds[0].layout,'오른쪽 둥근 창');assert.equal(sync.getStatus().dirty,false);
    api.state.backgrounds[0].layout='오른쪽 둥근 창과 왼쪽 문';api.revision=3;await sync.refresh();assert.equal(local.state.backgrounds[0].layout,api.state.backgrounds[0].layout);assert.equal(local.applies.length,1);assert.equal(writes(api).length,1);
  } finally {sync.stop();}
});

test('simultaneous local and remote changes remain intact until the parent chooses a source',async()=>{
  const state=library(),api=server({state}),{sync,local}=client(api,state,{storage:memoryStorage(await baseline(state))});
  try {await sync.start();local.state.characters[0].name='기기 편집';sync.changed();api.state.characters[0].name='다른 기기 편집';api.revision=2;await sync.refresh();assert.equal(sync.getStatus().phase,'conflict');assert.equal(writes(api).length,0);assert.equal(local.state.characters[0].name,'기기 편집');assert.equal(api.state.characters[0].name,'다른 기기 편집');await sync.pull();assert.equal(local.state.characters[0].name,'다른 기기 편집');assert.equal(sync.getStatus().dirty,false);}
  finally {sync.stop();}
});

test('corrupt media never reaches applyRemote or advances the saved revision',async()=>{
  const asset=await media(imageId,png),remote=library();remote.characters[0].sheet={imageAssetId:imageId,imageUrl:'asset:'+imageId};
  const api=server({state:remote,manifest:[asset.asset],assets:[{...asset,bytes:Buffer.from('corrupt!')}]});
  const {sync,local,storage}=client(api,library(),{local:{available:false}});
  try {await sync.start();assert.equal(sync.getStatus().phase,'error');assert.match(sync.getStatus().error,/내용이 일치/);assert.equal(local.applies.length,0);assert.equal(storage.getItem(CLOUD_SYNC_STORAGE_KEY),null);assert.equal(local.state.characters[0].sheet,undefined);}
  finally {sync.stop();}
});

test('an edit during a remote download cancels application without changing the existing local draft',async()=>{
  const asset=await media(imageId,png),remote=library('원격');remote.characters[0].sheet={imageAssetId:imageId,imageUrl:'asset:'+imageId};
  const api=server({state:remote,manifest:[asset.asset],assets:[asset]}),gate=deferred(),entered=deferred();
  api.intercept=async call=>{if(call.path.startsWith('/media/')){entered.resolve();await gate.promise;}};
  const {sync,local,storage}=client(api,library(),{local:{available:false}});
  const opening=sync.start();await entered.promise;local.state.storyDrafts.saved={prose:'기기에 막 저장한 글'};local.available=true;sync.changed();gate.resolve();
  try {await opening;assert.equal(sync.getStatus().phase,'conflict');assert.equal(local.state.storyDrafts.saved.prose,'기기에 막 저장한 글');assert.equal(local.applies.length,0);assert.equal(storage.getItem(CLOUD_SYNC_STORAGE_KEY),null);}
  finally {sync.stop();}
});

test('a cancelled or failed local restore never commits a baseline',async()=>{
  for(const fail of [false,new Error('기기 저장 실패')]) {
    const api=server({state:library('원격')}),{sync,local,storage}=client(api,library(),{local:{available:false},applyRemote:async()=>{if(fail instanceof Error)throw fail;return false;}});
    try {await sync.start();assert.equal(local.state.characters[0].name,'유하');assert.equal(storage.getItem(CLOUD_SYNC_STORAGE_KEY),null);assert.equal(sync.getStatus().phase,fail===false?'choice':'error');}
    finally {sync.stop();}
  }
});

test('switching accounts even before a first upload blocks local data from the new account',async()=>{
  const api=server(),{sync}=client(api);
  try {await sync.start();api.user={id:'owner-B'};await sync.refresh();assert.equal(sync.getStatus().phase,'account-changed');assert.equal(sync.getStatus().canPush,false);await assert.rejects(sync.push({force:true}),{code:'ACCOUNT_CHANGED'});assert.equal(writes(api).length,0);
    api.state=library('B 계정 책장');api.revision=1;await sync.pull();assert.equal(sync.getStatus().phase,'ready');assert.equal(sync.getStatus().user.id,'owner-B');}
  finally {sync.stop();}
});

test('the nested account_changed 403 response is distinguished from sign-out and never uploads',async()=>{
  const api=server();api.intercept=async call=>call.path.startsWith('/library')?json({error:{code:'account_changed',message:'account changed'}},403):null;
  const {sync}=client(api);
  try {await sync.start();assert.equal(sync.getStatus().phase,'account-changed');assert.equal(sync.getStatus().authenticated,true);assert.equal(sync.getStatus().canPush,false);assert.equal(writes(api).length,0);}
  finally {sync.stop();}
});

test('signed-out, unavailable and network failures leave the local library usable',async()=>{
  for(const mode of ['signed-out','unavailable','offline']) {
    const api=server();if(mode==='signed-out')api.user=null;
    if(mode==='unavailable')api.intercept=async call=>call.path.startsWith('/library')?json({error:{code:'storage_unavailable'}},503):null;
    if(mode==='offline')api.intercept=async()=>{throw new Error('offline');};
    const {sync,local}=client(api);const before=JSON.stringify(local.state);
    try {await sync.start();assert.equal(sync.getStatus().phase,mode==='offline'?'error':mode);assert.equal(JSON.stringify(local.state),before);assert.equal(local.applies.length,0);assert.equal(writes(api).length,0);if(mode==='signed-out')assert.match(sync.getStatus().signInPath,/^\/signin-with-chatgpt/);}
    finally {sync.stop();}
  }
});

test('an open in-memory editor defers automatic replacement until it can safely apply',async()=>{
  const asset=await media(imageId,png),remote=library('원격');remote.characters[0].sheet={imageAssetId:imageId,imageUrl:'asset:'+imageId};
  const api=server({state:remote,manifest:[asset.asset],assets:[asset]}),{sync,local}=client(api,library(),{local:{available:false,canApply:false}});
  try {await sync.start();assert.equal(sync.getStatus().phase,'paused');assert.equal(sync.getStatus().reason,'editor-open');assert.equal(api.calls.filter(call=>call.path.startsWith('/media/')).length,0);await assert.rejects(sync.pull(),{code:'EDITOR_OPEN'});assert.equal(local.applies.length,0);local.canApply=true;await sync.refresh();assert.equal(sync.getStatus().phase,'ready');assert.equal(local.state.characters[0].name,'원격');}
  finally {sync.stop();}
});

test('the editor guard is checked again after slow media downloads',async()=>{
  const asset=await media(imageId,png),remote=library('원격');remote.characters[0].sheet={imageAssetId:imageId,imageUrl:'asset:'+imageId};
  const api=server({state:remote,manifest:[asset.asset],assets:[asset]}),gate=deferred(),entered=deferred();
  api.intercept=async call=>{if(call.path.startsWith('/media/')){entered.resolve();await gate.promise;}};
  const {sync,local}=client(api,library(),{local:{available:false}}),opening=sync.start();await entered.promise;local.canApply=false;gate.resolve();
  try {await opening;assert.equal(sync.getStatus().phase,'paused');assert.equal(local.applies.length,0);}
  finally {sync.stop();}
});

test('newly externalized style images get stable content IDs while existing generated IDs stay unchanged',async()=>{
  const original=library();original.characters[0].sheet={imageAssetId:imageId,imageUrl:'blob:local-sheet'};original.stylePresets=[{id:'custom',styleRefImages:[png]}];
  let exports=0;
  const makeBackup=async state=>{
    const snapshot=copy(state),allocated='image-random-style-'+String(++exports).padStart(12,'0');
    snapshot.stylePresets[0].styleRefImages=['asset:'+allocated];snapshot.stylePresets[0].styleRefImageIds=[allocated];snapshot.styleSheetImages=[{imageAssetId:allocated,imageUrl:'asset:'+allocated}];
    return {snapshot,imageAssets:[{id:imageId,dataUrl:png},{id:allocated,dataUrl:png}],audioAssets:[]};
  };
  const api=server(),{sync,local}=client(api,original,{makeBackup});
  try {
    await sync.start();await sync.push();const firstIds=api.manifest.map(item=>item.id),firstMediaWrites=api.calls.filter(call=>call.path.startsWith('/media/')&&call.method==='PUT').length;
    assert.ok(firstIds.includes(imageId));assert.ok(firstIds.some(id=>/^image-cloud-[a-f0-9]{64}$/.test(id)));assert.equal(local.state.stylePresets[0].styleRefImages[0],png,'cloud preparation never changes live style references');
    local.state.settings.readingKoLevel='K3';sync.changed();await sync.refresh();assert.deepEqual(api.manifest.map(item=>item.id),firstIds);assert.equal(api.calls.filter(call=>call.path.startsWith('/media/')&&call.method==='PUT').length,firstMediaWrites,'unchanged binary assets are reused across autosaves');assert.ok(!JSON.stringify(api.state).includes('blob:'));
  } finally {sync.stop();}
});

test('mobile recording codec parameters normalize in the manifest without changing audio bytes',async()=>{
  const state=library();state.books[0].audio={pages:{0:{ko:{recording:{assetId:audioId}}}}};
  const makeBackup=async state=>({snapshot:copy(state),imageAssets:[],audioAssets:[{id:audioId,dataUrl:'data:video/webm;codecs=opus;base64,dm9pY2U='}]});
  const api=server(),{sync}=client(api,state,{makeBackup});
  try {await sync.start();await sync.push();assert.equal(api.manifest[0].mimeType,'video/webm');assert.equal(api.manifest[0].kind,'audio');assert.equal(Buffer.from(api.assets.get(audioId).bytes).toString(),'voice');await sync.pull();assert.equal(sync.getStatus().phase,'ready');}
  finally {sync.stop();}
});

test('an upload losing the revision race does not overwrite either library or advance the baseline',async()=>{
  const state=library(),api=server({state}),storage=memoryStorage(await baseline(state)),{sync,local}=client(api,state,{storage});
  try {
    await sync.start();local.state.characters[0].name='기기 초안';sync.changed();
    api.intercept=async call=>{if(call.path==='/library'&&call.method==='PUT'){api.revision=2;api.state=library('동시 저장');return json({error:{code:'revision_conflict'},revision:2},409);}};
    await sync.refresh();assert.equal(sync.getStatus().phase,'conflict');assert.equal(api.state.characters[0].name,'동시 저장');assert.equal(local.state.characters[0].name,'기기 초안');assert.equal(JSON.parse(storage.getItem(CLOUD_SYNC_STORAGE_KEY)).revision,1);
  } finally {sync.stop();}
});

test('edits made while uploading remain dirty and are saved in a following revision',async()=>{
  const api=server(),{sync,local,storage}=client(api),gate=deferred(),entered=deferred();
  await sync.start();api.intercept=async call=>{if(call.path==='/library'&&call.method==='PUT'){entered.resolve();await gate.promise;}};
  const upload=sync.push();await entered.promise;local.state.characters[0].name='전송 중 새 편집';sync.changed();gate.resolve();
  try {await upload;assert.equal(api.state.characters[0].name,'유하');assert.equal(sync.getStatus().dirty,true);assert.notEqual(JSON.parse(storage.getItem(CLOUD_SYNC_STORAGE_KEY)).stateHash,await hashCloudState(local.state));api.intercept=null;await sync.refresh();assert.equal(api.state.characters[0].name,'전송 중 새 편집');assert.equal(sync.getStatus().dirty,false);assert.equal(api.revision,2);}
  finally {sync.stop();}
});

test('stopping a pending cloud read prevents remote state application and baseline writes',async()=>{
  const api=server({state:library('원격')}),gate=deferred(),entered=deferred();api.intercept=async call=>{if(call.path==='/library'){entered.resolve();await gate.promise;}};
  const {sync,local,storage}=client(api,library(),{local:{available:false}}),opening=sync.start();await entered.promise;sync.stop();gate.resolve();await opening;
  assert.equal(sync.getStatus().phase,'stopped');assert.equal(local.applies.length,0);assert.equal(storage.getItem(CLOUD_SYNC_STORAGE_KEY),null);assert.equal(local.state.characters[0].name,'유하');
});

test('A-3 unchanged polling never requests full state or media',async()=>{
  const state=library(),api=server({state}),{sync}=client(api,state,{storage:memoryStorage(await baseline(state))});
  try {await sync.start();await sync.refresh();await sync.refresh();assert.equal(api.calls.filter(c=>c.path==='/library').length,0);assert.equal(api.calls.filter(c=>c.path==='/library?meta=1').length,3);}
  finally {sync.stop();}
});
test('A-1 blocked autosave does no backup or upload then flushes exactly once after guard clears',async()=>{
  const state=library(),api=server({state});let backups=0;
  const {sync,local}=client(api,state,{storage:memoryStorage(await baseline(state)),makeBackup:async(state,options)=>{backups++;assert.equal(options.mode,'blobs');return {snapshot:copy(state),assets:new Map()};}});
  try {await sync.start();local.state.characters[0].name='수정';local.canApply=false;sync.changed();await sync.refresh();await sync.refresh();assert.equal(backups,0);assert.equal(writes(api).length,0);assert.equal(sync.getStatus().dirty,true);local.canApply=true;await sync.refresh();await sync.refresh();assert.equal(backups,1);assert.equal(writes(api).length,1);}
  finally {sync.stop();}
});
test('A-1 unchanged Blob bytes are read only once for digesting',async()=>{
  const {hashMediaBlob}=await import('../dist/cloud-sync.js');const blob=new Blob(['bytes'],{type:'image/png'}),arrayBuffer=blob.arrayBuffer.bind(blob);let reads=0;blob.arrayBuffer=()=>{reads++;return arrayBuffer();};
  assert.equal(await hashMediaBlob(blob),await hashMediaBlob(blob));assert.equal(reads,1);
});
test('A-11 a push waits for the refresh already in flight',async()=>{
  const state=library(),api=server({state}),gate=deferred(),entered=deferred(),{sync}=client(api,state,{storage:memoryStorage(await baseline(state))});
  try {await sync.start();api.intercept=async c=>{if(c.path==='/library?meta=1'){entered.resolve();await gate.promise;}};const refreshing=sync.refresh();await entered.promise;const pushing=sync.push();gate.resolve();await Promise.all([refreshing,pushing]);assert.equal(sync.getStatus().phase,'ready');assert.equal(writes(api).length,1);}
  finally {sync.stop();}
});
test('A-11 identical remote state advances a stale baseline instead of claiming a conflict',async()=>{
  const state=library(),api=server({state,revision:2}),{sync,storage}=client(api,state,{storage:memoryStorage(await baseline(state,1))});
  try {await sync.start();assert.equal(sync.getStatus().phase,'ready');assert.equal(JSON.parse(storage.getItem(CLOUD_SYNC_STORAGE_KEY)).revision,2);assert.equal(writes(api).length,0);}
  finally {sync.stop();}
});
test('R2-8 an explicit push executes after the in-flight refresh encounters a network error',async()=>{
 const api=server(),{sync}=client(api),gate=deferred(),entered=deferred();
 try {
  await sync.start();let failed=false;
  api.intercept=async call=>{if(call.path==='/library?meta=1'&&!failed){failed=true;entered.resolve();await gate.promise;throw new TypeError('network offline');}};
  const refreshing=sync.refresh();await entered.promise;const pushing=sync.push();gate.resolve();await refreshing;await pushing;
  assert.equal(writes(api).length,1);assert.equal(sync.getStatus().phase,'ready');
 } finally {sync.stop();}
});
test('R2-8 a rejected refresh promise cannot reject an explicitly queued push',async()=>{
 const api=server(),gate=deferred(),entered=deferred();let reportFailure=true;
 const {sync}=client(api,library(),{onChange:status=>{if(status.phase==='error'&&reportFailure){reportFailure=false;throw Object.assign(new Error('refresh error observer'),{code:'NETWORK_ERROR'});}}});
 try {
  await sync.start();let failed=false;
  api.intercept=async call=>{if(call.path==='/library?meta=1'&&!failed){failed=true;entered.resolve();await gate.promise;throw new TypeError('network offline');}};
  const refreshing=assert.rejects(sync.refresh(),{code:'NETWORK_ERROR'});await entered.promise;const pushing=sync.push();gate.resolve();await refreshing;await pushing;
  assert.equal(writes(api).length,1);assert.equal(sync.getStatus().phase,'ready');
 } finally {sync.stop();}
});
