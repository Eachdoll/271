import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'wpa-operator-'));
let env, sqlite, admin, operator, other, operatorId, line, washer, plan, semiPlan;
const day = '2026-01-12';
function client() {
  let cookie='';
  return async (method,url,body) => {
    const r=await worker.fetch(new Request('https://work.test'+url,{method,headers:{...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)}),env);
    if(r.headers.has('set-cookie')) cookie=r.headers.get('set-cookie').split(';')[0];
    return {status:r.status,body:await r.json()};
  };
}
before(async()=>{
  ({env,sqlite}=localEnvironment(dir,'test-invite')); admin=client();operator=client();other=client();
  assert.equal((await admin('POST','/api/auth/register',{name:'관리자',password:'password',invite:'test-invite'})).status,200);
  const created=await admin('POST','/api/admin/users',{name:'오퍼레이터',password:'password',roles:['operator']}); assert.equal(created.status,200);operatorId=created.body.id;
  await admin('POST','/api/admin/users',{name:'다른 작업자',password:'password',roles:['operator']});
  await operator('POST','/api/auth/login',{name:'오퍼레이터',password:'password'});await other('POST','/api/auth/login',{name:'다른 작업자',password:'password'});
  line=(await admin('POST','/api/production-units',{kind:'line',name:'1라인'})).body;
  washer=(await admin('POST','/api/production-units',{kind:'washer',name:'1호기'})).body;
  plan=(await admin('POST','/api/schedules',{kind:'finished',period:'day',start_date:day,product:'완제품',qty:100})).body;
  semiPlan=(await admin('POST','/api/schedules',{kind:'semi',period:'day',start_date:day,product:'스무드',qty:100})).body;
  assert.ok(plan.id);assert.ok(semiPlan.id);
});
after(()=>{sqlite.close();fs.rmSync(dir,{recursive:true,force:true});});
const batch=(process,unit,qty=10)=>({process,common:{work_date:day,unit_id:unit.id},items:[{product_group:'seamless',product_type:'스무드',spec:'S',qty,unit:'켤레'}],request_id:crypto.randomUUID()});
test('Operator role is assigned by admin; existing sessions see role changes and combined roles stay restricted',async()=>{
  assert.deepEqual((await operator('GET','/api/me')).body.user.roles,['operator']);
  assert.equal((await operator('GET','/api/admin/users')).status,403);
  await admin('PUT','/api/admin/users/'+operatorId,{roles:['operator','production_approver','purchase']});
  assert.equal((await operator('GET','/api/dashboard')).status,403);
  assert.equal((await operator('POST','/api/production-units',{kind:'line',name:'forbidden'})).status,403);
  await admin('PUT','/api/admin/users/'+operatorId,{roles:['operator']});
});
test('Operator can enter cutting and washing; records stay own-only and repeated submissions do not duplicate',async()=>{
  const body=batch('cut',line);const first=await operator('POST','/api/semi-batches',body);assert.equal(first.status,200);assert.equal(first.body.rows[0].created_by_id,operatorId);assert.ok(!('bom_snapshot' in first.body.rows[0]));
  const replay=await operator('POST','/api/semi-batches',body);assert.equal(replay.body.replayed,true);assert.equal(replay.body.rows[0].id,first.body.rows[0].id);
  assert.equal((await other('POST','/api/semi-batches',body)).status,409);
  assert.equal((await other('POST','/api/semi-batches',batch('cut',line,99))).status,200);
  assert.equal((await operator('POST','/api/semi-batches',batch('wash',washer))).status,200);
  const own=await operator('GET','/api/operator/semi-records?process=cut&created_by_id=999');assert.equal(own.status,200);assert.equal(own.body.length,1);assert.ok(own.body.every(r=>r.created_by_id===operatorId));assert.ok(!('bom_snapshot' in own.body[0]));
  assert.equal((await operator('POST','/api/semi-batches',batch('wash',line))).status,400);
  assert.equal((await operator('PUT','/api/semi-records/'+first.body.rows[0].id,{qty:999})).status,403);
  assert.equal((await operator('DELETE','/api/semi-records/'+first.body.rows[0].id,{reason:'x'})).status,403);
});
test('Operator writes actuals to another user’s existing finished plan only, with duplicate and date protection',async()=>{
  const body={production_date:day,qty:12,note:'실적',request_id:crypto.randomUUID()};
  const first=await operator('POST',`/api/schedules/${plan.id}/actuals`,body);assert.equal(first.status,200);
  assert.equal((await operator('POST',`/api/schedules/${plan.id}/actuals`,body)).body.id,first.body.id);
  assert.equal((await operator('POST',`/api/schedules/${plan.id}/actuals`,{...body,qty:13})).status,409);
  assert.equal((await operator('POST',`/api/schedules/${semiPlan.id}/actuals`,{...body,request_id:crypto.randomUUID()})).status,403);
  assert.equal((await operator('POST',`/api/schedules/${plan.id}/actuals`,{...body,production_date:'2026-01-13',request_id:crypto.randomUUID()})).status,400);
  await other('POST',`/api/schedules/${plan.id}/actuals`,{...body,request_id:crypto.randomUUID()});
  const own=await operator('GET','/api/operator/actuals?date='+day);assert.equal(own.body.length,1);assert.equal(own.body[0].id,first.body.id);
  assert.equal(sqlite.prepare('SELECT SUM(qty) qty FROM production_actuals WHERE schedule_id=?').get(plan.id).qty,24);
});
test('Operator read models expose only relevant catalog and finished plans for the selected day',async()=>{
  const catalog=await operator('GET','/api/operator/catalog');assert.equal(catalog.status,200);assert.equal(catalog.body.units.length,2);
  const plans=await operator('GET','/api/operator/plans?date='+day);assert.equal(plans.status,200);assert.equal(plans.body.length,1);assert.equal(plans.body[0].id,plan.id);assert.ok(!('bom_snapshot' in plans.body[0]));
  assert.equal((await operator('GET','/api/operator/plans?date=2026-02-30')).status,400);
  assert.equal((await operator('GET','/api/operator/plans?date=2999-01-01')).status,400);
  assert.equal((await client()('GET','/api/operator/catalog')).status,401);
});
test('Operator cannot bypass menu restrictions via direct API or upload URLs',async()=>{
  for(const [method,url] of [['GET','/api/reports'],['GET','/api/boms'],['GET','/api/inventory'],['GET','/api/semi-records?process=cut'],['GET',`/api/schedules/${plan.id}/actuals`],['GET','/api/admin/backup'],['POST','/api/schedules'],['POST','/api/batches/schedule'],['POST','/api/po'],['POST','/api/semi-changes/1/approve'],['POST','/api/actual-changes/1/approve'],['PUT',`/api/schedules/${plan.id}`],['GET','/uploads/aaaaaaaaaaaaaaaaaaaaaaaa.png']]) {
    assert.equal((await operator(method,url,method==='GET'?undefined:{})).status,403,method+' '+url);
  }
  assert.equal((await admin('GET','/api/dashboard')).status,200);
});
test('Operator can change password and log out; removing the role revokes actual-entry access immediately',async()=>{
  assert.equal((await operator('PUT','/api/me/password',{current:'password',password:'new-password'})).status,200);
  await admin('PUT','/api/admin/users/'+operatorId,{roles:[]});
  assert.equal((await operator('GET','/api/dashboard')).status,200);
  assert.equal((await operator('POST',`/api/schedules/${plan.id}/actuals`,{production_date:day,qty:1,request_id:crypto.randomUUID()})).status,403);
  await admin('PUT','/api/admin/users/'+operatorId,{roles:['operator']});
  assert.equal((await operator('POST','/api/auth/logout')).status,200);
  assert.equal((await operator('GET','/api/operator/catalog')).status,401);
});
