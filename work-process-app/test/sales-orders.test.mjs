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
  // 15.131 일부 잡힌 수주 고치기: 잡은 줄은 지울 수 없음 · 수량은 잡은 수량 이상 · 품목 추가 · 거래처 변경 불가
  const put = lines => seller('PUT', `/api/sales-orders/${so.body.id}`, { customer: '세흥상사', order_date: today, customer_po: 'PO-9', lines });
  assert.match((await put([{ bom_id: glove.id, qty: 5 }])).body.error, /지울 수 없습니다/, 'used line cannot be dropped');
  assert.match((await put([{ id: gl.id, bom_id: glove.id, qty: 79, unit_price: 1500 }, { id: ml.id, bom_id: mask.id, qty: 10 }])).body.error, /80 이상/);
  assert.match((await put([{ id: gl.id, bom_id: mask.id, qty: 100 }, { id: ml.id, bom_id: mask.id, qty: 10 }])).body.error, /품목·규격을 바꿀 수 없습니다/);
  assert.match((await seller('PUT', `/api/sales-orders/${so.body.id}`, { customer: '가나상사', order_date: today, lines: [{ id: gl.id, bom_id: glove.id, qty: 100 }, { id: ml.id, bom_id: mask.id, qty: 10 }] })).body.error, /거래처를 바꿀 수 없습니다/);
  const ed = await put([{ id: gl.id, bom_id: glove.id, qty: 120, unit_price: 1500 }, { bom_id: mask.id, qty: 3, unit_price: 500 }]);
  assert.equal(ed.status, 200, JSON.stringify(ed.body));
  assert.deepEqual(ed.body.lines.map(l => [l.id === gl.id, l.item, l.qty, l.remaining, l.used ? 1 : 0]), [[true, '니트릴장갑', 120, 40, 1], [false, '마스크', 3, 3, 0]], 'qty raised, unused line removed, item added');
  assert.equal((await seller('GET', `/api/sales-bills/${b1.body.id}`)).body.lines[0].order_line_id, gl.id, 'bill still points at the kept line');
  const back = await put([{ id: gl.id, bom_id: glove.id, qty: 100, unit_price: 1500 }, { id: ed.body.lines[1].id, bom_id: mask.id, qty: 10 }]);
  assert.equal(back.status, 200, JSON.stringify(back.body)); const [, ml2] = back.body.lines; ml.id = ml2.id;
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

