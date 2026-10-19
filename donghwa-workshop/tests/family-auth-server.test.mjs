import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {pbkdf2Sync,randomBytes} from 'node:crypto';
import {handleCloudRequest,resolveIdentity,FAMILY_LIMITS} from '../server/cloud-api.js';

const ORIGIN='https://donghwa.example';
const INVITE='family-invite-0123456789';
const DAY=24*60*60*1000;
const T0=Date.parse('2026-10-19T00:00:00.000Z');
const IMAGE='image-cloud-fixture-0123456789';
const png=Uint8Array.from([137,80,78,71,13,10,26,10]);
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const CODE=/^[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){4}$/;
const hash=async bytes=>Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
const sha=text=>hash(new TextEncoder().encode(text));
const key=()=>randomBytes(32).toString('base64url');
const iso=ms=>new Date(ms).toISOString();
const state=(name='우리 집')=>({books:[],characters:[],backgrounds:[{id:'home',name}],settings:{readingKoLevel:'K2'},worlds:[]});
const SIGNED_OUT={authenticated:false,signInPath:'/signin-with-chatgpt?return_to=%2F'};
const EXPIRED={...SIGNED_OUT,reason:'family-session-expired'};

function environment(options={}) {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../server/cloud-schema.sql',import.meta.url),'utf8'));
  const objects=new Map(),reads=[],writes=[],deletes=[],statements=[];
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
    async get(key){reads.push(key);const record=objects.get(key);if(!record)return null;return {body:new Blob([record.bytes]).stream(),arrayBuffer:async()=>record.bytes.slice().buffer};},
    async delete(key){deletes.push(key);objects.delete(key);}
  };
  const signupCode='signupCode' in options?options.signupCode:INVITE;
  return {DB,BUCKET,sqlite,objects,reads,writes,deletes,statements,clock:{t:T0},...(signupCode===undefined?{}:{FAMILY_SIGNUP_CODE:signupCode})};
}
function request(path,{method='POST',session=null,sites=null,account=null,body,headers={},origin=ORIGIN}={}) {
  const values={...headers};
  if(session!==null)values['X-Family-Session']=session;
  if(sites!==null)values['oai-authenticated-user-id']=sites;
  if(account!==null)values['X-Cloud-Account-ID']=account;
  if(!['GET','HEAD'].includes(method) && origin!==null)values.Origin=origin;
  if(body && typeof body==='object' && !(body instanceof Uint8Array)) {body=JSON.stringify(body);values['Content-Type']||='application/json';}
  return new Request(ORIGIN+path,{method,headers:values,body});
}
async function call(env,path,options={}) {
  const response=await handleCloudRequest(request(path,options),env,{now:()=>env.clock?.t??T0});
  const text=await response.text();
  return {response,status:response.status,data:text?JSON.parse(text):null};
}
async function signup(env,{username='mom_kim',passwordKey=key(),inviteCode=INVITE,displayName,...rest}={}) {
  const result=await call(env,'/api/cloud/auth/signup',{body:{username,passwordKey,inviteCode,...(displayName===undefined?{}:{displayName})},...rest});
  return {...result,passwordKey,token:result.data?.session?.token,owner:result.data?.user?.id};
}
const login=(env,username,passwordKey,rest={})=>call(env,'/api/cloud/auth/login',{body:{username,passwordKey},...rest});
const whoami=(env,session,rest={})=>call(env,'/api/cloud/session',{method:'GET',session,...rest});
const recover=(env,username,recoveryCode,newPasswordKey=key())=>call(env,'/api/cloud/auth/recover',{body:{username,recoveryCode,newPasswordKey}}).then(result=>({...result,newPasswordKey}));
const changePassword=(env,auth,body)=>call(env,'/api/cloud/auth/password',{session:auth.token,account:auth.owner,body});
const save=(env,{revision=0,library=state(),manifest=[],...rest}={})=>call(env,'/api/cloud/library',{method:'PUT',body:{expectedRevision:revision,state:library,manifest},...rest});
async function upload(env,{id=IMAGE,bytes=png,...rest}={}) {
  return call(env,'/api/cloud/media/'+id,{method:'PUT',body:bytes,headers:{'Content-Type':'image/png','X-Content-SHA256':await hash(bytes)},...rest});
}
const count=(env,sql,...args)=>Number(env.sqlite.prepare(sql).get(...args).n);
const noDDL=env=>assert.ok(env.statements.every(sql=>!/^\s*(?:CREATE|ALTER|DROP)/i.test(sql)),'request handlers run no schema mutations');
function spyDeriveBits() {
  const original=crypto.subtle.deriveBits,spy={calls:0,restore(){delete crypto.subtle.deriveBits;}};
  crypto.subtle.deriveBits=function(...args){spy.calls+=1;return original.apply(this,args);};
  return spy;
}
function applyDrizzle(sqlite,{only}={}) {
  const journal=JSON.parse(readFileSync(new URL('../cloud-runtime/drizzle/meta/_journal.json',import.meta.url),'utf8'));
  for(const entry of [...journal.entries].sort((a,b)=>a.idx-b.idx)) {
    if(only && !only(entry))continue;
    const sql=readFileSync(new URL(`../cloud-runtime/drizzle/${entry.tag}.sql`,import.meta.url),'utf8');
    for(const statement of sql.split('--> statement-breakpoint'))if(statement.trim())sqlite.exec(statement);
  }
}
const masterEntries=sqlite=>sqlite.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").all().map(row=>({type:row.type,name:row.name,table:row.tbl_name,sql:row.sql===null?null:row.sql.replace(/\s+/g,' ').trim()}));

