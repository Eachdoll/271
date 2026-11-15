// 15.59 메뉴 열람 권한: 기존 사용자는 전체, 부서 기본(상위 부서 상속)·전체·직접 지정, 관리자는 항상 전체.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-'));
const { env, sqlite } = localEnvironment(dir, 'menu-test');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await worker.fetch(new Request('https://menu.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}
const admin = client(), sales = client(), team = client(), lab = client();
const ids = {}, dept = {};
before(async () => {
  for (const [c, name] of [[admin, '관리자'], [sales, '영업'], [team, '영업1팀원'], [lab, '연구원']]) await approvedRegistration(admin, c, { name, password: 'password', invite: 'menu-test' });
  for (const u of (await admin('GET', '/api/admin/users')).body) ids[u.name] = u.id;
  dept.hq = (await admin('POST', '/api/admin/org/departments', { name: '영업본부' })).body;
  dept.team = (await admin('POST', '/api/admin/org/departments', { name: '영업1팀', parent_id: dept.hq.id })).body;
  dept.lab = (await admin('POST', '/api/admin/org/departments', { name: '연구소' })).body;
  await admin('PUT', `/api/admin/users/${ids['영업']}`, { department: '영업본부' });
  await admin('PUT', `/api/admin/users/${ids['영업1팀원']}`, { department: '영업1팀' });
  await admin('PUT', `/api/admin/users/${ids['연구원']}`, { department: '연구소' });
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const me = async c => (await c('GET', '/api/me')).body.user;

test('Nothing is limited until a department or a person is set', async () => {
  for (const c of [admin, sales, team, lab]) assert.equal((await me(c)).menus, null);
  assert.equal((await me(sales)).menu_mode, 'department');
});

test('Department defaults apply to members and flow down to sub-departments that have none', async () => {
  const saved = await admin('PUT', `/api/admin/org/departments/${dept.hq.id}`, { menus: ['sales', 'purchase', 'logistics'] });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual((await me(sales)).menus, ['sales', 'purchase', 'logistics']);
  assert.deepEqual((await me(team)).menus, ['sales', 'purchase', 'logistics'], 'sub-department inherits');
  await admin('PUT', `/api/admin/org/departments/${dept.team.id}`, { menus: ['sales'] });
  assert.deepEqual((await me(team)).menus, ['sales'], 'its own setting wins');
  assert.equal((await me(lab)).menus, null, 'other departments stay unlimited');
  await admin('PUT', `/api/admin/org/departments/${dept.lab.id}`, { menus: [] });
  assert.deepEqual((await me(lab)).menus, [], 'home only');
  assert.equal((await me(admin)).menus, null, 'administrators always see everything');
  const anonymous = client();
  assert.ok((await anonymous('GET', '/api/org')).body.departments.every(d => !('menus' in d)), 'the sign-up list does not expose menu settings');
  const org = (await admin('GET', '/api/admin/org')).body.departments.find(d => d.id === dept.hq.id);
  assert.deepEqual(org.menus, ['sales', 'purchase', 'logistics']);
  assert.equal((await admin('PUT', `/api/admin/org/departments/${dept.hq.id}`, { menus: ['payroll'] })).status, 400);
  await admin('PUT', `/api/admin/org/departments/${dept.team.id}`, { menus: null });
  assert.deepEqual((await me(team)).menus, ['sales', 'purchase', 'logistics'], 'clearing returns to the parent setting');
});

test('A person can show everything or pick menus directly', async () => {
  await admin('PUT', `/api/admin/users/${ids['연구원']}`, { menu_mode: 'all' });
  assert.equal((await me(lab)).menus, null);
  const custom = (await admin('PUT', `/api/admin/users/${ids['연구원']}`, { menu_mode: 'custom', menus: ['dev', 'quality', 'master'] })).body;
  assert.deepEqual([custom.menu_mode, custom.menu_custom], ['custom', ['quality', 'dev', 'master']]);
  assert.deepEqual((await me(lab)).menus, ['quality', 'dev', 'master']);
  assert.equal((await admin('PUT', `/api/admin/users/${ids['연구원']}`, { menu_mode: 'boss' })).status, 400);
  await admin('PUT', `/api/admin/users/${ids['연구원']}`, { menu_mode: 'department' });
  assert.deepEqual((await me(lab)).menus, [], 'back to the department default');
  assert.equal((await admin('POST', '/api/auth/login', { name: '연구원', password: 'password' })).body.user.menus.length, 0, 'login returns the menus too');
});
