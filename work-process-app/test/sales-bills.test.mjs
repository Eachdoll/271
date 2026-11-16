// 15.81 매출전표·입금·기간별 거래보고·매출 마감: 전표 없는 출하·직접 줄, 금액(절사·부가세 줄 배분), 중복 방지, 권한, 취소, 원장 잔액, 마감, 출하 수정 막기
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb81-'));
const { env, sqlite } = localEnvironment(dir, 'sb81-test');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await worker.fetch(new Request('https://sb81.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}
const admin = client(), seller = client(), staff = client();
const ids = {};
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const lastMonth = (() => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
const rid = () => crypto.randomUUID();
before(async () => {
  for (const [c, name] of [[admin, '관리자'], [seller, '영업'], [staff, '물류']]) await approvedRegistration(admin, c, { name, password: 'password', invite: 'sb81-test' });
  for (const u of (await admin('GET', '/api/admin/users')).body) ids[u.name] = u.id;
  assert.equal((await admin('PUT', `/api/admin/users/${ids['영업']}`, { roles: ['sales'] })).status, 200);
  await admin('PUT', `/api/admin/users/${ids['물류']}`, { roles: ['logistics'] });
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const ship = async (customer, item, qty, date = today) => (await staff('POST', '/api/shipments', { ship_date: date, item, qty, customer, unit: 'BOX' })).body;

test('Unbilled shipments, manual lines, amounts with per-line VAT, duplicate guard, locks, cancel', async () => {
  const s1 = await ship('세흥상사', 'CF707', 4), s2 = await ship('세흥상사', 'CF708', 3), other = await ship('다른상사', 'CF707', 1);
  assert.equal((await staff('GET', '/api/sales-bills/unbilled?customer=세흥상사')).status, 403, 'sales role only');
  const list = (await seller('GET', '/api/sales-bills/unbilled?customer=' + encodeURIComponent('세흥 상사'))).body;
  assert.deepEqual(list.rows.map(r => r.source_id), [s1.id, s2.id]); assert.equal(list.rows[0].last_price, null);
  const bad = await seller('POST', '/api/sales-bills', { customer: '세흥상사', bill_date: today, request_id: rid(), lines: [{ source_type: 'ship', source_id: other.id, unit_price: 1 }] });
  assert.equal(bad.status, 400); assert.match(bad.body.error, /다른 거래처/);
  assert.equal((await seller('POST', '/api/sales-bills', { customer: '세흥상사', bill_date: today, request_id: rid(), lines: [{ source_type: 'ship', source_id: s1.id }] })).status, 400, 'price required');
  const token = rid();
  const body = { customer: '세흥상사', bill_date: today, request_id: token, note: '1월분', lines: [{ source_type: 'ship', source_id: s1.id, unit_price: 155000 }, { source_type: 'ship', source_id: s2.id, unit_price: 333.3 }, { source_type: 'manual', item: '운반비', qty: 1, unit: '식', unit_price: 5555 }] };
  const r = await seller('POST', '/api/sales-bills', body);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // 620000 + trunc(999.9)=999 + 5555 = 626554, VAT 62655 → 줄 62000 + 99 + 555 = 62654, 차이 1은 가장 큰 줄에
  assert.match(r.body.bill_no, /^SB-\d{6}-01$/); assert.equal(r.body.supply_total, 626554); assert.equal(r.body.vat_total, 62655); assert.equal(r.body.total, 689209);
  assert.deepEqual(r.body.lines.map(l => l.vat), [62001, 99, 555]);
  assert.equal((await seller('POST', '/api/sales-bills', body)).body.duplicate, true);
  assert.equal((await seller('POST', '/api/sales-bills', { ...body, request_id: rid() })).status, 409, 'same shipment twice');
  assert.equal((await seller('GET', '/api/sales-bills/unbilled?customer=세흥상사')).body.rows.length, 0);
  // 다음 출하는 지난 단가가 미리 들어간다
  await ship('세흥상사', 'CF707', 2);
  assert.equal((await seller('GET', '/api/sales-bills/unbilled?customer=세흥상사')).body.rows[0].last_price, 155000);
  // 전표에 들어간 출하는 수정·삭제 막힘
  assert.equal((await staff('PUT', `/api/shipments/${s1.id}`, { ship_date: today, item: 'CF707', qty: 5, customer: '세흥상사' })).status, 409);
  assert.equal((await staff('DELETE', `/api/shipments/${s1.id}`)).status, 409);
  assert.equal((await staff('PUT', `/api/items/shipment/${s1.id}`, { unit: 'EA' })).status, 409);
  // 영세 + 취소
  const zero = await seller('POST', '/api/sales-bills', { customer: '다른상사', bill_date: today, tax_type: 'zero', request_id: rid(), lines: [{ source_type: 'ship', source_id: other.id, unit_price: 1000.9 }] });
  assert.equal(zero.body.vat_total, 0); assert.equal(zero.body.total, 1000);
  assert.equal((await seller('POST', `/api/sales-bills/${zero.body.id}/cancel`, {})).status, 400, 'reason required');
  const cancelled = await seller('POST', `/api/sales-bills/${zero.body.id}/cancel`, { reason: '단가 오류' });
  assert.equal(cancelled.body.status, 'cancelled'); assert.equal(cancelled.body.lines[0].active, 0);
  assert.equal((await staff('DELETE', `/api/shipments/${other.id}`)).status, 200, 'unlocked after cancel');
  const listed = (await seller('GET', '/api/sales-bills?status=confirmed')).body.rows;
  assert.equal(listed.length, 1); assert.equal(listed[0].line_count, 3);
});

test('Payments, opening balance and the period ledger with running balance; Excel lines', async () => {
  const pay = { customer: '세흥상사', pay_date: today, amount: 600000, method: '기업은행', request_id: rid() };
  assert.equal((await staff('POST', '/api/sales-payments', pay)).status, 403);
  const p = await seller('POST', '/api/sales-payments', pay); assert.equal(p.status, 200);
  assert.equal((await seller('POST', '/api/sales-payments', pay)).body.duplicate, true);
  assert.equal((await seller('POST', '/api/sales-payments', { ...pay, request_id: rid(), amount: 0 })).status, 400);
  await seller('POST', '/api/sales-payments', { customer: '세흥상사', pay_date: lastMonth + '-05', kind: 'opening', amount: 100000, request_id: rid() });
  const ledger = (await seller('GET', `/api/sales-ledger?customer=${encodeURIComponent('세흥상사')}&from=${today}&to=${today}`)).body;
  assert.equal(ledger.opening, 100000);
  assert.deepEqual(ledger.rows.map(r => r.kind), ['payment', 'sale', 'sale', 'sale']);
  assert.equal(ledger.rows[0].balance, -500000); assert.equal(ledger.rows.at(-1).balance, 189209);
  assert.equal(ledger.totals.sale, 689209); assert.equal(ledger.totals.paid, 600000);
  const summary = (await seller('GET', `/api/sales-ledger?from=${lastMonth}-01&to=${today}`)).body.rows;
  const row = summary.find(r => r.customer === '세흥상사');
  assert.deepEqual([row.opening, row.total, row.paid, row.balance], [100000, 689209, 600000, 189209]);
  const xl = (await seller('GET', `/api/bill-lines?side=sales&from=${today}&to=${today}`)).body.rows;
  assert.equal(xl.length, 3); assert.equal(xl[0].vat, 62001);
  assert.equal((await seller('GET', `/api/bill-lines?side=purchase&from=${today}&to=${today}`)).status, 403);
  const cancel = await seller('POST', `/api/sales-payments/${p.body.id}/cancel`, { reason: '중복' });
  assert.equal(cancel.body.status, 'cancelled');
  assert.equal((await seller('GET', `/api/sales-payments?status=confirmed`)).body.rows.length, 1);
});

test('Monthly sales closing locks bills and payments of that month; admin reopens', async () => {
  const s = await ship('마감상사', 'CF900', 1, lastMonth + '-10');
  const b = (await seller('POST', '/api/sales-bills', { customer: '마감상사', bill_date: lastMonth + '-20', request_id: rid(), lines: [{ source_type: 'ship', source_id: s.id, unit_price: 1000 }] })).body;
  await seller('POST', '/api/sales-payments', { customer: '마감상사', pay_date: lastMonth + '-25', amount: 1100, request_id: rid() });
  const view = (await seller('GET', '/api/sales-closing?period=' + lastMonth)).body;
  const row = view.rows.find(r => r.customer === '마감상사');
  assert.deepEqual([row.bill_count, row.total, row.payment_total, row.closing], [1, 1100, 1100, null]);
  assert.equal((await seller('POST', '/api/sales-closing', { period: today.slice(0, 7), customer: '마감상사' })).status, 400, 'current month');
  assert.equal((await seller('POST', '/api/sales-closing', { period: lastMonth, customer: '마감상사' })).status, 200);
  assert.equal((await seller('POST', '/api/sales-closing', { period: lastMonth, customer: '마감상사' })).status, 409);
  assert.equal((await seller('POST', `/api/sales-bills/${b.id}/cancel`, { reason: 'x' })).status, 400);
  assert.equal((await seller('POST', '/api/sales-payments', { customer: '마감상사', pay_date: lastMonth + '-26', amount: 1, request_id: rid() })).status, 400);
  assert.equal((await seller('GET', `/api/sales-bills/${b.id}`)).body.closed, true);
  assert.equal((await seller('POST', '/api/sales-closing/reopen', { period: lastMonth, customer: '마감상사' })).status, 403);
  assert.equal((await admin('POST', '/api/sales-closing/reopen', { period: lastMonth, customer: '마감상사' })).status, 200);
  assert.equal((await seller('POST', `/api/sales-bills/${b.id}/cancel`, { reason: '정정' })).status, 200);
});
