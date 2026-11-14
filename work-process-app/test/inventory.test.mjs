// Stock is derived from receipts, production actuals, BOM material use, shipments and adjustments.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-'));
const { env, sqlite } = localEnvironment(dir, 'stock-test');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await worker.fetch(new Request('https://stock.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}
const admin = client(), staff = client(), lead = client();
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const stock = async (query = '') => (await staff('GET', '/api/inventory' + query)).body;
const find = (list, item, spec = '') => list.rows.find(r => r.item === item && r.spec === spec);
let bom;
before(async () => {
  await approvedRegistration(admin, admin, { name: '관리자', password: 'password', invite: 'stock-test' });
  await approvedRegistration(admin, staff, { name: '직원', password: 'password', invite: 'stock-test' });
  await approvedRegistration(admin, lead, { name: '물류팀장', password: 'password', invite: 'stock-test' });
  const users = (await admin('GET', '/api/admin/users')).body;
  await admin('PUT', `/api/admin/users/${users.find(u => u.name === '물류팀장').id}`, { roles: ['logistics_approver'] });
  bom = (await admin('POST', '/api/boms', { product: '글러브 완제품', item_category: '제품', kind: 'finished', base_qty: 10, unit: 'BOX', materials: [{ item: '원단', item_category: '원자재', qty: 2, unit: 'kg' }] })).body;
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('Stock = receipts + production − material use − shipments, by item and by size', async () => {
  const pos = (await staff('POST', '/api/batches/purchase_order', { common: { req_no: 'PR-S', vendor: '공급사', due_date: '2026-11-20' }, items: [
    { item: '원단', spec: 'A급', unit: 'kg', qty: 100, item_category: '원자재' }, { item: '원단', spec: 'B급', unit: 'kg', qty: 50, item_category: '원자재' },
    { item: '미입고품', unit: 'EA', qty: 9, item_category: '부자재' }, { item: '확인중품', unit: 'EA', qty: 9, item_category: '부자재' }] , request_id: crypto.randomUUID() })).body.rows;
  await staff('POST', '/api/po/receive', { ids: [pos[0].id], status: 'ok' });
  await staff('POST', '/api/po/receive', { ids: [pos[1].id], status: 'mismatch', recv_qty: 40 });
  await staff('POST', '/api/po/receive', { ids: [pos[3].id], status: 'checking' });
  let list = await stock();
  assert.equal(find(list, '원단').stock, 140); assert.equal(find(list, '원단').category, '원자재'); assert.equal(find(list, '원단').unit, 'kg');
  assert.equal(find(list, '미입고품'), undefined); assert.equal(find(list, '확인중품'), undefined, 'only recorded receipts count');
  const plan = (await staff('POST', '/api/schedules', { kind: 'finished', period: 'day', start_date: today, bom_id: bom.id, qty: 50 })).body;
  const actual = (await staff('POST', `/api/schedules/${plan.id}/actuals`, { production_date: today, qty: 30, request_id: crypto.randomUUID() })).body;
  await staff('POST', '/api/shipments', { ship_date: today, item: '글러브 완제품', qty: 12, customer: '고객', unit: 'BOX' });
  const shipped = (await staff('GET', '/api/shipments')).body[0];
  await staff('PUT', `/api/items/shipment/${shipped.id}`, { unit: 'BOX' });
  list = await stock();
  const product = find(list, '글러브 완제품');
  assert.deepEqual([product.produced, product.shipped, product.stock, product.unit, product.category], [30, 12, 18, 'BOX', '제품']);
  const fabric = find(list, '원단');
  assert.deepEqual([fabric.received, fabric.used, fabric.stock], [140, 6, 134], '30 produced × 2kg per 10 = 6kg used');
  const bySpec = await stock('?group=spec');
  assert.equal(find(bySpec, '원단', 'A급').stock, 100); assert.equal(find(bySpec, '원단', 'B급').stock, 40);
  assert.equal(find(bySpec, '원단', '').stock, -6, 'BOM use has no size, so it shows on the unsized row');
  assert.equal(find(bySpec, '원단', '').negative, false, 'not a shortage while the item total is positive');
  // voiding the actual (approved) restores both sides
  const v = await staff('POST', `/api/schedules/${plan.id}/actuals/${actual.id}/void`, { reason: '오입력' });
  await admin('POST', `/api/actual-changes/${v.body.change.id}/approve`, {});
  list = await stock();
  assert.equal(find(list, '원단').stock, 140); assert.equal(find(list, '글러브 완제품').stock, -12); assert.equal(find(list, '글러브 완제품').negative, true);
  assert.equal((await stock('?state=negative')).rows.length, 1);
  assert.equal((await stock('?q=' + encodeURIComponent('원단'))).rows.length, 1);
  assert.equal((await stock('?item_category=' + encodeURIComponent('원자재'))).rows.every(r => r.category === '원자재'), true);
});

test('Receipt corrections and reverts flow into stock once approved', async () => {
  const po = (await staff('POST', '/api/po', { req_no: 'PR-C', vendor: 'V', item: '정정품', qty: 20, due_date: '2026-11-20', item_category: '부자재' })).body;
  await staff('POST', '/api/po/receive', { ids: [po.id], status: 'ok' });
  assert.equal(find(await stock(), '정정품').stock, 20);
  const c = await staff('POST', `/api/po/${po.id}/receipt-changes`, { action: 'qty', recv_qty: 17, reason: '재검수' });
  assert.equal(find(await stock(), '정정품').stock, 20, 'pending request does not move stock');
  await lead('POST', `/api/receipt-changes/${c.body.change.id}/approve`, {});
  assert.equal(find(await stock(), '정정품').stock, 17);
  const r = await staff('POST', `/api/po/${po.id}/receipt-changes`, { action: 'revert', reason: '오입고' });
  await lead('POST', `/api/receipt-changes/${r.body.change.id}/approve`, {});
  assert.equal(find(await stock(), '정정품'), undefined);
});

test('Opening stock, counts and minimum levels are limited to the logistics lead or admin', async () => {
  const body = { item: '기초품', unit: 'EA', kind: 'opening', qty: 100, reason: '시스템 도입 시 재고', request_id: crypto.randomUUID() };
  assert.equal((await staff('POST', '/api/inventory/adjustments', body)).status, 403);
  const first = await lead('POST', '/api/inventory/adjustments', body);
  assert.equal(first.status, 200); assert.equal((await lead('POST', '/api/inventory/adjustments', body)).body.id, first.body.id, 'retry does not double the stock');
  assert.equal(find(await stock(), '기초품').stock, 100);
  await staff('POST', '/api/shipments', { ship_date: today, item: '기초품', qty: 30, customer: '고객' });
  const ship = (await staff('GET', '/api/shipments')).body.find(s => s.item === '기초품'); await staff('PUT', `/api/items/shipment/${ship.id}`, { unit: 'EA' });
  const count = await lead('POST', '/api/inventory/adjustments', { item: '기초품', unit: 'EA', kind: 'count', counted_qty: 65, reason: '월말 실사' });
  assert.equal(count.body.qty, -5, 'count stores the difference from the records (70 → 65)'); assert.equal(count.body.counted_qty, 65);
  const row = find(await stock(), '기초품');
  assert.deepEqual([row.adjusted, row.shipped, row.stock], [95, 30, 65]);
  for (const bad of [{ kind: 'adjust', qty: 0 }, { kind: 'opening', qty: -1 }, { kind: 'adjust', qty: 1, adj_date: '2999-01-01' }, { kind: 'x', qty: 1 }, { kind: 'adjust', qty: 1, reason: '' }])
    assert.equal((await lead('POST', '/api/inventory/adjustments', { item: '기초품', unit: 'EA', reason: '사유', ...bad })).status, 400);
  assert.equal((await staff('PUT', '/api/inventory/levels', { item: '기초품', unit: 'EA', min_qty: 80 })).status, 403);
  assert.equal((await lead('PUT', '/api/inventory/levels', { item: '기초품', unit: 'EA', min_qty: 80 })).status, 200);
  const low = find(await stock(), '기초품'); assert.equal(low.min_qty, 80); assert.equal(low.low, true);
  assert.ok((await stock('?state=low')).rows.some(r => r.item === '기초품'));
  const dash = (await staff('GET', '/api/dashboard')).body.stock; assert.ok(dash.low >= 1); assert.ok(dash.negative >= 1);
  await lead('PUT', '/api/inventory/levels', { item: '기초품', unit: 'EA', min_qty: '' });
  assert.equal(find(await stock(), '기초품').low, false);
  const moves = (await staff('GET', `/api/inventory/movements?item=${encodeURIComponent('기초품')}&unit=EA`)).body;
  assert.equal(moves.stock, 65); assert.deepEqual(moves.rows.map(m => m.src).sort(), ['adjust', 'adjust', 'ship']);
  assert.equal((await stock('?asof=2000-01-01')).rows.length, 0); assert.equal((await staff('GET', '/api/inventory?asof=2999-01-01')).status, 400);
  assert.equal((await client()('GET', '/api/inventory')).status, 401);
  const backup = await admin('GET', '/api/admin/backup?table=stock_adjustments'); assert.equal(backup.body.rows.length, 2);
  await lead('PUT', '/api/inventory/levels', { item: '기초품', unit: 'EA', min_qty: 5 });
  assert.equal((await admin('GET', '/api/admin/backup?table=stock_levels')).body.rows.length, 1);
});

test('0010 keeps existing data and starts with no adjustments', () => {
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-migration-'));
  let db = new DatabaseSync(path.join(dir2, 'app.db'));
  try {
    db.exec('CREATE TABLE _local_migrations(name TEXT PRIMARY KEY)');
    const folder = new URL('../drizzle/', import.meta.url);
    for (const file of fs.readdirSync(folder).filter(f => f.endsWith('.sql') && f < '0010').sort()) { db.exec(fs.readFileSync(new URL(file, folder), 'utf8')); db.prepare('INSERT INTO _local_migrations VALUES(?)').run(file); }
    db.prepare("INSERT INTO shipments(ship_date,item,qty,customer) VALUES('2026-11-01','기존',5,'고객')").run();
    db.close(); ({ sqlite: db } = localEnvironment(dir2, 'test'));
    assert.equal(db.prepare('SELECT qty FROM shipments').get().qty, 5);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM stock_adjustments').get().n + db.prepare('SELECT COUNT(*) n FROM stock_levels').get().n, 0);
  } finally { db.close(); fs.rmSync(dir2, { recursive: true, force: true }); }
});

test('Dashboard source-by-source stock aggregation matches inventory and survives a D1 alert-query failure', async () => {
  const inventory = await stock();
  const levels = sqlite.prepare('SELECT * FROM stock_levels').all();
  const expected = { negative: inventory.rows.filter(r => r.stock < 0).length, low: inventory.rows.filter(r => levels.some(l => l.item === r.item && l.unit === r.unit && r.stock < l.min_qty)).length };
  const original = env.DB;
  let sources = 0;
  env.DB = { ...original, prepare(sql) { if (sql.includes('WITH movements')) { assert.ok(!sql.includes('UNION ALL')); sources++; } return original.prepare(sql); } };
  try {
    const dashboard = await staff('GET', '/api/dashboard'); assert.equal(dashboard.status, 200); assert.deepEqual(dashboard.body.stock, expected); assert.equal(sources,8);
    env.DB = { ...original, prepare(sql) { if (sql.includes('WITH movements')) throw Error('simulated D1 failure'); return original.prepare(sql); } };
    const dashboardWithoutStock = await staff('GET', '/api/dashboard'); assert.equal(dashboardWithoutStock.status,200); assert.equal(dashboardWithoutStock.body.stock,null); assert.ok(dashboardWithoutStock.body.requests.analysis); assert.ok(dashboardWithoutStock.body.po);
  } finally { env.DB = original; }
});
