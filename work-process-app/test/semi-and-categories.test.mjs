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
  const edit = await prod('PUT', `/api/semi-records/${first.body.id}`, { ...cut, qty: 1150 });
  assert.equal(edit.body.qty, 1150); assert.equal(edit.body.updated_by, '생산담당'); assert.equal(edit.body.unit_name, '1동 부직포 라인 A');
  assert.equal((await buyer('PUT', `/api/semi-records/${first.body.id}`, { ...cut, qty: 1 })).status, 403);
  assert.equal((await buyer('DELETE', `/api/semi-records/${wash.body.id}`)).status, 403);
  assert.equal((await staff('DELETE', `/api/semi-records/${wash.body.id}`)).status, 200);
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