test('auth endpoints run before the 401 gate, accept only same-origin JSON POSTs and answer privately',async()=>{
  const env=environment(),body={username:'mom_kim',passwordKey:key(),inviteCode:INVITE};
  const method=await call(env,'/api/cloud/auth/login',{method:'GET'});
  assert.equal(method.status,405);assert.equal(method.response.headers.get('Allow'),'POST');
  assert.equal((await call(env,'/api/cloud/auth/unknown',{body})).data.error.code,'not_found');
  assert.equal((await call(env,'/api/cloud/auth/signup',{body:JSON.stringify(body),headers:{'Content-Type':'text/plain'}})).status,415);
  assert.equal((await call(env,'/api/cloud/auth/signup',{body:{...body,pad:'x'.repeat(4200)}})).data.error.code,'request_too_large');
  assert.equal((await call(env,'/api/cloud/auth/signup',{body:'{"broken"',headers:{'Content-Type':'application/json'}})).data.error.code,'invalid_json');
  assert.equal((await call(env,'/api/cloud/auth/signup',{body:'[1]',headers:{'Content-Type':'application/json'}})).data.error.code,'invalid_request');
  for(const options of [{origin:'https://evil.example'},{origin:null},{headers:{'Sec-Fetch-Site':'same-site'}},{headers:{'Sec-Fetch-Site':'cross-site'}},{headers:{'Sec-Fetch-Site':'none'}}]) {
    const refused=await call(env,'/api/cloud/auth/signup',{body,...options});
    assert.equal(refused.status,403,JSON.stringify(options));assert.equal(refused.data.error.code,'origin_forbidden');
  }
  assert.equal(count(env,'SELECT COUNT(*) AS n FROM family_accounts'),0);
  const created=await call(env,'/api/cloud/auth/signup',{body,headers:{'Sec-Fetch-Site':'same-origin'}});
  assert.equal(created.status,201);
  assert.match(created.response.headers.get('Cache-Control'),/private.*no-store/);
  assert.equal(created.response.headers.get('X-Content-Type-Options'),'nosniff');
  assert.equal(created.response.headers.get('Content-Type'),'application/json; charset=utf-8');
  noDDL(env);
});

