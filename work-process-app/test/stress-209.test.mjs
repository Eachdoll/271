// 15.209 가혹조건: 같은 요청 동시 전송·동시 클릭(경쟁)·위치 삭제 — 한 건만 저장되고 수량을 넘지 않으며 500이 나지 않아야 한다
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'st209-'));
const { env, sqlite } = localEnvironment(dir, 'st209-test');
let cookie = '';
const api = async (method, url, body) => { const r = await worker.fetch(new Request('https://st209.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env); if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0]; return { status: r.status, body: await r.json().catch(() => null) }; };
const rid = () => crypto.randomUUID();
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const count = (sql, ...a) => Object.values(sqlite.prepare(sql).get(...a))[0];
const five = fn => Promise.all(Array.from({ length: 5 }, fn));
let g, m;
before(async () => {
  await api('POST', '/api/auth/register', { name: '관리자', password: 'password', invite: 'st209-test' });
  await api('POST', '/api/vendors', { name: '가나상사', is_sales: true, is_purchase: true });
  g = (await api('POST', '/api/boms', { product: '장갑', product_code: 'G-1', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'EA', materials: [] })).body;
  m = (await api('POST', '/api/boms', { product: '원단', product_code: 'R-1', item_category: '원자재', kind: 'finished', base_qty: 1, unit: 'M', materials: [] })).body;
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('same request id sent 5 times at once saves one other receipt, shipment, plan and adjustment', async () => {
  for (const [url, body, table] of [
    ['/api/other-receipts', { bom_id: g.id, received_date: today, item: '장갑', item_category: '상품', qty: 200, vendor: '가나상사' }, 'other_receipts'],
    ['/api/shipments', { ship_date: today, bom_id: g.id, item: '장갑', qty: 1, customer: '가나상사', unit: 'EA' }, 'shipments'],
    ['/api/schedules', { kind: 'finished', period: 'day', start_date: today, qty: 20, bom_id: g.id }, 'schedules'],
    ['/api/inventory/adjustments', { item: '장갑', unit: 'EA', kind: 'opening', qty: 10, reason: '기초' }, 'stock_adjustments'],
  ]) {
    const before = count(`SELECT COUNT(*) FROM ${table}`), token = rid();
    const rs = await five(() => api('POST', url, { ...body, request_id: token }));
    assert.deepEqual(rs.map(r => r.status), [200, 200, 200, 200, 200], `${url} ${JSON.stringify(rs.map(r => r.body?.error))}`);
    assert.equal(count(`SELECT COUNT(*) FROM ${table}`) - before, 1, url);
    assert.equal((await api('POST', url, { ...body, request_id: token })).body.duplicate ?? true, true);
  }
  assert.equal((await api('POST', '/api/shipments', { ship_date: today, bom_id: g.id, item: '장갑', qty: 1, customer: '가나상사', request_id: 'bad id!' })).status, 400);
  { // 여러 줄 입력(화면 기본)도 같은 요청 번호 동시 5번 → 한 묶음
    const before = count('SELECT COUNT(*) FROM shipments'), token = rid();
    const rs = await five(() => api('POST', '/api/batches/shipment', { request_id: token, common: { ship_date: today, customer: '가나상사' }, items: [{ bom_id: g.id, item: '장갑', qty: 2 }, { bom_id: g.id, item: '장갑', qty: 3 }] }));
    assert.ok(rs.every(r => r.status < 500), JSON.stringify(rs.map(r => [r.status, r.body?.error])));
    assert.equal(count('SELECT COUNT(*) FROM shipments') - before, 2, JSON.stringify(rs.map(r => [r.status, r.body?.error])));
  }
  const plain = count('SELECT COUNT(*) FROM shipments'); // 요청 번호 없이 보내면 예전처럼 매번 저장
  await api('POST', '/api/shipments', { ship_date: today, bom_id: g.id, item: '장갑', qty: 1, customer: '가나상사' }); await api('POST', '/api/shipments', { ship_date: today, bom_id: g.id, item: '장갑', qty: 1, customer: '가나상사' });
  assert.equal(count('SELECT COUNT(*) FROM shipments') - plain, 2);
});

test('concurrent transfers, returns, same-code items and same-name warehouses do not overshoot or crash', async () => {
  await api('POST', '/api/warehouses', { name: '본동', locations: 'R1,R2' }); await api('POST', '/api/warehouses', { name: '별동', locations: 'A1' });
  await api('POST', '/api/receipts', { receipt_date: today, vendor: '가나상사', request_id: rid(), lines: [{ bom_id: m.id, qty: 10, lot: 'MV1', warehouse: '본동', location: 'R1' }] });
  const moves = await five(() => api('POST', '/api/stock-transfers', { item: '원단', unit: 'M', lot: 'MV1', from_place: '본동 R1', to_warehouse: '별동', qty: 4, request_id: rid() }));
  assert.ok(moves.every(r => r.status < 500), JSON.stringify(moves.map(r => r.status)));
  assert.ok(count("SELECT SUM(qty) FROM stock_transfers WHERE lot='MV1' AND status='confirmed'") <= 10, 'moved more than the LOT had');
  const so = (await api('POST', '/api/sales-orders', { customer: '가나상사', order_date: today, request_id: rid(), lines: [{ bom_id: g.id, qty: 30, unit_price: 1000 }] })).body;
  const bill = (await api('POST', '/api/sales-bills', { customer: '가나상사', bill_date: today, request_id: rid(), lines: [{ source_type: 'order', order_line_id: so.lines[0].id, qty: 30 }] })).body;
  const line = bill.lines?.[0]?.id ?? count('SELECT id FROM sales_bill_lines WHERE bill_id=?', bill.id);
  const rets = await five(() => api('POST', '/api/returns', { side: 'in', return_date: today, party: '가나상사', process: 'stock_amount', request_id: rid(), lines: [{ source_id: line, qty: 8 }] }));
  assert.ok(rets.every(r => r.status < 500), JSON.stringify(rets.map(r => r.status)));
  assert.ok(count("SELECT SUM(l.qty) FROM stock_return_lines l JOIN stock_returns r ON r.id=l.return_id WHERE r.status='confirmed' AND l.source_id=?", line) <= 30, 'returned more than was sold');
  const boms = await five(() => api('POST', '/api/boms', { product: '동시품', product_code: 'DUP-1', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'EA', materials: [] }));
  assert.equal(count("SELECT COUNT(*) FROM boms WHERE UPPER(product_code)='DUP-1'"), 1); assert.ok(boms.every(r => r.status === 200 || r.status === 409));
  const whs = await five(() => api('POST', '/api/warehouses', { name: '동시창고', locations: 'X' }));
  assert.equal(count("SELECT COUNT(*) FROM warehouses WHERE name='동시창고'"), 1); assert.ok(whs.every(r => r.status === 200 || r.status === 409), JSON.stringify(whs.map(r => r.status)));
});

test('a warehouse location with receipts cannot be removed from the list', async () => {
  const w = (await api('GET', '/api/warehouses')).body; const bon = (Array.isArray(w) ? w : w.rows).find(x => x.name === '본동');
  const r = await api('PUT', `/api/warehouses/${bon.id}`, { name: '본동', locations: 'R2' });
  assert.equal(r.status, 409); assert.match(r.body.error, /본동 R1/);
  assert.equal((await api('PUT', `/api/warehouses/${bon.id}`, { name: '본동', locations: 'R1,R3' })).status, 200, 'unused R2 can go');
});
