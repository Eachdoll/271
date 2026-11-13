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

test('Receipt actions by anyone leave a permanent named trail, and a quantity mismatch still creates the inspection', async () => {
  const po = (await staff('POST', '/api/batches/purchase_order', { common: { req_no: 'PR-T', vendor: '공급사', due_date: '2026-11-20' }, items: [{ item: '트레일', qty: 12, item_category: '원자재' }], request_id: crypto.randomUUID() })).body.rows[0];
  const r = await staff('POST', '/api/po/receive', { ids: [po.id], status: 'mismatch', recv_qty: 9, note: '3개 부족' });
  assert.equal(r.body.analysis_created, 1);
  const analysis = (await staff('GET', '/api/requests?type=analysis&scope=list')).body.find(x => x.source_id === po.id);
  assert.equal(analysis.qty, 9); assert.equal(analysis.data.received_qty, 9);
  const closed = await quality('POST', '/api/po/receive', { ids: [po.id], status: 'ok' });
  assert.equal(closed.status, 200); assert.equal(closed.body.analysis_created, 0);
  const row = (await staff('GET', '/api/po')).body.find(p => p.id === po.id);
  assert.equal(row.recv_status, 'ok'); assert.equal(row.recv_qty, 9, 'closing a short receipt keeps the quantity actually received');
  const trail = (await staff('GET', `/api/comments/purchase_order/${po.id}`)).body.rows.map(c => [c.author_name, c.content]);
  assert.deepEqual(trail.map(t => t[0]), ['품질담당', '직원']);
  assert.match(trail[1][1], /미입고 → 수량상이 · 실입고 9 \(발주 12\) · 3개 부족/);
  assert.match(trail[0][1], /수량상이 → 입고완료 · 수량상이 종결 · 실입고 9 \(발주 12\)/);
});

test('Correcting or cancelling a recorded actual needs the production team lead; zero quantities are allowed', async () => {
  const users = (await admin('GET', '/api/admin/users')).body;
  const lead = client(), worker2 = client();
  await approvedRegistration(admin, lead, { name: '생산팀장', password: 'password', invite: 'review-test' });
  await approvedRegistration(admin, worker2, { name: '생산직원', password: 'password', invite: 'review-test' });
  const all = (await admin('GET', '/api/admin/users')).body;
  await admin('PUT', `/api/admin/users/${all.find(u => u.name === '생산팀장').id}`, { roles: ['production_approver'] });
  await admin('PUT', `/api/admin/users/${all.find(u => u.name === '생산직원').id}`, { roles: ['production'] });
  assert.ok(users.length < all.length);
  const plan = (await worker2('POST', '/api/schedules', { kind: 'semi', period: 'month', start_date: '2026-10-01', product: '반제품', qty: 100 })).body;
  const endpoint = `/api/schedules/${plan.id}/actuals`;
  const zero = await worker2('POST', endpoint, { production_date: '2026-10-03', qty: 0, request_id: crypto.randomUUID() });
  assert.equal(zero.status, 200);
  const actual = (await worker2('POST', endpoint, { production_date: '2026-10-05', qty: 40, note: '1차', request_id: crypto.randomUUID() })).body;

  const key = crypto.randomUUID();
  const req = await worker2('POST', `${endpoint}/${actual.id}/changes`, { production_date: '2026-10-06', qty: 0, note: '정정', reason: '날짜·수량 오기', request_id: key });
  assert.equal(req.status, 200); assert.equal(req.body.pending, true);
  assert.equal((await worker2('POST', `${endpoint}/${actual.id}/changes`, { production_date: '2026-10-06', qty: 0, note: '정정', reason: '날짜·수량 오기', request_id: key })).body.change.id, req.body.change.id, 'retry is idempotent');
  assert.equal((await worker2('GET', endpoint)).body.actual_qty, 40, 'unchanged until approved');
  assert.equal((await worker2('POST', `${endpoint}/${actual.id}/void`, { reason: '중복' })).status, 409, 'one pending request per actual');
  assert.equal((await worker2('POST', `/api/actual-changes/${req.body.change.id}/approve`, {})).status, 403, 'production staff cannot approve');
  assert.equal((await staff('POST', `${endpoint}/${actual.id}/changes`, { qty: 1, reason: 'x' })).status, 403, 'only actual writers can request');
  const approved = await lead('POST', `/api/actual-changes/${req.body.change.id}/approve`, { note: '확인' });
  assert.equal(approved.status, 200); assert.equal(approved.body.status, 'approved'); assert.equal(approved.body.reviewed_by, '생산팀장');
  assert.equal((await lead('POST', `/api/actual-changes/${req.body.change.id}/approve`, {})).status, 409);
  let log = (await worker2('GET', endpoint)).body;
  const edited = log.rows.find(r => r.id === actual.id);
  assert.equal(edited.production_date, '2026-10-06'); assert.equal(edited.qty, 0); assert.equal(edited.corrected_by, '생산팀장');
  assert.equal(log.actual_qty, 0); assert.equal(log.changes[0].old_qty, 40);

  const v = await worker2('POST', `${endpoint}/${zero.body.id}/void`, { reason: '잘못 입력' });
  assert.equal((await lead('POST', `/api/actual-changes/${v.body.change.id}/reject`, {})).status, 400, 'rejection needs a reason');
  assert.equal((await lead('POST', `/api/actual-changes/${v.body.change.id}/reject`, { note: '실제 생산 없음 기록 유지' })).status, 200);
  assert.equal((await worker2('GET', endpoint)).body.rows.find(r => r.id === zero.body.id).voided_at, null);
  const c = await worker2('POST', `${endpoint}/${zero.body.id}/changes`, { qty: 5, reason: '수량 정정' });
  assert.equal((await lead('POST', `/api/actual-changes/${c.body.change.id}/cancel`)).status, 403);
  assert.equal((await worker2('POST', `/api/actual-changes/${c.body.change.id}/cancel`)).status, 200);
  assert.equal((await worker2('GET', '/api/actual-changes?status=pending')).body.length, 0);
  const future = new Date(); future.setUTCDate(future.getUTCDate() + 40);
  assert.equal((await worker2('POST', `${endpoint}/${zero.body.id}/changes`, { production_date: future.toISOString().slice(0, 10), reason: '미래' })).status, 400);
  assert.equal((await worker2('POST', `${endpoint}/${zero.body.id}/changes`, { reason: '변경 없음' })).status, 400);
});
