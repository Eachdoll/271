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
