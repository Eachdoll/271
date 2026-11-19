// 15.234 기타입고 내역(머리 OTS_YYMMDD_NNNN) → 상세 줄 담기·LOT/창고 고치기·삭제
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpa-ots-'));
const { env, sqlite } = localEnvironment(dir, 'ots-invite');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await worker.fetch(new Request('https://ots.test' + url, { method, headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json() };
  };
}
const admin = client(), rid = () => crypto.randomUUID();
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), ymd = today.slice(2).replace(/-/g, '');
let bom;
before(async () => {
  assert.equal((await admin('POST', '/api/auth/register', { name: '관리자', password: 'password', invite: 'ots-invite' })).status, 200);
  bom = (await admin('POST', '/api/boms', { product: 'MAGNERA 8864', product_code: 'RMNW0001', item_category: '원자재', kind: 'finished', base_qty: 1, unit: 'EA', materials: [] })).body;
  await admin('POST', '/api/warehouses', { name: '1동', locations: '1층,2층' });
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('Other receipt head first, then lines; numbering OTS_YYMMDD_NNNN; edit lot/place; delete rules', async () => {
  const h1 = await admin('POST', '/api/receipts/other', { request_id: rid(), receipt_date: today, vendor: '기타', note: '테스트' });
  assert.equal(h1.status, 200, JSON.stringify(h1.body)); assert.equal(h1.body.receipt_no, `OTS_${ymd}_0001`); assert.equal(h1.body.lines.length, 0);
  const h2 = await admin('POST', '/api/receipts/other', { request_id: rid(), receipt_date: today, vendor: '기타' }); assert.equal(h2.body.receipt_no, `OTS_${ymd}_0002`);
  // 줄 담기: 같은 LOT 3줄 → 서브 001~003, 창고·위치
  const lot = `R${ymd}_0001`;
  const add = await admin('POST', `/api/receipts/${h1.body.id}/lines`, { request_id: rid(), lines: [1, 2, 3].map(() => ({ bom_id: bom.id, item: bom.product, item_category: '원자재', qty: 1, lot, warehouse: '1동', location: '1층', note2: '업체A' })) });
  assert.equal(add.status, 200, JSON.stringify(add.body)); assert.deepEqual(add.body.lines.map(l => `${l.lot}-${l.sub_lot}`), [1, 2, 3].map(n => `${lot}-00${n}`));
  assert.equal(add.body.lines[0].warehouse, '1동');
  // 목록(기타입고만)
  assert.deepEqual((await admin('GET', '/api/receipts?kind=other')).body.rows.map(r => r.receipt_no).sort(), [`OTS_${ymd}_0001`, `OTS_${ymd}_0002`]);
  // 줄 LOT·위치 고치기
  const line = add.body.lines[2];
  const ed = await admin('PUT', `/api/other-receipts/${line.id}/place`, { lot: `R${ymd}_0002`, warehouse: '1동', location: '2층', note2: '업체B' });
  assert.equal(ed.status, 200, JSON.stringify(ed.body)); assert.equal(ed.body.lot, `R${ymd}_0002`); assert.equal(ed.body.sub_lot, '001'); assert.equal(ed.body.location, '2층');
  assert.equal((await admin('PUT', `/api/other-receipts/${line.id}/place`, { warehouse: '1동', location: '9층' })).status, 400, 'unknown location');
  // 머리: 줄 있으면 날짜·거래처 못 바꿈(비고는 됨), 지우기도 막음
  assert.equal((await admin('PUT', `/api/receipts/${h1.body.id}`, { vendor: '대한' })).status, 400);
  assert.equal((await admin('PUT', `/api/receipts/${h1.body.id}`, { note: '비고만' })).body.note, '비고만');
  assert.equal((await admin('DELETE', `/api/receipts/${h1.body.id}`)).status, 400);
  // 빈 머리는 고치고 지울 수 있음
  assert.equal((await admin('PUT', `/api/receipts/${h2.body.id}`, { vendor: '대한' })).body.vendor, '대한');
  assert.equal((await admin('DELETE', `/api/receipts/${h2.body.id}`)).status, 200);
  // 재고에 위치별로
  const places = (await admin('GET', `/api/inventory/places?asof=${today}`)).body.rows;
  assert.equal(places.find(r => r.location === '1층')?.qty, 2); assert.equal(places.find(r => r.location === '2층')?.qty, 1);
});
