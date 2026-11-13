import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'progress-comments-'));
const { env, sqlite } = localEnvironment(dir, 'comments-test');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const response = await worker.fetch(new Request('https://comments.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, body: await response.json() };
  };
}
const admin = client(), member = client(), pending = client(), anon = client();
let author;
before(async () => {
  await approvedRegistration(admin, admin, { name: '관리자', password: 'password', invite: 'comments-test' });
  author = (await approvedRegistration(admin, member, { name: '코멘트직원', password: 'password', invite: 'comments-test' })).body.user;
  await pending('POST', '/api/auth/register', { name: '승인대기', password: 'password', invite: 'comments-test' });
  sqlite.exec(`INSERT INTO purchase_orders(req_no,vendor,item,qty) VALUES('PO-1','거래처','발주품목',10);
    INSERT INTO requests(type,title,category,status) VALUES('analysis','분석품목','의뢰검사','waiting'),('development','개발품목','','progress'),('sample','샘플품목','','done');
    INSERT INTO other_receipts(received_date,item,item_category,qty,vendor) VALUES('2026-11-13','기타품목','원자재',2,'입고처');
    INSERT INTO shipments(ship_date,item,qty,customer) VALUES('2026-11-13','출하품목',1,'고객');
    INSERT INTO schedules(kind,period,start_date,product,qty) VALUES('finished','day','2026-11-13','생산품목',5);
    INSERT INTO laundry(in_date,discard_qty) VALUES('2026-11-13',1);
    INSERT INTO boms(product,kind,base_qty,unit,materials) VALUES('BOM품목','finished',1,'EA','[]');`);
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('Comments persist independently for all business records with server-authoritative authors and Korean timestamps', async () => {
  const targets = [['purchase_order',1],['request',1],['request',2],['request',3],['other_receipt',1],['shipment',1],['schedule',1],['laundry',1],['bom',1]];
  for (const [entity, id] of targets) {
    const endpoint = `/api/comments/${entity}/${id}`;
    const content = `${entity}/${id} 진행상황\n다음 일정 확인 중 <script>alert(1)</script>`;
    const posted = await member('POST', endpoint, { content, author_id: 999, author_name: '위조', created_at: '1900-01-01', status: 'done' });
    assert.equal(posted.status, 200); assert.equal(posted.body.content, content);
    assert.equal(posted.body.author_id, author.id); assert.equal(posted.body.author_name, author.name);
    assert.ok(Math.abs(Date.parse(posted.body.created_at.replace(' ', 'T') + '+09:00') - Date.now()) < 5000);
    const history = await admin('GET', endpoint);
    assert.equal(history.body.rows.length, 1); assert.equal(history.body.rows[0].id, posted.body.id);
  }
  assert.equal(sqlite.prepare('SELECT status FROM requests WHERE id=1').get().status, 'waiting');
  assert.equal(sqlite.prepare('SELECT recv_status FROM purchase_orders WHERE id=1').get().recv_status, '');
  assert.equal((await admin('GET', '/api/admin/backup')).body.tables.includes('progress_comments'), true);
  assert.equal((await admin('GET', '/api/admin/backup?table=progress_comments')).body.rows.length, targets.length);
});

test('Comments require an approved session and an existing, allowed entity, with strict input validation', async () => {
  for (const caller of [anon,pending]) {
    assert.equal((await caller('GET', '/api/comments/request/1')).status, 401);
    assert.equal((await caller('POST', '/api/comments/request/1', { content: '차단' })).status, 401);
  }
  for (const endpoint of ['/api/comments/users/1','/api/comments/settings/1','/api/comments/request/0','/api/comments/request/1.5','/api/comments/request/9007199254740993']) {
    assert.equal((await member('GET', endpoint)).status, 400);
    assert.equal((await member('POST', endpoint, { content: '차단' })).status, 400);
  }
  assert.equal((await member('GET', '/api/comments/request/999')).status, 404);
  assert.equal((await member('POST', '/api/comments/request/999', { content: '없음' })).status, 404);
  for (const content of ['', ' \n ', null, [], {}, '가'.repeat(2001)]) assert.equal((await member('POST', '/api/comments/request/1', { content })).status, 400);
  assert.equal((await member('POST', '/api/comments/request/1', { content: '가'.repeat(2000) })).status, 200);
  for (const value of ['0','-1','1.2','abc','9007199254740993']) assert.equal((await member('GET', '/api/comments/request/1?before=' + value)).status, 400);
  sqlite.prepare('UPDATE boms SET active=0 WHERE id=1').run();
  assert.equal((await member('GET', '/api/comments/bom/1')).status, 403);
  assert.equal((await member('POST', '/api/comments/bom/1', { content: '중지 BOM' })).status, 403);
  assert.equal((await admin('GET', '/api/comments/bom/1')).status, 200);
});

test('Concurrent comments append without overwriting and pagination has no duplicates or omissions', async () => {
  await Promise.all(Array.from({ length: 107 }, (_, i) => member('POST', '/api/comments/request/2', { content: '진행 코멘트 ' + i })));
  const first = (await member('GET', '/api/comments/request/2')).body;
  assert.equal(first.rows.length, 50); assert.ok(first.next);
  await member('POST', '/api/comments/request/2', { content: '페이지 조회 중 새 코멘트' });
  const ids = first.rows.map(row => row.id); let next = first.next;
  while (next !== null) {
    const page = (await member('GET', '/api/comments/request/2?before=' + next)).body;
    ids.push(...page.rows.map(row => row.id)); next = page.next;
  }
  assert.equal(ids.length, 108); assert.equal(new Set(ids).size, 108);
  assert.ok(ids.every((id, i) => !i || ids[i-1] > id));
  assert.equal((await member('GET', '/api/comments/request/2')).body.rows[0].content, '페이지 조회 중 새 코멘트');
});

test('Discussion survives workflow edits and account deletion without losing author attribution', async () => {
  const temp = client();
  const user = (await approvedRegistration(admin, temp, { name: '퇴사직원', password: 'password', invite: 'comments-test' })).body.user;
  const posted = await temp('POST', '/api/comments/shipment/1', { content: '포장 상태 점검 완료' });
  await admin('PUT', '/api/shipments/1', { ship_date: '2026-11-14', item: '변경품목', qty: 2, customer: '고객', lot: 'LOT-1' });
  await admin('DELETE', '/api/admin/users/' + user.id);
  const saved = (await member('GET', '/api/comments/shipment/1')).body.rows.find(row => row.id === posted.body.id);
  assert.equal(saved.author_id, null); assert.equal(saved.author_name, '퇴사직원'); assert.equal(saved.content, '포장 상태 점검 완료');
  assert.equal((await member('DELETE', `/api/comments/shipment/1`)).status, 404);
  await admin('DELETE', '/api/shipments/1');
  assert.equal((await member('GET', '/api/comments/shipment/1')).status, 404);
  assert.equal(sqlite.prepare('SELECT content FROM progress_comments WHERE id=?').get(posted.body.id).content, '포장 상태 점검 완료');
});
