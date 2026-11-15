// 영업 구매의뢰(전자결재): 결재선 순서, 반려·재상신, 참조 열람, 권한, 발주 생성.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'purchase-requests-'));
const { env, sqlite } = localEnvironment(dir, 'pr-test');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await worker.fetch(new Request('https://pr.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}
const admin = client(), author = client(), boss = client(), ceo = client(), agree = client(), cc = client(), buyer = client(), outsider = client();
const ids = {};
let roller;
before(async () => {
  await approvedRegistration(admin, admin, { name: '관리자', password: 'password', invite: 'pr-test' });
  for (const [c, name] of [[author, '송은아'], [boss, '김승준'], [ceo, '안창욱'], [agree, '이치원'], [cc, '양정은'], [buyer, '구매담당'], [outsider, '외부인']]) {
    await approvedRegistration(admin, c, { name, password: 'password', invite: 'pr-test' });
  }
  const users = (await admin('GET', '/api/admin/users')).body;
  for (const u of users) ids[u.name] = u.id;
  await admin('PUT', `/api/admin/users/${ids['구매담당']}`, { roles: ['purchase'] });
  await admin('PUT', `/api/admin/users/${ids['김승준']}`, { position: '부장', department: '전략영업부' });
  assert.equal((await author('PUT', '/api/me/profile', { position: '과장', department: '전략영업부' })).body.position, '과장');
  roller = (await admin('POST', '/api/boms', { product: '핸드롤러 SET(도전)', product_code: 'ZZ01-0257', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'SET', materials: [] })).body;
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const doc = extra => ({
  doc_date: '2026-11-11', title: '핸드롤러 구매의뢰',
  items: [{ bom_id: roller.id, spec: '34Φ*200', qty: 5, purchase_price: 170000, sale_price: 280000, vendor: '영신vsc', delivery_qty: '전량', customer: 'imk 삼성 기흥', stock_qty: '0', due_text: 'ASAP', manager: '김승준' }],
  approvers: [ids['김승준'], ids['안창욱']], agreers: [ids['이치원']], cc: [ids['양정은']], ...extra,
});

test('Submitting builds the document: number, totals, author position and department, approval line in order', async () => {
  const made = await author('POST', '/api/purchase-requests', doc({ request_id: 'once-1' }));
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const pr = made.body;
  assert.equal(pr.doc_no, 'PR-261111-01');
  assert.deepEqual([pr.author_name, pr.author_position, pr.department, pr.status, pr.current_step], ['송은아', '과장', '전략영업부', 'pending', 1]);
  assert.deepEqual([pr.items[0].item, pr.items[0].product_code, pr.items[0].unit], ['핸드롤러 SET(도전)', 'ZZ01-0257', 'SET'], 'a picked item supplies its name, code and unit');
  assert.deepEqual([pr.purchase_total, pr.sale_total], [850000, 1400000]);
  assert.deepEqual(pr.lines.map(l => [l.kind, l.step, l.user_name, l.user_position]), [['approve', 1, '김승준', '부장'], ['approve', 2, '안창욱', ''], ['agree', 3, '이치원', ''], ['cc', 0, '양정은', '']]);
  assert.equal(pr.current_user_name, '김승준');
  const again = await author('POST', '/api/purchase-requests', doc({ request_id: 'once-1' }));
  assert.equal(again.body.id, pr.id, 'the same request id does not create a second document');
  const second = await author('POST', '/api/purchase-requests', doc());
  assert.equal(second.body.doc_no, 'PR-261111-02');
  await author('DELETE', `/api/purchase-requests/${second.body.id}`);
});

test('Bad approval lines and items are refused with a reason', async () => {
  const bad = async (body, pattern) => { const r = await author('POST', '/api/purchase-requests', doc(body)); assert.equal(r.status, 400); assert.match(r.body.error, pattern); };
  await bad({ approvers: [] }, /결재자를 1명 이상/);
  await bad({ approvers: [ids['김승준']], cc: [ids['김승준']] }, /중복/);
  await bad({ approvers: [ids['송은아']] }, /작성자 본인/);
  await bad({ approvers: [999999] }, /사용자/);
  await bad({ items: [] }, /품목을 1개 이상/);
  await bad({ items: [{ item: '', qty: 1 }] }, /1번 품목 품목명/);
  await bad({ items: [{ item: 'A', qty: 0 }] }, /0보다 커야/);
  await bad({ items: [{ item: 'A', qty: 1, purchase_price: -1 }] }, /매입단가/);
  await bad({ doc_date: '2026-13-01' }, /작성일/);
});

test('Only the person whose turn it is can decide; approval moves step by step to final approval', async () => {
  const pr = (await author('POST', '/api/purchase-requests', doc())).body;
  assert.equal((await ceo('POST', `/api/purchase-requests/${pr.id}/decision`, { decision: 'approved' })).status, 403, 'the second approver must wait');
  assert.equal((await outsider('GET', `/api/purchase-requests/${pr.id}`)).status, 403, 'people outside the line cannot read it');
  assert.equal((await buyer('GET', `/api/purchase-requests/${pr.id}`)).status, 403, 'purchasing sees it only after final approval');
  assert.equal((await cc('POST', `/api/purchase-requests/${pr.id}/decision`, { decision: 'approved' })).status, 403, 'a cc reader cannot decide');
  const todo = (await boss('GET', '/api/my-tasks')).body.approvals.purchase_requests;
  assert.equal(todo.count >= 1, true); assert.ok(todo.items.some(i => i.id === pr.id));
  let r = await boss('POST', `/api/purchase-requests/${pr.id}/decision`, { decision: 'approved' });
  assert.deepEqual([r.body.status, r.body.current_user_name], ['pending', '안창욱']);
  r = await ceo('POST', `/api/purchase-requests/${pr.id}/decision`, { decision: 'approved' });
  assert.equal(r.body.current_user_name, '이치원', 'agreement follows the approvers');
  r = await agree('POST', `/api/purchase-requests/${pr.id}/decision`, { decision: 'approved', comment: '확인' });
  assert.equal(r.body.status, 'approved'); assert.ok(r.body.approved_at);
  assert.ok(r.body.lines.filter(l => l.kind !== 'cc').every(l => l.decision === 'approved' && l.decided_at));
  assert.equal((await agree('POST', `/api/purchase-requests/${pr.id}/decision`, { decision: 'approved' })).status, 400);
  assert.equal((await author('PUT', `/api/purchase-requests/${pr.id}`, doc())).status, 400, 'an approved document cannot be edited');
  assert.equal((await author('DELETE', `/api/purchase-requests/${pr.id}`)).status, 400, 'an approved document cannot be deleted');
  // 참조자는 열면 열람 표시
  await cc('GET', `/api/purchase-requests/${pr.id}`);
  const seen = (await author('GET', `/api/purchase-requests/${pr.id}`)).body.lines.find(l => l.kind === 'cc');
  assert.ok(seen.read_at, 'a cc reader is marked as read');
  ids.approvedPr = pr.id; ids.approvedNo = pr.doc_no;
});

test('A rejection needs a reason, returns to the author, and resubmitting restarts the line', async () => {
  const pr = (await author('POST', '/api/purchase-requests', doc())).body;
  await boss('POST', `/api/purchase-requests/${pr.id}/decision`, { decision: 'approved' });
  assert.equal((await ceo('POST', `/api/purchase-requests/${pr.id}/decision`, { decision: 'rejected' })).status, 400, 'reason required');
  const rejected = (await ceo('POST', `/api/purchase-requests/${pr.id}/decision`, { decision: 'rejected', comment: '단가 재확인' })).body;
  assert.deepEqual([rejected.status, rejected.reject_reason, rejected.can_edit], ['rejected', '단가 재확인', false], 'the approver is not the author');
  const mine = (await author('GET', '/api/my-tasks')).body.mine.purchase_requests;
  assert.ok(mine.some(m => m.id === pr.id && m.status === 'rejected' && m.rejected_by === '안창욱'));
  assert.equal((await boss('PUT', `/api/purchase-requests/${pr.id}`, doc())).status, 403, 'only the author edits');
  const view = (await author('GET', `/api/purchase-requests/${pr.id}`)).body; assert.equal(view.can_edit, true);
  const fixed = await author('PUT', `/api/purchase-requests/${pr.id}`, doc({ revision: view.revision, items: [{ item: '핸드롤러 SET(도전)', qty: 5, purchase_price: 160000, sale_price: 280000, vendor: '영신vsc' }] }));
  assert.equal(fixed.status, 200, JSON.stringify(fixed.body));
  assert.deepEqual([fixed.body.status, fixed.body.current_step, fixed.body.reject_reason, fixed.body.purchase_total], ['pending', 1, '', 800000]);
  assert.ok(fixed.body.lines.every(l => !l.decision), 'every approval starts again');
  assert.equal(fixed.body.doc_no, pr.doc_no, 'the document keeps its number');
  assert.equal((await author('PUT', `/api/purchase-requests/${pr.id}`, doc({ revision: view.revision }))).status, 409, 'a stale screen cannot overwrite');
  await author('DELETE', `/api/purchase-requests/${pr.id}`);
  assert.equal((await author('GET', `/api/purchase-requests/${pr.id}`)).status, 404);
});

test('Lists: my turn, mine, cc, and the purchasing order queue', async () => {
  const pending = (await author('POST', '/api/purchase-requests', doc({ title: '대기 문서' }))).body;
  const todo = (await boss('GET', '/api/purchase-requests?box=todo')).body;
  assert.ok(todo.some(r => r.id === pending.id && r.my_turn));
  assert.ok(!todo.some(r => r.id === ids.approvedPr), 'decided documents leave the to-do box');
  assert.ok((await author('GET', '/api/purchase-requests?box=mine')).body.every(r => r.author_name === '송은아'));
  assert.ok((await cc('GET', '/api/purchase-requests?box=cc')).body.length >= 2);
  assert.deepEqual((await outsider('GET', '/api/purchase-requests')).body, [], 'outsiders see nothing');
  const queue = (await buyer('GET', '/api/purchase-requests?box=order')).body;
  assert.deepEqual(queue.map(r => r.id), [ids.approvedPr], 'purchasing sees approved documents only');
  assert.equal((await author('GET', '/api/purchase-requests?box=order')).status, 403);
  const found = (await boss('GET', '/api/purchase-requests?q=' + encodeURIComponent('영신'))).body;
  assert.ok(found.length >= 2, 'keyword search covers supplier names on the items');
  const row = found.find(r => r.id === ids.approvedPr);
  assert.deepEqual([row.item_count, row.first_item, row.purchase_total, row.sale_total], [1, '핸드롤러 SET(도전)', 850000, 1400000]);
  await author('DELETE', `/api/purchase-requests/${pending.id}`);
});

test('Purchasing turns an approved request into purchase orders once', async () => {
  assert.equal((await author('POST', `/api/purchase-requests/${ids.approvedPr}/po`, { due_date: '2026-12-01' })).status, 403);
  assert.equal((await buyer('POST', `/api/purchase-requests/${ids.approvedPr}/po`, {})).status, 400, 'due date required');
  const made = await buyer('POST', `/api/purchase-requests/${ids.approvedPr}/po`, { due_date: '2026-12-01' });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const po = made.body.created[0];
  assert.deepEqual([po.req_no, po.vendor, po.item, po.qty, po.unit, po.product_code, po.item_category, po.due_date], [ids.approvedNo, '영신vsc', '핸드롤러 SET(도전)', 5, 'SET', 'ZZ01-0257', '상품', '2026-12-01']);
  assert.ok(po.note.includes('구매의뢰 ' + ids.approvedNo));
  assert.equal(made.body.request.items[0].po_id, po.id);
  assert.equal((await buyer('POST', `/api/purchase-requests/${ids.approvedPr}/po`, { due_date: '2026-12-01' })).status, 400, 'no second purchase order for the same item');
  assert.deepEqual((await buyer('GET', '/api/purchase-requests?box=order')).body, []);
});

test('Photos are kept on the document; only the author changes them before final approval', async () => {
  const pr = (await author('POST', '/api/purchase-requests', doc())).body;
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  assert.equal((await boss('PUT', `/api/purchase-requests/${pr.id}/photos`, { photos: [png] })).status, 403);
  const saved = await author('PUT', `/api/purchase-requests/${pr.id}/photos`, { photos: [png, png] });
  assert.equal(saved.status, 200, JSON.stringify(saved.body)); assert.equal(saved.body.photos.length, 2);
  const file = saved.body.photos[0];
  const kept = await author('PUT', `/api/purchase-requests/${pr.id}/photos`, { keep_photos: [file], photos: [], revision: saved.body.revision });
  assert.deepEqual(kept.body.photos, [file]);
  assert.equal((await author('PUT', `/api/purchase-requests/${pr.id}/photos`, { keep_photos: [file], photos: Array(10).fill(png) })).status, 400, 'ten photos at most');
  assert.equal((await author('PUT', `/api/purchase-requests/${pr.id}/photos`, { photos: [png], revision: saved.body.revision })).status, 409, 'a stale screen cannot overwrite photos');
  assert.equal((await boss('GET', `/api/purchase-requests/${pr.id}`)).body.photos.length, 1, 'approvers see the photos');
  assert.equal((await author('PUT', `/api/purchase-requests/${ids.approvedPr}/photos`, { photos: [] })).status, 400, 'no photo changes after approval');
  assert.equal((await author('GET', '/api/purchase-requests?box=mine')).body.find(r => r.id === pr.id).photo_count, 1);
  await author('DELETE', `/api/purchase-requests/${pr.id}`);
  const backup = (await admin('GET', '/api/admin/backup')).body.tables;
  assert.ok(['purchase_requests', 'purchase_request_items', 'purchase_request_lines'].every(t => backup.includes(t)));
  const dir = (await author('GET', '/api/directory')).body;
  assert.ok(dir.some(u => u.name === '김승준' && u.position === '부장' && u.department === '전략영업부'));
  assert.ok(dir.every(u => !('pw_hash' in u) && !('pw_salt' in u)));
});