test('signup is closed without a long FAMILY_SIGNUP_CODE, checks the trimmed invite and returns user, session and recovery code',async()=>{
  for(const signupCode of [undefined,'','short-code1',42,'   eleven-ch   ']) {
    const env=environment({signupCode}),closed=await signup(env);
    assert.equal(closed.status,503,String(signupCode));
    assert.deepEqual(closed.data,{error:{code:'signup_closed',message:'가족 계정 만들기가 아직 열리지 않았어요. 사이트 관리자에게 가족 초대 코드를 받아 주세요.'}});
    assert.deepEqual(env.statements,[],'a closed signup never touches D1');
  }
  const env=environment({signupCode:`  ${INVITE}\n`});
  for(const inviteCode of ['family-invite-0123456780','',null,123,' '.repeat(30)]) {
    const wrong=await signup(env,{inviteCode});
    assert.deepEqual(wrong.data,{error:{code:'invite_invalid',message:'가족 초대 코드가 맞지 않아요.'}});assert.equal(wrong.status,403);
  }
  const created=await signup(env,{inviteCode:`  ${INVITE}  `,displayName:'  김씨네 가족 '});
  assert.equal(created.status,201);
  assert.deepEqual(Object.keys(created.data),['user','session','recoveryCode']);
  assert.match(created.data.user.id,/^family:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.deepEqual(created.data.user,{id:created.owner,kind:'family',username:'mom_kim',displayName:'김씨네 가족',email:''});
  assert.match(created.token,TOKEN);assert.equal(created.data.session.expiresAt,iso(T0+180*DAY));
  assert.match(created.data.recoveryCode,CODE);
  const row=env.sqlite.prepare('SELECT * FROM family_accounts').get();
  assert.notEqual(row.id,created.owner.slice(7));assert.equal(row.owner_id,created.owner);assert.equal(row.created_at,iso(T0));assert.equal(row.password_changed_at,iso(T0));
  assert.ok(!row.owner_id.includes('mom_kim'),'owner id is random, never derived from the username');
  const session=env.sqlite.prepare('SELECT * FROM family_sessions').get();
  assert.deepEqual({...session},{token_hash:await sha(created.token),account_id:row.id,owner_id:created.owner,created_at:iso(T0),last_seen_at:iso(T0),idle_expires_at:iso(T0+180*DAY),absolute_expires_at:iso(T0+400*DAY)});
  assert.deepEqual((await whoami(env,created.token)).data,{authenticated:true,user:created.data.user});
});

test('usernames are normalized (spaces, case, full width), validated and reserved; duplicates get 409',async()=>{
  const env=environment();let tick=T0;env.clock={get t(){return tick+=60*60*1000;}};
  assert.equal((await signup(env,{username:'  Mom_Kim  '})).data.user.username,'mom_kim');
  assert.equal((await signup(env,{username:'ＤＡＤ＿ＬＥＥ'})).data.user.username,'dad_lee');
  for(const username of ['abc','1abc','ab-cd','김가족아이디','a'.repeat(21),'',null,['mom_kim'],'ab cd'])
    assert.deepEqual((await signup(env,{username})).data,{error:{code:'invalid_username',message:'아이디는 영문 소문자로 시작하고 영문 소문자·숫자·밑줄(_)로 4~20자예요.'}},String(username));
  for(const username of ['admin','Test',' ＲＯＯＴ ','chatgpt','openai','family','donghwa','guest','system','support'])
    assert.deepEqual((await signup(env,{username})).data,{error:{code:'reserved_username',message:'쓸 수 없는 아이디예요.'}},username);
  const taken=await signup(env,{username:'MOM_KIM'});
  assert.equal(taken.status,409);assert.deepEqual(taken.data.error,{code:'username_taken',message:'이미 있는 아이디예요. 로그인하거나 다른 아이디를 써 주세요.'});
  const racing=await Promise.all([signup(env,{username:'twin_one'}),signup(env,{username:'Twin_One'})]);
  assert.deepEqual(racing.map(item=>item.status).sort(),[201,409]);
  assert.equal(count(env,"SELECT COUNT(*) AS n FROM family_accounts WHERE username = 'twin_one'"),1);
  assert.equal((await signup(env,{username:'nfc_name',displayName:'\u1100\u1161\u110c\u1169\u11a8'})).data.user.displayName,'가족');
  for(const displayName of ['가'.repeat(21),'line\nbreak','tab\there','bell\u0007',7])
    assert.equal((await signup(env,{username:'bad_name',displayName})).data.error.code,'invalid_display_name');
  assert.equal((await signup(env,{username:'emoji_name',displayName:'\u{1F468}\u200D\u{1F469}\u200D\u{1F467} 우리집'})).status,201);
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',canonical=key();
  const loose=canonical.slice(0,42)+alphabet[alphabet.indexOf(canonical[42])|1];
  assert.deepEqual(Buffer.from(loose,'base64url'),Buffer.from(canonical,'base64url'),'fixture decodes to the same bytes');
  for(const passwordKey of ['short','x'.repeat(44),canonical+'=',null,'+'.repeat(43),loose,randomBytes(31).toString('base64url')])
    assert.equal((await signup(env,{username:'key_check',passwordKey})).data.error.code,'invalid_password_key',String(passwordKey));
  assert.equal(count(env,"SELECT COUNT(*) AS n FROM family_accounts WHERE username IN ('bad_name','key_check')"),0);
  noDDL(env);
});

test('login gives identical 401s for unknown users and wrong keys and never hashes for unknown users',async()=>{
  const env=environment(),mom=await signup(env),spy=spyDeriveBits();
  try {
    const unknown=await login(env,'nobody_here',key());
    assert.equal(spy.calls,0,'unknown usernames are refused without computing a hash');
    const malformed=await login(env,'x',key());
    assert.equal(spy.calls,0);
    const wrong=await login(env,'mom_kim',key());
    assert.equal(spy.calls,1);
    for(const result of [unknown,malformed,wrong]) {
      assert.equal(result.status,401);
      assert.deepEqual(result.data,{error:{code:'invalid_credentials',message:'아이디 또는 비밀번호가 맞지 않아요.'}});
    }
    assert.deepEqual([...unknown.response.headers],[...wrong.response.headers]);
  } finally {spy.restore();}
  assert.equal((await login(env,'mom_kim','not-a-key')).data.error.code,'invalid_password_key');
  const ok=await login(env,'  MOM_KIM ',mom.passwordKey);
  assert.equal(ok.status,200);assert.deepEqual(Object.keys(ok.data),['user','session']);
  assert.deepEqual(ok.data.user,mom.data.user);assert.match(ok.data.session.token,TOKEN);assert.notEqual(ok.data.session.token,mom.token);
  assert.equal(count(env,'SELECT COUNT(*) AS n FROM family_sessions'),2);
});

test('login is throttled per username before hashing, answers Retry-After and rolls over with the window',async()=>{
  const env=environment(),mom=await signup(env),dad=await signup(env,{username:'dad_lee'});
  env.sqlite.prepare('INSERT INTO auth_throttle (bucket, window_start, count) VALUES (?, ?, 3)').run('f'.repeat(64),Math.floor(T0/1000)-3*86400);
  env.clock.t=T0+60*1000;
  for(let attempt=0;attempt<10;attempt++)assert.equal((await login(env,'mom_kim',key())).status,401);
  assert.equal(count(env,'SELECT COUNT(*) AS n FROM auth_throttle WHERE bucket = ?','f'.repeat(64)),0,'rows older than 2 days are pruned');
  const spy=spyDeriveBits();
  let limited;
  try {limited=await login(env,'mom_kim',mom.passwordKey);assert.equal(spy.calls,0,'a throttled login never hashes');} finally {spy.restore();}
  assert.equal(limited.status,429);
  assert.deepEqual(limited.data,{error:{code:'too_many_attempts',message:'시도가 너무 많아요. 14분 뒤 다시 해 주세요.'},retryAfter:840});
  assert.equal(limited.response.headers.get('Retry-After'),'840');
  assert.match(limited.response.headers.get('Cache-Control'),/no-store/);
  assert.equal((await login(env,'Dad_Lee',dad.passwordKey)).status,200,'other usernames are not throttled');
  env.clock.t=T0+15*60*1000;
  assert.equal((await login(env,'mom_kim',mom.passwordKey)).status,200,'a new window accepts the right key');
  assert.equal(count(env,'SELECT COUNT(*) AS n FROM auth_throttle WHERE bucket = ?',await sha('login:mom_kim')),0,'success deletes the bucket');
  for(let attempt=0;attempt<10;attempt++)assert.equal((await login(env,'mom_kim',key())).status,401);
  assert.equal((await login(env,'mom_kim',key())).status,429);
  assert.ok(env.sqlite.prepare('SELECT bucket FROM auth_throttle').all().every(row=>/^[0-9a-f]{64}$/.test(row.bucket)));
  noDDL(env);
});

test('signup attempts are throttled globally (30 per hour) and recover attempts per username (5 per hour)',async()=>{
  const env=environment();
  for(let attempt=0;attempt<30;attempt++)assert.equal((await signup(env,{inviteCode:'wrong-invite-code'})).status,403);
  const limited=await signup(env);
  assert.equal(limited.status,429);assert.equal(limited.data.error.code,'too_many_attempts');assert.ok(Number(limited.response.headers.get('Retry-After'))>0);
  env.clock.t=T0+60*60*1000;
  const mom=await signup(env);assert.equal(mom.status,201);
  for(let attempt=0;attempt<5;attempt++)assert.equal((await recover(env,'mom_kim','0000-0000-0000-0000-0000')).status,401);
  const blocked=await recover(env,'mom_kim',mom.data.recoveryCode);
  assert.equal(blocked.status,429);assert.equal(blocked.response.headers.get('Retry-After'),String(blocked.data.retryAfter));
  assert.equal(blocked.data.error.message,`시도가 너무 많아요. ${Math.ceil(blocked.data.retryAfter/60)}분 뒤 다시 해 주세요.`);
  env.clock.t=T0+2*60*60*1000;
  assert.equal((await recover(env,'mom_kim',mom.data.recoveryCode)).status,200);
});

test('session resolution truth table: a family header wins, never falls back, and family: Sites ids are rejected',async()=>{
  const env=environment(),mom=await signup(env);
  const sitesUser={id:'owner-A',email:'',displayName:''};
  assert.deepEqual((await call({},'/api/cloud/session',{method:'GET'})).data,SIGNED_OUT,'anonymous session needs no storage');
  assert.deepEqual((await call({},'/api/cloud/session',{method:'GET',sites:'owner-A'})).data,{authenticated:true,user:sitesUser},'Sites users keep today\'s object');
  assert.deepEqual((await whoami(env,mom.token,{sites:'owner-A'})).data,{authenticated:true,user:mom.data.user});
  assert.deepEqual((await whoami(env,mom.token)).data.user,{id:mom.owner,kind:'family',username:'mom_kim',displayName:'',email:''});
  const statements=env.statements.length;
  for(const token of ['abc','',mom.token+'x','!'.repeat(43)])
    assert.deepEqual((await whoami(env,token,{sites:'owner-A'})).data,EXPIRED,`malformed ${JSON.stringify(token)}`);
  assert.equal(env.statements.length,statements,'malformed headers never reach D1');
  assert.deepEqual((await whoami(env,key(),{sites:'owner-A'})).data,EXPIRED,'unknown token');
  env.clock.t=T0+181*DAY;
  assert.deepEqual((await whoami(env,mom.token,{sites:'owner-A'})).data,EXPIRED,'expired token');
  const library=await call(env,'/api/cloud/library',{method:'GET',session:mom.token,sites:'owner-A',account:'owner-A'});
  assert.equal(library.status,401);
  assert.deepEqual(library.data,{error:{code:'authentication_required',message:'가족 아이디나 ChatGPT 계정으로 로그인하면 클라우드 보관함을 사용할 수 있어요.'},reason:'family-session-expired'});
  assert.deepEqual((await call(env,'/api/cloud/session',{method:'GET',sites:'family:x'})).data,SIGNED_OUT,'Sites ids may not claim the family: prefix');
  assert.equal((await call(env,'/api/cloud/library',{method:'GET',sites:'family:'+mom.owner.slice(7),account:mom.owner})).status,401);
  const anonymous=await call(env,'/api/cloud/library',{method:'GET'});
  assert.deepEqual(anonymous.data,{error:{code:'authentication_required',message:'가족 아이디나 ChatGPT 계정으로 로그인하면 클라우드 보관함을 사용할 수 있어요.'}});
  assert.equal((await whoami({},key(),{sites:'owner-A'})).data.error.code,'storage_unavailable','a family header without D1 is never anonymous');
  const broken=environment();broken.DB.prepare=()=>{throw new Error('private D1 failure token_hash');};
  const failed=await whoami(broken,key(),{sites:'owner-A'});
  assert.equal(failed.status,503);assert.equal(failed.data.error.code,'cloud_unavailable');assert.doesNotMatch(JSON.stringify(failed.data),/token_hash|private/);
  env.clock.t=T0;
  const fresh=await login(env,'mom_kim',mom.passwordKey),direct=await resolveIdentity(request('/api/cloud/session',{method:'GET',session:fresh.data.session.token,sites:'owner-A'}),env,T0);
  assert.deepEqual(direct.user,mom.data.user);assert.equal(direct.session.tokenHash,await sha(fresh.data.session.token));
  assert.deepEqual(await resolveIdentity(request('/api/cloud/session',{method:'GET',sites:'family:x'}),{},T0),{user:null});
  noDDL(env);
});

test('sessions expire after 180 idle days and 400 days in total',async()=>{
  const env=environment(),mom=await signup(env),other=await login(env,'mom_kim',mom.passwordKey);
  env.clock.t=T0+180*DAY-1;
  assert.equal((await whoami(env,other.data.session.token)).data.authenticated,true,'just inside the idle window');
  env.clock.t=T0+180*DAY;
  assert.deepEqual((await whoami(env,mom.token)).data,EXPIRED,'idle expiry');
  assert.equal((await whoami(env,other.data.session.token)).data.authenticated,true,'renewed sessions stay valid');
  for(const day of [300,399]) {env.clock.t=T0+day*DAY;assert.equal((await whoami(env,other.data.session.token)).data.authenticated,true,`day ${day}`);}
  env.clock.t=T0+400*DAY;
  const row=env.sqlite.prepare('SELECT idle_expires_at, absolute_expires_at FROM family_sessions WHERE token_hash = ?').get(await sha(other.data.session.token));
  assert.ok(row.idle_expires_at>iso(env.clock.t),'idle window still open');assert.equal(row.absolute_expires_at,iso(T0+400*DAY));
  assert.deepEqual((await whoami(env,other.data.session.token)).data,EXPIRED,'absolute expiry wins');
  const next=await login(env,'mom_kim',mom.passwordKey);
  assert.equal(next.status,200);
  assert.equal(count(env,'SELECT COUNT(*) AS n FROM family_sessions'),1,'expired sessions are removed when a new one is created');
});

test('100 requests in one day renew a session at most once',async()=>{
  const env=environment(),mom=await signup(env);
  const renewals=()=>env.statements.filter(sql=>/^UPDATE family_sessions/.test(sql)).length;
  for(let index=0;index<100;index++){env.clock.t=T0+index*13*60*1000;assert.equal((await whoami(env,mom.token)).data.authenticated,true);}
  assert.equal(renewals(),0,'no renewal within the first day');
  const start=T0+25*60*60*1000;
  for(let index=0;index<100;index++){env.clock.t=start+index*13*60*1000;assert.equal((await whoami(env,mom.token)).data.authenticated,true);}
  assert.equal(renewals(),1);
  const row=env.sqlite.prepare('SELECT last_seen_at, idle_expires_at FROM family_sessions').get();
  assert.deepEqual({...row},{last_seen_at:iso(start),idle_expires_at:iso(start+180*DAY)});
});

test('the 21st session evicts the oldest one',async()=>{
  const env=environment(),mom=await signup(env),tokens=[mom.token];
  for(let index=1;index<=20;index++){env.clock.t=T0+index*1000;const result=await login(env,'mom_kim',mom.passwordKey);assert.equal(result.status,200);tokens.push(result.data.session.token);}
  assert.equal(count(env,'SELECT COUNT(*) AS n FROM family_sessions'),FAMILY_LIMITS.sessionsPerAccount);
  assert.deepEqual((await whoami(env,tokens[0])).data,EXPIRED,'oldest session evicted');
  for(const token of [tokens[1],tokens[20]])assert.equal((await whoami(env,token)).data.authenticated,true);
});

test('family libraries, media and stop controls use the family owner id and stay separate from Sites owners',async()=>{
  const env=environment(),mom=await signup(env),fam={session:mom.token,account:mom.owner};
  assert.equal((await save(env,{...fam,library:state('가족 책장')})).status,200);
  assert.equal((await save(env,{...fam,account:'owner-A',revision:1})).data.error.code,'account_changed');
  assert.equal((await save(env,{session:mom.token,account:mom.owner,sites:'owner-A',revision:1,library:state('둘째')})).status,200,'a family header wins over Sites headers');
  assert.equal((await save(env,{session:mom.token,sites:'owner-A',account:'owner-A',revision:2})).data.error.code,'account_changed');
  assert.equal((await call(env,'/api/cloud/library',{method:'GET',sites:'owner-A'})).data.exists,false,'invisible to a Sites owner');
  assert.equal((await save(env,{sites:'owner-A',account:'owner-A',library:state('사이트 책장')})).status,200);
  const read=await call(env,'/api/cloud/library',{method:'GET',...fam});
  assert.equal(read.data.revision,2);assert.equal(read.data.state.backgrounds[0].name,'둘째');
  assert.equal((await call(env,'/api/cloud/library',{method:'GET',sites:'owner-A'})).data.state.backgrounds[0].name,'사이트 책장');
  assert.equal((await upload(env,fam)).status,201);
  assert.equal((await call(env,'/api/cloud/media/'+IMAGE,{method:'GET',sites:'owner-A'})).status,404);
  const media=await handleCloudRequest(request('/api/cloud/media/'+IMAGE,{method:'GET',...fam}),env,{now:()=>env.clock.t});
  assert.deepEqual(new Uint8Array(await media.arrayBuffer()),png);
  const path='/api/cloud/jobs/auto-control-fixture-0001/control';
  assert.equal((await call(env,path,{...fam,body:{nonce:'nonce-stop-command-0001'}})).status,200);
  assert.equal((await call(env,path,{method:'GET',sites:'owner-A'})).data.stop,null);
  assert.deepEqual(env.sqlite.prepare('SELECT owner_id FROM cloud_libraries ORDER BY owner_id').all().map(row=>row.owner_id),[mom.owner,'owner-A']);
  for(const field of ['passwordKey','current_password_key','newPasswordKey','recoveryCode','recovery-code','sessionToken','familySession']) {
    const library=state();library.settings={[field]:'never'};
    assert.equal((await save(env,{...fam,revision:2,library})).data.error.code,'credentials_forbidden',field);
  }
  assert.ok([...env.objects.keys()].every(item=>!item.includes(mom.owner)&&!item.includes('family:')));
  noDDL(env);
});

test('logout deletes the session row and succeeds even when D1 fails',async()=>{
  const env=environment(),mom=await signup(env),other=await login(env,'mom_kim',mom.passwordKey);
  const out=await call(env,'/api/cloud/auth/logout',{session:mom.token});
  assert.equal(out.status,200);assert.deepEqual(out.data,{ok:true});assert.match(out.response.headers.get('Cache-Control'),/no-store/);
  assert.equal(count(env,'SELECT COUNT(*) AS n FROM family_sessions WHERE token_hash = ?',await sha(mom.token)),0);
  assert.deepEqual((await whoami(env,mom.token)).data,EXPIRED);
  assert.equal((await whoami(env,other.data.session.token)).data.authenticated,true,'other devices stay signed in');
  assert.deepEqual((await call(env,'/api/cloud/auth/logout')).data,{ok:true});
  assert.deepEqual((await call(env,'/api/cloud/auth/logout',{session:'bad'})).data,{ok:true});
  assert.equal((await call(env,'/api/cloud/auth/logout',{session:other.data.session.token,origin:'https://evil.example'})).status,403);
  const broken=environment();broken.DB.prepare=()=>{throw new Error('D1 down');};
  assert.deepEqual((await call(broken,'/api/cloud/auth/logout',{session:other.data.session.token})).data,{ok:true});
  assert.deepEqual((await call({},'/api/cloud/auth/logout',{session:other.data.session.token})).data,{ok:true});
});

test('recovery sets a new password, rotates the code, revokes every session and is single use even concurrently',async()=>{
  const env=environment(),mom=await signup(env),second=await login(env,'mom_kim',mom.passwordKey);
  const loose=mom.data.recoveryCode.toLowerCase().replace(/-/g,' ').replace(/0/g,'o').replace(/1/g,'l');
  const first=await recover(env,'Mom_Kim',loose);
  assert.equal(first.status,200);assert.deepEqual(Object.keys(first.data),['user','session','recoveryCode']);
  assert.deepEqual(first.data.user,mom.data.user);assert.match(first.data.recoveryCode,CODE);assert.notEqual(first.data.recoveryCode,mom.data.recoveryCode);
  for(const token of [mom.token,second.data.session.token])assert.deepEqual((await whoami(env,token)).data,EXPIRED);
  assert.equal((await whoami(env,first.data.session.token)).data.authenticated,true);
  assert.equal((await login(env,'mom_kim',mom.passwordKey)).status,401);
  assert.equal((await login(env,'mom_kim',first.newPasswordKey)).status,200);
  const reused=await recover(env,'mom_kim',mom.data.recoveryCode);
  assert.equal(reused.status,401);assert.deepEqual(reused.data,{error:{code:'invalid_recovery',message:'아이디나 복구 코드가 맞지 않아요.'}});
  assert.deepEqual((await recover(env,'nobody_here',first.data.recoveryCode)).data,reused.data,'unknown usernames get the same answer');
  assert.deepEqual((await recover(env,'mom_kim','not a code at all!')).data,reused.data);
  const racing=await Promise.all([recover(env,'mom_kim',first.data.recoveryCode),recover(env,'mom_kim',first.data.recoveryCode)]);
  assert.deepEqual(racing.map(item=>item.status).sort(),[200,401]);
  const winner=racing.find(item=>item.status===200),loser=racing.find(item=>item.status===401);
  assert.equal((await login(env,'mom_kim',loser.newPasswordKey)).status,401);
  assert.equal((await login(env,'mom_kim',winner.newPasswordKey)).status,200);
  const row=env.sqlite.prepare('SELECT id, recovery_hash FROM family_accounts').get();
  const normalized=winner.data.recoveryCode.replace(/-/g,'');
  assert.equal(row.recovery_hash,await sha(`dhw-recovery-v1:${row.id}:${normalized}`));
  noDDL(env);
});

test('password change rotates the token, keeps or signs out other devices and CAS never reverts a concurrent change',async()=>{
  const env=environment(),mom=await signup(env),tablet=await login(env,'mom_kim',mom.passwordKey);
  const auth={token:mom.token,owner:mom.owner},k1=key();
  assert.equal((await call(env,'/api/cloud/auth/password',{sites:'owner-A',account:'owner-A',body:{currentPasswordKey:mom.passwordKey,newPasswordKey:k1}})).data.error.code,'family_only');
  assert.equal((await call(env,'/api/cloud/auth/password',{body:{currentPasswordKey:mom.passwordKey,newPasswordKey:k1}})).status,401);
  assert.equal((await call(env,'/api/cloud/auth/password',{session:mom.token,account:'owner-A',body:{currentPasswordKey:mom.passwordKey,newPasswordKey:k1}})).data.error.code,'account_changed');
  assert.equal((await call(env,'/api/cloud/auth/password',{session:mom.token,body:{currentPasswordKey:mom.passwordKey,newPasswordKey:k1}})).data.error.code,'account_changed','X-Cloud-Account-ID is required');
  assert.equal((await changePassword(env,auth,{currentPasswordKey:key(),newPasswordKey:k1})).data.error.code,'invalid_credentials');
  assert.equal((await changePassword(env,auth,{currentPasswordKey:mom.passwordKey,newPasswordKey:k1,signOutOthers:'yes'})).data.error.code,'invalid_request');
  const kept=await changePassword(env,auth,{currentPasswordKey:mom.passwordKey,newPasswordKey:k1,signOutOthers:false});
  assert.equal(kept.status,200);assert.deepEqual(Object.keys(kept.data),['session']);assert.match(kept.data.session.token,TOKEN);
  assert.deepEqual((await whoami(env,mom.token)).data,EXPIRED,'the old token is rotated');
  assert.equal((await whoami(env,tablet.data.session.token)).data.authenticated,true,'other devices stay signed in');
  assert.equal((await login(env,'mom_kim',mom.passwordKey)).status,401);
  const k2=key(),signedOut=await changePassword(env,{token:kept.data.session.token,owner:mom.owner},{currentPasswordKey:k1,newPasswordKey:k2,signOutOthers:true});
  assert.equal(signedOut.status,200);
  for(const token of [tablet.data.session.token,kept.data.session.token])assert.deepEqual((await whoami(env,token)).data,EXPIRED);
  assert.equal(count(env,'SELECT COUNT(*) AS n FROM family_sessions'),1);
  const current={token:signedOut.data.session.token,owner:mom.owner};
  const prepare=env.DB.prepare;let concurrent=null;
  env.DB.prepare=sql=>{
    if(/^UPDATE family_accounts SET password_hash/.test(sql) && !concurrent){concurrent='pbkdf2-sha256$20000$'+'A'.repeat(22)+'$'+'B'.repeat(43);env.sqlite.prepare('UPDATE family_accounts SET password_hash = ?').run(concurrent);}
    return prepare(sql);
  };
  const lost=await changePassword(env,current,{currentPasswordKey:k2,newPasswordKey:key()});
  env.DB.prepare=prepare;
  assert.equal(lost.status,401);assert.equal(env.sqlite.prepare('SELECT password_hash FROM family_accounts').get().password_hash,concurrent,'the concurrent change is not reverted');
  assert.equal((await whoami(env,current.token)).data.authenticated,true,'a lost CAS keeps the session');
  assert.equal((await login(env,'mom_kim',k2)).status,401,'the concurrent hash replaced k2');
  env.sqlite.prepare('UPDATE family_accounts SET password_hash = ?').run(await signupHash(k2));
  const phone=createAuth(await login(env,'mom_kim',k2),mom.owner),a=key(),b=key();
  const racing=await Promise.all([changePassword(env,current,{currentPasswordKey:k2,newPasswordKey:a}),changePassword(env,phone,{currentPasswordKey:k2,newPasswordKey:b})]);
  assert.deepEqual(racing.map(item=>item.status).sort(),[200,401]);
  const winnerKey=racing[0].status===200?a:b,loserKey=winnerKey===a?b:a;
  assert.equal((await login(env,'mom_kim',loserKey)).status,401);
  assert.equal((await login(env,'mom_kim',winnerKey)).status,200);
  env.clock.t=T0+60*60*1000;
  const fresh=createAuth(await login(env,'mom_kim',winnerKey),mom.owner);
  for(let attempt=0;attempt<10;attempt++)assert.equal((await changePassword(env,fresh,{currentPasswordKey:key(),newPasswordKey:key()})).status,401);
  const limited=await changePassword(env,fresh,{currentPasswordKey:winnerKey,newPasswordKey:key()});
  assert.equal(limited.status,429);assert.ok(limited.response.headers.get('Retry-After'));
  noDDL(env);
});
function createAuth(result,owner){return {status:result.status,token:result.data?.session?.token,owner};}
async function signupHash(passwordKey,iterations=20000) {
  const salt=randomBytes(16);
  return `pbkdf2-sha256$${iterations}$${salt.toString('base64url')}$${pbkdf2Sync(Buffer.from(passwordKey,'base64url'),salt,iterations,32,'sha256').toString('base64url')}`;
}

test('account deletion removes the owner rows in every table and only that owner\'s R2 objects',async()=>{
  const env=environment(),mom=await signup(env),dad=await signup(env,{username:'dad_lee'});
  const famA={session:mom.token,account:mom.owner},famB={session:dad.token,account:dad.owner},sites={sites:'owner-A',account:'owner-A'};
  for(const owner of [famA,famB,sites]) {
    const asset=(await upload(env,owner)).data.asset,library=state();library.backgrounds[0].imageUrl='asset:'+IMAGE;
    assert.equal((await save(env,{...owner,library,manifest:[asset]})).status,200);
    assert.equal((await save(env,{...owner,revision:1,library,manifest:[asset]})).status,200);
    assert.equal((await call(env,'/api/cloud/jobs/auto-control-fixture-0001/control',{...owner,body:{nonce:'nonce-stop-command-0001'}})).status,200);
  }
  const hashA=await sha(mom.owner),keysA=[...env.objects.keys()].filter(item=>item.split('/')[1]===hashA).sort();
  assert.deepEqual(keysA.map(item=>item.split('/')[0]).sort(),['cloud-media','cloud-snapshots']);
  const others=[...env.objects.keys()].filter(item=>!keysA.includes(item));
  assert.equal((await call(env,'/api/cloud/auth/delete',{...famA,body:{passwordKey:mom.passwordKey,confirm:'delete'}})).data.error.code,'confirm_required');
  assert.equal((await call(env,'/api/cloud/auth/delete',{...famA,body:{passwordKey:key(),confirm:'삭제'}})).data.error.code,'invalid_credentials');
  assert.equal((await call(env,'/api/cloud/auth/delete',{...sites,body:{passwordKey:mom.passwordKey,confirm:'삭제'}})).data.error.code,'family_only');
  assert.equal((await call(env,'/api/cloud/auth/delete',{session:mom.token,account:dad.owner,body:{passwordKey:mom.passwordKey,confirm:'삭제'}})).data.error.code,'account_changed');
  env.deletes.length=0;
  const deleted=await call(env,'/api/cloud/auth/delete',{...famA,body:{passwordKey:mom.passwordKey,confirm:'삭제'}});
  assert.equal(deleted.status,200);assert.deepEqual(deleted.data,{deleted:true});
  for(const table of ['cloud_libraries','cloud_assets','auto_job_controls','family_sessions','family_accounts'])
    assert.equal(count(env,`SELECT COUNT(*) AS n FROM ${table} WHERE owner_id = ?`,mom.owner),0,table);
  assert.deepEqual([...env.deletes].sort(),keysA,'only this owner\'s snapshot and media objects are removed');
  assert.deepEqual([...env.objects.keys()].sort(),others.sort());
  for(const table of ['cloud_libraries','cloud_assets','auto_job_controls'])
    assert.equal(count(env,`SELECT COUNT(*) AS n FROM ${table} WHERE owner_id IN (?, ?)`,dad.owner,'owner-A'),2,table);
  assert.deepEqual((await whoami(env,mom.token)).data,EXPIRED);
  assert.equal((await login(env,'mom_kim',mom.passwordKey)).status,401);
  assert.equal((await call(env,'/api/cloud/library',{method:'GET',...famB})).data.revision,2);
  assert.equal((await call(env,'/api/cloud/library',{method:'GET',sites:'owner-A'})).data.revision,2);
  const again=await signup(env);assert.equal(again.status,201);assert.notEqual(again.owner,mom.owner,'owner ids are never reused');
  assert.equal((await call(env,'/api/cloud/library',{method:'GET',session:again.token,account:again.owner})).data.exists,false);
  noDDL(env);
});

test('family owners get a 5 GB and 20000-file media quota; Sites owners do not',async()=>{
  const env=environment(),mom=await signup(env),fam={session:mom.token,account:mom.owner};
  let filled=0;
  const fill=(owner,rows,size)=>{const insert=env.sqlite.prepare("INSERT INTO cloud_assets (owner_id, asset_id, kind, mime_type, byte_size, sha256, object_key, created_at) VALUES (?, ?, 'image', 'image/png', ?, ?, 'x', '2026-10-19T00:00:00.000Z')");env.sqlite.exec('BEGIN');for(let index=0;index<rows;index++)insert.run(owner,`image-quota-fill-${String(filled++).padStart(6,'0')}`,size,'0'.repeat(64));env.sqlite.exec('COMMIT');};
  fill(mom.owner,127,40*1024*1024);
  assert.equal((await upload(env,fam)).status,201,'below 5 GiB');
  fill(mom.owner,1,40*1024*1024-8);
  const full=await upload(env,{...fam,id:'image-cloud-fixture-quota-1'});
  assert.equal(full.status,413);assert.deepEqual(full.data,{error:{code:'quota_exceeded',message:'가족 클라우드 저장 공간(5GB)을 다 썼어요.'}});
  assert.equal((await upload(env,fam)).data.reused,true,'re-sending an already stored asset is not new usage');
  fill('owner-A',129,40*1024*1024);
  assert.equal((await upload(env,{sites:'owner-A',account:'owner-A'})).status,201,'Sites owners keep today\'s limits');
  const dad=await signup(env,{username:'dad_lee'});
  fill(dad.owner,FAMILY_LIMITS.quotaAssets-1,1);
  assert.equal((await upload(env,{session:dad.token,account:dad.owner})).status,201);
  assert.equal((await upload(env,{session:dad.token,account:dad.owner,id:'image-cloud-fixture-quota-2'})).data.error.code,'quota_exceeded');
  assert.equal(env.writes.length,3);
});

test('no table stores tokens, passwordKeys or recovery codes in clear; stored hashes use bounded PBKDF2',async()=>{
  const env=environment(),mom=await signup(env),secrets=[mom.passwordKey,mom.token,mom.data.recoveryCode,mom.data.recoveryCode.replace(/-/g,'')];
  const second=await login(env,'mom_kim',mom.passwordKey);secrets.push(second.data.session.token);
  const recovered=await recover(env,'mom_kim',mom.data.recoveryCode);
  secrets.push(recovered.newPasswordKey,recovered.data.session.token,recovered.data.recoveryCode,recovered.data.recoveryCode.replace(/-/g,''));
  const k3=key(),changed=await changePassword(env,{token:recovered.data.session.token,owner:mom.owner},{currentPasswordKey:recovered.newPasswordKey,newPasswordKey:k3});
  secrets.push(k3,changed.data.session.token);
  const tables=env.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row=>row.name);
  const dump=JSON.stringify(tables.map(name=>env.sqlite.prepare(`SELECT * FROM ${name}`).all()));
  for(const secret of secrets) {
    assert.ok(!dump.includes(secret),'secret stored in clear');
    if(TOKEN.test(secret))assert.ok(!dump.includes(Buffer.from(secret,'base64url').toString('hex')));
  }
  const row=env.sqlite.prepare('SELECT * FROM family_accounts').get();
  const match=/^pbkdf2-sha256\$(\d+)\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/.exec(row.password_hash);
  assert.ok(match);assert.equal(Number(match[1]),FAMILY_LIMITS.passwordIterations);assert.equal(FAMILY_LIMITS.passwordIterations,20000);
  assert.equal(pbkdf2Sync(Buffer.from(k3,'base64url'),Buffer.from(match[2],'base64url'),20000,32,'sha256').toString('base64url'),match[3],'hash is PBKDF2-SHA-256 over the 32 decoded key bytes');
  assert.equal(env.sqlite.prepare('SELECT token_hash FROM family_sessions WHERE token_hash = ?').get(await sha(changed.data.session.token)).token_hash.length,64);
  for(const iterations of [9999,100001,5000000]) {
    env.sqlite.prepare('UPDATE family_accounts SET password_hash = ?').run(await signupHash(k3,iterations));
    const spy=spyDeriveBits();
    try {assert.equal((await login(env,'mom_kim',k3)).status,401,String(iterations));assert.equal(spy.calls,0,'out-of-range counts are refused before hashing');}
    finally {spy.restore();}
  }
  for(const iterations of [10000,100000]) {
    env.sqlite.prepare('UPDATE family_accounts SET password_hash = ?').run(await signupHash(k3,iterations));
    assert.equal((await login(env,'mom_kim',k3)).status,200,String(iterations));
  }
  for(const broken of ['plain-text',`pbkdf2-sha1$20000$${'A'.repeat(22)}$${'B'.repeat(43)}`,`pbkdf2-sha256$20000$${'A'.repeat(21)}$${'B'.repeat(43)}`]) {
    env.sqlite.prepare('UPDATE family_accounts SET password_hash = ?').run(broken);
    assert.equal((await login(env,'mom_kim',k3)).status,401);
  }
  noDDL(env);
});