test('15.100 Cancelling a shipped bill keeps the order remaining; rebill links back; deleting the shipment undoes the instruction; BOM/vendor in use', async () => {
  const so = (await seller('POST', '/api/sales-orders', { customer: '가나상사', order_date: today, request_id: rid(), lines: [{ bom_id: mask.id, qty: 50, unit_price: 10 }] })).body;
  const ol = so.lines[0];
  const b = (await seller('POST', '/api/sales-bills', { customer: '가나상사', bill_date: today, request_id: rid(), lines: [{ source_type: 'order', order_line_id: ol.id, qty: 30 }] })).body;
  const inst = (await staff('GET', '/api/ship-instructions?customer=' + encodeURIComponent('가나상사'))).body.rows[0];
  assert.equal((await staff('POST', '/api/ship-instructions/ship', { ids: [inst.id], ship_date: today })).status, 200);
  const shipId = sqlite.prepare('SELECT shipment_id FROM ship_instructions WHERE id=?').get(inst.id).shipment_id;
  assert.equal((await seller('POST', `/api/sales-bills/${b.id}/cancel`, { reason: '단가 정정' })).status, 200);
  let d = (await seller('GET', `/api/sales-orders/${so.id}`)).body;
  assert.deepEqual([d.lines[0].billed_qty, d.lines[0].shipped_qty, d.lines[0].remaining], [0, 30, 20], 'shipped goods are not offered again');
  assert.equal((await seller('POST', '/api/sales-bills', { customer: '가나상사', bill_date: today, request_id: rid(), lines: [{ source_type: 'order', order_line_id: ol.id, qty: 21 }] })).status, 409);
  // 같은 출하를 「전표 없는 출하」로 다시 잡으면 수주 줄로 이어진다
  const re = (await seller('POST', '/api/sales-bills', { customer: '가나상사', bill_date: today, request_id: rid(), lines: [{ source_type: 'ship', source_id: shipId, unit_price: 9 }] })).body;
  assert.equal(re.lines[0].order_line_id, ol.id);
  d = (await seller('GET', `/api/sales-orders/${so.id}`)).body;
  assert.deepEqual([d.lines[0].billed_qty, d.lines[0].remaining], [30, 20]);
  // 그 전표도 취소하고 출하를 지우면 지시가 취소되고 잔량이 돌아온다
  assert.equal((await seller('POST', `/api/sales-bills/${re.id}/cancel`, { reason: '출하 취소' })).status, 200);
  assert.equal((await staff('DELETE', `/api/shipments/${shipId}`)).status, 200);
  assert.deepEqual({ ...sqlite.prepare('SELECT status, shipment_id FROM ship_instructions WHERE id=?').get(inst.id) }, { status: 'cancelled', shipment_id: null });
  assert.equal((await seller('GET', `/api/sales-orders/${so.id}`)).body.lines[0].remaining, 50);
  // 수주에 쓰인 품목은 완전 삭제 안 됨, 전표·수주에 쓰인 거래처도 삭제 안 됨
  const usage = (await admin('GET', `/api/boms/${mask.id}/usage`)).body;
  assert.ok(JSON.stringify(usage).includes('수주'), JSON.stringify(usage));
  assert.notEqual((await admin('DELETE', `/api/boms/${mask.id}?purge=1`)).status, 200);
  const vendor = sqlite.prepare("SELECT id FROM vendors WHERE name='가나상사'").get();
  const del = await admin('DELETE', `/api/vendors/${vendor.id}`);
  assert.equal(del.status, 409); assert.match(del.body.error, /수주 \d+건/);
});

test('15.101 Renaming a vendor follows through to orders, bills, instructions and closings', async () => {
  await admin('POST', '/api/vendors', { name: '라마상사', is_sales: true });
  const so = (await seller('POST', '/api/sales-orders', { customer: '라마상사', order_date: today, request_id: rid(), lines: [{ bom_id: mask.id, qty: 10, unit_price: 5 }] })).body;
  const b = (await seller('POST', '/api/sales-bills', { customer: '라마상사', bill_date: today, request_id: rid(), lines: [{ source_type: 'order', order_line_id: so.lines[0].id, qty: 4 }] })).body;
  const v = sqlite.prepare("SELECT id FROM vendors WHERE name='라마상사'").get();
  assert.equal((await admin('PUT', `/api/vendors/${v.id}`, { name: '라마산업', is_sales: true })).status, 200);
  assert.equal((await seller('GET', `/api/sales-orders/${so.id}`)).body.customer, '라마산업');
  assert.equal((await seller('GET', `/api/sales-bills/${b.id}`)).body.customer, '라마산업');
  assert.equal(sqlite.prepare('SELECT customer FROM ship_instructions WHERE bill_id=?').get(b.id).customer, '라마산업');
  const open = (await seller('GET', '/api/sales-orders/open-lines?customer=' + encodeURIComponent('라마산업'))).body.rows;
  assert.deepEqual(open.map(r => r.remaining), [6], 'open lines found under the new name');
  assert.equal((await seller('GET', '/api/sales-orders/open-lines?customer=' + encodeURIComponent('라마상사'))).body.rows.length, 0);
});

