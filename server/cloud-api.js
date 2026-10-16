/**
 * Private per-account cloud library API for the Sites dispatch runtime.
 * Only Sites-injected authenticated headers identify an owner. The matching
 * X-Cloud-Account-ID is a race guard, never a source of authentication.
 */
export const CLOUD_LIMITS = Object.freeze({mediaBytes:40*1024*1024,stateBytes:8*1024*1024,requestBytes:10*1024*1024,manifestEntries:10000});
const encoder = new TextEncoder();
const IMAGE_ID = /^image-[a-zA-Z0-9-]{8,120}$/;
const AUDIO_ID = /^audio-[a-zA-Z0-9-]{5,100}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const IMAGE_MIMES = new Set(['image/png','image/jpeg','image/webp','image/gif','image/avif','image/bmp','image/svg+xml']);
const FORBIDDEN_KEYS = new Set(['apikey','key','token','accesstoken','refreshtoken','authtoken','bearertoken','secret','secretkey','privatekey','clientsecret','password','authorization','credentials','credential','vault','encryptedcredentials','pin','pinhash','pinsalt','pinverifier','parentpin','parentpinhash','parentpinsalt','parentpinverifier','__proto__','constructor','prototype']);

class CloudError extends Error {
  constructor(status,code,message,extra={}) {super(message);this.status=status;this.code=code;this.extra=extra;}
}
const fail = (status,code,message,extra) => {throw new CloudError(status,code,message,extra);};
function privateHeaders(extra={}) {
  return new Headers({'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin','Referrer-Policy':'no-referrer','Vary':'Cookie, oai-authenticated-user-id',...extra});
}
function json(data,status=200,extra={}) {
  return new Response(JSON.stringify(data),{status,headers:privateHeaders({'Content-Type':'application/json; charset=utf-8',...extra})});
}
function authenticatedUser(request) {
  const id=request.headers.get('oai-authenticated-user-id');
  if(!id || id.length>256 || /[\x00-\x1f\x7f]/.test(id))return null;
  let displayName=request.headers.get('oai-authenticated-user-full-name')||'';
  if(request.headers.get('oai-authenticated-user-full-name-encoding')==='percent-encoded-utf-8') {
    try{displayName=decodeURIComponent(displayName);}catch{displayName='';}
  }
  return {id,email:(request.headers.get('oai-authenticated-user-email')||'').slice(0,512),displayName:displayName.slice(0,512)};
}
function checkAccount(request,user,{required=false}={}) {
  const account=request.headers.get('X-Cloud-Account-ID');
  if((required && !account) || (account!==null && account!==user.id))fail(403,'account_changed','로그인 계정이 바뀌었어요. 동기화 화면을 새로 연 뒤 다시 시도해 주세요.');
}
function checkMutationOrigin(request,url) {
  if(request.headers.get('Origin')!==url.origin || request.headers.get('Sec-Fetch-Site')==='cross-site')fail(403,'origin_forbidden','같은 동화공방 사이트에서만 클라우드 자료를 변경할 수 있어요.');
}
function storage(env,{bucket=true}={}) {
  if(!env?.DB?.prepare || (bucket && !env?.BUCKET?.get))fail(503,'storage_unavailable','클라우드 보관함을 준비하고 있어요. 기기의 원본 자료는 유지됩니다.');
}
async function boundedBody(request,limit) {
  const declared=request.headers.get('Content-Length');
  if(declared!==null && (!/^\d+$/.test(declared) || Number(declared)>limit))fail(413,'request_too_large','보낼 자료가 한 번에 저장할 수 있는 크기를 넘었어요.');
  if(!request.body)return new Uint8Array();
  const reader=request.body.getReader(),chunks=[];let size=0;
  try {
    for(;;) {
      const {value,done}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>limit){await reader.cancel();fail(413,'request_too_large','보낼 자료가 한 번에 저장할 수 있는 크기를 넘었어요.');}
      chunks.push(value);
    }
  } catch(error) {
    if(error instanceof CloudError)throw error;
    fail(400,'request_interrupted','자료 전송이 중단됐어요. 원본을 유지한 채 다시 시도해 주세요.');
  }
  if(declared!==null && size!==Number(declared))fail(400,'size_mismatch','전송한 자료의 크기가 일치하지 않아요.');
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return bytes;
}
async function readJSON(request) {
  if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')fail(415,'json_required','JSON 형식의 라이브러리를 보내 주세요.');
  const bytes=await boundedBody(request,CLOUD_LIMITS.requestBytes);
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{fail(400,'invalid_json','라이브러리 JSON을 읽을 수 없어요. 원본 자료는 바꾸지 않았어요.');}
}
async function digest(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
}
function kindForId(id) {
  if(IMAGE_ID.test(id))return 'image';if(AUDIO_ID.test(id))return 'audio';
  fail(400,'invalid_asset_id','그림·음원의 식별자가 올바르지 않아요.');
}
function mimeForKind(raw,kind) {
  if(typeof raw!=='string' || raw.length>180)fail(415,'unsupported_media','지원하는 그림·음원 형식을 보내 주세요.');
  const mime=raw.split(';')[0].trim().toLowerCase();
  if(kind==='image' ? !IMAGE_MIMES.has(mime) : !(/^audio\/[a-z0-9.+-]+$/.test(mime)||mime==='video/webm'))fail(415,'unsupported_media','지원하는 그림·음원 형식을 보내 주세요.');
  return mime;
}
function checkImageBytes(bytes,mime) {
  const first=new TextDecoder().decode(bytes.subarray(0,32));
  let valid=false;
  if(mime==='image/png')valid=bytes[0]===137 && first.slice(1,8)==='PNG\r\n\x1a\n';
  else if(mime==='image/jpeg')valid=bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
  else if(mime==='image/webp')valid=first.startsWith('RIFF') && first.slice(8,12)==='WEBP';
  else if(mime==='image/gif')valid=/^GIF8[79]a/.test(first);
  else if(mime==='image/bmp')valid=first.startsWith('BM');
  else if(mime==='image/avif')valid=first.slice(4,8)==='ftyp' && /avif|avis/.test(first.slice(8));
  else if(mime==='image/svg+xml') {
    let svg='';try{svg=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{}
    valid=/<svg(?:\s|>)/i.test(svg) && !/<(?:script|foreignObject|iframe|object|embed)\b|\bon[a-z]+\s*=|(?:href|src)\s*=\s*["']?\s*(?:javascript:|https?:|\/\/)|<!DOCTYPE|<!ENTITY/i.test(svg);
  }
  if(!valid)fail(415,'media_type_mismatch','그림 내용과 파일 형식이 일치하지 않아요.');
}
function assetManifest(row) {
  return {id:row.asset_id,kind:row.kind,mimeType:row.mime_type,size:Number(row.byte_size),sha256:row.sha256};
}
async function assetRow(env,owner,id) {
  return env.DB.prepare('SELECT owner_id, asset_id, kind, mime_type, byte_size, sha256, object_key FROM cloud_assets WHERE owner_id = ? AND asset_id = ?').bind(owner,id).first();
}
const sameAsset = (row,asset) => row && row.kind===asset.kind && row.mime_type===asset.mimeType && Number(row.byte_size)===asset.size && row.sha256===asset.sha256;
async function putMedia(request,env,user,id) {
  const kind=kindForId(id),mimeType=mimeForKind(request.headers.get('Content-Type'),kind);
  const sha256=(request.headers.get('X-Content-SHA256')||'').toLowerCase();
  if(!SHA256.test(sha256))fail(400,'invalid_digest','그림·음원의 SHA-256 확인값이 필요해요.');
  const bytes=await boundedBody(request,CLOUD_LIMITS.mediaBytes);
  if(!bytes.length)fail(400,'empty_media','빈 그림·음원 파일은 저장할 수 없어요.');
  if(await digest(bytes)!==sha256)fail(400,'digest_mismatch','전송 중 그림·음원의 내용이 달라졌어요. 원본을 다시 보내 주세요.');
  if(kind==='image')checkImageBytes(bytes,mimeType);
  const asset={id,kind,mimeType,size:bytes.byteLength,sha256};
  let existing=await assetRow(env,user.id,id);
  if(existing) {
    if(!sameAsset(existing,asset))fail(409,'asset_conflict','같은 식별자의 다른 그림·음원이 이미 있어요. 기존 원본을 덮어쓰지 않았어요.');
    return json({asset:assetManifest(existing),reused:true});
  }
  // Content-specific paths ensure concurrent differing uploads never overwrite.
  const ownerHash=await digest(encoder.encode(user.id));
  const objectKey=`cloud-media/${ownerHash}/${id}/${sha256}`;
  await env.BUCKET.put(objectKey,bytes,{httpMetadata:{contentType:mimeType},customMetadata:{sha256,kind}});
  const result=await env.DB.prepare('INSERT INTO cloud_assets (owner_id, asset_id, kind, mime_type, byte_size, sha256, object_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id, asset_id) DO NOTHING')
    .bind(user.id,id,kind,mimeType,bytes.byteLength,sha256,objectKey,new Date().toISOString()).run();
  if(!Number(result.meta?.changes)) {
    existing=await assetRow(env,user.id,id);
    if(!sameAsset(existing,asset))fail(409,'asset_conflict','다른 기기에서 같은 식별자의 다른 원본을 저장했어요. 기존 원본을 덮어쓰지 않았어요.');
    return json({asset:assetManifest(existing),reused:true});
  }
  return json({asset,reused:false},201);
}
async function getMedia(env,user,id) {
  kindForId(id);
  const row=await assetRow(env,user.id,id);
  if(!row)fail(404,'media_not_found','이 계정의 보관함에서 원본 그림·음원을 찾지 못했어요.');
  const object=await env.BUCKET.get(row.object_key);
  if(!object)fail(503,'media_unavailable','그림·음원 원본을 읽지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  return new Response(object.body,{headers:privateHeaders({
    'Content-Type':row.mime_type,'Content-Length':String(row.byte_size),'X-Content-SHA256':row.sha256,
    'Content-Disposition':`inline; filename="${id}"`,
    // SVG or mislabeled audio must never execute in this site's origin.
    'Content-Security-Policy':"default-src 'none'; sandbox"
  })});
}
function validateState(state) {
  if(!state || typeof state!=='object' || Array.isArray(state) || !Array.isArray(state.books) || !Array.isArray(state.characters))fail(400,'invalid_state','책과 재료가 포함된 동화공방 라이브러리를 보내 주세요.');
  const references=new Set(),stack=[{value:state,key:'',depth:0}];let count=0;
  while(stack.length) {
    const {value,key,depth}=stack.pop();
    if(++count>250000 || depth>100)fail(400,'state_too_complex','라이브러리의 구조가 너무 복잡해 저장할 수 없어요.');
    if(typeof value==='string') {
      if(/^(?:data:|blob:)/i.test(value))fail(400,'inline_media_forbidden','그림·음원은 본문 JSON과 분리해 원본 파일로 먼저 저장해 주세요.');
      if(value.startsWith('asset:')) {const id=value.slice(6);kindForId(id);references.add(id);}
      else if((key==='assetId' || /(?:image|sheet|character).*assetids?$/i.test(key) || /imageids?$/i.test(key) || /audioAssetIds?$/i.test(key)) && value) {kindForId(value);references.add(value);}
    } else if(Array.isArray(value)) {
      for(const item of value)stack.push({value:item,key,depth:depth+1});
    } else if(value && typeof value==='object') {
      for(const [field,item] of Object.entries(value)) {
        const normalized=field.replace(/[-_\s]/g,'').toLowerCase();
        if(FORBIDDEN_KEYS.has(normalized) || ['__proto__','constructor','prototype'].includes(field))fail(400,'credentials_forbidden','API 키·부모 PIN·인증 정보는 클라우드에 저장할 수 없어요. 이 기기에만 보관해 주세요.');
        stack.push({value:item,key:field,depth:depth+1});
      }
    }
  }
  return references;
}
function validateManifest(manifest,references) {
  if(!Array.isArray(manifest) || manifest.length>CLOUD_LIMITS.manifestEntries)fail(400,'invalid_manifest','그림·음원 목록의 형식을 확인해 주세요.');
  const ids=new Set(),normalized=[];
  for(const item of manifest) {
    if(!item || typeof item!=='object')fail(400,'invalid_manifest','그림·음원 목록의 형식을 확인해 주세요.');
    const kind=kindForId(item.id);
    if(ids.has(item.id) || item.kind!==kind || !Number.isSafeInteger(item.size) || item.size<=0 || item.size>CLOUD_LIMITS.mediaBytes || typeof item.sha256!=='string' || !SHA256.test(item.sha256))fail(400,'invalid_manifest','그림·음원 목록에 잘못되거나 중복된 항목이 있어요.');
    ids.add(item.id);normalized.push({id:item.id,kind,mimeType:mimeForKind(item.mimeType,kind),size:item.size,sha256:item.sha256});
  }
  for(const id of references)if(!ids.has(id))fail(400,'missing_manifest_asset','참조하는 그림·음원이 빠졌어요. 기기의 원본은 바꾸지 않았어요.');
  return normalized;
}
async function checkUploadedAssets(env,owner,manifest) {
  for(let offset=0;offset<manifest.length;offset+=80) {
    const chunk=manifest.slice(offset,offset+80);
    const result=await env.DB.prepare(`SELECT asset_id, kind, mime_type, byte_size, sha256 FROM cloud_assets WHERE owner_id = ? AND asset_id IN (${chunk.map(()=>'?').join(', ')})`).bind(owner,...chunk.map(item=>item.id)).all();
    const rows=new Map((result.results||[]).map(row=>[row.asset_id,row]));
    for(const asset of chunk)if(!sameAsset(rows.get(asset.id),asset))fail(400,'asset_not_uploaded','이 계정의 원본 보관함에 없는 그림·음원이 있어요. 원본 파일을 먼저 저장해 주세요.');
  }
}
async function libraryRow(env,owner) {
  return env.DB.prepare('SELECT revision, state_json, manifest_json, updated_at FROM cloud_libraries WHERE owner_id = ?').bind(owner).first();
}
async function getLibrary(env,user) {
  const row=await libraryRow(env,user.id);
  if(!row)return json({exists:false,revision:0});
  let pointer,snapshot;
  try{pointer=JSON.parse(row.state_json);}catch{fail(503,'library_unavailable','클라우드 라이브러리를 읽지 못했어요. 기기의 원본은 유지됩니다.');}
  if(pointer.storage==='r2') {
    const object=await env.BUCKET.get(pointer.objectKey);
    if(!object)fail(503,'library_unavailable','클라우드 라이브러리 원본을 읽지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    const bytes=new Uint8Array(await object.arrayBuffer());
    if(bytes.byteLength!==pointer.size || await digest(bytes)!==pointer.sha256)fail(503,'library_unavailable','클라우드 원본의 확인값이 일치하지 않아요. 기기의 원본은 유지됩니다.');
    try{snapshot=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail(503,'library_unavailable','클라우드 라이브러리를 읽지 못했어요.');}
  } else {
    // Allows a small pre-pointer library to migrate on its next successful save.
    try{snapshot={state:pointer,manifest:JSON.parse(row.manifest_json)};}catch{fail(503,'library_unavailable','클라우드 라이브러리를 읽지 못했어요.');}
  }
  return json({exists:true,revision:Number(row.revision),updatedAt:row.updated_at,state:snapshot.state,manifest:snapshot.manifest});
}
async function putLibrary(request,env,user) {
  const body=await readJSON(request);
  if(!body || typeof body!=='object' || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision<0 || body.expectedRevision>=Number.MAX_SAFE_INTEGER)fail(400,'invalid_revision','클라우드 자료의 이전 버전 번호가 필요해요.');
  const references=validateState(body.state),stateJSON=JSON.stringify(body.state);
  if(encoder.encode(stateJSON).byteLength>CLOUD_LIMITS.stateBytes)fail(413,'state_too_large','글과 설정 자료는 8MB까지 저장할 수 있어요. 그림·음원은 별도로 전송해 주세요.');
  const manifest=validateManifest(body.manifest,references);
  await checkUploadedAssets(env,user.id,manifest);
  const current=await libraryRow(env,user.id);
  if(Number(current?.revision||0)!==body.expectedRevision)fail(409,'revision_conflict','다른 기기에서 먼저 저장한 자료가 있어요. 클라우드 자료를 확인한 뒤 다시 저장해 주세요.',{revision:Number(current?.revision||0)});
  const snapshot=JSON.stringify({state:body.state,manifest}),bytes=encoder.encode(snapshot);
  const objectKey=`cloud-snapshots/${await digest(encoder.encode(user.id))}/${crypto.randomUUID()}.json`;
  const sha256=await digest(bytes),updatedAt=new Date().toISOString();
  await env.BUCKET.put(objectKey,bytes,{httpMetadata:{contentType:'application/json'},customMetadata:{sha256}});
  const pointer=JSON.stringify({storage:'r2',objectKey,sha256,size:bytes.byteLength});
  const manifestPointer=JSON.stringify({storage:'r2',count:manifest.length});
  let result;
  if(body.expectedRevision===0) {
    result=await env.DB.prepare('INSERT INTO cloud_libraries (owner_id, revision, state_json, manifest_json, updated_at) VALUES (?, 1, ?, ?, ?) ON CONFLICT(owner_id) DO NOTHING').bind(user.id,pointer,manifestPointer,updatedAt).run();
  } else {
    result=await env.DB.prepare('UPDATE cloud_libraries SET revision = revision + 1, state_json = ?, manifest_json = ?, updated_at = ? WHERE owner_id = ? AND revision = ?').bind(pointer,manifestPointer,updatedAt,user.id,body.expectedRevision).run();
  }
  if(!Number(result.meta?.changes)) {
    const latest=await libraryRow(env,user.id);
    fail(409,'revision_conflict','다른 기기에서 먼저 저장한 자료가 있어요. 기존 클라우드 자료를 덮어쓰지 않았어요.',{revision:Number(latest?.revision||0)});
  }
  return json({ok:true,revision:body.expectedRevision+1,updatedAt});
}

// Stop controls are independent of large library revisions and never contain API keys.
async function autoJobControl(request,env,user,id){
 if(!/^auto-[a-zA-Z0-9-]{8,100}$/.test(id))fail(400,'invalid_job_id','자동 제작 식별자를 확인해 주세요.');
 if(request.method==='GET'){const row=await env.DB.prepare('SELECT stop_nonce, requested_at FROM auto_job_controls WHERE owner_id = ? AND job_id = ?').bind(user.id,id).first();return json({jobId:id,stop:row?{nonce:row.stop_nonce,requestedAt:row.requested_at}:null});}
 if(request.method!=='POST')return json({error:{code:'method_not_allowed',message:'GET 또는 POST 요청을 사용해 주세요.'}},405,{Allow:'GET, POST'});
 if(request.headers.get('Content-Type')?.split(';')[0].trim()!=='application/json')fail(415,'json_required','JSON 중지 요청이 필요해요.');
 let body;try{body=JSON.parse(new TextDecoder().decode(await boundedBody(request,2048)));}catch(error){if(error instanceof CloudError)throw error;fail(400,'invalid_json','중지 요청 JSON을 확인해 주세요.');}
 if(!/^[a-zA-Z0-9-]{8,100}$/.test(body?.nonce||''))fail(400,'invalid_stop_nonce','중지 요청 식별자를 확인해 주세요.');
 const requestedAt=new Date().toISOString();await env.DB.prepare('INSERT INTO auto_job_controls (owner_id, job_id, stop_nonce, requested_at) VALUES (?, ?, ?, ?) ON CONFLICT(owner_id, job_id) DO UPDATE SET stop_nonce = excluded.stop_nonce, requested_at = excluded.requested_at').bind(user.id,id,body.nonce,requestedAt).run();
 return json({jobId:id,stop:{nonce:body.nonce,requestedAt}});
}

/** Returns null for all routes outside /api/cloud. No client secrets are used. */
export async function handleCloudRequest(request,env) {
  const url=new URL(request.url);
  if(url.pathname!=='/api/cloud' && !url.pathname.startsWith('/api/cloud/'))return null;
  try {
    const user=authenticatedUser(request);
    if(url.pathname==='/api/cloud/session' && request.method==='GET')return json(user?{authenticated:true,user}:{authenticated:false,signInPath:'/signin-with-chatgpt?return_to=%2F'});
    if(!user)fail(401,'authentication_required','같은 ChatGPT 계정으로 로그인하면 클라우드 보관함을 사용할 수 있어요.');
    const mutation=!['GET','HEAD','OPTIONS'].includes(request.method);
    checkAccount(request,user,{required:mutation});
    if(mutation)checkMutationOrigin(request,url);
    const control=/^\/api\/cloud\/jobs\/(auto-[^/]+)\/control$/.exec(url.pathname);
    if(control){storage(env,{bucket:false});return await autoJobControl(request,env,user,control[1]);}
    storage(env);
    if(url.pathname==='/api/cloud/library') {
      if(request.method==='GET')return await getLibrary(env,user);
      if(request.method==='PUT')return await putLibrary(request,env,user);
      return json({error:{code:'method_not_allowed',message:'GET 또는 PUT 요청을 사용해 주세요.'}},405,{Allow:'GET, PUT'});
    }
    const media=/^\/api\/cloud\/media\/([^/]+)$/.exec(url.pathname);
    if(media) {
      let id;try{id=decodeURIComponent(media[1]);}catch{fail(400,'invalid_asset_id','그림·음원의 식별자를 확인해 주세요.');}
      if(request.method==='GET')return await getMedia(env,user,id);
      if(request.method==='PUT')return await putMedia(request,env,user,id);
      return json({error:{code:'method_not_allowed',message:'GET 또는 PUT 요청을 사용해 주세요.'}},405,{Allow:'GET, PUT'});
    }
    fail(404,'not_found','클라우드 보관함 주소를 확인해 주세요.');
  } catch(error) {
    if(error instanceof CloudError)return json({error:{code:error.code,message:error.message},...error.extra},error.status);
    // Storage/provider exceptions must not expose owner IDs, object keys or data.
    return json({error:{code:'cloud_unavailable',message:'클라우드 저장에 연결하지 못했어요. 기기의 원본은 유지됩니다. 잠시 뒤 다시 시도해 주세요.'}},503);
  }
}
