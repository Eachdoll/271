// 15.52 점검: 발주 삭제 후 구매의뢰 품목 재발주, 결재 차례가 남은 사람의 삭제·반려 차단, 사용자 수정의 일부 저장 방지·사용 중지 부서 유지,
// 승인 요청을 두 번 동시에 승인해도 기록이 한 번만 남는 것(receipt-changes.test.mjs), 대시보드 건수(request-concurrency.test.mjs).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rf52-'));
const { env, sqlite } = localEnvironment(dir, 'rf52-test');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await worker.fetch(new Request('https://rf52.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}
const admin = client(), sales = client(), boss = client(), boss2 = client(), buyer = client(), staff = client();
const ids = {};
before(async () => {
  for (const [c, name] of [[admin, '관리자'], [sales, '영업'], [boss, '팀장'], [boss2, '본부장'], [buyer, '구매'], [staff, '직원']]) await approvedRegistration(admin, c, { name, password: 'password', invite: 'rf52-test' });
  for (const u of (await admin('GET', '/api/admin/users')).body) ids[u.name] = u.id;
  await admin('PUT', `/api/admin/users/${ids['구매']}`, { roles: ['purchase'] });
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const request = extra => sales('POST', '/api/purchase-requests', { doc_date: '2026-11-10', title: '점검', items: [{ item: '장갑', unit: 'EA', qty: 5, vendor: '공급사' }], approvers: [ids['팀장']], ...extra });

test('15.69: deleting an order made from a purchase request closes that item unless requeue is asked', async () => {
  const pr = (await request({ items: [{ item: '장갑', unit: 'EA', qty: 5, vendor: '공급사' }, { item: '마스크', unit: 'EA', qty: 9, vendor: '공급사' }] })).body;
  await boss('POST', `/api/purchase-requests/${pr.id}/decision`, { decision: 'approved' });
  const made = (await buyer('POST', `/api/purchase-requests/${pr.id}/po`, { due_date: '2026-12-01', item_category: '부자재' })).body;
  assert.equal(made.created.length, 2);
  const list = (await buyer('GET', '/api/po')).body;
  assert.ok(list.find(p => p.id === made.created[0].id).pr_item_id, 'the list tells which orders came from a request');
  // 기본 삭제: 의뢰 품목도 닫혀 발주 대기에 다시 나타나지 않는다.
  assert.equal((await buyer('DELETE', `/api/po/${made.created[0].id}`)).status, 200);
  let view = (await buyer('GET', `/api/purchase-requests/${pr.id}`)).body;
  assert.equal(view.items[0].po_id, null); assert.match(view.items[0].order_closed, /발주 삭제 · 구매/);
  assert.equal(view.can_order, false);
  assert.ok(!(await buyer('GET', '/api/purchase-requests?box=order')).body.some(r => r.id === pr.id), 'does not come back to the to-order box');
  assert.equal((await buyer('GET', '/api/my-tasks')).body.approvals.purchase_orders_waiting, undefined);
  assert.equal((await buyer('POST', `/api/purchase-requests/${pr.id}/po`, { due_date: '2026-12-05', item_category: '부자재' })).status, 400, 'closed items are not ordered again');
  // requeue=1: 예전처럼 발주 대기로
  assert.equal((await buyer('DELETE', `/api/po/${made.created[1].id}?requeue=1`)).status, 200);
  view = (await buyer('GET', `/api/purchase-requests/${pr.id}`)).body;
  assert.deepEqual([view.items[1].po_id, view.items[1].order_closed, view.can_order], [null, '', true]);
  const box = (await buyer('GET', '/api/purchase-requests?box=order')).body.find(r => r.id === pr.id);
  assert.deepEqual(box.open_items.map(i => i.item), ['마스크']);
  // 발주 안 함 / 되돌리기
  assert.equal((await sales('POST', `/api/purchase-requests/${pr.id}/items/${view.items[1].id}/order-closed`, { closed: true })).status, 403, 'only purchase staff');
  const closed = await buyer('POST', `/api/purchase-requests/${pr.id}/items/${view.items[1].id}/order-closed`, { closed: true, reason: '재고 사용' });
  assert.equal(closed.status, 200); assert.match(closed.body.items[1].order_closed, /발주 안 함 \(재고 사용\)/);
  assert.ok(!(await buyer('GET', '/api/purchase-requests?box=order')).body.some(r => r.id === pr.id));
  const reopened = await buyer('POST', `/api/purchase-requests/${pr.id}/items/${view.items[0].id}/order-closed`, { closed: false });
  assert.equal(reopened.body.items[0].order_closed, '');
  const again = (await buyer('POST', `/api/purchase-requests/${pr.id}/po`, { due_date: '2026-12-05', item_category: '부자재' })).body;
  assert.deepEqual(again.created.map(p => p.item), ['장갑']);
  assert.equal((await buyer('POST', `/api/purchase-requests/${pr.id}/items/${view.items[0].id}/order-closed`, { closed: true })).status, 400, 'an ordered item is closed by deleting its order');
});

test('A person who still has an approval turn cannot be deleted or rejected until the turn is done', async () => {
  const pr = (await request({ approvers: [ids['팀장'], ids['본부장']] })).body;
  await boss('POST', `/api/purchase-requests/${pr.id}/decision`, { decision: 'approved' });
  const del = await admin('DELETE', `/api/admin/users/${ids['본부장']}`);
  assert.equal(del.status, 400); assert.match(del.body.error, new RegExp(pr.doc_no));
  assert.equal((await admin('POST', `/api/admin/users/${ids['본부장']}/approval`, { status: 'rejected' })).status, 400);
  assert.equal((await admin('DELETE', `/api/admin/users/${ids['팀장']}`)).status, 200, 'someone whose turn is over can be deleted');
  await boss2('POST', `/api/purchase-requests/${pr.id}/decision`, { decision: 'approved' });
  assert.equal((await admin('DELETE', `/api/admin/users/${ids['본부장']}`)).status, 200, 'after deciding, the account can go');
});

test('Editing a user checks everything first; an unchanged deactivated department can stay while the position changes', async () => {
  const dept = (await admin('POST', '/api/admin/org/departments', { name: '영업팀' })).body;
  await admin('POST', '/api/admin/org/departments', { name: '생산팀' });
  for (const name of ['사원', '대리']) await admin('POST', '/api/admin/org/positions', { name });
  assert.equal((await admin('PUT', `/api/admin/users/${ids['직원']}`, { department: '영업팀', position: '사원' })).status, 200);
  await admin('PUT', `/api/admin/org/departments/${dept.id}`, { active: false });
  const promoted = await admin('PUT', `/api/admin/users/${ids['직원']}`, { position: '대리' });
  assert.equal(promoted.status, 200, JSON.stringify(promoted.body));
  assert.deepEqual([promoted.body.department, promoted.body.position], ['영업팀', '대리']);
  const bad = await admin('PUT', `/api/admin/users/${ids['직원']}`, { roles: ['purchase'], department: '없는부서' });
  assert.equal(bad.status, 400);
  const after = (await admin('GET', '/api/admin/users')).body.find(u => u.id === ids['직원']);
  assert.ok(!after.roles.includes('purchase'), 'nothing is saved when the request is refused');
  assert.equal((await admin('PUT', `/api/admin/users/${ids['직원']}`, { department: '영업팀' })).status, 200, 'keeping the same department is allowed');
  assert.equal((await admin('PUT', `/api/admin/users/${ids['직원']}`, { password: '12' })).status, 400);
});
