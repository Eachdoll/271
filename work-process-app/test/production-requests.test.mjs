// 영업 → 생산 생산의뢰: 등록(사이즈별 줄), 생산 필요 수량, 생산계획 반영(일정 연결), 실적으로 진행·완료, 출고, 권한.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-'));
const { env, sqlite } = localEnvironment(dir, 'mr-test');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await worker.fetch(new Request('https://mr.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}
const admin = client(), sales = client(), prod = client(), other = client();
let glove, wiper, first;
before(async () => {
  await approvedRegistration(admin, admin, { name: '관리자', password: 'password', invite: 'mr-test' });
  await approvedRegistration(admin, sales, { name: '영업', password: 'password', invite: 'mr-test' });
  await approvedRegistration(admin, prod, { name: '생산', password: 'password', invite: 'mr-test' });
  await approvedRegistration(admin, other, { name: '타부서', password: 'password', invite: 'mr-test' });
  const users = (await admin('GET', '/api/admin/users')).body;
  await admin('PUT', `/api/admin/users/${users.find(u => u.name === '생산').id}`, { roles: ['production'] });
  glove = (await admin('POST', '/api/boms', { product: '습진장갑', product_code: 'GL-WET', item_category: '제품', kind: 'finished', base_qty: 1, unit: '켤레', materials: [{ item: '니트릴', item_category: '원자재', qty: 1, unit: 'g' }] })).body;
  wiper = (await admin('POST', '/api/boms', { product: 'NX709L', product_code: 'NX709L', item_category: '제품', kind: 'finished', base_qty: 1, unit: 'BOX', materials: [{ item: '원단', item_category: '원자재', qty: 1, unit: 'yd' }] })).body;
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('Sales registers an order with one line per size; the item code fills name and unit', async () => {
  const r = await sales('POST', '/api/production-requests', { order_date: '2026-11-13', customer: '하라다', order_no: 'ZEX-CT-J063', ship_text: '12월 초', ship_date: '2026-12-03', spec: '사이즈 도장 제외', request_id: 'mr-once-1',
    lines: [{ bom_id: glove.id, spec: 'S', qty: 10000 }, { bom_id: glove.id, spec: 'M', qty: 18500 }, { bom_id: glove.id, spec: 'L', qty: 9000 }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  first = r.body;
  assert.equal(first.req_no, 'MR-261113-01');
  assert.deepEqual(first.lines.map(l => [l.item, l.spec, l.unit, l.qty]), [['습진장갑', 'S', '켤레', 10000], ['습진장갑', 'M', '켤레', 18500], ['습진장갑', 'L', '켤레', 9000]]);
  assert.deepEqual([first.status, first.total_qty, first.can_plan, first.can_edit], ['waiting', 37500, false, true], 'sales cannot plan; the author can still edit');
  assert.equal((await sales('POST', '/api/production-requests', { order_date: '2026-11-13', customer: '하라다', lines: [{ bom_id: glove.id, qty: 1 }], request_id: 'mr-once-1' })).body.id, first.id, 'same request id → same order');
  const bad = async (body, pattern) => { const x = await sales('POST', '/api/production-requests', { order_date: '2026-11-13', customer: 'A', lines: [{ item: 'X', qty: 1 }], ...body }); assert.equal(x.status, 400); assert.match(x.body.error, pattern); };
  await bad({ customer: '' }, /업체/); await bad({ lines: [] }, /1개 이상/); await bad({ lines: [{ item: 'X', qty: 0 }] }, /0보다 커야/); await bad({ ship_date: '12월 초' }, /출고 희망일/);
  const vendors = (await sales('GET', '/api/vendors')).body;
  assert.ok(vendors.some(v => v.name === '하라다'), 'the customer joins the vendor list');
});

test('Production needs add up open quantities per item and size; production staff see a to-do', async () => {
  await sales('POST', '/api/production-requests', { order_date: '2026-11-11', customer: '네오지니', lines: [{ bom_id: wiper.id, qty: 20 }, { bom_id: glove.id, spec: 'S', qty: 500 }] });
  const needs = (await prod('GET', '/api/production-requests/needs')).body;
  const s = needs.find(n => n.item === '습진장갑' && n.spec === 'S');
  assert.deepEqual([s.ordered, s.need, s.unplanned, s.requests], [10500, 10500, 10500, 2]);
  assert.ok(needs.some(n => n.item === 'NX709L' && n.need === 20));
  const todo = (await prod('GET', '/api/my-tasks')).body.approvals.production_requests;
  assert.equal(todo.count, 2);
  assert.equal((await other('GET', '/api/my-tasks')).body.approvals.production_requests, undefined, 'only production sees the intake to-do');
});

test('Planning creates linked schedules for the open quantity once; actuals move the order to done', async () => {
  assert.equal((await sales('POST', `/api/production-requests/${first.id}/plan`, { period: 'week', start_date: '2026-11-16' })).status, 403);
  const planned = await prod('POST', `/api/production-requests/${first.id}/plan`, { period: 'week', start_date: '2026-11-11' });
  assert.equal(planned.status, 200, JSON.stringify(planned.body));
  assert.deepEqual([planned.body.status, planned.body.planned_total, planned.body.schedules.length, planned.body.can_plan, planned.body.can_edit], ['planned', 37500, 3, false, false]);
  const sched = planned.body.schedules[0];
  assert.deepEqual([sched.kind, sched.period, sched.start_date, sched.product, sched.spec, sched.qty], ['finished', 'week', '2026-11-09', '습진장갑', 'S', 10000], 'week plans start on Monday');
  const list = (await prod('GET', '/api/schedules?kind=finished&from=2026-11-09&to=2026-11-15')).body;
  const linked = list.find(x => x.id === sched.id);
  assert.match(linked.order_ref, /^MR-261113-01 · 하라다 · ZEX-CT-J063$/); assert.equal(linked.order_id, first.id);
  assert.match(linked.note, /생산의뢰 MR-261113-01/);
  assert.equal((await prod('POST', `/api/production-requests/${first.id}/plan`, { period: 'week', start_date: '2026-11-11' })).status, 400, 'nothing left to plan');
  assert.equal((await sales('PUT', `/api/production-requests/${first.id}`, { order_date: '2026-11-13', customer: '하라다', lines: [{ item: 'A', qty: 1 }] })).status, 400, 'a planned order cannot be edited');
  // 실적 입력 → 진행
  const actual = async (scheduleId, qty, date = '2026-11-10') => { const r = await prod('POST', `/api/schedules/${scheduleId}/actuals`, { production_date: date, qty, request_id: 'actual-request-' + scheduleId + '-' + qty }); assert.equal(r.status, 200, JSON.stringify(r.body)); };
  await actual(sched.id, 4000);
  let view = (await sales('GET', `/api/production-requests/${first.id}`)).body;
  assert.deepEqual([view.status, view.produced_total, view.lines[0].produced_qty], ['producing', 4000, 4000]);
  for (const s of planned.body.schedules) await actual(s.id, s.qty - (s.id === sched.id ? 4000 : 0), '2026-11-12');
  view = (await sales('GET', `/api/production-requests/${first.id}`)).body;
  assert.deepEqual([view.status, view.produced_total, view.done_date], ['done', 37500, '2026-11-12']);
  assert.ok(!(await prod('GET', '/api/production-requests/needs')).body.some(n => n.item === '습진장갑' && n.spec === 'M'), 'finished quantities leave the needs list');
});

test('Shipping marks the order; lists filter by status; only the author deletes an unplanned order', async () => {
  assert.equal((await other('POST', `/api/production-requests/${first.id}/ship`, { shipped: true, shipped_date: '2026-12-02' })).status, 403);
  const shipped = (await sales('POST', `/api/production-requests/${first.id}/ship`, { shipped: true, shipped_date: '2026-12-02' })).body;
  assert.deepEqual([shipped.status, shipped.shipped_date, shipped.shipped_by], ['shipped', '2026-12-02', '영업']);
  const open = (await prod('GET', '/api/production-requests?status=open')).body;
  assert.ok(!open.some(r => r.id === first.id) && open.length === 1, 'shipped orders leave the open list');
  assert.equal((await prod('GET', '/api/production-requests?status=waiting')).body.length, 1);
  assert.equal((await prod('GET', '/api/production-requests?q=' + encodeURIComponent('ZEX-CT'))).body[0].id, first.id);
  const neo = open[0];
  assert.equal((await other('DELETE', `/api/production-requests/${neo.id}`)).status, 403);
  assert.equal((await sales('DELETE', `/api/production-requests/${neo.id}`)).status, 200);
  const backup = (await admin('GET', '/api/admin/backup')).body.tables;
  assert.ok(['production_requests', 'production_request_lines', 'org_departments', 'org_positions'].every(t => backup.includes(t)));
});

test('15.55: the form no longer sends a ship-text; editing keeps the text an older request already has', async () => {
  const made = (await sales('POST', '/api/production-requests', { order_date: '2026-11-13', customer: '예전 의뢰', ship_text: '12월 초', ship_date: '2026-12-03', lines: [{ item: 'A', qty: 1 }] })).body;
  const edited = await sales('PUT', `/api/production-requests/${made.id}`, { order_date: '2026-11-13', customer: '예전 의뢰', ship_date: '2026-12-05', lines: [{ item: 'A', qty: 2 }], revision: made.revision });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.deepEqual([edited.body.ship_text, edited.body.ship_date], ['12월 초', '2026-12-05']);
  const fresh = (await sales('POST', '/api/production-requests', { order_date: '2026-11-13', customer: '새 의뢰', ship_date: '2026-12-10', lines: [{ item: 'A', qty: 1 }] })).body;
  assert.deepEqual([fresh.ship_text, fresh.ship_date], ['', '2026-12-10']);
});
