// 15.80 매입전표·매입 마감: 미전표 입고 줄(LOT·예전·기타), 금액(절사·부가세·운송비), 중복 방지, 권한, 취소, 마감, 입고 수정 막기
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb80-'));
const { env, sqlite } = localEnvironment(dir, 'pb80-test');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await worker.fetch(new Request('https://pb80.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}
const admin = client(), buyer = client(), staff = client();
const ids = {};
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const lastMonth = (() => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
const rid = () => crypto.randomUUID();
let mask;
before(async () => {
  for (const [c, name] of [[admin, '관리자'], [buyer, '구매'], [staff, '물류']]) await approvedRegistration(admin, c, { name, password: 'password', invite: 'pb80-test' });
  for (const u of (await admin('GET', '/api/admin/users')).body) ids[u.name] = u.id;
  await admin('PUT', `/api/admin/users/${ids['구매']}`, { roles: ['purchase'] });
  await admin('PUT', `/api/admin/users/${ids['물류']}`, { roles: ['logistics'] });
  mask = (await admin('POST', '/api/boms', { product: '마스크', product_code: 'MK-1', item_category: '부자재', kind: 'finished', base_qty: 1, unit: 'EA', materials: [] })).body;
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const po = async (vendor, item, qty, unit_price) => (await buyer('POST', '/api/po', { req_no: 'PR-B', vendor, item, qty, due_date: today, item_category: '부자재', unit_price })).body;

test('Unbilled receipt lines, amounts, duplicate guard, cancel and edit locks', async () => {
  const a = await po('원단상사', '원단A', 100, 1234.5);
  const b = await po('원단상사', '원단B', 10, null);
  await staff('POST', '/api/receipts', { receipt_date: today, vendor: '원단상사', request_id: rid(), lines: [{ po_id: a.id, lot: 'L1', qty: 60 }, { po_id: a.id, lot: 'L2', qty: 40 }] });
  await staff('POST', '/api/po/receive', { ids: [b.id], status: 'ok' }); // 예전 방식 입고
  await staff('POST', '/api/receipts', { receipt_date: today, vendor: '원단상사', request_id: rid(), lines: [{ bom_id: mask.id, lot: 'M1', qty: 7 }] }); // 기타입고
  await staff('POST', '/api/receipts', { receipt_date: today, vendor: '다른상사', request_id: rid(), lines: [{ bom_id: mask.id, qty: 1 }] });
  assert.equal((await staff('GET', '/api/purchase-bills/unbilled?vendor=' + encodeURIComponent('원단상사'))).status, 403, 'purchase only');
  const open = (await buyer('GET', '/api/purchase-bills/unbilled?vendor=' + encodeURIComponent(' 원단상사'))).body.rows;
  assert.deepEqual(open.map(r => [r.source_type, r.item, r.lot, r.qty, r.unit_price]).sort(), [['other', '마스크', 'M1', 7, null], ['po', '원단B', '', 10, null], ['po_lot', '원단A', 'L1', 60, 1234.5], ['po_lot', '원단A', 'L2', 40, 1234.5]].sort());
  const line = (t, item, lot) => open.find(r => r.source_type === t && r.item === item && r.lot === lot);
  const base = { vendor: '원단상사', bill_date: today, statement_no: 'S-77', freight: 7000.9, request_id: rid() };
  const noPrice = await buyer('POST', '/api/purchase-bills', { ...base, lines: [{ source_type: 'po', source_id: line('po', '원단B', '').source_id }] });
  assert.equal(noPrice.status, 400); assert.match(noPrice.body.error, /단가를 넣으세요/);
  const wrongVendor = (await buyer('GET', '/api/purchase-bills/unbilled?vendor=' + encodeURIComponent('다른상사'))).body.rows[0];
  assert.match((await buyer('POST', '/api/purchase-bills', { ...base, lines: [{ source_type: 'other', source_id: wrongVendor.source_id, unit_price: 1 }] })).body.error, /다른 거래처/);
  const bill = await buyer('POST', '/api/purchase-bills', { ...base, statement_total: 999999, lines: [
    { source_type: 'po_lot', source_id: line('po_lot', '원단A', 'L1').source_id },
    { source_type: 'po', source_id: line('po', '원단B', '').source_id, unit_price: 333.3 },
    { source_type: 'other', source_id: line('other', '마스크', 'M1').source_id, unit_price: 500 }] });
  assert.equal(bill.status, 200, JSON.stringify(bill.body));
  // 60 × 1234.5 = 74070, 10 × 333.3 = 3333, 7 × 500 = 3500, 운송비 7000 → 공급 87903, 부가세 8790, 합계 96693
  assert.match(bill.body.bill_no, /^PB-\d{6}-01$/);
  assert.deepEqual([bill.body.supply_total, bill.body.vat_total, bill.body.total, bill.body.freight, bill.body.statement_total], [87903, 8790, 96693, 7000, 999999]);
  assert.deepEqual(bill.body.lines.map(l => [l.item, l.qty, l.unit_price, l.supply]), [['원단A', 60, 1234.5, 74070], ['원단B', 10, 333.3, 3333], ['마스크', 7, 500, 3500]]);
  const again = await buyer('POST', '/api/purchase-bills', { ...base, request_id: rid(), lines: [{ source_type: 'po_lot', source_id: line('po_lot', '원단A', 'L1').source_id }] });
  assert.equal(again.status, 409, 'a receipt line goes into one bill only');
  assert.equal((await buyer('POST', '/api/purchase-bills', { ...base, lines: [] })).body.duplicate, true, 'same request id returns the saved bill');
  assert.deepEqual((await buyer('GET', '/api/purchase-bills/unbilled?vendor=' + encodeURIComponent('원단상사'))).body.rows.map(r => r.lot), ['L2']);
  // 영세·면세
  const zero = await buyer('POST', '/api/purchase-bills', { vendor: '원단상사', bill_date: today, tax_type: 'zero', request_id: rid(), lines: [{ source_type: 'po_lot', source_id: line('po_lot', '원단A', 'L2').source_id }] });
  assert.deepEqual([zero.body.supply_total, zero.body.vat_total, zero.body.total], [49380, 0, 49380]);
  // 전표에 들어간 입고는 수정·취소 요청·삭제가 막힘
  assert.equal((await staff('POST', `/api/po/${a.id}/receipt-changes`, { action: 'qty', recv_qty: 90, reason: 'x', request_id: rid() })).status, 409);
  const otherId = line('other', '마스크', 'M1').source_id;
  assert.equal((await staff('DELETE', `/api/other-receipts/${otherId}`)).status, 409);
  assert.equal((await buyer('DELETE', `/api/po/${b.id}`)).status, 409);
  // 목록·상세·취소
  const list = (await buyer('GET', '/api/purchase-bills?vendor=' + encodeURIComponent('원단상사'))).body.rows;
  assert.equal(list.length, 2); assert.equal(list.find(r => r.id === bill.body.id).line_count, 3);
  assert.equal((await buyer('POST', `/api/purchase-bills/${bill.body.id}/cancel`, {})).status, 400, 'reason required');
  const cancelled = await buyer('POST', `/api/purchase-bills/${bill.body.id}/cancel`, { reason: '단가 오류' });
  assert.equal(cancelled.body.status, 'cancelled');
  assert.equal((await buyer('GET', '/api/purchase-bills/unbilled?vendor=' + encodeURIComponent('원단상사'))).body.rows.length, 3, 'cancelled lines come back');
  assert.equal((await staff('DELETE', `/api/other-receipts/${otherId}`)).status, 200, 'unlocked after cancel');
});

test('Old receipt moved into a LOT line is not billed twice', async () => {
  const p = await po('이전상사', '원단C', 50, 100);
  await staff('POST', '/api/po/receive', { ids: [p.id], status: 'mismatch', recv_qty: 30 });
  const first = (await buyer('GET', '/api/purchase-bills/unbilled?vendor=' + encodeURIComponent('이전상사'))).body.rows;
  await buyer('POST', '/api/purchase-bills', { vendor: '이전상사', bill_date: today, request_id: rid(), lines: [{ source_type: 'po', source_id: first[0].source_id }] });
  await staff('POST', '/api/receipts', { receipt_date: today, vendor: '이전상사', request_id: rid(), lines: [{ po_id: p.id, lot: 'N2', qty: 20 }] });
  const rest = (await buyer('GET', '/api/purchase-bills/unbilled?vendor=' + encodeURIComponent('이전상사'))).body.rows;
  assert.deepEqual(rest.map(r => [r.lot, r.qty]), [['N2', 20]], 'the earlier 30 already billed is not offered again');
});

test('Month closing: totals, unbilled count, locks and admin reopen', async () => {
  const p = await po('마감상사', '원단D', 10, 1000);
  const old = new Date(today + 'T00:00:00Z'); old.setUTCDate(1); old.setUTCDate(0); const lastDay = old.toISOString().slice(0, 10);
  await staff('POST', '/api/receipts', { receipt_date: lastDay, vendor: '마감상사', request_id: rid(), lines: [{ po_id: p.id, lot: 'K1', qty: 6 }, { po_id: p.id, lot: 'K2', qty: 4 }] });
  const rows = (await buyer('GET', '/api/purchase-bills/unbilled?vendor=' + encodeURIComponent('마감상사'))).body.rows;
  const bill = (await buyer('POST', '/api/purchase-bills', { vendor: '마감상사', bill_date: lastDay, request_id: rid(), lines: [{ source_type: 'po_lot', source_id: rows[0].source_id }] })).body;
  const view = (await buyer('GET', `/api/purchase-closing?period=${lastMonth}`)).body;
  const row = view.rows.find(r => r.vendor === '마감상사');
  assert.deepEqual([row.bill_count, row.supply_total, row.vat_total, row.total, row.unbilled_lines, row.closing], [1, 6000, 600, 6600, 1, null]);
  assert.equal((await buyer('POST', '/api/purchase-closing', { period: today.slice(0, 7), vendor: '마감상사' })).status, 400, 'the current month cannot be closed yet');
  const closed = await buyer('POST', '/api/purchase-closing', { period: lastMonth, vendor: '마감상사' });
  assert.equal(closed.status, 200); assert.equal(closed.body.total, 6600);
  assert.equal((await buyer('POST', '/api/purchase-closing', { period: lastMonth, vendor: '마감상사' })).status, 409);
  assert.match((await buyer('POST', `/api/purchase-bills/${bill.id}/cancel`, { reason: 'x' })).body.error, /마감/);
  assert.match((await buyer('POST', '/api/purchase-bills', { vendor: '마감상사', bill_date: lastDay, request_id: rid(), lines: [{ source_type: 'po_lot', source_id: rows[1].source_id }] })).body.error, /마감/);
  assert.equal((await buyer('POST', '/api/purchase-closing/reopen', { period: lastMonth, vendor: '마감상사' })).status, 403, 'admin only');
  assert.equal((await admin('POST', '/api/purchase-closing/reopen', { period: lastMonth, vendor: '마감상사' })).status, 200);
  assert.equal((await buyer('POST', `/api/purchase-bills/${bill.id}/cancel`, { reason: '재확인' })).status, 200);
  assert.equal(sqlite.prepare("SELECT COUNT(*) c FROM purchase_closings WHERE vendor='마감상사'").get().c, 1, 'closing history is kept');
  const summary = (await buyer('GET', '/api/purchase-bills/unbilled-summary')).body.find(r => r.vendor === '마감상사');
  assert.equal(summary.lines, 2);
});

test('15.82 A receipt line can be billed in parts; the statement quantity may differ from the receipt', async () => {
  const p = await po('나눔상사', '원단Z', 100, 1000);
  await staff('POST', '/api/receipts', { receipt_date: today, vendor: '나눔상사', request_id: rid(), lines: [{ po_id: p.id, lot: 'Z1', qty: 60 }] });
  const open = async () => (await buyer('GET', '/api/purchase-bills/unbilled?vendor=' + encodeURIComponent('나눔상사'))).body.rows;
  const [line] = await open();
  assert.deepEqual([line.qty, line.billed_qty, line.po_qty, line.po_recv_qty, line.unit_price], [60, 0, 100, 60, 1000]);
  const first = await buyer('POST', '/api/purchase-bills', { vendor: '나눔상사', bill_date: today, request_id: rid(), lines: [{ source_type: 'po_lot', source_id: line.source_id, qty: 25 }] });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual([first.body.lines[0].qty, first.body.lines[0].source_qty, first.body.supply_total], [25, 60, 25000]);
  const [rest] = await open();
  assert.deepEqual([rest.qty, rest.billed_qty, rest.last_price], [60, 25, 1000], 'remaining 35 stays open, last price known');
  assert.equal((await buyer('POST', '/api/purchase-bills', { vendor: '나눔상사', bill_date: today, request_id: rid(), lines: [{ source_type: 'po_lot', source_id: line.source_id, qty: 0 }] })).status, 400);
  // 남은 수량을 비우면 남은 35, 다 잡으면 목록에서 빠짐
  const second = await buyer('POST', '/api/purchase-bills', { vendor: '나눔상사', bill_date: today, request_id: rid(), lines: [{ source_type: 'po_lot', source_id: line.source_id, unit_price: 990 }] });
  assert.equal(second.body.lines[0].qty, 35);
  assert.equal((await open()).length, 0);
  assert.equal((await buyer('POST', '/api/purchase-bills', { vendor: '나눔상사', bill_date: today, request_id: rid(), lines: [{ source_type: 'po_lot', source_id: line.source_id, qty: 1 }] })).status, 409);
  // 한 전표를 취소하면 그만큼 다시 열림
  await buyer('POST', `/api/purchase-bills/${first.body.id}/cancel`, { reason: '수량 정정' });
  const [again] = await open(); assert.equal(again.qty - again.billed_qty, 25);
});

test('15.84 review fixes: legacy PO billed in part then lot receipt, no over-billing, pending receipt change, approval guard', async () => {
  // 예전 방식으로 5 받고 3만 전표 → 나중에 LOT 입고 5 → 「이전 입고」 LOT에 남은 2가 열려 있어야 함
  const p = await po('레거시', '원단L', 10, 100);
  assert.equal((await staff('POST', '/api/po/receive', { ids: [p.id], status: 'mismatch', recv_qty: 5 })).status, 200);
  const open = async v => (await buyer('GET', '/api/purchase-bills/unbilled?vendor=' + encodeURIComponent(v))).body.rows;
  const [legacy] = await open('레거시');
  assert.equal((await buyer('POST', '/api/purchase-bills', { vendor: '레거시', bill_date: today, request_id: rid(), lines: [{ source_type: 'po', source_id: legacy.source_id, qty: 3 }] })).status, 200);
  assert.equal((await staff('POST', '/api/receipts', { receipt_date: today, vendor: '레거시', request_id: rid(), lines: [{ po_id: p.id, lot: 'N1', qty: 5 }] })).status, 200);
  const rows = await open('레거시');
  const prev = rows.find(r => r.lot_note === '이전 입고'), n1 = rows.find(r => r.lot === 'N1');
  assert.ok(prev, JSON.stringify(rows)); assert.deepEqual([prev.qty, prev.billed_qty, n1.qty, n1.billed_qty], [5, 3, 5, 0]);
  assert.equal((await buyer('POST', '/api/purchase-bills', { vendor: '레거시', bill_date: today, request_id: rid(), lines: [{ source_type: 'po_lot', source_id: prev.source_id, qty: 3 }] })).status, 400, 'only 2 left');
  assert.equal((await buyer('POST', '/api/purchase-bills', { vendor: '레거시', bill_date: today, request_id: rid(), lines: [{ source_type: 'po_lot', source_id: prev.source_id }] })).body.lines[0].qty, 2);
  assert.equal((await open('레거시')).length, 1, 'only N1 left');
  // 남은 수량보다 많이는 안 됨
  assert.equal((await buyer('POST', '/api/purchase-bills', { vendor: '레거시', bill_date: today, request_id: rid(), lines: [{ source_type: 'po_lot', source_id: n1.source_id, qty: 1000000 }] })).status, 400);
  // 입고 수정 요청이 처리 중이면 전표 못 잡음, 승인 전에 전표가 잡혔으면 승인 409
  const q = await po('승인상사', '원단Q', 10, 100);
  await staff('POST', '/api/receipts', { receipt_date: today, vendor: '승인상사', request_id: rid(), lines: [{ po_id: q.id, lot: 'Q1', qty: 10 }] });
  const change = await staff('POST', `/api/po/${q.id}/receipt-changes`, { action: 'qty', recv_qty: 8, reason: '수량 오류', request_id: rid() });
  assert.equal(change.status, 200, JSON.stringify(change.body));
  const [qline] = await open('승인상사');
  assert.equal((await buyer('POST', '/api/purchase-bills', { vendor: '승인상사', bill_date: today, request_id: rid(), lines: [{ source_type: 'po_lot', source_id: qline.source_id }] })).status, 409);
  sqlite.prepare("INSERT INTO purchase_bill_lines(bill_id,source_type,source_id,po_id,item,qty,unit_price,supply) VALUES(0,'po_lot',?,?,'원단Q',1,100,100)").run(qline.source_id, q.id); // 경합 흉내
  const changeId = sqlite.prepare("SELECT id FROM receipt_qty_changes WHERE po_id=? AND status='pending'").get(q.id).id;
  const appr = await admin('POST', `/api/receipt-changes/${changeId}/approve`, {});
  assert.equal(appr.status, 409, JSON.stringify(appr.body) + JSON.stringify(change.body));
  assert.equal(sqlite.prepare('SELECT recv_qty FROM purchase_orders WHERE id=?').get(q.id).recv_qty, 10, 'nothing applied');
});

test('15.87 receipt status by category with confirmed/estimated amounts; 임가공 category rules', async () => {
  const d = today;
  // 임가공 품목: 등록 가능, 세부 분류·기타입고 불가, 발주로는 받음
  const svc = await admin('POST', '/api/boms', { product: '세탁 임가공', product_code: 'SV-1', item_category: '임가공', kind: 'finished', base_qty: 1, unit: '식', materials: [] });
  assert.equal(svc.status, 200, JSON.stringify(svc.body));
  assert.equal((await admin('POST', '/api/item-categories', { item_class: '임가공', name: '세탁' })).status, 400);
  assert.equal((await staff('POST', '/api/receipts', { receipt_date: d, vendor: '현황상사', request_id: rid(), lines: [{ bom_id: svc.body.id, lot: 'X', qty: 1 }] })).status, 400);
  const raw = await po('현황상사', '원단R', 10, 1000);
  const sv = (await buyer('POST', '/api/po', { req_no: 'PR-S', vendor: '현황상사', item: '세탁 임가공', bom_id: svc.body.id, qty: 1, due_date: d, item_category: '임가공', unit_price: 50000 })).body;
  assert.equal(sv.item_category, '임가공');
  await staff('POST', '/api/receipts', { receipt_date: d, vendor: '현황상사', request_id: rid(), lines: [{ po_id: raw.id, lot: 'R1', qty: 10 }, { po_id: sv.id, lot: '', qty: 1 }] });
  // 원단 4개만 전표(단가 990), 나머지 6개는 발주 단가로 미확정
  const [rline] = (await buyer('GET', '/api/purchase-bills/unbilled?vendor=' + encodeURIComponent('현황상사'))).body.rows.filter(r => r.item === '원단R');
  await buyer('POST', '/api/purchase-bills', { vendor: '현황상사', bill_date: d, request_id: rid(), freight: 3000, lines: [{ source_type: 'po_lot', source_id: rline.source_id, qty: 4, unit_price: 990 }] });
  assert.equal((await staff('GET', `/api/purchase-receipt-status?from=${d}&to=${d}`)).status, 403);
  const r = (await buyer('GET', `/api/purchase-receipt-status?from=${d}&to=${d}&vendor=${encodeURIComponent('현황상사')}`)).body;
  const cat = c => r.categories.find(x => x.category === c);
  assert.deepEqual([cat('부자재').confirmed, cat('부자재').estimate, cat('부자재').total], [3960, 6000, 9960]);
  assert.deepEqual([cat('임가공').confirmed, cat('임가공').estimate, cat('임가공').lines], [0, 50000, 1]);
  assert.ok(cat('원자재') && cat('제품') && cat('상품'), 'five main categories always listed');
  assert.equal(r.vendors.length, 1); assert.equal(r.vendors[0].categories['임가공'], 50000); assert.equal(r.vendors[0].total, 59960);
  assert.deepEqual([r.freight.total, r.freight.bills], [3000, 1]);
  const line = r.lines.find(l => l.item === '원단R');
  assert.deepEqual([line.state, line.remaining, line.confirmed, line.estimate], ['partial', 6, 3960, 6000]);
});

test('15.90 a reduced receipt (negative correction lot) caps billing at the received qty and nets in the report; a typed 「이전 입고」 note is not treated as migrated', async () => {
  const d = today;
  const q = await po('수정상사', '원단Q2', 10, 100);
  await staff('POST', '/api/receipts', { receipt_date: d, vendor: '수정상사', request_id: rid(), lines: [{ po_id: q.id, lot: 'Q1', qty: 10 }] });
  await staff('POST', `/api/po/${q.id}/receipt-changes`, { action: 'qty', recv_qty: 8, reason: '수량 정정', request_id: rid() });
  const changeId = sqlite.prepare("SELECT id FROM receipt_qty_changes WHERE po_id=? AND status='pending'").get(q.id).id;
  assert.equal((await admin('POST', `/api/receipt-changes/${changeId}/approve`, {})).status, 200);
  const rows = (await buyer('GET', '/api/purchase-bills/unbilled?vendor=' + encodeURIComponent('수정상사'))).body.rows;
  assert.equal(rows.length, 1, 'the -2 correction lot is not a billable line');
  assert.equal(rows[0].po_open, 8);
  assert.equal((await buyer('POST', '/api/purchase-bills', { vendor: '수정상사', bill_date: d, request_id: rid(), lines: [{ source_type: 'po_lot', source_id: rows[0].source_id, qty: 9 }] })).status, 400, 'cannot bill more than received (8)');
  const r0 = (await buyer('GET', `/api/purchase-receipt-status?from=${d}&to=${d}&vendor=${encodeURIComponent('수정상사')}`)).body;
  assert.equal(r0.categories.find(c => c.category === '부자재').estimate, 800, 'report nets the correction');
  assert.ok(r0.lines.some(l => l.state === 'adjust' && l.estimate === -200));
  const bill = await buyer('POST', '/api/purchase-bills', { vendor: '수정상사', bill_date: d, request_id: rid(), lines: [{ source_type: 'po_lot', source_id: rows[0].source_id }] });
  assert.equal(bill.body.lines[0].qty, 8, 'default qty = received after correction');
  assert.equal((await buyer('GET', '/api/purchase-bills/unbilled?vendor=' + encodeURIComponent('수정상사'))).body.rows.length, 0);
  const r1 = (await buyer('GET', `/api/purchase-receipt-status?from=${d}&to=${d}&vendor=${encodeURIComponent('수정상사')}`)).body.categories.find(c => c.category === '부자재');
  assert.deepEqual([r1.confirmed, r1.estimate], [800, 0]);
  // 사용자가 비고에 「이전 입고」라고 적어도 예전 전표와 합쳐 세지 않음
  const lg = await po('비고상사', '원단L2', 10, 100);
  await staff('POST', '/api/po/receive', { ids: [lg.id], status: 'mismatch', recv_qty: 5 });
  const [legacy] = (await buyer('GET', '/api/purchase-bills/unbilled?vendor=' + encodeURIComponent('비고상사'))).body.rows;
  await buyer('POST', '/api/purchase-bills', { vendor: '비고상사', bill_date: d, request_id: rid(), lines: [{ source_type: 'po', source_id: legacy.source_id, qty: 3 }] });
  await staff('POST', '/api/receipts', { receipt_date: d, vendor: '비고상사', request_id: rid(), lines: [{ po_id: lg.id, lot: 'N1', qty: 5, note: '이전 입고' }] });
  const open2 = (await buyer('GET', '/api/purchase-bills/unbilled?vendor=' + encodeURIComponent('비고상사'))).body.rows;
  const n1 = open2.find(r => r.lot === 'N1');
  assert.deepEqual([n1.billed_qty, n1.is_prev], [0, 0], 'typed note does not pick up the legacy bill');
  const rep = (await buyer('GET', `/api/purchase-receipt-status?from=${d}&to=${d}&vendor=${encodeURIComponent('비고상사')}`)).body.categories.find(c => c.category === '부자재');
  assert.equal(rep.confirmed, 300, 'legacy bill counted once');
  assert.equal((await admin('GET', `/api/reports?from=${d}&to=${d}&item_category=${encodeURIComponent('임가공')}`)).status, 200);
});

test('15.109 Payment check moved to 구매: purchasing staff can enter and cancel customer payments; logistics cannot', async () => {
  const pay = { customer: '입금상사', pay_date: today, amount: 50000, kind: 'payment', request_id: rid() };
  assert.equal((await staff('POST', '/api/sales-payments', pay)).status, 403);
  const p = await buyer('POST', '/api/sales-payments', pay);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal((await buyer('GET', '/api/sales-payments?customer=' + encodeURIComponent('입금상사'))).body.rows.length, 1);
  assert.equal((await buyer('POST', `/api/sales-payments/${p.body.id}/cancel`, { reason: '중복' })).status, 200);
});

test('15.110 Payments to suppliers: ledger balance = opening + bills − payments; closing keeps the paid total; roles', async () => {
  const v = '지급상사';
  assert.equal((await staff('POST', '/api/purchase-payments', { vendor: v, pay_date: today, amount: 1, request_id: rid() })).status, 403, 'purchase role only');
  const opening = await buyer('POST', '/api/purchase-payments', { vendor: v, pay_date: lastMonth + '-01', kind: 'opening', amount: 100000, request_id: rid() });
  assert.equal(opening.status, 200, JSON.stringify(opening.body));
  const p = await po(v, '지급원단', 10, 1000);
  await staff('POST', '/api/receipts', { receipt_date: today, vendor: v, request_id: rid(), lines: [{ po_id: p.id, qty: 10 }] });
  const line = (await buyer('GET', '/api/purchase-bills/unbilled?vendor=' + encodeURIComponent(v))).body.rows[0];
  const bill = (await buyer('POST', '/api/purchase-bills', { vendor: v, bill_date: today, request_id: rid(), lines: [{ source_type: line.source_type, source_id: line.source_id }] })).body;
  assert.equal(bill.total, 11000);
  const pay = (await buyer('POST', '/api/purchase-payments', { vendor: v, pay_date: today, amount: 30000, method: '기업은행', request_id: rid() })).body;
  const from = lastMonth + '-01';
  const led = (await buyer('GET', `/api/purchase-ledger?vendor=${encodeURIComponent(v)}&from=${today.slice(0, 7)}-01&to=${today}`)).body;
  assert.equal(led.opening, 100000, 'opening payable before the period');
  assert.deepEqual([led.totals.purchase, led.totals.paid, led.totals.balance], [11000, 30000, 81000]);
  const sum = (await buyer('GET', `/api/purchase-ledger?from=${from}&to=${today}`)).body.rows.find(r => r.vendor === v);
  assert.deepEqual([sum.opening, sum.total, sum.paid, sum.balance], [100000, 11000, 30000, 81000]);
  const closing = (await buyer('GET', `/api/purchase-closing?period=${today.slice(0, 7)}`)).body.rows.find(r => r.vendor === v);
  assert.equal(closing.payment_total, 30000);
  assert.equal((await buyer('POST', `/api/purchase-payments/${pay.id}/cancel`, { reason: '중복' })).status, 200);
  assert.equal((await buyer('GET', `/api/purchase-ledger?vendor=${encodeURIComponent(v)}&from=${today.slice(0, 7)}-01&to=${today}`)).body.totals.balance, 111000);
  // 지난달 마감 뒤에는 그 달 지급 등록 막힘
  assert.equal((await buyer('POST', '/api/purchase-closing', { period: lastMonth, vendor: v })).status, 200);
  assert.equal((await buyer('POST', '/api/purchase-payments', { vendor: v, pay_date: lastMonth + '-15', amount: 1, request_id: rid() })).status, 400);
});

test('15.113 Excel import: dry run checks every row, errors block the whole batch, roles', async () => {
  assert.equal((await staff('POST', '/api/import/vendors', { rows: [{ name: '엑셀상사' }] })).status, 403);
  const rows = [{ name: '엑셀상사', code: 'x-1', is_purchase: 'O', biz_no: '1234567890' }, { name: '엑셀 상사' }, { name: '메일나쁨', tax_email: 'a@' }];
  const dry = (await buyer('POST', '/api/import/vendors', { rows, dry_run: true })).body;
  assert.equal(dry.ok, 1); assert.match(dry.errors[0].error, /1번째 줄과 이름/); assert.match(dry.errors[1].error, /이메일/);
  const blocked = (await buyer('POST', '/api/import/vendors', { rows })).body;
  assert.equal(blocked.inserted, undefined); assert.equal((await buyer('GET', '/api/vendors?q=엑셀')).body.length, 0);
  const done = (await buyer('POST', '/api/import/vendors', { rows: [rows[0], { name: '엑셀무역', is_sales: '예' }] })).body;
  assert.equal(done.inserted, 2);
  const list = (await buyer('GET', '/api/vendors?q=엑셀')).body;
  assert.deepEqual(list.map(v => [v.name, v.code.startsWith('C') ? 'auto' : v.code, v.is_purchase, v.is_sales, v.biz_no]).sort(), [['엑셀무역', 'auto', 0, 1, ''], ['엑셀상사', 'X-1', 1, 0, '123-45-67890']]);
  // 품목: 관리자만, 제품은 거절, 코드 겹침(대소문자)
  assert.equal((await buyer('POST', '/api/import/items', { rows: [{ product: 'a', item_category: '원자재', unit: 'KG' }] })).status, 403);
  const items = (await admin('POST', '/api/import/items', { rows: [{ product: '원사', product_code: 'mk-1', item_category: '원자재', unit: 'KG' }, { product: '완제품', item_category: '제품', unit: 'BOX' }, { product: '라벨', product_code: 'LB-1', item_category: '부자재', unit: 'EA', spec: '소' }], dry_run: true })).body;
  assert.equal(items.ok, 1); assert.match(items.errors[0].error, /MK-1|mk-1/i); assert.match(items.errors[1].error, /제품은 구성자재/);
  assert.equal((await admin('POST', '/api/import/items', { rows: [{ product: '라벨', product_code: 'LB-1', item_category: '부자재', unit: 'EA', spec: '소' }] })).body.inserted, 1);
  assert.equal((await admin('GET', '/api/boms?q=LB-1')).body[0].spec, '소');
});

test('15.114 Warehouse moves keep item stock, check place balance and roles; reorder info nets open orders', async () => {
  const g = (await admin('POST', '/api/boms', { product: '이동장갑', product_code: 'MV-1', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'BOX', materials: [] })).body;
  await admin('POST', '/api/warehouses', { name: '본동', locations: 'R1,R2' }); await admin('POST', '/api/warehouses', { name: '별동' });
  await staff('POST', '/api/receipts', { receipt_date: today, vendor: '상사', request_id: rid(), lines: [{ bom_id: g.id, lot: 'MV', qty: 20, warehouse: '본동', location: 'R1' }] });
  const base = { item: '이동장갑', unit: 'BOX', lot: 'MV', from_place: '본동 R1', to_warehouse: '별동' };
  assert.equal((await buyer('POST', '/api/stock-transfers', { ...base, qty: 5 })).status, 403);
  assert.equal((await staff('POST', '/api/stock-transfers', { ...base, qty: 25 })).status, 400);
  assert.equal((await staff('POST', '/api/stock-transfers', { ...base, to_warehouse: '본동', to_location: 'R1', qty: 1 })).status, 400);
  const t = (await staff('POST', '/api/stock-transfers', { ...base, qty: 8, request_id: rid() })).body;
  assert.equal(t.to_place, '별동');
  const places = (await staff('GET', '/api/inventory/lot-places?item=이동장갑&unit=BOX&lot=MV')).body.places.map(p => [p.place, p.qty]);
  assert.deepEqual(places.sort(), [['본동 R1', 12], ['별동', 8]].sort());
  assert.equal((await staff('GET', '/api/inventory?q=이동장갑')).body.rows[0].stock, 20);
  assert.equal((await staff('POST', `/api/stock-transfers/${t.id}/cancel`, {})).body.status, 'cancelled');
  assert.equal((await staff('POST', `/api/stock-transfers/${t.id}/cancel`, {})).status, 400);
  // 부족분 발주 정보: 입고 전 발주 수량·마지막 매입처·단가
  await buyer('POST', '/api/po', { req_no: 'PR-R', vendor: '재주문상사', bom_id: g.id, item: '이동장갑', qty: 7, unit: 'BOX', due_date: today, item_category: '상품', unit_price: 900 });
  const info = (await buyer('POST', '/api/inventory/reorder-info', { items: [{ item: '이동장갑', unit: 'BOX' }] })).body.items[0];
  assert.deepEqual([info.bom_id, info.open_qty, info.last_vendor, info.last_price], [g.id, 7, '재주문상사', 900]);
});

test('15.115 Aging: payments settle the oldest debts first; roles per side', async () => {
  assert.equal((await staff('GET', '/api/aging?side=purchase')).status, 403);
  assert.equal((await buyer('GET', '/api/aging?side=x')).status, 400);
  const ago = n => new Date(Date.parse(today + 'T00:00:00Z') - n * 864e5).toISOString().slice(0, 10);
  await buyer('POST', '/api/purchase-payments', { vendor: '연령상사', pay_date: ago(120), kind: 'opening', amount: 30000, request_id: rid() });
  await buyer('POST', '/api/purchase-payments', { vendor: '연령상사', pay_date: ago(5), kind: 'opening', amount: 8000, request_id: rid() });
  await buyer('POST', '/api/purchase-payments', { vendor: '연령상사', pay_date: today, amount: 20000, request_id: rid() });
  const row = (await buyer('GET', '/api/aging?side=purchase')).body.rows.find(r => r.name === '연령상사');
  assert.deepEqual([row.balance, row.buckets, row.oldest, row.days], [18000, [8000, 0, 0, 10000, 0], ago(120), 120]);
});

test('15.117 Bill lines keep the item class as saved; lists filter and total by class', async () => {
  const wash = (await admin('POST', '/api/boms', { product: '세탁가공', product_code: 'WS-1', item_category: '임가공', kind: 'finished', base_qty: 1, unit: 'EA', materials: [] })).body;
  const p = (await buyer('POST', '/api/po', { req_no: 'PR-C', vendor: '가공상사', bom_id: wash.id, item: '세탁가공', qty: 10, due_date: today, item_category: '임가공', unit_price: 500 })).body;
  await staff('POST', '/api/receipts', { receipt_date: today, vendor: '가공상사', request_id: rid(), lines: [{ po_id: p.id, lot: 'W1', qty: 10 }] });
  const open = (await buyer('GET', '/api/purchase-bills/unbilled?vendor=' + encodeURIComponent('가공상사'))).body.rows;
  assert.equal(open[0].item_category, '임가공');
  const bill = (await buyer('POST', '/api/purchase-bills', { vendor: '가공상사', bill_date: today, request_id: rid(), lines: [{ source_type: open[0].source_type, source_id: open[0].source_id }] })).body;
  assert.equal(bill.lines[0].category, '임가공');
  // 품목 분류를 바꿔도 저장된 전표 줄은 그대로
  await admin('PUT', `/api/boms/${wash.id}`, { product: '세탁가공', product_code: 'WS-1', item_category: '부자재', kind: 'finished', base_qty: 1, unit: 'EA', materials: [] });
  assert.equal((await buyer('GET', `/api/purchase-bills/${bill.id}`)).body.lines[0].category, '임가공');
  const list = (await buyer('GET', '/api/purchase-bills?category=임가공')).body;
  assert.deepEqual(list.rows.map(r => r.bill_no), [bill.bill_no]);
  assert.equal(list.rows[0].categories, '임가공');
  assert.deepEqual(list.by_category, [{ category: '임가공', lines: 1, supply: 5000 }]);
  assert.equal((await buyer('GET', '/api/purchase-bills?category=없는분류')).status, 400);
  const ledger = (await buyer('GET', `/api/purchase-ledger?vendor=${encodeURIComponent('가공상사')}&from=${today}&to=${today}`)).body;
  assert.equal(ledger.rows.find(r => r.kind === 'purchase').categories, '임가공');
});

test('15.117 Sales bill lines: product/goods class fixed at save, uncoded lines unclassified', async () => {
  const goods = (await admin('POST', '/api/boms', { product: '판매장갑', product_code: 'SG-1', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'BOX', materials: [] })).body;
  const s = (await admin('POST', '/api/shipments', { ship_date: today, bom_id: goods.id, item: '판매장갑', qty: 3, customer: '분류고객', unit: 'BOX' })).body;
  const unbilled = (await admin('GET', '/api/sales-bills/unbilled?customer=' + encodeURIComponent('분류고객'))).body.rows;
  assert.equal(unbilled[0].item_category, '상품');
  const bill = (await admin('POST', '/api/sales-bills', { customer: '분류고객', bill_date: today, request_id: rid(), lines: [{ source_type: 'ship', source_id: s.id, unit_price: 1000 }, { source_type: 'manual', item: '기타 용역', qty: 1, unit_price: 500 }] })).body;
  assert.deepEqual(bill.lines.map(l => l.category), ['상품', '']);
  const list = (await admin('GET', '/api/sales-bills?customer=' + encodeURIComponent('분류고객'))).body;
  assert.deepEqual(list.by_category.map(c => [c.category, c.supply]), [['상품', 3000], ['', 500]]);
  assert.equal((await admin('GET', '/api/sales-bills?category=미분류&customer=' + encodeURIComponent('분류고객'))).body.rows.length, 1);
  const ledger = (await admin('GET', `/api/sales-ledger?customer=${encodeURIComponent('분류고객')}&from=${today}&to=${today}`)).body;
  assert.deepEqual(ledger.rows.filter(r => r.kind === 'sale').map(r => r.category), ['상품', '']);
});

test('15.120 Department reports: every section answers for any staff; thresholds admin-only and validated', async () => {
  for (const section of ['common', 'sales', 'purchase', 'production', 'quality', 'dev', 'logistics']) {
    const r = await staff('GET', `/api/reports/dept?section=${section}&from=${today.slice(0, 8)}01&to=${today}&grain=week`);
    assert.equal(r.status, 200, section); assert.equal(r.body.kpis.length, 4, section);
  }
  assert.equal((await staff('GET', '/api/reports/dept?section=nope')).status, 400);
  assert.equal((await staff('PUT', '/api/report-settings', { ar_overdue_days: 60, old_lot_days: 30, due_grace_days: 1, plan_late_days: 0, dev_long_days: 30 })).status, 403);
  assert.equal((await admin('PUT', '/api/report-settings', { ar_overdue_days: 60, old_lot_days: 30, due_grace_days: 1.5, plan_late_days: 0, dev_long_days: 30 })).status, 400);
  assert.equal((await admin('PUT', '/api/report-settings', { ar_overdue_days: 60, old_lot_days: 30, due_grace_days: 1, plan_late_days: 0, dev_long_days: 30 })).status, 200);
  assert.equal((await staff('GET', '/api/report-settings')).body.values.ar_overdue_days, 60);
  const sales = (await staff('GET', `/api/reports/dept?section=sales&from=${today}&to=${today}`)).body;
  assert.equal(sales.kpis[3].label, '60일 넘은 미수');
  // 연령표 API는 내부 aged 목록을 내보내지 않는다
  assert.equal((await buyer('GET', '/api/aging?side=purchase')).body.rows.some(r => 'aged' in r), false);
});

test('15.121 Registered spec is fixed on every save path; items without a registered spec keep typed specs', async () => {
  const g = (await admin('POST', '/api/boms', { product: '고정규격장갑', product_code: 'FX-1', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'EA', spec: '12" (M)', materials: [] })).body;
  const plain = (await admin('POST', '/api/boms', { product: '자유규격장갑', product_code: 'FR-1', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'EA', materials: [] })).body;
  const sh = (await admin('POST', '/api/batches/shipment', { request_id: rid(), common: { ship_date: today, customer: '규격고객' }, items: [{ bom_id: g.id, item: g.product, qty: 1, spec: '바꿈' }, { bom_id: plain.id, item: plain.product, qty: 1, spec: 'L' }] })).body;
  assert.deepEqual(sh.rows.map(r => r.spec), ['12" (M)', 'L']);
  const po = (await admin('POST', '/api/batches/purchase_order', { request_id: rid(), common: { vendor: '규격상사', due_date: today }, items: [{ bom_id: g.id, item: g.product, qty: 2, spec: '다른 규격', item_category: '상품' }] })).body;
  assert.equal(po.rows[0].spec, '12" (M)');
  await admin('PUT', `/api/items/shipment/${sh.rows[0].id}`, { spec: '고침', unit: 'EA', lot: '' });
  assert.equal((await admin('GET', '/api/shipments')).body.find?.(r => r.id === sh.rows[0].id)?.spec ?? '12" (M)', '12" (M)');
  const ord = (await admin('POST', '/api/sales-orders', { request_id: rid(), customer: '규격고객', order_date: today, lines: [{ bom_id: g.id, qty: 1, spec: '다른', unit_price: 1 }] })).body;
  assert.equal(ord.lines[0].spec, '12" (M)');
});

test('15.127 Purchase tax invoices: register from purchase bills, one invoice per bill, class filter incl. freight; sales invoices filter by class', async () => {
  const raw = (await admin('POST', '/api/boms', { product: '세금원사', product_code: 'TX-R1', item_category: '원자재', kind: 'finished', base_qty: 1, unit: 'KG', materials: [] })).body;
  const p = (await buyer('POST', '/api/po', { req_no: 'PR-T', vendor: '계산서상사', bom_id: raw.id, item: '세금원사', qty: 10, due_date: today, item_category: '원자재', unit_price: 1000 })).body;
  await staff('POST', '/api/receipts', { receipt_date: today, vendor: '계산서상사', request_id: rid(), lines: [{ po_id: p.id, lot: 'T1', qty: 10 }] });
  const open = (await buyer('GET', '/api/purchase-bills/unbilled?vendor=' + encodeURIComponent('계산서상사'))).body.rows;
  const bill = (await buyer('POST', '/api/purchase-bills', { vendor: '계산서상사', bill_date: today, freight: 3000, request_id: rid(), lines: [{ source_type: open[0].source_type, source_id: open[0].source_id }] })).body;
  assert.equal((await staff('GET', '/api/purchase-tax-invoices/candidates?vendor=계산서상사')).status, 403);
  const cand = (await buyer('GET', '/api/purchase-tax-invoices/candidates?vendor=' + encodeURIComponent('계산서 상사'))).body.rows;
  assert.deepEqual(cand.map(r => r.id), [bill.id]); assert.equal(cand[0].categories, '원자재');
  assert.equal((await buyer('POST', '/api/purchase-tax-invoices', { vendor: '계산서상사', write_date: today, approval_no: 'abc', bill_ids: [bill.id] })).status, 400);
  const inv = (await buyer('POST', '/api/purchase-tax-invoices', { request_id: rid(), vendor: '계산서상사', write_date: today, approval_no: '20261117-41000012-00000001', bill_ids: [bill.id] })).body;
  assert.equal(inv.total, bill.total); assert.deepEqual(inv.categories.map(c => [c.category, c.supply]), [['원자재', 10000], ['운송비', 3000]]);
  assert.equal((await buyer('POST', '/api/purchase-tax-invoices', { request_id: rid(), vendor: '계산서상사', write_date: today, bill_ids: [bill.id] })).status, 409);
  assert.equal((await buyer('GET', '/api/purchase-tax-invoices/candidates?vendor=' + encodeURIComponent('계산서상사'))).body.rows.length, 0);
  const byFreight = (await buyer('GET', '/api/purchase-tax-invoices?category=운송비')).body;
  assert.equal(byFreight.rows.length, 1); assert.equal(byFreight.rows[0].cats.split('|').sort().join('|'), '운송비:3000|원자재:10000');
  assert.deepEqual(byFreight.by_category.map(c => [c.category, c.supply]), [['원자재', 10000], ['운송비', 3000]]);
  assert.equal((await buyer('GET', '/api/purchase-tax-invoices?category=상품')).body.rows.length, 0);
  assert.equal((await buyer('GET', '/api/purchase-tax-invoices?category=없음')).status, 400);
  const c = (await buyer('POST', `/api/purchase-tax-invoices/${inv.id}/cancel`, { reason: '잘못 등록' })).body;
  assert.equal(c.status, 'cancelled');
  assert.equal((await buyer('GET', '/api/purchase-tax-invoices/candidates?vendor=' + encodeURIComponent('계산서상사'))).body.rows.length, 1);
  // 매출 계산서 분류 필터
  const g = (await admin('POST', '/api/boms', { product: '세금상품', product_code: 'TX-G1', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'EA', materials: [] })).body;
  const s = (await admin('POST', '/api/shipments', { ship_date: today, bom_id: g.id, item: g.product, qty: 2, customer: '계산서고객', unit: 'EA' })).body;
  const sb = (await admin('POST', '/api/sales-bills', { customer: '계산서고객', bill_date: today, request_id: rid(), lines: [{ source_type: 'ship', source_id: s.id, unit_price: 500 }] })).body;
  await admin('POST', '/api/tax-invoices', { request_id: rid(), kind: 'single', bill_ids: [sb.id] });
  const ti = (await admin('GET', `/api/tax-invoices?category=상품&from=${today}&to=${today}`)).body;
  assert.ok(ti.rows.some(r => r.customer === '계산서고객' && r.cats === '상품:1000'), JSON.stringify(ti.rows.map(r => r.cats)));
  assert.equal((await admin('GET', `/api/tax-invoices?category=원자재&customer=${encodeURIComponent('계산서고객')}&from=${today}&to=${today}`)).body.rows.length, 0);
});

test('15.131 Bulk tax invoices from bill lists: merge per customer, no double add; purchase list shows received invoice', async () => {
  const g = (await admin('POST', '/api/boms', { product: '합산상품', product_code: 'MG-1', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'EA', materials: [] })).body;
  const sell = async c => { const s = (await admin('POST', '/api/shipments', { ship_date: today, bom_id: g.id, item: g.product, qty: 1, customer: c, unit: 'EA' })).body; return (await admin('POST', '/api/sales-bills', { customer: c, bill_date: today, request_id: rid(), lines: [{ source_type: 'ship', source_id: s.id, unit_price: 1000 }] })).body; };
  const a1 = await sell('합산갑'), a2 = await sell('합산갑'), b1 = await sell('합산을');
  const r = await admin('POST', '/api/tax-invoices', { request_id: rid(), kind: 'merge', bill_ids: [a1.id, a2.id, b1.id] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.rows.map(x => [x.customer, x.total]).sort(), [['합산갑', 2200], ['합산을', 1100]]);
  const list = (await admin('GET', '/api/sales-bills?customer=' + encodeURIComponent('합산갑'))).body.rows;
  assert.ok(list.every(x => x.invoice), 'both bills now carry the invoice');
  assert.equal((await admin('POST', '/api/tax-invoices', { request_id: rid(), kind: 'single', bill_ids: [a1.id] })).status, 409, 'no double add');
  assert.equal((await admin('POST', '/api/tax-invoices', { request_id: rid(), kind: 'merge', bill_ids: [b1.id] })).status, 409, 'no double add (merge)');
  const pb = (await buyer('GET', '/api/purchase-bills?vendor=' + encodeURIComponent('계산서상사'))).body.rows;
  assert.ok(pb.length && pb.every(x => x.invoice === null), 'cancelled purchase invoice does not count');
});

test('15.133 LOT prefix by category and sub-LOTs per package', async () => {
  const raw = (await admin('POST', '/api/boms', { product: '서브원단', product_code: 'SUB-R', item_category: '원자재', kind: 'finished', base_qty: 1, unit: 'M', materials: [] })).body;
  const next = (await staff('GET', `/api/lots/next?category=${encodeURIComponent('원자재')}&date=2026-08-04&count=2`)).body.lots;
  assert.deepEqual(next, ['R260804_001', 'R260804_002']);
  assert.equal((await staff('GET', `/api/lots/next?category=${encodeURIComponent('상품')}&date=2026-08-04`)).body.lots[0], 'G260804_001');
  const rc = (await staff('POST', '/api/receipts', { receipt_date: today, vendor: '서브상사', request_id: rid(), lines: [1, 2, 3].map(() => ({ bom_id: raw.id, lot: 'R260804_001', qty: 30 })) })).body;
  assert.deepEqual(rc.lines.map(l => [l.lot, l.sub_lot]), [['R260804_001', '001'], ['R260804_001', '002'], ['R260804_001', '003']]);
  const rc2 = (await staff('POST', '/api/receipts', { receipt_date: today, vendor: '서브상사', request_id: rid(), lines: [{ bom_id: raw.id, lot: 'R260804_001', qty: 5 }] })).body;
  assert.equal(rc2.lines[0].sub_lot, '004', 'continues after earlier sub-LOTs');
  assert.equal((await staff('GET', `/api/lots/next?prefix=R&date=2026-08-04`)).body.lots[0], 'R260804_002');
});

test('15.137 Partner book: per-bill rows with tax invoice, payments, running balance; summary per partner', async () => {
  const g = (await admin('POST', '/api/boms', { product: '장부상품', product_code: 'BK-1', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'EA', materials: [] })).body;
  const sell = async () => { const s = (await admin('POST', '/api/shipments', { ship_date: today, bom_id: g.id, item: g.product, qty: 1, customer: '장부고객', unit: 'EA' })).body; return (await admin('POST', '/api/sales-bills', { customer: '장부고객', bill_date: today, request_id: rid(), lines: [{ source_type: 'ship', source_id: s.id, unit_price: 1000 }] })).body; };
  const b1 = await sell(); await sell();
  const inv = (await admin('POST', '/api/tax-invoices', { request_id: rid(), kind: 'single', bill_ids: [b1.id] })).body.rows[0];
  await admin('POST', '/api/sales-payments', { request_id: rid(), customer: '장부고객', pay_date: today, kind: 'payment', amount: 500 });
  const d = (await admin('GET', `/api/partner-book?side=sales&from=${today}&to=${today}&party=${encodeURIComponent('장부 고객')}`)).body;
  const bills = d.rows.filter(r => r.kind === 'bill');
  assert.equal(bills.length, 2); assert.equal(bills[0].invoice_no, inv.invoice_no); assert.equal(bills[1].invoice_no, '');
  assert.equal(d.totals.total, 2200); assert.equal(d.totals.paid, 500); assert.equal(d.totals.balance, 1700); assert.equal(d.totals.uninvoiced, 1100);
  const sum = (await admin('GET', `/api/partner-book?side=sales&from=${today}&to=${today}`)).body.rows.find(r => r.name === '장부고객');
  assert.deepEqual([sum.bills, sum.total, sum.paid, sum.balance, sum.invoiced, sum.uninvoiced], [2, 2200, 500, 1700, 1100, 1100]);
  assert.equal((await staff('GET', `/api/partner-book?side=sales&from=${today}&to=${today}`)).status, 403);
  assert.equal((await buyer('GET', `/api/partner-book?side=purchase&from=${today}&to=${today}`)).status, 200);
});

test('15.138 Tax invoice states: reverse-issue customers, recipient confirmation, NTS sent, filters and summary', async () => {
  const g = (await admin('POST', '/api/boms', { product: '역발행상품', product_code: 'RV-1', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'EA', materials: [] })).body;
  const sell = async c => { const s = (await admin('POST', '/api/shipments', { ship_date: today, bom_id: g.id, item: g.product, qty: 1, customer: c, unit: 'EA' })).body; return (await admin('POST', '/api/sales-bills', { customer: c, bill_date: today, request_id: rid(), lines: [{ source_type: 'ship', source_id: s.id, unit_price: 1000 }] })).body; };
  const rb = await sell('삼성역발행'), nb = await sell('정발행상사');
  const sv = (await admin('GET', '/api/vendors?q=' + encodeURIComponent('삼성역발행'))).body[0];
  await admin('PUT', `/api/vendors/${sv.id}/tax-info`, { biz_no: '1248100998', tax_email: 'sdc@hometax.go.kr', tax_reverse: true });
  const [ri] = (await admin('POST', '/api/tax-invoices', { request_id: rid(), kind: 'single', bill_ids: [rb.id] })).body.rows;
  const [ni] = (await admin('POST', '/api/tax-invoices', { request_id: rid(), kind: 'single', bill_ids: [nb.id] })).body.rows;
  assert.equal(ri.issue_type, 'reverse'); assert.equal(ni.issue_type, 'normal');
  assert.match((await admin('POST', '/api/tax-invoices/issue', { ids: [ri.id] })).body.error, /역발행/);
  assert.match((await admin('POST', '/api/tax-invoices/state', { ids: [ri.id], action: 'recv_confirm' })).body.error, /발행된 계산서만/);
  const m = (await admin('POST', `/api/tax-invoices/${ri.id}/mark-issued`, { approval_no: '20261117-41000012-77777777', issued_date: today })).body;
  assert.equal(m.status, 'issued'); assert.match(m.status_message, /역발행 승인/);
  let list = (await admin('GET', `/api/tax-invoices?from=${today}&to=${today}&state=unconfirmed`)).body;
  assert.ok(list.rows.some(r => r.id === ri.id) && list.rows.every(r => !r.recv_status));
  assert.equal((await admin('POST', '/api/tax-invoices/state', { ids: [ri.id], action: 'recv_confirm' })).status, 200);
  assert.equal((await admin('POST', '/api/tax-invoices/state', { ids: [ri.id], action: 'nts_sent' })).status, 200);
  const one = (await admin('GET', `/api/tax-invoices?from=${today}&to=${today}&issue_type=reverse`)).body;
  const r1 = one.rows.find(r => r.id === ri.id); assert.equal(r1.recv_status, 'confirmed'); assert.equal(r1.status, 'sent');
  assert.ok(one.rows.every(r => r.issue_type === 'reverse'));
  list = (await admin('GET', `/api/tax-invoices?from=${today}&to=${today}`)).body;
  assert.ok(list.summary.nts_sent.n >= 1 && list.summary.confirmed.n >= 1 && list.summary.reverse.n >= 1);
  assert.equal((await admin('POST', '/api/tax-invoices/state', { ids: [ni.id], action: 'nonsense' })).status, 400);
  assert.equal((await admin('GET', `/api/tax-invoices?state=bogus`)).status, 400);
});

test('15.140 Returns: 반입 restocks and cuts receivable, refund keeps balance, 반출 cuts payable, caps, cancel', async () => {
  const g = (await admin('POST', '/api/boms', { product: '반품장갑', product_code: 'RT-1', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'EA', materials: [] })).body;
  const stockOf = async () => ((await admin('GET', '/api/inventory?q=' + encodeURIComponent('반품장갑'))).body.rows.find(r => r.item === '반품장갑')?.stock) || 0;
  const s = (await admin('POST', '/api/shipments', { ship_date: today, bom_id: g.id, item: g.product, qty: 10, customer: '반품고객', unit: 'EA', lot: 'G-LOT1' })).body;
  const sb = (await admin('POST', '/api/sales-bills', { customer: '반품고객', bill_date: today, request_id: rid(), lines: [{ source_type: 'ship', source_id: s.id, unit_price: 1000 }] })).body;
  const before = await stockOf();
  const src = (await admin('GET', `/api/returns/sources?side=in&party=${encodeURIComponent('반품고객')}`)).body.rows;
  assert.equal(src.length, 1); assert.equal(src[0].left, 10);
  assert.match((await admin('POST', '/api/returns', { side: 'in', return_date: today, party: '반품고객', process: 'stock_amount', request_id: rid(), lines: [{ source_id: src[0].id, qty: 11 }] })).body.error, /10까지/);
  const r1 = (await admin('POST', '/api/returns', { side: 'in', return_date: today, party: '반품고객', process: 'stock_amount', settle: 'offset', request_id: rid(), lines: [{ source_id: src[0].id, qty: 3, reason: '불량' }] })).body;
  assert.match(r1.return_no, /^RI-\d{6}-01$/); assert.equal(r1.total, 3300); assert.ok(r1.bill?.bill_no);
  assert.equal(await stockOf(), before + 3, 'restocked');
  const book = (await admin('GET', `/api/partner-book?side=sales&from=${today}&to=${today}&party=${encodeURIComponent('반품고객')}`)).body;
  assert.equal(book.totals.balance, 11000 - 3300, 'receivable reduced');
  const lots = (await admin('GET', '/api/lots/available?item=' + encodeURIComponent('반품장갑'))).body.rows; assert.ok(lots.length === 0 || lots.every(l => l.lot !== 'G-LOT1' || l.balance >= 0));
  assert.match((await admin('POST', `/api/sales-bills/${r1.bill_id}/cancel`, { reason: 'x' })).body.error, /반입 RI-/);
  assert.equal((await admin('GET', `/api/returns/sources?side=in&party=${encodeURIComponent('반품고객')}`)).body.rows[0].left, 7);
  const r2 = (await admin('POST', '/api/returns', { side: 'in', return_date: today, party: '반품고객', process: 'amount', settle: 'refund', request_id: rid(), lines: [{ source_id: src[0].id, qty: 2 }] })).body;
  assert.equal(await stockOf(), before + 3, 'amount only: no stock');
  const book2 = (await admin('GET', `/api/partner-book?side=sales&from=${today}&to=${today}&party=${encodeURIComponent('반품고객')}`)).body;
  assert.equal(book2.totals.balance, 11000 - 3300, 'refund keeps balance'); assert.ok(r2.payment_id);
  const c1 = (await admin('POST', `/api/returns/${r1.id}/cancel`, { reason: '잘못 입력' })).body;
  assert.equal(c1.status, 'cancelled'); assert.equal(await stockOf(), before);
  assert.equal((await admin('GET', `/api/partner-book?side=sales&from=${today}&to=${today}&party=${encodeURIComponent('반품고객')}`)).body.totals.balance, 11000);
  // 반출
  const p = (await buyer('POST', '/api/po', { req_no: 'PR-R', vendor: '반출상사', bom_id: g.id, item: g.product, qty: 20, due_date: today, unit_price: 500 })).body;
  await staff('POST', '/api/receipts', { receipt_date: today, vendor: '반출상사', request_id: rid(), lines: [{ po_id: p.id, lot: 'G-IN', qty: 20 }] });
  const open = (await buyer('GET', '/api/purchase-bills/unbilled?vendor=' + encodeURIComponent('반출상사'))).body.rows;
  await buyer('POST', '/api/purchase-bills', { vendor: '반출상사', bill_date: today, request_id: rid(), lines: open.map(r => ({ source_type: r.source_type, source_id: r.source_id })) });
  const before2 = await stockOf();
  const ps = (await buyer('GET', `/api/returns/sources?side=out&party=${encodeURIComponent('반출상사')}`)).body.rows;
  const o1 = (await buyer('POST', '/api/returns', { side: 'out', return_date: today, party: '반출상사', process: 'stock_amount', request_id: rid(), lines: [{ source_id: ps[0].id, qty: 4 }] })).body;
  assert.match(o1.return_no, /^RO-/); assert.equal(o1.total, 2200); assert.equal(await stockOf(), before2 - 4);
  const pb = (await buyer('GET', `/api/partner-book?side=purchase&from=${today}&to=${today}&party=${encodeURIComponent('반출상사')}`)).body;
  assert.equal(pb.totals.balance, 11000 - 2200, 'payable reduced');
  assert.equal((await buyer('GET', `/api/purchase-bills/${o1.bill_id}`)).status, 200, 'negative purchase bill opens');
  assert.equal((await staff('POST', '/api/returns', { side: 'out', return_date: today, party: '반출상사', lines: [] })).status, 403);
});

test('15.141 Aging treats later returns as credit against the oldest bill; return refunds cannot be cancelled alone', async () => {
  const g = (await admin('POST', '/api/boms', { product: '연령반품', product_code: 'AG-R1', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'EA', materials: [] })).body;
  const sell = async (d, p) => { const s = (await admin('POST', '/api/shipments', { ship_date: d, bom_id: g.id, item: g.product, qty: 1, customer: '연령고객', unit: 'EA' })).body; return (await admin('POST', '/api/sales-bills', { customer: '연령고객', bill_date: d, request_id: rid(), lines: [{ source_type: 'ship', source_id: s.id, unit_price: p }] })).body; };
  const old = new Date(Date.now() + 9 * 3600e3 - 100 * 864e5).toISOString().slice(0, 10);
  const b1 = await sell(old, 10000); await sell(today, 5000);
  const ln = (await admin('GET', `/api/returns/sources?side=in&party=${encodeURIComponent('연령고객')}&months=12`)).body.rows.find(r => r.bill_no === b1.bill_no);
  await admin('POST', '/api/returns', { side: 'in', return_date: today, party: '연령고객', process: 'amount', request_id: rid(), lines: [{ source_id: ln.id, qty: 1, unit_price: 4000 }] });
  const row = (await admin('GET', `/api/aging?side=sales&asof=${today}`)).body.rows.find(r => r.name === '연령고객');
  assert.equal(row.balance, 11000 + 5500 - 4400);
  assert.equal(row.buckets[0], 5500, 'newest bill untouched'); assert.equal(row.buckets.slice(1).reduce((t, v) => t + v, 0), 11000 - 4400, 'return reduces the oldest bill');
  const ln2 = (await admin('GET', `/api/returns/sources?side=in&party=${encodeURIComponent('연령고객')}&months=12`)).body.rows.find(r => r.bill_no !== b1.bill_no && r.left > 0);
  const r2 = (await admin('POST', '/api/returns', { side: 'in', return_date: today, party: '연령고객', process: 'amount', settle: 'refund', request_id: rid(), lines: [{ source_id: ln2.id, qty: 0.5, unit_price: 1000 }] })).body;
  assert.ok(r2.payment_id, JSON.stringify(r2));
  assert.match((await admin('POST', `/api/sales-payments/${r2.payment_id}/cancel`, { reason: 'x' })).body.error, /반입 RI-/);
});

test('15.142~143 Invoice edit in form: write date moves item dates, item/buyer edits, 계산서(면세) document type', async () => {
  const g = (await admin('POST', '/api/boms', { product: '양식상품', product_code: 'TF-1', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'EA', materials: [] })).body;
  const sell = async (c, tax) => { const s = (await admin('POST', '/api/shipments', { ship_date: today, bom_id: g.id, item: g.product, qty: 2, customer: c, unit: 'EA' })).body; return (await admin('POST', '/api/sales-bills', { customer: c, bill_date: today, tax_type: tax, request_id: rid(), lines: [{ source_type: 'ship', source_id: s.id, unit_price: 1000 }] })).body; };
  const tb = await sell('양식고객', 'taxable'), fb = await sell('면세고객', 'zero');
  const [ti] = (await admin('POST', '/api/tax-invoices', { request_id: rid(), kind: 'single', bill_ids: [tb.id] })).body.rows;
  const [fi] = (await admin('POST', '/api/tax-invoices', { request_id: rid(), kind: 'single', bill_ids: [fb.id] })).body.rows;
  assert.equal(ti.doc_type, 'tax'); assert.equal(fi.doc_type, 'free');
  const d2 = today.slice(0, 8) + '01';
  let r = (await admin('PUT', `/api/tax-invoices/${ti.id}`, { write_date: d2 })).body;
  assert.equal(r.write_date, d2); assert.ok(r.items.every(i => i.date === d2), 'item dates follow write date');
  r = (await admin('PUT', `/api/tax-invoices/${ti.id}`, { write_date: d2, items: [{ date: d2, item: '양식상품 2BOX', spec: 'L', note: 'PO 1234' }], buyer: { biz_no: '2208816064', biz_name: '(주)양식고객', ceo: '김대표', address: '서울', biz_type: '도매', biz_item: '장갑' } })).body;
  assert.equal(r.items[0].item, '양식상품 2BOX'); assert.equal(r.items[0].supply, 2000, 'amount locked'); assert.equal(r.biz_no, '220-88-16064'); assert.equal(r.ceo, '김대표');
  assert.match((await admin('PUT', `/api/tax-invoices/${ti.id}`, { write_date: d2, items: [{ date: '2000-01-01', item: 'x' }] })).body.error, /같은 달/);
  assert.match((await admin('PUT', `/api/tax-invoices/${ti.id}`, { doc_type: 'free' })).body.error, /세액이 0/);
  assert.equal((await admin('PUT', `/api/tax-invoices/${fi.id}`, { doc_type: 'tax' })).body.doc_type, 'tax', '영세율 세금계산서로 바꿀 수 있음');
  const list = (await admin('GET', `/api/tax-invoices?doc=tax&from=${d2}&to=${today}`)).body.rows; assert.ok(list.some(x => x.id === fi.id));
});

test('15.147 Edit returns (lines, process, refund) and bills (date, price, note) with history; invoiced/closed/return bills blocked', async () => {
  const g = (await admin('POST', '/api/boms', { product: '고침장갑', product_code: 'ED-1', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'EA', materials: [] })).body;
  const stockOf = async () => ((await admin('GET', '/api/inventory?q=' + encodeURIComponent('고침장갑'))).body.rows.find(r => r.item === '고침장갑')?.stock) || 0;
  const s = (await admin('POST', '/api/shipments', { ship_date: today, bom_id: g.id, item: g.product, qty: 10, customer: '고침고객', unit: 'EA' })).body;
  const sb = (await admin('POST', '/api/sales-bills', { customer: '고침고객', bill_date: today, request_id: rid(), lines: [{ source_type: 'ship', source_id: s.id, unit_price: 1000 }] })).body;
  const src = (await admin('GET', `/api/returns/sources?side=in&party=${encodeURIComponent('고침고객')}`)).body.rows[0];
  const r = (await admin('POST', '/api/returns', { side: 'in', return_date: today, party: '고침고객', process: 'amount', request_id: rid(), lines: [{ source_id: src.id, qty: 2 }] })).body;
  const st0 = await stockOf();
  // 수량 2 → 5, 재고+금액으로: 같은 번호, 같은 금액 전표 고쳐 씀, 재고 +5
  const e1 = await admin('PUT', `/api/returns/${r.id}`, { process: 'stock_amount', lines: [{ source_id: src.id, qty: 5, reason: '불량' }] });
  assert.equal(e1.status, 200, JSON.stringify(e1.body)); assert.equal(e1.body.return_no, r.return_no); assert.equal(e1.body.bill_id, r.bill_id); assert.equal(e1.body.total, 5500);
  assert.equal(await stockOf(), st0 + 5);
  assert.equal((await admin('GET', `/api/sales-bills/${r.bill_id}`)).body.total, -5500);
  assert.match((await admin('PUT', `/api/returns/${r.id}`, { lines: [{ source_id: src.id, qty: 11 }] })).body.error, /10까지/, 'own qty excluded, cap still applies');
  // 교환(재고만)으로: 금액 전표 취소(숨김), 환불도 없음
  const e2 = (await admin('PUT', `/api/returns/${r.id}`, { process: 'stock', lines: [{ source_id: src.id, qty: 5 }] })).body;
  assert.equal(e2.bill_id, null); assert.equal((await admin('GET', `/api/sales-bills/${r.bill_id}`)).body.status, 'cancelled');
  // 다시 금액+환불: 새 금액 전표·환불
  const e3 = (await admin('PUT', `/api/returns/${r.id}`, { process: 'amount', settle: 'refund', lines: [{ source_id: src.id, qty: 1 }] })).body;
  assert.ok(e3.bill_id && e3.payment_id); assert.equal(e3.changes.length, 3);
  const book = (await admin('GET', `/api/partner-book?side=sales&from=${today}&to=${today}&party=${encodeURIComponent('고침고객')}`)).body;
  assert.equal(book.totals.balance, 11000, 'refund keeps balance');
  // 매출전표 고치기
  const b1 = (await admin('PUT', `/api/sales-bills/${sb.id}`, { lines: [{ id: (await admin('GET', `/api/sales-bills/${sb.id}`)).body.lines[0].id, unit_price: 1200, note: '단가 정정' }], note: '정정' })).body;
  assert.equal(b1.total, 13200); assert.equal(b1.changes.length, 1); assert.match(b1.changes[0].summary, /단가 1000→1200/);
  assert.match((await admin('PUT', `/api/sales-bills/${e3.bill_id}`, { note: 'x' })).body.error, /반입 RI-/);
  await admin('POST', '/api/tax-invoices', { request_id: rid(), kind: 'single', bill_ids: [sb.id] });
  assert.match((await admin('PUT', `/api/sales-bills/${sb.id}`, { note: 'y' })).body.error, /세금계산서/);
  assert.match((await admin('PUT', `/api/returns/${r.id}`, { lines: [{ source_id: src.id, qty: 1 }], note: 'x' })).status === 200 ? 'ok' : 'blocked', /ok/, 'return bill not invoiced still editable');
  // 매입전표 고치기
  const p = (await buyer('POST', '/api/po', { req_no: 'PR-E', vendor: '고침상사', bom_id: g.id, item: g.product, qty: 10, due_date: today, unit_price: 500 })).body;
  await staff('POST', '/api/receipts', { receipt_date: today, vendor: '고침상사', request_id: rid(), lines: [{ po_id: p.id, qty: 10 }] });
  const o = (await buyer('GET', '/api/purchase-bills/unbilled?vendor=' + encodeURIComponent('고침상사'))).body.rows;
  const pb = (await buyer('POST', '/api/purchase-bills', { vendor: '고침상사', bill_date: today, request_id: rid(), lines: o.map(x => ({ source_type: x.source_type, source_id: x.source_id })) })).body;
  const pe = (await buyer('PUT', `/api/purchase-bills/${pb.id}`, { freight: 1000, statement_no: 'ST-9', lines: [{ id: pb.lines[0].id, unit_price: 450 }] })).body;
  assert.equal(pe.total, 6050); assert.equal(pe.statement_no, 'ST-9'); assert.equal(pe.changes.length, 1);
  assert.equal((await staff('PUT', `/api/purchase-bills/${pb.id}`, { note: 'x' })).status, 403);
});
