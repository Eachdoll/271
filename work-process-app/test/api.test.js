const approvedRegistration = require('./helpers.cjs');
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wpa-'));
process.env.INVITE_CODE = 'sst3554766';
const { server } = require('../server.js');
let base;
before(() => new Promise((r) => server.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
after(() => { server.close(); fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}
const admin = client(); const user = client(); const anon = client();

test('가입: 초대코드 필요, 첫 가입자는 관리자', async () => {
  assert.equal((await admin('POST', '/api/auth/register', { name: '이치원', password: '0000', invite: 'wrong' })).status, 400);
  const r = await admin('POST', '/api/auth/register', { name: '이치원', password: '0000', invite: 'sst3554766' });
  assert.equal(r.status, 200); assert.equal(r.body.user.is_admin, true);
  const u = await approvedRegistration(admin, user, { name: '김품질', password: '1234', invite: 'sst3554766' });
  assert.equal(u.body.user.is_admin, false);
  assert.equal((await anon('GET', '/api/po')).status, 401);
});

test('관리자가 초대코드 변경', async () => {
  assert.equal((await user('PUT', '/api/admin/invite', { invite_code: 'abcd1234' })).status, 403);
  assert.equal((await admin('PUT', '/api/admin/invite', { invite_code: 'abcd1234' })).status, 200);
  assert.equal((await anon('POST', '/api/auth/register', { name: '박', password: '0000', invite: 'sst3554766' })).status, 400);
  assert.equal((await anon('POST', '/api/auth/register', { name: '박', password: '0000', invite: 'abcd1234' })).status, 200);
});

test('발주 → 물류 입고확인 색상 상태', async () => {
  const a = (await admin('POST', '/api/po', { item_category: '상품', req_no: 'PR-001', vendor: 'A상사', item: '니트릴 글러브', qty: 100, due_date: '2026-11-20' })).body;
  const b = (await admin('POST', '/api/po', { item_category: '원자재', req_no: 'PR-002', vendor: 'B상사', item: '와이퍼', qty: 50, due_date: '2026-11-21' })).body;
  assert.equal((await user('POST', '/api/po/receive', { ids: [a.id], status: 'ok' })).status, 200);
  assert.equal((await user('POST', '/api/po/receive', { ids: [b.id], status: 'mismatch' })).status, 400); // 수량 필요
  assert.equal((await user('POST', '/api/po/receive', { ids: [b.id], status: 'mismatch', recv_qty: 45 })).status, 200);
  const list = (await admin('GET', '/api/po')).body;
  assert.equal(list.find((p) => p.id === a.id).recv_status, 'ok');
  const pb = list.find((p) => p.id === b.id); assert.equal(pb.recv_status, 'mismatch'); assert.equal(pb.recv_qty, 45);
  await user('POST', '/api/po/receive', { ids: [b.id], status: 'checking' });
  assert.equal((await admin('GET', '/api/po?recv=checking')).body.length, 1);
});

test('분석의뢰: 누구나 의뢰 → 품질책임자 승인 → 분석리스트', async () => {
  const me = (await user('GET', '/api/me')).body.user;
  const r = (await user('POST', '/api/requests', { type: 'analysis', title: '니트릴 글러브', category: '수입검사', data: { items: ['외관', '파티클'] } })).body;
  assert.equal(r.status, 'pending'); assert.equal(r.requester_name, '김품질');
  assert.equal((await user('POST', `/api/requests/${r.id}/approve`)).status, 403); // 권한 없음
  await admin('PUT', `/api/admin/users/${me.id}`, { roles: ['quality'] });
  assert.equal((await user('POST', `/api/requests/${r.id}/approve`)).status, 403); // 일반 품질담당자는 승인 불가
  await admin('PUT', `/api/admin/users/${me.id}`, { roles: ['quality', 'quality_approver'] });
  const ok = (await user('POST', `/api/requests/${r.id}/approve`)).body;
  assert.equal(ok.status, 'waiting'); assert.match(ok.req_no, /^Q-\d{6}-\d+$/);
  assert.equal((await user('GET', '/api/requests?type=analysis&scope=intake')).body.length, 0);
  assert.ok((await user('GET', '/api/requests?type=analysis&scope=list&category=수입검사')).body.some(row => row.id === r.id));
  assert.equal((await user('POST', `/api/requests/${r.id}/status`, { status: 'progress' })).body.status, 'progress');
  // 개발의뢰는 연구소(dev) 권한 필요
  const d = (await user('POST', '/api/requests', { type: 'development', title: '블루 글러브', target_price: '8~9만원/BOX' })).body;
  assert.equal((await user('POST', `/api/requests/${d.id}/approve`)).status, 403);
  assert.equal((await admin('POST', `/api/requests/${d.id}/approve`)).body.req_no.startsWith('D-'), true);
  assert.equal((await user('POST', '/api/requests', { type: 'development', title: 'x' })).status, 400); // 타겟단가 필수
});

test('생산일정: 일/주/월 기간 겹침 조회', async () => {
  await admin('POST', '/api/schedules', { kind: 'finished', period: 'day', start_date: '2026-11-12', product: 'A', qty: 10 });
  const w = (await admin('POST', '/api/schedules', { kind: 'finished', period: 'week', start_date: '2026-11-13', product: 'B', qty: 70 })).body;
  assert.equal(w.start_date, '2026-11-09'); // 월요일로 정규화
  await admin('POST', '/api/schedules', { kind: 'finished', period: 'month', start_date: '2026-11-25', product: 'C', qty: 300 });
  await admin('POST', '/api/schedules', { kind: 'semi', period: 'day', start_date: '2026-11-12', product: 'S', qty: 5 });
  const day = (await admin('GET', '/api/schedules?kind=finished&from=2026-11-12&to=2026-11-12')).body;
  assert.deepEqual(day.map((s) => s.product).sort(), ['A', 'B', 'C']);
  const dec = (await admin('GET', '/api/schedules?kind=finished&from=2026-12-01&to=2026-12-31')).body;
  assert.equal(dec.length, 0);
});

test('세탁관리 사진 업로드 / 출하목록', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const r = await user('POST', '/api/laundry', { in_date: '2026-11-13', discard_qty: 3, photos: [png] });
  assert.equal(r.status, 200);
  const list = (await user('GET', '/api/laundry')).body; assert.equal(list[0].photos.length, 1);
  assert.equal((await client()('GET', '/api/laundry')).status, 401);
  const img = await fetch(`${base}/uploads/${list[0].photos[0]}`); assert.equal(img.status, 401);
  await user('POST', '/api/shipments', { ship_date: '2026-11-13', item: '글러브', qty: 20, customer: '램리서치' });
  assert.equal((await user('GET', '/api/shipments?from=2026-11-13')).body.length, 1);
});