test('15.102 Shipped-from-order shipment is locked, order with shipped goods cannot be cancelled, tax type must match, list state filter in SQL', async () => {
  await admin('POST', '/api/vendors', { name: '바사상사', is_sales: true }); await admin('POST', '/api/vendors', { name: '아자상사', is_sales: true });
  const so = (await seller('POST', '/api/sales-orders', { customer: '바사상사', order_date: today, tax_type: 'zero', request_id: rid(), lines: [{ bom_id: mask.id, qty: 50, unit_price: 10 }] })).body;
  const ol = so.lines[0];
  const mixed = await seller('POST', '/api/sales-bills', { customer: '바사상사', bill_date: today, request_id: rid(), lines: [{ source_type: 'order', order_line_id: ol.id, qty: 50 }] });
  assert.equal(mixed.status, 409); assert.match(mixed.body.error, /영세·면세/);
  assert.equal((await seller('GET', '/api/sales-orders/open-lines?customer=' + encodeURIComponent('바사상사'))).body.rows[0].tax_type, 'zero');
  const b = (await seller('POST', '/api/sales-bills', { customer: '바사상사', bill_date: today, tax_type: 'zero', request_id: rid(), lines: [{ source_type: 'order', order_line_id: ol.id, qty: 50 }] })).body;
  assert.equal(b.vat_total, 0);
  const inst = (await staff('GET', '/api/ship-instructions?customer=' + encodeURIComponent('바사상사'))).body.rows[0];
  assert.equal((await staff('POST', '/api/ship-instructions/ship', { ids: [inst.id], ship_date: '2020-01-01' })).status, 400, 'ship date before bill month');
  assert.equal((await staff('POST', '/api/ship-instructions/ship', { ids: [inst.id], ship_date: today })).status, 200);
  const shipId = sqlite.prepare('SELECT shipment_id FROM ship_instructions WHERE id=?').get(inst.id).shipment_id;
  assert.equal((await seller('POST', `/api/sales-bills/${b.id}/cancel`, { reason: '정정' })).status, 200);
  // 출하지시로 나간 출하는 전표를 취소한 뒤에도 거래처·수량을 못 바꾼다(LOT·메모만)
  const edit = await staff('PUT', `/api/shipments/${shipId}`, { ship_date: today, item: '마스크', qty: 7, customer: '아자상사' });
  assert.equal(edit.status, 409); assert.match(edit.body.error, /LOT·메모만/);
  assert.equal((await staff('PUT', `/api/shipments/${shipId}`, { lot: 'L-9', note: '메모' })).status, 200);
  assert.equal(sqlite.prepare('SELECT lot FROM shipments WHERE id=?').get(shipId).lot, 'L-9');
  // 다른 거래처 전표로 그 출하를 잡을 수 없다(거래처가 수주와 달라서 서버가 막음 — 거래처 검사가 먼저)
  assert.notEqual((await seller('POST', '/api/sales-bills', { customer: '아자상사', bill_date: today, request_id: rid(), lines: [{ source_type: 'ship', source_id: shipId, unit_price: 1 }] })).status, 200);
  // 출하된 수주는 취소 불가, 취소한 수주는 다시 못 연다
  const cancel = await seller('POST', `/api/sales-orders/${so.id}/status`, { status: 'cancelled' });
  assert.equal(cancel.status, 400); assert.match(cancel.body.error, /출하된/);
  const so2 = (await seller('POST', '/api/sales-orders', { customer: '바사상사', order_date: today, request_id: rid(), lines: [{ bom_id: mask.id, qty: 1 }] })).body;
  assert.equal((await seller('POST', `/api/sales-orders/${so2.id}/status`, { status: 'cancelled' })).status, 200);
  assert.equal((await seller('POST', `/api/sales-orders/${so2.id}/status`, { status: 'open' })).status, 400);
  // 목록 상태 거름이 SQL에서: 취소만 고르면 취소된 것만, 진행 중에는 취소가 없다
  const cancelled = (await seller('GET', '/api/sales-orders?state=cancelled&customer=' + encodeURIComponent('바사상사'))).body.rows;
  assert.deepEqual(cancelled.map(r => r.id), [so2.id]);
  assert.ok((await seller('GET', '/api/sales-orders?state=open&customer=' + encodeURIComponent('바사상사'))).body.rows.every(r => ['waiting', 'partial'].includes(r.state)));
  assert.ok((await seller('GET', '/api/sales-orders?state=done&customer=' + encodeURIComponent('바사상사'))).body.rows.some(r => r.id === so.id), 'shipped-but-unbilled counts as taken');
});

