import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleCloudRequest,CLOUD_LIMITS} from '../server/cloud-api.js';

const ORIGIN='https://donghwa.example';
const IMAGE='image-cloud-fixture-0123456789',AUDIO='audio-cloud-fixture-0123456789';
const png=Uint8Array.from([137,80,78,71,13,10,26,10]);
const hash=async bytes=>Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
const state=(name='우리 집')=>({books:[],characters:[],backgrounds:[{id:'home',name}],settings:{readingKoLevel:'K2'},worlds:[]});

function environment() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../server/cloud-schema.sql',import.meta.url),'utf8'));
  const objects=new Map(),reads=[],writes=[],statements=[];
  const DB={prepare(sql){
    statements.push(sql);
    const statement=sqlite.prepare(sql);
    return {bind(...args){return {
      async first(){return statement.get(...args)||null;},
      async all(){return {results:statement.all(...args)};},
      async run(){return {meta:{changes:Number(statement.run(...args).changes)}};}
    };}};
  }};
  const BUCKET={
    async put(key,value,metadata){const bytes=value instanceof Uint8Array?value.slice():new TextEncoder().encode(value);objects.set(key,{bytes,metadata});writes.push(key);return {};},
    async get(key){reads.push(key);const record=objects.get(key);if(!record)return null;return {body:new Blob([record.bytes]).stream(),arrayBuffer:async()=>record.bytes.slice().buffer};}
  };
  return {DB,BUCKET,sqlite,objects,reads,writes,statements};
}
function request(path,{method='GET',owner='owner-A',account=owner,body,headers={},origin=ORIGIN}={}) {
  const values={...headers};
  if(owner!==null)values['oai-authenticated-user-id']=owner;
  if(account!==null)values['X-Cloud-Account-ID']=account;
  if(!['GET','HEAD'].includes(method) && origin!==null)values.Origin=origin;
  if(body && typeof body==='object' && !(body instanceof Uint8Array) && !(body instanceof ReadableStream)) {body=JSON.stringify(body);values['Content-Type']||='application/json';}
  return new Request(ORIGIN+path,{method,headers:values,body,...(body instanceof ReadableStream?{duplex:'half'}:{})});
}
async function call(env,path,options) {const response=await handleCloudRequest(request(path,options),env);return {response,status:response?.status,data:response?await response.json():null};}
async function upload(env,{owner='owner-A',id=IMAGE,bytes=png,mimeType='image/png',headers={}}={}) {
  return call(env,'/api/cloud/media/'+id,{owner,method:'PUT',body:bytes,headers:{'Content-Type':mimeType,'X-Content-SHA256':await hash(bytes),...headers}});
}
async function save(env,{owner='owner-A',revision=0,library=state(),manifest=[],...rest}={}) {
  return call(env,'/api/cloud/library',{owner,method:'PUT',body:{expectedRevision:revision,state:library,manifest},...rest});
}

test('cloud routes trust Sites identity only and keep anonymous session readable without storage',async()=>{
  const anonymous=await call({},'/api/cloud/session',{owner:null,account:null});
  assert.equal(anonymous.status,200);assert.deepEqual(anonymous.data,{authenticated:false,signInPath:'/signin-with-chatgpt?return_to=%2F'});
  assert.match(anonymous.response.headers.get('Cache-Control'),/private.*no-store/);
  assert.equal((await call({},'/api/cloud/library',{owner:null,account:null,headers:{'X-User-ID':'owner-A'}})).status,401);
  assert.equal(await handleCloudRequest(request('/assets/hero.png'),{}),null);
  const signed=await call({},'/api/cloud/session',{headers:{'oai-authenticated-user-email':'family@example.test','oai-authenticated-user-full-name':encodeURIComponent('우리 가족'),'oai-authenticated-user-full-name-encoding':'percent-encoded-utf-8'}});
  assert.deepEqual(signed.data,{authenticated:true,user:{id:'owner-A',email:'family@example.test',displayName:'우리 가족'}});
  assert.equal((await call({},'/api/cloud/library')).status,503);
});

