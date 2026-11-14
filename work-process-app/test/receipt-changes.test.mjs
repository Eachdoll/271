// Short receipts can be closed; recorded receipt quantities change only with a logistics lead's approval.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-changes-'));
const { env, sqlite } = localEnvironment(dir, 'receipt-test');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await worker.fetch(new Request('https://receipt.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}
const admin = client(), anyone = client(), logistics = client(), lead = client();
before(async () => {
  await approvedRegistration(admin, admin, { name: '관리자', password: 'password', invite: 'receipt-test' });
  await approvedRegistration(admin, anyone, { name: '아무나', password: 'password', invite: 'receipt-test' });
  await approvedRegistration(admin, logistics, { name: '물류직원', password: 'password', invite: 'receipt-test' });
  await approvedRegistration(admin, lead, { name: '물류팀장', password: 'password', invite: 'receipt-test' });
  const users = (await admin('GET', '/api/admin/users')).body;
  await admin('PUT', `/api/admin/users/${users.find(u => u.name === '물류직원').id}`, { roles: ['logistics'] });
  await admin('PUT', `/api/admin/users/${users.find(u => u.name === '물류팀장').id}`, { roles: ['logistics_approver'] });
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const order = async (item, qty = 100) => (await anyone('POST', '/api/po', { req_no: 'PR-' + item, vendor: '공급사', item, qty, due_date: '2026-11-20', item_category: '원자재' })).body;
const analysisFor = async id => (await anyone('GET', '/api/requests?type=analysis&scope=list')).body.find(r => r.source_type === 'purchase_order' && r.source_id === id);

test('A short receipt (90 of 100) is closed as complete with the received quantity and one inspection', async () => {
  const po = await order('단기입고');
  assert.equal((await anyone('POST', '/api/po/receive', { ids: [po.id], status: 'mismatch', recv_qty: 90 })).body.analysis_created, 1);
  const closed = await anyone('POST', '/api/po/receive', { ids: [po.id], status: 'ok' });
  assert.equal(closed.status, 200); assert.equal(closed.body.analysis_created, 0);
  const row = (await anyone('GET', '/api/po?recv=ok')).body.find(p => p.id === po.id);
  assert.equal(row.recv_qty, 90); assert.equal(row.recv_by, '아무나');
  assert.ok(!(await anyone('GET', '/api/po?recv=open')).body.some(p => p.id === po.id), 'closed receipts leave the open list');
  assert.equal((await analysisFor(po.id)).data.received_qty, 90);
  const report = (await anyone('GET', '/api/reports?from=2026-11-01&to=2026-11-30')).body;
  assert.ok(report.receipts.items.some(r => r.item.startsWith('단기입고') && r.qty === 90));
});

test('Recorded quantities cannot be changed or reverted directly', async () => {
  const po = await order('직접변경');
  await anyone('POST', '/api/po/receive', { ids: [po.id], status: 'ok' });
  for (const body of [{ status: 'mismatch', recv_qty: 80 }, { status: 'checking' }, { status: '' }]) {
    assert.equal((await logistics('POST', '/api/po/receive', { ids: [po.id], ...body })).status, 409);
  }
  assert.equal((await anyone('POST', '/api/po/receive', { ids: [po.id], status: 'ok' })).status, 200, 'confirming again is harmless');
  const short = await order('같은수량');
  await anyone('POST', '/api/po/receive', { ids: [short.id], status: 'mismatch', recv_qty: 5 });
  assert.equal((await anyone('POST', '/api/po/receive', { ids: [short.id], status: 'mismatch', recv_qty: 5, note: '메모만' })).status, 200);
  assert.equal((await anyone('POST', '/api/po/receive', { ids: [short.id], status: 'mismatch', recv_qty: 6 })).status, 409);
});

test('A quantity correction waits for the logistics lead and is noted on the receipt and its inspection', async () => {
  const po = await order('수량정정');
  await anyone('POST', '/api/po/receive', { ids: [po.id], status: 'mismatch', recv_qty: 90 });
  const key = crypto.randomUUID();
  const req = await anyone('POST', `/api/po/${po.id}/receipt-changes`, { action: 'qty', recv_qty: 95, reason: '재검수 결과 5개 추가 확인', request_id: key });
  assert.equal(req.status, 200); assert.equal(req.body.pending, true);
  assert.equal((await anyone('POST', `/api/po/${po.id}/receipt-changes`, { action: 'qty', recv_qty: 95, reason: '재검수 결과 5개 추가 확인', request_id: key })).body.change.id, req.body.change.id);
  assert.equal((await anyone('POST', `/api/po/${po.id}/receipt-changes`, { action: 'revert', reason: '중복' })).status, 409, 'one pending request per receipt');
  assert.equal((await anyone('POST', '/api/po/receive', { ids: [po.id], status: 'ok' })).status, 409, 'no direct processing while a request is pending');
  const listed = (await anyone('GET', '/api/po')).body.find(p => p.id === po.id);
  assert.equal(JSON.parse(listed.pending_change).new_recv_qty, 95); assert.equal(listed.recv_qty, 90);
  assert.equal((await logistics('POST', `/api/receipt-changes/${req.body.change.id}/approve`, {})).status, 403, 'logistics staff cannot approve');
  const ok = await lead('POST', `/api/receipt-changes/${req.body.change.id}/approve`, {});
  assert.equal(ok.status, 200); assert.equal(ok.body.reviewed_by, '물류팀장');
  assert.equal((await lead('POST', `/api/receipt-changes/${req.body.change.id}/approve`, {})).status, 409);
  const row = (await anyone('GET', '/api/po')).body.find(p => p.id === po.id);
  assert.equal(row.recv_qty, 95); assert.equal(row.recv_status, 'mismatch'); assert.equal(row.pending_change, null);
  const analysis = await analysisFor(po.id);
  assert.equal(analysis.data.received_qty, 90, 'inspection snapshot is kept');
  assert.match((await anyone('GET', `/api/comments/request/${analysis.id}`)).body.rows[0].content, /입고 수량 수정 승인\] 실입고 90 → 95/);
  assert.match((await anyone('GET', `/api/comments/purchase_order/${po.id}`)).body.rows[0].content, /실입고 90 → 95/);
});

test('Revert requests can be rejected with a reason, withdrawn by the requester, or approved', async () => {
  const po = await order('입고취소');
  await anyone('POST', '/api/po/receive', { ids: [po.id], status: 'ok' });
  const a = await anyone('POST', `/api/po/${po.id}/receipt-changes`, { action: 'revert', reason: '다른 발주로 입고' });
  assert.equal((await lead('POST', `/api/receipt-changes/${a.body.change.id}/reject`, {})).status, 400);
  assert.equal((await lead('POST', `/api/receipt-changes/${a.body.change.id}/reject`, { note: '실물 확인됨' })).status, 200);
  const b = await anyone('POST', `/api/po/${po.id}/receipt-changes`, { action: 'revert', reason: '재요청' });
  assert.equal((await logistics('POST', `/api/receipt-changes/${b.body.change.id}/cancel`)).status, 403);
  assert.equal((await anyone('POST', `/api/receipt-changes/${b.body.change.id}/cancel`)).status, 200);
  const c = await anyone('POST', `/api/po/${po.id}/receipt-changes`, { action: 'revert', reason: '최종 취소' });
  assert.equal((await admin('POST', `/api/receipt-changes/${c.body.change.id}/approve`, {})).status, 200, 'admins can approve');
  const row = (await anyone('GET', '/api/po')).body.find(p => p.id === po.id);
  assert.equal(row.recv_status, ''); assert.equal(row.recv_qty, null); assert.equal(row.recv_by, null);
  assert.ok(await analysisFor(po.id), 'the inspection history remains');
  assert.equal((await anyone('GET', `/api/receipt-changes?po_id=${po.id}`)).body.map(x => x.status).join(','), 'approved,cancelled,rejected');
  assert.equal((await anyone('POST', `/api/po/${po.id}/receipt-changes`, { action: 'qty', recv_qty: 1, reason: 'x' })).status, 400, 'only recorded receipts');
  assert.equal((await admin('GET', '/api/dashboard')).body.receiptChangesPending, 0);
});

test('0009 leaves existing receipts untouched', () => {
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-migration-'));
  let db = new DatabaseSync(path.join(dir2, 'app.db'));
  try {
    db.exec('CREATE TABLE _local_migrations(name TEXT PRIMARY KEY)');
    const folder = new URL('../drizzle/', import.meta.url);
    for (const file of fs.readdirSync(folder).filter(f => f.endsWith('.sql') && f < '0009').sort()) { db.exec(fs.readFileSync(new URL(file, folder), 'utf8')); db.prepare('INSERT INTO _local_migrations VALUES(?)').run(file); }
    db.prepare("INSERT INTO purchase_orders(req_no,vendor,item,qty,due_date,recv_status,recv_qty,recv_by,recv_at) VALUES('PR','V','기존',100,'2026-11-01','mismatch',90,'기존담당','2026-11-02 10:00:00')").run();
    db.close(); ({ sqlite: db } = localEnvironment(dir2, 'test'));
    const row = db.prepare('SELECT * FROM purchase_orders').get();
    assert.deepEqual([row.recv_status, row.recv_qty, row.recv_by], ['mismatch', 90, '기존담당']);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM receipt_qty_changes').get().n, 0);
  } finally { db.close(); fs.rmSync(dir2, { recursive: true, force: true }); }
});

test('Approval review fetches one pending ID even when it is older than the list limit', async () => {
  const first = 900001;
  for (let i = 0; i < 205; i++) sqlite.prepare("INSERT INTO receipt_qty_changes(po_id,action,old_status,old_recv_qty,new_recv_qty,reason,requested_by) VALUES(?,'qty','ok',10,9,'검토','사용자')").run(first + i);
  const id = sqlite.prepare('SELECT id FROM receipt_qty_changes WHERE po_id=?').get(first).id;
  const result = await anyone('GET', `/api/receipt-changes?status=pending&id=${id}`);
  assert.equal(result.status, 200); assert.equal(result.body.length, 1); assert.equal(result.body[0].id, id);
  for (const kind of ['receipt-changes', 'actual-changes', 'semi-changes']) {
    assert.equal((await anyone('GET', `/api/${kind}?id=1%20OR%201=1`)).status, 400);
    const empty = await anyone('GET', `/api/${kind}?id=9999999`); assert.equal(empty.status, 200); assert.deepEqual(empty.body, []);
  }
});
