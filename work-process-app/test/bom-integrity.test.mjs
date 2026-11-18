// 15.106 제품등록 무결성: 코드 중복(대소문자 무시), 임시 품목 확정 시 코드 필수, 코드·이름 변경 따라가기, 순환 BOM 막기, 구성자재 판단 통일
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bi106-'));
const { env, sqlite } = localEnvironment(dir, 'bi106-test');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await worker.fetch(new Request('https://bi106.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}
const admin = client();
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
before(async () => { await approvedRegistration(admin, admin, { name: '관리자', password: 'password', invite: 'bi106-test' }); });
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const raw = (product, code, extra = {}) => ({ product, product_code: code, item_category: '원자재', kind: 'finished', base_qty: 1, unit: 'KG', materials: [], ...extra });
const fg = (product, code, mats) => ({ product, product_code: code, item_category: '제품', kind: 'finished', base_qty: 1, unit: 'EA', materials: mats.map(item => ({ item, item_category: '원자재', qty: 1, unit: 'KG' })) });

test('Product codes are unique ignoring case and spaces', async () => {
  assert.equal((await admin('POST', '/api/boms', raw('원단A', 'RM-1'))).status, 200);
  const dup = await admin('POST', '/api/boms', raw('원단B', ' rm-1 '));
  assert.equal(dup.status, 409); assert.match(dup.body.error, /원단A/);
  const b = (await admin('POST', '/api/boms', raw('원단B', 'RM-2'))).body;
  assert.equal((await admin('PUT', `/api/boms/${b.id}`, raw('원단B', 'Rm-1'))).status, 409);
});

test('Confirming a temp item needs a code; changing a code follows through to records', async () => {
  const po = (await admin('POST', '/api/po', { req_no: 'PR-T', vendor: '공급사', item: '새원단', qty: 3, due_date: today, item_category: '원자재' })).body;
  const temp = sqlite.prepare('SELECT * FROM boms WHERE product=?').get('새원단');
  assert.equal(temp.is_temp, 1);
  const empty = await admin('PUT', `/api/boms/${temp.id}`, raw('새원단', ''));
  assert.equal(empty.status, 400); assert.match(empty.body.error, /제품코드를 넣으세요/);
  assert.equal((await admin('PUT', `/api/boms/${temp.id}`, raw('새원단', 'RM-10'))).status, 200);
  assert.equal(sqlite.prepare('SELECT product_code FROM purchase_orders WHERE id=?').get(po.id).product_code, 'RM-10');
  // 정식 품목의 코드 변경 → 발주가 따라오고, 사용처가 남아 완전 삭제가 막힌다
  assert.equal((await admin('PUT', `/api/boms/${temp.id}`, raw('새원단', 'RM-11'))).status, 200);
  assert.equal(sqlite.prepare('SELECT product_code FROM purchase_orders WHERE id=?').get(po.id).product_code, 'RM-11');
  assert.equal((await admin('GET', `/api/boms/${temp.id}/usage`)).body.total, 1);
  assert.equal((await admin('DELETE', `/api/boms/${temp.id}?purge=1`)).status, 409);
});

test('Renaming a material updates the BOMs that use it, and usage matches ignoring spaces', async () => {
  const mat = (await admin('POST', '/api/boms', raw('원단 C', 'RM-20'))).body;
  const prod = (await admin('POST', '/api/boms', fg('와이퍼완제품', 'FG-1', ['원단C']))).body; // 띄어쓰기 다르게 넣어도 같은 자재
  assert.equal((await admin('GET', `/api/boms/${mat.id}/usage`)).body.total, 1, 'usage ignores spaces');
  assert.equal((await admin('DELETE', `/api/boms/${mat.id}?purge=1`)).status, 409);
  assert.equal((await admin('PUT', `/api/boms/${mat.id}`, raw('원단C-신', 'RM-20'))).status, 200);
  const mats = JSON.parse(sqlite.prepare('SELECT materials FROM boms WHERE id=?').get(prod.id).materials);
  assert.equal(mats[0].item, '원단C-신');
  assert.equal((await admin('GET', `/api/boms/${mat.id}/usage`)).body.total, 1);
});

test('A BOM cannot contain itself, directly or through another BOM', async () => {
  const self = await admin('POST', '/api/boms', fg('자기제품', 'FG-9', ['자기제품']));
  assert.equal(self.status, 400); assert.match(self.body.error, /자기 자신/);
  const a = (await admin('POST', '/api/boms', { ...fg('반제품X', 'SM-1', ['원단A']), item_category: '부자재', materials: [{ item: '원단A', item_category: '원자재', qty: 1, unit: 'KG' }] })).body;
  const top = (await admin('POST', '/api/boms', fg('완제품Y', 'FG-2', ['반제품X']))).body;
  const loop = await admin('PUT', `/api/boms/${a.id}`, { ...fg('반제품X', 'SM-1', ['완제품Y']), item_category: '부자재' });
  assert.equal(loop.status, 400); assert.match(loop.body.error, /순환/);
  assert.ok(top.id);
});

test('15.107 Code spec flows into orders, POs and receipts; PO lines keep a unit price', async () => {
  const withSpec = (await admin('POST', '/api/boms', { ...raw('나일론장갑', 'NG-50'), item_category: '상품', spec: '9인치' })).body;
  assert.equal(withSpec.spec, '9인치');
  const noSpec = (await admin('POST', '/api/boms', { ...raw('면장갑', 'CG-1'), item_category: '상품' })).body;
  await admin('POST', '/api/vendors', { name: '고객상사', is_sales: true });
  const so = (await admin('POST', '/api/sales-orders', { customer: '고객상사', order_date: today, request_id: crypto.randomUUID(), lines: [{ bom_id: withSpec.id, spec: '아무거나', qty: 1 }, { bom_id: noSpec.id, spec: '직접 L', qty: 1 }] })).body;
  assert.deepEqual(so.lines.map(l => l.spec), ['9인치', '직접 L'], 'code spec wins, typed spec only when the code has none');
  const po = await admin('POST', '/api/batches/purchase_order', { request_id: crypto.randomUUID(), common: { vendor: '공급상사', due_date: today }, items: [{ bom_id: withSpec.id, qty: 10, spec: '무시', unit_price: 1250 }] });
  assert.equal(po.status, 200, JSON.stringify(po.body));
  const row = sqlite.prepare('SELECT spec, unit_price FROM purchase_orders WHERE id=?').get(po.body.rows[0].id);
  assert.deepEqual({ ...row }, { spec: '9인치', unit_price: 1250 });
  // 품목 규격을 고치면 다음 입력부터 새 규격
  assert.equal((await admin('PUT', `/api/boms/${withSpec.id}`, { ...raw('나일론장갑', 'NG-50'), item_category: '상품', spec: '10인치' })).body.spec, '10인치');
  const rc = await admin('POST', '/api/receipts', { receipt_date: today, vendor: '공급상사', request_id: crypto.randomUUID(), lines: [{ bom_id: withSpec.id, qty: 2, spec: '무시' }] });
  assert.equal(rc.status, 200, JSON.stringify(rc.body));
  assert.equal(sqlite.prepare('SELECT spec FROM other_receipts ORDER BY id DESC LIMIT 1').get().spec, '10인치');
});

test('15.196 BOM sheet save: add/remove/change materials at once, stale and duplicate guards, comment', async () => {
  await admin('POST', '/api/boms', raw('시트원단', 'BS-R1')); await admin('POST', '/api/boms', raw('시트실', 'BS-R2'));
  const p = (await admin('POST', '/api/boms', fg('시트제품', 'BS-P1', ['시트원단']))).body;
  const mats = [{ item: '시트원단', item_category: '원자재', qty: 0.5, unit: 'KG' }, { item: '시트실', item_category: '원자재', qty: 2, unit: 'M' }];
  assert.equal((await admin('POST', `/api/boms/${p.id}/bom`, { updated_at: 'old', base_qty: 1, materials: mats })).status, 409, 'stale read');
  assert.match((await admin('POST', `/api/boms/${p.id}/bom`, { updated_at: p.updated_at, base_qty: 1, materials: [mats[0], { ...mats[0], qty: 1 }] })).body.error, /두 번/);
  assert.match((await admin('POST', `/api/boms/${p.id}/bom`, { updated_at: p.updated_at, base_qty: 1, materials: [] })).body.error, /1개 이상/);
  assert.match((await admin('POST', `/api/boms/${p.id}/bom`, { updated_at: p.updated_at, base_qty: 1, materials: [{ item: '시트제품', item_category: '제품', qty: 1, unit: 'EA' }] })).body.error, /자기 자신/);
  const saved = await admin('POST', `/api/boms/${p.id}/bom`, { updated_at: p.updated_at, base_qty: 10, materials: mats });
  assert.equal(saved.status, 200, JSON.stringify(saved.body)); assert.equal(saved.body.base_qty, 10); assert.deepEqual(saved.body.materials.map(m => [m.item, m.qty, m.unit]), [['시트원단', 0.5, 'KG'], ['시트실', 2, 'M']]);
  const c = sqlite.prepare("SELECT content FROM progress_comments WHERE entity_type='bom' AND entity_id=? ORDER BY id DESC").get(p.id).content;
  assert.match(c, /\[BOM\] 기준 수량 1 → 10/); assert.match(c, /시트원단 1KG → 0.5KG/); assert.match(c, /\+ 시트실 2M/);
  const again = await admin('POST', `/api/boms/${p.id}/bom`, { updated_at: saved.body.updated_at, base_qty: 10, materials: [mats[1]] });
  assert.equal(again.status, 200); assert.match(sqlite.prepare("SELECT content FROM progress_comments WHERE entity_type='bom' AND entity_id=? ORDER BY id DESC").get(p.id).content, /− 시트원단/);
});
