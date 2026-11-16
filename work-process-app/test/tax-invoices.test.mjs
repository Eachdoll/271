// 15.83 세금계산서: 사업자 정보, 건별·월별 담기, 한 전표 한 계산서, 고치기(이메일 2개), 담기 취소, 전표 취소 잠금, 발행 전 점검·연동 미연결 409
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ti83-'));
const { env, sqlite } = localEnvironment(dir, 'ti83-test');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await worker.fetch(new Request('https://ti83.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}
const admin = client(), seller = client(), staff = client();
const ids = {};
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const month = today.slice(0, 7), first = month + '-01';
const rid = () => crypto.randomUUID();
before(async () => {
  for (const [c, name] of [[admin, '관리자'], [seller, '영업'], [staff, '물류']]) await approvedRegistration(admin, c, { name, password: 'password', invite: 'ti83-test' });
  for (const u of (await admin('GET', '/api/admin/users')).body) ids[u.name] = u.id;
  await admin('PUT', `/api/admin/users/${ids['영업']}`, { roles: ['sales'] });
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const bill = async (customer, item, qty, price) => {
  const s = (await staff('POST', '/api/shipments', { ship_date: first, item, qty, customer, unit: 'BOX' })).body;
  return (await seller('POST', '/api/sales-bills', { customer, bill_date: first, request_id: rid(), lines: [{ source_type: 'ship', source_id: s.id, unit_price: price }] })).body;
};

test('Business info for the company (admin) and customers, with validation', async () => {
  assert.equal((await seller('PUT', '/api/tax-company', { biz_no: '1234567890' })).status, 403);
  assert.equal((await admin('PUT', '/api/tax-company', { biz_no: '123' })).status, 400);
  const c = await admin('PUT', '/api/tax-company', { biz_no: '1234567890', biz_name: '(주)서울세미텍', ceo: '대표', address: '경기', biz_type: '제조', biz_item: '장갑', email: 'tax@semi.test' });
  assert.equal(c.body.biz_no, '123-45-67890');
  assert.equal((await seller('GET', '/api/tax-company')).body.biz_name, '(주)서울세미텍');
  await staff('POST', '/api/shipments', { ship_date: first, item: 'X', qty: 1, customer: '세흥상사' }); // 거래처 자동 등록
  const v = (await admin('GET', '/api/vendors?q=' + encodeURIComponent('세흥상사'))).body[0];
  assert.equal((await seller('PUT', `/api/vendors/${v.id}/tax-info`, { tax_email: 'bad' })).status, 400);
  const saved = await seller('PUT', `/api/vendors/${v.id}/tax-info`, { biz_no: '222-33-44444', biz_name: '세흥상사', ceo: '김대표', address: '서울', biz_type: '도소매', biz_item: '장갑', tax_email: 'a@sh.test', tax_email2: 'b@sh.test' });
  assert.equal(saved.status, 200); assert.equal(saved.body.biz_no, '222-33-44444'); assert.equal(saved.body.tax_email2, 'b@sh.test');
});

test('Single and monthly invoices; one bill in one invoice; edit, cancel, locks; issue checks and unlinked 409', async () => {
  const b1 = await bill('세흥상사', 'CF707', 4, 155000), b2 = await bill('세흥상사', 'CF708', 2, 1000), b3 = await bill('세흥상사', 'CF709', 1, 500);
  const cand = (await seller('GET', `/api/tax-invoices/candidates?from=${first}&to=${today}`)).body;
  const row = cand.customers.find(c => c.customer === '세흥상사');
  assert.deepEqual([row.bills, row.total, row.biz_no, row.tax_email], [3, 682000 + 2200 + 550, '222-33-44444', 'a@sh.test']);
  // 건별
  const single = await seller('POST', '/api/tax-invoices', { kind: 'single', bill_ids: [b1.id], request_id: rid() });
  assert.equal(single.status, 200, JSON.stringify(single.body));
  const inv1 = single.body.rows[0];
  assert.deepEqual([inv1.kind, inv1.write_date, inv1.total, inv1.email1, inv1.email2, inv1.biz_no, inv1.item_summary], ['single', first, 682000, 'a@sh.test', 'b@sh.test', '222-33-44444', 'CF707']);
  assert.match(inv1.invoice_no, /^TI-\d{6}-01$/);
  assert.equal((await seller('POST', '/api/tax-invoices', { kind: 'single', bill_ids: [b1.id], request_id: rid() })).status, 409, 'one bill, one invoice');
  // 월별: 남은 2건이 한 장
  const monthly = await seller('POST', '/api/tax-invoices', { kind: 'monthly', customer: '세흥상사', from: first, to: today, request_id: rid(), email2: '' });
  assert.equal(monthly.status, 200, JSON.stringify(monthly.body));
  const inv2 = monthly.body.rows[0];
  assert.deepEqual([inv2.kind, inv2.write_date, inv2.total, inv2.email2, inv2.item_summary], ['monthly', today, 2750, '', 'CF708 외 1건']);
  const detail = (await seller('GET', `/api/tax-invoices/${inv2.id}`)).body;
  assert.equal(detail.items.length, 2); assert.equal(detail.bills.length, 2); assert.equal(detail.company.biz_no, '123-45-67890');
  assert.equal((await seller('POST', '/api/tax-invoices', { kind: 'monthly', customer: '세흥상사', from: first, to: today, request_id: rid() })).status, 400, 'nothing left');
  // 고치기: 이메일 2개
  assert.equal((await seller('PUT', `/api/tax-invoices/${inv2.id}`, { email2: 'nope' })).status, 400);
  const edited = await seller('PUT', `/api/tax-invoices/${inv2.id}`, { email1: 'x@sh.test', email2: 'y@sh.test', charge: 'receipt' });
  assert.deepEqual([edited.body.email1, edited.body.email2, edited.body.charge], ['x@sh.test', 'y@sh.test', 'receipt']);
  // 담긴 전표는 취소 막힘
  const locked = await seller('POST', `/api/sales-bills/${b2.id}/cancel`, { reason: 'x' });
  assert.equal(locked.status, 409); assert.match(locked.body.error, /담기 취소/);
  // 목록
  const list = (await seller('GET', '/api/tax-invoices')).body;
  assert.equal(list.rows.length, 2); assert.equal(list.linked, false);
  // 발행: 연동 미연결이면 409(분명히 막음), 점검 실패면 400
  const noLink = await seller('POST', '/api/tax-invoices/issue', { ids: [inv1.id, inv2.id] });
  assert.equal(noLink.status, 409); assert.match(noLink.body.error, /트러스빌 연동이 아직 연결되지/);
  assert.equal((await seller('GET', `/api/tax-invoices/${inv1.id}`)).body.status, 'draft');
  const other = await bill('정보없는상사', 'CF1', 1, 100);
  const inv3 = (await seller('POST', '/api/tax-invoices', { kind: 'single', bill_ids: [other.id], request_id: rid() })).body.rows[0];
  const check = await seller('POST', '/api/tax-invoices/issue', { ids: [inv3.id] });
  assert.equal(check.status, 400); assert.match(check.body.error, /거래처 사업자번호/); assert.match(check.body.error, /받는 이메일 1/);
  // 담기 취소 → 전표 다시 담을 수 있음, 전표 취소 가능
  assert.equal((await seller('POST', `/api/tax-invoices/${inv2.id}/cancel`, {})).status, 200);
  assert.equal((await seller('GET', '/api/tax-invoices?status=cancelled')).body.rows.length, 1);
  assert.equal((await seller('POST', `/api/sales-bills/${b3.id}/cancel`, { reason: '정정' })).status, 200);
  const again = await seller('POST', '/api/tax-invoices', { kind: 'monthly', customer: '세흥상사', from: first, to: today, request_id: rid() });
  assert.equal(again.body.rows[0].total, 2200);
  // 연동이 연결되면 발행 요청(queued), 그 뒤엔 고치기·담기 취소 불가
  sqlite.prepare("INSERT INTO settings(key,value) VALUES('tax_link','test')").run();
  const issued = await seller('POST', '/api/tax-invoices/issue', { ids: [inv1.id] });
  assert.equal(issued.status, 200); assert.equal(issued.body.queued, 1);
  assert.equal((await seller('PUT', `/api/tax-invoices/${inv1.id}`, { email1: 'z@sh.test' })).status, 400);
  assert.equal((await seller('POST', `/api/tax-invoices/${inv1.id}/cancel`, {})).status, 400);
  assert.equal((await staff('GET', '/api/tax-invoices')).status, 403);
});
