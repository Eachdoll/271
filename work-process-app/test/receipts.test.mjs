// 15.72 입고 묶음·LOT·창고: 발주 LOT 분할·부분 입고·예전 입고와 섞임·승인 보정·기타입고 LOT 줄·재시도·동시 처리·LOT 번호·창고
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc72-'));
const { env, sqlite } = localEnvironment(dir, 'rc72-test');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await worker.fetch(new Request('https://rc72.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}
const admin = client(), staff = client();
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const rid = () => crypto.randomUUID();
let glove, mask;
before(async () => {
  await approvedRegistration(admin, admin, { name: '관리자', password: 'password', invite: 'rc72-test' });
  await approvedRegistration(admin, staff, { name: '물류', password: 'password', invite: 'rc72-test' });
  glove = (await admin('POST', '/api/boms', { product: 'G3 NXT 나이트릴', product_code: '32-095', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'BOX', materials: [] })).body;
  mask = (await admin('POST', '/api/boms', { product: '마스크', product_code: 'MK-1', item_category: '부자재', kind: 'finished', base_qty: 1, unit: 'EA', materials: [] })).body;
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const order = async (qty, vendor = '에스케이') => (await admin('POST', '/api/po', { req_no: 'PR-T', vendor, item: 'G3 NXT 나이트릴', bom_id: glove.id, qty, due_date: today, item_category: '상품' })).body;
const stockOf = async item => (await staff('GET', '/api/inventory?q=' + encodeURIComponent(item))).body.rows.find(r => r.item === item)?.stock ?? 0;
const analyses = poId => sqlite.prepare("SELECT * FROM requests WHERE source_type='purchase_order' AND source_id=?").all(poId);

test('One order received as several LOTs over two receipts; status, totals, analysis and stock follow the LOT lines', async () => {
  const po = await order(100);
  const first = await staff('POST', '/api/receipts', { receipt_date: today, vendor: '에스케이', request_id: rid(), lines: [
    { po_id: po.id, lot: 'M261113_001', qty: 20 }, { po_id: po.id, lot: 'M261113_002', qty: 20 }, { po_id: po.id, lot: 'M261113_003', qty: 20 }] });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.match(first.body.receipt_no, /^RC-\d{6}-01$/);
  assert.deepEqual(first.body.lines.map(l => [l.kind, l.lot, l.qty, l.item, l.unit]), [['po', 'M261113_001', 20, 'G3 NXT 나이트릴', 'BOX'], ['po', 'M261113_002', 20, 'G3 NXT 나이트릴', 'BOX'], ['po', 'M261113_003', 20, 'G3 NXT 나이트릴', 'BOX']]);
  let row = sqlite.prepare('SELECT * FROM purchase_orders WHERE id=?').get(po.id);
  assert.deepEqual([row.recv_status, row.recv_qty, row.lot], ['mismatch', 60, 'M261113_001, M261113_002, M261113_003'], 'a partial receipt is short until the rest arrives');
  assert.equal(analyses(po.id).length, 1); assert.equal(JSON.parse(analyses(po.id)[0].data).received_qty, 60);
  assert.equal(await stockOf('G3 NXT 나이트릴'), 60);
  const second = await staff('POST', '/api/receipts', { receipt_date: today, vendor: ' 에스케이', request_id: rid(), lines: [{ po_id: po.id, lot: 'M261113_004', qty: 40 }] });
  assert.equal(second.status, 200, JSON.stringify(second.body)); assert.match(second.body.receipt_no, /-02$/);
  row = sqlite.prepare('SELECT * FROM purchase_orders WHERE id=?').get(po.id);
  assert.deepEqual([row.recv_status, row.recv_qty], ['ok', 100]);
  assert.equal(analyses(po.id).length, 1, 'one inspection per order');
  assert.ok(sqlite.prepare("SELECT 1 FROM progress_comments WHERE entity_type='request' AND entity_id=? AND content LIKE '[추가 입고]%'").get(analyses(po.id)[0].id));
  assert.equal(await stockOf('G3 NXT 나이트릴'), 100);
  const closed = await staff('POST', '/api/receipts', { receipt_date: today, vendor: '에스케이', request_id: rid(), lines: [{ po_id: po.id, lot: 'X', qty: 1 }] });
  assert.equal(closed.status, 400); assert.match(closed.body.error, /이미 입고가 끝난 발주/);
  const list = (await staff('GET', '/api/receipts?q=M261113_004')).body.rows;
  assert.deepEqual(list.map(r => r.receipt_no), [second.body.receipt_no]);
  assert.equal((await staff('GET', `/api/receipts/${first.body.id}`)).body.lines.length, 3);
});

test('Validation: other vendor, missing quantity, future date, pending change', async () => {
  const po = await order(10);
  const send = (lines, extra = {}) => staff('POST', '/api/receipts', { receipt_date: today, vendor: '에스케이', request_id: rid(), lines, ...extra });
  assert.match((await send([{ po_id: po.id, qty: 1 }], { vendor: '다른상사' })).body.error, /다른 거래처/);
  assert.match((await send([{ po_id: po.id, qty: 0 }])).body.error, /1번째 줄: 수량은 0보다/);
  assert.equal((await send([{ po_id: po.id, qty: 1 }], { receipt_date: '2999-01-01' })).status, 400);
  assert.equal((await send([])).status, 400);
  await send([{ po_id: po.id, qty: 4, lot: 'A' }]);
  assert.equal((await staff('POST', `/api/po/${po.id}/receipt-changes`, { action: 'qty', recv_qty: 5, reason: '재확인', request_id: rid() })).status, 200);
  assert.equal((await send([{ po_id: po.id, qty: 1 }])).status, 409, 'blocked while a correction waits');
});

test('An order received the old way keeps its quantity when LOT lines are added; approvals keep the lines equal to the total', async () => {
  const po = await order(50);
  assert.equal((await staff('POST', '/api/po/receive', { ids: [po.id], status: 'mismatch', recv_qty: 30 })).status, 200);
  assert.equal(await stockOf('G3 NXT 나이트릴') >= 30, true);
  const before = await stockOf('G3 NXT 나이트릴');
  const r = await staff('POST', '/api/receipts', { receipt_date: today, vendor: '에스케이', request_id: rid(), lines: [{ po_id: po.id, lot: 'B-2', qty: 20 }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const lots = sqlite.prepare('SELECT lot,qty,note FROM po_receipt_lots WHERE po_id=? ORDER BY id').all(po.id);
  assert.deepEqual(lots.map(l => [l.qty, l.note]), [[30, '이전 입고'], [20, '']]);
  assert.equal(sqlite.prepare('SELECT recv_qty FROM purchase_orders WHERE id=?').get(po.id).recv_qty, 50);
  assert.equal(await stockOf('G3 NXT 나이트릴'), before + 20, 'the earlier 30 is counted once');
  // 수량 수정 승인 → 보정 줄
  const change = (await staff('POST', `/api/po/${po.id}/receipt-changes`, { action: 'qty', recv_qty: 48, reason: '파손 2', request_id: rid() })).body.change;
  assert.equal((await admin('POST', `/api/receipt-changes/${change.id}/approve`, {})).status, 200);
  assert.equal(sqlite.prepare('SELECT SUM(qty) s FROM po_receipt_lots WHERE po_id=? AND voided_at IS NULL').get(po.id).s, 48);
  assert.equal(await stockOf('G3 NXT 나이트릴'), before + 18);
  // 입고 취소 승인 → 줄 모두 취소, 재고에서 빠짐
  const revert = (await staff('POST', `/api/po/${po.id}/receipt-changes`, { action: 'revert', reason: '반품', request_id: rid() })).body.change;
  assert.equal((await admin('POST', `/api/receipt-changes/${revert.id}/approve`, {})).status, 200);
  assert.equal(sqlite.prepare('SELECT COUNT(*) c FROM po_receipt_lots WHERE po_id=? AND voided_at IS NULL').get(po.id).c, 0);
  assert.equal(await stockOf('G3 NXT 나이트릴'), before - 30);
});

test('Other receipt lines: one record per LOT with warehouse and location; replay and LOT numbers', async () => {
  const w = await admin('POST', '/api/warehouses', { name: '5동', locations: '5동 1층, 5동 2층' });
  assert.equal(w.status, 200); assert.equal(w.body.locations, '5동 1층,5동 2층');
  assert.equal((await staff('POST', '/api/warehouses', { name: '6동' })).status, 403, 'only the logistics lead or admin');
  const token = rid();
  const body = { receipt_date: today, vendor: '마스크상사', note: '샘플 입고', request_id: token, lines: [
    { bom_id: mask.id, lot: 'L1', qty: 5, warehouse: '5동', location: '5동 1층' }, { bom_id: mask.id, lot: 'L2', qty: 7, warehouse: '5동', location: '5동 2층', note: '박스 파손' }] };
  assert.match((await staff('POST', '/api/receipts', { ...body, request_id: rid(), lines: [{ ...body.lines[0], location: '9층' }] })).body.error, /없는 위치/);
  assert.match((await staff('POST', '/api/receipts', { ...body, request_id: rid(), lines: [{ ...body.lines[0], warehouse: '없는창고' }] })).body.error, /등록되지 않은 창고/);
  const r = await staff('POST', '/api/receipts', body);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.lines.map(l => [l.kind, l.item, l.lot, l.qty, l.unit, l.warehouse, l.location, l.note]), [['other', '마스크', 'L1', 5, 'EA', '5동', '5동 1층', '샘플 입고'], ['other', '마스크', 'L2', 7, 'EA', '5동', '5동 2층', '박스 파손']]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) c FROM requests WHERE source_type='other_receipt' AND source_id IN (SELECT id FROM other_receipts WHERE receipt_id=?)").get(r.body.id).c, 2, 'one inspection per LOT');
  const again = await staff('POST', '/api/receipts', body);
  assert.equal(again.body.duplicate, true); assert.equal(again.body.id, r.body.id);
  assert.equal((await admin('POST', '/api/receipts', body)).status, 409, 'someone else cannot reuse the request id');
  const next = (await staff('GET', `/api/lots/next?prefix=L&date=${today}&count=2`)).body.lots;
  const head = `L${today.slice(2).replace(/-/g, '')}_`;
  assert.deepEqual(next, [head + '001', head + '002']);
  await staff('POST', '/api/receipts', { receipt_date: today, vendor: '마스크상사', request_id: rid(), lines: [{ bom_id: mask.id, lot: head + '001', qty: 1 }] });
  assert.deepEqual((await staff('GET', `/api/lots/next?prefix=L&date=${today}&count=1`)).body.lots, [head + '002']);
  // 창고 이름 변경은 기록에도 반영
  assert.equal((await admin('PUT', `/api/warehouses/${w.body.id}`, { name: '5동(본관)' })).status, 200);
  assert.equal((await staff('GET', `/api/receipts/${r.body.id}`)).body.lines[0].warehouse, '5동(본관)');
});

test('A receipt racing another change to the same order is rolled back entirely', async () => {
  const po = await order(10);
  const original = env.DB;
  env.DB = { ...original, async batch(statements) { env.DB = original; sqlite.prepare("UPDATE purchase_orders SET recv_status='checking' WHERE id=?").run(po.id); return original.batch(statements); } };
  try {
    const r = await staff('POST', '/api/receipts', { receipt_date: today, vendor: '에스케이', request_id: rid(), lines: [{ bom_id: mask.id, lot: 'Z', qty: 1 }, { po_id: po.id, lot: 'Y', qty: 3 }] });
    assert.equal(r.status, 409, JSON.stringify(r.body));
  } finally { env.DB = original; }
  assert.equal(sqlite.prepare("SELECT COUNT(*) c FROM other_receipts WHERE lot='Z'").get().c, 0, 'nothing from the failed receipt is kept');
  assert.equal(sqlite.prepare('SELECT COUNT(*) c FROM po_receipt_lots WHERE po_id=?').get(po.id).c, 0);
});

test('LOT stock: received per LOT minus shipments of the same LOT', async () => {
  const po = await order(30, 'LOT상사');
  await staff('POST', '/api/receipts', { receipt_date: today, vendor: 'LOT상사', request_id: rid(), lines: [{ po_id: po.id, lot: 'LS-1', qty: 10 }, { po_id: po.id, lot: 'LS-2', qty: 20 }] });
  await admin('POST', '/api/shipments', { ship_date: today, item: 'G3 NXT 나이트릴', bom_id: glove.id, qty: 4, customer: '고객', lot: 'LS-1' });
  const all = (await staff('GET', '/api/inventory/lots?q=LS-')).body.rows;
  assert.deepEqual(all.map(r => [r.lot, r.received, r.shipped, r.balance, r.unit]), [['LS-1', 10, 4, 6, 'BOX'], ['LS-2', 20, 0, 20, 'BOX']]);
  await admin('POST', '/api/shipments', { ship_date: today, item: 'G3 NXT 나이트릴', bom_id: glove.id, qty: 20, customer: '고객', lot: 'LS-2' });
  assert.deepEqual((await staff('GET', '/api/inventory/lots?q=LS-&state=instock')).body.rows.map(r => r.lot), ['LS-1']);
});
