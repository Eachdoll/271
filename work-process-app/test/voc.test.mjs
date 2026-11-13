import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voc-workflow-'));
const { env, sqlite } = localEnvironment(dir, 'voc-test');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const response = await worker.fetch(new Request('https://voc.test' + url, { method, headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, body: await response.json().catch(() => null) };
  };
}
const admin = client(), leader = client(), quality = client(), requester = client(), other = client(), dev = client(), anon = client();
const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const body = suffix => ({ type: 'voc', customer: '고객사 A', title: '제품 ' + suffix, due_date: '2026-12-01', data: { qty: 20, unit: 'EA', lot: 'LOT-2026-A', extra: '포장 파손 및 오염 확인 요청' } });
let voc;
before(async () => {
  for (const [caller, name, roles] of [[admin,'관리자',[]], [leader,'품질팀장',['quality_approver']], [quality,'품질직원',['quality']], [requester,'구매직원',[]], [other,'다른직원',[]], [dev,'개발책임자',['dev_approver']]]) {
    const user = (await approvedRegistration(admin, caller, { name, password: 'password', invite: 'voc-test' })).body.user;
    if (roles.length) assert.equal((await admin('PUT', '/api/admin/users/' + user.id, { roles })).status, 200);
  }
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('Any approved staff member can submit VOC with required fields and attach private photos', async () => {
  assert.equal((await anon('POST', '/api/requests', body('익명'))).status, 401);
  for (const overrides of [{ title: '' }, { customer: '' }, { data: {} }, { data: [] }, { data: { qty: -1, extra: '불만' } }, { data: { qty: 0, extra: '불만' } }, { data: { qty: 1, extra: '' } }]) {
    assert.equal((await requester('POST', '/api/requests', { ...body('오류'), ...overrides })).status, 400);
  }
  const result = await requester('POST', '/api/requests', { ...body('접수'), status: 'done', requester_name: '위조' });
  assert.equal(result.status, 200); voc = result.body;
  assert.equal(voc.type, 'voc'); assert.equal(voc.status, 'pending'); assert.equal(voc.requester_name, '구매직원');
  assert.equal(voc.data.qty, 20); assert.equal(voc.data.lot, 'LOT-2026-A');
  assert.equal((await requester('GET', '/api/requests?type=voc&scope=intake')).body.some(row => row.id === voc.id), true);
  assert.equal((await requester('GET', '/api/requests?type=voc&scope=list')).body.length, 0);
  assert.equal((await requester('PUT', `/api/attachments/request/${voc.id}`, { photos: [photo] })).status, 200);
  const attachment = (await other('GET', `/api/attachments/request/${voc.id}`)).body;
  assert.equal(attachment.photos.length, 1);
  assert.equal((await anon('GET', '/uploads/' + attachment.photos[0])).status, 401);
  assert.equal((await requester('GET', '/uploads/' + attachment.photos[0])).status, 200);
  assert.equal((await other('PUT', `/api/attachments/request/${voc.id}`, { photos: [photo] })).status, 403);
  const unknownLot = await other('POST', '/api/requests', { ...body('LOT 미확인'), data: { qty: 1.5, unit: 'kg', lot: '', extra: '원단 오염' } });
  assert.equal(unknownLot.status, 200); assert.equal(unknownLot.body.data.qty, 1.5); assert.equal(unknownLot.body.data.lot, '');
});

test('Only quality leader or administrator approves VOC, then quality staff process waiting/progress/done', async () => {
  for (const caller of [requester, other, quality, dev]) {
    assert.equal((await caller('POST', `/api/requests/${voc.id}/approve`)).status, 403);
    assert.equal((await caller('POST', `/api/requests/${voc.id}/reject`, { reason: '반려' })).status, 403);
  }
  assert.equal((await quality('POST', `/api/requests/${voc.id}/status`, { status: 'progress' })).status, 400);
  const approved = await leader('POST', `/api/requests/${voc.id}/approve`);
  assert.equal(approved.body.status, 'waiting'); assert.equal(approved.body.approver_name, '품질팀장'); assert.match(approved.body.req_no, /^V-\d{6}-\d+$/);
  assert.equal((await leader('POST', `/api/requests/${voc.id}/approve`)).status, 400);
  assert.equal((await requester('GET', '/api/requests?type=voc&scope=intake')).body.some(row => row.id === voc.id), false);
  assert.equal((await requester('GET', '/api/requests?type=voc&scope=list')).body.some(row => row.id === voc.id), true);
  assert.equal((await requester('POST', `/api/requests/${voc.id}/status`, { status: 'done' })).status, 403);
  assert.equal((await quality('POST', `/api/requests/${voc.id}/status`, { status: 'progress' })).body.status, 'progress');
  assert.equal((await leader('POST', `/api/requests/${voc.id}/status`, { status: 'done', result_note: '고객사 교환 완료' })).body.status, 'done');
  assert.equal((await quality('GET', `/api/attachments/request/${voc.id}`)).body.photos.length, 1);
  assert.equal((await requester('PUT', `/api/attachments/request/${voc.id}`, { photos: [photo] })).status, 403);
  assert.equal((await quality('PUT', `/api/attachments/request/${voc.id}`, { photos: [photo], note: '교환 처리 증빙' })).status, 200);
  assert.equal((await requester('POST', `/api/comments/request/${voc.id}`, { content: '고객사에 처리 완료 안내했습니다.' })).status, 200);
  assert.equal((await other('GET', `/api/comments/request/${voc.id}`)).body.rows[0].author_name, '구매직원');
});

test('VOC rejection, author correction and resubmission retain evidence and comments', async () => {
  const row = (await requester('POST', '/api/requests', body('재접수'))).body;
  await requester('PUT', `/api/attachments/request/${row.id}`, { photos: [photo] });
  await leader('POST', `/api/comments/request/${row.id}`, { content: 'LOT 확인 후 다시 접수 바랍니다.' });
  const rejected = await leader('POST', `/api/requests/${row.id}/reject`, { reason: 'LOT 확인 필요' });
  assert.equal(rejected.body.status, 'rejected'); assert.equal(rejected.body.reject_reason, 'LOT 확인 필요');
  assert.equal((await other('PUT', `/api/requests/${row.id}`, body('무단수정'))).status, 403);
  const edited = await requester('PUT', `/api/requests/${row.id}`, { ...body('수정완료'), data: { ...body('').data, lot: 'LOT-CORRECTED' } });
  assert.equal(edited.body.status, 'pending'); assert.equal(edited.body.data.lot, 'LOT-CORRECTED');
  const approved = await leader('POST', `/api/requests/${row.id}/approve`);
  assert.equal(approved.body.status, 'waiting');
  assert.equal((await requester('GET', `/api/attachments/request/${row.id}`)).body.photos.length, 1);
  assert.equal((await requester('GET', `/api/comments/request/${row.id}`)).body.rows.length, 1);
});

test('VOC filters search customer, product, LOT and complaint and preserve dashboard and backup integration', async () => {
  const date = voc.created_at.slice(0, 10);
  for (const keyword of ['LOT-2026-A','고객사 A','포장 파손','제품 접수']) {
    const rows = (await requester('GET', '/api/requests?' + new URLSearchParams({ type: 'voc', q: keyword, from: date, to: date, status: 'done' }))).body;
    assert.ok(rows.some(row => row.id === voc.id));
  }
  assert.equal((await requester('GET', '/api/requests?type=analysis')).body.some(row => row.id === voc.id), false);
  const counter = (await requester('GET', '/api/dashboard')).body.requests.voc;
  assert.equal(counter.done, 1); assert.ok(counter.pending >= 1); assert.ok(counter.waiting >= 1);
  const backup = (await admin('GET', '/api/admin/backup?table=requests')).body.rows.find(row => row.id === voc.id);
  assert.equal(backup.type, 'voc'); assert.equal(JSON.parse(backup.data).qty, 20);
  assert.ok((await admin('GET', '/api/admin/backup?table=attachments')).body.rows.some(row => row.entity_id === voc.id));
  assert.ok((await admin('GET', '/api/admin/backup?table=progress_comments')).body.rows.some(row => row.entity_id === voc.id));
});
