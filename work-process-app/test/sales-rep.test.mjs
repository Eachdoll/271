// 15.224 영업담당자: 전표마다 담당자, 거래처 기본 담당자, 담당자별 담당업체 현황, 달력·목록 거르기
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rep-'));
const { env, sqlite } = localEnvironment(dir, 'rep-test');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await worker.fetch(new Request('https://rep.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}
const admin = client(), staff = client();
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const bill = (customer, price, extra = {}) => admin('POST', '/api/sales-bills', { request_id: crypto.randomUUID(), customer, bill_date: today, lines: [{ source_type: 'manual', item: '와이퍼', qty: 1, unit_price: price }], ...extra });
before(async () => {
  await approvedRegistration(admin, admin, { name: '관리자', password: 'password', invite: 'rep-test' });
  await approvedRegistration(admin, staff, { name: '직원', password: 'password', invite: 'rep-test' });
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('Sales rep per bill, vendor default rep, per-rep customer summary and filters', async () => {
  const a = await admin('POST', '/api/vendors', { name: '가나상사', is_sales: true, sales_rep: '박정현' });
  assert.equal(a.body.sales_rep, '박정현');
  await admin('POST', '/api/vendors', { name: '다라전자', is_sales: true, sales_rep: '박정현' }); // 매출 없는 담당 거래처
  await admin('POST', '/api/vendors', { name: '마바산업', is_sales: true });
  const b1 = await bill('가나상사', 1000); assert.equal(b1.status, 200, JSON.stringify(b1.body));
  assert.equal(b1.body.sales_rep, '박정현', 'empty rep takes the customer default');
  const b2 = await bill('마바산업', 2000, { sales_rep: '송은아' }); assert.equal(b2.body.sales_rep, '송은아');
  const b3 = await bill('마바산업', 500); assert.equal(b3.body.sales_rep, '', 'no default → empty');
  // 목록 거르기
  const list = rep => admin('GET', '/api/sales-bills?rep=' + encodeURIComponent(rep));
  assert.deepEqual((await list('박정현')).body.rows.map(r => r.customer), ['가나상사']);
  assert.deepEqual((await list('미지정')).body.rows.map(r => r.id), [b3.body.id]);
  assert.equal((await list('송은아')).body.rows[0].rep, '송은아');
  // 거래처 담당자를 나중에 정하면 빈 전표는 그 담당자로 집계(전표 값은 그대로)
  const vm = (await admin('GET', '/api/vendors?q=마바')).body[0];
  assert.equal((await admin('PUT', `/api/vendors/${vm.id}`, { name: '마바산업', sales_rep: '송은아' })).body.sales_rep, '송은아');
  assert.deepEqual((await list('송은아')).body.rows.map(r => r.id).sort(), [b2.body.id, b3.body.id].sort());
  assert.equal((await admin('PUT', `/api/vendors/${vm.id}`, { name: '마바산업' })).body.sales_rep, '송은아', 'omitted rep keeps the value');
  // 전표 담당자 바꾸기(이력)
  const ch = await admin('PUT', `/api/sales-bills/${b1.body.id}/rep`, { sales_rep: '송은아' });
  assert.equal(ch.status, 200); assert.equal(ch.body.sales_rep, '송은아'); assert.match(ch.body.changes[0].summary, /영업담당자 박정현→송은아/);
  assert.equal((await staff('PUT', `/api/sales-bills/${b1.body.id}/rep`, { sales_rep: 'x' })).status, 403, 'needs sales role');
  // 담당자별 현황
  const s = (await admin('GET', `/api/sales-reps/summary?from=${today}&to=${today}`)).body;
  const g = Object.fromEntries(s.reps.map(r => [r.rep, r]));
  assert.equal(g['송은아'].total, 1100 + 2200 + 550); assert.equal(g['송은아'].n, 3);
  assert.equal(g['박정현'].n, 0); assert.equal(g['박정현'].customers, 2, 'assigned customers show without sales');
  const row = s.rows.find(r => r.rep === '박정현' && r.customer === '다라전자'); assert.ok(row && row.assigned && row.total === 0);
  assert.equal(s.rows.find(r => r.customer === '가나상사' && r.rep === '송은아').balance, 1100);
  const only = (await admin('GET', '/api/sales-reps/summary?rep=' + encodeURIComponent('박정현'))).body;
  assert.deepEqual(only.reps.map(r => r.rep), ['박정현']);
  // 고를 수 있는 이름, 달력 거르기
  assert.deepEqual((await admin('GET', '/api/sales-reps')).body.reps, ['박정현', '송은아']);
  const cal = (await admin('GET', `/api/sales-calendar?month=${today.slice(0, 7)}&rep=${encodeURIComponent('송은아')}`)).body;
  assert.equal(cal.totals.n, 3);
  assert.equal((await admin('GET', `/api/sales-calendar?month=${today.slice(0, 7)}&rep=${encodeURIComponent('박정현')}`)).body.totals.n, 0);
});