test('15.111 Price table: lookup by date, history rows, same-day edit, roles, fills unbilled shipment price', async () => {
  await admin('POST', '/api/vendors', { name: '단가상사', is_sales: true });
  assert.equal((await staff('POST', '/api/item-prices', { side: 'sales', vendor: '단가상사', valid_from: today, items: [{ bom_id: glove.id, unit_price: 1 }] })).status, 403);
  const past = new Date(today + 'T00:00:00Z'); past.setUTCDate(past.getUTCDate() - 10); const d10 = past.toISOString().slice(0, 10);
  const fut = new Date(today + 'T00:00:00Z'); fut.setUTCDate(fut.getUTCDate() + 30); const d30 = fut.toISOString().slice(0, 10);
  assert.equal((await seller('POST', '/api/item-prices', { side: 'sales', vendor: '단가상사', valid_from: d10, items: [{ bom_id: glove.id, unit_price: 1000 }, { bom_id: mask.id, unit_price: 50 }] })).status, 200);
  assert.equal((await seller('POST', '/api/item-prices', { side: 'sales', vendor: '단가상사', valid_from: today, items: [{ bom_id: glove.id, unit_price: 1100 }] })).status, 200);
  assert.equal((await seller('POST', '/api/item-prices', { side: 'sales', vendor: '단가상사', valid_from: today, items: [{ bom_id: glove.id, unit_price: 1150, note: '정정' }] })).status, 200, 'same day replaces');
  await seller('POST', '/api/item-prices', { side: 'sales', vendor: '단가상사', valid_from: d30, items: [{ bom_id: glove.id, unit_price: 1300 }] });
  const look = (await seller('GET', `/api/item-prices/lookup?side=sales&vendor=${encodeURIComponent('단가 상사')}&date=${today}`)).body.prices;
  assert.deepEqual([look[glove.id].unit_price, look[mask.id].unit_price], [1150, 50]);
  assert.equal((await seller('GET', `/api/item-prices/lookup?side=sales&vendor=${encodeURIComponent('단가상사')}&date=${d10}`)).body.prices[glove.id].unit_price, 1000, 'price as of an earlier date');
  const list = (await seller('GET', `/api/item-prices?side=sales&vendor=${encodeURIComponent('단가상사')}`)).body;
  const g = list.rows.find(r => r.bom_id === glove.id);
  assert.deepEqual([g.unit_price, g.previous_price, g.versions], [1150, 1000, 3]);
  assert.equal(list.future.length, 1);
  const hist = (await seller('GET', `/api/item-prices/history?side=sales&vendor=${encodeURIComponent('단가상사')}&bom_id=${glove.id}`)).body.rows;
  assert.deepEqual(hist.map(r => r.unit_price), [1300, 1150, 1000]);
  assert.equal((await seller('GET', `/api/item-prices?side=purchase&vendor=${encodeURIComponent('단가상사')}`)).body.rows.length, 0, 'sides are separate');
  // 전표 없는 출하 줄: 단가표 단가가 함께 온다
  await staff('POST', '/api/shipments', { ship_date: today, bom_id: glove.id, item: '니트릴장갑', qty: 2, customer: '단가상사', unit: 'BOX' });
  const un = (await seller('GET', '/api/sales-bills/unbilled?customer=' + encodeURIComponent('단가상사'))).body.rows[0];
  assert.equal(un.table_price, 1150);
  // 단가 줄 빼기 → 이전 단가로
  const cur = hist.find(r => r.unit_price === 1150);
  assert.equal((await seller('POST', `/api/item-prices/${cur.id}/remove`)).status, 200);
  assert.equal((await seller('GET', `/api/item-prices/lookup?side=sales&vendor=${encodeURIComponent('단가상사')}&date=${today}`)).body.prices[glove.id].unit_price, 1000);
  // 단가표에 있는 품목은 완전 삭제 안 됨
  assert.ok(JSON.stringify((await admin('GET', `/api/boms/${mask.id}/usage`)).body).includes('단가표'));
});

