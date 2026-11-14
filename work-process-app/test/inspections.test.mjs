import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import { localEnvironment } from '../local.mjs';import worker from '../worker.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wpa-inspections-'));const {env,sqlite}=localEnvironment(dir,'test-invite');
function client(){let cookie='';return async(method,url,body)=>{const res=await worker.fetch(new Request('https://work.test'+url,{method,headers:{cookie,...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)}),env);if(res.headers.has('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];return {status:res.status,body:await res.json()};};}
const admin=client(),lead=client(),quality=client(),staff=client(),operator=client();let incoming,outgoing,glove;
const spec=(product,kind='수입검사',item_category='원자재')=>({product,kind,item_category,aliases:[],items:[{name:'흡수속도 MD',unit:'초',min:0,max:60,count:2},{name:'흡수속도 CD',unit:'초',min:0,max:60,count:2}]});
const req=(title,category='수입검사',item_category='원자재')=>({type:'analysis',title,category,data:{item_category}});
const values=(a=20,b=30,c=40,d=60)=>[{lot:'LOT.1 / N1',values:{i0:[a,b],i1:[c,d]}}];
const details=id=>quality('GET',`/api/requests/${id}/inspection`);
const approved=async(body)=>{const r=await staff('POST','/api/requests',body);assert.equal(r.status,200);assert.equal((await lead('POST',`/api/requests/${r.body.id}/approve`)).status,200);return r.body.id;};
before(async()=>{
  await admin('POST','/api/auth/register',{name:'관리자',password:'password',invite:'test-invite'});
  for(const [c,name,roles] of [[lead,'품질팀장',['quality_approver']],[quality,'품질팀원',['quality']],[staff,'일반사용자',[]],[operator,'작업자',['operator']]]){assert.equal((await admin('POST','/api/admin/users',{name,password:'password',roles})).status,200);await c('POST','/api/auth/login',{name,password:'password'});}
});
after(()=>{sqlite.close();fs.rmSync(dir,{recursive:true,force:true});});
test('Only quality lead/admin configures specs; aliases cannot collide and invalid ranges are rejected',async()=>{
  assert.equal((await quality('POST','/api/inspection-specs',spec('NX-7'))).status,403);
  assert.equal((await staff('POST','/api/inspection-specs',spec('NX-7'))).status,403);
  assert.equal((await operator('GET','/api/inspection-specs')).status,403);
  assert.equal((await lead('POST','/api/inspection-specs',{...spec('NX-7'),aliases:['NX-707D']})).status,200);
  incoming=(await lead('GET','/api/inspection-specs')).body.specs[0];
  assert.equal((await lead('POST','/api/inspection-specs',spec('nX-707d'))).status,409);
  assert.equal((await lead('POST','/api/inspection-specs',{...spec('잘못된 범위'),items:[{name:'bad',unit:'s',min:10,max:3,count:1}]})).status,400);
  assert.equal((await lead('POST','/api/inspection-specs',spec('NX-7','출하검사','상품'))).status,200);
  outgoing=(await lead('GET','/api/inspection-specs')).body.specs.find(s=>s.kind==='출하검사');
});
test('Request snapshots freeze kind, category, aliases and limits; configuration edits affect new requests only',async()=>{
  const old=await approved(req('NX-707D'));
  assert.equal((await details(old)).body.spec.revision,1);
  assert.equal((await lead('PUT',`/api/inspection-specs/${incoming.id}`,{...incoming,items:incoming.items.map(i=>({...i,max:50}))})).status,200);
  assert.equal((await details(old)).body.spec.items[0].max,60);
  const fresh=await approved(req('NX-7'));assert.equal((await details(fresh)).body.spec.items[0].max,50);
  assert.equal((await lead('PUT',`/api/inspection-specs/${incoming.id}`,incoming)).status,409);
  assert.equal((await quality('PUT',`/api/requests/${old}`,req('별도 제품'))).status,400);
  incoming=(await lead('GET','/api/inspection-specs')).body.specs.find(s=>s.id===incoming.id);
  assert.equal((await lead('PUT',`/api/inspection-specs/${incoming.id}`,{...incoming,items:incoming.items.map(i=>({...i,max:60}))})).status,200);
  incoming=(await lead('GET','/api/inspection-specs')).body.specs.find(s=>s.id===incoming.id);
});
test('All values decide outcome, bounds are inclusive, blank remains pending and zero is a real value',async()=>{
  const id=await approved(req('NX-7'));
  assert.equal((await staff('PUT',`/api/requests/${id}/inspection`,{revision:0,rows:values()})).status,403);
  let r=await quality('PUT',`/api/requests/${id}/inspection`,{revision:0,rows:values(0,60,60,''),result:'pass'});assert.equal(r.status,200);assert.equal(r.body.result,'pending');assert.equal(r.body.values[0].values.i0[0],0);
  assert.equal((await details(id)).body.request.status,'progress');
  r=await quality('PUT',`/api/requests/${id}/inspection`,{revision:1,rows:values(0,60,60,60)});assert.equal(r.body.result,'pass');assert.equal((await details(id)).body.request.status,'done');
  assert.equal((await quality('PUT',`/api/requests/${id}/inspection`,{revision:2,rows:values(1,1,1,61)})).status,400,'reason required for correcting judged result');
  r=await quality('PUT',`/api/requests/${id}/inspection`,{revision:2,reason:'재측정',rows:values(1,1,1,61)});assert.equal(r.body.result,'fail','low average cannot hide one failing value');
  const history=(await details(id)).body.history;assert.equal(history.length,3);
  const previous=await quality('GET',`/api/requests/${id}/inspection/history/${history[1].id}`);assert.equal(previous.body.result,'pass');assert.equal(previous.body.values[0].values.i1[1],60);
  assert.equal((await admin('DELETE',`/api/requests/${id}`)).status,400);
  assert.equal((await quality('PUT',`/api/requests/${id}/inspection`,{revision:2,reason:'stale',rows:values()})).status,409);
});
test('Peel strength uses every reading, with 3.0 passing and 2.99 failing',async()=>{
  assert.equal((await lead('POST','/api/inspection-specs',{...spec('HD-08p'),aliases:['Coolove'],items:[{name:'박리강도',unit:'kgf',min:3,max:null,count:5}]})).status,200);
  glove=(await lead('GET','/api/inspection-specs')).body.specs.find(s=>s.product==='HD-08p');
  const id=await approved(req('Coolove'));let r=await quality('PUT',`/api/requests/${id}/inspection`,{revision:0,rows:[{lot:'Roll 1',values:{i0:[3,4,5,6,7]}}]});assert.equal(r.body.result,'pass');
  r=await quality('PUT',`/api/requests/${id}/inspection`,{revision:1,reason:'추가 확인',rows:[{lot:'Roll 1',values:{i0:[2.99,8,8,8,8]}}]});assert.equal(r.body.result,'fail');
});
test('Pending requests cannot be measured or marked complete without inspection values',async()=>{
  const r=await staff('POST','/api/requests',req('NX-7'));const id=r.body.id;
  assert.equal((await quality('PUT',`/api/requests/${id}/inspection`,{revision:0,rows:values()})).status,400);
  await lead('POST',`/api/requests/${id}/approve`);
  assert.equal((await quality('POST',`/api/requests/${id}/status`,{status:'done'})).status,400);
  assert.equal((await quality('PUT',`/api/requests/${id}/inspection`,{revision:0,rows:[{lot:'X',values:{i0:[true,2],i1:[1,2]}}]})).status,400);
  assert.equal((await quality('PUT',`/api/requests/${id}/inspection`,{revision:0,rows:[{lot:'X',values:{i0:[1],i1:[1,2]}}]})).status,400);
});
test('Concurrent writes preserve one revision and one history entry',async()=>{
  const id=await approved(req('NX-7'));const all=await Promise.all([quality('PUT',`/api/requests/${id}/inspection`,{revision:0,rows:values()}),lead('PUT',`/api/requests/${id}/inspection`,{revision:0,rows:values(30)})]);
  assert.deepEqual(all.map(r=>r.status).sort(),[200,409]);assert.equal((await details(id)).body.history.length,1);
});
test('Receipt and multi-item creation attach the configured rule atomically without changing receipt snapshots',async()=>{
  const order=await staff('POST','/api/po',{req_no:'inspection-po',vendor:'유성',item:'NX-707D',qty:100,due_date:'2026-11-20',item_category:'원자재'});assert.equal(order.status,200);
  const received=await staff('POST','/api/po/receive',{ids:[order.body.id],status:'ok'});assert.equal(received.status,200);
  const list=(await staff('GET','/api/requests?type=analysis')).body;const auto=list.find(r=>r.source_id===order.body.id&&r.source_type==='purchase_order');assert.ok(auto.inspection_snapshot);assert.equal(JSON.parse(auto.inspection_snapshot).id,incoming.id);assert.equal(auto.data.received_qty,100);
  const batch=await staff('POST','/api/batches/request',{request_id:crypto.randomUUID(),common:{type:'analysis',category:'출하검사',data:{item_category:'상품'}},items:[{item:'NX-7',qty:2,unit:'EA'},{item:'NX-7',qty:3,unit:'EA'}]});assert.equal(batch.status,200);assert.equal(batch.body.rows.length,2);assert.ok(batch.body.rows.every(r=>JSON.parse(r.inspection_snapshot).id===outgoing.id));
});
test('Missing specs stay unconfigured; only lead may bind a matching category and binding is immutable',async()=>{
  const id=await approved(req('알 수 없는 원단'));assert.equal((await details(id)).body.spec,null);
  assert.equal((await quality('POST',`/api/requests/${id}/inspection/spec`,{spec_id:incoming.id})).status,403);
  assert.equal((await lead('POST',`/api/requests/${id}/inspection/spec`,{spec_id:outgoing.id})).status,400);
  assert.equal((await lead('POST',`/api/requests/${id}/inspection/spec`,{spec_id:incoming.id})).status,200);
  assert.equal((await lead('POST',`/api/requests/${id}/inspection/spec`,{spec_id:glove.id})).status,409);
});
test('Category, inspection kind, product/alias search and result filters compose safely',async()=>{
  const id=await approved(req('NX-7','출하검사','상품'));await quality('PUT',`/api/requests/${id}/inspection`,{revision:0,rows:values()});
  const page=await staff('GET','/api/inspections?'+new URLSearchParams({kind:'출하검사',item_category:'상품',q:'NX-7',result:'pass'}));assert.equal(page.status,200);assert.ok(page.body.rows.some(r=>r.id===id));assert.ok(page.body.rows.every(r=>r.item_category==='상품'&&r.result==='pass'&&r.category==='출하검사'));
  const alias=await staff('GET','/api/inspections?'+new URLSearchParams({q:'Coolove',item_category:'원자재'}));assert.ok(alias.body.rows.length);assert.ok(alias.body.rows.every(r=>r.title==='Coolove'));
  assert.equal((await staff('GET','/api/inspections?q=%25')).body.rows.length,0,'percent is literal');
  assert.equal((await staff('GET','/api/inspections?item_category=invalid')).status,400);
  assert.equal((await operator('GET','/api/inspections')).status,200);
  const backup=(await admin('GET','/api/admin/backup')).body;assert.ok(backup.tables.includes('inspection_measurement_history'));
});
test('Specification alias collision rolls back edits and preserves both prior mappings',async()=>{
  const before=(await lead('GET','/api/inspection-specs')).body.specs.find(s=>s.id===glove.id);
  assert.equal((await lead('PUT',`/api/inspection-specs/${glove.id}`,{...before,aliases:['NX-707D']})).status,409);
  const after=(await lead('GET','/api/inspection-specs')).body.specs.find(s=>s.id===glove.id);assert.equal(after.revision,before.revision);assert.deepEqual(after.aliases,before.aliases);
  const id=await approved(req('Coolove'));assert.equal((await details(id)).body.spec.id,glove.id);
});
test('Inspection pagination has no gaps or duplicates and filters apply before pagination',async()=>{
  const insert=sqlite.prepare("INSERT INTO requests(type,category,title,data) VALUES('analysis','수입검사',?,'{\"item_category\":\"부자재\"}')");
  for(let i=0;i<105;i++)insert.run('pagination-'+i);
  const first=(await staff('GET','/api/inspections?item_category='+encodeURIComponent('부자재')+'&q=pagination')).body;assert.equal(first.rows.length,100);assert.ok(first.next);
  const second=(await staff('GET','/api/inspections?'+new URLSearchParams({item_category:'부자재',q:'pagination',before:first.next}))).body;assert.equal(second.rows.length,5);assert.equal(second.next,null);assert.equal(new Set([...first.rows,...second.rows].map(r=>r.id)).size,105);
});

test('Operators may read inspections and history but cannot edit even with quality roles', async()=>{
  const user=(await admin('GET','/api/admin/users')).body.find(u=>u.name==='작업자');
  await admin('PUT','/api/admin/users/'+user.id,{roles:['operator','quality_approver']});
  const id=await approved(req('NX-7'));
  const saved=await quality('PUT',`/api/requests/${id}/inspection`,{revision:0,rows:values()});assert.equal(saved.status,200);
  const d=(await operator('GET',`/api/requests/${id}/inspection`)).body;assert.equal(d.can_write,false);assert.equal(d.can_manage,false);
  assert.equal((await operator('GET',`/api/requests/${id}/inspection/history/${d.history[0].id}`)).status,200);
  assert.equal((await operator('PUT',`/api/requests/${id}/inspection`,{revision:1,rows:values()})).status,403);
  assert.equal((await operator('POST',`/api/requests/${id}/inspection/spec`,{spec_id:incoming.id})).status,403);
  assert.equal((await operator('POST','/api/inspection-specs',spec('blocked'))).status,403);
});
test('Reusable inspection items preserve permission, revision and existing request snapshots',async()=>{
  const initial=await lead('GET','/api/inspection-items');assert.equal(initial.status,200);assert.ok(initial.body.items.some(i=>i.group==='천와이퍼'&&i.name==='린트'));
  const item={group:'천와이퍼',name:'흡수량',unit:'g/m²',min:20,max:null,count:3};
  assert.equal((await quality('POST','/api/inspection-items',{revision:initial.body.revision,item})).status,403);
  const id=await approved(req('NX-7'));const snapshot=(await details(id)).body.spec;
  const stored=await lead('POST','/api/inspection-items',{revision:initial.body.revision,item});assert.equal(stored.status,200);assert.ok(stored.body.items.some(i=>i.name==='흡수량'&&i.min===20&&i.count===3));
  assert.equal((await lead('POST','/api/inspection-items',{revision:initial.body.revision,item})).status,409);
  assert.equal((await lead('POST','/api/inspection-items',{revision:stored.body.revision,item:{...item,min:30,max:20}})).status,400);
  assert.deepEqual((await details(id)).body.spec,snapshot);
});
