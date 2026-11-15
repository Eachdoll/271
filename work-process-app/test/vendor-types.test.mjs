// 15.58 거래처 구분(매입처·매출처): 0029 마이그레이션의 기존 기록 채우기, 목록 구분 필터, 자동 등록 구분, 등록·수정 체크.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';
const root = path.dirname(new URL(import.meta.url).pathname) + '/..';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-'));
const { env, sqlite } = localEnvironment(dir, 'vt-test');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await worker.fetch(new Request('https://vt.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}
const admin = client();
before(async () => { await approvedRegistration(admin, admin, { name: '관리자', password: 'password', invite: 'vt-test' }); });
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const names = rows => rows.map(v => v.name).sort();

test('0029 fills the type from past records and leaves everything else as it was', () => {
  const db = new DatabaseSync(':memory:');
  const files = fs.readdirSync(path.join(root, 'drizzle')).filter(f => f.endsWith('.sql')).sort();
  for (const f of files.filter(f => f < '0029')) db.exec(fs.readFileSync(path.join(root, 'drizzle', f), 'utf8'));
  for (const [name, key] of [['롤러 상사', '롤러상사'], ['하라다', '하라다'], ['겸업사', '겸업사'], ['새거래처', '새거래처']]) db.prepare('INSERT INTO vendors(name,name_key,contact_name) VALUES(?,?,?)').run(name, key, '담당');
  db.prepare("INSERT INTO purchase_orders(req_no,vendor,item,qty,due_date) VALUES('R1','롤러 상사','롤',1,'2026-11-01')").run();
  db.prepare("INSERT INTO purchase_orders(req_no,vendor,item,qty,due_date) VALUES('R2','겸업사','롤',1,'2026-11-01')").run();
  db.prepare("INSERT INTO shipments(ship_date,item,qty,customer) VALUES('2026-11-01','장갑',1,'겸업사')").run();
  db.prepare("INSERT INTO production_requests(req_no,order_date,customer,author_id,author_name) VALUES('MR-1','2026-11-01','하라다',1,'영업')").run();
  db.exec(fs.readFileSync(path.join(root, 'drizzle', '0029_vendor_types.sql'), 'utf8'));
  const rows = Object.fromEntries(db.prepare('SELECT name,is_purchase,is_sales,contact_name FROM vendors').all().map(r => [r.name, [r.is_purchase, r.is_sales, r.contact_name]]));
  assert.deepEqual(rows, { '롤러 상사': [1, 0, '담당'], '하라다': [0, 1, '담당'], '겸업사': [1, 1, '담당'], '새거래처': [0, 0, '담당'] });
  db.close();
});

test('Lists filter by type; untyped partners show everywhere; auto-registration marks the type it was used for', async () => {
  assert.equal((await admin('POST', '/api/vendors', { name: '매입만', is_purchase: ['1'], is_sales: [] })).status, 200);
  await admin('POST', '/api/vendors', { name: '매출만', is_sales: true });
  await admin('POST', '/api/vendors', { name: '양쪽', is_purchase: true, is_sales: true });
  await admin('POST', '/api/vendors', { name: '미분류' });
  assert.deepEqual(names((await admin('GET', '/api/vendors?type=purchase')).body), ['매입만', '미분류', '양쪽']);
  assert.deepEqual(names((await admin('GET', '/api/vendors?type=sales')).body), ['매출만', '미분류', '양쪽']);
  assert.deepEqual(names((await admin('GET', '/api/vendors?type=sales&only=1')).body), ['매출만', '양쪽'], 'the management filter shows only marked ones');
  assert.deepEqual(names((await admin('GET', '/api/vendors?type=none')).body), ['미분류']);
  assert.equal((await admin('GET', '/api/vendors?type=x')).status, 400);
  // 자동 등록: 발주 → 매입, 생산의뢰 → 매출, 다른 용도로 쓰이면 그 구분을 더한다
  await admin('POST', '/api/po', { req_no: 'R1', vendor: '새 공급사', item: '롤', qty: 1, due_date: '2026-12-01', item_category: '부자재' });
  await admin('POST', '/api/production-requests', { order_date: '2026-11-10', customer: '새 고객사', lines: [{ item: 'A', qty: 1 }] });
  await admin('POST', '/api/production-requests', { order_date: '2026-11-10', customer: '매입만', lines: [{ item: 'A', qty: 1 }] });
  await admin('POST', '/api/production-requests', { order_date: '2026-11-10', customer: '미분류', lines: [{ item: 'A', qty: 1 }] });
  const all = Object.fromEntries((await admin('GET', '/api/vendors')).body.map(v => [v.name, [v.is_purchase, v.is_sales]]));
  assert.deepEqual([all['새 공급사'], all['새 고객사'], all['매입만'], all['미분류']], [[1, 0], [0, 1], [1, 1], [0, 1]], '15.61: a partner used both ways becomes both');
  // 출하로 매출처가 된 곳에 발주하면 매입처도 더해진다(매입 목록에서 사라지지 않게)
  await admin('POST', '/api/po', { req_no: 'R2', vendor: '새 고객사', item: '롤', qty: 1, due_date: '2026-12-01', item_category: '부자재' });
  assert.ok((await admin('GET', '/api/vendors?type=purchase')).body.some(v => v.name === '새 고객사'));
  // 수정: 체크를 모두 풀면 구분 없음, 보내지 않으면 그대로
  const v = (await admin('GET', '/api/vendors?q=' + encodeURIComponent('양쪽'))).body[0];
  assert.deepEqual([(await admin('PUT', `/api/vendors/${v.id}`, { name: '양쪽', contact_name: '김' })).body.is_purchase, (await admin('GET', '/api/vendors?q=' + encodeURIComponent('양쪽'))).body[0].is_sales], [1, 1]);
  const cleared = (await admin('PUT', `/api/vendors/${v.id}`, { name: '양쪽', is_purchase: [], is_sales: [] })).body;
  assert.deepEqual([cleared.is_purchase, cleared.is_sales], [0, 0]);
});
