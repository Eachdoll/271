// Vendor directory, product codes, temporary codes for direct entry and the admin tidy-up.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'master-'));
const { env, sqlite } = localEnvironment(dir, 'master-test');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await worker.fetch(new Request('https://master.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}
const admin = client(), staff = client(), other = client();
const q = s => encodeURIComponent(s);
let glove;
before(async () => {
  await approvedRegistration(admin, admin, { name: '관리자', password: 'password', invite: 'master-test' });
  await approvedRegistration(admin, staff, { name: '직원', password: 'password', invite: 'master-test' });
  await approvedRegistration(admin, other, { name: '다른직원', password: 'password', invite: 'master-test' });
  glove = (await admin('POST', '/api/boms', { product: '니트릴 글러브', product_code: 'GL-001', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'BOX', materials: [] })).body;
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const po = (extra) => ({ req_no: 'PR-M', vendor: 'A상사', qty: 10, due_date: '2026-11-20', item_category: '상품', ...extra });

test('Anyone can register and edit vendors; names are unique ignoring spaces', async () => {
  const made = await staff('POST', '/api/vendors', { name: '서울 화학', contact_name: '김담당', phone: '010-1234-5678' });
  assert.equal(made.status, 200); assert.equal(made.body.created_by, '직원');
  assert.equal((await other('POST', '/api/vendors', { name: '서울화학' })).status, 409);
  assert.equal((await other('POST', '/api/vendors', { name: '' })).status, 400);
  const edited = await other('PUT', `/api/vendors/${made.body.id}`, { name: '서울 화학', contact_name: '박담당', phone: '02-555-0000' });
  assert.equal(edited.body.contact_name, '박담당'); assert.equal(edited.body.updated_by, '다른직원');
  assert.equal((await other('DELETE', `/api/vendors/${made.body.id}`)).status, 403, 'only the creator or an admin deletes');
  assert.equal((await staff('GET', '/api/vendors?q=' + q('박담당'))).body.length, 1);
  assert.equal((await client()('GET', '/api/vendors')).status, 401);
});

test('Picking a code or typing the same name in any spacing lands on one catalog item', async () => {
  const picked = (await staff('POST', '/api/po', po({ bom_id: glove.id, item: '무시되는 이름' }))).body;
  assert.deepEqual([picked.item, picked.product_code, picked.unit], ['니트릴 글러브', 'GL-001', 'BOX']);
  const typed = (await staff('POST', '/api/po', po({ item: '니트릴글러브' }))).body;
  assert.deepEqual([typed.item, typed.product_code], ['니트릴 글러브', 'GL-001'], 'no duplicate item for a spacing difference');
  const rows = (await staff('POST', '/api/batches/shipment', { common: { ship_date: '2026-11-13', customer: '고객사' }, items: [{ bom_id: glove.id, qty: 3 }, { item: ' 니트릴  글러브 ', qty: 2, unit: 'BOX' }], request_id: crypto.randomUUID() })).body.rows;
  assert.ok(rows.every(r => r.item === '니트릴 글러브' && r.product_code === 'GL-001' && r.unit === 'BOX'));
  const stock = (await staff('GET', '/api/inventory?asof=' + new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()))).body.rows;
  assert.equal(stock.filter(r => nameIs(r.item)).length <= 1, true);
  assert.equal((await staff('GET', '/api/boms?temp=only')).body.length, 0);
});
const nameIs = v => v.replace(/\s/g, '') === '니트릴글러브';

test('Direct entry gets a temporary code, shared by later entries of the same name', async () => {
  const first = (await staff('POST', '/api/po', po({ item: '클린룸 와이퍼', unit: 'EA', item_category: '부자재' }))).body;
  assert.match(first.product_code, /^TMP-\d{4}$/);
  const again = (await other('POST', '/api/po', po({ item: '클린룸와이퍼', item_category: '부자재' }))).body;
  assert.equal(again.product_code, first.product_code); assert.equal(again.item, '클린룸 와이퍼');
  const temps = (await staff('GET', '/api/boms?temp=only')).body;
  assert.equal(temps.length, 1); assert.deepEqual([temps[0].is_temp, temps[0].item_category, temps[0].unit, temps[0].created_by], [1, '부자재', 'EA', '직원']);
  assert.equal((await staff('GET', '/api/boms')).body.some(b => b.is_temp), false, 'temporary items stay out of production BOM choices');
  assert.equal((await staff('GET', '/api/boms?temp=1')).body.some(b => b.is_temp), true);
  const bad = await staff('POST', '/api/batches/purchase_order', { common: { req_no: 'PR-X', vendor: 'A상사', due_date: '2026-11-20' }, items: [{ item: '검증실패품', qty: -1, item_category: '부자재' }], request_id: crypto.randomUUID() });
  assert.equal(bad.status, 400); assert.equal((await staff('GET', '/api/boms?temp=only')).body.length, 1, 'an invalid line creates no temporary item');
  const edit = await staff('PUT', `/api/po/${first.id}`, po({ item: '클린룸 와이퍼', qty: 11, item_category: '부자재' }));
  assert.equal(edit.body.product_code, first.product_code, 'editing other fields keeps the code');
});

test('Admin confirms a temporary code or merges it into an existing item; past rows follow', async () => {
  const temp = (await admin('GET', '/api/boms?include_archived=1&temp=only')).body[0];
  assert.equal((await staff('PUT', `/api/boms/${temp.id}`, {})).status, 403);
  const keep = { product: '클린룸 와이퍼 9인치', kind: 'finished', base_qty: 1, unit: 'EA', materials: [], item_category: '부자재' };
  assert.equal((await admin('PUT', `/api/boms/${temp.id}`, { ...keep, product_code: temp.product_code })).status, 400, 'a real code is required');
  const fixed = await admin('PUT', `/api/boms/${temp.id}`, { ...keep, product_code: 'WP-009' });
  assert.equal(fixed.status, 200); assert.equal(fixed.body.is_temp, 0);
  const orders = (await staff('GET', '/api/po?q=' + q('와이퍼'))).body;
  assert.equal(orders.length, 2); assert.ok(orders.every(o => o.item === '클린룸 와이퍼 9인치' && o.product_code === 'WP-009'));

  const dup = (await staff('POST', '/api/batches/shipment', { common: { ship_date: '2026-11-13', customer: '고객사' }, items: [{ item: '니트릴 장갑(블루)', qty: 4, unit: 'BOX' }], request_id: crypto.randomUUID() })).body.rows[0];
  const dupTemp = (await admin('GET', '/api/boms?include_archived=1&temp=only')).body.find(b => b.product_code === dup.product_code);
  assert.equal((await admin('POST', `/api/boms/${glove.id}/merge`, { target_id: dupTemp.id })).status, 400, 'only temporary items are merged');
  assert.equal((await staff('POST', `/api/boms/${dupTemp.id}/merge`, { target_id: glove.id })).status, 403);
  assert.equal((await admin('POST', `/api/boms/${dupTemp.id}/merge`, { target_id: glove.id })).status, 200);
  const shipped = (await staff('GET', '/api/shipments?from=2026-11-13&q=' + q('글러브'))).body;
  assert.ok(shipped.some(s => s.id === dup.id && s.item === '니트릴 글러브' && s.product_code === 'GL-001'));
  assert.equal((await admin('GET', '/api/boms?include_archived=1')).body.find(b => b.id === dupTemp.id).active, 0);
  assert.equal((await staff('POST', '/api/po', po({ item: '니트릴 장갑(블루)' }))).body.product_code.startsWith('TMP-'), true, 'a merged-away name is not silently re-linked');
});

test('Using a vendor registers it, and its recent purchases are suggested newest first', async () => {
  const names = (await staff('GET', '/api/vendors')).body.map(v => v.name);
  assert.ok(names.includes('A상사') && names.includes('고객사'));
  await staff('POST', '/api/batches/purchase_order', { common: { req_no: 'PR-R', vendor: 'A 상사', due_date: '2026-11-21' }, items: [{ bom_id: glove.id, spec: 'M', qty: 7 }, { bom_id: glove.id, spec: 'L', qty: 8 }], request_id: crypto.randomUUID() });
  assert.equal((await staff('GET', '/api/vendors')).body.filter(v => v.name.replace(/\s/g, '') === 'A상사').length, 1);
  const recent = (await staff('GET', '/api/vendors/recent-items?vendor=' + q('A상사'))).body;
  assert.equal(recent.vendor.name, 'A상사');
  assert.deepEqual(recent.items.slice(0, 2).map(i => [i.item, i.spec, i.unit, i.product_code, i.qty]), [['니트릴 글러브', 'L', 'BOX', 'GL-001', 8], ['니트릴 글러브', 'M', 'BOX', 'GL-001', 7]]);
  assert.ok(recent.items.length >= 3); assert.equal(new Set(recent.items.map(i => [i.item, i.spec, i.unit].join('|'))).size, recent.items.length);
  assert.deepEqual((await staff('GET', '/api/vendors/recent-items?vendor=' + q('없는거래처'))).body, { vendor: null, items: [] });
  assert.equal((await admin('GET', '/api/admin/backup?table=vendors')).body.rows.length >= 3, true);
});

test('0011 keeps existing rows and leaves their product codes empty', () => {
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'master-migration-'));
  let db = new DatabaseSync(path.join(dir2, 'app.db'));
  try {
    db.exec('CREATE TABLE _local_migrations(name TEXT PRIMARY KEY)');
    const folder = new URL('../drizzle/', import.meta.url);
    for (const file of fs.readdirSync(folder).filter(f => f.endsWith('.sql') && f < '0011').sort()) { db.exec(fs.readFileSync(new URL(file, folder), 'utf8')); db.prepare('INSERT INTO _local_migrations VALUES(?)').run(file); }
    db.prepare("INSERT INTO purchase_orders(req_no,vendor,item,qty,due_date) VALUES('PR','기존거래처','기존품목',5,'2026-11-01')").run();
    db.prepare("INSERT INTO boms(product,kind,base_qty,unit,materials) VALUES('기존BOM','finished',1,'EA','[]')").run();
    db.close(); ({ sqlite: db } = localEnvironment(dir2, 'test'));
    const row = db.prepare('SELECT * FROM purchase_orders').get();
    assert.deepEqual([row.item, row.vendor, row.product_code], ['기존품목', '기존거래처', '']);
    assert.equal(db.prepare('SELECT is_temp FROM boms').get().is_temp, 0); assert.equal(db.prepare('SELECT COUNT(*) n FROM vendors').get().n, 0);
  } finally { db.close(); fs.rmSync(dir2, { recursive: true, force: true }); }
});
