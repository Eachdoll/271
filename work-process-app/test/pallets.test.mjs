// 15.231 파렛트 묶음 QR: LOT 여러 개를 한 파렛트로 묶고(잔량·다른 파렛트 몫 확인), 수량을 고치고(QR 그대로), 파렛트 하나로 LOT별 출하를 한 번에.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpa-plt-'));
const { env, sqlite } = localEnvironment(dir, 'plt-invite');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await worker.fetch(new Request('https://plt.test' + url, { method, headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json() };
  };
}
const admin = client();
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const rid = () => crypto.randomUUID();
before(async () => {
  assert.equal((await admin('POST', '/api/auth/register', { name: '관리자', password: 'password', invite: 'plt-invite' })).status, 200);
  const g = (await admin('POST', '/api/boms', { product: '니트릴 글러브 S', product_code: 'G-NS', item_category: '상품', kind: 'finished', base_qty: 1, unit: 'BOX', materials: [] })).body;
  const r = await admin('POST', '/api/receipts', { receipt_date: today, vendor: '대한', request_id: rid(), lines: [{ bom_id: g.id, item: '니트릴 글러브 S', item_category: '상품', unit: 'BOX', qty: 50, lot: 'L-FEB' }, { bom_id: g.id, item: '니트릴 글러브 S', item_category: '상품', unit: 'BOX', qty: 30, lot: 'L-MAR' }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const bal = async lot => (await admin('GET', `/api/inventory/lots?q=${lot}`)).body.rows.find(x => x.lot === lot).balance;

test('Pallet bundles lots, keeps its QR when quantities change, and ships every lot at once', async () => {
  const lots = (await admin('GET', '/api/inventory/lots?q=L-')).body.rows; const feb = lots.find(x => x.lot === 'L-FEB'), mar = lots.find(x => x.lot === 'L-MAR');
  assert.ok(feb && mar, JSON.stringify(lots));
  const p = await admin('POST', '/api/pallets', { request_id: rid(), note: '1파렛트', lines: [{ item: feb.item, unit: 'BOX', lot: 'L-FEB', qty: 40 }, { item: mar.item, unit: 'BOX', lot: 'L-MAR', qty: 20 }] });
  assert.equal(p.status, 200, JSON.stringify(p.body)); assert.match(p.body.pallet_no, new RegExp(`^PLT_${today.replace(/-/g, '')}_001$`)); assert.equal(p.body.total, 60);
  // 다른 파렛트는 남은 몫(FEB 10)까지만
  assert.equal((await admin('POST', '/api/pallets', { request_id: rid(), lines: [{ item: feb.item, unit: 'BOX', lot: 'L-FEB', qty: 11 }] })).status, 400);
  const p2 = await admin('POST', '/api/pallets', { request_id: rid(), lines: [{ item: feb.item, unit: 'BOX', lot: 'L-FEB', qty: 10 }] }); assert.equal(p2.body.pallet_no.slice(-3), '002');
  // 묶어도 재고는 그대로
  assert.equal(await bal('L-FEB'), 50);
  // 2박스 꺼내 쓰기 → 수량만 바뀜(번호 그대로), 이력
  const feL = p.body.lines.find(l => l.lot === 'L-FEB');
  const u = await admin('PUT', `/api/pallets/${p.body.id}`, { lines: [{ id: feL.id, qty: 38 }], reason: '2박스 먼저 사용' });
  assert.equal(u.status, 200, JSON.stringify(u.body)); assert.equal(u.body.total, 58); assert.equal(u.body.pallet_no, p.body.pallet_no); assert.match(u.body.changes[0].summary, /L-FEB 40→38/);
  // 파렛트 번호로 찾기(QR 스캔)
  assert.equal((await admin('GET', `/api/pallets/lookup?code=${p.body.pallet_no.toLowerCase()}`)).body.id, p.body.id);
  // 출고: LOT별 출하 2줄, 재고 차감
  const s = await admin('POST', `/api/pallets/${p.body.pallet_no}/ship`, { ship_date: today, customer: '삼성' });
  assert.equal(s.status, 200, JSON.stringify(s.body)); assert.equal(s.body.status, 'shipped');
  const ships = sqlite.prepare('SELECT lot, qty, pallet_id FROM shipments WHERE pallet_id=? ORDER BY lot').all(p.body.id);
  assert.deepEqual(ships.map(x => [x.lot, x.qty]), [['L-FEB', 38], ['L-MAR', 20]]);
  assert.equal(await bal('L-FEB'), 12); assert.equal(await bal('L-MAR'), 10);
  // 두 번 출고·출고 뒤 수정·풀기 막음
  assert.equal((await admin('POST', `/api/pallets/${p.body.id}/ship`, { ship_date: today, customer: '삼성' })).status, 409);
  assert.equal((await admin('PUT', `/api/pallets/${p.body.id}`, { lines: [{ id: feL.id, qty: 1 }] })).status, 400);
  assert.equal((await admin('POST', `/api/pallets/${p.body.id}/cancel`)).status, 400);
  // 풀기: 열린 파렛트는 풀 수 있고 재고는 그대로
  assert.equal((await admin('POST', `/api/pallets/${p2.body.id}/cancel`)).body.status, 'cancelled');
  assert.equal(await bal('L-FEB'), 12);
  assert.deepEqual((await admin('GET', '/api/pallets?status=all')).body.rows.map(r => r.status).sort(), ['cancelled', 'shipped']);
});