test('library/media mutations require matching origin and account; owner metadata cannot switch accounts',async()=>{
  const env=environment();
  for(const options of [{origin:'https://other.example'},{origin:null},{account:'owner-B'},{account:null},{headers:{'Sec-Fetch-Site':'cross-site'}}]) {
    const result=await save(env,options);assert.equal(result.status,403);assert.equal(env.writes.length,0);
  }
  assert.equal((await call(env,'/api/cloud/library',{account:'owner-B'})).data.error.code,'account_changed');
  assert.equal((await save(env)).status,200);
  assert.equal((await call(env,'/api/cloud/library',{owner:'owner-B'})).data.exists,false);
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM cloud_libraries').get().n,1);
});

test('binary media is owner scoped, immutable and verified with its digest and image content',async()=>{
  const env=environment(),first=await upload(env);
  assert.equal(first.status,201);assert.deepEqual(first.data.asset,{id:IMAGE,kind:'image',mimeType:'image/png',size:8,sha256:await hash(png)});
  assert.equal((await upload(env)).data.reused,true);assert.equal(env.writes.length,1);
  const other=Uint8Array.from([...png,1]);assert.equal((await upload(env,{bytes:other})).status,409);
  assert.equal((await upload(env,{headers:{'X-Content-SHA256':'0'.repeat(64)}})).data.error.code,'digest_mismatch');
  assert.equal((await upload(env,{bytes:new TextEncoder().encode('<script>bad</script>')})).status,415);
  assert.equal((await call(env,'/api/cloud/media/'+IMAGE,{owner:'owner-B'})).status,404);
  assert.equal((await upload(env,{owner:'owner-B',bytes:other})).status,201);
  const response=await handleCloudRequest(request('/api/cloud/media/'+IMAGE),env);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),png);
  assert.equal(response.headers.get('X-Content-SHA256'),await hash(png));assert.match(response.headers.get('Content-Security-Policy'),/sandbox/);
  assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(env.objects.size,2);
  assert.ok([...env.objects.keys()].every(key=>!key.includes('owner-A')&&!key.includes('owner-B')));
});

test('mobile video/webm recordings and safe SVG previews retain media kind without executable SVG',async()=>{
  const env=environment();
  const audio=await upload(env,{id:AUDIO,bytes:new TextEncoder().encode('recorded voice'),mimeType:'video/webm;codecs=opus'});
  assert.equal(audio.status,201);assert.equal(audio.data.asset.kind,'audio');assert.equal(audio.data.asset.mimeType,'video/webm');
  const svg=new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="green"/></svg>');
  assert.equal((await upload(env,{id:'image-cloud-safe-svg-0123456789',bytes:svg,mimeType:'image/svg+xml'})).status,201);
  const unsafe=new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal((await upload(env,{id:'image-cloud-unsafe-svg-0123456789',bytes:unsafe,mimeType:'image/svg+xml'})).status,415);
});

test('library snapshots require complete own media and return exact state and manifest',async()=>{
  const env=environment(),asset=(await upload(env)).data.asset;
  const library=state();library.backgrounds[0].imageUrl='asset:'+IMAGE;library.backgrounds[0].imageAssetId=IMAGE;
  assert.equal((await save(env,{library})).data.error.code,'missing_manifest_asset');
  assert.equal((await save(env,{owner:'owner-B',library,manifest:[asset]})).data.error.code,'asset_not_uploaded');
  assert.equal((await save(env,{library,manifest:[{...asset,sha256:'f'.repeat(64)}]})).status,400);
  const saved=await save(env,{library,manifest:[asset]});assert.equal(saved.status,200);assert.equal(saved.data.revision,1);
  const read=await call(env,'/api/cloud/library');assert.equal(read.data.exists,true);assert.deepEqual(read.data.state,library);assert.deepEqual(read.data.manifest,[asset]);
  const pointer=JSON.parse(env.sqlite.prepare('SELECT state_json FROM cloud_libraries').get().state_json);
  assert.equal(pointer.storage,'r2');assert.ok(pointer.size>0);assert.ok(env.objects.has(pointer.objectKey));
  assert.ok(env.statements.every(sql=>!/^\s*(?:CREATE|ALTER|DROP)/i.test(sql)),'request handlers run no schema mutations');
});

