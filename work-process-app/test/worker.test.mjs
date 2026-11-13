import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpa-worker-'));
let env, sqlite, admin, staff, anon;
function client() {
  let cookie = '';
  return async (method, url, body, headers = {}) => {
    const response = await worker.fetch(new Request('https://work.test' + url, {
      method, headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), env);
    if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, body: data, headers: response.headers };
  };
}
before(() => {
  ({ env, sqlite } = localEnvironment(dir, 'test-invite'));
  admin = client(); staff = client(); anon = client();
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('Worker health, static assets and method boundaries', async () => {
  assert.deepEqual((await anon('GET', '/api/me')).body, { user: null });
  assert.equal((await anon('GET', '/style.css')).status, 200);
  assert.equal((await anon('HEAD', '/')).body, '');
  assert.equal((await anon('POST', '/')).status, 405);
  assert.equal((await anon('GET', '/missing.js')).status, 404);
});
test('Concurrent registration assigns exactly one administrator', async () => {
  const results = await Promise.all([admin('POST', '/api/auth/register', { name: '관리자', password: 'password', invite: 'test-invite' }), staff('POST', '/api/auth/register', { name: '담당자', password: 'password', invite: 'test-invite' })]);
  assert.ok(results.every(r => r.status === 200));
  assert.equal(results.filter(r => r.body.user.is_admin).length, 1);
  if (!results[0].body.user.is_admin) [admin, staff] = [staff, admin];
  assert.match(results[0].headers.get('set-cookie'), /HttpOnly.*SameSite=Lax.*Secure/);
  env.INVITE_CODE = 'changed-in-env';
  assert.equal((await anon('POST', '/api/auth/register', { name: '새 사용자', password: 'password', invite: 'changed-in-env' })).status, 400);
});
test('Login, password change, logout and persistent throttling', async () => {
  const user = client();
  assert.equal((await user('POST', '/api/auth/login', { name: '담당자', password: 'wrong' })).status, 401);
  assert.equal((await user('POST', '/api/auth/login', { name: '담당자', password: 'password' })).status, 200);
  assert.equal((await user('PUT', '/api/me/password', { current: 'password', password: 'new-password' })).status, 200);
  assert.equal((await user('POST', '/api/auth/logout')).status, 200);
  assert.equal((await user('GET', '/api/me')).body.user, null);
  assert.equal((await user('POST', '/api/auth/login', { name: '담당자', password: 'new-password' })).status, 200);
  for (let i = 0; i < 5; i++) assert.equal((await client()('POST', '/api/auth/login', { name: 'unknown', password: 'wrong' })).status, 401);
  assert.equal((await client()('POST', '/api/auth/login', { name: 'unknown', password: 'wrong' })).status, 429);
});
test('Cross-origin writes and malformed JSON are rejected', async () => {
  assert.equal((await admin('PUT', '/api/admin/invite', { invite_code: 'hacked' }, { origin: 'https://other.test' })).status, 403);
  const response = await worker.fetch(new Request('https://work.test/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }), env);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /요청 형식/);
});
test('Concurrent approval produces unique numbers and a single transition', async () => {
  const rows = await Promise.all(Array.from({ length: 4 }, (_, i) => admin('POST', '/api/requests', { type: 'sample', title: '샘플 ' + i })));
  const approved = await Promise.all(rows.map(r => admin('POST', `/api/requests/${r.body.id}/approve`)));
  assert.ok(approved.every(r => r.status === 200));
  assert.equal(new Set(approved.map(r => r.body.req_no)).size, 4);
  const row = await admin('POST', '/api/requests', { type: 'sample', title: '한 번만 승인' });
  const repeated = await Promise.all([admin('POST', `/api/requests/${row.body.id}/approve`), admin('POST', `/api/requests/${row.body.id}/approve`)]);
  assert.deepEqual(repeated.map(r => r.status).sort(), [200, 400]);
  assert.equal((await admin('GET', '/api/dashboard')).status, 200);
});
test('R2 access, failed edits, deletion and paginated administrator backups', async () => {
  const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const row = await staff('POST', '/api/laundry', { in_date: '2026-11-13', discard_qty: 2, photos: [photo] });
  const list = (await staff('GET', '/api/laundry')).body;
  const file = list.find(r => r.id === row.body.id).photos[0];
  assert.equal((await anon('GET', '/uploads/' + file)).status, 401);
  const image = await staff('GET', '/uploads/' + file);
  assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal((await staff('PUT', '/api/laundry/' + row.body.id, { in_date: 'invalid', discard_qty: 2, keep_photos: [] })).status, 400);
  assert.equal((await staff('GET', '/uploads/' + file)).status, 200);
  assert.equal((await staff('GET', '/api/admin/backup')).status, 403);
  assert.equal((await anon('GET', '/api/admin/backup')).status, 401);
  const backup = await admin('GET', '/api/admin/backup');
  assert.equal(backup.body.format, 'work-process-v2'); assert.ok(!backup.body.tables.includes('sessions'));
  assert.equal((await admin('GET', '/api/admin/backup?table=sessions')).status, 400);
  for (let i = 0; i < 205; i++) sqlite.prepare('INSERT INTO shipments(ship_date,item,qty,customer) VALUES(?,?,?,?)').run('2026-11-13', '품목', 1, '거래처');
  const page1 = (await admin('GET', '/api/admin/backup?table=shipments')).body;
  assert.equal(page1.rows.length, 200);
  const page2 = (await admin('GET', '/api/admin/backup?table=shipments&after=' + page1.next)).body;
  assert.equal(page2.rows.length, 5); assert.equal(page2.next, null);
  assert.equal((await staff('DELETE', '/api/laundry/' + row.body.id)).status, 200);
  assert.equal((await staff('GET', '/uploads/' + file)).status, 404);
});
test('Built artifact is self-contained and uses the same D1/R2 API', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root });
  const source = fs.readFileSync(path.join(root, 'dist/server/index.js'), 'utf8');
  assert.doesNotMatch(source, /from ['"]node:|require\(|process\.env|fs\./);
  const { default: built } = await import('../dist/server/index.js');
  assert.equal((await built.fetch(new Request('https://work.test/api/me'), env)).status, 200);
  const page = await built.fetch(new Request('https://work.test/'), env);
  assert.match(await page.text(), /업무프로세스 허브/);
});
