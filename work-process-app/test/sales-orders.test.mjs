// 15.92 수주: 거래처코드, 수주 입력, 수주 줄을 나눠 매출전표(100 → 80 + 20), 잔량, 출하지시 → 출하(재고 차감)·전표 줄 연결, 전표 취소 시 지시 취소, 마감·고치기 막기
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so92-'));
const { env, sqlite } = localEnvironment(dir, 'so92-test');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await worker.fetch(new Request('https://so92.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}
const admin = client(), seller = client(), staff = client();
const ids = {};
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const rid = () => crypto.randomUUID();
let glove, mask;
before(async () => {
  for (const [c, name] of [[admin, '관리자'], [seller, '영업'], [staff, '물류']]) await approvedRegistration(admin, c, { name, password: 'password', invite: 'so92-test' });
  for (const u of (await admin('GET', '/api/admin/users')).body) ids[u.name] = u.id;
  await admin('PUT', `/api/admin/users/${ids['영업']}`, { roles: ['sales'] });
  await admin('PUT', `/api/admin/users/${ids['물류']}`, { roles: ['logistics'] });
  const g = await admin('POST', '/api/boms', { product: '니트릴장갑', product_code: 'NG-1', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'BOX', materials: [] }); glove = g.body;
  mask = (await admin('POST', '/api/boms', { product: '마스크', product_code: 'MK-1', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'EA', materials: [] })).body;
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('Vendor codes: typed, automatic, unique, searchable', async () => {
  const a = await admin('POST', '/api/vendors', { name: '세흥상사', is_sales: true });
  assert.equal(a.status, 200); assert.equal(a.body.code, 'C0001');
  const b = await admin('POST', '/api/vendors', { name: '가나상사', code: 'ga-01', is_sales: true });
  assert.equal(b.body.code, 'GA-01');
  assert.equal((await admin('POST', '/api/vendors', { name: '다라상사', code: 'GA-01' })).status, 409);
  assert.equal((await admin('POST', '/api/vendors', { name: '다라상사', code: '한글' })).status, 400);
  assert.equal((await admin('PUT', `/api/vendors/${b.body.id}`, { name: '가나상사', code: 'C0001' })).status, 409);
  await staff('POST', '/api/shipments', { ship_date: today, item: '마스크', qty: 1, customer: '자동등록상사' }); // 다른 화면에서 쓰면 자동 등록 + 자동 코드
  const all = (await admin('GET', '/api/vendors')).body;
  const rows = Array.isArray(all) ? all : all.rows;
  assert.equal(rows.find(v => v.name === '자동등록상사').code, 'C0002');
  const found = (await admin('GET', '/api/vendors?q=GA-01')).body; assert.deepEqual((Array.isArray(found) ? found : found.rows).map(v => v.name), ['가나상사']);
});

test('Order 100 → bills of 80 and 20, remaining, ship instructions, shipping links lines, cancel', async () => {
  assert.equal((await staff('POST', '/api/sales-orders', { customer: '세흥상사', order_date: today, request_id: rid(), lines: [{ bom_id: glove.id, qty: 1 }] })).status, 403, 'sales only');
  assert.match((await seller('POST', '/api/sales-orders', { customer: '없는상사', order_date: today, request_id: rid(), lines: [{ bom_id: glove.id, qty: 1 }] })).body.error, /거래처 관리에 없습니다/);
  const token = rid();
  const so = await seller('POST', '/api/sales-orders', { customer: '세흥 상사', order_date: today, customer_po: 'PO-9', request_id: token, lines: [{ bom_id: glove.id, qty: 100, unit_price: 1500 }, { bom_id: mask.id, qty: 10 }] });
  assert.equal(so.status, 200, JSON.stringify(so.body));
  assert.match(so.body.order_no, /^SO-\d{6}-01$/); assert.equal(so.body.customer, '세흥상사'); assert.equal(so.body.customer_code, 'C0001');
  assert.equal(so.body.state, 'waiting'); assert.deepEqual(so.body.lines.map(l => [l.item, l.product_code, l.unit, l.qty, l.remaining]), [['니트릴장갑', 'NG-1', 'BOX', 100, 100], ['마스크', 'MK-1', 'EA', 10, 10]]);
  assert.equal((await seller('POST', '/api/sales-orders', { customer: '세흥상사', order_date: today, request_id: token, lines: [{ bom_id: glove.id, qty: 1 }] })).body.duplicate, true);
  const [gl, ml] = so.body.lines;
  const open = (await seller('GET', '/api/sales-orders/open-lines?customer=' + encodeURIComponent('세흥상사'))).body.rows;
  assert.deepEqual(open.map(r => [r.id, r.remaining, r.order_no]), [[gl.id, 100, so.body.order_no], [ml.id, 10, so.body.order_no]]);
  const bill = (lines, date = today) => seller('POST', '/api/sales-bills', { customer: '세흥상사', bill_date: date, request_id: rid(), lines });
  assert.equal((await bill([{ source_type: 'order', order_line_id: gl.id, qty: 101 }])).status, 409, 'over remaining');
  assert.match((await bill([{ source_type: 'order', order_line_id: ml.id, qty: 1 }])).body.error, /단가를 넣으세요/);
  assert.match((await seller('POST', '/api/sales-bills', { customer: '가나상사', bill_date: today, request_id: rid(), lines: [{ source_type: 'order', order_line_id: gl.id, qty: 1 }] })).body.error, /다른 거래처/);
  assert.match((await bill([{ source_type: 'order', order_line_id: gl.id, qty: 1 }, { source_type: 'order', order_line_id: gl.id, qty: 1 }])).body.error, /두 번/);
  const b1 = await bill([{ source_type: 'order', order_line_id: gl.id, qty: 80 }]);
  assert.equal(b1.status, 200, JSON.stringify(b1.body));
  assert.deepEqual(b1.body.lines.map(l => [l.source_type, l.order_line_id, l.qty, l.unit_price, l.supply, l.ship_status, l.order_no]), [['manual', gl.id, 80, 1500, 120000, 'pending', so.body.order_no]]);
  let detail = (await seller('GET', `/api/sales-orders/${so.body.id}`)).body;
  assert.equal(detail.state, 'partial'); assert.deepEqual(detail.lines.map(l => [l.billed_qty, l.pending_qty, l.shipped_qty, l.remaining]), [[80, 80, 0, 20], [0, 0, 0, 10]]);
  assert.equal(detail.bills.length, 1);
  assert.equal((await seller('PUT', `/api/sales-orders/${so.body.id}`, { customer: '세흥상사', order_date: today, lines: [{ bom_id: glove.id, qty: 5 }] })).status, 409, 'no edit after a bill');
  assert.equal((await seller('POST', `/api/sales-orders/${so.body.id}/status`, { status: 'cancelled' })).status, 400, 'no cancel after a bill');
  assert.equal((await bill([{ source_type: 'order', order_line_id: gl.id, qty: 21 }])).status, 409);
  // 물류: 출하지시 → 출하 처리
  const inst = (await staff('GET', '/api/ship-instructions')).body.rows;
  assert.deepEqual(inst.map(i => [i.item, i.qty, i.customer, i.bill_no, i.order_no, i.customer_po]), [['니트릴장갑', 80, '세흥상사', b1.body.bill_no, so.body.order_no, 'PO-9']]);
  assert.equal((await seller('POST', '/api/ship-instructions/ship', { ids: [inst[0].id] })).status, 403, 'logistics only');
  const shipped = await staff('POST', '/api/ship-instructions/ship', { ids: [inst[0].id], ship_date: today, lots: { [inst[0].id]: 'LOT-A' } });
  assert.equal(shipped.status, 200, JSON.stringify(shipped.body));
  assert.equal((await staff('POST', '/api/ship-instructions/ship', { ids: [inst[0].id] })).status, 409, 'already shipped');
  const sh = sqlite.prepare("SELECT * FROM shipments WHERE batch_id=?").get(`si:${inst[0].id}`);
  assert.deepEqual([sh.item, sh.qty, sh.customer, sh.lot, sh.product_code, sh.unit], ['니트릴장갑', 80, '세흥상사', 'LOT-A', 'NG-1', 'BOX']);
  const line = (await seller('GET', `/api/sales-bills/${b1.body.id}`)).body.lines[0];
  assert.deepEqual([line.source_type, line.source_id, line.lot, line.ship_date, line.ship_status], ['ship', sh.id, 'LOT-A', today, 'shipped']);
  assert.equal((await seller('GET', '/api/sales-bills/unbilled?customer=' + encodeURIComponent('세흥상사'))).body.rows.some(r => r.source_id === sh.id), false, 'billed shipment is not unbilled');
  assert.equal((await staff('DELETE', `/api/shipments/${sh.id}`)).status, 409, 'billed shipment locked');
  // 둘째 날 20개
  const b2 = await bill([{ source_type: 'order', order_line_id: gl.id, qty: 20, unit_price: 1400 }, { source_type: 'manual', item: '운반비', qty: 1, unit_price: 5000 }]);
  assert.equal(b2.status, 200, JSON.stringify(b2.body));
  detail = (await seller('GET', `/api/sales-orders/${so.body.id}`)).body;
  assert.deepEqual(detail.lines.map(l => [l.billed_qty, l.shipped_qty, l.pending_qty, l.remaining]), [[100, 80, 20, 0], [0, 0, 0, 10]]);
  assert.equal((await seller('GET', '/api/sales-orders/open-lines?customer=' + encodeURIComponent('세흥상사'))).body.rows.map(r => r.id).join(), String(ml.id));
  // 전표 취소: 대기 중 지시는 취소되고 잔량이 돌아온다
  assert.equal((await seller('POST', `/api/sales-bills/${b2.body.id}/cancel`, { reason: '수량 정정' })).status, 200);
  assert.equal(sqlite.prepare('SELECT status FROM ship_instructions WHERE bill_id=?').get(b2.body.id).status, 'cancelled');
  assert.equal((await staff('GET', '/api/ship-instructions')).body.rows.length, 0);
  detail = (await seller('GET', `/api/sales-orders/${so.body.id}`)).body;
  assert.equal(detail.lines[0].remaining, 20); assert.equal(detail.state, 'partial');
  // 목록과 진행 상태, 마감하면 남은 수량을 받지 않는다
  const list = (await seller('GET', '/api/sales-orders?state=open')).body.rows;
  assert.deepEqual(list.map(r => [r.order_no, r.state, r.ordered_qty, r.billed_qty]), [[so.body.order_no, 'partial', 110, 80]]);
  assert.equal((await seller('POST', `/api/sales-orders/${so.body.id}/status`, { status: 'closed', reason: '고객 취소' })).status, 200);
  assert.equal((await bill([{ source_type: 'order', order_line_id: gl.id, qty: 1 }])).status, 409);
  assert.equal((await seller('GET', `/api/sales-orders/${so.body.id}`)).body.lines[0].remaining, 0);
  assert.equal((await seller('POST', `/api/sales-orders/${so.body.id}/status`, { status: 'open' })).status, 200);
  assert.equal((await seller('GET', `/api/sales-orders/${so.body.id}`)).body.lines[0].remaining, 20);
});

test('Edit and cancel an order before any bill', async () => {
  const so = (await seller('POST', '/api/sales-orders', { customer: '가나상사', order_date: today, request_id: rid(), lines: [{ bom_id: mask.id, qty: 3, unit_price: 100 }] })).body;
  assert.equal(so.customer_code, 'GA-01');
  const edited = await seller('PUT', `/api/sales-orders/${so.id}`, { customer: '가나상사', order_date: today, note: '변경', lines: [{ bom_id: glove.id, qty: 7, unit_price: 10 }, { bom_id: mask.id, qty: 2 }] });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.deepEqual(edited.body.lines.map(l => [l.item, l.qty]), [['니트릴장갑', 7], ['마스크', 2]]); assert.equal(edited.body.amount, 70);
  assert.equal((await seller('POST', `/api/sales-orders/${so.id}/status`, { status: 'cancelled' })).status, 200);
  assert.equal((await seller('PUT', `/api/sales-orders/${so.id}`, { customer: '가나상사', order_date: today, lines: [{ bom_id: mask.id, qty: 1 }] })).status, 400);
  assert.deepEqual((await seller('GET', '/api/sales-orders?state=cancelled')).body.rows.map(r => r.id), [so.id]);
});
