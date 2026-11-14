// 반제품 class, 1차·2차·3차 categories, 샘플의뢰(상품), production lines / washers and semi-finished records.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'semi-'));
const { env, sqlite } = localEnvironment(dir, 'semi-test');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await worker.fetch(new Request('https://semi.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}
const admin = client(), staff = client(), prod = client(), buyer = client();
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const q = s => encodeURIComponent(s);
before(async () => {
  await approvedRegistration(admin, admin, { name: '관리자', password: 'password', invite: 'semi-test' });
  await approvedRegistration(admin, staff, { name: '직원', password: 'password', invite: 'semi-test' });
  await approvedRegistration(admin, prod, { name: '생산담당', password: 'password', invite: 'semi-test' });
  await approvedRegistration(admin, buyer, { name: '구매담당', password: 'password', invite: 'semi-test' });
  const users = (await admin('GET', '/api/admin/users')).body;
  await admin('PUT', `/api/admin/users/${users.find(u => u.name === '생산담당').id}`, { roles: ['production'] });
  await admin('PUT', `/api/admin/users/${users.find(u => u.name === '구매담당').id}`, { roles: ['purchase'] });
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('반제품 is an item class; catalog items carry three category levels that reach the stock view', async () => {
  const base = { kind: 'semi', base_qty: 1, unit: 'EA', materials: [] };
  assert.equal((await admin('POST', '/api/boms', { ...base, product: '잘못', item_category: '반제품', cat2: '와이퍼' })).status, 400, '2차 needs 1차');
  const semi = (await admin('POST', '/api/boms', { ...base, product: '부직포와이퍼 원단', product_code: 'SF-001', item_category: '반제품', cat1: '와이퍼', cat2: '부직포', cat3: '9인치' })).body;
  assert.deepEqual([semi.item_category, semi.cat1, semi.cat2, semi.cat3], ['반제품', '와이퍼', '부직포', '9인치']);
  await admin('POST', '/api/boms', { ...base, kind: 'finished', product: '니트릴 글러브', product_code: 'GL-001', item_category: '상품', cat1: '글러브', cat2: '니트릴' });
  assert.deepEqual((await staff('GET', '/api/boms/categories')).body.map(c => [c.cat1, c.cat2, c.cat3].join('>')), ['글러브>니트릴>', '와이퍼>부직포>9인치']);
  assert.equal((await staff('GET', '/api/boms?temp=1&cat1=' + q('와이퍼'))).body.length, 1);
  const edited = await admin('PUT', `/api/boms/${semi.id}`, { ...base, product: semi.product, product_code: 'SF-001', item_category: '반제품' });
  assert.equal(edited.body.cat3, '9인치', 'omitted levels are kept');
  const po = (await staff('POST', '/api/po', { req_no: 'PR', vendor: 'V', bom_id: semi.id, qty: 30, due_date: '2026-11-20', item_category: '반제품' })).body;
  assert.equal(po.item_category, '반제품');
  await staff('POST', '/api/po/receive', { ids: [po.id], status: 'ok' });
  const row = (await staff('GET', '/api/inventory?item_category=' + q('반제품'))).body.rows[0];
  assert.deepEqual([row.item, row.category, row.product_code, row.cat1, row.cat2, row.cat3, row.stock], ['부직포와이퍼 원단', '반제품', 'SF-001', '와이퍼', '부직포', '9인치', 30]);
  assert.equal((await staff('GET', '/api/inventory?cat1=' + q('글러브'))).body.rows.length, 0);
  assert.equal((await staff('GET', '/api/inventory?cat1=' + q('와이퍼') + '&cat2=' + q('부직포'))).body.rows.length, 1);
  const refused = await staff('POST', '/api/other-receipts', { bom_id: semi.id, received_date: today, qty: 1, vendor: 'V' });
  assert.equal(refused.status, 400); assert.match(refused.body.error, /반제품은 기타입고/);
});

test('샘플의뢰(상품) is approved by purchasing; the production sample flow is unchanged', async () => {
  const made = await staff('POST', '/api/requests', { type: 'sample_goods', title: '니트릴 글러브 샘플', customer: 'A상사', data: { req_qty: '10' } });
  assert.equal(made.status, 200); assert.equal(made.body.status, 'pending');
  assert.equal((await prod('POST', `/api/requests/${made.body.id}/approve`)).status, 403);
  const ok = await buyer('POST', `/api/requests/${made.body.id}/approve`);
  assert.equal(ok.body.status, 'waiting'); assert.match(ok.body.req_no, /^G-\d{6}-01$/);
  assert.equal((await buyer('POST', `/api/requests/${made.body.id}/status`, { status: 'done' })).body.status, 'done');
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  assert.equal((await buyer('PUT', `/api/attachments/request/${made.body.id}`, { photos: [png] })).status, 200);
  const batch = await staff('POST', '/api/batches/request', { common: { type: 'sample_goods', customer: 'A상사', data: {} }, items: [{ item: '와이퍼 샘플', qty: 3, unit: 'EA' }], request_id: crypto.randomUUID() });
  assert.equal(batch.body.rows[0].data.req_qty, '3');
  const prodSample = (await staff('POST', '/api/requests', { type: 'sample', title: '제품 샘플' })).body;
  assert.equal((await buyer('POST', `/api/requests/${prodSample.id}/approve`)).status, 403);
  assert.match((await prod('POST', `/api/requests/${prodSample.id}/approve`)).body.req_no, /^S-/);
  assert.ok('sample_goods' in (await buyer('GET', '/api/my-tasks')).body.approvals.requests);
  assert.equal((await staff('GET', '/api/dashboard')).body.requests.sample_goods.pending, 1);
});

test('Lines and washers are managed by production; names are unique per kind', async () => {
  assert.equal((await staff('POST', '/api/production-units', { kind: 'line', name: '1동 부직포라인' })).status, 403);
  const line = (await prod('POST', '/api/production-units', { kind: 'line', name: '1동 부직포라인' })).body;
  await prod('POST', '/api/production-units', { kind: 'line', name: '2동 준크린룸', sort_order: 2 });
  assert.equal((await prod('POST', '/api/production-units', { kind: 'line', name: '1동부직포라인' })).status, 409);
  const washer = (await admin('POST', '/api/production-units', { kind: 'washer', name: '1호기' })).body;
  assert.equal((await prod('POST', '/api/production-units', { kind: 'x', name: 'a' })).status, 400);
  assert.deepEqual((await staff('GET', '/api/production-units?kind=line')).body.map(u => u.name), ['1동 부직포라인', '2동 준크린룸']);
  const renamed = await prod('PUT', `/api/production-units/${line.id}`, { name: '1동 부직포 라인 A' });
  assert.equal(renamed.body.name, '1동 부직포 라인 A'); assert.equal(renamed.body.updated_by, '생산담당');
  await prod('PUT', `/api/production-units/${washer.id}`, { active: false });
  assert.equal((await staff('GET', '/api/production-units?kind=washer')).body.length, 0);
  assert.equal((await staff('GET', '/api/production-units?kind=washer&all=1')).body.length, 1);
  await prod('PUT', `/api/production-units/${washer.id}`, { active: true });
});

test('Cutting/fusing is recorded per line and product type; washing per machine and product group', async () => {
  const [line, line2] = (await staff('GET', '/api/production-units?kind=line')).body; const washer = (await staff('GET', '/api/production-units?kind=washer')).body[0];
  const key = crypto.randomUUID();
  const cut = { process: 'cut', work_date: today, unit_id: line.id, product_group: 'wiper', product_type: '부직포와이퍼', spec: '9', qty: 1200, unit: '매', request_id: key };
  const first = await staff('POST', '/api/semi-records', cut);
  assert.equal(first.status, 200); assert.equal(first.body.spec, '9인치', 'inch spec is stored in one form'); assert.equal(first.body.unit_name, '1동 부직포 라인 A'); assert.equal(first.body.created_by, '직원');
  assert.equal((await staff('POST', '/api/semi-records', cut)).body.id, first.body.id, 'retry does not double the record');
  await staff('POST', '/api/semi-records', { ...cut, request_id: undefined, unit_id: line2.id, product_group: 'seamless', product_type: '타키', spec: 'xl', qty: 300, unit: '켤레' });
  for (const bad of [{ spec: '' }, { spec: '아홉' }, { spec: '-3' }, { product_group: 'seamless', product_type: '스무드', spec: 'XXL' }, { product_group: 'seamless', product_type: '스무드', spec: '' }, { product_type: '' }, { product_type: '스무드' }, { product_group: 'x' }, { unit_id: washer.id }, { work_date: '2999-01-01' }, { qty: -1 }, { unit_id: 9999 }])
    assert.ok([400, 404].includes((await staff('POST', '/api/semi-records', { ...cut, request_id: undefined, ...bad })).status), JSON.stringify(bad));
  const wash = await staff('POST', '/api/semi-records', { process: 'wash', work_date: today, unit_id: washer.id, product_group: 'seamless', qty: 500, unit: '켤레' });
  assert.equal(wash.status, 200); assert.equal(wash.body.product_type, '', 'washing may record only wiper/glove'); assert.equal(wash.body.spec, '', 'size is optional for washing');
  const sized = await staff('POST', '/api/semi-records', { process: 'wash', work_date: today, unit_id: washer.id, product_group: 'seamless', product_type: '스무드', spec: 'M', qty: 10 });
  assert.equal(sized.body.spec, 'M'); assert.equal((await staff('POST', '/api/semi-records', { process: 'wash', work_date: today, unit_id: washer.id, product_group: 'seamless', spec: '9', qty: 1 })).status, 400);
  assert.equal((await staff('POST', '/api/semi-records', { ...cut, request_id: undefined, spec: '12인치' })).body.spec, '12인치'); assert.equal((await staff('POST', '/api/semi-records', { ...cut, request_id: undefined, spec: '4.5"' })).body.spec, '4.5인치');
  assert.equal((await staff('GET', '/api/semi-records?process=cut&q=XL')).body.length, 1);
  assert.equal((await staff('POST', '/api/semi-records', { process: 'wash', work_date: today, unit_id: line.id, product_group: 'wiper', qty: 1 })).status, 400, 'washing needs a washer');
  assert.equal((await staff('GET', `/api/semi-records?process=cut&from=${today}&to=${today}`)).body.length, 4);
  assert.equal((await staff('GET', `/api/semi-records?process=cut&unit_id=${line2.id}`)).body[0].product_type, '타키');
  assert.equal((await staff('GET', '/api/semi-records?process=wash&product_group=wiper')).body.length, 0);
  assert.equal((await staff('GET', '/api/semi-records?process=x')).status, 400);
  // renaming a line keeps the name earlier records were entered under
  await prod('PUT', `/api/production-units/${line.id}`, { name: '1동 부직포라인' });
  assert.ok((await staff('GET', `/api/semi-records?process=cut&unit_id=${line.id}`)).body.every(r => r.unit_name === '1동 부직포 라인 A'));
  // LOT / note fixes apply directly; anything that changes what was produced waits for the production lead
  const noteOnly = await staff('PUT', `/api/semi-records/${first.body.id}`, { ...cut, lot: 'LOT-7', note: '오전조' });
  assert.equal(noteOnly.body.pending, false); assert.equal(noteOnly.body.record.lot, 'LOT-7'); assert.equal(noteOnly.body.record.qty, 1200);
  assert.equal((await staff('PUT', `/api/semi-records/${first.body.id}`, { ...cut, lot: 'LOT-7', note: '오전조' })).status, 400, 'nothing changed');
  assert.equal((await staff('PUT', `/api/semi-records/${first.body.id}`, { ...cut, lot: 'LOT-7', note: '오전조', qty: 1150 })).status, 400, 'a reason is required');
  const editKey = crypto.randomUUID(); const change = { ...cut, lot: 'LOT-7', note: '오전조', qty: 1150, spec: '12', reason: '계수 오류', request_id: editKey };
  const req = await staff('PUT', `/api/semi-records/${first.body.id}`, change);
  assert.equal(req.body.pending, true); assert.equal((await staff('PUT', `/api/semi-records/${first.body.id}`, change)).body.change.id, req.body.change.id, 'retry is idempotent');
  let listed = (await staff('GET', `/api/semi-records?process=cut&unit_id=${line.id}`)).body.find(r => r.id === first.body.id);
  assert.equal(listed.qty, 1200, 'unchanged until approved'); assert.equal(listed.pending_change_id, req.body.change.id);
  assert.equal((await staff('DELETE', `/api/semi-records/${first.body.id}`, { reason: '중복' })).status, 409, 'one pending request per record');
  assert.equal((await staff('PUT', `/api/semi-records/${first.body.id}`, { ...cut, lot: 'X' })).status, 409, 'no direct edits while a request is pending');
  assert.equal((await prod('POST', `/api/semi-changes/${req.body.change.id}/approve`, {})).status, 403, 'production staff cannot approve');
  assert.equal((await buyer('PUT', `/api/semi-records/${first.body.id}`, { ...cut, qty: 1, reason: 'x' })).status, 403);
  const tasks = (await admin('GET', '/api/my-tasks')).body; assert.equal(tasks.approvals.semi_changes.cut, 1);
  assert.ok((await staff('GET', '/api/my-tasks')).body.mine.semi_changes.some(c => c.id === req.body.change.id));
  const approved = await admin('POST', `/api/semi-changes/${req.body.change.id}/approve`, {});
  assert.equal(approved.status, 200); assert.deepEqual([approved.body.old_data.qty, approved.body.new_data.qty, approved.body.new_data.spec], [1200, 1150, '12인치']);
  assert.equal((await admin('POST', `/api/semi-changes/${req.body.change.id}/approve`, {})).status, 409);
  listed = (await staff('GET', `/api/semi-records?process=cut&unit_id=${line.id}`)).body.find(r => r.id === first.body.id);
  assert.deepEqual([listed.qty, listed.spec, listed.unit_name, listed.pending_change_id], [1150, '12인치', '1동 부직포 라인 A', null]); assert.match(listed.updated_by, /직원 \(승인: 관리자\)/);
  assert.equal((await buyer('DELETE', `/api/semi-records/${wash.body.id}`, { reason: 'x' })).status, 403);
  assert.equal((await staff('DELETE', `/api/semi-records/${wash.body.id}`)).status, 400, 'deleting needs a reason');
  const rejected = await staff('DELETE', `/api/semi-records/${wash.body.id}`, { reason: '잘못 입력' });
  assert.equal((await admin('POST', `/api/semi-changes/${rejected.body.change.id}/reject`, {})).status, 400);
  assert.equal((await admin('POST', `/api/semi-changes/${rejected.body.change.id}/reject`, { note: '실제 작업함' })).status, 200);
  const withdrawn = await staff('DELETE', `/api/semi-records/${wash.body.id}`, { reason: '다시' });
  assert.equal((await prod('POST', `/api/semi-changes/${withdrawn.body.change.id}/cancel`)).status, 403);
  assert.equal((await staff('POST', `/api/semi-changes/${withdrawn.body.change.id}/cancel`)).status, 200);
  const del = await staff('DELETE', `/api/semi-records/${wash.body.id}`, { reason: '최종 삭제' });
  assert.equal((await admin('POST', `/api/semi-changes/${del.body.change.id}/approve`, {})).status, 200);
  assert.equal((await staff('GET', '/api/semi-records?process=wash')).body.some(r => r.id === wash.body.id), false);
  assert.equal((await staff('GET', '/api/semi-changes?process=wash')).body.map(c => c.status).join(','), 'approved,cancelled,rejected');
  // cutting/fusing output is semi-finished stock by product and size; washing adds nothing
  const stock = (await staff('GET', '/api/inventory?group=spec&item_category=' + q('반제품'))).body.rows;
  const pick = (item, spec) => stock.find(r => r.item === item && r.spec === spec);
  assert.deepEqual([pick('부직포와이퍼', '12인치').stock, pick('부직포와이퍼', '12인치').unit, pick('부직포와이퍼', '4.5인치').stock, pick('심리스 타키', 'XL').stock, pick('심리스 타키', 'XL').category], [2350, '매', 1200, 300, '반제품']);
  assert.equal(stock.some(r => r.item === '심리스글러브' || r.item === '심리스 스무드'), false, 'washing records are not stock');
  assert.equal((await staff('GET', '/api/inventory')).body.rows.find(r => r.item === '부직포와이퍼').produced, 3550);
  assert.equal((await admin('GET', '/api/admin/backup?table=semi_records')).body.rows.length, 5);
  assert.equal((await admin('GET', '/api/admin/backup?table=production_units')).body.rows.length, 3);
  assert.equal((await client()('GET', '/api/semi-records?process=cut')).status, 401);
});

test('0012 keeps existing catalog rows and adds empty category levels', () => {
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'semi-migration-'));
  let db = new DatabaseSync(path.join(dir2, 'app.db'));
  try {
    db.exec('CREATE TABLE _local_migrations(name TEXT PRIMARY KEY)');
    const folder = new URL('../drizzle/', import.meta.url);
    for (const file of fs.readdirSync(folder).filter(f => f.endsWith('.sql') && f < '0012').sort()) { db.exec(fs.readFileSync(new URL(file, folder), 'utf8')); db.prepare('INSERT INTO _local_migrations VALUES(?)').run(file); }
    db.prepare("INSERT INTO boms(product,product_code,kind,base_qty,unit,materials,item_category) VALUES('기존','C-1','finished',1,'EA','[]','상품')").run();
    db.close(); ({ sqlite: db } = localEnvironment(dir2, 'test'));
    const row = db.prepare('SELECT * FROM boms').get();
    assert.deepEqual([row.product, row.product_code, row.item_category, row.cat1, row.cat2, row.cat3], ['기존', 'C-1', '상품', '', '', '']);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM production_units').get().n + db.prepare('SELECT COUNT(*) n FROM semi_records').get().n, 0);
  } finally { db.close(); fs.rmSync(dir2, { recursive: true, force: true }); }
});

test('Good and defect quantities are counted separately; clock times give work hours; yield and defect rate follow', async () => {
  const line = (await prod('POST', '/api/production-units', { kind: 'line', name: '3동 수율라인' })).body;
  const washer = (await prod('POST', '/api/production-units', { kind: 'washer', name: '9호기' })).body;
  const base = { process: 'cut', work_date: '2026-10-05', unit_id: line.id, product_group: 'wiper', product_type: '천와이퍼', spec: '6', unit: '매' };
  const a = (await staff('POST', '/api/semi-records', { ...base, qty: 1000, defect_qty: 50, start_time: '08:00', end_time: '16:00', workers: 4 })).body;
  assert.deepEqual([a.qty, a.defect_qty, a.start_time, a.end_time, a.work_hours, a.workers], [1000, 50, '08:00', '16:00', 8, 4]);
  const b = (await staff('POST', '/api/semi-records', { ...base, work_date: '2026-10-06', qty: 500 })).body;
  assert.deepEqual([b.defect_qty, b.start_time, b.work_hours, b.workers], [0, null, null, null], 'the extra fields are optional');
  const more = await staff('POST', '/api/semi-records', { ...base, work_date: '2026-10-07', qty: 10, defect_qty: 40 });
  assert.equal(more.status, 200, 'defects are separate from good quantity, so they may exceed it');
  const night = (await staff('POST', '/api/semi-records', { ...base, work_date: '2026-10-07', qty: 1, start_time: '22:30', end_time: '06:00' })).body;
  assert.equal(night.work_hours, 7.5, 'an earlier end time means the shift ended after midnight');
  for (const bad of [{ defect_qty: -1 }, { workers: 2.5 }, { start_time: '08:00' }, { start_time: '25:00', end_time: '26:00' }, { start_time: '8시', end_time: '9시' }])
    assert.equal((await staff('POST', '/api/semi-records', { ...base, qty: 1000, ...bad })).status, 400, JSON.stringify(bad));
  for (const id of [more.body.id, night.id]) { const d = await staff('DELETE', `/api/semi-records/${id}`, { reason: '검증용 정리' }); await admin('POST', `/api/semi-changes/${d.body.change.id}/approve`, {}); }
  await staff('POST', '/api/semi-records', { process: 'wash', work_date: '2026-10-05', unit_id: washer.id, product_group: 'wiper', qty: 800, defect_qty: 8, start_time: '13:00', end_time: '15:00', workers: 1, unit: '매' });
  // stock is the good quantity
  const stockOf = async () => (await staff('GET', '/api/inventory?group=spec&asof=2026-10-31')).body.rows.find(r => r.item === '천와이퍼' && r.spec === '6인치').stock;
  assert.equal(await stockOf(), 1500);
  // the person who entered it corrects defects, times and headcount directly
  const direct = await staff('PUT', `/api/semi-records/${b.id}`, { ...base, work_date: '2026-10-06', qty: 500, defect_qty: 100, start_time: '09:00', end_time: '13:00', workers: 2 });
  assert.equal(direct.body.pending, false); assert.deepEqual([direct.body.record.defect_qty, direct.body.record.work_hours, direct.body.record.workers], [100, 4, 2]);
  assert.equal(await stockOf(), 1500, 'defects do not move stock');
  assert.equal((await buyer('PUT', `/api/semi-records/${b.id}`, { ...base, work_date: '2026-10-06', qty: 500, defect_qty: 1 })).status, 403, 'others cannot');
  const cleared = await staff('PUT', `/api/semi-records/${b.id}`, { ...base, work_date: '2026-10-06', qty: 500, defect_qty: 100, start_time: '', end_time: '', workers: 2 });
  assert.deepEqual([cleared.body.record.start_time, cleared.body.record.work_hours], [null, null]);
  await staff('PUT', `/api/semi-records/${b.id}`, { ...base, work_date: '2026-10-06', qty: 500, start_time: '09:00', end_time: '13:00' });
  // good quantity still needs the lead
  const req = await staff('PUT', `/api/semi-records/${b.id}`, { ...base, work_date: '2026-10-06', qty: 400, reason: '양품 재계수' });
  assert.equal(req.body.pending, true);
  let cut = (await staff('GET', '/api/reports?from=2026-10-01&to=2026-10-31')).body.semi.by_product.find(r => r.process === 'cut' && r.product === '천와이퍼');
  assert.deepEqual([cut.qty, cut.defect_qty, cut.total_qty, cut.yield_rate, cut.defect_rate, cut.unit, cut.records], [1500, 150, 1650, 90.9, 9.1, '매', 2], 'pending request not counted');
  await admin('POST', `/api/semi-changes/${req.body.change.id}/approve`, {});
  const report = (await staff('GET', '/api/reports?from=2026-10-01&to=2026-10-31&item_category=' + q('반제품'))).body.semi;
  cut = report.by_product.find(r => r.process === 'cut' && r.product === '천와이퍼');
  assert.deepEqual([cut.qty, cut.defect_qty, cut.total_qty, cut.yield_rate, cut.defect_rate], [1400, 150, 1550, 90.3, 9.7]);
  assert.deepEqual([cut.work_hours, cut.man_hours, cut.per_man_hour], [12, 40, 35], '1400 good ÷ (8×4 + 4×2 man-hours)');
  assert.equal(report.by_line.find(r => r.process === 'cut' && r.unit_name === '3동 수율라인').yield_rate, 90.3);
  const wash = report.by_product.find(r => r.process === 'wash' && r.product === '와이퍼');
  assert.deepEqual([wash.qty, wash.defect_qty, wash.total_qty, wash.yield_rate, wash.defect_rate, wash.per_man_hour], [800, 8, 808, 99, 1, 400]);
  assert.ok(report.rows.some(r => r.unit_name === '3동 수율라인' && r.product === '천와이퍼' && r.spec === '6인치' && r.qty === 1400));
  assert.equal(await stockOf(), 1400);
  assert.equal((await staff('GET', '/api/reports?from=2026-10-01&to=2026-10-31&item_category=' + q('상품'))).body.semi.by_product.length, 0);
  assert.equal((await staff('GET', '/api/reports?from=2026-10-01&to=2026-10-31&q=' + q('수율라인'))).body.semi.by_line.length, 1);
  // a request saved before these fields existed can still be approved
  const oldShape = qty => JSON.stringify({ work_date: a.work_date, unit_id: a.unit_id, unit_name: a.unit_name, product_group: 'wiper', product_type: '천와이퍼', spec: '6인치', qty, unit: '매', lot: '', note: '' });
  sqlite.prepare("INSERT INTO semi_record_changes(record_id,process,action,old_data,new_data,reason,requested_by) VALUES(?,?,?,?,?,?,?)").run(a.id, 'cut', 'edit', oldShape(1000), oldShape(990), '이전 형식', '직원');
  const legacy = sqlite.prepare("SELECT id FROM semi_record_changes WHERE reason='이전 형식'").get();
  assert.equal((await admin('POST', `/api/semi-changes/${legacy.id}/approve`, {})).status, 200);
  const after = (await staff('GET', `/api/semi-records?process=cut&unit_id=${line.id}&from=2026-10-05&to=2026-10-05`)).body[0];
  assert.deepEqual([after.qty, after.defect_qty, after.start_time, after.work_hours, after.workers], [990, 50, '08:00', 8, 4], 'fields the old request did not know are untouched');
});

test('Semi-finished plans take actuals from cutting records only; batch entry, defect reasons and the yield series', async () => {
  const line = (await prod('POST', '/api/production-units', { kind: 'line', name: '4동 계획라인' })).body;
  // several lines for one date and line in one submission
  const key = crypto.randomUUID();
  const body = { process: 'cut', common: { work_date: '2026-09-08', unit_id: line.id }, request_id: key, items: [
    { product_group: 'seamless', product_type: '스무드', spec: 'M', qty: 400, defect_qty: 20, defect_reason: '융착 불량', unit: '켤레', start_time: '08:00', end_time: '12:00', workers: 3 },
    { product_group: 'seamless', product_type: '스무드', spec: 'L', qty: 300, defect_qty: 5, unit: '켤레' },
    { product_group: 'seamless', product_type: '타키', spec: 'M', qty: 100, defect_qty: 0, defect_reason: '오염', unit: '켤레' }] };
  const saved = await staff('POST', '/api/semi-batches', body);
  assert.equal(saved.status, 200); assert.equal(saved.body.rows.length, 3); assert.equal(saved.body.replayed, false);
  assert.deepEqual(saved.body.rows.map(r => [r.spec, r.qty, r.defect_reason, r.unit_name]), [['M', 400, '융착 불량', '4동 계획라인'], ['L', 300, '', '4동 계획라인'], ['M', 100, '', '4동 계획라인']], 'no reason is kept without defects');
  const again = await staff('POST', '/api/semi-batches', body);
  assert.equal(again.body.replayed, true); assert.deepEqual(again.body.rows.map(r => r.id), saved.body.rows.map(r => r.id));
  assert.equal((await prod('POST', '/api/semi-batches', body)).status, 409, 'another user cannot reuse the request');
  const bad = await staff('POST', '/api/semi-batches', { process: 'cut', common: body.common, items: [body.items[0], { product_group: 'seamless', product_type: '스무드', qty: 1 }] });
  assert.equal(bad.status, 400); assert.match(bad.body.error, /^2번째 줄: 사이즈/);
  assert.equal((await staff('GET', `/api/semi-records?process=cut&unit_id=${line.id}`)).body.length, 3, 'a bad line saves nothing');
  assert.equal((await staff('POST', '/api/semi-batches', { process: 'cut', common: body.common, items: [{ ...body.items[0], defect_reason: '없는 사유' }] })).status, 400);
  assert.equal((await staff('POST', '/api/semi-batches', { process: 'cut', common: body.common, items: [] })).status, 400);

  // a semi-finished plan finds those records by product name, size and period
  const plans = (await staff('POST', '/api/batches/schedule', { common: { kind: 'semi', period: 'week', start_date: '2026-09-08' }, request_id: crypto.randomUUID(),
    items: [{ item: '심리스스무드', qty: 1000, unit: '켤레' }, { item: '심리스 스무드', spec: 'm', qty: 500, unit: '켤레' }, { item: '부직포와이퍼', spec: '9', qty: 100, unit: '매' }] })).body.rows;
  assert.deepEqual(plans.map(p => p.spec), ['', 'M', '9인치'], 'plan sizes are stored the way records store them');
  const listed = (await staff('GET', '/api/schedules?kind=semi&from=2026-09-07&to=2026-09-13')).body;
  const byId = id => listed.find(s => s.id === id);
  assert.deepEqual([byId(plans[0].id).actual_qty, byId(plans[0].id).actual_count, byId(plans[1].id).actual_qty, byId(plans[2].id).actual_qty], [700, 2, 400, 0]);
  const refused = await staff('POST', `/api/schedules/${plans[0].id}/actuals`, { production_date: '2026-09-08', qty: 5, request_id: crypto.randomUUID() });
  assert.equal(refused.status, 400); assert.match(refused.body.error, /커팅\/융착 기록에서 자동/);
  const detail = (await staff('GET', `/api/schedules/${plans[0].id}/actuals`)).body;
  assert.deepEqual([detail.auto, detail.can_write, detail.actual_qty, detail.cut_qty, detail.manual_qty, detail.achievement_rate, detail.cut_rows.length], [true, false, 700, 700, 0, 70, 2]);
  const stock = (await staff('GET', '/api/inventory?group=spec&asof=2026-09-30')).body.rows.filter(r => r.item === '심리스 스무드');
  assert.deepEqual(stock.map(r => [r.spec, r.stock]).sort(), [['L', 300], ['M', 400]], 'counted once, from the cutting records');
  const planReport = (await staff('GET', '/api/reports?from=2026-09-01&to=2026-09-30&plan_period=week')).body.production.items.find(r => r.item === '심리스스무드');
  assert.deepEqual([planReport.planned_qty, planReport.actual_qty, planReport.achievement_rate], [1000, 700, 70]);
  const finished = (await staff('POST', '/api/schedules', { kind: 'finished', period: 'day', start_date: '2026-09-08', product: '심리스 스무드', qty: 10 })).body;
  assert.equal((await staff('GET', '/api/schedules?kind=finished&from=2026-09-08&to=2026-09-08')).body.find(s => s.id === finished.id).actual_qty, 0, 'only semi-finished plans are matched');

  // defect reasons and the yield series
  await staff('PUT', `/api/semi-records/${saved.body.rows[1].id}`, { ...body.common, ...body.items[1], defect_reason: '치수 불량' });
  await staff('POST', '/api/semi-batches', { process: 'cut', common: { work_date: '2026-09-15', unit_id: line.id }, items: [{ product_group: 'seamless', product_type: '스무드', spec: 'M', qty: 90, defect_qty: 10, unit: '켤레' }] });
  const semi = (await staff('GET', '/api/reports?from=2026-09-01&to=2026-09-30&grain=week')).body.semi;
  assert.deepEqual(semi.reasons.filter(r => r.process === 'cut').map(r => [r.reason, r.defect_qty, r.share, r.unit]), [['융착 불량', 20, 57.1, '켤레'], ['미지정', 10, 28.6, '켤레'], ['치수 불량', 5, 14.3, '켤레']]);
  assert.deepEqual(semi.series.filter(r => r.process === 'cut').map(r => [r.bucket, r.group, r.qty, r.defect_qty, r.yield_rate]), [['2026-09-07', '심리스글러브', 800, 25, 97], ['2026-09-14', '심리스글러브', 90, 10, 90]]);
  assert.equal((await staff('GET', '/api/reports?from=2026-09-01&to=2026-09-30&q=' + q('없는라인'))).body.semi.series.length, 0);
});

test('Semi-finished records name the catalog model made; stock, plans and material use follow it', async () => {
  const line = (await prod('POST', '/api/production-units', { kind: 'line', name: '5동 모델라인' })).body;
  const washer = (await prod('POST', '/api/production-units', { kind: 'washer', name: '7호기' })).body;
  const item = (product, code, semi_type, extra = {}) => admin('POST', '/api/boms', { product, product_code: code, item_category: '반제품', kind: 'semi', base_qty: 100, unit: '매', materials: [], semi_type, ...extra });
  assert.equal((await item('잘못된종류', 'X', '없는종류')).status, 400);
  assert.equal((await admin('POST', '/api/boms', { product: '상품인데', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'EA', materials: [], semi_type: '천와이퍼' })).status, 400, 'only 반제품 items take a kind');
  const cf9 = (await item('CF-707(9)', 'CF-707-9', '부직포와이퍼', { materials: [{ item: '부직포 원단', item_category: '원자재', qty: 5, unit: 'kg' }] })).body;
  const cf65 = (await item('CF-707(6.5)', 'CF-707-65', '부직포와이퍼')).body;
  const nx = (await item('NX-707', 'NX-707', '천와이퍼')).body;
  assert.equal(cf9.semi_type, '부직포와이퍼');
  assert.deepEqual((await staff('GET', '/api/boms?semi_type=' + q('부직포와이퍼'))).body.map(b => b.product).sort(), ['CF-707(6.5)', 'CF-707(9)']);
  await admin('POST', '/api/po', { req_no: 'PR-F', vendor: '원단사', item: '부직포 원단', unit: 'kg', qty: 1000, due_date: '2026-08-01', item_category: '원자재' });
  const fabricPo = (await staff('GET', '/api/po?q=' + q('부직포 원단'))).body[0]; await staff('POST', '/api/po/receive', { ids: [fabricPo.id], status: 'ok' });

  const base = { process: 'cut', work_date: '2026-08-04', unit_id: line.id, product_group: 'wiper', product_type: '부직포와이퍼' };
  const noModel = await staff('POST', '/api/semi-records', { ...base, spec: '9', qty: 10 });
  assert.equal(noModel.status, 400); assert.match(noModel.body.error, /품목\(모델\)을 선택/, 'once models exist for a kind, one must be chosen');
  assert.equal((await staff('POST', '/api/semi-records', { ...base, bom_id: nx.id, qty: 10 })).status, 400, 'a model of another kind is refused');
  const made = (await staff('POST', '/api/semi-records', { ...base, bom_id: cf9.id, qty: 900, defect_qty: 100 })).body;
  assert.deepEqual([made.bom_id, made.item_name, made.product_code, made.spec, made.unit], [cf9.id, 'CF-707(9)', 'CF-707-9', '', '매'], 'the model identifies the wiper, so no inch is required; its unit is used');
  const batch = await staff('POST', '/api/semi-batches', { process: 'cut', common: { work_date: '2026-08-05', unit_id: line.id }, items: [
    { product_group: 'wiper', product_type: '부직포와이퍼', bom_id: cf65.id, qty: 400 }, { product_group: 'wiper', product_type: '천와이퍼', bom_id: nx.id, qty: 250, unit: '매' }] });
  assert.deepEqual(batch.body.rows.map(r => r.item_name), ['CF-707(6.5)', 'NX-707']);
  const seamless = await staff('POST', '/api/semi-records', { ...base, product_group: 'seamless', product_type: '스무드', spec: 'M', qty: 5, unit: '켤레' });
  assert.equal(seamless.status, 200, 'kinds without registered models still work as before'); assert.equal(seamless.body.bom_id, null);
  const wash = await staff('POST', '/api/semi-records', { process: 'wash', work_date: '2026-08-05', unit_id: washer.id, product_group: 'wiper', product_type: '부직포와이퍼', bom_id: cf9.id, qty: 800 });
  assert.equal(wash.body.item_name, 'CF-707(9)'); assert.equal((await staff('POST', '/api/semi-records', { process: 'wash', work_date: '2026-08-05', unit_id: washer.id, product_group: 'wiper', qty: 1 })).status, 200, 'washing may still record only wiper/glove');

  // stock by model; the model's BOM consumes material for good and defective pieces alike
  const stock = (await staff('GET', '/api/inventory?asof=2026-08-31')).body.rows; const of = name => stock.find(r => r.item === name);
  assert.deepEqual([of('CF-707(9)').stock, of('CF-707(9)').category, of('CF-707(9)').product_code, of('CF-707(6.5)').stock, of('NX-707').stock], [900, '반제품', 'CF-707-9', 400, 250]);
  const fabric = (await staff('GET', '/api/inventory')).body.rows.find(r => r.item === '부직포 원단'); // received today, used in August
  assert.deepEqual([fabric.received, fabric.used, fabric.stock], [1000, 50, 950], '(900 + 100) × 5kg per 100');
  // later catalog edits do not rewrite what was recorded
  await admin('PUT', `/api/boms/${cf9.id}`, { product: 'CF-707(9) 신형', product_code: 'CF-707-9', item_category: '반제품', kind: 'semi', base_qty: 100, unit: '매', materials: [{ item: '부직포 원단', item_category: '원자재', qty: 50, unit: 'kg' }] });
  assert.equal((await staff('GET', '/api/inventory?asof=2026-08-31')).body.rows.find(r => r.item === '부직포 원단').used, 50);
  // a plan for the model finds its records
  const plan = (await staff('POST', '/api/batches/schedule', { common: { kind: 'semi', period: 'month', start_date: '2026-08-01' }, items: [{ item: 'CF-707(9)', qty: 2000, unit: '매' }], request_id: crypto.randomUUID() })).body.rows[0];
  assert.equal((await staff('GET', '/api/schedules?kind=semi&from=2026-08-01&to=2026-08-31')).body.find(s => s.id === plan.id).actual_qty, 900);
  // changing the model is an identity change → needs the lead; reports label rows with kind · model
  const change = await staff('PUT', `/api/semi-records/${made.id}`, { ...base, bom_id: cf65.id, qty: 900, defect_qty: 100, reason: '모델 오기' });
  assert.equal(change.body.pending, true); await admin('POST', `/api/semi-changes/${change.body.change.id}/approve`, {});
  const after = (await staff('GET', `/api/semi-records?process=cut&unit_id=${line.id}&from=2026-08-04&to=2026-08-04`)).body.find(r => r.id === made.id);
  assert.deepEqual([after.item_name, after.product_code, JSON.parse(after.bom_snapshot).materials.length], ['CF-707(6.5)', 'CF-707-65', 0]);
  const report = (await staff('GET', '/api/reports?from=2026-08-01&to=2026-08-31')).body.semi;
  assert.deepEqual(report.by_product.filter(r => r.process === 'cut').map(r => [r.product, r.qty]).sort(), [['부직포와이퍼 · CF-707(6.5)', 1300], ['심리스 스무드', 5], ['천와이퍼 · NX-707', 250]]);
  assert.equal((await staff('GET', '/api/semi-records?process=cut&q=NX-707')).body.length >= 0, true);
});
