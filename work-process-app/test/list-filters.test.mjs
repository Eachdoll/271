import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpa-list-filters-'));
const { env, sqlite } = localEnvironment(dir, 'filters');
let cookie = '';
async function get(endpoint, query = {}, authenticated = true) {
  const response = await worker.fetch(new Request('https://filters.test' + endpoint + '?' + new URLSearchParams(query), { headers: authenticated ? { cookie } : {} }), env);
  return { status: response.status, body: await response.json() };
}
before(async () => {
  const login = await worker.fetch(new Request('https://filters.test/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '검색관리자', password: 'password', invite: 'filters' }) }), env);
  cookie = login.headers.get('set-cookie').split(';')[0];
  for (const [type,status,title,date,category,number,note] of [
    ['analysis','pending','Alpha%_원단','2026-11-01','수입검사',null,'긴급 원단'],
    ['analysis','rejected','Beta원단','2026-11-02','공정검사',null,'재접수'],
    ['analysis','waiting','Alpha원단','2026-11-03','수입검사','Q-1103-01','대기'],
    ['analysis','done','완료품목','2026-11-04','공정검사','Q-1104-02','합격'],
    ['development','pending','Alpha개발','2026-11-02','',null,'개발 메모'],
    ['sample','pending','Alpha샘플','2026-11-02','',null,'샘플 메모'],
  ]) sqlite.prepare('INSERT INTO requests(type,status,title,created_at,category,req_no,result_note,requester_name,customer,data) VALUES(?,?,?,?,?,?,?,?,?,?)').run(type,status,title,date+' 23:59:59',category,number,note,'직원가','한빛고객',JSON.stringify({ extra: note, lot_etc: 'LOT-원단' }));
  const p1 = sqlite.prepare("INSERT INTO purchase_orders(req_no,vendor,item,item_category,qty,due_date,coa_requested,recv_status,created_by,note) VALUES('PO-1','공급A','원단','원자재',10,'2026-11-10',1,'checking','직원가','긴급 주문')").run();
  const p2 = sqlite.prepare("INSERT INTO purchase_orders(req_no,vendor,item,item_category,qty,due_date,coa_requested,recv_status,created_by) VALUES('PO-2','공급B','상품','상품',5,'2026-12-01',0,'ok','직원나')").run();
  sqlite.prepare("INSERT INTO attachments(entity_type,entity_id,inspection_status) VALUES('purchase_order',?,'abnormal')").run(Number(p2.lastInsertRowid));
  for (const [date,item,code,note,author] of [['2026-11-01','기타A','SKU_1','씰 파손','직원가'],['2026-12-01','기타B','SKUX1','일반','직원나']]) {
    const result = sqlite.prepare('INSERT INTO other_receipts(received_date,item,item_category,qty,vendor,note,created_by,bom_snapshot) VALUES(?,?,?,?,?,?,?,?)').run(date,item,'상품',1,'입고처',note,author,JSON.stringify({ product_code: code, unit: 'EA' }));
    if (item === '기타A') sqlite.prepare("INSERT INTO attachments(entity_type,entity_id,inspection_status) VALUES('other_receipt',?,'normal')").run(Number(result.lastInsertRowid));
  }
  sqlite.prepare("INSERT INTO laundry(in_date,discard_qty,note,created_by,photos) VALUES('2026-11-01',2,'100%_오염','직원가','[\"aaaaaaaaaaaaaaaaaaaaaaaa.png\"]'),('2026-11-02',3,'박스 누락','직원나','[]'),('2026-12-01',4,'다음달','직원가','[]')").run();
  for (const [kind,period,date,product,done,code] of [['finished','day','2026-11-03','Alpha제품',0,'DAILY_CODE'],['finished','week','2026-11-02','Alpha주간',1,'WEEK_CODE'],['finished','month','2026-11-01','Beta월간',1,'MONTH_CODE'],['semi','day','2026-11-03','Alpha반제품',1,'SEMI_CODE']]) sqlite.prepare('INSERT INTO schedules(kind,period,start_date,product,qty,done,note,created_by,bom_snapshot) VALUES(?,?,?,?,?,?,?,?,?)').run(kind,period,date,product,2,done,'생산 메모','직원가',JSON.stringify({ product_code: code }));
  for (const [date,item,lot,note,author] of [['2026-11-01','출하A','LOT-A%_1','긴급 발송','직원가'],['2026-12-01','출하B','LOT-Axx1','일반 발송','직원나']]) {
    const result = sqlite.prepare('INSERT INTO shipments(ship_date,item,qty,customer,lot,note,created_by) VALUES(?,?,?,?,?,?,?)').run(date,item,1,'한빛고객',lot,note,author);
    if (item === '출하A') sqlite.prepare("INSERT INTO attachments(entity_type,entity_id,inspection_status) VALUES('shipment',?,'abnormal')").run(Number(result.lastInsertRowid));
  }
  sqlite.prepare("INSERT INTO boms(product,product_code,kind,base_qty,unit,materials,item_category,created_by,note,active) VALUES('BOM A','BOM_1','finished',1,'EA','[]','상품','직원가','검색할 메모',1),('BOM B','BOMX1','finished',1,'EA','[]','상품','직원나','기타',0)").run();
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('Request filters combine type, queue scope, registration date, status and human-readable fields', async () => {
  const result = await get('/api/requests', { type: 'analysis', scope: 'intake', status: 'pending', category: '수입검사', from: '2026-11-01', to: '2026-11-01', q: '직원가' });
  assert.equal(result.status, 200); assert.equal(result.body.length, 1); assert.equal(result.body[0].title, 'Alpha%_원단');
  assert.equal((await get('/api/requests', { type: 'analysis', scope: 'list', status: 'pending' })).body.length, 0);
  assert.equal((await get('/api/requests', { type: 'analysis', scope: 'list', q: 'Q-1103' })).body[0].status, 'waiting');
  assert.equal((await get('/api/requests', { type: 'analysis', q: '합격' })).body[0].status, 'done');
  assert.equal((await get('/api/requests', { type: 'analysis', q: 'LOT-원단' })).body.length, 4);
  assert.equal((await get('/api/requests', { type: 'development', scope: 'intake', q: '개발 메모' })).body.length, 1);
  assert.equal((await get('/api/requests', { type: 'sample', scope: 'intake', q: 'Alpha' })).body.length, 1);
});
test('Search treats percent, underscore and quotes as literal text and keeps empty filters compatible', async () => {
  for (const q of ['%', '_']) assert.equal((await get('/api/requests', { type: 'analysis', q })).body.length, 1);
  assert.equal((await get('/api/requests', { type: 'analysis', q: 'alpha' })).body.length, 2);
  assert.equal((await get('/api/requests', { type: 'analysis', q: "' OR 1=1 --" })).body.length, 0);
  assert.equal((await get('/api/requests', { type: 'analysis', scope: 'list', q: '', from: '', to: '', status: '' })).body.length, 2);
});
test('Purchase and receipt filters combine due dates, categories, COA, author and inspection state', async () => {
  const query = { from: '2026-11-01', to: '2026-11-30', item_category: '원자재', coa_requested: '1', recv: 'open', q: '긴급' };
  assert.equal((await get('/api/po', query)).body[0].req_no, 'PO-1');
  assert.equal((await get('/api/po', { coa_requested: '0', inspection_status: 'abnormal', recv: 'ok' })).body[0].req_no, 'PO-2');
  assert.equal((await get('/api/po', { inspection_status: 'unchecked', q: '직원가' })).body.length, 1);
  const other = await get('/api/other-receipts', { from: '2026-11-01', to: '2026-11-30', item_category: '상품', q: 'SKU_1', inspection_status: 'normal' });
  assert.equal(other.status, 200); assert.equal(other.body.length, 1); assert.equal(other.body[0].item, '기타A');
  assert.equal((await get('/api/other-receipts', { q: '직원나', inspection_status: 'unchecked' })).body[0].item, '기타B');
});
test('Laundry search, date and photo filters produce exactly the rows used by the displayed totals', async () => {
  const rows = (await get('/api/laundry', { from: '2026-11-01', to: '2026-11-30', q: '100%_', has_photos: '1' })).body;
  assert.equal(rows.length, 1); assert.equal(rows.reduce((sum,row) => sum + row.discard_qty, 0), 2);
  assert.equal((await get('/api/laundry', { from: '2026-11-02', to: '2026-11-02', has_photos: '0', q: '직원나' })).body.length, 1);
  assert.equal((await get('/api/laundry', { q: '직원가' })).body.length, 2);
});
test('Production filters preserve day, week and month overlap semantics while filtering completion and keywords', async () => {
  const week = await get('/api/schedules', { kind: 'finished', from: '2026-11-05', to: '2026-11-05', period: 'week', done: '1', q: 'Alpha' });
  assert.equal(week.status, 200); assert.equal(week.body.length, 1); assert.equal(week.body[0].period, 'week');
  const day = await get('/api/schedules', { kind: 'finished', from: '2026-11-03', to: '2026-11-03', period: 'day', done: '0', q: 'DAILY_CODE' });
  assert.equal(day.body.length, 1); assert.equal(day.body[0].product, 'Alpha제품');
  assert.equal((await get('/api/schedules', { kind: 'finished', from: '2026-11-03', to: '2026-11-03' })).body.length, 3);
  assert.equal((await get('/api/schedules', { kind: 'semi', from: '2026-11-03', to: '2026-11-03', q: '직원가' })).body.length, 1);
});
test('Shipment LOT and inspection filters and BOM active-state filters respect their existing access rules', async () => {
  const shipment = await get('/api/shipments', { from: '2026-11-01', to: '2026-12-31', q: 'LOT-A%_1', inspection_status: 'abnormal' });
  assert.equal(shipment.status, 200); assert.equal(shipment.body.length, 1); assert.equal(shipment.body[0].item, '출하A');
  assert.equal((await get('/api/shipments', { from: '2026-11-01', to: '2026-11-30', q: '직원가' })).body.length, 1);
  assert.equal((await get('/api/boms', { include_archived: '1', active: '0', q: '직원나', item_category: '상품' })).body[0].product, 'BOM B');
  assert.equal((await get('/api/boms', { q: 'BOM_1' })).body.length, 1);
  assert.equal((await get('/api/boms', { q: '검색할 메모' })).body[0].product, 'BOM A');
  assert.equal((await get('/api/boms', { active: '0' })).body.length, 0);
});
test('Invalid filter values and dates are rejected and list endpoints still require login', async () => {
  for (const [endpoint,query] of [
    ['/api/requests',{ type: '__proto__' }], ['/api/requests',{ type: 'analysis', from: '2026-02-31' }], ['/api/requests',{ type: 'sample', scope: 'wrong' }], ['/api/requests',{ type: 'analysis', status: 'unknown' }],
    ['/api/po',{ from: '2026-12-01', to: '2026-11-01' }], ['/api/po',{ coa_requested: 'false' }], ['/api/other-receipts',{ inspection_status: 'bad' }],
    ['/api/schedules',{ from: '2026-11-01', to: '2026-11-30', done: 'yes' }], ['/api/laundry',{ has_photos: 'yes' }], ['/api/boms',{ active: 'yes' }], ['/api/shipments',{ q: 'x'.repeat(201) }],
  ]) assert.equal((await get(endpoint,query)).status, 400, endpoint);
  assert.equal((await get('/api/requests', { type: 'analysis' }, false)).status, 401);
  assert.equal((await get('/api/shipments', { q: '한빛' }, false)).status, 401);
});
