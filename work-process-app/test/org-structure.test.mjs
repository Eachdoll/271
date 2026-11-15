// 조직 구성: 부서(상·하위)·직급(서열) 관리, 가입 시 선택, 이름 변경 전파, 삭제 보호, 구매의뢰의 의뢰부서 자동.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'org-'));
const { env, sqlite } = localEnvironment(dir, 'org-test');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await worker.fetch(new Request('https://org.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}
const admin = client(), staff = client(), guest = client();
const org = {};
before(async () => {
  await approvedRegistration(admin, admin, { name: '관리자', password: 'password', invite: 'org-test' });
  await approvedRegistration(admin, staff, { name: '직원', password: 'password', invite: 'org-test' });
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('Admins build departments (with parents) and ranked positions; others cannot', async () => {
  assert.equal((await staff('POST', '/api/admin/org/departments', { name: '영업본부' })).status, 403);
  org.hq = (await admin('POST', '/api/admin/org/departments', { name: '영업본부' })).body;
  org.sales = (await admin('POST', '/api/admin/org/departments', { name: '전략영업부', parent_id: org.hq.id })).body;
  org.qa = (await admin('POST', '/api/admin/org/departments', { name: '품질팀' })).body;
  assert.equal(org.sales.parent_id, org.hq.id);
  assert.equal((await admin('POST', '/api/admin/org/departments', { name: '품질팀' })).status, 409);
  assert.equal((await admin('PUT', `/api/admin/org/departments/${org.hq.id}`, { parent_id: org.sales.id })).status, 400, 'no cycles');
  for (const name of ['사원', '대리', '과장', '부장', '대표이사']) org[name] = (await admin('POST', '/api/admin/org/positions', { name })).body;
  assert.equal((await admin('POST', '/api/admin/org/positions', { name: '' })).status, 400);
  let lists = (await admin('POST', `/api/admin/org/positions/${org['부장'].id}/move`, { dir: -1 })).body;
  assert.deepEqual(lists.positions.map(p => p.name), ['사원', '대리', '부장', '과장', '대표이사']);
  lists = (await admin('POST', `/api/admin/org/positions/${org['부장'].id}/move`, { dir: 1 })).body;
  assert.deepEqual(lists.positions.map(p => p.name), ['사원', '대리', '과장', '부장', '대표이사']);
  const pub = (await guest('GET', '/api/org')).body;
  assert.deepEqual(pub.departments.map(d => d.name), ['영업본부', '전략영업부', '품질팀'], 'the signup screen can read the lists');
});

test('Signup must pick a department and position from the lists', async () => {
  const base = { name: '신입', password: 'password', invite: 'org-test' };
  let r = await guest('POST', '/api/auth/register', base);
  assert.equal(r.status, 400); assert.match(r.body.error, /부서/);
  r = await guest('POST', '/api/auth/register', { ...base, department: '없는부서', position: '사원' });
  assert.equal(r.status, 400); assert.match(r.body.error, /조직 구성에 없거나/);
  r = await guest('POST', '/api/auth/register', { ...base, department: '전략영업부', position: '사원' });
  assert.equal(r.status, 200); assert.equal(r.body.pending, true);
  const made = (await admin('GET', '/api/admin/users')).body.find(u => u.name === '신입');
  assert.deepEqual([made.department, made.position], ['전략영업부', '사원']);
  const created = await admin('POST', '/api/admin/users', { name: '경력', password: 'password', department: '품질팀', position: '과장' });
  assert.deepEqual([created.body.department, created.body.position], ['품질팀', '과장']);
  assert.equal((await admin('PUT', `/api/admin/users/${created.body.id}`, { position: '상무' })).status, 400, 'admin edits also use the lists');
});

test('Renaming moves users along; used or parent entries cannot be deleted, only stopped', async () => {
  await admin('PUT', `/api/admin/org/departments/${org.sales.id}`, { name: '전략영업팀' });
  const moved = (await admin('GET', '/api/admin/users')).body.find(u => u.name === '신입');
  assert.equal(moved.department, '전략영업팀');
  let r = await admin('DELETE', `/api/admin/org/departments/${org.sales.id}`);
  assert.equal(r.status, 400); assert.match(r.body.error, /사용자가 1명/);
  r = await admin('DELETE', `/api/admin/org/departments/${org.hq.id}`);
  assert.equal(r.status, 400); assert.match(r.body.error, /하위 부서/);
  await admin('PUT', `/api/admin/org/departments/${org.qa.id}`, { active: false });
  assert.ok(!(await guest('GET', '/api/org')).body.departments.some(d => d.name === '품질팀'), 'stopped entries leave the signup list');
  assert.equal((await guest('POST', '/api/auth/register', { name: '또신입', password: 'password', invite: 'org-test', department: '품질팀', position: '사원' })).status, 400);
  const empty = (await admin('POST', '/api/admin/org/departments', { name: '임시팀' })).body;
  assert.equal((await admin('DELETE', `/api/admin/org/departments/${empty.id}`)).status, 200);
});

test('Importing fills empty lists from what users already have', async () => {
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'org2-')); const second = localEnvironment(d2, 'org2');
  const c = (() => { let cookie = ''; return async (m, u, b) => { const r = await worker.fetch(new Request('https://o2.test' + u, { method: m, headers: { cookie, 'content-type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }), second.env); if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0]; return { status: r.status, body: await r.json().catch(() => null) }; }; })();
  await approvedRegistration(c, c, { name: '관리', password: 'password', invite: 'org2' });
  const u = (await c('POST', '/api/admin/users', { name: 'A', password: 'password' })).body;
  await c('PUT', `/api/admin/users/${u.id}`, { department: '구매팀', position: '대리' }, 'free text is allowed while the lists are empty');
  const lists = (await c('POST', '/api/admin/org-import')).body;
  assert.deepEqual([lists.departments.map(d => d.name), lists.positions.map(p => p.name)], [['구매팀'], ['대리']]);
  second.sqlite.close(); fs.rmSync(d2, { recursive: true, force: true });
});

test('A purchase request takes the author department and position automatically', async () => {
  const boss = (await admin('GET', '/api/admin/users')).body.find(u => u.name === '경력');
  await admin('PUT', `/api/admin/users/${(await admin('GET', '/api/admin/users')).body.find(u => u.name === '직원').id}`, { department: '전략영업팀', position: '대리' });
  const pr = await staff('POST', '/api/purchase-requests', { doc_date: '2026-11-15', department: '아무거나', items: [{ item: '와이퍼', qty: 1 }], approvers: [boss.id] });
  assert.equal(pr.status, 200, JSON.stringify(pr.body));
  assert.deepEqual([pr.body.department, pr.body.author_position], ['전략영업팀', '대리'], 'the typed department is ignored');
});

test('Department-specific positions are admin managed; signup and user edits validate the chosen department', async () => {
  const lab = (await admin('POST', '/api/admin/org/departments', { name: '연구소' })).body;
  const names = ['연구소장', '수석', '선임', '연구원'];
  const endpoint = `/api/admin/org/departments/${lab.id}`;
  assert.equal((await staff('PUT', endpoint, { position_names: names })).status, 403);
  for (const bad of [[], ['수석', '수석'], [' '], ['a'.repeat(31)], '수석', [1]]) assert.equal((await admin('PUT', endpoint, { position_names: bad })).status, 400);
  const beforeUsers = (await admin('GET', '/api/admin/users')).body;
  assert.equal((await admin('PUT', endpoint, { position_names: names })).status, 200);
  assert.deepEqual((await admin('GET', '/api/admin/users')).body, beforeUsers, 'configuration does not change existing users');
  const lists = (await guest('GET', '/api/org')).body;
  assert.deepEqual(lists.departments.find(d => d.id === lab.id).position_names, names);
  const register = (name, department, position) => guest('POST', '/api/auth/register', { name, department, position, password: 'password', invite: 'org-test' });
  assert.equal((await register('연구신입', '연구소', '연구원')).status, 200);
  assert.equal((await register('잘못된직급', '연구소', '과장')).status, 400);
  assert.equal((await register('다른부서', '전략영업팀', '연구원')).status, 400);
  assert.equal((await register('직급누락', '연구소', '')).status, 400);
  const researcher = (await admin('POST', '/api/admin/users', { name: '선임연구자', password: 'password', department: '연구소', position: '선임' })).body;
  assert.equal((await admin('PUT', `/api/admin/users/${researcher.id}`, { department: '전략영업팀' })).status, 400, 'changing department cannot carry an incompatible old position');
  assert.equal((await admin('PUT', `/api/admin/users/${researcher.id}`, { department: '전략영업팀', position: '과장' })).status, 200);
  await admin('PUT', endpoint, { position_names: ['연구소장', '연구원'] });
  const old = (await admin('GET', '/api/admin/users')).body.find(u => u.name === '연구신입');
  assert.equal(old.position, '연구원');
  assert.equal((await admin('PUT', endpoint, { position_names: null })).status, 200);
  assert.equal((await register('공통가입', '연구소', '과장')).status, 200, 'switching to common positions takes effect');
});

test('Common position rename does not rewrite users in departments with their own title system', async () => {
  const dept = (await admin('POST', '/api/admin/org/departments', { name: '독립직급팀' })).body;
  await admin('PUT', `/api/admin/org/departments/${dept.id}`, { position_names: ['과장', '연구원'] });
  const u = (await admin('POST', '/api/admin/users', { name: '독립과장', password: 'password', department: '독립직급팀', position: '과장' })).body;
  const position = (await admin('GET', '/api/admin/org')).body.positions.find(p => p.name === '과장');
  assert.equal((await admin('PUT', `/api/admin/org/positions/${position.id}`, { name: '공통과장' })).status, 200);
  const users = (await admin('GET', '/api/admin/users')).body;
  assert.equal(users.find(x => x.id === u.id).position, '과장');
  assert.equal(users.find(x => x.name === '공통가입').position, '공통과장');
  await admin('PUT', `/api/admin/org/departments/${dept.id}`, { position_names: ['연구원'] });
  assert.equal((await admin('PUT', `/api/admin/users/${u.id}`, { position: '과장' })).status, 200, 'an existing title is preserved after list changes');
});
