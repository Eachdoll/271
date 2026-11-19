// 15.230 완제품 생산실적 작업지시번호(WOR_실적날짜_순번), 계획 목록에 번호, 계획 확정 취소(실적 없을 때만 대기로)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpa-wo-'));
const { env, sqlite } = localEnvironment(dir, 'wo-invite');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await worker.fetch(new Request('https://wo.test' + url, { method, headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json() };
  };
}
const admin = client();
before(async () => { assert.equal((await admin('POST', '/api/auth/register', { name: '관리자', password: 'password', invite: 'wo-invite' })).status, 200); });
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const plan = async (day, product) => (await admin('POST', '/api/schedules', { kind: 'finished', period: 'day', start_date: day, product, qty: 100, request_id: crypto.randomUUID() })).body;
const actual = (id, day, qty) => admin('POST', `/api/schedules/${id}/actuals`, { production_date: day, qty, request_id: crypto.randomUUID() });

test('Work order numbers follow the actual date and count up per day; plans list them; confirm can be undone only without actuals', async () => {
  const a = await plan('2026-09-01', '와이퍼A'), b = await plan('2026-09-01', '와이퍼B'), c = await plan('2026-09-02', '와이퍼C');
  await admin('POST', '/api/schedules/confirm', { ids: [a.id, b.id, c.id] });
  const r1 = await actual(a.id, '2026-09-01', 10); assert.equal(r1.status, 200, JSON.stringify(r1.body)); assert.equal(r1.body.work_order, 'WOR_20260901_001');
  assert.equal((await actual(b.id, '2026-09-01', 5)).body.work_order, 'WOR_20260901_002');
  assert.equal((await actual(a.id, '2026-09-01', 3)).body.work_order, 'WOR_20260901_003');
  assert.equal((await actual(c.id, '2026-09-02', 7)).body.work_order, 'WOR_20260902_001', 'numbering restarts per date');
  const list = (await admin('GET', '/api/schedules?kind=finished&from=2026-09-01&to=2026-09-02')).body;
  assert.equal(list.find(s => s.id === a.id).work_orders, 'WOR_20260901_001,WOR_20260901_003');
  // 계획 접수 취소: 실적이 있으면 안 되고, 없으면 대기로
  const d = await plan('2026-09-03', '와이퍼D'); await admin('POST', '/api/schedules/confirm', { ids: [d.id] });
  assert.equal((await admin('POST', '/api/schedules/confirm', { ids: [a.id], confirm: false })).status, 400);
  const un = await admin('POST', '/api/schedules/confirm', { ids: [d.id], confirm: false }); assert.equal(un.body.changed, 1);
  assert.equal(sqlite.prepare('SELECT confirmed_at FROM schedules WHERE id=?').get(d.id).confirmed_at, '');
});
