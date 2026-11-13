import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpa-reports-'));
const { env, sqlite } = localEnvironment(dir, 'reports');
let cookie = '', confirmedId;
async function api(query, authenticated = true) {
  const response = await worker.fetch(new Request('https://reports.test/api/reports?' + new URLSearchParams(query), { headers: authenticated ? { cookie } : {} }), env);
  return { status: response.status, body: await response.json() };
}
const range = { from: '2026-11-01', to: '2026-11-10', grain: 'day' };
before(async () => {
  const login = await worker.fetch(new Request('https://reports.test/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '리포트담당', password: 'password', invite: 'reports' }) }), env);
  cookie = login.headers.get('set-cookie').split(';')[0];
  const request = (date, status, title, category, type = 'analysis') => sqlite.prepare('INSERT INTO requests(type,status,title,customer,category,data,created_at) VALUES(?,?,?,?,?,?,?)').run(type, status, title, '공급사', '수입검사', JSON.stringify(category ? { item_category: category } : {}), date + ' 23:59:59');
  request('2026-11-01', 'pending', 'A', '제품'); request('2026-11-02', 'done', 'A', '제품'); request('2026-11-08', 'progress', 'B', '원자재'); request('2026-11-10', 'done', '수동', '');
  request('2026-12-01', 'done', '범위 밖', '제품'); request('2026-10-31', 'done', '범위 밖', '제품'); request('2026-11-02', 'done', '개발', '제품', 'development');
  request('2025-12-31', 'done', '연말', '제품'); request('2026-01-01', 'waiting', '연초', '제품');
  function purchase(item, category, qty, actual, status, date) { return Number(sqlite.prepare('INSERT INTO purchase_orders(req_no,vendor,item,item_category,qty,recv_qty,recv_status,recv_at,recv_by) VALUES(?,?,?,?,?,?,?,?,?)').run('R-' + item, '공급사', item, category, qty, actual, status, date + ' 10:00:00', '최초 처리자').lastInsertRowid); }
  const damaged = purchase('A', '제품', 100, 95, 'mismatch', '2026-11-03'); confirmedId = purchase('C', '상품', 20, 20, 'ok', '2026-11-04'); purchase('제외', '제품', 50, null, 'checking', '2026-11-05');
  function receipt(date, item, category, qty, unit) { return Number(sqlite.prepare('INSERT INTO other_receipts(received_date,item,item_category,qty,vendor,bom_snapshot) VALUES(?,?,?,?,?,?)').run(date, item, category, qty, '공급사', JSON.stringify({ unit })).lastInsertRowid); }
  receipt('2026-11-03', 'A', '제품', 5, 'EA'); const badOther = receipt('2026-11-09', 'X', '원자재', 2.5, 'kg'); receipt('2026-11-10', 'Y', '원자재', 7.5, 'kg');
  for (const [entity, id] of [['purchase_order', damaged], ['other_receipt', badOther]]) sqlite.prepare("INSERT INTO attachments(entity_type,entity_id,inspection_status) VALUES(?,?,'abnormal')").run(entity, id);
  function plan(period, date, item, qty, done, unit = '', category = '') { sqlite.prepare('INSERT INTO schedules(kind,period,start_date,product,qty,done,bom_snapshot) VALUES(?,?,?,?,?,?,?)').run('finished', period, date, item, qty, done, JSON.stringify({ unit, item_category: category })); }
  plan('day', '2026-11-03', 'A', 10, 1, 'EA', '제품'); plan('day', '2026-11-04', 'A', 20, 0, 'EA', '제품'); plan('day', '2026-11-09', 'B', 1.5, 1, 'kg', '원자재');
  plan('day', '2026-11-08', '미지정 Z', 3, 1); plan('day', '2026-11-08', '미지정 W', 2, 0);
  plan('week', '2026-11-02', 'A', 500, 1, 'EA', '제품'); plan('month', '2026-11-01', 'A', 1000, 1, 'EA', '제품');
  sqlite.prepare("INSERT INTO shipments(ship_date,item,qty,customer) VALUES('2026-11-05','A',7,'고객사')").run();
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('Reports require authentication and validate ranges and filters', async () => {
  assert.equal((await api(range, false)).status, 401);
  for (const invalid of [{ grain: 'year' }, { plan_period: 'all' }, { from: '2026-02-31' }, { from: '2026-11-11' }, { from: '2020-01-01' }, { item_category: 'unknown' }, { q: 'x'.repeat(201) }]) assert.equal((await api({ ...range, ...invalid })).status, 400);
});
test('Daily analysis is a current-status cohort with zero-filled dates', async () => {
  const result = await api(range); assert.equal(result.status, 200); const report = result.body;
  assert.equal(report.buckets.length, 10); assert.equal(report.range.timezone, 'Asia/Seoul');
  assert.equal(report.analysis.total, 4); assert.equal(report.analysis.statuses.done, 2); assert.equal(report.analysis.completion_rate, 50);
  assert.deepEqual(report.analysis.series.find(row => row.bucket === '2026-11-06'), { bucket: '2026-11-06', total: 0, done: 0 });
  assert.equal(report.analysis.series.find(row => row.bucket === '2026-11-10').done, 1);
});
test('Receipts use actual mismatch quantities and keep units and unassigned items separate', async () => {
  const report = (await api(range)).body;
  assert.equal(report.receipts.count, 5); assert.equal(report.receipts.abnormal_count, 2);
  assert.equal(report.receipts.by_unit.find(row => row.unit === 'EA').qty, 5);
  assert.equal(report.receipts.by_unit.find(row => row.unit === 'kg').qty, 10);
  assert.equal(report.receipts.by_unit.find(row => row.unit === '단위 미지정 · A').qty, 95);
  assert.equal(report.receipts.by_unit.find(row => row.unit === '단위 미지정 · C').qty, 20);
  assert.equal(report.shipments.count, 1); assert.equal(report.shipments.by_unit[0].qty, 7);
});
test('Daily, weekly and monthly production plans are selected independently', async () => {
  const report = (await api(range)).body;
  assert.equal(report.production.plans, 5); assert.equal(report.production.done_plans, 3);
  assert.deepEqual(report.production.by_unit.find(row => row.unit === 'EA'), { unit: 'EA', planned_qty: 30, completed_qty: 10, actual_qty: 0, variance_qty: -30, achievement_rate: 0 });
  assert.equal(report.production.by_unit.find(row => row.unit === '단위 미지정 · 미지정 Z').completed_qty, 3);
  assert.equal((await api({ ...range, plan_period: 'week' })).body.production.by_unit[0].planned_qty, 500);
  assert.equal((await api({ ...range, plan_period: 'month' })).body.production.by_unit[0].planned_qty, 1000);
});
test('Monday-based weeks and year boundaries agree with monthly and daily totals', async () => {
  const weekly = (await api({ ...range, grain: 'week' })).body;
  assert.deepEqual(weekly.buckets, ['2026-10-26', '2026-11-02', '2026-11-09']);
  assert.equal(weekly.analysis.total, 4); assert.equal(weekly.analysis.series[0].total, 1);
  const year = (await api({ from: '2025-12-29', to: '2026-01-04', grain: 'week' })).body;
  assert.deepEqual(year.buckets, ['2025-12-29']); assert.equal(year.analysis.total, 2);
  const monthly = (await api({ from: '2026-11-01', to: '2026-12-05', grain: 'month' })).body;
  assert.deepEqual(monthly.buckets, ['2026-11-01', '2026-12-01']); assert.deepEqual(monthly.analysis.series.map(row => row.total), [4, 1]);
});
test('Classification and item filters consistently scope each dataset without guessing missing categories', async () => {
  const product = (await api({ ...range, item_category: '제품' })).body;
  assert.equal(product.analysis.total, 2); assert.equal(product.receipts.count, 2); assert.equal(product.production.plans, 2); assert.equal(product.shipments.count, 0);
  const unknown = (await api({ ...range, item_category: '미분류' })).body;
  assert.equal(unknown.analysis.total, 1); assert.equal(unknown.shipments.count, 1); assert.equal(unknown.production.plans, 2);
  const named = (await api({ ...range, q: 'A' })).body;
  assert.equal(named.analysis.total, 2); assert.equal(named.receipts.count, 2); assert.equal(named.shipments.count, 1);
  assert.equal((await api({ ...range, q: "' OR 1=1 --" })).body.receipts.count, 0);
  const empty = (await api({ from: '2027-01-01', to: '2027-01-03' })).body;
  assert.equal(empty.analysis.total, 0); assert.equal(empty.analysis.completion_rate, 0); assert.deepEqual(empty.units, []); assert.equal(empty.buckets.length, 3);
});
test('Repeated receipt confirmation preserves the original receipt date, operator and quantity', async () => {
  sqlite.prepare('UPDATE purchase_orders SET qty=999 WHERE id=?').run(confirmedId);
  const request = new Request('https://reports.test/api/po/receive', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ ids: [confirmedId], status: 'ok' }) });
  assert.equal((await worker.fetch(request, env)).status, 200);
  const row = sqlite.prepare('SELECT * FROM purchase_orders WHERE id=?').get(confirmedId);
  assert.equal(row.recv_at, '2026-11-04 10:00:00'); assert.equal(row.recv_by, '최초 처리자'); assert.equal(row.recv_qty, 20);
  assert.equal((await api(range)).body.receipts.by_unit.find(r => r.unit === '단위 미지정 · C').qty, 20);
});
