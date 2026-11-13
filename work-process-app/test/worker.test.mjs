import approvedRegistration from './helpers.cjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import { DatabaseSync } from 'node:sqlite';
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
  assert.equal(results.filter(r => r.body.user?.is_admin).length, 1);
  if (!results[0].body.user?.is_admin) [admin, staff] = [staff, admin];
  const bootstrap = results.find(r => r.body.user?.is_admin);
  const pending = results.find(r => r.body.pending);
  assert.equal(pending.headers.get('set-cookie'), null);
  assert.equal((await admin('POST', `/api/admin/users/${pending.body.account.id}/approval`, { status: 'approved' })).status, 200);
  assert.equal((await staff('POST', '/api/auth/login', { name: pending.body.account.name, password: 'password' })).status, 200);
  assert.match(bootstrap.headers.get('set-cookie'), /^wpa_sid=.*HttpOnly.*SameSite=None; Secure; Partitioned/);
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
  const html = await page.text();
  assert.match(html, /서울세미텍 시스템/);
  for (const [, src] of html.matchAll(/<script src="([^"]+)"/g)) assert.equal((await built.fetch(new Request('https://work.test' + src), env)).status, 200, src);
  const report = await built.fetch(new Request('https://work.test/api/reports?from=2026-11-01&to=2026-11-13'), env);
  assert.equal(report.status, 401);
  const session = sqlite.prepare('SELECT token FROM sessions LIMIT 1').get();
  const authenticatedReport = await built.fetch(new Request('https://work.test/api/reports?from=2026-11-01&to=2026-11-13', { headers: { Cookie: 'wpa_sid=' + session.token } }), env);
  assert.equal(authenticatedReport.status, 200);
  assert.equal((await authenticatedReport.json()).range.timezone, 'Asia/Seoul');
  const logo = await built.fetch(new Request('https://work.test/assets/seoulsemi-logo-blue.png'), env);
  assert.equal(logo.headers.get('content-type'), 'image/png');
  assert.deepEqual([...new Uint8Array(await logo.arrayBuffer()).slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test('Purchasing classification and COA checkbox persist through edits and receipts', async () => {
  const body = { req_no: 'COA-01', vendor: '공급사', item: '품목', qty: 4, due_date: '2026-11-20', item_category: '원자재', coa_requested: ['1'] };
  const created = await staff('POST', '/api/po', body);
  assert.equal(created.status, 200); assert.equal(created.body.coa_requested, 1); assert.equal(created.body.item_category, '원자재');
  const id = created.body.id;
  const filtered = await staff('GET', '/api/po?item_category=' + encodeURIComponent('원자재'));
  assert.ok(filtered.body.some(r => r.id === id));
  assert.equal((await staff('PUT', '/api/po/' + id, { ...body, coa_requested: [], item_category: '상품' })).body.coa_requested, 0);
  assert.equal((await staff('POST', '/api/po/receive', { ids: [id], status: 'ok' })).status, 200);
  const received = (await staff('GET', '/api/po?recv=ok')).body.find(r => r.id === id);
  assert.equal(received.item_category, '상품'); assert.equal(received.coa_requested, 0);
  for (const item_category of ['제품', '상품', '원자재', '부자재']) assert.equal((await staff('POST', '/api/po', { ...body, item_category })).status, 200);
  assert.equal((await staff('POST', '/api/po', { ...body, item_category: '잘못된 분류' })).status, 400);
  assert.equal((await staff('POST', '/api/po', { ...body, coa_requested: 'false' })).status, 400);
});

test('Other receipts support classification, filters and logistics authorization', async () => {
  const catalog = (await admin('POST', '/api/boms', { product: '발주 없는 샘플', item_category: '부자재', kind: 'finished', base_qty: 1, unit: 'EA', materials: [] })).body;
  const body = { bom_id: catalog.id, received_date: '2026-11-13', item: '발주 없는 샘플', item_category: '부자재', qty: 10, vendor: '기타입고처', note: '무상 제공' };
  assert.equal((await anon('POST', '/api/other-receipts', body)).status, 401);
  const created = await staff('POST', '/api/other-receipts', body);
  assert.equal(created.status, 200); assert.equal(created.body.item_category, '부자재');
  const id = created.body.id;
  assert.equal((await staff('GET', '/api/other-receipts?from=2026-11-13&to=2026-11-13&q=' + encodeURIComponent('기타입고처'))).body.length, 1);
  assert.equal((await staff('GET', '/api/other-receipts?item_category=' + encodeURIComponent('제품'))).body.length, 0);
  assert.equal((await staff('POST', '/api/other-receipts', { ...body, bom_id: '' })).status, 400);
  assert.equal((await staff('POST', '/api/other-receipts', { ...body, qty: -1 })).status, 400);
  const other = client();
  const account = await approvedRegistration(admin, other, { name: '물류담당', password: 'password', invite: 'test-invite' });
  assert.equal((await other('PUT', '/api/other-receipts/' + id, body)).status, 403);
  assert.equal((await other('DELETE', '/api/other-receipts/' + id)).status, 403);
  assert.equal((await admin('PUT', '/api/admin/users/' + account.body.user.id, { roles: ['logistics'] })).status, 200);
  assert.equal((await other('PUT', '/api/other-receipts/' + id, { ...body, item_category: '제품', qty: 12 })).body.qty, 12);
  const tables = (await admin('GET', '/api/admin/backup')).body.tables;
  assert.ok(tables.includes('other_receipts'));
  assert.equal((await admin('GET', '/api/admin/backup?table=other_receipts')).body.rows[0].id, id);
  assert.equal((await other('DELETE', '/api/other-receipts/' + id)).status, 200);
});

test('Shipment LOT persists on create, list and edit', async () => {
  const body = { ship_date: '2026-11-13', item: 'LOT 테스트', qty: 2, customer: '거래처', lot: 'LOT-2026-A' };
  const row = await staff('POST', '/api/shipments', body);
  assert.equal(row.status, 200); assert.equal(row.body.lot, 'LOT-2026-A');
  assert.equal((await staff('PUT', '/api/shipments/' + row.body.id, { ...body, lot: 'LOT-2026-B' })).body.lot, 'LOT-2026-B');
  assert.equal((await staff('GET', '/api/shipments?from=2026-11-13')).body.find(r => r.id === row.body.id).lot, 'LOT-2026-B');
});

test('Append-only migration preserves existing orders, shipments and accounts', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpa-migration-'));
  const old = new DatabaseSync(path.join(dataDir, 'app.db'));
  old.exec(fs.readFileSync(new URL('../drizzle/0000_work_process.sql', import.meta.url), 'utf8'));
  old.exec("CREATE TABLE _local_migrations(name TEXT PRIMARY KEY); INSERT INTO _local_migrations VALUES('0000_work_process.sql'); INSERT INTO users(name,pw_salt,pw_hash,is_admin) VALUES('기존관리자','salt','hash',1); INSERT INTO purchase_orders(req_no,vendor,item,qty) VALUES('OLD','공급사','기존품목',3); INSERT INTO shipments(ship_date,item,qty,customer) VALUES('2026-11-12','기존출하',4,'거래처');");
  old.close();
  const { sqlite: upgraded } = localEnvironment(dataDir, 'test-invite');
  try {
    assert.equal(upgraded.prepare('SELECT COUNT(*) c FROM users').get().c, 1);
    const order = upgraded.prepare('SELECT * FROM purchase_orders').get();
    assert.equal(order.item, '기존품목'); assert.equal(order.item_category, ''); assert.equal(order.coa_requested, 0);
    assert.equal(upgraded.prepare('SELECT * FROM shipments').get().lot, '');
    assert.equal(upgraded.prepare('SELECT COUNT(*) c FROM other_receipts').get().c, 0);
  } finally { upgraded.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
});