test('15.132 Ship batches: bundle pending instructions, no double bundle, remove line, ship all, release', async () => {
  const so = (await seller('POST', '/api/sales-orders', { customer: '세흥상사', order_date: today, request_id: rid(), lines: [{ bom_id: glove.id, qty: 30, unit_price: 100 }, { bom_id: mask.id, qty: 30, unit_price: 50 }] })).body;
  const b = (await seller('POST', '/api/sales-bills', { customer: '세흥상사', bill_date: today, request_id: rid(), lines: so.lines.map(l => ({ source_type: 'order', order_line_id: l.id, qty: 10 })) })).body;
  const mine = (await staff('GET', '/api/ship-instructions?batch=none')).body.rows.filter(r => r.bill_no === b.bill_no);
  assert.equal(mine.length, 2);
  const ids = mine.map(r => r.id);
  assert.equal((await client()('POST', '/api/ship-batches', { ids })).status, 401);
  const token = rid();
  const bt = await seller('POST', '/api/ship-batches', { ids, plan_date: today, note: '1호차', request_id: token });
  assert.equal(bt.status, 200, JSON.stringify(bt.body)); assert.match(bt.body.batch_no, /^DO-\d{6}-01$/);
  assert.equal(bt.body.lines.length, 2); assert.equal(bt.body.state, 'open'); assert.equal(bt.body.customers, '세흥상사');
  assert.equal((await seller('POST', '/api/ship-batches', { ids, request_id: token })).body.duplicate, true);
  assert.match((await staff('POST', '/api/ship-batches', { ids: [ids[0]], request_id: rid() })).body.error, /이미 묶음 출하지시/);
  const listed = (await staff('GET', '/api/ship-instructions')).body.rows.find(r => r.id === ids[0]); assert.equal(listed.batch_no, bt.body.batch_no);
  assert.equal((await staff('GET', '/api/ship-instructions?batch=none')).body.rows.some(r => ids.includes(r.id)), false);
  const rm = (await staff('POST', `/api/ship-batches/${bt.body.id}/remove`, { ids: [ids[1]] })).body; assert.equal(rm.lines.length, 1);
  await staff('POST', '/api/ship-instructions/ship', { ids: [ids[0]], ship_date: today, lots: { [ids[0]]: 'L-9' } });
  const done = (await staff('GET', `/api/ship-batches/${bt.body.id}`)).body; assert.equal(done.state, 'done'); assert.equal(done.lines[0].shipped_lot, 'L-9');
  assert.match((await staff('POST', `/api/ship-batches/${bt.body.id}/remove`, { ids: [ids[0]] })).body.error, /출하된 줄/);
  const b2 = (await staff('POST', '/api/ship-batches', { ids: [ids[1]], request_id: rid() })).body; assert.match(b2.batch_no, /-02$/);
  const c = (await seller('POST', `/api/ship-batches/${b2.id}/cancel`, {})).body; assert.equal(c.status, 'cancelled');
  assert.equal((await staff('GET', '/api/ship-instructions?batch=none')).body.rows.some(r => r.id === ids[1]), true, 'released');
  assert.equal((await staff('POST', '/api/ship-batches', { ids: [ids[1]], request_id: rid() })).status, 200, 'can be bundled again');
  assert.deepEqual((await staff('GET', '/api/ship-batches?state=done')).body.rows.map(x => x.batch_no), [bt.body.batch_no]);
});

