// 15.62 사람별 화면 설정: 자주 쓰는 화면·목록 조건 저장(/api/me/prefs), 로그인 응답의 ui, 검증, 사용자 삭제 시 정리.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prefs-'));
const { env, sqlite } = localEnvironment(dir, 'prefs-test');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await worker.fetch(new Request('https://prefs.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}
const admin = client(), staff = client(), other = client();
before(async () => {
  await approvedRegistration(admin, admin, { name: '관리자', password: 'password', invite: 'prefs-test' });
  await approvedRegistration(admin, staff, { name: '직원', password: 'password', invite: 'prefs-test' });
  await approvedRegistration(admin, other, { name: '다른직원', password: 'password', invite: 'prefs-test' });
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('Favorites and remembered list filters are kept per person and come back with the login', async () => {
  assert.deepEqual((await staff('GET', '/api/me')).body.user.ui, { favorites: [], filters: {} });
  const saved = await staff('PUT', '/api/me/prefs', { favorites: [{ href: '#/purchase/po/new', label: '발주 입력' }] });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  await staff('PUT', '/api/me/prefs', { filters: { '#/sales/mr:mrFilters': [['status', 'waiting'], ['mine', true]] } });
  await staff('PUT', '/api/me/prefs', { filters: { '#/purchase/po:poFilters': [['item_category', '부자재']] } });
  const me = (await staff('POST', '/api/auth/login', { name: '직원', password: 'password' })).body.user.ui;
  assert.deepEqual(me.favorites, [{ href: '#/purchase/po/new', label: '발주 입력' }]);
  assert.deepEqual(Object.keys(me.filters).sort(), ['#/purchase/po:poFilters', '#/sales/mr:mrFilters'], 'filters merge by key');
  await staff('PUT', '/api/me/prefs', { filters: { '#/purchase/po:poFilters': null } });
  assert.deepEqual(Object.keys((await staff('GET', '/api/me')).body.user.ui.filters), ['#/sales/mr:mrFilters'], 'null removes a remembered list');
  assert.deepEqual((await other('GET', '/api/me')).body.user.ui.favorites, [], 'other people are not affected');
});

test('Bad settings are refused; deleting a user removes their settings', async () => {
  for (const body of [{ favorites: [{ href: 'https://evil.example', label: 'x' }] }, { favorites: Array(21).fill({ href: '#/', label: '홈' }) }, { filters: { k: [['a', { x: 1 }]] } }, { filters: [] }]) {
    assert.equal((await staff('PUT', '/api/me/prefs', body)).status, 400, JSON.stringify(body));
  }
  await other('PUT', '/api/me/prefs', { favorites: [{ href: '#/', label: '홈' }] });
  const id = (await admin('GET', '/api/admin/users')).body.find(u => u.name === '다른직원').id;
  assert.ok(sqlite.prepare('SELECT 1 FROM settings WHERE key=?').get('prefs:' + id));
  assert.equal((await admin('DELETE', `/api/admin/users/${id}`)).status, 200);
  assert.equal(sqlite.prepare('SELECT 1 FROM settings WHERE key=?').get('prefs:' + id), undefined);
});

test('15.220 design skin is saved per person and validated', async () => {
  assert.equal((await staff('PUT', '/api/me/prefs', { skin: 'christmas' })).body.skin, 'christmas');
  assert.equal((await staff('GET', '/api/me')).body.user.ui.skin, 'christmas');
  assert.equal((await admin('GET', '/api/me')).body.user.ui.skin, undefined, 'another person keeps the default');
  assert.equal((await staff('PUT', '/api/me/prefs', { skin: 'neon' })).status, 400);
  assert.equal((await staff('PUT', '/api/me/prefs', { skin: 'default' })).body.skin, 'default');
  assert.ok(Array.isArray((await staff('GET', '/api/me')).body.user.ui.favorites), 'other prefs stay');
});