test('compare-and-swap saves reject stale drafts and concurrent first saves without losing committed state',async()=>{
  const env=environment();
  const [a,b]=await Promise.all([save(env,{library:state('A')}),save(env,{library:state('B')})]);
  assert.deepEqual([a.status,b.status].sort(),[200,409]);
  assert.equal((a.status===409?a:b).data.revision,1);
  const original=(await call(env,'/api/cloud/library')).data.state.backgrounds[0].name;
  const conflict=await save(env,{library:state('stale')});assert.equal(conflict.status,409);assert.equal(conflict.data.revision,1);
  assert.equal((await call(env,'/api/cloud/library')).data.state.backgrounds[0].name,original);
  const next=await save(env,{revision:1,library:state('new')});assert.equal(next.data.revision,2);
  assert.equal((await save(env,{revision:1})).status,409);
  assert.equal((await call(env,'/api/cloud/library')).data.state.backgrounds[0].name,'new');
});

test('nested credentials, PINs, ephemeral media and unlisted references never enter cloud snapshots',async()=>{
  const env=environment();
  for(const field of ['apiKey','api_key','accessToken','credentials','encryptedCredentials','pinHash','parent_pin_salt','PIN','client-secret']) {
    const library=state();library.worlds=[{config:{[field]:'keep-local'}}];
    const result=await save(env,{library});assert.equal(result.status,400,field);assert.equal(result.data.error.code,'credentials_forbidden');
  }
  for(const imageUrl of ['data:image/png;base64,aGVsbG8=','blob:https://site/abc','asset:image-missing-fixture-0123456789']) {
    const library=state();library.backgrounds[0].imageUrl=imageUrl;
    assert.equal((await save(env,{library})).status,400);
  }
  assert.equal(env.writes.length,0);assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM cloud_libraries').get().n,0);
});

test('streaming binary limits, malformed JSON and size limits fail before writes',async()=>{
  const env=environment();
  const declared=await upload(env,{headers:{'Content-Length':String(CLOUD_LIMITS.mediaBytes+1)}});assert.equal(declared.status,413);
  let chunks=0;
  const stream=new ReadableStream({pull(controller){if(++chunks<=41)controller.enqueue(new Uint8Array(1024*1024));else controller.close();}});
  const streamed=await call(env,'/api/cloud/media/'+IMAGE,{method:'PUT',body:stream,headers:{'Content-Type':'image/png','X-Content-SHA256':'0'.repeat(64)}});
  assert.equal(streamed.status,413);assert.equal(env.writes.length,0);
  const invalid=await call(env,'/api/cloud/library',{method:'PUT',body:'{"broken"',headers:{'Content-Type':'application/json'}});
  assert.equal(invalid.data.error.code,'invalid_json');
  assert.equal((await save(env,{library:{...state(),notes:'x'.repeat(CLOUD_LIMITS.stateBytes)}})).data.error.code,'state_too_large');
  assert.equal((await call(env,'/api/cloud/library',{method:'PUT',body:'{}',headers:{'Content-Type':'application/json','Content-Length':String(CLOUD_LIMITS.requestBytes+1)}})).status,413);
});

test('large libraries use immutable R2 snapshots rather than oversized D1 values; storage failures preserve the previous revision',async()=>{
  const env=environment(),library={...state(),notes:'story '.repeat(500000)};
  assert.equal((await save(env,{library})).status,200);
  assert.deepEqual((await call(env,'/api/cloud/library')).data.state,library);
  const row=env.sqlite.prepare('SELECT state_json, manifest_json FROM cloud_libraries').get();assert.ok(row.state_json.length<500);assert.ok(row.manifest_json.length<100);
  const originalPut=env.BUCKET.put;env.BUCKET.put=async()=>{throw new Error('secret provider failure owner-A');};
  const failed=await save(env,{revision:1,library:state('do not commit')});assert.equal(failed.status,503);assert.ok(!JSON.stringify(failed.data).includes('owner-A'));
  env.BUCKET.put=originalPut;assert.equal((await call(env,'/api/cloud/library')).data.revision,1);
  assert.deepEqual((await call(env,'/api/cloud/library')).data.state,library);
});

test('concurrent edits of an existing revision commit exactly one whole library',async()=>{
  const env=environment();await save(env,{library:state('before')});
  const [a,b]=await Promise.all([save(env,{revision:1,library:state('edit A')}),save(env,{revision:1,library:state('edit B')})]);
  assert.deepEqual([a.status,b.status].sort(),[200,409]);
  assert.equal((a.status===409?a:b).data.revision,2);
  const committed=(await call(env,'/api/cloud/library')).data;
  assert.equal(committed.revision,2);
  assert.equal(committed.state.backgrounds[0].name,a.status===200?'edit A':'edit B');
});

