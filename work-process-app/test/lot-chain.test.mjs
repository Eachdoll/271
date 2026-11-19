// 15.249 LOT 체계: 업체 LOT(없으면 임시 SST) → 커팅·융착 봉투 LOT(투입 원자재 LOT, BOM 자재만) → 세탁(봉투 LOT) → 포장(세탁 완료 봉투 → 완제품 LOT) → LOT 연결 조회
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localEnvironment } from '../local.mjs';
import worker from '../worker.mjs';
import approvedRegistration from './helpers.cjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lot249-'));
const { env, sqlite } = localEnvironment(dir, 'lot249-test');
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const r = await worker.fetch(new Request('https://lot249.test' + url, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    if (r.headers.has('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}
const admin = client(), prod = client();
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
const ymd = today.slice(2).replace(/-/g, '');
const rid = () => crypto.randomUUID();
before(async () => {
  await approvedRegistration(admin, admin, { name: '관리자', password: 'password', invite: 'lot249-test' });
  await approvedRegistration(admin, prod, { name: '생산', password: 'password', invite: 'lot249-test' });
  const u = (await admin('GET', '/api/admin/users')).body.find(x => x.name === '생산');
  await admin('PUT', `/api/admin/users/${u.id}`, { roles: ['production', 'logistics'] });
});
after(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('15.249 vendor LOT or temporary SST LOT, bag LOTs from BOM material LOTs, wash and pack by bag, trace both ways', async () => {
  const cloth = (await admin('POST', '/api/boms', { product: '원단', product_code: 'CL-1', item_category: '원자재', kind: 'finished', base_qty: 1, unit: 'kg', materials: [] })).body;
  const film = (await admin('POST', '/api/boms', { product: '필름', product_code: 'FM-1', item_category: '원자재', kind: 'finished', base_qty: 1, unit: 'kg', materials: [] })).body;
  const other = (await admin('POST', '/api/boms', { product: '다른자재', product_code: 'OT-1', item_category: '원자재', kind: 'finished', base_qty: 1, unit: 'kg', materials: [] })).body;
  // 1) 입고: 업체 LOT 그대로, 비우면 SST-YYMMDD-01·02
  const rc = await admin('POST', '/api/receipts', { receipt_date: today, vendor: '원단상사', request_id: rid(), lines: [{ bom_id: cloth.id, lot: 'HS-0457', qty: 10 }, { bom_id: cloth.id, qty: 5 }, { bom_id: film.id, qty: 8 }, { bom_id: other.id, lot: 'OT-9', qty: 3 }] });
  assert.equal(rc.status, 200, JSON.stringify(rc.body));
  const lots = sqlite.prepare('SELECT item, lot FROM other_receipts ORDER BY id').all().map(r => `${r.item}:${r.lot}`);
  assert.deepEqual(lots, ['원단:HS-0457', `원단:SST-${ymd}-01`, `필름:SST-${ymd}-02`, '다른자재:OT-9']);
  // 2) 커팅·융착: 봉투마다 LOT(생산일_코드_번호), 투입 원자재 LOT은 BOM 자재만, 재고 안에서
  const semi = (await admin('POST', '/api/boms', { product: 'NX808 반제품', product_code: 'NX808', item_category: '반제품', kind: 'semi', semi_type: '천와이퍼', base_qty: 1, unit: '매', materials: [{ item: '원단', item_category: '원자재', qty: 0.01, unit: 'kg' }, { item: '필름', item_category: '원자재', qty: 0.01, unit: 'kg' }] })).body;
  const line = (await admin('POST', '/api/production-units', { kind: 'line', name: '1라인' })).body;
  const washer = (await admin('POST', '/api/production-units', { kind: 'washer', name: '1호기' })).body;
  const cut = (items) => prod('POST', '/api/semi-batches', { process: 'cut', common: { work_date: today, unit_id: line.id }, items, request_id: rid() });
  const base = { entry_mode: 'code', bom_id: semi.id, product_group: 'wiper', product_type: '천와이퍼', start_time: '08:00', end_time: '12:00' };
  const notBom = await cut([{ ...base, qty: 100, inputs: [{ item: '다른자재', lot: 'OT-9', qty: 1 }] }]);
  assert.equal(notBom.status, 400); assert.match(notBom.body.error, /BOM에 없는 자재/);
  const over = await cut([{ ...base, qty: 100, inputs: [{ item: '원단', lot: 'HS-0457', qty: 6 }] }, { ...base, qty: 100, inputs: [{ item: '원단', lot: 'HS-0457', qty: 6 }] }]);
  assert.equal(over.status, 400, 'same LOT across bags is summed'); assert.match(over.body.error, /남은 수량/);
  const c = await cut([{ ...base, qty: 1200, inputs: [{ item: '원단', lot: 'HS-0457', qty: 4 }, { item: '필름', lot: `SST-${ymd}-02`, qty: 2 }] }, { ...base, qty: 1200, inputs: JSON.stringify([{ item: '원단', lot: 'HS-0457', qty: 4 }, { item: '원단', lot: `SST-${ymd}-01`, qty: 1 }]) }, { ...base, qty: 900, inputs: [{ item: '원단', lot: `SST-${ymd}-01`, qty: 3 }] }]);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const bags = c.body.rows.map(r => r.lot);
  assert.deepEqual(bags, [1, 2, 3].map(n => `${ymd}_NX808_${n}`));
  const more = await cut([{ ...base, qty: 10, inputs: [{ item: '원단', lot: 'HS-0457', qty: 1 }] }]);
  assert.equal(more.body.rows[0].lot, `${ymd}_NX808_4`, 'numbering continues the same day');
  const bal = Object.fromEntries((await prod('GET', '/api/inventory/lots?q=' + encodeURIComponent('원단'))).body.rows.map(r => [r.lot, r.balance]));
  assert.equal(bal['HS-0457'], 1, 'cut inputs leave the material LOT stock'); assert.equal(bal[`SST-${ymd}-01`], 1);
  // 3) 세탁: 봉투 LOT 그대로
  const unwashed = (await prod('GET', '/api/semi-bags?state=unwashed')).body.rows.map(r => r.lot);
  assert.equal(unwashed.length, 4);
  const w = await prod('POST', '/api/semi-batches', { process: 'wash', common: { work_date: today, unit_id: washer.id }, items: bags.map((lot, i) => ({ entry_mode: 'wash_quantity', bom_id: semi.id, qty: [1200, 1200, 900][i], lot, bag_required: true, start_time: '13:00' })), request_id: rid() });
  assert.equal(w.status, 200, JSON.stringify(w.body));
  const badBag = await prod('POST', '/api/semi-batches', { process: 'wash', common: { work_date: today, unit_id: washer.id }, items: [{ entry_mode: 'wash_quantity', bom_id: semi.id, qty: 1, lot: 'NOPE_1', bag_required: true }], request_id: rid() });
  assert.equal(badBag.status, 400, JSON.stringify(badBag.body));
  const washed = (await prod('GET', '/api/semi-bags?state=washed')).body.rows;
  assert.deepEqual(washed.map(r => r.lot).sort(), [...bags].sort()); assert.equal(washed.find(r => r.lot === bags[0]).washed_qty, 1200);
  // 4) 포장: 세탁 완료 봉투만, 완제품 LOT 포장일_코드_P순번
  const fin = (await admin('POST', '/api/boms', { product: 'NX808 완제품', product_code: 'NX808B', item_category: '제품', kind: 'finished', base_qty: 1, unit: 'BOX', materials: [{ item: 'NX808 반제품', item_category: '반제품', qty: 100, unit: '매' }] })).body;
  assert.ok(fin.id, JSON.stringify(fin));
  const plan = (await admin('POST', '/api/schedules', { kind: 'finished', period: 'day', start_date: today, qty: 50, bom_id: fin.id })).body;
  const notWashed = await prod('POST', `/api/schedules/${plan.id}/actuals`, { production_date: today, qty: 10, request_id: rid(), bags: [`${ymd}_NX808_4`] });
  assert.equal(notWashed.status, 400, JSON.stringify([plan, notWashed.body])); assert.match(notWashed.body.error, /세탁/);
  const a1 = await prod('POST', `/api/schedules/${plan.id}/actuals`, { production_date: today, qty: 30, request_id: rid(), bags: [bags[0], bags[1], bags[2]] });
  assert.equal(a1.status, 200, JSON.stringify(a1.body)); assert.equal(a1.body.lot, `${ymd}_NX808B_P1`);
  const a2 = await prod('POST', `/api/schedules/${plan.id}/actuals`, { production_date: today, qty: 5, request_id: rid(), bags: [bags[2]] });
  assert.equal(a2.body.lot, `${ymd}_NX808B_P2`, 'a leftover bag can go into the next finished LOT');
  // 5) 조회: 완제품 → 봉투 → 원자재
  const t1 = (await prod('GET', '/api/lot-trace?lot=' + encodeURIComponent(a1.body.lot))).body;
  assert.equal(t1.kind, 'finished'); assert.deepEqual(t1.bags.map(b => b.lot).sort(), [...bags].sort());
  assert.deepEqual(t1.materials.map(m => m.lot).sort(), ['HS-0457', `SST-${ymd}-01`, `SST-${ymd}-02`].sort());
  assert.equal(t1.materials.find(m => m.lot === 'HS-0457').receipts[0].vendor, '원단상사');
  // 원자재 → 봉투 → 완제품
  const t2 = (await prod('GET', '/api/lot-trace?lot=' + encodeURIComponent(`SST-${ymd}-01`))).body;
  assert.equal(t2.kind, 'material'); assert.deepEqual(t2.bags.map(b => b.lot).sort(), [bags[1], bags[2]].sort());
  assert.deepEqual(t2.finished.map(f => f.lot).sort(), [a1.body.lot, a2.body.lot].sort());
  // 봉투 → 양쪽
  const t3 = (await prod('GET', '/api/lot-trace?lot=' + encodeURIComponent(bags[0]))).body;
  assert.equal(t3.kind, 'bag'); assert.deepEqual(t3.finished.map(f => f.lot), [a1.body.lot]); assert.equal(t3.bags[0].washes.length, 1);
  assert.equal((await prod('GET', '/api/lot-trace?lot=ZZZ')).body.kind, '');
  const recent = (await prod('GET', '/api/lot-trace/recent')).body; assert.equal(recent.finished.length, 2); assert.equal(recent.bags.length, 4);
  // 봉투 LOT은 세탁·포장에 쓰인 뒤에는 바꿀 수 없음
  const rec = sqlite.prepare("SELECT id FROM semi_records WHERE lot=? AND process='cut'").get(bags[0]);
  assert.equal((await prod('PUT', `/api/semi-records/${rec.id}`, { lot: 'X-1', note: '바꿈' })).status, 400);
});

test('15.250 receipt keeps trade qty (yd) and physical pieces; cutting takes pieces per LOT and BOM computes the yd usage', async () => {
  const yarn = (await admin('POST', '/api/boms', { product: '야드원단', product_code: 'YD-1', item_category: '원자재', kind: 'finished', base_qty: 1, unit: 'yd', materials: [] })).body;
  const rc = await admin('POST', '/api/receipts', { receipt_date: today, vendor: '야드상사', request_id: rid(), lines: [{ bom_id: yarn.id, lot: 'YD-A', qty: 300, pieces: 30 }, { bom_id: yarn.id, lot: 'YD-B', qty: 100, pieces: 10 }] });
  assert.equal(rc.status, 200, JSON.stringify(rc.body));
  assert.deepEqual(rc.body.lines.map(l => [l.lot, l.qty, l.pieces]), [['YD-A', 300, 30], ['YD-B', 100, 10]]);
  assert.equal((await admin('POST', '/api/receipts', { receipt_date: today, vendor: '야드상사', request_id: rid(), lines: [{ bom_id: yarn.id, lot: 'YD-C', qty: 1, pieces: -1 }] })).status, 400);
  const lots = (await prod('GET', '/api/lots/available?item=' + encodeURIComponent('야드원단'))).body.rows;
  assert.deepEqual(lots.map(l => [l.lot, l.balance, l.pieces_left]), [['YD-A', 300, 30], ['YD-B', 100, 10]]);
  // 반제품 1매에 0.05yd: 양품 900 + 불량 100 = 1000매 → 50yd. 절 3:1로 나눔 → YD-A 37.5yd, YD-B 12.5yd
  const semi = (await admin('POST', '/api/boms', { product: 'YD 반제품', product_code: 'YDS', item_category: '반제품', kind: 'semi', semi_type: '천와이퍼', base_qty: 1, unit: '매', materials: [{ item: '야드원단', item_category: '원자재', qty: 0.05, unit: 'yd' }] })).body;
  const line = (await prod('GET', '/api/production-units?kind=line')).body[0];
  const c = await prod('POST', '/api/semi-batches', { process: 'cut', common: { work_date: today, unit_id: line.id }, request_id: rid(), items: [{ entry_mode: 'code', bom_id: semi.id, product_group: 'wiper', product_type: '천와이퍼', start_time: '08:00', end_time: '10:00', qty: 900, defect_qty: 100, defect_reason: '오염', inputs: [{ item: '야드원단', lot: 'YD-A', pieces: 3 }, { item: '야드원단', lot: 'YD-B', pieces: 1 }] }] });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const used = sqlite.prepare('SELECT lot, qty, pieces FROM semi_lot_inputs WHERE record_id=? ORDER BY id').all(c.body.rows[0].id);
  assert.deepEqual(used.map(u => [u.lot, u.qty, u.pieces]), [['YD-A', 37.5, 3], ['YD-B', 12.5, 1]]);
  const after = (await prod('GET', '/api/lots/available?item=' + encodeURIComponent('야드원단'))).body.rows;
  assert.deepEqual(after.map(l => [l.lot, l.balance, l.pieces_left]), [['YD-A', 262.5, 27], ['YD-B', 87.5, 9]]);
  const over = await prod('POST', '/api/semi-batches', { process: 'cut', common: { work_date: today, unit_id: line.id }, request_id: rid(), items: [{ entry_mode: 'code', bom_id: semi.id, product_group: 'wiper', product_type: '천와이퍼', start_time: '11:00', end_time: '12:00', qty: 10, inputs: [{ item: '야드원단', lot: 'YD-B', pieces: 10 }] }] });
  assert.equal(over.status, 400); assert.match(over.body.error, /남은 실물 9절/);
  const tr = (await prod('GET', '/api/lot-trace?lot=YD-A')).body;
  assert.equal(tr.kind, 'material'); assert.equal(tr.bags[0].inputs.find(i => i.lot === 'YD-A').pieces, 3); assert.equal(tr.materials.find(m => m.lot === 'YD-A').receipts[0].pieces, 30);
});
