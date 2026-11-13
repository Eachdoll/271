import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'multi-items-'));
const {env,sqlite}=localEnvironment(dir,'multi-test');
function client(){let cookie='';return async(method,url,body)=>{const r=await worker.fetch(new Request('https://multi.test'+url,{method,headers:{cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),env);if(r.headers.has('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return{status:r.status,body:await r.json().catch(()=>null)};};}
const admin=client(),staff=client(),other=client(),anon=client();
let rawBom, productBom, orders, schedules;
const items=[{item:'니트릴글러브',spec:'S',qty:10,unit:'BOX',lot:'LOT-N',item_category:'상품',coa_requested:true},{item:'라텍스글러브',spec:'M',qty:20,unit:'BOX',lot:'LOT-L',item_category:'상품'},{item:'PVC글러브',spec:'S',qty:30,unit:'BOX',lot:'LOT-P',item_category:'상품'}];
const batch=(entity,common,rows,key=crypto.randomUUID(),caller=staff)=>caller('POST','/api/batches/'+entity,{common,items:rows,request_id:key});
before(async()=>{
 await approvedRegistration(admin,admin,{name:'관리자',password:'password',invite:'multi-test'});
 await approvedRegistration(admin,staff,{name:'입력직원',password:'password',invite:'multi-test'});
 await approvedRegistration(admin,other,{name:'다른직원',password:'password',invite:'multi-test'});
 rawBom=(await admin('POST','/api/boms',{product:'원단',item_category:'원자재',kind:'semi',base_qty:1,unit:'kg',materials:[]})).body;
 productBom=(await admin('POST','/api/boms',{product:'니트릴글러브',item_category:'제품',kind:'finished',base_qty:10,unit:'BOX',materials:[{item:'원단',item_category:'원자재',qty:2,unit:'kg'}]})).body;
});
after(()=>{sqlite.close();fs.rmSync(dir,{recursive:true,force:true});});
test('One order submission creates three independent lines with shared batch identity and no duplicate retries',async()=>{
 const common={req_no:'PO-MULTI',vendor:'공급사',due_date:'2026-12-01'};const key=crypto.randomUUID();
 const result=await batch('purchase_order',common,items,key);assert.equal(result.status,200);orders=result.body.rows;
 assert.equal(orders.length,3);assert.equal(new Set(orders.map(r=>r.batch_id)).size,1);
 assert.deepEqual(orders.map(r=>[r.item,r.spec,r.qty,r.unit]),items.map(r=>[r.item,r.spec,r.qty,r.unit]));
 assert.equal(orders[0].created_by,'입력직원');assert.equal(orders[0].coa_requested,1);
 const replay=await batch('purchase_order',common,items,key);assert.equal(replay.body.replayed,true);assert.deepEqual(replay.body.rows.map(r=>r.id),orders.map(r=>r.id));
 assert.equal((await batch('purchase_order',common,[items[0]],key)).status,409);
 assert.equal((await batch('purchase_order',common,items,key,other)).status,409);
 const confirmed=await staff('POST','/api/po/receive',{ids:[orders[0].id],status:'ok'});assert.equal(confirmed.body.analysis_created,1);
 const list=(await staff('GET','/api/po?q=PO-MULTI')).body;assert.equal(list.find(r=>r.id===orders[0].id).recv_status,'ok');assert.equal(list.find(r=>r.id===orders[1].id).recv_status,'');
 const analysis=(await staff('GET','/api/requests?type=analysis&scope=list')).body.find(r=>r.source_id===orders[0].id);
 assert.equal(analysis.spec,'S');assert.equal(analysis.unit,'BOX');assert.equal(analysis.data.lot,'LOT-N');assert.equal(analysis.data.received_qty,10);assert.equal(analysis.batch_id,orders[0].batch_id);
});
test('Validation and storage failures roll back every line and its batch; authorization and limits apply',async()=>{
 const common={req_no:'BAD-MULTI',vendor:'공급사',due_date:'2026-12-01'};const count=()=>sqlite.prepare('SELECT count(*) n FROM purchase_orders').get().n;
 const old=count();assert.equal((await batch('purchase_order',common,[items[0],{...items[1],qty:-1}])).status,400);assert.equal(count(),old);
 assert.equal((await batch('users',common,items)).status,400);
 assert.equal((await batch('purchase_order',common,[])).status,400);assert.equal((await batch('purchase_order',common,Array(31).fill(items[0]))).status,400);
 assert.equal((await batch('purchase_order',common,items,crypto.randomUUID(),anon)).status,401);
 sqlite.exec("CREATE TRIGGER fail_multi BEFORE INSERT ON purchase_orders WHEN NEW.item='트리거실패' BEGIN SELECT RAISE(ABORT,'test forced rollback'); END;");
 const key=crypto.randomUUID();assert.equal((await batch('purchase_order',common,[items[0],{...items[1],item:'트리거실패'}],key)).status,500);
 assert.equal(count(),old);assert.equal(sqlite.prepare('SELECT count(*) n FROM item_batches WHERE batch_id=?').get(key).n,0);
 sqlite.exec('DROP TRIGGER fail_multi');
});
test('BOM-based other receipts generate one immutable incoming inspection per line atomically',async()=>{
 const rows=[{bom_id:rawBom.id,spec:'원단 S',qty:2,lot:'RAW-1',unit:'위조단위'},{bom_id:productBom.id,spec:'M',qty:3,lot:'PROD-1'}];
 const result=await batch('other_receipt',{received_date:'2026-11-13',vendor:'입고처'},rows);assert.equal(result.status,200);assert.equal(result.body.rows[0].unit,'kg');
 const linked=(await staff('GET','/api/requests?type=analysis&scope=list')).body.filter(r=>r.batch_id===result.body.batch_id);
 assert.equal(linked.length,2);assert.deepEqual(linked.map(r=>r.spec).sort(),['M','원단 S']);assert.ok(linked.every(r=>r.data.qty>0));
 const prior=sqlite.prepare('SELECT count(*) n FROM other_receipts').get().n;
 assert.equal((await batch('other_receipt',{received_date:'2026-11-13',vendor:'입고처'},[rows[0],{bom_id:999,qty:1}])).status,400);
 assert.equal(sqlite.prepare('SELECT count(*) n FROM other_receipts').get().n,prior);
});
test('Analysis, development, sample and VOC batch requests retain per-item quantities, LOT and independent approvals',async()=>{
 for(const type of ['analysis','development','sample','voc']){
  const common={type,customer:'고객사',category:'의뢰검사',data:{extra:'여러 제품 검토',purpose:'진행 확인'}};
  const result=await batch('request',common,items.map(r=>({...r,target_price:'1000원'})));assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal(result.body.rows.length,3);assert.ok(result.body.rows.every(r=>r.status==='pending'&&r.data.qty===r.qty));
  const row=result.body.rows[0];await admin('POST',`/api/requests/${row.id}/approve`);
  const awaiting=(await staff('GET',`/api/requests?type=${type}&scope=intake`)).body;assert.ok(awaiting.some(r=>r.id===result.body.rows[1].id));
  const comment=await other('POST',`/api/comments/request/${row.id}`,{content:'첫 번째 제품부터 처리 중'});assert.equal(comment.status,200);
  const change=await admin('PUT',`/api/requests/${row.id}`,{...row,data:{...row.data,extra:'내용 수정'}});assert.equal(change.status,200);assert.equal(change.body.spec,'S');assert.equal(change.body.qty,10);assert.equal(change.body.unit,'BOX');
 }
});
test('Shipment and clothing laundry lines preserve product, size, quantities and metadata permissions',async()=>{
 const shipments=await batch('shipment',{ship_date:'2026-11-13',customer:'고객사'},items);assert.equal(shipments.status,200);assert.equal(shipments.body.rows[2].lot,'LOT-P');
 const laundry=await batch('laundry',{in_date:'2026-11-13'},[{item:'원피스',spec:'S',qty:20,discard_qty:1,unit:'벌'},{item:'투피스',spec:'M',qty:30,discard_qty:2,unit:'벌'}]);
 assert.equal(laundry.status,200);assert.deepEqual(laundry.body.rows.map(r=>[r.item,r.spec,r.in_qty,r.discard_qty]),[['원피스','S',20,1],['투피스','M',30,2]]);
 assert.equal((await batch('laundry',{in_date:'2026-11-13'},[{item:'원피스',qty:1,discard_qty:3}])).status,400);
 const row=laundry.body.rows[0];assert.equal((await other('PUT',`/api/items/laundry/${row.id}`,{spec:'L'})).status,403);
 assert.equal((await staff('PUT',`/api/items/laundry/${row.id}`,{item:'원피스',spec:'L',unit:'벌'})).status,200);
 assert.ok((await staff('GET','/api/laundry?q='+encodeURIComponent('원피스'))).body.some(r=>r.id===row.id));
 const backup=await admin('GET','/api/admin/backup?table=item_batches');assert.equal(backup.status,200);assert.ok(backup.body.rows.length>0);
});
test('Multiple production plans preserve BOM snapshots per size and actual production is dated, cumulative and distinct from done checks',async()=>{
 const plan=await batch('schedule',{kind:'finished',period:'week',start_date:'2026-11-13'},[{bom_id:productBom.id,qty:100,spec:'S'},{bom_id:productBom.id,qty:200,spec:'M'}]);assert.equal(plan.status,200);schedules=plan.body.rows;
 assert.equal(schedules[0].start_date,'2026-11-09');assert.equal(schedules[0].unit,'BOX');assert.equal(schedules[0].bom_snapshot.requirements[0].qty,20);
 const row=schedules[0],endpoint=`/api/schedules/${row.id}/actuals`;
 assert.equal((await other('POST',endpoint,{production_date:'2026-11-10',qty:1,request_id:crypto.randomUUID()})).status,403);
 const key=crypto.randomUUID(),actual={production_date:'2026-11-10',qty:60,note:'1차 생산',request_id:key};
 assert.equal((await staff('POST',endpoint,actual)).status,200);assert.equal((await staff('POST',endpoint,actual)).status,200);
 assert.equal((await staff('POST',endpoint,{...actual,qty:61})).status,409);
 assert.equal((await staff('POST',endpoint,{production_date:'2026-11-12',qty:55,note:'2차 생산',request_id:crypto.randomUUID()})).status,200);
 let totals=(await other('GET',endpoint)).body;assert.equal(totals.actual_qty,115);assert.equal(totals.variance_qty,15);assert.equal(totals.achievement_rate,115);assert.equal(totals.can_write,false);
 assert.equal(totals.rows.length,2);assert.ok(totals.rows.every(r=>r.author_name==='입력직원'));
 await staff('PUT',`/api/schedules/${row.id}`,{toggle_done:true});assert.equal((await staff('GET',endpoint)).body.actual_qty,115);
 assert.equal((await staff('POST',endpoint,{production_date:'2026-11-16',qty:1,request_id:crypto.randomUUID()})).status,400);
 assert.equal((await staff('POST',endpoint,{production_date:'2026-11-12',qty:-1,request_id:crypto.randomUUID()})).status,400);
 const log=totals.rows[0];assert.equal((await staff('POST',`${endpoint}/${log.id}/void`,{reason:'중복 입력 취소'})).status,200);
 assert.equal((await staff('POST',`${endpoint}/${log.id}/void`,{reason:'다시 취소'})).status,200);
 totals=(await staff('GET',endpoint)).body;assert.equal(totals.actual_qty,60);assert.equal(totals.rows.length,2);assert.equal(totals.rows.find(r=>r.id===log.id).void_reason,'중복 입력 취소');
 assert.equal((await staff('DELETE',`/api/schedules/${row.id}`)).status,400);
 assert.equal((await staff('PUT',`/api/items/schedule/${row.id}`,{spec:'XL',unit:'BOX'})).status,400);
 assert.equal((await staff('PUT',`/api/schedules/${row.id}`,{kind:'finished',period:'day',start_date:'2026-11-10',product:row.product,qty:100,bom_id:productBom.id})).status,400);
 const listed=(await staff('GET','/api/schedules?kind=finished&from=2026-11-09&to=2026-11-15')).body.find(r=>r.id===row.id);assert.equal(listed.actual_qty,60);
});
test('Reports retain per-specification identity and explicit units; actuals do not double-count or include voided entries',async()=>{
 const report=(await staff('GET','/api/reports?from=2026-11-01&to=2026-11-30&plan_period=week')).body;
 const small=report.production.items.find(r=>r.item==='니트릴글러브 [S]');assert.equal(small.planned_qty,100);assert.equal(small.actual_qty,60);assert.equal(small.variance_qty,-40);assert.equal(small.achievement_rate,60);
 const medium=report.production.items.find(r=>r.item==='니트릴글러브 [M]');assert.equal(medium.planned_qty,200);assert.equal(medium.actual_qty,0);
 assert.equal(report.production.by_unit.find(r=>r.unit==='BOX').actual_qty,60);
 assert.ok(report.receipts.items.some(r=>r.item==='니트릴글러브 [S]'&&r.unit==='BOX'&&r.qty===10));
 assert.ok(report.shipments.series.some(r=>r.item==='라텍스글러브 [M]'&&r.unit==='BOX'&&r.qty===20));
 const daily=(await staff('GET','/api/reports?from=2026-11-01&to=2026-11-30&plan_period=day')).body;assert.equal(daily.production.plans,0);
 const backed=(await admin('GET','/api/admin/backup?table=production_actuals')).body.rows;assert.equal(backed.length,2);assert.ok(backed.some(r=>r.voided_at));
});

test('Edits keep typed size/units and synchronize request quantity and LOT; semi-finished monthly actuals obey plan boundaries',async()=>{
 const result=await batch('request',{type:'voc',customer:'VOC고객',data:{extra:'확인 요청'}},[{item:'글러브',spec:'XL',qty:3,unit:'EA',lot:'OLD-LOT'}]);const row=result.body.rows[0];
 const changed=await staff('PUT',`/api/requests/${row.id}`,{type:'voc',title:row.title,customer:row.customer,data:{qty:8,lot:'NEW-LOT',extra:'수량 정정'}});
 assert.equal(changed.body.qty,8);assert.equal(changed.body.data.qty,8);assert.equal(changed.body.lot,'NEW-LOT');assert.equal(changed.body.spec,'XL');assert.equal(changed.body.unit,'EA');
 const plans=await batch('schedule',{kind:'semi',period:'month',start_date:'2026-10-12'},[{bom_id:rawBom.id,qty:10,spec:'원단 M'},{item:'수기 반제품',qty:5,unit:'kg',spec:'L'}]);
 assert.equal(plans.status,200);const plan=plans.body.rows[0];assert.equal(plan.start_date,'2026-10-01');assert.equal(plan.unit,'kg');
 const endpoint=`/api/schedules/${plan.id}/actuals`;assert.equal((await staff('POST',endpoint,{production_date:'2026-10-31',qty:0,request_id:crypto.randomUUID()})).status,200);
 assert.equal((await staff('POST',endpoint,{production_date:'2026-11-01',qty:1,request_id:crypto.randomUUID()})).status,400);
 assert.equal((await staff('POST',endpoint,{production_date:'2026-10-31',qty:12.5,request_id:crypto.randomUUID()})).status,200);
 const totals=(await staff('GET',endpoint)).body;assert.equal(totals.actual_qty,12.5);assert.equal(totals.achievement_rate,125);
});