test('drizzle 0000+0001+0002 in journal order and server/cloud-schema.sql give identical sqlite_master entries',()=>{
  const migration=readFileSync(new URL('../cloud-runtime/drizzle/0002_lively_synch.sql',import.meta.url),'utf8');
  const statements=migration.split('--> statement-breakpoint').map(item=>item.trim()).filter(Boolean);
  assert.ok(statements.every(item=>/^CREATE (?:UNIQUE )?(?:TABLE|INDEX) `(?:family_accounts|family_sessions|auth_throttle|family_accounts_\w+|family_sessions_\w+)`/.test(item)),'0002 only creates the three new tables and their indexes');
  assert.doesNotMatch(migration,/__new_|DROP|ALTER|INSERT|cloud_libraries|cloud_assets|auto_job_controls/);
  const drizzle=new DatabaseSync(':memory:'),hand=new DatabaseSync(':memory:'),before=new DatabaseSync(':memory:');
  applyDrizzle(drizzle);
  hand.exec(readFileSync(new URL('../server/cloud-schema.sql',import.meta.url),'utf8'));
  assert.deepEqual(masterEntries(hand),masterEntries(drizzle));
  hand.exec(readFileSync(new URL('../server/cloud-schema.sql',import.meta.url),'utf8'));
  assert.deepEqual(masterEntries(hand),masterEntries(drizzle),'re-applying the IF NOT EXISTS schema is a no-op');
  assert.deepEqual(masterEntries(drizzle).filter(row=>row.type==='table').map(row=>row.name).sort(),['auth_throttle','auto_job_controls','cloud_assets','cloud_libraries','family_accounts','family_sessions']);
  assert.ok(masterEntries(drizzle).some(row=>row.name==='family_sessions_account_idx'&&row.table==='family_sessions'));
  applyDrizzle(before,{only:entry=>entry.idx<2});
  const existing=masterEntries(before);
  assert.deepEqual(masterEntries(drizzle).filter(row=>existing.some(old=>old.name===row.name)),existing,'0002 leaves existing tables untouched');
  for(const sql of ["INSERT INTO family_accounts VALUES ('a','owner-x','mom_kim','','h','"+'0'.repeat(64)+"','t','t')","INSERT INTO family_accounts VALUES ('a','family:x','abc','','h','"+'0'.repeat(64)+"','t','t')","INSERT INTO family_sessions VALUES ('short','a','family:x','t','t','t','t')","INSERT INTO auth_throttle VALUES ('"+'0'.repeat(64)+"',1,0)"])
    assert.throws(()=>drizzle.exec(sql),/CHECK constraint failed/,sql);
});