test('15.154 Ship batches: bundle part of an instruction splits the bill line and leaves the rest pending', async () => {
  await admin('POST', '/api/vendors', { name: '분할상사', is_sales: true });
  const so = (await seller('POST', '/api/sales-orders', { customer: '분할상사', order_date: today, request_id: rid(), lines: [{ bom_id: glove.id, qty: 10, unit_price: 333 }] })).body;
  const b = (await seller('POST', '/api/sales-bills', { customer: '분할상사', bill_date: today, request_id: rid(), lines: [{ source_type: 'order', order_line_id: so.lines[0].id, qty: 10 }] })).body;
  const before = (await seller('GET', `/api/sales-bills/${b.id}`)).body;
  assert.deepEqual([before.supply_total, before.vat_total], [3330, 333]);
  const ins = (await staff('GET', '/api/ship-instructions?batch=none')).body.rows.find(r => r.bill_no === b.bill_no);
  assert.match((await staff('POST', '/api/ship-batches', { ids: [ins.id], qtys: { [ins.id]: 11 }, request_id: rid() })).body.error, /지시 수량 10보다 많습니다/);
  assert.match((await staff('POST', '/api/ship-batches', { ids: [ins.id], qtys: { [ins.id]: 0 }, request_id: rid() })).body.error, /0보다 크게/);
  const token = rid();
  const bt = await staff('POST', '/api/ship-batches', { ids: [ins.id], qtys: { [ins.id]: 3 }, plan_date: today, request_id: token });
  assert.equal(bt.status, 200, JSON.stringify(bt.body)); assert.equal(bt.body.lines.length, 1); assert.equal(bt.body.lines[0].qty, 3);
  assert.equal((await staff('POST', '/api/ship-batches', { ids: [ins.id], qtys: { [ins.id]: 3 }, request_id: token })).body.duplicate, true, 'retry does not split twice');
  const after = (await seller('GET', `/api/sales-bills/${b.id}`)).body;
  assert.deepEqual(after.lines.map(l => [l.qty, l.supply, l.vat]), [[3, 999, 100], [7, 2331, 233]]);
  assert.deepEqual([after.supply_total, after.vat_total, after.total], [3330, 333, 3663], 'bill totals unchanged');
  assert.ok(after.changes.some(c => /줄 나눔/.test(c.summary)));
  const rest = (await staff('GET', '/api/ship-instructions?batch=none')).body.rows.filter(r => r.bill_no === b.bill_no);
  assert.deepEqual(rest.map(r => [r.qty, r.status]), [[7, 'pending']]);
  // 묶은 3 출하 → 전표 첫 줄만 출하에 연결, 나머지 7은 다른 지시서로 묶어 출하
  await staff('POST', '/api/ship-instructions/ship', { ids: [ins.id], ship_date: today, lots: { [ins.id]: 'L-A' } });
  const b2 = (await staff('POST', '/api/ship-batches', { ids: [rest[0].id], request_id: rid() })).body;
  await staff('POST', '/api/ship-instructions/ship', { ids: [rest[0].id], ship_date: today, lots: { [rest[0].id]: 'L-B' } });
  const fin = (await seller('GET', `/api/sales-bills/${b.id}`)).body;
  assert.deepEqual(fin.lines.map(l => [l.qty, l.source_type, l.lot]), [[3, 'ship', 'L-A'], [7, 'ship', 'L-B']]);
  assert.equal((await staff('GET', `/api/ship-batches/${b2.id}`)).body.state, 'done');
  const order = (await seller('GET', `/api/sales-orders/${so.id}`)).body;
  assert.equal(order.lines[0].shipped_qty ?? order.lines[0].shipped, 10, JSON.stringify(order.lines[0]));
});

