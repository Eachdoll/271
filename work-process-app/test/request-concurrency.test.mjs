// 15.51 점검 수정: 동시 수정·결재·계획 반영, D1 매개변수 한도(100개)와 대량 목록, 하루 100번 넘는 번호, 출고 후 수정 차단, 저장 재시도.
// 두 요청을 Promise.all로 보내면 둘 다 먼저 읽고(같은 revision) 나서 저장 batch를 실행한다(실제 동시 요청과 같은 순서).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment, D1_MAX_PARAMS } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-'));
const { env, sqlite } = localEnvironment(dir, 'cc-test');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await worker.fetch(new Request('https://cc.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}
const admin = client(), sales = client(), sales2 = client(), prod = client(), prod2 = client(), boss = client();
let ids = {};
const mr = (extra = {}) => ({ order_date: '2026-11-10', customer: '하라다', lines: [{ item: '습진장갑', spec: 'M', unit: '켤레', qty: 100 }], ...extra });
const statuses = list => list.map(r => r.status).sort();
before(async () => {
  for (const [c, name] of [[admin, '관리자'], [sales, '영업'], [sales2, '영업2'], [prod, '생산'], [prod2, '생산2'], [boss, '팀장']]) await approvedRegistration(admin, c, { name, password: 'password', invite: 'cc-test' });
  const users = (await admin('GET', '/api/admin/users')).body;
  for (const u of users) ids[u.name] = u.id;
  for (const name of ['생산', '생산2']) await admin('PUT', `/api/admin/users/${ids[name]}`, { roles: ['production'] });
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('The local database rejects more than 100 bound parameters, like D1', async () => {
  assert.equal(D1_MAX_PARAMS, 100);
  const marks = n => Array(n).fill('?').join(',');
  assert.equal((await env.DB.prepare(`SELECT ${marks(100)}`).bind(...Array(100).fill(1)).all()).results.length, 1);
  assert.throws(() => env.DB.prepare(`SELECT ${marks(101)}`).bind(...Array(101).fill(1)), /too many SQL variables/);
});

test('Two edits of a production request from the same revision: one wins and nothing of the other is saved', async () => {
  const made = (await sales('POST', '/api/production-requests', mr())).body;
  const a = { ...mr({ customer: 'A업체', lines: [{ item: 'A품목', unit: 'BOX', qty: 1 }] }), revision: made.revision };
  const b = { ...mr({ customer: 'B업체', lines: [{ item: 'B품목', unit: '매', qty: 2 }, { item: 'B품목2', unit: '매', qty: 3 }] }), revision: made.revision };
  const results = await Promise.all([sales('PUT', `/api/production-requests/${made.id}`, a), sales('PUT', `/api/production-requests/${made.id}`, b)]);
  assert.deepEqual(statuses(results), [200, 409], JSON.stringify(results.map(r => r.body)));
  const winner = results[0].status === 200 ? a : b;
  const saved = (await sales('GET', `/api/production-requests/${made.id}`)).body;
  assert.equal(saved.customer, winner.customer);
  assert.deepEqual(saved.lines.map(l => [l.item, l.qty]), winner.lines.map(l => [l.item, l.qty]), 'lines come from the same request as the header');
  assert.equal(saved.revision, made.revision + 1);
});

test('Two edits of a purchase request from the same revision keep header, items and approval line together', async () => {
  const made = (await sales('POST', '/api/purchase-requests', { doc_date: '2026-11-10', title: '원본', approvers: [ids['팀장']], items: [{ item: '원본', qty: 1 }] })).body;
  const a = { doc_date: '2026-11-10', title: 'A안', approvers: [ids['팀장']], items: [{ item: 'A품목', qty: 1 }], revision: made.revision };
  const b = { doc_date: '2026-11-10', title: 'B안', approvers: [ids['생산']], agreers: [ids['팀장']], items: [{ item: 'B품목', qty: 2 }, { item: 'B품목2', qty: 3 }], revision: made.revision };
  const results = await Promise.all([sales('PUT', `/api/purchase-requests/${made.id}`, a), sales('PUT', `/api/purchase-requests/${made.id}`, b)]);
  assert.deepEqual(statuses(results), [200, 409]);
  const winner = results[0].status === 200 ? a : b;
  const saved = (await sales('GET', `/api/purchase-requests/${made.id}`)).body;
  assert.equal(saved.title, winner.title);
  assert.deepEqual(saved.items.map(i => i.item), winner.items.map(i => i.item));
  assert.deepEqual(saved.lines.filter(l => l.kind !== 'cc').map(l => l.user_id), [...winner.approvers, ...(winner.agreers || [])]);
});

test('An approval and an edit at the same moment never mix: either approved as read, or edited with a fresh approval line', async () => {
  for (let round = 0; round < 4; round++) {
    const made = (await sales('POST', '/api/purchase-requests', { doc_date: '2026-11-10', title: '결재 경합', approvers: [ids['팀장']], items: [{ item: '원본', qty: 1 }] })).body;
    const edit = { doc_date: '2026-11-10', title: '수정본', approvers: [ids['팀장']], items: [{ item: '수정 품목', qty: 5 }], revision: made.revision };
    const calls = [sales('PUT', `/api/purchase-requests/${made.id}`, edit), boss('POST', `/api/purchase-requests/${made.id}/decision`, { decision: 'approved', revision: made.revision })];
    const [put, decide] = round % 2 ? (await Promise.all(calls.reverse())).reverse() : await Promise.all(calls);
    assert.equal([put.status, decide.status].filter(s => s === 200).length, 1, JSON.stringify([put.body, decide.body]));
    const saved = (await sales('GET', `/api/purchase-requests/${made.id}`)).body;
    if (decide.status === 200) {
      assert.deepEqual([saved.status, saved.title, saved.items[0].item, saved.lines[0].decision], ['approved', '결재 경합', '원본', 'approved']);
    } else {
      assert.deepEqual([saved.status, saved.title, saved.items[0].item, saved.lines[0].decision], ['pending', '수정본', '수정 품목', '']);
    }
  }
});

test('Two planning requests at once create schedules for the open quantity only once', async () => {
  const made = (await sales('POST', '/api/production-requests', mr({ lines: [{ item: '습진장갑', spec: 'S', unit: '켤레', qty: 100 }, { item: '습진장갑', spec: 'L', unit: '켤레', qty: 40 }] }))).body;
  const body = { period: 'week', start_date: '2026-11-09' };
  const results = await Promise.all([prod('POST', `/api/production-requests/${made.id}/plan`, body), prod2('POST', `/api/production-requests/${made.id}/plan`, body), prod('POST', `/api/production-requests/${made.id}/plan`, body)]);
  assert.deepEqual(statuses(results), [200, 409, 409], JSON.stringify(results.map(r => r.body.error)));
  const saved = (await prod('GET', `/api/production-requests/${made.id}`)).body;
  assert.equal(saved.schedules.length, 2);
  assert.deepEqual(saved.lines.map(l => l.planned_qty), [100, 40], 'never more than ordered');
  assert.equal((await prod('POST', `/api/production-requests/${made.id}/plan`, body)).status, 400, 'nothing left');
  // 일정을 지우면 그 수량만 다시 계획할 수 있다(잔여 수량 계획은 그대로 동작).
  await prod('DELETE', `/api/schedules/${saved.schedules[1].id}`);
  const again = await prod('POST', `/api/production-requests/${made.id}/plan`, body);
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.deepEqual(again.body.lines.map(l => l.planned_qty), [100, 40]);
});

test('Planning racing an edit or a delete leaves no schedule pointing at a missing line', async () => {
  for (const action of ['edit', 'delete']) for (let round = 0; round < 2; round++) {
    const made = (await sales('POST', '/api/production-requests', mr())).body;
    const plan = prod('POST', `/api/production-requests/${made.id}/plan`, { period: 'day', start_date: '2026-11-10' });
    const change = action === 'edit' ? sales('PUT', `/api/production-requests/${made.id}`, { ...mr({ customer: '바뀐 업체' }), revision: made.revision }) : sales('DELETE', `/api/production-requests/${made.id}`);
    const [p, c] = round ? (await Promise.all([change, plan])).reverse() : await Promise.all([plan, change]);
    assert.equal([p.status, c.status].filter(s => s === 200).length, 1, `${action}: ${JSON.stringify([p.body, c.body])}`);
    const orphans = sqlite.prepare('SELECT COUNT(*) n FROM schedules s WHERE s.production_line_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM production_request_lines l WHERE l.id=s.production_line_id)').get().n;
    assert.equal(orphans, 0, `${action} round ${round}`);
  }
});

test('Shipped orders cannot be edited or deleted through the API until shipping is undone', async () => {
  const made = (await sales('POST', '/api/production-requests', mr())).body;
  await sales('POST', `/api/production-requests/${made.id}/ship`, { shipped: true, shipped_date: '2026-11-12' });
  const shipped = (await sales('GET', `/api/production-requests/${made.id}`)).body;
  assert.equal(shipped.can_edit, false);
  const put = await sales('PUT', `/api/production-requests/${made.id}`, { ...mr({ customer: '바꿈' }), revision: shipped.revision });
  assert.equal(put.status, 400); assert.match(put.body.error, /출고 완료/);
  assert.equal((await sales('DELETE', `/api/production-requests/${made.id}`)).status, 400);
  await sales('POST', `/api/production-requests/${made.id}/ship`, { shipped: false });
  const open = (await sales('GET', `/api/production-requests/${made.id}`)).body;
  assert.equal(open.can_edit, true);
  assert.equal((await sales('PUT', `/api/production-requests/${made.id}`, { ...mr({ customer: '바꿈' }), revision: open.revision })).status, 200);
});

test('Daily numbers continue past 99 for production and purchase requests, also when several arrive at once', async () => {
  const insertMr = sqlite.prepare("INSERT INTO production_requests(req_no,order_date,customer,author_id,author_name) VALUES(?,'2026-11-14','기존',?, '영업')");
  for (let n = 1; n <= 99; n++) insertMr.run('MR-261114-' + String(n).padStart(2, '0'), ids['영업']);
  const insertPr = sqlite.prepare("INSERT INTO purchase_requests(doc_no,doc_date,author_id,author_name) VALUES(?,'2026-11-14',?,'영업')");
  for (let n = 1; n <= 99; n++) insertPr.run('PR-261114-' + String(n).padStart(2, '0'), ids['영업']);
  const day = mr({ order_date: '2026-11-14' });
  assert.equal((await sales('POST', '/api/production-requests', day)).body.req_no, 'MR-261114-100');
  assert.equal((await sales('POST', '/api/production-requests', day)).body.req_no, 'MR-261114-101');
  const burst = await Promise.all([sales('POST', '/api/production-requests', day), sales2('POST', '/api/production-requests', day), sales('POST', '/api/production-requests', day)]);
  assert.deepEqual(burst.map(r => r.status), [200, 200, 200]);
  assert.deepEqual(burst.map(r => r.body.req_no).sort(), ['MR-261114-102', 'MR-261114-103', 'MR-261114-104']);
  const pr = { doc_date: '2026-11-14', approvers: [ids['팀장']], items: [{ item: 'X', qty: 1 }] };
  assert.equal((await sales('POST', '/api/purchase-requests', pr)).body.doc_no, 'PR-261114-100');
  const prBurst = await Promise.all([sales('POST', '/api/purchase-requests', pr), sales2('POST', '/api/purchase-requests', pr)]);
  assert.deepEqual(prBurst.map(r => r.body.doc_no).sort(), ['PR-261114-101', 'PR-261114-102']);
  assert.equal(sqlite.prepare("SELECT req_no FROM production_requests WHERE req_no='MR-261114-07'").get().req_no, 'MR-261114-07', 'existing numbers stay as they were');
});

test('A retried save with the same request id returns the first save; another person cannot reuse it', async () => {
  const body = mr({ customer: '재시도 업체', request_id: 'retry-save-0001-abcdef' });
  const first = await sales('POST', '/api/production-requests', body);
  const retry = await sales('POST', '/api/production-requests', { ...body, customer: '재시도 업체(고침)' });
  assert.equal(retry.body.id, first.body.id); assert.equal(retry.body.duplicate, true);
  assert.equal(retry.body.customer, '재시도 업체', 'the first save is kept');
  assert.equal((await sales2('POST', '/api/production-requests', body)).status, 409);
  const twice = await Promise.all([sales('POST', '/api/production-requests', mr({ request_id: 'retry-save-0002-abcdef' })), sales('POST', '/api/production-requests', mr({ request_id: 'retry-save-0002-abcdef' }))]);
  assert.equal(twice[0].body.id, twice[1].body.id);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM production_requests WHERE request_id='retry-save-0002-abcdef'").get().n, 1);
  const pr = { doc_date: '2026-11-10', approvers: [ids['팀장']], items: [{ item: 'X', qty: 1 }], request_id: 'retry-save-pr-0001-abc' };
  const p1 = await sales('POST', '/api/purchase-requests', pr), p2 = await sales('POST', '/api/purchase-requests', pr);
  assert.equal(p2.body.id, p1.body.id); assert.equal(p2.body.duplicate, true);
  assert.equal((await sales2('POST', '/api/purchase-requests', pr)).status, 409);
});

test('Quantities in different units are totalled per unit', async () => {
  const made = (await sales('POST', '/api/production-requests', mr({ lines: [{ item: 'NX709L', unit: 'BOX', qty: 20 }, { item: '와이퍼', unit: '매', qty: 500 }, { item: 'NX709L', unit: 'BOX', qty: 5 }] }))).body;
  assert.equal(made.mixed_units, true);
  assert.deepEqual(made.units.map(u => [u.unit, u.qty]), [['BOX', 25], ['매', 500]]);
});

test('Lists and needs stay complete beyond 100 and 300 requests', async () => {
  // 대량 데이터는 SQL로 바로 넣는다: 출고 전 330건(앞 320건은 계획 반영, 뒤 10건은 접수 대기·늦은 출고 희망일).
  sqlite.exec('BEGIN');
  const head = sqlite.prepare("INSERT INTO production_requests(req_no,order_date,customer,ship_date,author_id,author_name) VALUES(?,'2026-10-01','대량',?,?,'영업')");
  const line = sqlite.prepare("INSERT INTO production_request_lines(request_id,line_no,item,spec,unit,qty) VALUES(?,1,'대량품목','M','켤레',10)");
  const sched = sqlite.prepare("INSERT INTO schedules(kind,period,start_date,product,qty,spec,unit,created_by,production_line_id) VALUES('finished','week','2026-10-05','대량품목',10,'M','켤레','생산',?)");
  for (let n = 1; n <= 330; n++) {
    const r = head.run('MR-261001-' + String(n).padStart(3, '0'), n <= 320 ? '2026-11-01' : '2027-03-01', ids['영업']);
    const l = line.run(Number(r.lastInsertRowid));
    if (n <= 320) sched.run(Number(l.lastInsertRowid));
  }
  const prHead = sqlite.prepare("INSERT INTO purchase_requests(doc_no,doc_date,title,author_id,author_name) VALUES(?,'2026-10-01','대량',?,'영업')");
  const prItem = sqlite.prepare("INSERT INTO purchase_request_items(request_id,line_no,item,qty) VALUES(?,1,'대량',1)");
  for (let n = 1; n <= 150; n++) prItem.run(Number(prHead.run('PR-261001-' + String(n).padStart(3, '0'), ids['영업']).lastInsertRowid));
  sqlite.exec('COMMIT');
  const bulk = r => r.customer === '대량';
  const all = await prod('GET', '/api/production-requests?q=' + encodeURIComponent('대량'));
  assert.equal(all.status, 200, JSON.stringify(all.body));
  assert.equal(all.body.length, 300, 'first page');
  const page0 = (await prod('GET', '/api/production-requests?paged=1&q=' + encodeURIComponent('대량'))).body;
  const page1 = (await prod('GET', '/api/production-requests?paged=1&page=1&q=' + encodeURIComponent('대량'))).body;
  assert.deepEqual([page0.rows.length, page0.more, page1.rows.length, page1.more], [300, true, 30, false]);
  assert.equal(new Set([...page0.rows, ...page1.rows].map(r => r.id)).size, 330, 'every request appears once across pages');
  const waiting = (await prod('GET', '/api/production-requests?status=waiting&q=' + encodeURIComponent('대량'))).body;
  assert.equal(waiting.filter(bulk).length, 10, 'requests after the first 300 still match the status filter');
  const planned = (await prod('GET', '/api/production-requests?status=planned&q=' + encodeURIComponent('대량'))).body;
  assert.equal(planned.length, 300);
  assert.ok(planned.every(r => r.status === 'planned'));
  const needs = (await prod('GET', '/api/production-requests/needs')).body.find(n => n.item === '대량품목');
  assert.deepEqual([needs.ordered, needs.need, needs.unplanned, needs.requests], [3300, 3300, 100, 330]);
  const prs = await sales('GET', '/api/purchase-requests');
  assert.equal(prs.status, 200, JSON.stringify(prs.body));
  assert.ok(prs.body.filter(r => r.title === '대량').length >= 150 || prs.body.length === 200);
  assert.ok(prs.body.filter(r => r.title === '대량').every(r => r.item_count === 1), 'items of every listed request are read');
});