test('concurrent media uploads reuse identical content and never replace a winning different upload',async()=>{
  const same=environment(),identical=await Promise.all([upload(same),upload(same)]);
  assert.deepEqual(identical.map(item=>item.status).sort(),[200,201]);
  assert.equal(same.objects.size,1);
  const env=environment(),other=Uint8Array.from([...png,1]);
  const [a,b]=await Promise.all([upload(env),upload(env,{bytes:other})]);
  assert.deepEqual([a.status,b.status].sort(),[201,409]);
  const response=await handleCloudRequest(request('/api/cloud/media/'+IMAGE),env);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),a.status===201?png:other);
  const committed=env.sqlite.prepare('SELECT * FROM cloud_assets').get();
  assert.equal(committed.sha256,await hash(a.status===201?png:other));
  assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM cloud_assets').get().n,1);
});

test('missing or corrupted R2 snapshots fail closed without replacing the local or committed cloud library',async()=>{
  const env=environment();await save(env);
  const row=env.sqlite.prepare('SELECT * FROM cloud_libraries').get(),pointer=JSON.parse(row.state_json),original=env.objects.get(pointer.objectKey);
  env.objects.delete(pointer.objectKey);
  assert.equal((await call(env,'/api/cloud/library')).data.error.code,'library_unavailable');
  env.objects.set(pointer.objectKey,{...original,bytes:Uint8Array.from([...original.bytes,32])});
  assert.equal((await call(env,'/api/cloud/library')).status,503);
  const changed=original.bytes.slice();changed[changed.length-1]^=1;
  env.objects.set(pointer.objectKey,{...original,bytes:changed});
  assert.equal((await call(env,'/api/cloud/library')).status,503);
  assert.equal(env.sqlite.prepare('SELECT revision FROM cloud_libraries').get().revision,1);
  env.objects.set(pointer.objectKey,original);
  assert.deepEqual((await call(env,'/api/cloud/library')).data.state,state());
});

test('database failures after immutable snapshot upload leave the preceding revision usable and hide internal details',async()=>{
  const env=environment();await save(env,{library:state('preserved')});
  const prepare=env.DB.prepare;
  env.DB.prepare=sql=>/^UPDATE cloud_libraries/.test(sql)?{bind(){return {async run(){throw new Error('private owner-A bucket/path database failure');}};}}:prepare(sql);
  const failed=await save(env,{revision:1,library:state('not committed')});
  assert.equal(failed.status,503);assert.equal(failed.data.error.code,'cloud_unavailable');
  assert.doesNotMatch(JSON.stringify(failed.data),/owner-A|bucket\/path|database failure/);
  const read=(await call(env,'/api/cloud/library')).data;
  assert.equal(read.revision,1);assert.equal(read.state.backgrounds[0].name,'preserved');
});

test('malformed identity, manifest, revision and prototype fields are rejected before storing any snapshot',async()=>{
  const env=environment();
  assert.equal((await call(env,'/api/cloud/library',{owner:'x'.repeat(257)})).status,401);
  assert.equal((await call(env,'/api/cloud/media/'+IMAGE,{account:'owner-B'})).data.error.code,'account_changed');
  const prototype=state();prototype.extra=JSON.parse('{"__proto__":{"polluted":true}}');
  assert.equal((await save(env,{library:prototype})).data.error.code,'credentials_forbidden');
  for(const revision of [-1,0.5,Number.MAX_SAFE_INTEGER])assert.equal((await save(env,{revision})).data.error.code,'invalid_revision');
  for(const manifest of [null,[{id:'../../other'}],Array(CLOUD_LIMITS.manifestEntries+1).fill({})])assert.equal((await save(env,{manifest})).status,400);
  const nested=state();nested.books=[{pages:[{audioAssetId:AUDIO}]}];
  assert.equal((await save(env,{library:nested})).data.error.code,'missing_manifest_asset');
  const mismatch=await call(env,'/api/cloud/library',{method:'PUT',body:'{}',headers:{'Content-Type':'application/json','Content-Length':'3'}});
  assert.equal(mismatch.data.error.code,'size_mismatch');
  assert.equal(env.writes.length,0);assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM cloud_libraries').get().n,0);
});