test('15.157 Delivery status: shipments by customer with bill amounts (confirmed) and price estimates (open)', async () => {
  // 15.154에서 분할상사에 333원 × 3·7 출하(전표 확정). 전표 없는 출하 2개를 더하면 최근 매출 단가 333으로 미확정 666.
  await staff('POST', '/api/shipments', { ship_date: today, bom_id: glove.id, item: '니트릴장갑', qty: 2, customer: '분할상사', unit: 'BOX' });
  assert.equal((await staff('GET', `/api/sales-delivery-status?from=${today}&to=${today}`)).status, 403, 'sales only');
  const r = await seller('GET', `/api/sales-delivery-status?from=${today}&to=${today}&vendor=${encodeURIComponent('분할상사')}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const ls = r.body.lines;
  assert.deepEqual(ls.map(l => [l.qty, l.state, l.confirmed, l.estimate, l.vat]).sort((a, b) => a[0] - b[0]), [[2, 'open', 0, 666, 66], [3, 'billed', 999, 0, 100], [7, 'billed', 2331, 0, 233]]);
  assert.ok(ls.filter(l => l.state === 'billed').every(l => l.bill_no && l.req_no), 'bill and order numbers');
  const v = r.body.vendors.find(x => x.vendor === '분할상사'); assert.deepEqual([v.lines, v.confirmed, v.estimate, v.open], [3, 3330, 666, 1]);
  assert.deepEqual(r.body.freight, { total: 0, bills: 0 });
  // 입고현황(매입)도 같은 집계 함수로 그대로 동작
  assert.equal((await admin('GET', `/api/purchase-receipt-status?from=${today}&to=${today}`)).status, 200);
});

test('15.163 Quotes: create (USD, cents), list/search, edit with history, cancel, sales only', async () => {
  await admin('POST', '/api/vendors', { name: '앱솔릭스', is_sales: true });
  const body = { request_id: rid(), quote_date: '2026-05-05', customer: '앱솔릭스', attn: '-', currency: 'USD', manager: '강대호', manager_phone: '010-8208-4495', terms: '제작기간 : 발주후 12주\nFOB 조건 단가',
    lines: [{ bom_id: glove.id, product_code: 'C00097', item: 'SVAA61PE1 (SAVANA 226 PS PLUS 1.0UM)', unit: 'EA', qty: 250, unit_price: 249.4624 }] };
  assert.equal((await staff('POST', '/api/quotes', body)).status, 403);
  const q = await seller('POST', '/api/quotes', body);
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.match(q.body.quote_no, /^SST-2026-0505-\d+$/); assert.equal(q.body.supply_total, 62365.6); assert.equal(q.body.lines[0].supply, 62365.6);
  assert.equal(q.body.customer_code.length > 0, true, 'customer code from vendor');
  assert.equal((await seller('POST', '/api/quotes', body)).body.duplicate, true);
  assert.match((await seller('POST', '/api/quotes', { ...body, request_id: rid(), lines: [{ item: 'x', qty: 0, unit_price: 1 }] })).body.error, /수량/);
  const list = (await seller('GET', '/api/quotes?from=2026-05-01&to=2026-05-31&q=C00097')).body.rows;
  assert.deepEqual(list.map(r => [r.quote_no, r.line_count]), [[q.body.quote_no, 1]]);
  const u = await seller('PUT', `/api/quotes/${q.body.id}`, { ...body, currency: 'KRW', lines: [{ item: '장갑', qty: 3, unit_price: 333.7 }, { item: '마스크', qty: 1, unit_price: 1000 }] });
  assert.equal(u.status, 200, JSON.stringify(u.body)); assert.equal(u.body.supply_total, 2001, 'KRW truncates per line'); assert.ok(u.body.changes[0].summary.includes('통화'));
  const c = (await seller('POST', `/api/quotes/${q.body.id}/cancel`, {})).body; assert.equal(c.status, 'cancelled');
  assert.match((await seller('PUT', `/api/quotes/${q.body.id}`, body)).body.error, /취소된/);
  assert.equal((await seller('GET', '/api/quotes?from=2026-05-01&to=2026-05-31')).body.rows.length, 0, 'cancelled hidden by default');
});
