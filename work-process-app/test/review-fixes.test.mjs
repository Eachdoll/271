// Regressions found in the multi-item / actuals review.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-fixes-'));
const { env, sqlite } = localEnvironment(dir, 'review-test');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await worker.fetch(new Request('https://review.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}
const admin = client(), staff = client(), quality = client(), approver = client();
const seoulToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
before(async () => {
  await approvedRegistration(admin, admin, { name: '관리자', password: 'password', invite: 'review-test' });
  await approvedRegistration(admin, staff, { name: '직원', password: 'password', invite: 'review-test' });
  await approvedRegistration(admin, quality, { name: '품질담당', password: 'password', invite: 'review-test' });
  await approvedRegistration(admin, approver, { name: '품질책임', password: 'password', invite: 'review-test' });
  const users = (await admin('GET', '/api/admin/users')).body;
  await admin('PUT', `/api/admin/users/${users.find(u => u.name === '품질담당').id}`, { roles: ['quality'] });
  await admin('PUT', `/api/admin/users/${users.find(u => u.name === '품질책임').id}`, { roles: ['quality_approver'] });
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('Retrying a common-photo upload for a new line with revision 0 cannot attach the photos twice', async () => {
  const row = (await staff('POST', '/api/batches/purchase_order', { common: { req_no: 'PR-R', vendor: 'V', due_date: '2026-11-20' }, items: [{ item: '글러브', qty: 5, item_category: '원자재' }], request_id: crypto.randomUUID() })).body.rows[0];
  assert.equal((await staff('PUT', `/api/attachments/purchase_order/${row.id}`, { photos: [png], revision: 0 })).status, 200);
  assert.equal((await staff('PUT', `/api/attachments/purchase_order/${row.id}`, { photos: [png], revision: 0 })).status, 409);
  assert.equal((await staff('GET', `/api/attachments/purchase_order/${row.id}`)).body.photos.length, 1);
});

test('Before approval only the requester or an approver can delete a request', async () => {
  const make = async () => (await staff('POST', '/api/requests', { type: 'analysis', title: '시료', category: '수입검사' })).body.id;
  const a = await make();
  assert.equal((await quality('DELETE', `/api/requests/${a}`)).status, 403);
  assert.equal((await approver('DELETE', `/api/requests/${a}`)).status, 200);
  const b = await make();
  assert.equal((await staff('DELETE', `/api/requests/${b}`)).status, 200);
  const c = await make();
  await approver('POST', `/api/requests/${c}/approve`);
  assert.equal((await quality('DELETE', `/api/requests/${c}`)).status, 200, 'approved work keeps the team-role rule');
});

test('Editing a receipt-created analysis keeps the received item, vendor, quantity and LOT', async () => {
  const po = (await staff('POST', '/api/batches/purchase_order', { common: { req_no: 'PR-S', vendor: '공급사', due_date: '2026-11-20' }, items: [{ item: '원단', spec: 'M', unit: 'kg', lot: 'L1', qty: 7, item_category: '원자재' }], request_id: crypto.randomUUID() })).body.rows[0];
  await staff('POST', '/api/po/receive', { ids: [po.id], status: 'ok' });
  const analysis = (await quality('GET', '/api/requests?type=analysis&scope=list')).body.find(r => r.source_id === po.id);
  const edited = await quality('PUT', `/api/requests/${analysis.id}`, { title: '다른 품목', customer: '다른 거래처', category: '수입검사', data: { ...analysis.data, sample_qty: '999', lot_etc: 'X', extra: '검사 메모' } });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.title, '원단'); assert.equal(edited.body.customer, '공급사');
  assert.equal(edited.body.qty, 7); assert.equal(edited.body.data.sample_qty, analysis.data.sample_qty); assert.equal(edited.body.data.lot_etc, 'L1');
  assert.equal(edited.body.data.extra, '검사 메모', 'inspection notes stay editable');
});

test('Actuals cannot be dated in the future; LOT can still be recorded after production starts', async () => {
  const today = seoulToday();
  const plan = (await staff('POST', '/api/batches/schedule', { common: { kind: 'finished', period: 'day', start_date: today }, items: [{ item: '완제품', spec: 'M', unit: 'BOX', qty: 10 }], request_id: crypto.randomUUID() })).body.rows[0];
  assert.equal((await staff('POST', `/api/schedules/${plan.id}/actuals`, { production_date: today, qty: 4, request_id: crypto.randomUUID() })).status, 200);
  const nextMonth = new Date(today + 'T00:00:00Z'); nextMonth.setUTCDate(1); nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const future = (await staff('POST', '/api/schedules', { kind: 'finished', period: 'month', start_date: nextMonth.toISOString().slice(0, 10), product: '다음달', qty: 1 })).body;
  const rejected = await staff('POST', `/api/schedules/${future.id}/actuals`, { production_date: future.start_date, qty: 1, request_id: crypto.randomUUID() });
  assert.equal(rejected.status, 400); assert.match(rejected.body.error, /지나지 않은 날짜/);
  assert.equal((await staff('PUT', `/api/items/schedule/${plan.id}`, { spec: 'M', unit: 'BOX', lot: 'PROD-LOT-1' })).body.lot, 'PROD-LOT-1');
  assert.equal((await staff('PUT', `/api/items/schedule/${plan.id}`, { spec: 'L', unit: 'BOX', lot: 'PROD-LOT-1' })).status, 400);
});

test('A malformed URL is a 400, not a server error', async () => {
  assert.equal((await staff('GET', '/api/po/%E0%A4%A')).status, 400);
});
